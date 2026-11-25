import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectReports } from '../scripts/report-data.mjs';
import { registerReportPages, homePage } from '../scripts/report-pages.mjs';
import { SOURCE_URL, esc } from '../src/shared.mjs';

const domain = 'https://dentaldatalab.example';
const metadata = {
  snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:27:09.045Z', sourceSha256: 'a'.repeat(64),
};
const institutionName = '개별기관비공개표식 <script>privateRecord()</script>';
const clinic = (id, overrides = {}) => ({
  id, name: institutionName, address: '개별주소비공개표식', typeCode: '51',
  sidoCode: '310000', sido: '경기', cityCode: '312700',
  doctors: { specialist: null }, hours: {}, website: null, ...overrides,
});
const interval = (open, close) => ({ open, close });
const fixture = () => collectReports([
  clinic('private-a', { doctors: { specialist: 0 }, hours: { mon: interval('09:00', '18:00') }, website: 'http://' }),
  clinic('private-b', { typeCode: '41', doctors: { specialist: 2 }, hours: { tue: interval('09:00', '19:00'), sat: interval('09:00', '13:00') }, website: 'https://example.org' }),
  clinic('private-c', { cityCode: '311901', hours: { sun: interval('09:00', '12:00') } }),
  clinic('private-d'),
  clinic('private-e', { sidoCode: '110000', cityCode: '110001' }),
], metadata);

function render(reports, options = {}) {
  const pages = new Map(), files = new Map();
  registerReportPages({
    reports, domain, ...options,
    page: (route, options) => { assert(!pages.has(route)); pages.set(route, options); },
    put: (path, value) => { assert(!files.has(path)); files.set(path, value); },
  });
  return { pages, files };
}

// Parse as a CSV consumer would: delimiters/newlines inside quoted cells are data.
function parseCsv(value) {
  assert.equal(value.charCodeAt(0), 0xfeff, 'UTF-8 BOM helps Korean spreadsheet imports');
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 1; i < value.length; i++) {
    const ch = value[i];
    if (ch === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && ch === ',') { row.push(cell); cell = ''; }
    else if (!quoted && ch === '\r' && value[i + 1] === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; i++;
    } else cell += ch;
  }
  assert.equal(quoted, false);
  assert.equal(cell, '');
  assert.equal(row.length, 0);
  return rows;
}

test('downloaded CSV and JSON preserve metric-specific denominators, zero and missing data', () => {
  const reports = fixture();
  const { files } = render(reports);
  assert.equal(files.size, 8, 'CSV and JSON for each of the four reports');
  const data = JSON.parse(files.get('data/reports/northern-gyeonggi-hours.json'));
  assert.deepEqual(data.scope, reports.northernGyeonggi);
  assert.equal(data.scope.total, 4);
  assert.deepEqual(data.scope.metrics.night, {
    count: 1, known: 2, unknown: 2, total: 4, percentOfTotal: 25, percentOfKnown: 50,
  });
  assert.equal(data.scope.metrics.specialist.known, 2, 'Explicit zero is a known value');
  assert.equal(data.scope.metrics.website.known, 2, 'Malformed nonempty URL remains recorded data');
  assert.equal(data.scope.metrics.website.count, 1);
  assert.equal(data.sourceUrl, SOURCE_URL);
  assert.equal(data.sourceSha256, metadata.sourceSha256);
  assert.equal(data.observedAt, metadata.observedAt);
  assert.match(data.definitions.night.knownDefinition, /월~금.*하루 이상/);
  assert.match(data.definitions.saturday.limitation, /미수록.*휴진으로 보지 않/);

  const rows = parseCsv(files.get('data/reports/northern-gyeonggi-hours.csv'));
  assert.equal(rows.length, 1 + 11 * 6, 'Aggregate plus ten cities, with six metrics each');
  assert(rows.every(row => row.length === 14));
  const night = rows.find(row => row[1] === '경기북부 10개 시·군' && row[3] === '평일 19시 이후 종료 등록');
  assert.deepEqual(night.slice(0, 9), [metadata.snapshotDate, '경기북부 10개 시·군', '4', '평일 19시 이후 종료 등록', '1', '2', '2', '25', '50']);
  assert.match(night[10], /월~금.*하루 이상/);
  assert.match(night[11], /실제 운영 비율이 아/);
  assert.deepEqual(night.slice(-2), [SOURCE_URL, metadata.sourceSha256]);
  const emptyCity = rows.find(row => row[1] === '가평군');
  assert.equal(emptyCity[2], '0');
  assert.deepEqual(emptyCity.slice(4, 9), ['0', '0', '0', '', ''], 'Undefined ratios are empty cells, not fabricated zero percentages');
});

