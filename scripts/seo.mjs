// Public indexing is separate from the full launch review and medical drafts.
export const NOINDEX_ROUTES = ['/questions/', '/find/', '/compare/', '/corrections/', '/verification/', '/privacy/', '/404/'];
export function isIndexableRoute(route) {
  return route === '/' || /^\/(?:reports|regions|clinics|data|methodology|guides|about|clinic-assets|search-sources)\/(?:[^?#]*)$/.test(route);
}
export function siteOrigin(value = 'https://dentaldatalab.com') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('SITE_ORIGIN must be an HTTPS origin without a path, credentials, query or fragment.');
  }
  return url.origin;
}
export function robotsMeta(route, enabled = false) {
  return enabled ? (isIndexableRoute(route) ? 'index,follow' : 'noindex,follow') : 'noindex,nofollow';
}
export function robotsText(origin, enabled = false) {
  return enabled
    ? `User-agent: *\nAllow: /\nDisallow: /data/cloudflare/\nSitemap: ${origin}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n# Private review build. Indexing is disabled intentionally.\n';
}
export function sitemapXml(routes, origin, enabled = false) {
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  // Build time and the HIRA snapshot are not modification dates of every page.
  const selected = enabled ? routes.filter(isIndexableRoute) : routes.filter(route => !['/find/', '/compare/', '/corrections/'].includes(route));
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + [...new Set(selected)].map(route => `<url><loc>${xml(origin + route)}</loc></url>`).join('') + '</urlset>';
}
