import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectReports, hasValidHours, NORTHERN_GYEONGGI_CITIES } from '../scripts/report-data.mjs';

const metadata = {
  snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:27:09.045Z', sourceSha256: 'fixture-hash',
};
const clinic = overrides => ({
  id: 'fixture', name: '개별 기관명은 집계에 포함하지 않음', typeCode: '51',
  sidoCode: '310000', sido: '경기', cityCode: '312700', city: '양주시',
  doctors: { specialist: null }, hours: {}, website: null, ...overrides,
});
const interval = (open, close) => ({ open, close });

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('valid same-day hours preserve the importer boundary without inferring overnight hours', () => {
  for (const hours of [undefined, {}, interval(null, '19:00'), interval('09:00', null), interval('09:00', '09:00'), interval('20:00', '02:00'), interval('09:00', '19:99'), interval('9:00', '19:00'), interval('00:00', '19:00'), interval('09:00', '24:01')]) {
    assert.equal(hasValidHours(hours), false, JSON.stringify(hours));
  }
  assert.equal(hasValidHours(interval('09:00', '19:00')), true);
  assert.equal(hasValidHours(interval('09:00', '24:00')), true);
});

test('recorded zero, unknown values, invalid times and the 19:00 threshold have distinct denominators', () => {
  const input = deepFreeze([
    clinic({}),
    clinic({ doctors: { specialist: 0 }, hours: { mon: interval('09:00', '18:59') }, website: 'http://' }),
    clinic({ doctors: { specialist: 2 }, hours: { tue: interval('09:00', '19:00'), sat: interval('09:00', '13:00') }, website: 'example.org' }),
    clinic({ doctors: { specialist: -1 }, hours: { wed: interval('20:00', '02:00'), sun: interval('09:00', '12:00') }, website: 'javascript:alert(1)' }),
    clinic({ hours: { thu: interval('09:00', '19:99'), sat: interval(null, '13:00') } }),
    clinic({ typeCode: '41', doctors: { specialist: 1 }, hours: { sat: interval('09:00', '13:00') }, website: 'https://valid.org' }),
  ]);
  const result = collectReports(input, metadata);
  const { total, types, metrics } = result.national;
  assert.equal(total, 6);
  assert.deepEqual(types, { clinic: 5, hospital: 1 });
  assert.deepEqual(metrics.specialist, { count: 2, known: 3, unknown: 3, total: 6, percentOfTotal: 33.3, percentOfKnown: 66.7 });
  assert.deepEqual(metrics.night, { count: 1, known: 2, unknown: 4, total: 6, percentOfTotal: 16.7, percentOfKnown: 50 });
  assert.equal(metrics.hours.count, 4);
  assert.equal(metrics.saturday.count, 2);
  assert.equal(metrics.sunday.count, 1);
  assert.deepEqual(metrics.website, { count: 2, known: 4, unknown: 2, total: 6, percentOfTotal: 33.3, percentOfKnown: 50 });
  assert(!JSON.stringify(result).includes(input[0].name));
  assert(!JSON.stringify(result).includes('fixture"'));
  assert.equal(result.sourceSha256, metadata.sourceSha256);
});

test('empty denominators yield null instead of invented 0% or NaN', () => {
  const result = collectReports([], metadata);
  for (const scope of [result.national, result.northernGyeonggi, ...result.northernGyeonggi.cities]) {
    assert.equal(scope.total, 0);
    for (const metric of Object.values(scope.metrics)) {
      assert.equal(metric.count, 0);
      assert.equal(metric.unknown, 0);
      assert.equal(metric.percentOfTotal, null);
      assert.equal(metric.percentOfKnown, null);
    }
  }
  const noData = collectReports([clinic({})], metadata).national.metrics.night;
  assert.equal(noData.percentOfTotal, 0);
  assert.equal(noData.percentOfKnown, null);
  assert.equal(noData.unknown, 1);
});

