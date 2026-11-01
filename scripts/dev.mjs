#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPreviewServer, previewAddress } from './server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.join(root, '.dev-dist');
const marker = path.join(workspace, '.dentaldatalab-dev');
if (fs.existsSync(workspace) && (fs.lstatSync(workspace).isSymbolicLink() || (fs.readdirSync(workspace).length && !fs.existsSync(marker)))) {
  throw new Error('.dev-dist가 개발 서버 관리 폴더가 아닙니다. 다른 경로로 옮긴 뒤 다시 실행하세요.');
}
fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(marker, 'DentalDataLab local development build workspace\n');
const session = fs.mkdtempSync(path.join(workspace, 'session-'));
const { host, port } = previewAddress();
let activeDirectory = null, building = false, requested = false, stopping = false, serverClosed = false;
let child = null, timer = null;
const watchers = [];
const server = createPreviewServer({ getDirectory: () => activeDirectory });

async function cleanup() {
  if (stopping && serverClosed && !building) await fs.promises.rm(session, { recursive: true, force: true });
}

async function rebuild() {
  if (stopping) return;
  if (building) { requested = true; return; }
  building = true;
  requested = false;
  const staging = fs.mkdtempSync(path.join(session, 'build-'));
  const started = Date.now();
  console.log('[dev] 변경 내용을 빌드합니다. 마지막 정상 화면은 계속 열 수 있습니다.');
  try {
    const code = await new Promise((resolve, reject) => {
      child = spawn(process.execPath, [path.join(root, 'scripts/build.mjs')], {
        cwd: root,
        env: { ...process.env, DIST_DIR: staging, DDL_PRODUCTION: '0', DDL_LAUNCH_REVIEWED: '' },
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    child = null;
    if (code !== 0 || stopping) throw new Error(`빌드 종료 코드: ${code}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'build-manifest.json'), 'utf8'));
    if (manifest.mode !== 'private-review' || !fs.existsSync(path.join(staging, 'index.html'))) throw new Error('완성된 로컬 검토 빌드가 아닙니다.');
    const previous = activeDirectory;
    activeDirectory = staging;
    console.log(`[dev] ${(Date.now() - started) / 1000}초 만에 반영했습니다. 브라우저를 새로고침하세요.`);
    if (previous) await fs.promises.rm(previous, { recursive: true, force: true }).catch(error => console.error(`[dev] 이전 임시 파일 정리 실패: ${error.message}`));
  } catch (error) {
    child = null;
    await fs.promises.rm(staging, { recursive: true, force: true });
    if (!stopping) console.error(`[dev] ${error.message}\n[dev] 마지막 정상 빌드를 유지합니다. 파일을 수정하면 다시 시도합니다.`);
  } finally {
    building = false;
    if (requested && !stopping) { clearTimeout(timer); timer = setTimeout(rebuild, 0); }
    await cleanup();
  }
}

function schedule() {
  if (stopping) return;
  requested = true;
  clearTimeout(timer);
  timer = setTimeout(rebuild, 300);
}

function stop() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  child?.kill('SIGTERM');
  server.close(() => { serverClosed = true; cleanup(); });
}

server.on('error', error => {
  console.error(`[dev] ${error.code === 'EADDRINUSE' ? `포트 ${port} 사용 중입니다. PORT=4174 npm run dev처럼 다른 포트를 지정하세요.` : error.message}`);
  process.exitCode = 1;
  stop();
});
server.listen(port, host, () => {
  console.log(`[dev] http://${host.includes(':') ? '[' + host + ']' : host}:${server.address().port}/`);
  console.log('[dev] src/, scripts/, data/ 변경을 감지합니다. Ctrl+C로 종료합니다. dist/는 유지합니다.');
  for (const folder of ['src', 'scripts', 'data']) {
    const watcher = fs.watch(path.join(root, folder), { recursive: true }, schedule);
    watcher.on('error', error => { console.error(`[dev] 파일 감지 실패: ${error.message}`); process.exitCode = 1; stop(); });
    watchers.push(watcher);
  }
  rebuild();
});
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
