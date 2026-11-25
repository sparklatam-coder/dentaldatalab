import test from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../src/shared.mjs';
import { groupHospitals, registerHospitalPages, LEGAL_SOURCES } from '../scripts/hospital-pages.mjs';

const clinic = (id, name, typeCode, sidoCode, sido, cityCode, city, extra = {}) => ({
  id, name, typeCode, type: typeCode === '41' ? '치과병원' : '치과의원', sidoCode, sido, cityCode, city,
  address: `${sido} ${city} 검증로 ${id.slice(-1)}`, phone: '02-000-0000', doctors: { specialist: 2 }, equipment: [{ code: 'B109', name: '콘빔CT', count: 1 }], specialties: [], ...extra,
});
const xssName = '<img src=x onerror=alert(1)>대학치과병원 & "따옴표"';
const fixture = () => [
  clinic('c-000000000001', '하나치과병원', '41', '110000', '서울', '110023', '강남구'),
  clinic('c-000000000002', '가나치과병원', '41', '110000', '서울', '110023', '강남구'),
  clinic('c-000000000003', xssName, '41', '110000', '서울', '110024', '서초구'),
  clinic('c-000000000004', '서울특별시장애인치과병원', '41', '110000', '서울', '110024', '서초구'),
  clinic('c-000000000005', '부산치과병원', '41', '210000', '부산', '210001', '중구'),
  clinic('c-000000000006', '다라치과의원', '51', '110000', '서울', '110023', '강남구'),
  clinic('c-000000000007', '대학로치과의원', '51', '210000', '부산', '210001', '중구'),
  clinic('c-000000000008', '제주치과의원', '51', '390000', '제주', '390001', '제주시'),
];
function render(clinics = fixture()) {
  const pages = new Map();
  const result = registerHospitalPages({ page: (route, opts) => pages.set(route, opts), clinics, domain: 'https://example.test', snapshotDate: '2026-09-30' });
  return { pages, result };
}

test('grouping keeps only type 41, sorts 가나다순 and selects 대학/장애인 by registered name', () => {
  const g = groupHospitals(fixture());
  assert.equal(g.hospitals.length, 5);
  assert.deepEqual(g.hospitals.map(c => c.id), ['c-000000000003', 'c-000000000002', 'c-000000000005', 'c-000000000004', 'c-000000000001']);
  assert.deepEqual(g.bySido.map(r => [r.sidoCode, r.name, r.count]), [['110000', '서울', 4], ['210000', '부산', 1]]);
  assert.deepEqual(g.bySido[0].cities.map(c => [c.name, c.count]), [['강남구', 2], ['서초구', 2]]);
  // '대학로치과의원' is type 51: never selected even though its name contains 대학.
  assert.deepEqual(g.university.map(c => c.id), ['c-000000000003']);
  assert.deepEqual(g.disability.map(c => c.id), ['c-000000000004']);
});

test('routes exist per present 시도 only, plus hub and the two name-based groups', () => {
  const { pages, result } = render();
  assert.deepEqual([...pages.keys()].sort(), ['/hospitals/', '/hospitals/110000/', '/hospitals/210000/', '/hospitals/disability/', '/hospitals/university/']);
  assert.equal(pages.has('/hospitals/390000/'), false, '제주 has no hospital in the fixture');
  assert.deepEqual(result, { total: 5, sido: 2, university: 1, disability: 1, indexingEnabled: false });
});

test('hub counts, titles and links come from the data', () => {
  const { pages } = render();
  const hub = pages.get('/hospitals/');
  assert.match(hub.title, /^전국 치과병원 5곳/);
  assert.match(hub.body, /치과의원 3곳과 구분되는 병원급 치과 5곳/);
  for (const href of ['/hospitals/110000/', '/hospitals/210000/', '/hospitals/university/', '/hospitals/disability/', '/reports/dental-hospitals/', '/reports/dental-hospital-vs-clinic/', '/find/?type=41']) {
    assert.ok(hub.body.includes(`href="${href}"`), href);
  }
  assert.match(hub.body, /서울<\/strong><span>4곳/);
  assert.match(hub.body, /‘대학’이 있는 치과병원<\/strong><span>1곳/);
  for (const s of Object.values(LEGAL_SOURCES).slice(0, 2)) assert.ok(hub.body.includes(`href="${esc(s.url)}"`), s.title);
  assert.match(hub.body, /확인 2026-11-26/);
  assert.equal(hub.schema[0]['@type'], 'ItemList');
  assert.equal(hub.schema[0].numberOfItems, 5);
  assert.equal(hub.schema[0].itemListElement[0].url, 'https://example.test/clinics/c-000000000003/');
  assert.deepEqual(Object.keys(hub.schema[0].itemListElement[0]), ['@type', 'position', 'url'], 'URL-only list items');
});

