import test from 'node:test';
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
