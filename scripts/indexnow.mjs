import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isIndexedRoute, primeSeoIndexing, sitemapLocs } from './seo.mjs';

export const INDEXNOW_ORIGIN = 'https://dentaldatalab.com';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const DEFAULT_INDEXNOW_ROUTES = ['/', '/reports/', '/regions/', '/clinic-assets/', '/data/', '/methodology/', '/clinics/c-f1e05c9ae9d2/'];

// Ad-hoc URLs stay few and strict: any live mismatch aborts the run.
export const INDEXNOW_ADHOC_LIMIT = 8;
// A named set is the one bounded exception: one POST of at most this many URLs (the protocol allows 10,000),
// each verified live first with at most this many requests in flight.
export const INDEXNOW_SET_LIMIT = 500;
export const INDEXNOW_SET_CONCURRENCY = 4;
// hospitals: every 치과병원 (typeCode 41) profile plus the hub pages that describe and link them.
//   routes   exact routes, taken when the build has them
//   sections every built route below the prefix
//   hubs     hub level only: /conditions/ and /conditions/<one segment>/, never the per-district condition lists
// A 치과의원 (51) profile can never be part of a named set.
export const INDEXNOW_SETS = Object.freeze({
  hospitals: Object.freeze({
    institutionType: '41',
    routes: Object.freeze(['/', '/data/', '/data/open/', '/press/', '/for-clinics/']),
    sections: Object.freeze(['/hospitals/', '/reports/', '/guides/']),
    hubs: Object.freeze([/^\/conditions\/(?:[^/]+\/)?$/]),
  }),
});
const institutionRoute = id => '/clinics/' + id + '/';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
// Accepts one urlset's XML text or an iterable of <loc> values (prepareIndexNow passes the locs of every sitemap file).
const sitemapUrls = value => typeof value === 'string' ? new Set([...value.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])) : new Set(value);
function namedSet(name) {
  if (typeof name !== 'string' || !Object.hasOwn(INDEXNOW_SETS, name)) throw new Error('Unknown IndexNow set: ' + name + '. Available: ' + Object.keys(INDEXNOW_SETS).join(', '));
  return INDEXNOW_SETS[name];
}

// Whether a non-institution route belongs to the set by its path alone (before the build, sitemap and index checks).
export function indexNowSetHubRoute(name, route) {
  const set = namedSet(name);
  return set.routes.includes(route) || set.sections.some(prefix => route.startsWith(prefix)) || set.hubs.some(pattern => pattern.test(route));
}

// Pure set building. clinics: data/clinics.json records; routes: the build manifest's routes; sitemap: urlset text or locs.
// The result is always inside manifest ∩ sitemap ∩ indexed routes, hub pages first, then institution profiles by id.
export function indexNowSetRoutes(name, { clinics, routes, sitemap }) {
  const set = namedSet(name);
  const types = new Map(clinics.map(clinic => [institutionRoute(clinic.id), clinic.typeCode]));
  const built = new Set(routes), listed = sitemapUrls(sitemap);
  const wanted = [
    ...set.routes,
    ...routes.filter(route => !route.startsWith('/clinics/') && indexNowSetHubRoute(name, route)),
    ...clinics.filter(clinic => clinic.typeCode === set.institutionType).map(clinic => institutionRoute(clinic.id)).sort(),
  ];
  const selected = [...new Set(wanted)].filter(route => built.has(route) && isIndexedRoute(route) && listed.has(INDEXNOW_ORIGIN + route));
  for (const route of selected) {
    if (route.startsWith('/clinics/') && types.get(route) !== set.institutionType) throw new Error('A named IndexNow set may only contain 치과병원 profiles: ' + route);
  }
  return selected;
}

export function indexNowKey(root) {
  const file = path.join(root, 'data/content/indexnow-key.txt');
  if (!fs.existsSync(file)) return null;
  const key = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-zA-Z0-9-]{8,128}$/.test(key)) throw new Error('Invalid IndexNow public verification key.');
  return key;
}

export function localPage(directory, route) {
  const clinic = route.match(/^\/clinics\/(c-([a-f0-9]{3})[a-f0-9]{9})\/$/);
  const file = path.join(directory, route === '/' ? 'index.html' : route.slice(1) + 'index.html');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  if (clinic) {
    const shard = path.join(directory, 'data/cloudflare/html', clinic[2] + '.json');
    if (fs.existsSync(shard)) {
      const html = JSON.parse(fs.readFileSync(shard, 'utf8'))[clinic[1]];
      if (typeof html === 'string') return html;
    }
  }
  throw new Error('Missing generated HTML: ' + route);
}

