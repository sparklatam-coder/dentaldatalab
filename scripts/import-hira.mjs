#!/usr/bin/env node
// HIRA 전국 병의원 및 약국 현황 zip -> data/clinics.json + data/source-manifest.json
// Node built-ins only. Usage: node scripts/import-hira.mjs [--zip <path>] [--snapshot 2026-09-30]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { safeWebsite } from '../src/shared.mjs';

const t0 = Date.now();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SNAPSHOT = opt('--snapshot', '2026-09-30');
const ZIP = path.resolve(opt('--zip', path.join(root, '..', 'hira_hospital_pharmacy_20260930.zip')));
const PAGE_URL = 'https://www.data.go.kr/data/15051059/fileData.do';
const LICENSE = '공공저작물: 출처표시 (제 1유형)';
const DENTAL = { '51': '치과의원', '41': '치과병원' };

// ---------- zip reader (stored/deflate, CP949 names) ----------
function readZip(file) {
  const buf = fs.readFileSync(file);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  }
  if (e < 0) throw new Error('EOCD not found: not a zip');
  const count = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const cp949 = new TextDecoder('euc-kr');
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central dir');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const raw = buf.subarray(p + 46, p + 46 + nl);
    const name = (flags & 0x800) ? raw.toString('utf8') : cp949.decode(raw);
    entries.set(name, { name, method, csize, usize, lho });
    p += 46 + nl + el + cl;
  }
  const read = (name) => {
    const x = entries.get(name);
    const o = x.lho;
    const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
    const data = buf.subarray(start, start + x.csize);
    const out = x.method === 0 ? data : x.method === 8 ? zlib.inflateRawSync(data) : null;
    if (!out) throw new Error('unsupported method ' + x.method);
    if (out.length !== x.usize) throw new Error('size mismatch ' + name);
    return out;
  };
  return { names: [...entries.keys()], read, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

// ---------- csv ----------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = []; let row = [], f = '', q = false, i = 0; const n = text.length;
  while (i < n) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
      f += c; i++; continue;
    }
    if (c === '"') { q = true; i++; }
    else if (c === ',') { row.push(f); f = ''; i++; }
    else if (c === '\r') { i++; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; }
    else { f += c; i++; }
  }
  if(q) throw new Error('Unclosed quoted CSV field');
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return { head, rows };
}
function toObjects(csv) {
  return csv.rows.filter((r) => r.length > 1).map((r,i) => { if(r.length!==csv.head.length)throw new Error('CSV width mismatch at row '+(i+2)); const o = {}; csv.head.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); }); return o; });
}

