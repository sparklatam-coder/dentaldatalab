import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildYangjuAnalysis, YANGJU_REPORT_ROUTE } from '../scripts/yangju-analysis.mjs';
import { registerYangjuAnalysisPage } from '../scripts/yangju-analysis-pages.mjs';
import { loadAssetInventory } from '../scripts/clinic-assets.mjs';
import { collectReports } from '../scripts/report-data.mjs';
import { registerReportPages } from '../scripts/report-pages.mjs';

const metadata = { snapshotDate: '2026-09-30', observedAt: '2026-10-31T00:00:00Z', sourceSha256: 'a'.repeat(64) };
const clinic = (id, overrides = {}) => ({ id, sidoCode: '310000', cityCode: '312700', typeCode: '51', dong: '옥정동', hours: {}, doctors: {}, ...overrides });
const observation = (id, overrides = {}) => ({ sourceUrl: `https://m.place.naver.com/hospital/${id}/home`, bodyStatus: 'read', identityMatch: true, checkedAt: '2026-11-01T01:00:00Z', fields: { hours: '매주 다른 원문 안내. 주간 시간표 추정 금지.' }, ...overrides });

function fixture() {
  const clinics = [
    clinic('a', { hours: { mon: { open: '09:00', close: '19:00' }, sat: { open: '09:00', close: '13:00' } } }),
    clinic('b', { typeCode: '41', dong: '덕정동' }),
    clinic('c', { dong: '덕정동', hours: { tue: { open: '09:00', close: '18:00' } } }),
    clinic('d', { dong: null, hours: { mon: { open: '00:00', close: '19:00' } } }),
    clinic('outside', { sidoCode: '110000', address: '양주시 같은 주소로 추정하면 안 됨' }),
    clinic('nonDental', { typeCode: '01' }),
  ];
  const inventory = { records: [
    { clinicId: 'a', naverPlaceObservations: [observation('1001')] },
    { clinicId: 'b', naverPlaceObservations: [observation('1002', { identityMatch: false })] },
    { clinicId: 'c', naverPlaceObservations: [observation('1003')], assets: [{ kind: 'naverMap', ownership: 'third_party', url: 'https://m.place.naver.com/hospital/1003/home', checkedAt: '2026-11-02T01:00:00Z' }] },
    { clinicId: 'd', naverPlaceObservations: [observation('1004'), observation('1004', { checkedAt: '2026-11-02T01:00:00Z', bodyStatus: 'failed' })] },
  ] };
  return { clinics, inventory };
}

