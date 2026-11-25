import test from 'node:test';
import { CONTENT_SECURITY_POLICY } from '../scripts/security-headers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { compactForCloudflare } from '../scripts/build-cloudflare.mjs';

test('Pages compact output serves original clinic HTML and evidence JSON at existing URLs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-pages-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  };
  const rows = [
    ['c-abc123456789', '<html><title>한글 치과</title><p>소개 "&amp;"</p></html>', '{"description":"예약\\n안내"}'],
    ['c-abc987654321', '<html>두 번째 기관</html>', '{"assets":[]}'],
    ['c-def123456789', '<html>다른 묶음</html>', '{"hours":null}'],
  ];
  write('build-manifest.json', JSON.stringify({ clinicCount: rows.length, mode: 'private-review', domain: 'https://example.test' }));
  write('404.html', '<html>없는 기관입니다</html>');
  write('index.html', '<html>홈</html>');
  write('clinic-assets/index.html', '<a href="/data/clinic-assets/inventory.json">전체 에셋·근거 JSON</a>');
  const inventory = '{"기관":"전체 자료"}';
  write('data/clinic-assets/inventory.json', inventory);
  for (const [id, html, record] of rows) {
    write(`clinics/${id}/index.html`, html);
    write(`data/clinic-assets/records/${id}.json`, record);
  }
  const result = compactForCloudflare(dir);
  assert.equal(result.clinicCount, rows.length);
  assert.equal(result.htmlShardCount, 2);
  assert.equal(gunzipSync(fs.readFileSync(path.join(dir, result.inventoryDownload))).toString(), inventory);
  assert.equal(fs.existsSync(path.join(dir, 'clinics')), false);
  assert.equal(fs.existsSync(path.join(dir, 'data/clinic-assets/records')), false);
  assert.match(fs.readFileSync(path.join(dir, 'clinic-assets/index.html'), 'utf8'), /inventory.json.gz/);
  for (const file of ['_worker.js', '_headers']) assert(fs.readFileSync(path.join(dir, file), 'utf8').includes(CONTENT_SECURITY_POLICY), file + ' carries the shared CSP');
  const worker = (await import('data:text/javascript;base64,' + fs.readFileSync(path.join(dir, '_worker.js')).toString('base64'))).default;
  const env = { ASSETS: { async fetch(request) {
    const file = path.join(dir, new URL(request.url).pathname);
    return fs.existsSync(file) && fs.statSync(file).isFile()
      ? new Response(fs.readFileSync(file)) : new Response('Not found', { status: 404 });
  } } };
  const get = (url, method = 'GET') => worker.fetch(new Request('https://example.test' + url, { method }), env);
  for (const [id, html, record] of rows) {
    const response = await get(`/clinics/${id}/?source=test`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.equal(await response.text(), html);
    assert.equal(await (await get(`/data/clinic-assets/records/${id}.json`)).text(), record);
    assert.equal(await (await get(`/clinics/${id}/`, 'HEAD')).text(), '');
    for (const suffix of ['', '/index.html']) {
      const redirect = await get(`/clinics/${id}${suffix}?keep=1`);
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get('Location'), `/clinics/${id}/?keep=1`);
    }
  }
  for (const id of ['c-abc000000000', 'c-000000000000']) {
    const missing = await get(`/clinics/${id}/`);
    assert.equal(missing.status, 404);
    assert.equal(await missing.text(), '<html>없는 기관입니다</html>');
  }
  assert.equal((await get('/clinics/c-abc123456789/', 'POST')).status, 405);
  assert.equal(await (await get('/index.html')).text(), '<html>홈</html>');
  assert.throws(() => compactForCloudflare(dir), /already compacted/);
});