// ---------- helpers ----------
const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
const int = (v) => { const s = str(v); if (s == null || !/^-?\d+$/.test(s)) return null; return Number(s); };
const num = (v) => { const s = str(v); if (s == null) return null; const x = Number(s); return Number.isFinite(x) ? x : null; };
const date = (v) => { const s = str(v); return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
function hhmm(v) {
  const s = str(v);
  if (s == null || !/^\d{3,4}$/.test(s)) return null;
  const p = s.padStart(4, '0'); const h = Number(p.slice(0, 2)), m = Number(p.slice(2));
  if (h === 0 && m === 0) return null; // "0" / "0000" = not provided in source
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return `${p.slice(0, 2)}:${p.slice(2)}`;
}
const DAYS = [['mon', '월요일'], ['tue', '화요일'], ['wed', '수요일'], ['thu', '목요일'], ['fri', '금요일'], ['sat', '토요일'], ['sun', '일요일']];
function findFile(names, ...keys) {
  const m = names.filter((n) => keys.every((k) => n.includes(k)));
  if (m.length !== 1) throw new Error(`expected exactly one file for ${keys.join('+')}, got ${m.length}`);
  return m[0];
}
const group = (rows) => { const m = new Map(); for (const r of rows) { const k = r['암호화요양기호']; if (!k) continue; (m.get(k) ?? m.set(k, []).get(k)).push(r); } return m; };
const dec = new TextDecoder('euc-kr');
const loadCsv = (z, name, required=[]) => {const csv=parseCsv(dec.decode(z.read(name)));for(const h of required)if(!csv.head.includes(h))throw new Error('Missing CSV header '+h+' in '+name);return toObjects(csv);};

// ---------- main ----------
const z = readZip(ZIP);
const F = {
  base: findFile(z.names, '병원정보서비스'),
  detail: findFile(z.names, '02_세부정보'),
  spec: findFile(z.names, '03_진료과목정보'),
  equip: findFile(z.names, '05_의료장비정보'),
};
const baseAll = loadCsv(z, F.base, ['암호화요양기호','요양기관명','종별코드','시도코드','시군구코드','주소','치과일반의 인원수','치과전문의 인원수']);
const base = baseAll.filter((r) => DENTAL[r['종별코드']]);
const detailBy = group(loadCsv(z, F.detail, ['암호화요양기호','진료시작시간_월요일','진료종료시간_월요일']));
const specBy = group(loadCsv(z, F.spec, ['암호화요양기호','진료과목코드','진료과목코드명','과목별 전문의수']));
const equipBy = group(loadCsv(z, F.equip, ['암호화요양기호','장비코드','장비코드명','장비대수']));

const observedAt = new Date(opt('--collected', fs.statSync(ZIP).mtime.toISOString())).toISOString();
const importedAt = new Date().toISOString();
const clinics = [];
const ids = new Set();
let discrepancyCount = 0;

for (const r of base) {
  const key = r['암호화요양기호'];
  if (!key) throw new Error('missing 암호화요양기호');
  const id = 'c-' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 12);
  if (ids.has(id)) throw new Error('id collision ' + id);
  ids.add(id);

  const general = int(r['치과일반의 인원수']), intern = int(r['치과인턴 인원수']);
  const resident = int(r['치과레지던트 인원수']), specialist = int(r['치과전문의 인원수']);
  let total = int(r['총의사수']);
  const totalDerived = total == null && [general, intern, resident, specialist].every(x=>x!=null);
  if (total == null && [general, intern, resident, specialist].every((x) => x != null)) total = general + intern + resident + specialist;

  const specRows = specBy.get(key) ?? [];
  const specialties = specRows.map((s) => ({ code: str(s['진료과목코드']), name: str(s['진료과목코드명']), specialists: int(s['과목별 전문의수']) }));
  let discrepancy = false;
  if (specialist != null && specialties.length && specialties.every((s) => s.specialists != null)) {
    discrepancy = specialties.reduce((a, s) => a + s.specialists, 0) !== specialist;
  }
  if (discrepancy) discrepancyCount++;

  const eqRows = equipBy.get(key) ?? [];
  const equipment = eqRows.map((e) => ({ code: str(e['장비코드']), name: str(e['장비코드명']), count: int(e['장비대수']) }));

  const dRows = detailBy.get(key);
  if(dRows&&dRows.length!==1)throw new Error('Multiple detail rows for '+id);
  const d = dRows?.[0] ?? null; // detail file has one row per institution (verified in docs)
  const hours = {}; let hoursAvailable = false; const unclearHours=[];
  for (const [k, ko] of DAYS) {
    const open = d ? hhmm(d[`진료시작시간_${ko}`]) : null;
    const close = d ? hhmm(d[`진료종료시간_${ko}`]) : null;
    if (open && close && close>open) { hours[k] = { open, close }; hoursAvailable = true; } else {hours[k] = { open: null, close: null };if(open&&close)unclearHours.push({day:k,open,close,reason:'종료가 시작보다 늦지 않음. 날짜 넘김 여부 미확인.'});}
  }
  const lunchParts = [];
  if (d && str(d['점심시간_평일'])) lunchParts.push('평일 ' + str(d['점심시간_평일']));
  if (d && str(d['점심시간_토요일'])) lunchParts.push('토 ' + str(d['점심시간_토요일']));
  const parkParts = [];
  if (d && str(d['주차_가능대수'])) parkParts.push('가능대수 ' + str(d['주차_가능대수']));
  if (d && str(d['주차_비용 부담여부'])) parkParts.push('비용부담 ' + str(d['주차_비용 부담여부']));
  if (d && str(d['주차_기타 안내사항'])) parkParts.push(str(d['주차_기타 안내사항']));
  const hoursNotes = {
    lunch: lunchParts.length ? lunchParts.join(' / ') : null,
    holiday: d ? str(d['휴진안내_공휴일']) : null,
    sunday: d ? str(d['휴진안내_일요일']) : null,
    parking: parkParts.length ? parkParts.join(' / ') : null,
    unclearHours,
  };

  const sourceIds = ['hira-base'];
  if (d) sourceIds.push('hira-detail');
  if (specRows.length) sourceIds.push('hira-specialties');
  if (eqRows.length) sourceIds.push('hira-equipment');

  clinics.push({
    id, name: str(r['요양기관명']), typeCode: r['종별코드'], type: DENTAL[r['종별코드']],
    sidoCode: str(r['시도코드']), sido: str(r['시도코드명']), cityCode: str(r['시군구코드']), city: str(r['시군구코드명']),
    dong: str(r['읍면동']), postalCode: str(r['우편번호']), address: str(r['주소']), phone: str(r['전화번호']),
    website: str(r['병원홈페이지']), openedOn: date(r['개설일자']), lat: num(r['좌표(Y)']), lon: num(r['좌표(X)']),
    doctors: { general, intern, resident, specialist, total, totalDerived },
    specialties, equipment, hours, hoursNotes, sourceIds,
    quality: { specialtyCountDiscrepancy: discrepancy, specialtyComparison: specialist==null||!specialties.length||specialties.some(s=>s.specialists==null)?'unavailable':discrepancy?'different':'match', hoursAvailable, hoursUnclearDays:unclearHours.length },
  });
}
clinics.sort((a, b) => (a.id < b.id ? -1 : 1));