// null when the HTML is an indexable page whose canonical is this URL, otherwise the reason.
function indexableHtmlProblem(html, url) {
  const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1];
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1];
  return !robots ? 'no_robots_meta' : /noindex/i.test(robots) ? 'noindex_meta' : canonical !== url ? 'canonical_mismatch' : null;
}
export function assertIndexableHtml(html, url) {
  if (indexableHtmlProblem(html, url)) throw new Error('URL is not an indexable canonical HTML page: ' + url);
}

// Without `set`: 1–8 explicit URLs (or the default handful), each of which must pass or the call throws.
// With `set`: the named set for this build; unchanged-and-accepted URLs drop out as usual and anything beyond
// INDEXNOW_SET_LIMIT is returned as `deferred` for a later run instead of being sent.
export function prepareIndexNow({ root, directory, state = {}, urls = null, set = null }) {
  const key = indexNowKey(root);
  if (!key) throw new Error('IndexNow key file is missing.');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest.json'), 'utf8'));
  if (!manifest.indexingEnabled || manifest.domain !== INDEXNOW_ORIGIN) throw new Error('An SEO public build for the exact allowed HTTPS origin is required.');
  // Expect exactly what this build rendered: routes it demoted to noindex are not indexed routes.
  primeSeoIndexing(directory);
  // Every <loc> the build advertises, following the sitemap index one level down.
  const sitemap = new Set(sitemapLocs(file => fs.readFileSync(path.join(directory, file), 'utf8')));
  if (set !== null) {
    namedSet(set);
    if (urls !== null) throw new Error('Choose a named set or explicit URLs, not both.');
    const source = fs.readFileSync(path.join(root, 'data/clinics.json'));
    // Institution types come from the data file, so it must be the file this build was made from.
    if (sha256(source) !== manifest.sourceDataSha256) throw new Error('This build was not made from the current data/clinics.json. Rebuild before using a named set.');
    urls = indexNowSetRoutes(set, { clinics: JSON.parse(source.toString('utf8')).clinics, routes: manifest.routes, sitemap }).map(route => INDEXNOW_ORIGIN + route);
    if (!urls.length) throw new Error('The IndexNow set selects nothing in this build: ' + set);
  } else {
    urls ??= DEFAULT_INDEXNOW_ROUTES.map(route => INDEXNOW_ORIGIN + route);
    if (!Array.isArray(urls) || !urls.length || urls.length > INDEXNOW_ADHOC_LIMIT) throw new Error('Submit 1–8 explicitly selected URLs per run. Automatic bulk submission is disabled.');
  }
  const selected = [];
  for (const input of [...new Set(urls)]) {
    const url = new URL(input);
    if (url.origin !== INDEXNOW_ORIGIN || url.username || url.password || url.search || url.hash || url.href !== input
      || !isIndexedRoute(url.pathname) || !manifest.routes.includes(url.pathname)
      || !sitemap.has(input)) throw new Error('URL outside the public canonical allowlist: ' + input);
    const html = localPage(directory, url.pathname);
    assertIndexableHtml(html, input);
    const digest = sha256(html);
    const previous = state.accepted?.[input];
    selected.push({ url: input, digest, unchanged: previous?.digest === digest && previous?.key === key });
  }
  const pending = selected.filter(item => !item.unchanged);
  const changed = set === null ? pending : pending.slice(0, INDEXNOW_SET_LIMIT);
  return {
    set,
    payload: { host: new URL(INDEXNOW_ORIGIN).hostname, key, keyLocation: INDEXNOW_ORIGIN + '/' + key + '.txt', urlList: changed.map(item => item.url) },
    selected, changed, deferred: pending.slice(changed.length),
  };
}