test('northern scope requires both source codes and combines only the three named Goyang districts', () => {
  const scoped = NORTHERN_GYEONGGI_CITIES.flatMap(city => city.cityCodes.map(cityCode => clinic({ cityCode })));
  const input = [
    ...scoped,
    clinic({ sidoCode: '110000', cityCode: '312700' }),
    clinic({ cityCode: '310604', address: '경기도 양주시처럼 보이는 주소' }),
  ];
  const result = collectReports(input, metadata);
  assert.equal(result.national.total, 14);
  assert.equal(result.northernGyeonggi.total, 12);
  assert.equal(result.northernGyeonggi.cities.length, 10);
  assert.equal(result.northernGyeonggi.cities.find(city => city.id === 'goyang').total, 3);
  assert.equal(result.northernGyeonggi.cities.find(city => city.id === 'yangju').total, 1);
  assert.equal(result.northernGyeonggi.cities.reduce((sum, city) => sum + city.total, 0), 12);
});

test('mixed source region names are disclosed without reclassifying the records', () => {
  const result = collectReports([
    clinic({ sidoCode: '360000', sido: '전남광주' }),
    clinic({ sidoCode: '360000', sido: '전남광주' }),
    clinic({ sidoCode: '360000', sido: '전남' }),
  ], metadata);
  assert.equal(result.national.total, 3);
  assert.equal(result.northernGyeonggi.total, 0);
  assert.equal(result.regionIssues.length, 1);
  assert.equal(result.regionIssues[0].code, '360000');
  assert.equal(result.regionIssues[0].total, 3);
  assert.deepEqual(result.regionIssues[0].labels, [{ name: '전남', count: 1 }, { name: '전남광주', count: 2 }]);
});

test('non-dental records fail loudly instead of silently changing the stated population', () => {
  assert.throws(() => collectReports([clinic({ typeCode: '01' })], metadata), /types 41 and 51/);
});

test('real snapshot reconciles with the source manifest and every city sum', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/source-manifest.json', import.meta.url), 'utf8'));
  const result = collectReports(source.clinics, { ...source, sourceSha256: manifest.archive.sha256 });
  const national = result.national;
  assert.equal(national.total, manifest.stats.totalClinics);
  assert.equal(national.types.clinic, manifest.stats.byType['51 치과의원']);
  assert.equal(national.types.hospital, manifest.stats.byType['41 치과병원']);
  assert.equal(national.metrics.specialist.count, manifest.stats.fieldCounts.doctorsSpecialistGt0);
  assert.equal(national.metrics.hours.count, manifest.stats.fieldCounts.hoursAvailable);
  assert.equal(national.metrics.website.count, manifest.stats.fieldCounts.website);
  assert.equal(national.metrics.website.known, manifest.stats.fieldCounts.websiteRawNonempty);
  // These figures are intentionally scoped to the handoff snapshot, not future imports.
  if (source.snapshotDate === '2026-09-30') {
    assert.equal(national.metrics.night.count, 2444);
    assert.equal(national.metrics.night.known, 4740);
    assert.equal(national.metrics.saturday.count, 4407);
    assert.equal(national.metrics.sunday.count, 174);
    assert.equal(result.northernGyeonggi.total, 1190);
    assert.equal(result.northernGyeonggi.metrics.hours.count, 252);
    assert.equal(result.northernGyeonggi.metrics.night.count, 148);
    assert.equal(result.northernGyeonggi.metrics.night.known, 250);
  }
  const northern = result.northernGyeonggi;
  assert.equal(northern.total, northern.cities.reduce((sum, city) => sum + city.total, 0));
  for (const key of Object.keys(northern.metrics)) {
    for (const field of ['count', 'known', 'unknown', 'total']) {
      assert.equal(northern.metrics[key][field], northern.cities.reduce((sum, city) => sum + city.metrics[key][field], 0), key + '.' + field);
    }
  }
  for (const scope of [national, northern, ...northern.cities]) {
    assert.equal(scope.total, scope.types.clinic + scope.types.hospital);
    for (const metric of Object.values(scope.metrics)) {
      assert(metric.count <= metric.known);
      assert.equal(metric.known + metric.unknown, scope.total);
    }
  }
});