test('Pages Worker counts same-origin hand-off events and answers every POST with the same empty 204', async t => {
  const { OUTBOUND_ROUTE, OUTBOUND_BINDING, OUTBOUND_MAX_BYTES } = await import('../scripts/outbound-events.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-pages-outbound-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, value) => {
    const dest = path.join(dir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  };
  const id = 'c-abc123456789';
  write('build-manifest.json', JSON.stringify({ clinicCount: 1, mode: 'private-review', domain: 'https://example.test' }));
  write('404.html', '<html>없는 페이지</html>');
  write('index.html', '<html>홈</html>');
  write('data/clinic-assets/inventory.json', '{}');
  write(`clinics/${id}/index.html`, '<html>기관</html>');
  write(`data/clinic-assets/records/${id}.json`, '{}');
  compactForCloudflare(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '_routes.json'), 'utf8')), { version: 1, include: ['/clinics/*', '/data/clinic-assets/records/*', '/e/*'], exclude: [] });
  const source = fs.readFileSync(path.join(dir, '_worker.js'), 'utf8');
  for (const forbidden of ['CF-Connecting-IP', 'X-Forwarded-For', 'User-Agent', 'request.cf', "get('Cookie", "get('Referer"])
    assert(!source.toLowerCase().includes(forbidden.toLowerCase()), forbidden + ' is never read by the Worker');
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
  const writes = [], assetRequests = [];
  const assets = { async fetch(request) {
    assetRequests.push(new URL(request.url).pathname);
    const file = path.join(dir, new URL(request.url).pathname);
    return fs.existsSync(file) && fs.statSync(file).isFile() ? new Response(fs.readFileSync(file)) : new Response('Not found', { status: 404 });
  } };
  const bound = { ASSETS: assets, [OUTBOUND_BINDING]: { writeDataPoint: point => writes.push(point) } };
  const origin = 'https://example.test', browser = { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'text/plain;charset=UTF-8' };
  const event = (overrides = {}) => JSON.stringify({ kind: 'tel', clinic: id, page: `/clinics/${id}/`, ...overrides });
  const post = (body, { headers = browser, host = origin, env = bound } = {}) => worker.fetch(new Request(host + OUTBOUND_ROUTE, { method: 'POST', headers, body }), env);
  const dropped = async (label, response) => {
    response = await response;
    assert.equal(response.status, 204, label);
    assert.equal(await response.text(), '', label);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', label);
    assert.equal(writes.length, 0, label + ': nothing written');
  };

  // A valid event writes exactly one data point: blobs kind / clinic id / site section, double 1, index clinic id.
  const counted = await post(event());
  assert.equal(counted.status, 204);
  assert.equal(await counted.text(), '');
  assert.equal(counted.headers.get('Cache-Control'), 'no-store');
  assert.equal(counted.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.equal(counted.headers.get('Content-Security-Policy'), CONTENT_SECURITY_POLICY);
  assert.equal(counted.headers.get('Content-Type'), null);
  assert.deepEqual(writes.splice(0), [{ blobs: ['tel', id, 'clinics'], doubles: [1], indexes: [id] }]);
  await post(event({ kind: 'map', page: '/regions/110000/110001/' }), { headers: { Origin: origin } });
  assert.deepEqual(writes.splice(0), [{ blobs: ['map', id, 'regions'], doubles: [1], indexes: [id] }]);

  // Before the owner adds the binding (or if it misbehaves) the event is validated, dropped and still answered 204.
  await dropped('no binding', post(event(), { env: { ASSETS: assets } }));
  await dropped('throwing binding', post(event(), { env: { ASSETS: assets, [OUTBOUND_BINDING]: { writeDataPoint() { throw new Error('unavailable'); } } } }));

  // Not counted: requests the browser did not mark as same-origin (bots, scripts, other sites), preview hosts,
  // oversized or malformed bodies and values outside the allowlists. The answer never tells them apart.
  await dropped('no origin headers', post(event(), { headers: {} }));
  await dropped('cross-origin', post(event(), { headers: { Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } }));
  await dropped('forged Origin with cross-site fetch metadata', post(event(), { headers: { Origin: origin, 'Sec-Fetch-Site': 'cross-site' } }));
  await dropped('preview host', post(event(), { host: 'https://abc123.example.pages.dev', headers: { Origin: 'https://abc123.example.pages.dev', 'Sec-Fetch-Site': 'same-origin' } }));
  await dropped('oversized', post(event({ page: '/' + 'a/'.repeat(OUTBOUND_MAX_BYTES) })));
  await dropped('oversized without a declared length', worker.fetch({ method: 'POST', url: origin + OUTBOUND_ROUTE, headers: new Headers(browser), body: new Response('x'.repeat(OUTBOUND_MAX_BYTES * 4)).body }, bound));
  await dropped('malformed JSON', post('{"kind":"tel"'));
  await dropped('empty body', post(''));
  await dropped('bad kind', post(event({ kind: 'sms' })));
  await dropped('bad clinic id', post(event({ clinic: 'c-ABC123456789' })));
  await dropped('clinic id injection', post(event({ clinic: id + "' OR 1=1" })));
  await dropped('bad page', post(event({ page: 'https://evil.example/' })));
  await dropped('page with query', post(event({ page: '/find/?q=secret' })));
  await dropped('extra field', post(event({ visitor: 'abc' })));

  // The handler reads the method, the URL, three headers and the body. Nothing that identifies a visitor.
  const read = { properties: new Set(), headers: new Set() };
  const real = new Request(origin + OUTBOUND_ROUTE, { method: 'POST', headers: { ...browser, Cookie: 'session=1', 'User-Agent': 'Browser', 'CF-Connecting-IP': '203.0.113.7', Referer: origin + '/find/?q=secret' }, body: event() });
  const observed = new Proxy({ method: 'POST', url: real.url, body: real.body, headers: { get(name) { read.headers.add(name.toLowerCase()); return real.headers.get(name); } }, cf: { country: 'KR' } }, { get(target, property) { read.properties.add(property); return target[property]; } });
  assert.equal((await worker.fetch(observed, bound)).status, 204);
  assert.equal(writes.splice(0).length, 1);
  assert.deepEqual([...read.properties].sort(), ['body', 'headers', 'method', 'url']);
  assert.deepEqual([...read.headers].sort(), ['content-length', 'origin', 'sec-fetch-site']);

  // Only POST is accepted, and the route never touches static assets.
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']) {
    const response = await worker.fetch(new Request(origin + OUTBOUND_ROUTE, { method, headers: browser }), bound);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('Allow'), 'POST');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(assetRequests, []);

  // Every other route behaves as before, including other paths under /e/.
  for (const pathname of ['/e/', '/e/other', OUTBOUND_ROUTE + '/', '/E/OUTBOUND']) {
    const response = await worker.fetch(new Request(origin + pathname, { method: 'POST', headers: browser, body: event() }), bound);
    assert.equal(response.status, 404, pathname);
    assert.equal(await response.text(), 'Not found');
  }
  assert.equal(await (await worker.fetch(new Request(origin + '/index.html'), bound)).text(), '<html>홈</html>');
  assert.equal(await (await worker.fetch(new Request(origin + `/clinics/${id}/`), bound)).text(), '<html>기관</html>');
  const refused = await worker.fetch(new Request(origin + `/clinics/${id}/`, { method: 'POST', headers: browser, body: event() }), bound);
  assert.equal(refused.status, 405);
  assert.equal(refused.headers.get('Allow'), 'GET, HEAD');
  assert.deepEqual(writes, []);
});