// Cloudflare Email Address Obfuscation rewrites every mailto link at the edge: the anchor becomes an XOR-encoded
// /cdn-cgi/l/email-protection link and one decode script is inserted. Reverse exactly those two edits, nothing else,
// so the live page can still be compared byte for byte with the local build. Any other difference still fails.
const cfDecode = hex => { const bytes = Buffer.from(hex, 'hex'); return Buffer.from(bytes.subarray(1).map(byte => byte ^ bytes[0])).toString('utf8'); };
export function undoCloudflareEmailObfuscation(html) {
  return html
    .replace(/<a href="\/cdn-cgi\/l\/email-protection#((?:[0-9a-f]{2}){2,})"><span class="__cf_email__" data-cfemail="((?:[0-9a-f]{2}){2,})">\[email&#160;protected\]<\/span><\/a>/g,
      (_, href, text) => `<a href="mailto:${cfDecode(href)}">${cfDecode(text)}</a>`)
    .replace(/<script data-cfasync="false" src="\/cdn-cgi\/scripts\/[0-9a-f]+\/cloudflare-static\/email-decode\.min\.js"><\/script>/g, '');
}

// null when the deployed page is the page that was built and may be announced, otherwise a short reason.
async function livePageProblem(item, get) {
  const response = await get(item.url);
  if (response.status !== 200) return 'http_' + response.status;
  if (/noindex/i.test(response.headers.get('X-Robots-Tag') || '')) return 'noindex_header';
  if (!/text\/html/i.test(response.headers.get('Content-Type') || '')) return 'not_html';
  const html = undoCloudflareEmailObfuscation(await response.text());
  return indexableHtmlProblem(html, item.url) ?? (sha256(html) !== item.digest ? 'differs_from_build' : null);
}
const adhocFailure = (problem, url) => problem === 'differs_from_build' ? 'Live HTML differs from the selected local build. Deploy that build before submitting: ' + url
  : ['no_robots_meta', 'noindex_meta', 'canonical_mismatch'].includes(problem) ? 'URL is not an indexable canonical HTML page: ' + url
    : 'Live URL is not indexable HTML: ' + url;
async function mapLimit(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

// Explicit URLs: every live page must match the build or nothing is sent. Named set: pages that are missing,
// not 200, noindex or different from the build are skipped and reported; the rest go out in one POST.
export async function submitIndexNow(plan, { fetchImpl = fetch } = {}) {
  const named = plan.set != null;
  if (named) namedSet(plan.set);
  if (plan.payload.host !== new URL(INDEXNOW_ORIGIN).hostname
    || !/^[a-zA-Z0-9-]{8,128}$/.test(plan.payload.key)
    || plan.payload.keyLocation !== INDEXNOW_ORIGIN + '/' + plan.payload.key + '.txt'
    || plan.changed.length > (named ? INDEXNOW_SET_LIMIT : INDEXNOW_ADHOC_LIMIT) || JSON.stringify(plan.payload.urlList) !== JSON.stringify(plan.changed.map(item => item.url))
    || plan.changed.some(item => { const url = new URL(item.url); return url.origin !== INDEXNOW_ORIGIN || url.search || url.hash || !isIndexedRoute(url.pathname); })) {
    throw new Error('Invalid or out-of-scope IndexNow submission plan.');
  }
  if (!plan.changed.length) return { status: 'skipped_unchanged', submitted: 0, ...(named ? { urls: [], skipped: [] } : {}) };
  const get = url => fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const key = await get(plan.payload.keyLocation);
  if (key.status !== 200 || (await key.text()).trim() !== plan.payload.key) throw new Error('The deployed IndexNow key file is missing or does not match. Deploy first.');
  let urls = plan.payload.urlList, skipped = [];
  if (named) {
    // One unreachable or stale page must not hold back the rest of a bounded set; it is reported instead.
    const problems = await mapLimit(plan.changed, INDEXNOW_SET_CONCURRENCY, item => livePageProblem(item, get).catch(error => 'unreachable: ' + (error?.name ?? 'Error')));
    skipped = plan.changed.flatMap((item, index) => problems[index] ? [{ url: item.url, reason: problems[index] }] : []);
    urls = plan.changed.filter((item, index) => !problems[index]).map(item => item.url);
    if (!urls.length) return { status: 'skipped_unverified', submitted: 0, urls, skipped };
  } else {
    for (const item of plan.changed) {
      const problem = await livePageProblem(item, get);
      if (problem) throw new Error(adhocFailure(problem, item.url));
    }
  }
  const response = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify({ ...plan.payload, urlList: urls }),
  });
  if (![200, 202].includes(response.status)) throw new Error('IndexNow rejected the notification: HTTP ' + response.status);
  const result = { status: response.status === 200 ? 'received' : 'accepted_key_verification_pending', httpStatus: response.status, submitted: urls.length };
  return named ? { ...result, urls, skipped } : result;
}

// The accepted state after a run: only URLs that were actually sent are recorded, so a page a named set skipped
// (or deferred) is still pending for the next run.
export function recordAccepted(state, plan, result, at) {
  const sent = new Set(result.urls ?? plan.payload.urlList);
  const accepted = { ...(state?.accepted ?? {}) };
  if (result.submitted) {
    for (const item of plan.changed) if (sent.has(item.url)) accepted[item.url] = { digest: item.digest, key: plan.payload.key, at, httpStatus: result.httpStatus };
  }
  return { ...state, accepted };
}
