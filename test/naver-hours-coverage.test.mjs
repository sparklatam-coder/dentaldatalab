import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNaverHoursCoverage, NAVER_HOURS_STAGES, safeGeneratedSearchUrl } from '../scripts/naver-hours-coverage.mjs';

const earlier = '2026-10-31T12:00:00Z', later = '2026-11-01T12:00:00Z';
const source = 'https://map.naver.com/p/entry/place/123456789';
const mobileSource = 'https://m.place.naver.com/hospital/123456789/home';
const clinic = (id = 'clinic-a', overrides = {}) => ({
  id, name: '확인치과의원', typeCode: '51', sidoCode: '310000', sido: '경기', cityCode: '312700', city: '양주시',
  address: '경기도 양주시 검증로 12-3, 4층 (확인동)', phone: '031-123-4567', ...overrides,
});
const observation = (overrides = {}) => ({
  sourceUrl: source, bodyStatus: 'read', identityMatch: true, checkedAt: earlier,
  fields: { hours: '매주 일요일 휴무' }, ...overrides,
});
const place = (overrides = {}) => ({
  kind: 'naverMap', url: source, ownership: 'candidate', bodyStatus: 'not_read', checkedAt: earlier, ...overrides,
});
const assetRecord = (clinicId, observations = [], assets = []) => ({ clinicId, naverPlaceObservations: observations, assets });
const coverage = (clinics = [clinic()], records = []) => buildNaverHoursCoverage(clinics, { snapshotDate: '2026-09-30', records });
const stages = Object.keys(NAVER_HOURS_STAGES);
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return value;
}

test('every public clinic gets exactly one truthful stage, preserving public identity and codes', () => {
  const clinics = stages.map((stage, index) => clinic(stage, { typeCode: index === 0 ? '41' : '51' }));
  const result = coverage(clinics, [
    assetRecord('hours_available', [observation()]),
    assetRecord('hours_missing', [observation({ fields: { phone: '031-123-4567' } })]),
    assetRecord('identity_review', [observation({ identityMatch: false })]),
    assetRecord('access_failed', [observation({ bodyStatus: 'blocked', fields: {} })]),
    assetRecord('place_ready', [], [place()]),
    assetRecord('outside-public-snapshot', [observation()]),
  ]);
  assert.deepEqual(result.records.map(record => record.clinicId), stages);
  assert.deepEqual(result.records.map(record => record.stage), stages);
  assert.equal(result.snapshotDate, '2026-09-30');
  assert.equal(result.checkedAt, earlier);
  for (const [index, record] of result.records.entries()) {
    for (const field of ['name', 'typeCode', 'sidoCode', 'sido', 'cityCode', 'city', 'address', 'phone']) {
      assert.equal(record[field], clinics[index][field], field);
    }
    assert.equal(record.hours !== null, record.stage === 'hours_available');
    assert(record.nextAction);
  }
  assert.equal(result.records.at(-1).checkedAt, null);
  assert.deepEqual(result.summary, {
    total: 6, byStage: Object.fromEntries(stages.map(stage => [stage, 1])), naverHoursAvailable: 1, pending: 5,
  });
});

test('newest eligible hours survive earlier and later failed reads, independent of input order', () => {
  const observations = [
    observation({ checkedAt: '2026-10-30T12:00:00Z', bodyStatus: 'blocked', fields: {} }),
    observation(),
    observation({ sourceUrl: mobileSource, checkedAt: later, fields: { hours: '월 10:00 - 18:00', hoursAdditional: '공휴일 별도 안내' } }),
    observation({ checkedAt: '2026-11-02T12:00:00Z', bodyStatus: 'blocked', fields: {} }),
  ];
  const forward = coverage([clinic()], [assetRecord('clinic-a', observations)]).records[0];
  const reverse = coverage([clinic()], [assetRecord('clinic-a', [...observations].reverse())]).records[0];
  assert.deepEqual(forward, reverse);
  assert.equal(forward.stage, 'hours_available');
  assert.equal(forward.checkedAt, later, 'Evidence time is not the later failure or queue generation time');
  assert.deepEqual(forward.hours, { raw: '월 10:00 - 18:00', additional: '공휴일 별도 안내', checkedAt: later, url: mobileSource });
  assert.equal(forward.nextAction, 'periodic_recheck');
  const partial = coverage([clinic()], [assetRecord('clinic-a', [observation()])]).records[0];
  assert.equal(partial.hours.raw, '매주 일요일 휴무', 'A limited observed notice remains limited text, without inferred weekdays');
});