// ---------- stats ----------
const cnt = (arr, f) => arr.reduce((a, c) => a + (f(c) ? 1 : 0), 0);
const tally = (arr, f) => { const o = {}; for (const c of arr) { const k = f(c); o[k] = (o[k] ?? 0) + 1; } return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1])); };
const stats = {
  totalClinics: clinics.length,
  byType: tally(clinics, (c) => `${c.typeCode} ${c.type}`),
  fieldCounts: {
    name: cnt(clinics, (c) => c.name), address: cnt(clinics, (c) => c.address), phone: cnt(clinics, (c) => c.phone),
    website: cnt(clinics, (c) => safeWebsite(c.website)), websiteRawNonempty:cnt(clinics,c=>c.website), openedOn: cnt(clinics, (c) => c.openedOn),
    coordinates: cnt(clinics, (c) => c.lat != null && c.lon != null),
    doctorsTotal: cnt(clinics, (c) => c.doctors.total != null), doctorsSpecialist: cnt(clinics, (c) => c.doctors.specialist != null),
    doctorsSpecialistGt0: cnt(clinics, (c) => (c.doctors.specialist ?? 0) > 0),
    withSpecialties: cnt(clinics, (c) => c.specialties.length), withEquipment: cnt(clinics, (c) => c.equipment.length),
    withDetailRecord: cnt(clinics, (c) => c.sourceIds.includes('hira-detail')),
    hoursAvailable: cnt(clinics, (c) => c.quality.hoursAvailable),
    hoursNotesLunch: cnt(clinics, (c) => c.hoursNotes.lunch), hoursNotesSunday: cnt(clinics, (c) => c.hoursNotes.sunday),
    hoursNotesHoliday: cnt(clinics, (c) => c.hoursNotes.holiday), hoursNotesParking: cnt(clinics, (c) => c.hoursNotes.parking),
    specialtyCountDiscrepancy: discrepancyCount,
    totalDoctorDerived:cnt(clinics,c=>c.doctors.totalDerived),
    hoursUnclear:cnt(clinics,c=>c.quality.hoursUnclearDays>0),
  },
  regions: {
    sidoCount: new Set(clinics.map((c) => c.sidoCode)).size,
    cityCount: new Set(clinics.map((c) => c.cityCode)).size,
    bySido: tally(clinics, (c) => c.sido),
  },
  equipmentTop: tally(clinics.flatMap((c) => c.equipment), (e) => e.name),
};

// ---------- validation ----------
const bad = [];
if (clinics.some((c) => !DENTAL[c.typeCode])) bad.push('non-dental type present');
if (new Set(clinics.map((c) => c.id)).size !== clinics.length) bad.push('duplicate ids');
if (clinics.some((c) => !c.name || !c.address)) bad.push('missing name/address');
if (clinics.some(c=>c.quality.hoursAvailable!==Object.values(c.hours).some(h=>h.open&&h.close))) bad.push('hours flag inconsistent');
if(clinics.some(c=>Object.values(c.hours).some(h=>h.open&&h.close&&h.close<=h.open)))bad.push('invalid same-day hours');
if(clinics.some(c=>c.lat!=null&&(c.lat< -90||c.lat>90)||c.lon!=null&&(c.lon< -180||c.lon>180)))bad.push('invalid coordinates');
if(clinics.length<15000||clinics.length>30000)bad.push('Unexpected dental row count, manual review required');
if (bad.length) { console.error('VALIDATION FAILED', bad); process.exit(1); }

