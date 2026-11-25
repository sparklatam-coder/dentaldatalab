import test from 'node:test';
import { CONTENT_SECURITY_POLICY } from '../scripts/security-headers.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createPreviewServer, previewAddress } from '../scripts/server.mjs';

test('preview only binds to loopback and validates its port', () => {
  assert.deepEqual(previewAddress({}), { host: '127.0.0.1', port: 4173 });
  assert.deepEqual(previewAddress({ HOST: '::1', PORT: '0' }), { host: '::1', port: 0 });
  assert.throws(() => previewAddress({ HOST: '0.0.0.0' }));
  for (const port of ['1.5', '-1', '65536', 'not-a-port']) assert.throws(() => previewAddress({ PORT: port }));
});

test('preview serves complete generations with private headers and HTTP semantics', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-preview-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const [folder, title] of [['first', '처음'], ['second', '변경']]) {
    const dir = path.join(base, folder);
    fs.mkdirSync(path.join(dir, 'find'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets'));
    fs.writeFileSync(path.join(dir, 'index.html'), `<h1>${title}</h1>`);
    fs.writeFileSync(path.join(dir, 'find/index.html'), '<h1>검색</h1>');
    fs.writeFileSync(path.join(dir, '404.html'), '<h1>없는 페이지</h1>');
    fs.writeFileSync(path.join(dir, 'assets/app.mjs'), 'export const ready = true;');
  }
  let active = null;
  const server = createPreviewServer({ getDirectory: () => active });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const request = (pathname, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, ...options }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.once('error', reject);
    req.end();
  });
  assert.equal((await request('/')).status, 503);
  active = path.join(base, 'first');
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.equal(home.body.toString(), '<h1>처음</h1>');
  assert.equal(home.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal(home.headers['content-security-policy'], CONTENT_SECURITY_POLICY);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  const head = await request('/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], home.headers['content-length']);
  const redirect = await request('/find?q=%EC%96%91%EC%A3%BC');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, '/find/?q=%EC%96%91%EC%A3%BC');
  assert.equal(redirect.headers['x-robots-tag'], 'noindex, nofollow');
  assert.match((await request('/assets/app.mjs')).headers['content-type'], /^text\/javascript/);
  assert.equal((await request('/missing')).status, 404);
  const post = await request('/', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
  assert.equal(post.headers['x-robots-tag'], 'noindex, nofollow');
  for (const value of ['/bad%ZZ', '/bad%00']) assert.equal((await request(value)).status, 400);
  for (const value of ['/.env', '/%2e%2e%2fsecret', '/bad%5cpath']) assert.equal((await request(value)).status, 403);
  const zipped = await request('/', { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zlib.gunzipSync(zipped.body).toString(), home.body.toString());
  assert.equal((await request('/', { headers: { 'Accept-Encoding': 'gzip;q=0' } })).headers['content-encoding'], undefined);
  fs.writeFileSync(path.join(base, 'outside.txt'), 'not public');
  fs.symlinkSync(path.join(base, 'outside.txt'), path.join(active, 'outside.txt'));
  assert.equal((await request('/outside.txt')).status, 403);
  // A failed/incomplete staging directory never becomes active.
  fs.mkdirSync(path.join(base, 'incomplete'));
  assert.equal((await request('/')).body.toString(), '<h1>처음</h1>');
  active = path.join(base, 'second');
  assert.equal((await request('/')).body.toString(), '<h1>변경</h1>');
  // A generation without 404.html still answers 404 for unknown paths rather than 503.
  fs.unlinkSync(path.join(active, '404.html'));
  const missing = await request('/missing');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.toString(), 'Not found');
  assert.equal(missing.headers['x-robots-tag'], 'noindex, nofollow');
  assert.equal((await request('/')).status, 200);
});

test('preview answers hand-off beacons with an empty 204 and keeps nothing', async t => {
  const { OUTBOUND_ROUTE } = await import('../scripts/outbound-events.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-preview-outbound-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>홈</h1>');
  let active = null;
  const server = createPreviewServer({ getDirectory: () => active });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const send = (pathname, method, body) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: server.address().port, path: pathname, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.once('error', reject);
    req.end(body);
  });
  const event = JSON.stringify({ kind: 'tel', clinic: 'c-0123456789ab', page: '/clinics/c-0123456789ab/' });
  // Also while the first dev build is still running: a beacon is never an error.
  for (const directory of [null, dir]) {
    active = directory;
    const response = await send(OUTBOUND_ROUTE, 'POST', event);
    assert.equal(response.status, 204);
    assert.equal(response.body, '');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['content-security-policy'], CONTENT_SECURITY_POLICY);
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
  }
  assert.equal((await send(OUTBOUND_ROUTE, 'POST', 'x'.repeat(200000))).status, 204, 'the body is discarded, whatever it is');
  assert.deepEqual(fs.readdirSync(dir), ['index.html'], 'nothing is stored locally');
  // Only that exact POST is special; everything else keeps the read-only behaviour.
  assert.equal((await send(OUTBOUND_ROUTE, 'GET')).status, 404);
  for (const pathname of [OUTBOUND_ROUTE + '?x=1', '/e/other', '/']) {
    const refused = await send(pathname, 'POST', event);
    assert.equal(refused.status, 405, pathname);
    assert.equal(refused.headers.allow, 'GET, HEAD');
  }
});
