#!/usr/bin/env node
// Compare two imported HIRA quarters (clinics.json from scripts/import-hira.mjs) before publishing a quarterly report.
// Usage: node scripts/compare-hira-snapshots.mjs --after <dir|clinics.json> [--before data/clinics.json] [--out report.json]
//
// What it reports, and how sure it is:
// - idContinuity: share of the earlier quarter's ids found again. ids hash 암호화요양기호; whether HIRA keeps that key
//   across releases is unverified, so a low share means "opened/closed" lists must not be published as-is.
// - opened / closed: ids present in only one quarter. A 의원→병원 conversion or a 개설자 change usually gets a new
//   요양기호, so the same place can appear as one closed and one opened record.
// - pairs: closed ↔ opened records that share the road address (without the 시도 token), phone digits or name stem.
//   Two or more shared attributes = 'strong'; one = 'weak' (a review candidate only). Pairs are findings to check,
//   not facts: nothing here is published or written into data/ automatically.
// - same-id changes: type, name, road address, 시군구 code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CONTINUITY_WARNING = 0.9;
const TYPES = { '41': '치과병원', '51': '치과의원' };

/** Road address without the 시도 token, floor/unit detail or the parenthesised 동·building note; whitespace removed. */
export function roadBase(address) {
  const text = String(address ?? '').split('(')[0].split(',')[0].trim();
  const parts = text.split(/\s+/).filter(Boolean);
  return parts.length >= 3 ? parts.slice(1).join('') : null;
}
export const phoneDigits = phone => { const d = String(phone ?? '').replace(/\D/g, ''); return d.length >= 9 ? d : null; };
export function nameStem(name) {
  const stem = String(name ?? '').replace(/\s+/g, '').replace(/(치과의원|치과병원|치과)$/, '');
  return stem || null; // one-syllable stems (수치과의원 → 수) are common; the name never creates a candidate on its own
}
const keysOf = c => ({ address: roadBase(c.address), phone: phoneDigits(c.phone), name: nameStem(c.name) });
const brief = c => ({ id: c.id, typeCode: c.typeCode, name: c.name, sidoCode: c.sidoCode, sido: c.sido, cityCode: c.cityCode, city: c.city, address: c.address, phone: c.phone, openedOn: c.openedOn ?? null });
const byType = list => Object.fromEntries(Object.keys(TYPES).map(t => [t, list.filter(c => c.typeCode === t).length]));
const pairKind = (a, b) => a.typeCode === b.typeCode ? 'relisted' : a.typeCode === '51' && b.typeCode === '41' ? 'clinicToHospital' : a.typeCode === '41' && b.typeCode === '51' ? 'hospitalToClinic' : 'typeChange';

/** Greedy one-to-one pairing of closed ↔ opened records by the number of shared keys (address, phone, name stem). */
export function pairRecords(closed, opened) {
  const index = new Map();
  opened.forEach((c, i) => { for (const [k, v] of Object.entries(keysOf(c))) if (v && k !== 'name') { const key = k + ':' + v; (index.get(key) ?? index.set(key, []).get(key)).push(i); } });
  const candidates = [];
  closed.forEach((a, i) => {
    const ka = keysOf(a), seen = new Set();
    for (const k of ['address', 'phone']) for (const j of ka[k] ? index.get(k + ':' + ka[k]) ?? [] : []) {
      if (seen.has(j)) continue;
      seen.add(j);
      const kb = keysOf(opened[j]);
      const matchedOn = ['address', 'phone', 'name'].filter(x => ka[x] && ka[x] === kb[x]);
      candidates.push({ i, j, matchedOn });
    }
  });
  candidates.sort((x, y) => y.matchedOn.length - x.matchedOn.length || x.i - y.i || x.j - y.j);
  const usedI = new Set(), usedJ = new Set(), pairs = [];
  for (const c of candidates) {
    if (usedI.has(c.i) || usedJ.has(c.j)) continue;
    usedI.add(c.i); usedJ.add(c.j);
    const ambiguous = candidates.some(o => o !== c && o.matchedOn.length === c.matchedOn.length && ((o.i === c.i && o.j !== c.j) || (o.j === c.j && o.i !== c.i)));
    pairs.push({ kind: pairKind(closed[c.i], opened[c.j]), confidence: c.matchedOn.length >= 2 ? 'strong' : 'weak', matchedOn: c.matchedOn, ambiguous,
      before: brief(closed[c.i]), after: brief(opened[c.j]) });
  }
  return pairs;
}

