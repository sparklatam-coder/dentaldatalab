import fs from 'node:fs';
import path from 'node:path';

// Public indexing is separate from the full launch review and medical drafts.
export const NOINDEX_ROUTES = ['/questions/', '/find/', '/compare/', '/corrections/', '/verification/', '/privacy/', '/404/'];
export function isIndexableRoute(route) {
  return route === '/' || /^\/(?:press|reports|regions|conditions|hospitals|clinics|data|methodology|guides|about|for-clinics|clinic-assets|search-sources)\/(?:[^?#]*)$/.test(route);
}
export function siteOrigin(value = 'https://dentaldatalab.com') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment.');
  }
  return url.origin;
}

// ---- Thin 치과의원 pages: a switchable index tier -------------------------------------------------------------
// 'noindex' 치과의원 pages in the 'basic' tier render noindex,follow and are left out of sitemap.xml. They are still
//           built and crawlable, so every link to them from district and condition pages keeps working.
// 'index'   every institution page is indexed and listed; no output differs from a build without this policy.
// Switching is this one word, and it is reversible by switching back and redeploying.
export const THIN_CLINIC_POLICIES = Object.freeze(['index', 'noindex']);
export const THIN_CLINIC_POLICY = 'noindex';

// What an institution page shows beyond name, address, phone, 개설일 and the registry's zero rows.
export function clinicIndexSignals(clinic, { assetRecord = null, naverStage = null } = {}) {
  return {
    // (a) a valid registered start/end pair, or hours read from the institution's matched Naver place
    hours: clinic?.quality?.hoursAvailable === true || naverStage === 'hours_available',
    // (b) at least one registered 치과전문의; null (자료 미확인) is not a signal
    specialist: Number.isFinite(clinic?.doctors?.specialist) && clinic.doctors.specialist >= 1,
    // (c) a channel shown as a live link: body-matched (official) or linked from the institution's own page
    confirmedAsset: (assetRecord?.assets ?? []).some(asset => ['official', 'linked'].includes(asset.ownership) && asset.linkable !== false),
    // (d) a Naver place observation stored for this institution; the page renders every stored observation
    naverPlace: (assetRecord?.naverPlaceObservations ?? []).length > 0,
  };
}
// Only a 치과의원 (typeCode 51) can be 'basic'. A 치과병원 (41), or any record this rule does not know, is 'full'.
export function clinicIndexTier(clinic, context = {}) {
  if (clinic?.typeCode !== '51') return 'full';
  return Object.values(clinicIndexSignals(clinic, context)).some(Boolean) ? 'full' : 'basic';
}
// Pure: tier every institution and list the routes the given policy demotes. assetRecords maps clinic id to its
// asset-inventory record, naverStages maps clinic id to its Naver hours coverage stage.
export function thinClinicPlan(clinics, { assetRecords = new Map(), naverStages = new Map(), policy = THIN_CLINIC_POLICY } = {}) {
  if (!THIN_CLINIC_POLICIES.includes(policy)) throw new Error('Unknown THIN_CLINIC_POLICY: ' + policy);
  const tiers = { 41: { full: 0, basic: 0 }, 51: { full: 0, basic: 0 } };
  const signals = { hours: 0, specialist: 0, confirmedAsset: 0, naverPlace: 0 }, basic = [];
  for (const clinic of clinics) {
    const context = { assetRecord: assetRecords.get(clinic.id), naverStage: naverStages.get(clinic.id) };
    const tier = clinicIndexTier(clinic, context);
    (tiers[clinic.typeCode] ??= { full: 0, basic: 0 })[tier]++;
    if (clinic.typeCode !== '51') continue;
    for (const [name, present] of Object.entries(clinicIndexSignals(clinic, context))) if (present) signals[name]++;
    if (tier === 'basic') basic.push('/clinics/' + clinic.id + '/');
  }
  // signals: how many 치과의원 pages carry each signal (a page can carry several).
  return { schemaVersion: 1, policy, tiers, signals, noindexRoutes: policy === 'noindex' ? basic.sort() : [] };
}