test('unread, unconfirmed, invalid-time or invalid-source data never counts as hours available', () => {
  const invalid = [
    { bodyStatus: 'blocked' }, { bodyStatus: 'not_read' }, { identityMatch: false }, { identityMatch: undefined },
    { checkedAt: 'not-a-date' }, { checkedAt: undefined }, { checkedAt: 1 },
    { fields: { hours: '' } }, { fields: { hours: '   ' } }, { fields: { hours: { mon: '09:00' } } },
    { sourceUrl: 'https://clinic.example.com/place/123456789' },
    { sourceUrl: 'https://map.naver.com.evil.example/place/123456789' },
    { sourceUrl: 'https://map.naver.com/' }, { sourceUrl: '//map.naver.com/p/entry/place/123456789' },
    { sourceUrl: 'https://map.naver.com/p/entry/place/123456789spoof' },
    { sourceUrl: 'https://map.naver.com/p/search/nearby/place/123456789' },
    { sourceUrl: 'https://name:password@map.naver.com/p/entry/place/123456789' },
  ];
  for (const override of invalid) {
    const result = coverage([clinic()], [assetRecord('clinic-a', [observation(override)])]);
    assert.equal(result.records[0].hours, null, JSON.stringify(override));
    assert.notEqual(result.records[0].stage, 'hours_available', JSON.stringify(override));
    assert.equal(result.summary.naverHoursAvailable, 0);
    assert.equal(result.summary.pending, 1);
  }
});

test('matched reads without hours outrank unconfirmed reads and failures without claiming a schedule', () => {
  const result = coverage([clinic()], [assetRecord('clinic-a', [
    observation({ fields: {} }),
    observation({ identityMatch: false, checkedAt: later }),
    observation({ bodyStatus: 'blocked', checkedAt: later, fields: {} }),
  ])]).records[0];
  assert.equal(result.stage, 'hours_missing');
  assert.equal(result.checkedAt, earlier);
  assert.equal(result.hours, null);
  assert.equal(result.nextAction, 'check_hours_in_place');
});

test('a current third-party correction also removes older identity, failed-access and source-URL claims from the queue', () => {
  const correction = place({ url: mobileSource, ownership: 'third_party', bodyStatus: 'read', checkedAt: later });
  for (const prior of [observation(), observation({ fields: {} }), observation({ identityMatch: false }), observation({ bodyStatus: 'blocked', fields: {} })]) {
    const record = coverage([clinic()], [assetRecord('clinic-a', [prior], [correction])]).records[0];
    assert.equal(record.stage, 'place_discovery');
    assert.equal(record.hours, null);
    assert.equal(record.checkedAt, null);
    assert.deepEqual(record.sourceUrls, []);
  }
  const withOtherCandidate = coverage([clinic()], [assetRecord('clinic-a', [observation()], [correction, place({ url: 'https://map.naver.com/p/entry/place/999' })])]).records[0];
  assert.equal(withOtherCandidate.stage, 'place_ready');
  assert.deepEqual(withOtherCandidate.sourceUrls, ['https://map.naver.com/p/entry/place/999']);
  const newer = coverage([clinic()], [assetRecord('clinic-a', [observation({ checkedAt: '2026-11-02T12:00:00Z' })], [correction])]).records[0];
  assert.equal(newer.stage, 'hours_available');
  assert.deepEqual(newer.sourceUrls, [source]);
});

test('actual Place candidates remain pending; generic searches and third-party mentions are not Place discovery', () => {
  const unusable = [
    place({ url: 'https://map.naver.com/p/search/확인치과' }),
    place({ url: 'https://m.place.naver.com/hospital/not-numeric/home' }),
    place({ url: 'https://map.naver.com/p/entry/place/123x' }),
    place({ ownership: 'third_party' }),
    place({ kind: 'naverBlog', url: 'https://blog.naver.com/clinic-example' }),
  ];
  const unproven = assetRecord('clinic-a', [], unusable);
  unproven.searches = [{ query: '확인치과', url: source, outcome: '검색어에 포함된 URL은 기관 출처가 아님' }];
  const empty = coverage([clinic()], [unproven]).records[0];
  assert.equal(empty.stage, 'place_discovery');
  assert.deepEqual(empty.sourceUrls, []);
  assert.equal(empty.checkedAt, null);
  const found = coverage([clinic()], [assetRecord('clinic-a', [observation({ bodyStatus: 'not_read', fields: {} })], [place(), place()])]).records[0];
  assert.equal(found.stage, 'place_ready');
  assert.deepEqual(found.sourceUrls, [source]);
  assert.equal(found.hours, null);
  assert.equal(found.checkedAt, earlier);
  assert(!found.sourceUrls.includes(found.searchUrl));
});