/** Pure comparison of two clinics.json payloads ({snapshotDate, clinics}). */
export function compareSnapshots(before, after, { allowSameDate = false } = {}) {
  for (const [label, s] of [['before', before], ['after', after]]) {
    if (!s || !Array.isArray(s.clinics) || !/^\d{4}-\d{2}-\d{2}$/.test(s.snapshotDate ?? '')) throw new TypeError(`${label} must be a clinics.json payload with snapshotDate`);
  }
  if (!(after.snapshotDate > before.snapshotDate) && !(allowSameDate && after.snapshotDate === before.snapshotDate)) throw new Error(`after (${after.snapshotDate}) must be later than before (${before.snapshotDate})`);
  const b = new Map(before.clinics.map(c => [c.id, c])), a = new Map(after.clinics.map(c => [c.id, c]));
  const kept = [...b.keys()].filter(id => a.has(id));
  const closed = before.clinics.filter(c => !a.has(c.id)), opened = after.clinics.filter(c => !b.has(c.id));
  const pairs = pairRecords(closed, opened);
  const strong = pairs.filter(p => p.confidence === 'strong');
  const pairedBefore = new Set(strong.map(p => p.before.id)), pairedAfter = new Set(strong.map(p => p.after.id));
  const changes = { typeChanged: [], renamed: [], moved: [], cityCodeChanged: [] };
  for (const id of kept) {
    const x = b.get(id), y = a.get(id);
    if (x.typeCode !== y.typeCode) changes.typeChanged.push({ id, from: x.typeCode, to: y.typeCode, name: y.name });
    if (x.name !== y.name) changes.renamed.push({ id, from: x.name, to: y.name });
    if (roadBase(x.address) !== roadBase(y.address)) changes.moved.push({ id, name: y.name, from: x.address, to: y.address });
    if (x.cityCode !== y.cityCode) changes.cityCodeChanged.push({ id, name: y.name, from: `${x.cityCode} ${x.city}`, to: `${y.cityCode} ${y.city}` });
  }
  const keptShare = before.clinics.length ? Math.round(kept.length / before.clinics.length * 10000) / 10000 : 1;
  const relisted = strong.filter(p => p.kind === 'relisted').length;
  const warnings = [];
  if (keptShare < CONTINUITY_WARNING) warnings.push(`이전 분기 id의 ${(keptShare * 100).toFixed(1)}%만 다시 나타남: 암호화요양기호가 유지되지 않았을 수 있으므로 신규·폐업 목록을 그대로 발행하지 말 것`);
  if (closed.length && relisted / closed.length > 0.2) warnings.push(`사라진 id ${closed.length}건 중 ${relisted}건이 같은 종별로 주소·전화·이름이 겹치는 새 id와 짝지어짐: 식별자 변경 여부를 먼저 확인할 것`);
  if (pairs.some(p => p.ambiguous)) warnings.push(`후보가 여럿인 짝 ${pairs.filter(p => p.ambiguous).length}건: 수동 확인 필요`);
  if (after.snapshotDate === before.snapshotDate) warnings.push('같은 기준일끼리 비교함(점검용)');
  const netOpened = opened.filter(c => !pairedAfter.has(c.id)), netClosed = closed.filter(c => !pairedBefore.has(c.id));
  const count = list => ({ total: list.length, ...byType(list) });
  return {
    generatedBy: 'scripts/compare-hira-snapshots.mjs',
    before: { snapshotDate: before.snapshotDate, total: before.clinics.length, byType: byType(before.clinics) },
    after: { snapshotDate: after.snapshotDate, total: after.clinics.length, byType: byType(after.clinics) },
    idContinuity: { kept: kept.length, beforeOnly: closed.length, afterOnly: opened.length, keptShare, threshold: CONTINUITY_WARNING },
    summary: {
      opened: count(opened), closed: count(closed),
      netOpened: count(netOpened), netClosed: count(netClosed),
      strongPairs: Object.fromEntries(['clinicToHospital', 'hospitalToClinic', 'relisted', 'typeChange'].map(k => [k, strong.filter(p => p.kind === k).length])),
      weakPairs: pairs.length - strong.length,
      sameId: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.length])),
    },
    warnings,
    pairs,
    netOpened: netOpened.map(brief), netClosed: netClosed.map(brief),
    sameIdChanges: changes,
    method: [
      'id = 암호화요양기호의 SHA-256 앞 12자리. 같은 id는 같은 요양기호로 본다.',
      '짝짓기 키: 주소의 도로명+건물번호(시도 표기·층·괄호 주석 제외), 전화번호 숫자, 기관명에서 “치과의원/치과병원/치과”를 뗀 이름. 주소·전화 중 하나가 같아야 후보가 되며 2개 이상 일치는 strong, 1개는 weak.',
      'netOpened/netClosed는 strong 짝을 뺀 목록이다. weak 짝과 ambiguous 표시는 사람이 확인하기 전까지 결론으로 쓰지 않는다.',
      '이 보고서는 data/ 아래 공개 자료를 바꾸지 않는다.',
    ],
  };
}

const load = file => {
  const p = fs.existsSync(file) && fs.statSync(file).isDirectory() ? path.join(file, 'clinics.json') : file;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
};

function main(argv) {
  const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--help') || !opt('--after')) {
    console.log('node scripts/compare-hira-snapshots.mjs --after <dir|clinics.json> [--before data/clinics.json] [--out report.json] [--allow-same-date]');
    process.exit(argv.includes('--help') ? 0 : 1);
  }
  const before = load(path.resolve(opt('--before', path.join(root, 'data/clinics.json'))));
  const after = load(path.resolve(opt('--after')));
  const report = compareSnapshots(before, after, { allowSameDate: argv.includes('--allow-same-date') });
  const out = opt('--out', null);
  if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2) + '\n'); }
  console.log(JSON.stringify({ before: report.before, after: report.after, idContinuity: report.idContinuity, summary: report.summary, warnings: report.warnings, out }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
