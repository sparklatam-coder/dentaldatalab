import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { indexNowKey, prepareIndexNow, submitIndexNow, INDEXNOW_ORIGIN, INDEXNOW_ENDPOINT } from '../scripts/indexnow.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-indexnow-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'dist');
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  const key = 'abcdef12-3456-7890-aaaa-bbbbbbbbbbbb';
  write(path.join(root, 'data/content/indexnow-key.txt'), key + '\n');
  const routes = ['/', '/reports/', '/clinics/c-abc123456789/'];
  write(path.join(directory, 'build-manifest.json'), JSON.stringify({ indexingEnabled: true, domain: INDEXNOW_ORIGIN, routes }));
  write(path.join(directory, 'sitemap.xml'), routes.map(route => `<loc>${INDEXNOW_ORIGIN + route}</loc>`).join(''));
  const pages = Object.fromEntries(routes.map(route => [INDEXNOW_ORIGIN + route, `<html><meta name="robots" content="index,follow"><link rel="canonical" href="${INDEXNOW_ORIGIN + route}"><h1>${route}</h1></html>`]));
  for (const route of routes.slice(0, 2)) write(path.join(directory, route === '/' ? 'index.html' : 'reports/index.html'), pages[INDEXNOW_ORIGIN + route]);
  write(path.join(directory, 'data/cloudflare/html/abc.json'), JSON.stringify({ 'c-abc123456789': pages[INDEXNOW_ORIGIN + routes[2]] }));
  return { root, directory, key, pages, urls: Object.keys(pages), write };
}

test('IndexNow plans include only explicitly selected public canonical URLs and preserve content digests', t => {
  const f = fixture(t);
  const plan = prepareIndexNow(f);
  assert.equal(plan.payload.host, 'dentaldatalab.com');
  assert.equal(plan.changed.length, 3);
  assert.equal(plan.payload.keyLocation, INDEXNOW_ORIGIN + '/' + f.key + '.txt');
  const state = { accepted: Object.fromEntries(plan.changed.map(item => [item.url, { digest: item.digest, key: f.key }])) };
  assert.equal(prepareIndexNow({ ...f, state }).changed.length, 0);
  f.write(path.join(f.directory, 'reports/index.html'), f.pages[f.urls[1]].replace('</h1>', ' updated</h1>'));
  assert.deepEqual(prepareIndexNow({ ...f, state }).payload.urlList, [f.urls[1]]);
  for (const urls of [['http://dentaldatalab.com/'], ['https://elsewhere.test/'], [INDEXNOW_ORIGIN + '/questions/'], [INDEXNOW_ORIGIN + '/?q=test'], [INDEXNOW_ORIGIN + '/#section'], Array(9).fill(f.urls[0])]) {
    assert.throws(() => prepareIndexNow({ ...f, urls }));
  }
  f.write(path.join(f.directory, 'reports/index.html'), f.pages[f.urls[1]].replace('index,follow', 'noindex,follow'));
  assert.throws(() => prepareIndexNow(f), /not an indexable canonical/);
  f.write(path.join(f.root, 'data/content/indexnow-key.txt'), '../bad-key');
  assert.throws(() => indexNowKey(f.root), /Invalid IndexNow/);
});

test('IndexNow performs key/live-HTML checks before one POST and never sends an unchanged plan', async t => {
  const f = fixture(t), plan = prepareIndexNow(f), calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === plan.payload.keyLocation) return new Response(f.key);
    if (url === INDEXNOW_ENDPOINT) return new Response('', { status: 200 });
    return new Response(f.pages[url], { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  assert.deepEqual(await submitIndexNow(plan, { fetchImpl }), { status: 'received', httpStatus: 200, submitted: 3 });
  assert.equal(calls.length, 5);
  assert.equal(calls.at(-1).options.method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), plan.payload);
  const state = { accepted: Object.fromEntries(plan.changed.map(item => [item.url, { digest: item.digest, key: f.key }])) };
  assert.deepEqual(await submitIndexNow(prepareIndexNow({ ...f, state }), { fetchImpl }), { status: 'skipped_unchanged', submitted: 0 });
  assert.equal(calls.length, 5);
});

test('IndexNow rejects unavailable key, changed/blocked live HTML and endpoint rejection without retries', async t => {
  const f = fixture(t), plan = prepareIndexNow(f);
  for (const failure of ['key', 'html', 'noindex', 'endpoint']) {
    let posts = 0;
    await assert.rejects(submitIndexNow(plan, { fetchImpl: async (url, options = {}) => {
      if (url === plan.payload.keyLocation) return new Response(failure === 'key' ? 'wrong-key' : f.key);
      if (url === INDEXNOW_ENDPOINT) { posts++; return new Response('', { status: 429 }); }
      return new Response(failure === 'html' ? f.pages[url] + '<!--changed-->' : f.pages[url], { headers: { 'Content-Type': 'text/html', ...(failure === 'noindex' ? { 'X-Robots-Tag': 'noindex' } : {}) } });
    } }));
    assert.equal(posts, failure === 'endpoint' ? 1 : 0);
  }
});

test('IndexNow CLI dry run is the default and does not create submission logs', t => {
  const f = fixture(t);
  const log = path.resolve('data/research/indexnow/submissions.jsonl');
  const before = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : null;
  const run = spawnSync(process.execPath, ['scripts/submit-indexnow.mjs', '--dist', f.directory, '--url', f.urls[0]], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(JSON.parse(run.stdout).mode, 'dry-run');
  assert.equal(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : null, before);
});
