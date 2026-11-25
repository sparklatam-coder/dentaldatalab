import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  prepareIndexNow, submitIndexNow, recordAccepted, indexNowSetRoutes, indexNowSetHubRoute,
  INDEXNOW_ORIGIN, INDEXNOW_ENDPOINT, INDEXNOW_SETS, INDEXNOW_SET_LIMIT, INDEXNOW_SET_CONCURRENCY, INDEXNOW_ADHOC_LIMIT,
} from '../scripts/indexnow.mjs';
import { isIndexableRoute, setNoindexRoutes, SEO_INDEXING_FILE } from '../scripts/seo.mjs';

// Every submitIndexNow call below gets a mock fetchImpl and the CLI is only ever run as a dry run: no test touches the network.
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const institution = (kind, index) => 'c-' + (kind * 0x1000000 + index).toString(16).padStart(12, '0');
const route = id => '/clinics/' + id + '/';
const url = value => INDEXNOW_ORIGIN + value;
const pageHtml = (value, robots = 'index,follow') => `<html><meta name="robots" content="${robots}"><link rel="canonical" href="${url(value)}"><h1>${value}</h1></html>`;
const HUBS = ['/', '/data/', '/data/open/', '/press/', '/for-clinics/', '/conditions/', '/conditions/night/', '/hospitals/', '/hospitals/110000/', '/hospitals/university/', '/reports/', '/reports/dental-hospitals/', '/guides/', '/guides/reading-data/'];
const NOT_IN_SET = ['/conditions/night/extra/', '/regions/', '/regions/110000/', '/regions/110000/110110/night/', '/methodology/', '/clinic-assets/', '/questions/'];

function fixture(t, { hospitals = 3, clinics = 2, omitFromManifest = [], omitFromSitemap = [], noindexRoutes = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-indexnow-set-'));
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); setNoindexRoutes([]); });
  const directory = path.join(root, 'dist');
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const key = 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb';
  write(path.join(root, 'data/content/indexnow-key.txt'), key + '\n');
  const hospitalIds = Array.from({ length: hospitals }, (_, index) => institution(0x41, index));
  const clinicIds = Array.from({ length: clinics }, (_, index) => institution(0x51, index));
  const data = { clinics: [...clinicIds.map(id => ({ id, typeCode: '51' })), ...hospitalIds.toReversed().map(id => ({ id, typeCode: '41' }))] };
  const writeData = () => {
    write(path.join(root, 'data/clinics.json'), JSON.stringify(data));
    return sha256(fs.readFileSync(path.join(root, 'data/clinics.json')));
  };
  const all = [...HUBS, ...NOT_IN_SET, ...clinicIds.map(route), ...hospitalIds.map(route)];
  const routes = all.filter(value => !omitFromManifest.includes(value));
  const manifest = { indexingEnabled: true, domain: INDEXNOW_ORIGIN, routes, sourceDataSha256: writeData() };
  const writeManifest = () => write(path.join(directory, 'build-manifest.json'), JSON.stringify(manifest));
  writeManifest();
  // The sitemap is independent of the manifest here, so each intersection is exercised on its own.
  write(path.join(directory, 'sitemap.xml'), '<urlset>' + all.filter(value => !omitFromSitemap.includes(value)).map(value => `<url><loc>${url(value)}</loc></url>`).join('') + '</urlset>');
  if (noindexRoutes) write(path.join(directory, SEO_INDEXING_FILE), JSON.stringify({ policy: 'noindex', noindexRoutes }));
  const pages = {};
  for (const value of routes) {
    pages[url(value)] = pageHtml(value);
    write(path.join(directory, value === '/' ? 'index.html' : value.slice(1) + 'index.html'), pages[url(value)]);
  }
  return { root, directory, key, pages, hospitalIds, clinicIds, data, manifest, writeData, writeManifest, write };
}
const planned = plan => plan.selected.map(item => item.url);
// A deployed site that serves exactly the local build, except for the URLs named in `live`.
function site(f, plan, live = {}, { endpointStatus = 200, key = f.key } = {}) {
  const calls = { get: [], post: [], inFlight: 0, maxInFlight: 0 };
  const fetchImpl = async (target, options = {}) => {
    if (target === INDEXNOW_ENDPOINT) { calls.post.push(JSON.parse(options.body)); return new Response('', { status: endpointStatus }); }
    if (target === plan.payload.keyLocation) return new Response(key);
    calls.get.push(target);
    calls.maxInFlight = Math.max(calls.maxInFlight, ++calls.inFlight);
    try {
      await new Promise(resolve => setTimeout(resolve, 2));
      const override = live[target];
      if (override instanceof Error) throw override;
      if (override) return override();
      return new Response(f.pages[target], { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } finally { calls.inFlight--; }
  };
  return { calls, fetchImpl };
}
const html = (body, headers = {}) => () => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });

test('the hospitals set takes hub pages by path: sections in full, conditions at hub level only', () => {
  assert.deepEqual(Object.keys(INDEXNOW_SETS), ['hospitals']);
  for (const value of [...HUBS, '/reports/yangju-hours-evidence/', '/hospitals/disability/', '/guides/dental-hospital-30-beds/', '/conditions/saturday/', '/conditions/specialist/']) {
    assert.equal(indexNowSetHubRoute('hospitals', value), true, value);
  }
  for (const value of [...NOT_IN_SET, '/conditions', '/conditions/night/110000/', '/regions/110000/110110/saturday/', '/for-clinics/pricing/', '/data/search-status/', '/data/quality/', '/press/2026/', '/about/', '/find/']) {
    assert.equal(indexNowSetHubRoute('hospitals', value), false, value);
  }
  assert.throws(() => indexNowSetHubRoute('clinics', '/'), /Unknown IndexNow set/);
});

test('a named set is every 치과병원 profile plus its hubs, intersected with the manifest, the sitemap and indexed routes', t => {
  const f = fixture(t);
  const plan = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' });
  // Fixed routes first, then hubs in manifest order, then profiles by id. Whether a section is public is seo.mjs's
  // decision, so the expectation follows isIndexableRoute instead of repeating its list.
  const expected = [...HUBS.filter(isIndexableRoute), ...f.hospitalIds.map(route)].map(url);
  assert.deepEqual(planned(plan), expected);
  assert.equal(plan.set, 'hospitals');
  assert.deepEqual(plan.payload.urlList, expected);
  assert.deepEqual(plan.deferred, []);
  for (const always of ['/', '/data/', '/data/open/', '/hospitals/', '/hospitals/110000/', '/reports/dental-hospitals/', '/guides/reading-data/', ...f.hospitalIds.map(route)]) assert(planned(plan).includes(url(always)), always);
  for (const never of [...NOT_IN_SET, ...f.clinicIds.map(route)]) assert(!planned(plan).includes(url(never)), never);

  // Not built, not in the sitemap, or demoted by the build: each drops out without failing the run.
  const [first, second, third] = f.hospitalIds.map(route);
  const narrowed = fixture(t, { omitFromManifest: ['/data/open/', first], omitFromSitemap: ['/hospitals/110000/', second], noindexRoutes: [third] });
  const kept = planned(prepareIndexNow({ root: narrowed.root, directory: narrowed.directory, set: 'hospitals' }));
  assert.deepEqual(kept, HUBS.filter(isIndexableRoute).filter(value => !['/data/open/', '/hospitals/110000/'].includes(value)).map(url));
});