test('legacy Place asset read/failed states are preserved without inventing identity or hours observations', () => {
  const result = coverage([clinic('failed'), clinic('read')], [
    assetRecord('failed', [], [place({ bodyStatus: 'blocked' })]),
    assetRecord('read', [], [place({ bodyStatus: 'read', ownership: 'official' })]),
  ]);
  assert.equal(result.records[0].stage, 'access_failed');
  assert.equal(result.records[1].stage, 'identity_review');
  assert(result.records.every(record => record.hours === null));
  assert.equal(result.summary.pending, 2);
});

test('city summaries separate same-name cities by province and reconcile with all nationwide stages', () => {
  const clinics = [clinic('a'), clinic('b'), clinic('c', { sidoCode: '110000', sido: '서울', cityCode: '110001', city: '양주시' }), clinic('d', { cityCode: '312800', city: '다른시' })];
  const result = coverage(clinics, [assetRecord('a', [observation()]), assetRecord('c', [], [place()])]);
  assert.equal(result.regions.length, 3);
  const yangju = result.regions.find(region => region.cityCode === '312700');
  assert.equal(yangju.total, 2);
  assert.equal(yangju.naverHoursAvailable, 1);
  assert.equal(yangju.pending, 1);
  assert.equal(result.regions.reduce((sum, region) => sum + region.total, 0), result.summary.total);
  for (const stage of stages) assert.equal(result.regions.reduce((sum, region) => sum + region.byStage[stage], 0), result.summary.byStage[stage]);
  for (const summary of [result.summary, ...result.regions]) {
    assert.equal(Object.values(summary.byStage).reduce((sum, count) => sum + count, 0), summary.total);
    assert.equal(summary.naverHoursAvailable + summary.pending, summary.total);
  }
});

test('generated search URLs safely encode identity hints and are explicitly separate from observed sources', () => {
  const input = clinic('a', { name: '치과 & # / ?' });
  const url = new URL(safeGeneratedSearchUrl(input));
  assert.equal(url.origin, 'https://map.naver.com');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(decodeURIComponent(url.pathname.slice('/p/search/'.length)), '양주시 치과 & # / ? 검증로 12-3');
  assert.equal(safeGeneratedSearchUrl({ name: '' }), null);
  assert.equal(safeGeneratedSearchUrl({ name: '\ud800' }), null);
  const record = coverage([input]).records[0];
  assert.match(record.searchUrlLabel, /자동 생성.*기관 미확인/);
  assert.deepEqual(record.sourceUrls, []);
  assert.equal(record.stage, 'place_discovery');
});

test('pure coverage leaves snapshots untouched, does not substitute registered hours, and handles an empty scope', () => {
  const clinics = freezeDeep([clinic('clinic-a', { hours: { mon: { open: '09:00', close: '18:00' } } })]);
  const inventory = freezeDeep({ records: [assetRecord('clinic-a', [], [place()])] });
  const before = JSON.stringify({ clinics, inventory });
  const first = buildNaverHoursCoverage(clinics, inventory);
  assert.deepEqual(buildNaverHoursCoverage(clinics, inventory), first);
  assert.equal(JSON.stringify({ clinics, inventory }), before);
  assert.equal(first.records[0].hours, null);
  assert.equal(first.records[0].stage, 'place_ready');
  const empty = coverage([]);
  assert.deepEqual(empty.records, []);
  assert.deepEqual(empty.regions, []);
  assert.equal(empty.checkedAt, null);
  assert.equal(empty.summary.total, 0);
  assert.equal(empty.summary.pending, 0);
  assert.equal(empty.summary.naverHoursAvailable, 0);
  assert(Object.values(empty.summary.byStage).every(count => count === 0));
  assert.throws(() => coverage([clinic(), clinic()]), /duplicate clinic id/);
  assert.throws(() => coverage([clinic()], [assetRecord('clinic-a'), assetRecord('clinic-a')]), /Duplicate inventory clinicId/);
});
