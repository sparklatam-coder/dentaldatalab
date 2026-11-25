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

test('dental hospital aggregates keep every denominator explicit and never name an institution', () => {
  const input = deepFreeze([
    clinic({ typeCode: '41', name: '서울대학교치과병원처럼 보이는 이름', sidoCode: '110000', sido: '서울', cityCode: '110001', city: '종로구', doctors: { specialist: 10 }, equipment: [{ code: 'B109', name: '콘빔CT', count: 2 }], openedOn: '1999-12-31', specialties: [{ code: '50', name: '구강악안면외과', specialists: 3 }, { code: '51', name: '치과보철과', specialists: 0 }], website: 'https://valid.org', hours: { mon: interval('09:00', '18:00') } }),
    clinic({ typeCode: '41', name: '명칭에 그 단어가 없는 치과병원', sidoCode: '110000', sido: '서울', cityCode: '110023', city: '강남구', doctors: { specialist: 2 }, equipment: [{ code: 'B109', name: '콘빔CT', count: 1 }, { code: 'B109', name: '콘빔CT', count: 1 }], openedOn: '2021-01-01', specialties: [{ code: '50', name: '구강악안면외과', specialists: 1 }] }),
    clinic({ typeCode: '41', name: '세 번째 치과병원', sido: '경기', city: '양주시', doctors: { specialist: null }, equipment: [{ code: 'B109', name: '콘빔CT', count: null }], openedOn: '2010-05-05' }),
    clinic({ typeCode: '41', name: '네 번째 치과병원', sido: '경기', city: '양주시', doctors: { specialist: 0 }, openedOn: 'unknown', specialties: [{ code: '50', name: '구강악안면외과', specialists: 1 }] }),
    clinic({ doctors: { specialist: 1 }, equipment: [{ code: 'B109', name: '콘빔CT', count: 1 }] }),
    clinic({ doctors: { specialist: 0 } }),
  ]);
  const g = collectReports(input, metadata).dentalHospitals;
  assert.equal(g.total, 4);
  assert.deepEqual(g.types, { hospital: 4, clinic: 2 });
  assert.deepEqual(g.hospitals.specialist, { known: 3, mean: 4, median: 2, min: 0, max: 10, atLeastOne: { count: 2, known: 3, unknown: 1, total: 4, percentOfTotal: 50, percentOfKnown: 66.7 }, atLeastThree: { count: 1, known: 3, unknown: 1, total: 4, percentOfTotal: 25, percentOfKnown: 33.3 } });
  assert.deepEqual(g.hospitals.cbct, { known: 2, mean: 2, median: 2, min: 2, max: 2, registered: { count: 2, known: 2, unknown: 2, total: 4, percentOfTotal: 50, percentOfKnown: 100 } }, 'two CT rows add up; a row without a count is unknown');
  assert.deepEqual(g.clinics.specialist.atLeastOne, { count: 1, known: 2, unknown: 0, total: 2, percentOfTotal: 50, percentOfKnown: 50 });
  assert.deepEqual(g.university, { count: 1, percentOfTotal: 25, specialist: { known: 1, mean: 10, median: 10, min: 10, max: 10 }, others: { count: 3, specialist: { known: 2, mean: 1, median: 1, min: 0, max: 2 } } });
  assert.deepEqual(g.regions, [{ sido: '경기', count: 2, percentOfTotal: 50 }, { sido: '서울', count: 2, percentOfTotal: 50 }]);
  assert.deepEqual(g.topCities, [{ label: '경기 양주시', count: 2 }, { label: '서울 강남구', count: 1 }, { label: '서울 종로구', count: 1 }]);
  assert.deepEqual(g.opening.map(b => [b.id, b.count]), [['before2000', 1], ['2000s', 0], ['2010s', 1], ['since2020', 1], ['unknown', 1]]);
  assert.deepEqual(g.specialties, [{ code: '50', name: '구강악안면외과', count: 3, percentOfTotal: 75 }], 'a listed specialty with zero specialists is not counted');
  assert.deepEqual(g.hospitals.website, { count: 1, known: 1, unknown: 3, total: 4, percentOfTotal: 25, percentOfKnown: 100 });
  assert.equal(g.hospitals.hours.count, 1);
  const serialized = JSON.stringify(g);
  for (const name of input.map(c => c.name)) assert(!serialized.includes(name), name);
  assert(!serialized.includes('"id":"fixture"'));
  const empty = collectReports([], metadata).dentalHospitals;
  assert.deepEqual(empty.hospitals.specialist.mean, null);
  assert.deepEqual(empty.regions, []);
  assert.equal(empty.university.percentOfTotal, null);
});

