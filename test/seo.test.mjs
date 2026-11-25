import test from 'node:test';
import assert from 'node:assert/strict';
import { siteOrigin, robotsMeta, robotsText, sitemapXml, sitemapFiles, sitemapLocs, INDEXABLE_ROBOTS, SITEMAP_CHUNK } from '../scripts/seo.mjs';
import { cloudflareWorker } from '../scripts/build-cloudflare.mjs';

test('public indexing exposes source-backed pages while keeping drafts and interactive tools out', () => {
  for (const route of ['/', '/clinics/c-abc123456789/', '/regions/110000/page/2/', '/hospitals/', '/hospitals/110000/', '/hospitals/university/', '/reports/national-data-coverage/', '/data/', '/clinic-assets/', '/search-sources/']) {
    assert.equal(robotsMeta(route, true), INDEXABLE_ROBOTS, route);
    assert.match(robotsMeta(route, true), /^index,follow,.*max-image-preview:large/, route);
    assert.equal(robotsMeta(route), 'noindex,nofollow', route);
  }
  for (const route of ['/questions/', '/find/', '/compare/', '/corrections/', '/verification/', '/privacy/', '/404/', '/unknown/']) {
    assert.equal(robotsMeta(route, true), 'noindex,follow', route);
  }
  const robots = robotsText('https://example.test', true);
  assert.match(robots, /Allow: \/\n/);
  assert.match(robots, /Sitemap: https:\/\/example.test\/sitemap.xml/);
  // A crawler must be allowed to read noindex on medical drafts.
  assert.doesNotMatch(robots, /Disallow: \/questions/);
  assert.match(robotsText('https://example.test'), /Disallow: \/\n/);
  const sitemap = sitemapXml(['/', '/clinics/c-abc123456789/', '/questions/', '/find/', '/', '/404/'], 'https://example.test', true);
  assert.equal((sitemap.match(/<url>/g) || []).length, 2);
  assert.doesNotMatch(sitemap, /questions|find|404|lastmod/);
});

test('the public sitemap is an index of per-type files; every indexable route appears exactly once', () => {
  const clinics = Array.from({ length: SITEMAP_CHUNK + 5 }, (_, i) => `/clinics/c-${i.toString(16).padStart(12, '0')}/`);
  const routes = ['/', '/reports/', '/regions/', '/regions/110000/', '/conditions/', '/hospitals/110000/', '/guides/a/', '/find/', '/questions/', ...clinics, '/'];
  const files = sitemapFiles(routes, 'https://example.test', true);
  assert.deepEqual(Object.keys(files), ['sitemap-pages.xml', 'sitemap-regions.xml', 'sitemap-clinics-1.xml', 'sitemap-clinics-2.xml', 'sitemap.xml']);
  assert.match(files['sitemap.xml'], /^<\?xml[^>]+\?><sitemapindex /);
  assert.equal((files['sitemap-clinics-1.xml'].match(/<url>/g) || []).length, SITEMAP_CHUNK);
  const locs = sitemapLocs(name => files[name]);
  assert.equal(locs.length, new Set(locs).size);
  assert.deepEqual(locs.map(u => new URL(u).pathname).sort(), [...new Set(routes)].filter(r => !['/find/', '/questions/'].includes(r)).sort());
  // Review builds keep one urlset (nothing is submitted anywhere).
  const review = sitemapFiles(routes, 'https://example.test');
  assert.deepEqual(Object.keys(review), ['sitemap.xml']);
  assert.match(review['sitemap.xml'], /<urlset /);
  assert.equal(sitemapLocs(name => review[name]).length, sitemapXml(routes, 'https://example.test').match(/<url>/g).length);
});

test('canonical origin rejects URL components that would corrupt all canonical and sitemap URLs', () => {
  assert.equal(siteOrigin('https://dentaldatalab.com/'), 'https://dentaldatalab.com');
  assert.equal(siteOrigin(), 'https://dentaldatalab.com');
  for (const value of ['http://example.test', 'https://example.test/path', 'https://user:pass@example.test', 'https://example.test/?a=b', 'https://example.test/#section', 'not a URL']) {
    assert.throws(() => siteOrigin(value), undefined, value);
  }
});

test('public compact Worker allows indexing clinic HTML while evidence and missing pages retain noindex', async () => {
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(cloudflareWorker({ review: false })).toString('base64'))).default;
  const env = { ASSETS: { async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/404.html') return new Response('<html>missing</html>');
    return new Response(JSON.stringify({ 'c-abc123456789': url.pathname.includes('/html/') ? '<html>clinic</html>' : '{"clinicId":"c-abc123456789"}' }));
  } } };
  const get = route => worker.fetch(new Request('https://example.test' + route), env);
  const clinic = await get('/clinics/c-abc123456789/');
  assert.equal(clinic.status, 200);
  assert.equal(clinic.headers.get('X-Robots-Tag'), null);
  assert.equal(await clinic.text(), '<html>clinic</html>');
  const record = await get('/data/clinic-assets/records/c-abc123456789.json');
  assert.equal(record.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const missing = await get('/clinics/c-abc000000000/');
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('X-Robots-Tag'), 'noindex, follow');
});

test('only the primary Pages hostname redirects, preserving path/query while preview remains readable and noindex', async () => {
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(cloudflareWorker({ review: false, canonicalOrigin: 'https://dentaldatalab.com', pagesHost: 'dentaldatalab.pages.dev' })).toString('base64'))).default;
  let assetRequests = 0;
  const env = { ASSETS: { async fetch() {
    assetRequests++;
    return new Response(JSON.stringify({ 'c-abc123456789': '<html>clinic</html>' }));
  } } };
  const route = '/clinics/c-abc123456789/?source=naver&lang=ko';
  const redirect = await worker.fetch(new Request('https://dentaldatalab.pages.dev' + route), env);
  assert.equal(redirect.status, 301);
  assert.equal(redirect.headers.get('Location'), 'https://dentaldatalab.com' + route);
  assert.equal(assetRequests, 0);
  const preview = await worker.fetch(new Request('https://hash123.dentaldatalab.pages.dev' + route), env);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('Location'), null);
  assert.equal(preview.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const primary = await worker.fetch(new Request('https://dentaldatalab.com' + route), env);
  assert.equal(primary.status, 200);
  assert.equal(primary.headers.get('X-Robots-Tag'), null);
  const unusual = await worker.fetch(new Request('https://dentaldatalab.pages.dev//evil.example/path?keep=1'), env);
  assert.equal(unusual.headers.get('Location'), 'https://dentaldatalab.com//evil.example/path?keep=1');
});