// Per-route demotions, same pattern as setSnapshot in src/shared.mjs: the build fills this once before rendering
// and records the list in seo-indexing.json; qa.mjs and indexnow.mjs prime it again from that file.
// isIndexableRoute is the section rule. Whether one URL is indexed is isIndexedRoute: use it for every decision.
const INSTITUTION_ROUTE = /^\/clinics\/c-[a-f0-9]{12}\/$/;
let noindexRoutes = new Set();
export function setNoindexRoutes(routes = []) {
  const next = new Set(routes);
  for (const route of next) {
    if (typeof route !== 'string' || !INSTITUTION_ROUTE.test(route)) throw new Error('Only institution profile routes can be demoted to noindex: ' + route);
  }
  noindexRoutes = next;
  return next.size;
}
export function isIndexedRoute(route) {
  return isIndexableRoute(route) && !noindexRoutes.has(route);
}
// Read the record a build left at its root and prime the registry from it, so a later reader of that directory
// expects exactly what the build rendered. A directory built before the record existed has no demotions.
export const SEO_INDEXING_FILE = 'seo-indexing.json';
export function primeSeoIndexing(directory) {
  const file = path.join(directory, SEO_INDEXING_FILE);
  const record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (record && (!THIN_CLINIC_POLICIES.includes(record.policy) || !Array.isArray(record.noindexRoutes))) throw new Error('Unrecognized ' + SEO_INDEXING_FILE + ' in ' + directory);
  setNoindexRoutes(record?.noindexRoutes ?? []);
  return record;
}

// Indexable pages also allow full-length snippets and large image previews (the 1200×630 share cards).
export const INDEXABLE_ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1';
export function robotsMeta(route, enabled = false) {
  return enabled ? (isIndexedRoute(route) ? INDEXABLE_ROBOTS : 'noindex,follow') : 'noindex,nofollow';
}
export function robotsText(origin, enabled = false) {
  return enabled
    ? `User-agent: *\nAllow: /\nDisallow: /data/cloudflare/\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n# Private review build. Indexing is disabled intentionally.\n';
}
const xmlText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
// A demoted route (setNoindexRoutes) is never advertised, in either mode. With no demotions the selection is unchanged.
// Review builds list every route except the interactive tools.
export const REVIEW_SITEMAP_EXCLUDED = Object.freeze(['/find/', '/compare/', '/corrections/']);
export const sitemapRoutes = (routes, enabled) => [...new Set(enabled ? routes.filter(isIndexableRoute) : routes.filter(route => !REVIEW_SITEMAP_EXCLUDED.includes(route)))].filter(route => !noindexRoutes.has(route));
const urlset = (routes, origin) => '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  + routes.map(route => `<url><loc>${xmlText(origin + route)}</loc></url>`).join('') + '</urlset>';
export function sitemapXml(routes, origin, enabled = false) {
  // Build time and the HIRA snapshot are not modification dates of every page.
  return urlset(sitemapRoutes(routes, enabled), origin);
}
export const SITEMAP_CHUNK = 10000;
export const sitemapGroup = route => route.startsWith('/clinics/') ? 'clinics' : /^\/(?:regions|conditions|hospitals)\//.test(route) ? 'regions' : 'pages';
/**
 * Public builds: sitemap.xml becomes an index over one file per page type (clinic files split at 10,000 URLs),
 * so search consoles report indexing per type. Review builds keep a single urlset. Returns {fileName: xml}.
 */
export function sitemapFiles(routes, origin, enabled = false) {
  const selected = sitemapRoutes(routes, enabled);
  if (!enabled) return { 'sitemap.xml': urlset(selected, origin) };
  const files = {};
  for (const group of ['pages', 'regions', 'clinics']) {
    const list = selected.filter(route => sitemapGroup(route) === group);
    for (let i = 0; i < list.length; i += SITEMAP_CHUNK) files[`sitemap-${group}${list.length > SITEMAP_CHUNK ? '-' + (i / SITEMAP_CHUNK + 1) : ''}.xml`] = urlset(list.slice(i, i + SITEMAP_CHUNK), origin);
  }
  files['sitemap.xml'] = '<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + Object.keys(files).map(name => `<sitemap><loc>${xmlText(origin + '/' + name)}</loc></sitemap>`).join('') + '</sitemapindex>';
  return files;
}
/** Every <loc> in a built sitemap, following a sitemap index one level down. */
export function sitemapLocs(readFile) {
  const locs = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1].replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&amp;', '&'));
  const root = readFile('sitemap.xml');
  if (!root.includes('<sitemapindex')) return locs(root);
  return locs(root).flatMap(loc => locs(readFile(new URL(loc).pathname.slice(1))));
}
