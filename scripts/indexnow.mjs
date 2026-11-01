import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isIndexableRoute } from './seo.mjs';

export const INDEXNOW_ORIGIN = 'https://dentaldatalab.com';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
export const DEFAULT_INDEXNOW_ROUTES = ['/', '/reports/', '/regions/', '/clinic-assets/', '/data/', '/methodology/', '/clinics/c-f1e05c9ae9d2/', '/clinics/c-00e964567fee/'];

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

export function assertIndexableHtml(html, url) {
  const robots = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i)?.[1];
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i)?.[1];
  if (!robots || /noindex/i.test(robots) || canonical !== url) throw new Error('URL is not an indexable canonical HTML page: ' + url);
}

export function prepareIndexNow({ root, directory, state = {}, urls = DEFAULT_INDEXNOW_ROUTES.map(route => INDEXNOW_ORIGIN + route) }) {
  const key = indexNowKey(root);
  if (!key) throw new Error('IndexNow key file is missing.');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'build-manifest.json'), 'utf8'));
  if (!manifest.indexingEnabled || manifest.domain !== INDEXNOW_ORIGIN) throw new Error('An SEO public build for the exact allowed HTTPS origin is required.');
  if (!Array.isArray(urls) || !urls.length || urls.length > 8) throw new Error('Submit 1–8 explicitly selected URLs per run. Automatic bulk submission is disabled.');
  const sitemap = fs.readFileSync(path.join(directory, 'sitemap.xml'), 'utf8');
  const selected = [];
  for (const input of [...new Set(urls)]) {
    const url = new URL(input);
    if (url.origin !== INDEXNOW_ORIGIN || url.username || url.password || url.search || url.hash || url.href !== input
      || !isIndexableRoute(url.pathname) || !manifest.routes.includes(url.pathname)
      || !sitemap.includes(`<loc>${input}</loc>`)) throw new Error('URL outside the public canonical allowlist: ' + input);
    const html = localPage(directory, url.pathname);
    assertIndexableHtml(html, input);
    const digest = crypto.createHash('sha256').update(html).digest('hex');
    const previous = state.accepted?.[input];
    selected.push({ url: input, digest, unchanged: previous?.digest === digest && previous?.key === key });
  }
  const changed = selected.filter(item => !item.unchanged);
  return {
    payload: { host: new URL(INDEXNOW_ORIGIN).hostname, key, keyLocation: INDEXNOW_ORIGIN + '/' + key + '.txt', urlList: changed.map(item => item.url) },
    selected, changed,
  };
}

export async function submitIndexNow(plan, { fetchImpl = fetch } = {}) {
  if (plan.payload.host !== new URL(INDEXNOW_ORIGIN).hostname
    || !/^[a-zA-Z0-9-]{8,128}$/.test(plan.payload.key)
    || plan.payload.keyLocation !== INDEXNOW_ORIGIN + '/' + plan.payload.key + '.txt'
    || plan.changed.length > 8 || JSON.stringify(plan.payload.urlList) !== JSON.stringify(plan.changed.map(item => item.url))
    || plan.changed.some(item => { const url = new URL(item.url); return url.origin !== INDEXNOW_ORIGIN || url.search || url.hash || !isIndexableRoute(url.pathname); })) {
    throw new Error('Invalid or out-of-scope IndexNow submission plan.');
  }
  if (!plan.changed.length) return { status: 'skipped_unchanged', submitted: 0 };
  const get = url => fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const key = await get(plan.payload.keyLocation);
  if (key.status !== 200 || (await key.text()).trim() !== plan.payload.key) throw new Error('The deployed IndexNow key file is missing or does not match. Deploy first.');
  for (const item of plan.changed) {
    const response = await get(item.url);
    if (response.status !== 200 || /noindex/i.test(response.headers.get('X-Robots-Tag') || '')
      || !/text\/html/i.test(response.headers.get('Content-Type') || '')) throw new Error('Live URL is not indexable HTML: ' + item.url);
    const html = await response.text();
    assertIndexableHtml(html, item.url);
    if (crypto.createHash('sha256').update(html).digest('hex') !== item.digest) throw new Error('Live HTML differs from the selected local build. Deploy that build before submitting: ' + item.url);
  }
  const response = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(plan.payload),
  });
  if (![200, 202].includes(response.status)) throw new Error('IndexNow rejected the notification: HTTP ' + response.status);
  return { status: response.status === 200 ? 'received' : 'accepted_key_verification_pending', httpStatus: response.status, submitted: plan.changed.length };
}
