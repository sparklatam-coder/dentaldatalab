import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUijeongbuOwnerQueue, inUijeongbu, UIJEONGBU, GYEONGGI_SIDO_CODE } from '../scripts/build-uijeongbu-owner-queue.mjs';
import { buildNationalOwnerCandidates } from '../scripts/build-national-owner-queue.mjs';

const clinic = (id, overrides = {}) => ({ id, name: '대조치과의원', typeCode: '51', sidoCode: GYEONGGI_SIDO_CODE, sido: '경기', cityCode: UIJEONGBU.cityCodes[0], city: '의정부시', address: '경기도 의정부시 시민로 1', phone: '031-111-2222', ...overrides });
const candidate = (clinicId, overrides = {}) => ({ clinicId, name: '대조치과의원', placeId: '100', sido: '경기', city: '의정부시', sourceUrl: 'https://map.naver.com/p/entry/place/100', identity: { confirmed: false }, status: 'candidate_unverified', candidateEvidence: { sourceUrl: 'https://directory.example.org/u', checkedAt: '2026-10-31T00:00:00Z', identityEvidence: [] }, ...overrides });

test('the Uijeongbu queue is scoped by HIRA source codes, so labels cannot add or remove institutions', () => {
  const data = { clinics: [
    clinic('by-code', { sido: '서울', city: '라벨이 틀린 행' }),
    clinic('label-only', { sidoCode: '110000', cityCode: '110001', address: '경기도 의정부시처럼 보이는 주소' }),
    clinic('other-city', { cityCode: '312700', city: '양주시' }),
    clinic('same-name-elsewhere', { sidoCode: '410000', cityCode: '410001', sido: '충북', city: '청주시' }),
  ] };
  const candidates = { records: [candidate('by-code'), candidate('label-only'), candidate('other-city', { sido: '경기', city: '의정부시' })] };
  const records = buildUijeongbuOwnerQueue(data, candidates);
  assert.deepEqual(records.map(r => r.clinicId), ['by-code']);
  assert.equal(records[0].placeId, '100');
  assert.equal(records[0].sidoCode, GYEONGGI_SIDO_CODE);
  assert.equal(records[0].cityCode, UIJEONGBU.cityCodes[0]);
  assert.equal(records[0].identityCautions.sameNameNationalCount, 4, 'same names nationwide are counted as a caution, never merged');
  assert.equal(inUijeongbu({ sidoCode: '110000', cityCode: UIJEONGBU.cityCodes[0] }), false, 'the city code alone is not enough');
  const without = buildUijeongbuOwnerQueue(data, { records: [] });
  assert.equal(without[0].status, 'place_candidate_not_found');
  assert.equal(without[0].placeId, null);
  assert.deepEqual(without[0].identity, { confirmed: false });
  assert.throws(() => buildUijeongbuOwnerQueue(data, { records: [candidate('by-code'), candidate('by-code', { placeId: '200' })] }), /복수 지도 후보/);
});

test('national candidates are emitted only from validated Place and directory URLs, with the Place ID taken from the URL', () => {
  const data = { clinics: [clinic('a'), clinic('b', { sidoCode: '410000', cityCode: '410001', sido: '충북', city: '청주시' })] };
  const asset = (overrides = {}) => ({ kind: 'naverMap', ownership: 'candidate', url: 'https://map.naver.com/p/entry/place/123', placeId: '123', checkedAt: '2026-10-31T22:00:00Z', discoveryUrl: 'https://directory.example.org/list', identityEvidence: [{ field: 'name', value: '대조치과의원', sourceUrl: 'https://directory.example.org/list' }], ...overrides });
  const discovery = { records: [
    { clinicId: 'a', assets: [
      asset(),
      asset({ url: 'https://map.naver.com/p/search/%EC%B9%98%EA%B3%BC/place/555', placeId: '555' }),
      asset({ url: 'javascript:alert(1)', placeId: '7' }),
      asset({ url: 'https://pcmap.place.naver.com/hospital/900/home', placeId: '901' }),
      asset({ url: 'https://m.place.naver.com/hospital/300/home', placeId: 300, discoveryUrl: 'http://127.0.0.1/private' }),
      asset({ url: 'https://m.place.naver.com/hospital/400/home', placeId: undefined }),
      asset({ ownership: 'official', url: 'https://m.place.naver.com/hospital/500/home', placeId: '500' }),
    ] },
    { clinicId: 'b', assets: [asset()] },
  ] };
  const { candidates, skipped } = buildNationalOwnerCandidates(data, discovery, { records: [] });
  assert.deepEqual(skipped, { invalidPlaceUrl: 2, invalidDiscoveryUrl: 1 });
  const byPlace = new Map(candidates.filter(c => c.clinicId === 'a').map(c => [c.placeId, c]));
  assert.deepEqual([...byPlace.keys()].sort(), ['123', '400', '900']);
  assert.equal(byPlace.get('123').status, 'duplicate_place_review', 'the same Place linked to two institutions needs review');
  assert.equal(candidates.find(c => c.clinicId === 'b').status, 'duplicate_place_review');
  assert.equal(byPlace.get('900').status, 'place_id_mismatch_review');
  assert.equal(byPlace.get('900').declaredPlaceId, '901');
  assert.equal(byPlace.get('900').placeIdMismatch, true);
  assert.equal(byPlace.get('400').status, 'candidate_unverified');
  assert.equal(Object.hasOwn(byPlace.get('400'), 'declaredPlaceId'), false);
  assert.equal(byPlace.get('123').sourceUrl, 'https://map.naver.com/p/entry/place/123');
  assert.equal(byPlace.get('123').sidoCode, GYEONGGI_SIDO_CODE);
  assert.equal(byPlace.get('123').cityCode, UIJEONGBU.cityCodes[0]);
  assert.equal(byPlace.get('123').candidateEvidence.sourceUrl, 'https://directory.example.org/list');
  assert.deepEqual(byPlace.get('123').identity, { confirmed: false });
  assert.throws(() => buildNationalOwnerCandidates(data, { records: [{ clinicId: 'missing', assets: [asset()] }] }, { records: [] }), /Unknown institution/);
});