test('Dataset metadata links the actual aggregate downloads and states date, geography and source', () => {
  const { pages, files } = render(fixture());
  assert.equal(pages.size, 5);
  const hoursReports = ['/reports/national-data-coverage/', '/reports/northern-gyeonggi-hours/'];
  for (const [route, page] of pages) {
    if (route === '/reports/') continue;
    const dataset = page.schema.find(item => item['@type'] === 'Dataset');
    assert(dataset);
    assert.equal(dataset['@context'], 'https://schema.org');
    assert.equal(dataset.url, domain + route);
    assert.equal(dataset['@id'], domain + route + '#dataset');
    assert.equal(dataset.temporalCoverage, metadata.snapshotDate);
    assert.equal(dataset.isBasedOn.url, SOURCE_URL);
    assert.equal(dataset.creator.name, '치과데이터랩');
    assert(dataset.spatialCoverage.name);
    assert.equal(dataset.distribution.length, 2);
    for (const item of dataset.distribution) {
      const url = new URL(item.contentUrl);
      assert.equal(url.origin, domain);
      assert(files.has(url.pathname.slice(1)));
      assert.equal(item.encodingFormat, url.pathname.endsWith('.csv') ? 'text/csv' : 'application/json');
    }
    assert.match(page.body, /자료가 없는 기관도 모집단에 포함/);
    assert.match(page.body, /평가하지 않/);
    assert.match(page.body, /id="report-methodology"/);
    assert(page.body.includes(metadata.sourceSha256));
    if (hoursReports.includes(route)) {
      assert.match(page.body, /공란을 휴진으로 바꾸지 않/);
      assert.match(page.body, /19:00 종료도 포함/);
    }
  }
  const northern = pages.get('/reports/northern-gyeonggi-hours/').body;
  assert.match(northern, /4곳 중.*1곳\(25\.0%\)/);
  assert.match(northern, /2곳을 분모로 하면 50\.0%/);
});

test('report outputs contain only aggregates and never expose institution records or promote individual clinics', () => {
  const { pages, files } = render(fixture());
  const allOutput = [...pages.values()].map(page => JSON.stringify(page)).join('\n') + [...files.values()].join('\n');
  for (const forbidden of [institutionName, esc(institutionName), 'private-a', 'private-b', '개별주소비공개표식', '/clinics/']) {
    assert(!allOutput.includes(forbidden), forbidden);
  }
});

test('HTML escapes labels and hashes while CSV quoted cells and JSON retain exact original text', () => {
  const reports = fixture();
  const name = '검토 "지역", <img src=x onerror=alert(1)> & 범위\n둘째 줄';
  const sourceHash = '</code><script>hashInjection()</script>';
  reports.northernGyeonggi.name = name;
  reports.northernGyeonggi.cities[0].name = name;
  reports.sourceSha256 = sourceHash;
  const { pages, files } = render(reports);
  const page = pages.get('/reports/northern-gyeonggi-hours/');
  assert(!page.body.includes('<img src=x'));
  assert(!page.body.includes('<script>hashInjection()'));
  assert(page.body.includes(esc(name)));
  assert(page.body.includes(esc(sourceHash)));
  assert.equal(page.schema[0].spatialCoverage.name, name, 'Schema is an object for the shell JSON serializer');
  const rows = parseCsv(files.get('data/reports/northern-gyeonggi-hours.csv'));
  assert.equal(rows.length, 67);
  assert.equal(rows[1][1], name);
  assert.equal(rows[1].at(-1), sourceHash);
  const json = JSON.parse(files.get('data/reports/northern-gyeonggi-hours.json'));
  assert.equal(json.scope.name, name);
  assert.equal(json.sourceSha256, sourceHash);
});

