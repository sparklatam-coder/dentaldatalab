#!/usr/bin/env node
// Keep the normal static build unchanged; compact only this deployment output.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function cloudflareWorker({ review = true } = {}) {
  return `// Generated Pages advanced-mode Worker. No private data or credentials.
const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  'Cache-Control': 'public, max-age=0, must-revalidate',
  ${review ? "'X-Robots-Tag': 'noindex, nofollow'," : ''}
};
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const html = url.pathname.match(/^\\/clinics\\/(c-([a-f0-9]{3})[a-f0-9]{9})(\\/|\\/index\\.html)?$/);
    const record = url.pathname.match(/^\\/data\\/clinic-assets\\/records\\/(c-([a-f0-9]{3})[a-f0-9]{9})\\.json$/);
    if (!html && !record) return env.ASSETS.fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
    }
    const match = html || record;
    const shardUrl = new URL('/data/cloudflare/' + (html ? 'html/' : 'records/') + match[2] + '.json', url);
    const shard = await env.ASSETS.fetch(new Request(shardUrl));
    if (!shard.ok) return missing(request, env);
    const values = await shard.json();
    if (!Object.hasOwn(values, match[1])) return missing(request, env);
    if (html && match[3] !== '/') {
      url.pathname = '/clinics/' + match[1] + '/';
      return new Response(null, { status: 308, headers: { ...headers, Location: url.pathname + url.search } });
    }
    const body = values[match[1]];
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: { ...headers, 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8' },
    });
  },
};
async function missing(request, env) {
  const page = await env.ASSETS.fetch(new Request(new URL('/404.html', request.url)));
  return new Response(request.method === 'HEAD' ? null : page.body, {
    status: 404, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
`;
}

export function compactForCloudflare(directory) {
  const dist = path.resolve(directory);
  const manifestPath = path.join(dist, 'build-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.cloudflare) throw new Error('Cloudflare output is already compacted. Rebuild first.');
  const write = (file, value) => {
    const dest = path.join(dist, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, value);
  };
  const ids = fs.readdirSync(path.join(dist, 'clinics')).sort();
  const groups = new Map();
  for (const id of ids) {
    if (!/^c-[a-f0-9]{12}$/.test(id)) throw new Error('Unexpected clinic path: ' + id);
    const prefix = id.slice(2, 5);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(id);
  }
  if (ids.length !== manifest.clinicCount) throw new Error('Clinic count does not match build manifest.');
  // Three hex digits keep parsing work small for the free Workers CPU limit.
  for (const [prefix, members] of groups) {
    const html = {}, records = {};
    for (const id of members) {
      html[id] = fs.readFileSync(path.join(dist, 'clinics', id, 'index.html'), 'utf8');
      records[id] = fs.readFileSync(path.join(dist, 'data/clinic-assets/records', id + '.json'), 'utf8');
    }
    write('data/cloudflare/html/' + prefix + '.json', JSON.stringify(html));
    write('data/cloudflare/records/' + prefix + '.json', JSON.stringify(records));
  }
  fs.rmSync(path.join(dist, 'clinics'), { recursive: true });
  fs.rmSync(path.join(dist, 'data/clinic-assets/records'), { recursive: true });
  const inventory = path.join(dist, 'data/clinic-assets/inventory.json');
  write('data/clinic-assets/inventory.json.gz', gzipSync(fs.readFileSync(inventory)));
  fs.unlinkSync(inventory);
  const assetsPage = path.join(dist, 'clinic-assets/index.html');
  if (fs.existsSync(assetsPage)) {
    fs.writeFileSync(assetsPage, fs.readFileSync(assetsPage, 'utf8')
      .replaceAll('/data/clinic-assets/inventory.json', '/data/clinic-assets/inventory.json.gz')
      .replaceAll('전체 에셋·근거 JSON', '전체 에셋·근거 JSON (gzip 압축)'));
  }
  write('_worker.js', cloudflareWorker({ review: manifest.mode !== 'production' }));
  write('_routes.json', JSON.stringify({ version: 1, include: ['/clinics/*', '/data/clinic-assets/records/*'], exclude: [] }, null, 2));
  write('_redirects', '/data/clinic-assets/inventory.json /data/clinic-assets/inventory.json.gz 302\n');
  write('_headers', `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), camera=(), microphone=()
${manifest.mode !== 'production' ? '  X-Robots-Tag: noindex, nofollow\n' : ''}
/data/clinic-assets/inventory.json.gz
  Content-Type: application/gzip
  Content-Disposition: attachment; filename="inventory.json.gz"
`);
  const files = [];
  const visit = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) visit(file);
      else files.push({ path: path.relative(dist, file), bytes: fs.statSync(file).size });
    }
  };
  visit(dist);
  const tooLarge = files.filter(file => file.bytes > 25 * 1024 * 1024);
  if (files.length > 20000 || tooLarge.length) throw new Error('Pages free limits exceeded: ' + JSON.stringify({ count: files.length, tooLarge }));
  const largest = [...files].sort((a, b) => b.bytes - a.bytes)[0];
  manifest.cloudflare = {
    format: 'pages-advanced-shards-v1', clinicCount: ids.length,
    htmlShardCount: groups.size, recordShardCount: groups.size,
    fileCount: files.length, largestFile: largest,
    detailRequestsUseFunctions: true,
    inventoryDownload: '/data/clinic-assets/inventory.json.gz',
  };
  manifest.fileCount = files.length;
  manifest.totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  write('build-manifest.json', JSON.stringify(manifest, null, 2));
  return manifest.cloudflare;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.env.DIST_DIR || path.join(root, '.cloudflare-dist'));
  const built = spawnSync(process.execPath, [path.join(root, 'scripts/build.mjs')], {
    cwd: root, env: { ...process.env, DIST_DIR: directory }, stdio: 'inherit',
  });
  if (built.status !== 0) process.exit(built.status || 1);
  console.log(JSON.stringify(compactForCloudflare(directory), null, 2));
}