test('시도 pages list every hospital of that 시도 grouped by 시군구 and never a 치과의원', () => {
  const { pages } = render();
  const seoul = pages.get('/hospitals/110000/');
  assert.match(seoul.title, /^서울 치과병원 4곳/);
  assert.match(seoul.body, /id="city-110023">강남구 <small>2곳/);
  assert.match(seoul.body, /id="city-110024">서초구 <small>2곳/);
  assert.equal((seoul.body.match(/class="clinic-card"/g) || []).length, 4);
  assert.ok(seoul.body.indexOf('가나치과병원') < seoul.body.indexOf('하나치과병원'), '가나다순 inside a district');
  for (const forbidden of ['다라치과의원', '대학로치과의원', '제주치과의원', 'c-000000000006', 'c-000000000007']) assert.ok(!seoul.body.includes(forbidden), forbidden);
  assert.ok(seoul.body.includes('href="/regions/110000/"'));
  assert.equal(pages.get('/hospitals/210000/').schema[0].numberOfItems, 1);
});

test('name-based groups state their selection rule and the missing designation field', () => {
  const { pages } = render();
  const university = pages.get('/hospitals/university/');
  assert.match(university.title, /‘대학’이 있는 치과병원 1곳/);
  assert.match(university.body, /기관명 문자열로 고른 목록/);
  assert.equal((university.body.match(/class="clinic-card"/g) || []).length, 1);
  const disability = pages.get('/hospitals/disability/');
  assert.match(disability.title, /‘장애인’이 있는 치과병원 1곳/);
  assert.match(disability.body, /장애인 진료 지정 여부 항목이 없습니다/);
  assert.match(disability.body, /제15조의2/);
  assert.ok(disability.body.includes(`href="${esc(LEGAL_SOURCES.disabilityCenters.url)}"`));
  assert.match(disability.body, /서울특별시장애인치과병원/);
  // An empty group renders an explicit empty state, not a broken grid.
  const none = render(fixture().filter(c => !c.name.includes('장애인'))).pages.get('/hospitals/disability/');
  assert.match(none.title, /0곳/);
  assert.match(none.body, /해당 기관명이 없습니다/);
});

test('institution names are HTML-escaped and no superiority wording appears', () => {
  const { pages } = render();
  const all = [...pages.values()].map(p => p.title + p.description + p.body).join('\n');
  assert.ok(!all.includes(xssName));
  assert.ok(all.includes(esc(xssName)));
  for (const word of ['더 좋은', '믿을 수 있는', '실력', '최고', '추천 병원', '우수']) assert.ok(!all.includes(word), word);
  assert.match(all, /순위를 매기지 않으며/);
});

test('invalid inputs fail loudly', () => {
  assert.throws(() => registerHospitalPages({ page: null, clinics: [] }), TypeError);
  assert.throws(() => registerHospitalPages({ page: () => {}, clinics: 'nope' }), TypeError);
});

test('a hospital without a sidoCode stays in the national total and is listed on the hub instead of vanishing', () => {
  const clinics = [...fixture(), clinic('c-000000000009', '미표기치과병원', '41', '', '', '', '')];
  const g = groupHospitals(clinics);
  assert.equal(g.hospitals.length, 6);
  assert.deepEqual(g.unplaced.map(c => c.id), ['c-000000000009']);
  assert.equal(g.bySido.reduce((n, r) => n + r.count, 0) + g.unplaced.length, g.hospitals.length);
  const { pages } = render(clinics);
  const hub = pages.get('/hospitals/');
  assert.match(hub.title, /치과병원 6곳/);
  assert.equal(hub.schema[0].numberOfItems, 6);
  assert.ok(hub.body.includes('시도코드가 비어 있는 치과병원 1곳'));
  assert.ok(hub.body.includes('미표기치과병원'));
  // The default fixture has no such section.
  assert.ok(!render().pages.get('/hospitals/').body.includes('시도코드가 비어 있는'));
});

test('legal citations on the hospital pages are the EXTERNAL_FACTS records, not a second copy', async () => {
  const { EXTERNAL_FACTS } = await import('../scripts/report-data.mjs');
  for (const [key, id] of [['classification', 'medical-service-act-3-2'], ['beds', 'medical-service-act-3-2bis']]) {
    const fact = EXTERNAL_FACTS.find(f => f.id === id);
    assert.equal(LEGAL_SOURCES[key].url, fact.sourceUrl, key);
    assert.equal(LEGAL_SOURCES[key].checkedAt, fact.checkedAt, key);
    assert.equal(LEGAL_SOURCES[key].title, fact.title, key);
  }
});