test('report provenance wording follows the build mode: local review copy by default, public copy when indexing is enabled', () => {
  const route = '/reports/national-data-coverage/';
  const local = render(fixture()).pages.get(route).body, open = render(fixture(), { indexingEnabled: true }).pages.get(route).body;
  assert.match(local, /최초 작성한 로컬 검토본\./);
  assert.doesNotMatch(open, /로컬 검토본/);
  assert.match(open, /최초 작성한 공개본\./);
  assert.equal(local.replace('로컬 검토본', '공개본'), open, 'only the provenance wording differs');
});

test('empty populations render unavailable ratios without NaN, Infinity or invalid chart widths', () => {
  const reports = collectReports([], metadata);
  const { pages, files } = render(reports);
  for (const page of pages.values()) {
    assert.doesNotMatch(page.body, /NaN|Infinity|null%|undefined/);
    if (page.schema) assert.match(page.body, /산출 불가/);
  }
  assert.doesNotMatch(homePage(reports, ''), /NaN|Infinity|null%|undefined/);
  for (const [path, value] of files) {
    if (!path.endsWith('.csv')) continue;
    const rows = parseCsv(value);
    assert(rows[0][7].endsWith('(%)') && rows[0][8].endsWith('(%)'), path + ' keeps the shared percentage columns');
    for (const row of rows.slice(1)) assert.deepEqual(row.slice(7, 9), ['', '']);
  }
});