test('a 치과의원 profile can never enter a named set', t => {
  const f = fixture(t, { hospitals: 2, clinics: 3 });
  // The 치과의원 pages are built, listed in the sitemap, indexable and say index,follow; they are still not selected.
  for (const id of f.clinicIds) assert.equal(prepareIndexNow({ root: f.root, directory: f.directory, urls: [url(route(id))] }).changed.length, 1, 'still allowed as an explicit URL');
  const selected = planned(prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' }));
  assert.deepEqual(selected.filter(value => value.includes('/clinics/')), f.hospitalIds.map(id => url(route(id))));

  // Institution type comes from data/clinics.json alone: an id that is a 치과의원 there is not selected, whatever the build contains.
  const sitemap = fs.readFileSync(path.join(f.directory, 'sitemap.xml'), 'utf8');
  const everyone51 = f.data.clinics.map(clinic => ({ ...clinic, typeCode: '51' }));
  assert.deepEqual(indexNowSetRoutes('hospitals', { clinics: everyone51, routes: f.manifest.routes, sitemap }).filter(value => value.startsWith('/clinics/')), []);
  assert.deepEqual(indexNowSetRoutes('hospitals', { clinics: [], routes: f.manifest.routes, sitemap }).filter(value => value.startsWith('/clinics/')), []);

  // Reclassifying an institution without rebuilding is refused; after a matching build it is simply gone from the set.
  f.data.clinics.find(clinic => clinic.id === f.hospitalIds[0]).typeCode = '51';
  const hash = f.writeData();
  assert.throws(() => prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' }), /not made from the current data\/clinics\.json/);
  f.manifest.sourceDataSha256 = hash;
  f.writeManifest();
  const after = planned(prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' }));
  assert.deepEqual(after.filter(value => value.includes('/clinics/')), [url(route(f.hospitalIds[1]))]);
});

test('named sets and explicit URLs are separate modes with their own limits', t => {
  const f = fixture(t);
  assert.equal(INDEXNOW_ADHOC_LIMIT, 8);
  assert.equal(INDEXNOW_SET_LIMIT, 500);
  assert(INDEXNOW_SET_CONCURRENCY >= 1 && INDEXNOW_SET_CONCURRENCY <= 4);
  assert.throws(() => prepareIndexNow({ root: f.root, directory: f.directory, set: 'clinics' }), /Unknown IndexNow set/);
  assert.throws(() => prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals', urls: [url('/')] }), /not both/);
  // Explicit URLs keep the 8-URL cap even though the same pages would fit in a set.
  const nine = [...HUBS.filter(isIndexableRoute), ...f.hospitalIds.map(route)].slice(0, 9).map(url);
  assert.equal(nine.length, 9);
  assert.throws(() => prepareIndexNow({ root: f.root, directory: f.directory, urls: nine }), /1–8 explicitly selected/);
  assert.equal(prepareIndexNow({ root: f.root, directory: f.directory, urls: nine.slice(0, 8) }).set, null);
});

test('a named set skips live pages that are missing, not 200, noindex or different, and still sends the rest in one POST', async t => {
  const f = fixture(t, { hospitals: 9 });
  const plan = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' });
  const [missing, redirected, changed, metaNoindex, headerNoindex, unreachable, json, wrongCanonical] = f.hospitalIds.map(id => url(route(id)));
  const local = target => f.pages[target];
  const live = {
    [missing]: () => new Response('<html>없음</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }),
    [redirected]: () => new Response(null, { status: 301, headers: { Location: url('/') } }),
    [changed]: html(local(changed).replace('</h1>', ' (이전 배포)</h1>')),
    [metaNoindex]: html(local(metaNoindex).replace('index,follow', 'noindex,follow')),
    [headerNoindex]: html(local(headerNoindex), { 'X-Robots-Tag': 'noindex, nofollow' }),
    [unreachable]: new TypeError('fetch failed'),
    [json]: () => new Response(local(json), { headers: { 'Content-Type': 'application/json' } }),
    [wrongCanonical]: html(local(wrongCanonical).replace(wrongCanonical, url('/hospitals/'))),
  };
  const expectedSkips = [
    { url: missing, reason: 'http_404' }, { url: redirected, reason: 'http_301' }, { url: changed, reason: 'differs_from_build' },
    { url: metaNoindex, reason: 'noindex_meta' }, { url: headerNoindex, reason: 'noindex_header' }, { url: unreachable, reason: 'unreachable: TypeError' },
    { url: json, reason: 'not_html' }, { url: wrongCanonical, reason: 'canonical_mismatch' },
  ];
  const sent = plan.payload.urlList.filter(value => !Object.hasOwn(live, value));
  const { calls, fetchImpl } = site(f, plan, live);
  const result = await submitIndexNow(plan, { fetchImpl });
  assert.deepEqual(result, { status: 'received', httpStatus: 200, submitted: sent.length, urls: sent, skipped: expectedSkips });
  assert.equal(calls.post.length, 1, 'one POST for the whole set');
  assert.deepEqual(calls.post[0], { ...plan.payload, urlList: sent });
  assert.equal(calls.get.length, plan.changed.length, 'each page is read once, with no retry');
  assert(calls.maxInFlight >= 2 && calls.maxInFlight <= 4, 'live checks run with modest concurrency: ' + calls.maxInFlight);
  assert(sent.includes(url(route(f.hospitalIds[8]))) && sent.includes(url('/hospitals/')));

  // Only what was sent is recorded: the skipped pages are the whole next run.
  const state = recordAccepted({ accepted: {} }, plan, result, '2026-11-26T00:00:00.000Z');
  assert.deepEqual(Object.keys(state.accepted), sent);
  assert.deepEqual(state.accepted[sent[0]], { digest: plan.changed[0].digest, key: f.key, at: '2026-11-26T00:00:00.000Z', httpStatus: 200 });
  const next = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals', state });
  assert.deepEqual(next.payload.urlList, expectedSkips.map(item => item.url));
  assert.equal(next.selected.filter(item => item.unchanged).length, sent.length);

  // The same live site aborts an explicit-URL run instead: nothing is sent.
  const adhoc = prepareIndexNow({ root: f.root, directory: f.directory, urls: [url('/'), changed] });
  const strict = site(f, adhoc, live);
  await assert.rejects(submitIndexNow(adhoc, { fetchImpl: strict.fetchImpl }), /Live HTML differs/);
  assert.equal(strict.calls.post.length, 0);
});

test('a named set sends nothing when no page verifies, when the key is not deployed, or when the endpoint refuses', async t => {
  const f = fixture(t, { hospitals: 2 });
  const plan = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' });
  const stale = Object.fromEntries(plan.payload.urlList.map(value => [value, html(f.pages[value] + '<!-- older deploy -->')]));
  const none = site(f, plan, stale);
  const result = await submitIndexNow(plan, { fetchImpl: none.fetchImpl });
  assert.equal(result.status, 'skipped_unverified');
  assert.equal(result.submitted, 0);
  assert.deepEqual(result.urls, []);
  assert.deepEqual(result.skipped, plan.payload.urlList.map(value => ({ url: value, reason: 'differs_from_build' })));
  assert.equal(none.calls.post.length, 0);
  assert.deepEqual(recordAccepted({ accepted: {} }, plan, result, 'now').accepted, {});

  const wrongKey = site(f, plan, {}, { key: 'another-key-0000' });
  await assert.rejects(submitIndexNow(plan, { fetchImpl: wrongKey.fetchImpl }), /key file is missing or does not match/);
  assert.deepEqual([wrongKey.calls.get.length, wrongKey.calls.post.length], [0, 0], 'no page is read and nothing is sent without the key');

  for (const endpointStatus of [400, 403, 422, 429, 500]) {
    const refused = site(f, plan, {}, { endpointStatus });
    await assert.rejects(submitIndexNow(plan, { fetchImpl: refused.fetchImpl }), new RegExp('HTTP ' + endpointStatus));
    assert.equal(refused.calls.post.length, 1, 'no automatic retry after HTTP ' + endpointStatus);
  }
  const pending = site(f, plan, {}, { endpointStatus: 202 });
  assert.equal((await submitIndexNow(plan, { fetchImpl: pending.fetchImpl })).status, 'accepted_key_verification_pending');

  // Everything already accepted and unchanged: no request at all.
  const accepted = recordAccepted({ accepted: {} }, plan, { status: 'received', httpStatus: 200, submitted: plan.changed.length, urls: plan.payload.urlList, skipped: [] }, 'now');
  const unchanged = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals', state: accepted });
  const idle = site(f, unchanged);
  assert.deepEqual(await submitIndexNow(unchanged, { fetchImpl: idle.fetchImpl }), { status: 'skipped_unchanged', submitted: 0, urls: [], skipped: [] });
  assert.deepEqual([idle.calls.get.length, idle.calls.post.length], [0, 0]);
});

test('one named-set run is capped at 500 URLs; the remainder is deferred to the next run', async t => {
  const f = fixture(t, { hospitals: 520, clinics: 1 });
  const hubs = HUBS.filter(isIndexableRoute).length;
  const plan = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals' });
  assert.equal(plan.selected.length, hubs + 520);
  assert.equal(plan.changed.length, 500);
  assert.equal(plan.payload.urlList.length, 500);
  assert.equal(plan.deferred.length, hubs + 520 - 500);
  assert.deepEqual(planned(plan), [...plan.payload.urlList, ...plan.deferred.map(item => item.url)], 'hub pages and the first profiles go first');

  const first = site(f, plan);
  const result = await submitIndexNow(plan, { fetchImpl: first.fetchImpl });
  assert.equal(result.submitted, 500);
  assert.equal(first.calls.post.length, 1);
  assert.equal(first.calls.post[0].urlList.length, 500);
  assert.equal(first.calls.get.length, 500, 'deferred pages are not even requested');
  assert(first.calls.maxInFlight <= 4);

  const state = recordAccepted({ accepted: {} }, plan, result, 'now');
  const second = prepareIndexNow({ root: f.root, directory: f.directory, set: 'hospitals', state });
  assert.deepEqual(second.payload.urlList, plan.deferred.map(item => item.url));
  assert.deepEqual(second.deferred, []);

  // The sender enforces the same bounds on any plan it is handed.
  const oversized = { ...plan, changed: [...plan.changed, plan.deferred[0]], payload: { ...plan.payload, urlList: [...plan.payload.urlList, plan.deferred[0].url] } };
  const refused = site(f, plan);
  await assert.rejects(submitIndexNow(oversized, { fetchImpl: refused.fetchImpl }), /Invalid or out-of-scope/);
  await assert.rejects(submitIndexNow({ ...plan, set: null }, { fetchImpl: refused.fetchImpl }), /Invalid or out-of-scope/, 'a set-sized plan cannot pass as explicit URLs');
  await assert.rejects(submitIndexNow({ ...plan, set: 'clinics' }, { fetchImpl: refused.fetchImpl }), /Unknown IndexNow set/);
  assert.deepEqual([refused.calls.get.length, refused.calls.post.length], [0, 0]);
});

test('IndexNow follows the build\'s own index record: a demoted 치과의원 page is outside the allowlist', async t => {
  const f = fixture(t, { clinics: 2 });
  const [thin, full] = f.clinicIds.map(id => url(route(id)));
  assert.equal(prepareIndexNow({ root: f.root, directory: f.directory, urls: [thin, full] }).changed.length, 2);
  // The build demoted one page. Even a stale copy of its HTML that still says index,follow is refused.
  f.write(path.join(f.directory, SEO_INDEXING_FILE), JSON.stringify({ policy: 'noindex', noindexRoutes: [route(f.clinicIds[0])] }));
  assert.throws(() => prepareIndexNow({ root: f.root, directory: f.directory, urls: [thin] }), /outside the public canonical allowlist/);
  const plan = prepareIndexNow({ root: f.root, directory: f.directory, urls: [full] });
  assert.deepEqual(plan.payload.urlList, [full]);
  // A plan made before the demotion cannot be sent after it.
  const stale = { ...plan, changed: [{ url: thin, digest: 'x' }], payload: { ...plan.payload, urlList: [thin] } };
  await assert.rejects(submitIndexNow(stale, { fetchImpl: site(f, plan).fetchImpl }), /Invalid or out-of-scope/);
  // The registry belongs to the directory being read: another build without the record demotes nothing.
  const other = fixture(t, { clinics: 2 });
  assert.equal(prepareIndexNow({ root: other.root, directory: other.directory, urls: other.clinicIds.map(id => url(route(id))) }).changed.length, 2);
});

test('the CLI plans a named set as a dry run by default and writes nothing', t => {
  // The CLI reads the repository's own data file, so this fixture is a build of two real 치과병원 and one real 치과의원.
  const source = fs.readFileSync(path.resolve('data/clinics.json'));
  const clinics = JSON.parse(source.toString('utf8')).clinics;
  const hospitals = clinics.filter(clinic => clinic.typeCode === '41').slice(0, 2).map(clinic => route(clinic.id));
  const clinic = route(clinics.find(item => item.typeCode === '51').id);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-indexnow-cli-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); };
  const routes = ['/', '/hospitals/', '/reports/', '/regions/', clinic, ...hospitals];
  write(path.join(directory, 'build-manifest.json'), JSON.stringify({ indexingEnabled: true, domain: INDEXNOW_ORIGIN, routes, sourceDataSha256: sha256(source) }));
  write(path.join(directory, 'sitemap.xml'), routes.map(value => `<url><loc>${url(value)}</loc></url>`).join(''));
  for (const value of routes) write(path.join(directory, value === '/' ? 'index.html' : value.slice(1) + 'index.html'), pageHtml(value));
  const logs = path.resolve('data/research/indexnow');
  const snapshot = () => fs.existsSync(logs) ? fs.readdirSync(logs).sort().map(name => [name, fs.statSync(path.join(logs, name)).size]) : null;
  const before = snapshot();
  const cli = (...args) => spawnSync(process.execPath, ['scripts/submit-indexnow.mjs', '--dist', directory, ...args], { cwd: process.cwd(), encoding: 'utf8' });

  const run = cli('--set', 'hospitals');
  assert.equal(run.status, 0, run.stderr);
  const output = JSON.parse(run.stdout);
  assert.equal(output.mode, 'dry-run');
  assert.equal(output.set, 'hospitals');
  assert.deepEqual(output.urls, ['/', '/hospitals/', '/reports/', ...hospitals.toSorted()].map(url));
  assert.deepEqual([output.selected, output.unchanged, output.toSubmit, output.deferred.length], [5, 0, 5, 0]);
  assert(!run.stdout.includes(clinic));

  assert.notEqual(cli('--set', 'hospitals', '--url', url('/')).status, 0);
  const unknown = cli('--set', 'everything');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown IndexNow set/);
  assert.match(cli('--help').stdout, /--set/);
  assert.deepEqual(snapshot(), before, 'a dry run leaves the state, log and lock files alone');
});
