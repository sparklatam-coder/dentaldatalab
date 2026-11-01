#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8', '.webp': 'image/webp',
  '.csv': 'text/csv; charset=utf-8',
};
const compressible = new Set(['.html', '.json', '.mjs', '.css', '.svg', '.xml', '.csv']);

export function previewAddress(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) {
    throw new Error('로컬 검토 서버는 127.0.0.1, ::1 또는 localhost만 사용할 수 있습니다.');
  }
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT는 0~65535 정수여야 합니다.');
  return { host, port };
}

function acceptsGzip(header = '') {
  return header.split(',').some(part => {
    const [encoding, ...parameters] = part.trim().toLowerCase().split(';');
    const quality = parameters.find(value => value.trim().startsWith('q='));
    return encoding === 'gzip' && (!quality || Number(quality.trim().slice(2)) > 0);
  });
}

// Resolve the active directory once per request, after the next build completes.
export function createPreviewServer({ directory, getDirectory = () => directory } = {}) {
  return http.createServer((req, res) => {
    const headers = {
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
      'Cache-Control': 'no-cache',
      'Vary': 'Accept-Encoding',
    };
    const respond = (status, text, extra = {}) => {
      const body = Buffer.from(text);
      res.writeHead(status, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, ...extra });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!['GET', 'HEAD'].includes(req.method)) return respond(405, 'Method not allowed', { Allow: 'GET, HEAD' });
    let url, pathname;
    try {
      url = new URL(req.url, 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
      if (pathname.includes('\0')) throw new Error('Null byte');
    } catch { return respond(400, 'Bad request'); }
    if (pathname.includes('\\') || pathname.split('/').some(segment => segment.startsWith('.'))) {
      return respond(403, 'Forbidden');
    }
    const current = getDirectory();
    if (!current) return respond(503, '로컬 사이트를 빌드하고 있습니다. 잠시 후 새로고침해 주세요.', { 'Retry-After': '2' });
    const dir = path.resolve(current);
    let file = path.resolve(dir, '.' + pathname);
    if (file !== dir && !file.startsWith(dir + path.sep)) return respond(403, 'Forbidden');
    try {
      let status = 200;
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!pathname.endsWith('/')) {
          return respond(308, '', { Location: url.pathname.replace(/^\/+/, '/') + '/' + url.search });
        }
        file = path.join(file, 'index.html');
      }
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        file = path.join(dir, '404.html');
        status = 404;
      }
      const actual = fs.realpathSync(file), realDir = fs.realpathSync(dir);
      if (!actual.startsWith(realDir + path.sep)) return respond(403, 'Forbidden');
      const ext = path.extname(file);
      let body = fs.readFileSync(file);
      headers['Content-Type'] = types[ext] || 'application/octet-stream';
      if (acceptsGzip(req.headers['accept-encoding']) && compressible.has(ext)) {
        body = zlib.gzipSync(body);
        headers['Content-Encoding'] = 'gzip';
      }
      headers['Content-Length'] = body.length;
      res.writeHead(status, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      return respond(503, '로컬 빌드 파일을 읽지 못했습니다. 빌드 완료 후 다시 시도해 주세요.', { 'Retry-After': '2' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = path.resolve(process.env.DIST_DIR || path.join(root, 'dist'));
  if (!fs.existsSync(path.join(directory, 'build-manifest.json'))) throw new Error('먼저 npm run build를 실행하세요.');
  const { host, port } = previewAddress();
  const server = createPreviewServer({ directory });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`DentalDataLab local preview: http://${host.includes(':') ? '[' + host + ']' : host}:${server.address().port}/\nServing ${directory}`));
  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());
}