test('dental hospital reports publish computed aggregates with denominators, sourced external facts and no superiority claims', () => {
  const reports = fixture();
  const { pages, files } = render(reports);
  const g = reports.dentalHospitals;
  assert.equal(g.total, 1);
  assert.equal(g.types.clinic, 4);
  assert.deepEqual(g.hospitals.specialist, { known: 1, mean: 2, median: 2, min: 2, max: 2, atLeastOne: { count: 1, known: 1, unknown: 0, total: 1, percentOfTotal: 100, percentOfKnown: 100 }, atLeastThree: { count: 0, known: 1, unknown: 0, total: 1, percentOfTotal: 0, percentOfKnown: 0 } });
  assert.equal(g.clinics.specialist.known, 1, 'null specialist counts are unknown, not zero');
  assert.deepEqual(g.hospitals.cbct.registered, { count: 0, known: 0, unknown: 1, total: 1, percentOfTotal: 0, percentOfKnown: null }, 'no equipment row is unknown, never "none"');

  const all = pages.get('/reports/dental-hospitals/');
  assert.equal(all.title, '치과병원 1곳 전수 리포트', 'headline count comes from the data');
  assert.match(all.description, /치과병원 1곳.*전문의 등록 평균 2명/);
  assert.match(all.body, /href="\/find\/\?type=41"/);
  assert.match(all.body, /진료 실력·현재 운영 상태가 아닙니다/);
  assert.match(all.body, /1999년 이전[\s\S]*2020년 이후[\s\S]*미확인/);
  assert.doesNotMatch(all.body, /더 안전|더 실력|믿을 수 있는|우수한 치과/);
  const dataset = all.schema.find(item => item['@type'] === 'Dataset');
  assert.equal(dataset.name, all.title);
  const json = JSON.parse(files.get('data/reports/dental-hospitals.json'));
  assert.equal(json.scope.total, 1);
  assert.equal(json.definitions.cbct, g.definitions.cbct);
  const rows = parseCsv(files.get('data/reports/dental-hospitals.csv'));
  assert(rows.every(row => row.length === 14));
  const mean = rows.find(row => row[1] === '치과병원' && row[3] === '치과전문의 등록 평균');
  assert.deepEqual(mean.slice(2, 10), ['1', '치과전문의 등록 평균', '2', '1', '0', '', '', '명']);
  const share = rows.find(row => row[1] === '치과의원' && row[3] === '전문의 1명 이상 등록');
  assert.deepEqual(share.slice(2, 9), ['4', '전문의 1명 이상 등록', '0', '1', '3', '0', '0']);

  const vs = pages.get('/reports/dental-hospital-vs-clinic/');
  assert.match(vs.body, /30개 이상의 병상\(병원ㆍ한방병원만 해당한다\)/);
  assert.match(vs.body, /동지역 40% · 읍·면지역 35%/);
  assert.match(vs.body, /2차 자료, 고시 원문 대조 전/);
  assert.match(vs.body, /20%·15%는 현행이 아닙니다/);
  assert.match(vs.body, /의료법 제56조/);
  assert.doesNotMatch(vs.body, /더 안전|더 실력|믿을 수 있는|고려하세요|추천/);
  for (const fact of reports.externalFacts) assert(vs.body.includes(esc(fact.sourceUrl)), fact.id);
  const faq = vs.schema.find(item => item['@type'] === 'FAQPage');
  assert.equal(vs.schema[0]['@type'], 'Dataset', 'Dataset stays first for the shell mainEntity');
  assert.equal(faq.mainEntity.length, 5);
  assert.match(faq.mainEntity.find(q => q.name.includes('30병상')).acceptedAnswer.text, /병상 수 요건이 없습니다/);
  assert.match(faq.mainEntity.find(q => q.name.includes('몇 곳')).acceptedAnswer.text, /치과병원은 1곳, 치과의원은 4곳/);
  const vsJson = JSON.parse(files.get('data/reports/dental-hospital-vs-clinic.json'));
  assert.deepEqual(vsJson.externalFacts, reports.externalFacts);
  assert.equal(vsJson.faq.length, 5);
  const vsRows = parseCsv(files.get('data/reports/dental-hospital-vs-clinic.csv'));
  assert.equal(vsRows.length, 1 + reports.externalFacts.length * 2 + 16);
  assert(vsRows.slice(1, 9).every(row => row[12].startsWith('https://') && row[13].startsWith('확인 2026-')));
});

test('real snapshot exports reconcile with source provenance and visible report totals', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/source-manifest.json', import.meta.url), 'utf8'));
  const reports = collectReports(source.clinics, { ...source, sourceSha256: manifest.archive.sha256 });
  const { pages, files } = render(reports);
  const data = JSON.parse(files.get('data/reports/national-data-coverage.json'));
  assert.equal(data.scope.total, manifest.stats.totalClinics);
  assert.equal(data.scope.metrics.hours.count, manifest.stats.fieldCounts.hoursAvailable);
  assert.equal(data.sourceSha256, manifest.archive.sha256);
  assert.equal(data.snapshotDate, manifest.snapshotDate);
  assert.equal(data.observedAt, manifest.observedAt);
  const nationalPage = pages.get('/reports/national-data-coverage/');
  assert(nationalPage.description.includes(data.scope.total.toLocaleString('ko-KR') + '곳'));
  const rows = parseCsv(files.get('data/reports/national-data-coverage.csv'));
  assert.equal(rows.length, 7);
  for (const row of rows.slice(1)) {
    assert.equal(Number(row[2]), manifest.stats.totalClinics);
    assert.equal(Number(row[5]) + Number(row[6]), Number(row[2]));
    assert.equal(row.at(-2), SOURCE_URL);
    assert.equal(row.at(-1), manifest.archive.sha256);
    assert.equal(Number(row[7]), Math.round(Number(row[4]) / Number(row[2]) * 1000) / 10);
    assert.equal(Number(row[8]), Math.round(Number(row[4]) / Number(row[5]) * 1000) / 10);
  }
});