test('external facts carry a primary or secondary source, a check date and a quote for every row', () => {
  const { externalFacts } = collectReports([], metadata);
  assert.equal(externalFacts.length, 4);
  for (const fact of externalFacts) {
    assert.match(fact.sourceUrl, /^https:\/\/(www\.law\.go\.kr|www\.nhis\.or\.kr|www\.dentop\.co\.kr)\//, fact.id);
    assert.match(fact.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert(['primary', 'secondary'].includes(fact.sourceKind));
    for (const key of ['topic', 'title', 'quote', 'dentalHospital', 'dentalClinic', 'note']) assert(fact[key].trim().length, fact.id + '.' + key);
  }
  assert.equal(externalFacts.filter(fact => fact.sourceKind === 'secondary').length, 1, 'only the 2024 surcharge summary is second-hand');
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

test('district coverage merges only listed 일반구 codes and label-matched duplicate codes, and flags the rest', () => {
  const at = (sidoCode, sido, cityCode, city, typeCode = '51') => clinic({ sidoCode, sido, cityCode, city, typeCode });
  const g = collectReports(deepFreeze([
    at('310000', '경기', '310601', '수원권선구', '41'),
    at('310000', '경기', '310602', '수원장안구'),
    at('310000', '경기', '310605', '수원신설구'),
    at('310000', '경기', '310001', '가평군'),
    at('110000', '서울', '110001', '강남구', '41'),
    at('110000', '서울', '110001', '강남구', '41'),
    at('360000', '전남광주', '360801', '광주동구'),
    at('240000', '광주', '240001', '광주동구', '41'),
    at('240000', '광주', '240002', '다른표기'),
  ]), metadata).hospitalDistricts;
  const byName = Object.fromEntries(g.units.map(unit => [unit.name, unit]));
  assert.deepEqual(byName['수원시'].cityCodes, ['310601', '310602'], 'only the listed Suwon codes are merged');
  assert.equal(byName['수원시'].kind, '시');
  assert.equal(byName['수원시'].total, 2);
  assert.equal(byName['수원신설구'].merged, false, 'an unlisted code is never merged by guesswork');
  assert.deepEqual(g.issues.map(issue => [issue.kind, issue.cityCode]), [['unlisted-general-district', '310605']]);
  assert.deepEqual(byName['광주동구'].sources.map(source => `${source.sidoCode}/${source.cityCode}`), ['240000/240001', '360000/360801']);
  assert.equal(byName['광주동구'].sidoCode, '360000');
  assert.equal(byName['광주동구'].hospitals, 1);
  assert.equal(byName['다른표기'].sidoCode, '240000', 'a duplicate code with another label stays where the source put it');
  assert.deepEqual(g.aliasesApplied, [{ from: '240000/240001', to: '360000/360801', city: '광주동구', rows: 1 }]);
  assert.equal(byName['가평군'].kind, '군');
  assert.equal(byName['강남구'].kind, '구');
  assert.deepEqual({ total: g.total, withHospital: g.withHospital, withoutHospital: g.withoutHospital, hospitals: g.hospitals, clinics: g.clinics }, { total: 6, withHospital: 3, withoutHospital: 3, hospitals: 4, clinics: 5 });
  assert.deepEqual(g.codeLevel, { total: 7, withHospital: 3, withoutHospital: 4, percentWith: 42.9 }, 'code-level count keeps 일반구 apart but still applies the alias');
  assert.deepEqual(g.concentration, { units: 1, hospitals: 2, percentOfHospitals: 50 }, '강남구 alone holds half of the four hospitals');
  assert.deepEqual(g.withoutHospitalClinics, { units: 3, clinics: 3, minClinics: 1, maxClinics: 1 });
  assert.deepEqual(g.gunWithHospital, []);
  assert.deepEqual(g.kinds.map(kind => [kind.kind, kind.total, kind.withHospital]), [['시', 2, 1], ['군', 1, 0], ['구', 3, 2]], 'a label without 군/구 suffix counts as 시');
  assert.equal(g.units.reduce((sum, unit) => sum + unit.total, 0), 9, 'every row lands in exactly one district');
  assert.equal(JSON.stringify(g).includes('개별 기관명'), false, 'district aggregates never carry institution names');
});

test('real snapshot district coverage reconciles with every institution', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8'));
  const g = collectReports(source.clinics, { ...source, sourceSha256: 'real' }).hospitalDistricts;
  assert.equal(g.hospitals, source.clinics.filter(c => c.typeCode === '41').length);
  assert.equal(g.clinics, source.clinics.filter(c => c.typeCode === '51').length);
  assert.equal(g.units.reduce((sum, unit) => sum + unit.total, 0), source.clinics.length);
  assert.equal(g.withHospital + g.withoutHospital, g.total);
  assert.equal(g.bySido.reduce((sum, sido) => sum + sido.total, 0), g.total);
  assert.equal(g.kinds.reduce((sum, kind) => sum + kind.total, 0), g.total);
  assert.equal(g.hospitalCountBuckets.reduce((sum, bucket) => sum + bucket.units, 0), g.total);
  assert.deepEqual(g.issues, [], 'every 일반구-like source code is either listed or absent');
  if (source.snapshotDate === '2026-09-30') {
    assert.deepEqual([g.total, g.withHospital, g.withoutHospital], [230, 102, 128]);
    assert.deepEqual(g.kinds.map(kind => [kind.kind, kind.total, kind.withHospital]), [['시', 78, 44], ['군', 82, 4], ['구', 70, 54]]);
    assert.deepEqual(g.gunWithHospital.map(unit => unit.name), ['부산기장군', '태안군', '무안군', '함평군']);
    assert.deepEqual(g.codeLevel, { total: 256, withHospital: 116, withoutHospital: 140, percentWith: 45.3 });
    assert.deepEqual(g.concentration, { units: 24, hospitals: 126, percentOfHospitals: 50.8 });
    assert.deepEqual(g.withoutHospitalClinics, { units: 128, clinics: 4324, minClinics: 1, maxClinics: 235 });
    assert.equal(g.aliasesApplied.reduce((sum, alias) => sum + alias.rows, 0), 2);
  }
});
