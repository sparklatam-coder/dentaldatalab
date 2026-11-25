// Public indexing is separate from the full launch review and medical drafts.
export const NOINDEX_ROUTES = ['/questions/', '/find/', '/compare/', '/corrections/', '/verification/', '/privacy/', '/404/'];
export function isIndexableRoute(route) {
  return route === '/' || /^\/(?:reports|regions|conditions|hospitals|clinics|data|methodology|guides|about|for-clinics|clinic-assets|search-sources)\/(?:[^?#]*)$/.test(route);
}
export function siteOrigin(value = 'https://dentaldatalab.com') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment.');
  }
  return url.origin;
}
// Indexable pages also allow full-length snippets and large image previews (the 1200×630 share cards).
export const INDEXABLE_ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1';
export function robotsMeta(route, enabled = false) {
  return enabled ? (isIndexableRoute(route) ? INDEXABLE_ROBOTS : 'noindex,follow') : 'noindex,nofollow';
}
export function robotsText(origin, enabled = false) {
  return enabled
    ? `User-agent: *\nAllow: /\nDisallow: /data/cloudflare/\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n# Private review build. Indexing is disabled intentionally.\n';
}
const xmlText = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const sitemapRoutes = (routes, enabled) => [...new Set(enabled ? routes.filter(isIndexableRoute) : routes.filter(route => !['/find/', '/compare/', '/corrections/'].includes(route)))];
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