// ---------- write ----------
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'clinics.json'), JSON.stringify({ snapshotDate: SNAPSHOT, observedAt, clinics }));
const titles = {
  'hira-base': ['건강보험심사평가원_전국 병의원 및 약국 현황 - 병원정보서비스', F.base],
  'hira-detail': ['건강보험심사평가원_전국 병의원 및 약국 현황 - 의료기관별상세정보 02 세부정보', F.detail],
  'hira-specialties': ['건강보험심사평가원_전국 병의원 및 약국 현황 - 의료기관별상세정보 03 진료과목정보', F.spec],
  'hira-equipment': ['건강보험심사평가원_전국 병의원 및 약국 현황 - 의료기관별상세정보 05 의료장비정보', F.equip],
};
const manifest = {
  generatedBy: 'scripts/import-hira.mjs',
  snapshotDate: SNAPSHOT,
  observedAt,
  importedAt,
  attribution: '출처: 건강보험심사평가원, 공공데이터포털(data.go.kr) 「전국 병의원 및 약국 현황」',
  archive: { fileName: path.basename(ZIP), sha256: z.sha256, size: z.size, entryCount: z.names.length },
  sources: Object.entries(titles).map(([id, [title, fileName]]) => ({ id, title, url: PAGE_URL, fileName, snapshotDate: SNAPSHOT, observedAt, license: LICENSE })),
  stats: { ...stats, sourceRowCounts: { baseAllTypes: baseAll.length, detail: detailBy.size, specialtyOrgs: specBy.size, equipmentOrgs: equipBy.size } },
  exclusions: [
    '종별코드 41(치과병원)·51(치과의원)만 포함. 종합병원 등 다른 종별의 치과 진료과목 기관은 제외(진료과목 기반 약 406곳은 별도 미포함).',
    '약국정보, 시설정보(병상), 교통정보, 식대가산, 간호등급, 특수진료, 전문병원지정분야, 기타인력 파일은 미사용.',
    '비급여 가격은 이 파일 묶음에 없음: 가격 필드를 만들지 않음.',
  ],
  limitations: [
    '분기 스냅샷이며 월말 집계와 차이가 있을 수 있음. 공개 목록에 있는 과거 분기 파일은 제공되지만 목록 밖의 임의 과거시점 자료는 제공하지 않음.',
    '요양기호는 암호화 값이며 복호화 불가. id는 암호화요양기호의 SHA-256 앞 12자리로 만든 내부 식별자.',
    '진료시간은 시작·종료가 유효하고 같은 날 종료가 시작보다 늦은 경우만 정규화. 날짜 넘김 여부가 불명확한 값은 null 처리하고 hoursNotes.unclearHours에 원래 시간을 보존.',
    '장비는 원본에 등록된 항목만 기록하며 미등록을 0대로 추정하지 않음. 사실상 콘빔CT 중심.',
    '전문의 수: doctors.specialist(병원정보) 와 진료과목별 전문의 합계가 다르면 quality.specialtyCountDiscrepancy 플래그만 설정하고 값은 수정하지 않음.',
    '병원 홈페이지·전화번호는 기관이 신고한 값으로 공란이 많거나 오래된 값일 수 있음. website 통계는 안전하게 HTTP(S) URL로 해석되는 주소만 포함하며 실제 사이트 운영 확인 건수는 아님.',
    '총의사수 원자료가 비어 있고 치과의사 구성 값이 모두 있으면 합산하고 doctors.totalDerived로 표시. 필수 CSV 컬럼과 행 너비·중복 키를 검증함.',
    '수집 시각 observedAt은 --collected 인수를 우선하며 없으면 원본 ZIP 파일의 수정 시각을 사용. importedAt은 가공 실행 시각임.',
  ],
};
fs.writeFileSync(path.join(root, 'data', 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`clinics=${clinics.length} types=${JSON.stringify(stats.byType)} sido=${stats.regions.sidoCount} city=${stats.regions.cityCount}`);
console.log(`hours=${stats.fieldCounts.hoursAvailable} specialties=${stats.fieldCounts.withSpecialties} equipment=${stats.fieldCounts.withEquipment} discrepancy=${discrepancyCount}`);
console.log(`elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