function parseCsv(value) {
  assert.equal(value.charCodeAt(0), 0xfeff);
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 1; i < value.length; i++) {
    const char = value[i];
    if (char === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && value[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += char;
  }
  assert.equal(quoted, false);
  assert.equal(cell, '');
  assert.equal(row.length, 0);
  return rows;
}

test('Yangju analysis fixes source-code population and separates night registration from Naver text coverage', () => {
  const { clinics, inventory } = fixture(), before = JSON.stringify({ clinics, inventory });
  const a = buildYangjuAnalysis(clinics, inventory, metadata);
  assert.equal(a.scope.total, 4);
  assert.deepEqual(a.coverage, { both: 1, registeredOnly: 1, naverOnly: 1, neither: 1 });
  assert.equal(a.registered.hours, 2);
  assert.equal(a.registered.night, 1, '19:00 is included; midnight placeholder is excluded');
  assert.equal(a.naver.hours, 2, 'Candidates and corrected third-party identity are excluded; failed refresh retains prior evidence');
  assert.deepEqual(a.evidence.map(row => row.clinicId), ['a', 'd']);
  assert.deepEqual(a.byDong.map(row => [row.name, row.total]), [['덕정동', 2], ['옥정동', 1], ['읍면동 미표기', 1]]);
  assert.equal(a.weekdays.find(row => row.day === 'mon').weekdayNineteenOrLater, 1);
  assert.equal(a.weekdays.find(row => row.day === 'sat').weekdayNineteenOrLater, null);
  assert.equal(JSON.stringify({ clinics, inventory }), before);
  assert.deepEqual(buildYangjuAnalysis([...clinics].reverse(), { records: [...inventory.records].reverse(), generatedAt: '2099-01-01' }, metadata), a, 'Build-clock metadata and array order never alter the analysis');
  assert.throws(() => buildYangjuAnalysis([...clinics, clinics[0]], inventory, metadata), /Duplicate HIRA/);
});

test('empty and missing observation sources remain explicit with unavailable denominators', () => {
  const a = buildYangjuAnalysis([], null, metadata);
  assert.equal(a.scope.total, 0);
  assert.equal(a.naver.available, false);
  assert.equal(a.naver.percentOfTotal, null);
  assert.equal(a.registered.nightPercentOfTotal, null);
  assert.equal(a.naver.latestCheckedAt, null);
});

test('analysis page exports actual aggregates and references while preserving escaped labels and source distinctions', () => {
  const f = fixture();
  f.clinics[0].dong = '<script>alert(1)</script>, "동"\n다음 줄';
  const a = buildYangjuAnalysis(f.clinics, f.inventory, metadata), pages = new Map(), files = new Map();
  registerYangjuAnalysisPage({ analysis: a, domain: 'https://example.test', page: (route, options) => pages.set(route, options), put: (file, value) => files.set(file, value) });
  const page = pages.get(YANGJU_REPORT_ROUTE);
  assert.match(page.body, /시간표의 일치율이나 현재 영업 비율을 계산한 자료가 아닙니다/);
  assert.match(page.body, /행을 더해 기관 수로 해석하면 안 됩니다/);
  assert.match(page.body, /네이버 원문을 주간 시간표나 야간 조건으로 새로 변환하지 않았습니다/);
  assert.match(page.body, /19:00 종료도 포함/);
  assert.doesNotMatch(page.body, /<script>alert|NaN|Infinity|undefined|null%/);
  assert.match(page.body, /&lt;script&gt;/);
  const data = JSON.parse(files.get('data/reports/yangju-hours-evidence.json'));
  assert.deepEqual(data, a);
  const csv = files.get('data/reports/yangju-hours-evidence.csv');
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /""동""/);
  assert.ok(csv.endsWith('\r\n'), 'Actual CRLF terminates the file');
  assert.ok(!csv.startsWith('\\uFEFF'), 'The BOM is not a literal escape string');
  assert.ok(!csv.includes('\\r\\n'), 'Record boundaries are not literal escape strings');
  const csvRows = parseCsv(csv);
  assert.equal(csvRows.length, 1 + a.byDong.length + a.weekdays.length + 5 + Object.keys(a.coverage).length);
  assert.ok(csvRows.every(row => row.length === 6));
  assert.equal(csvRows.find(row => row[0] === '읍면동분포' && row[1].includes('<script>'))[1], f.clinics[0].dong, 'Comma, quote and embedded newline round-trip as one cell');
  const coverageRows = csvRows.filter(row => row[0] === '출처별시간수록');
  assert.equal(coverageRows.reduce((sum, row) => sum + Number(row[2]), 0), a.scope.total);
  assert.ok(coverageRows.every(row => Number(row[3]) === a.scope.total));
  assert.equal(page.schema[0].temporalCoverage, undefined, 'Composite sources are not falsely assigned one shared observation date');
  for (const distribution of page.schema[0].distribution) assert.ok(files.has(new URL(distribution.contentUrl).pathname.slice(1)));
});

test('existing report registration gains one substantial linked analysis only when both inputs are supplied', () => {
  const f = fixture(), rows = f.clinics.filter(row => ['41', '51'].includes(row.typeCode));
  const reports = collectReports(rows, metadata);
  const pages = new Map(), files = new Map();
  registerReportPages({ reports, clinics: rows, assetInventory: f.inventory, domain: 'https://example.test', page: (route, options) => pages.set(route, options), put: (file, value) => files.set(file, value) });
  assert.equal(pages.size, 4);
  assert.equal(files.size, 10); // Three versioned artifacts and a version index supplement existing CSV/JSON.
  assert.ok(pages.get('/reports/').body.includes(YANGJU_REPORT_ROUTE));
  assert.ok(pages.has(YANGJU_REPORT_ROUTE));
});

test('real Yangju source reconciles with the existing regional report and all independent partitions', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const data = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url)));
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/source-manifest.json', import.meta.url)));
  const provenance = { ...data, sourceSha256: manifest.archive.sha256 };
  const inventory = loadAssetInventory(root, data);
  const a = buildYangjuAnalysis(data.clinics, inventory, provenance);
  const previous = collectReports(data.clinics, provenance).northernGyeonggi.cities.find(row => row.id === 'yangju');
  assert.equal(a.scope.total, 67);
  assert.equal(a.scope.clinic + a.scope.hospital, a.scope.total);
  assert.equal(a.registered.hours, previous.metrics.hours.count);
  assert.equal(a.registered.night, previous.metrics.night.count);
  assert.equal(Object.values(a.coverage).reduce((sum, n) => sum + n, 0), 67);
  assert.equal(a.byDong.reduce((sum, row) => sum + row.total, 0), 67);
  assert.equal(a.byDong.reduce((sum, row) => sum + row.naverHours, 0), a.naver.hours);
  assert.equal(a.evidence.length, a.naver.hours);
  assert.ok(a.naver.hours <= 67);
  for (const row of a.weekdays) assert.equal(row.registered + row.missing, 67);
});