test('the canonical-host redirect still comes first on the primary pages.dev host', async () => {
  const { cloudflareWorker } = await import('../scripts/build-cloudflare.mjs');
  const { OUTBOUND_ROUTE, OUTBOUND_BINDING } = await import('../scripts/outbound-events.mjs');
  const source = cloudflareWorker({ review: false, canonicalOrigin: 'https://example.test', pagesHost: 'example.pages.dev' });
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).default;
  const writes = [], env = { ASSETS: { fetch: async () => new Response('asset') }, [OUTBOUND_BINDING]: { writeDataPoint: point => writes.push(point) } };
  const body = JSON.stringify({ kind: 'tel', clinic: 'c-abc123456789', page: '/' });
  const moved = await worker.fetch(new Request('https://example.pages.dev' + OUTBOUND_ROUTE, { method: 'POST', headers: { Origin: 'https://example.pages.dev' }, body }), env);
  assert.equal(moved.status, 301);
  assert.equal(moved.headers.get('Location'), 'https://example.test' + OUTBOUND_ROUTE);
  assert.deepEqual(writes, []);
  // On the public origin a production Worker counts the event and still marks the endpoint noindex.
  const counted = await worker.fetch(new Request('https://example.test' + OUTBOUND_ROUTE, { method: 'POST', headers: { Origin: 'https://example.test' }, body }), env);
  assert.equal(counted.status, 204);
  assert.equal(counted.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.deepEqual(writes, [{ blobs: ['tel', 'c-abc123456789', 'home'], doubles: [1], indexes: ['c-abc123456789'] }]);
});
