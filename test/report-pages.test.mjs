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

function render(reports) {
  const pages = new Map(), files = new Map();
  registerReportPages({
    reports, domain,
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
  assert.equal(files.size, 4);
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
  assert.equal(pages.size, 3);
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
    assert.match(page.body, /공란을 휴진으로 바꾸지 않/);
    assert.match(page.body, /19:00 종료도 포함/);
    assert.match(page.body, /평가하지 않/);
    assert(page.body.includes(metadata.sourceSha256));
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
    for (const row of parseCsv(value).slice(1)) assert.deepEqual(row.slice(7, 9), ['', '']);
  }
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
