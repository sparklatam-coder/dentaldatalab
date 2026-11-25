#!/usr/bin/env node
// Read-only progress view of the homepage collectors (no network, no writes).
//   node scripts/collector-status.mjs            # candidate verification (default)
//   node scripts/collector-status.mjs --linked   # linked-homepage collector
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidateHomepageVerified, detectKind} from './clinic-assets.mjs';
import {canonical} from './prepare-candidate-homepages.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linked = process.argv.includes('--linked');
const files = linked
  ? {output: 'data/assets/continuous-homepages.json', seeds: 'data/research/discovered-homepage-seeds.json', lock: 'data/research/continuous-homepages.lock', log: 'data/research/continuous-homepages.log'}
  : {output: 'data/assets/candidate-homepages.json', seeds: 'data/research/candidate-homepage-seeds.json', lock: 'data/research/candidate-homepages.lock', log: 'data/research/candidate-homepages.log'};
const read = file => fs.existsSync(path.join(root, file)) ? JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) : null;

const state = read(files.output), seeds = read(files.seeds);
if (!state) { console.log('결과 파일 없음: ' + files.output); process.exit(0); }
const rows = state.results ?? [];
const lockPath = path.join(root, files.lock);
let running = false, pid = null;
if (fs.existsSync(lockPath)) {
  pid = Number(fs.readFileSync(lockPath, 'utf8').trim());
  try { process.kill(pid, 0); running = true; } catch { running = false; }
}
const byStatus = {};
for (const r of rows) byStatus[r.status ?? '?'] = (byStatus[r.status ?? '?'] ?? 0) + 1;
// The same predicate the build applies (clinic-assets.mjs addHomepageScans), so this count matches what gets promoted.
const website = url => { try { return detectKind(new URL(url).href) === 'website'; } catch { return false; } };
const verifiedShape = rows.filter(r => website(r.url) && Object.values(r.matches ?? {}).some(m => candidateHomepageVerified({ ...r, sourceType: r.sourceType ?? 'candidate_homepage' }, m))).length;
const times = rows.map(r => Date.parse(r.checkedAt)).filter(Number.isFinite).sort((a, b) => a - b);
const first = times[0], last = times.at(-1);
// The seed file is the queue as of the last refresh and still lists URLs processed since, so count the union.
const all = new Set(rows.map(r => canonical(r.url)).filter(Boolean));
const done = all.size;
for (const s of seeds?.seeds ?? []) { const k = canonical(s.url); if (k) all.add(k); }
const total = all.size;
const remaining = Math.max(0, total - done);
const perMinute = times.length > 10 ? (times.length - 1) / ((last - first) / 60000) : null;
const eta = perMinute && remaining ? remaining / perMinute : null;
const fmtMin = m => m == null ? '산출 불가' : m < 90 ? `${Math.round(m)}분` : `${(m / 60).toFixed(1)}시간`;
const kst = t => Number.isFinite(t) ? new Date(t).toLocaleString('sv-SE', {timeZone: 'Asia/Seoul'}) : '-';

console.log(`[${linked ? '기관 연결 홈페이지' : '자동 발굴 후보 홈페이지 검증'}] 상태 ${state.state}${state.stopReason ? ' (' + state.stopReason + ')' : ''} · 프로세스 ${running ? '실행 중 (PID ' + pid + ')' : '없음'}`);
console.log(`처리 ${rows.length.toLocaleString('ko-KR')} / 전체 ${total.toLocaleString('ko-KR')} (${total ? (100 * rows.length / total).toFixed(1) : 0}%) · 남은 ${remaining.toLocaleString('ko-KR')}`);
console.log('상태별: ' + Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
if (!linked) console.log(`승격 조건(기관명 + 전화/주소, 등록기관 전화 ≤2) 충족: ${verifiedShape.toLocaleString('ko-KR')}곳`);
console.log(`속도 ${perMinute ? perMinute.toFixed(1) + '건/분' : '산출 불가'} · 예상 잔여 ${fmtMin(eta)} · 첫 기록 ${kst(first)} · 마지막 기록 ${kst(last)} (KST)`);
if (state.blockedHosts?.length) console.log(`차단 기록 호스트 ${state.blockedHosts.length}개 (재요청 없음)`);
if (state.blocked) console.log('정지 사유: ' + JSON.stringify(state.blocked));
console.log(`실시간 로그: tail -f ${files.log}`);
