import test from 'node:test';
import assert from 'node:assert/strict';
import {CONDITIONS, MIN_DISTRICT_MATCHES, districtConditionGroups, districtConditionLinks, registerConditionPages, conditionTable, conditionBySlug} from '../scripts/condition-pages.mjs';
import {collectReports} from '../scripts/report-data.mjs';

const open = (o, c) => ({open: o, close: c});
const none = {open: null, close: null};
const week = (overrides = {}) => ({mon: none, tue: none, wed: none, thu: none, fri: none, sat: none, sun: none, ...overrides});
let seq = 0;
const clinic = (name, cityCode, city, hours, specialist = 0, extra = {}) => ({
  id: 'c-' + String(++seq).padStart(12, '0'), name, typeCode: '51', type: '치과의원', sidoCode: '110000', sido: '서울', cityCode, city, dong: '역삼동',
  address: `서울 ${city} 검증로 ${seq}`, phone: '02-555-0' + String(seq).padStart(3, '0'), doctors: {specialist, total: specialist + 1},
  specialties: [{code: '52', name: '치과교정과', specialists: specialist}], equipment: [], hours, ...extra,
});

function fixture() {
  seq = 0;
  const gangnam = [
    ...['하나', '가나', '다라', '마바', '사아'].map(n => clinic(n + '치과의원', '110001', '강남구', week({tue: open('09:30', '21:00'), sat: open('09:00', '14:00')}), 1)),
    clinic('<script>alert(1)</script>치과의원', '110001', '강남구', week({sat: open('10:00', '13:00')})),
    clinic('시간없는치과의원', '110001', '강남구', week(), null),
    clinic('평일만치과의원', '110001', '강남구', week({mon: open('09:00', '18:00')})),
  ];
  const seocho = [clinic('서초일치과의원', '110002', '서초구', week({sun: open('10:00', '15:00'), sat: open('09:00', '13:00')}), 2)];
  const clinics = [...gangnam, ...seocho];
  const regions = [{sidoCode: '110000', name: '서울', count: clinics.length, clinics, cities: [
    {code: '110001', name: '강남구', count: gangnam.length, clinics: gangnam},
    {code: '110002', name: '서초구', count: seocho.length, clinics: seocho},
  ]}];
  return {clinics, regions};
}

function render() {
  const {clinics, regions} = fixture();
  const pages = new Map();
  const result = registerConditionPages({page: (route, opts) => pages.set(route, opts), clinics, regions, domain: 'https://example.test', snapshotDate: '2026-09-30'});
  return {pages, result, clinics, regions};
}

test('a district page exists only when enough clinics match the condition', () => {
  const {regions} = fixture();
  const groups = districtConditionGroups(regions);
  const get = (city, slug) => groups.find(g => g.cityCode === city && g.slug === slug);
  assert.equal(MIN_DISTRICT_MATCHES, 5);
  assert.equal(get('110001', 'night').matches.length, 5);
  assert.equal(get('110001', 'night').route, '/regions/110000/110001/night/');
  assert.equal(get('110001', 'saturday').matches.length, 6);
  assert.equal(get('110001', 'sunday').route, null);
  assert.equal(get('110002', 'sunday').matches.length, 1);
  assert.equal(get('110002', 'sunday').route, null, 'one match is below the threshold');
  // Unknown counts keep "no data" apart from "does not match".
  assert.equal(get('110001', 'night').known, 6);
  assert.equal(get('110001', 'specialist').known, 7);
});

test('routes: index, one hub per condition and only the qualifying district pages', () => {
  const {pages, result} = render();
  assert.deepEqual([...pages.keys()].sort(), [
    '/conditions/', '/conditions/night/', '/conditions/saturday/', '/conditions/specialist/', '/conditions/sunday/',
    '/regions/110000/110001/night/', '/regions/110000/110001/saturday/', '/regions/110000/110001/specialist/',
  ]);
  assert.equal(result.districtPages, 3);
  assert.deepEqual(result.totals, {night: 5, saturday: 7, sunday: 1, specialist: 6});
});

test('district page answers first, lists 가나다순 with the evidence and never ranks', () => {
  const {pages} = render();
  const page = pages.get('/regions/110000/110001/saturday/');
  assert.match(page.title, /^서울 강남구 토요일 진료 치과 6곳/);
  assert.match(page.body, /서울 강남구 치과 8곳 중 6곳\(75\.0%\)에 토요일 진료시간이 등록되어 있습니다\./);
  assert.match(page.body, /시간 자료가 없는 2곳은 목록에 없으며, 휴진한다는 뜻이 아닙니다/);
  const names = [...page.body.matchAll(/<th scope="row"><a href="\/clinics\/[^"]+\/">([^<]+)<\/a>/g)].map(m => m[1]);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'ko')), 'list is 가나다순');
  assert.equal(names.length, 6);
  assert.match(page.body, /09:00~14:00/);
  assert.match(page.body, /href="tel:025550001" data-outbound="tel" data-clinic="c-000000000001"/);
  assert.doesNotMatch(page.body, /<script>alert/);
  assert.match(page.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;치과의원/);
  assert.doesNotMatch(page.body, /추천합니다|1위|베스트|최고/);
  assert.equal(page.ogImage, '/assets/og/condition-saturday.png');
  assert.equal(page.schema[0]['@type'], 'ItemList');
  assert.equal(page.schema[0].numberOfItems, 6);
  assert.equal(page.schema[0]['@id'], 'https://example.test/regions/110000/110001/saturday/#list');
  // Links to the other qualifying conditions in the same district, not to itself.
  assert.match(page.body, /href="\/regions\/110000\/110001\/night\/"/);
  assert.doesNotMatch(page.body, /href="\/regions\/110000\/110001\/saturday\/"/);
});

test('night evidence shows only the weekdays that close at or after 19:00', () => {
  const c = fixture().clinics[0];
  assert.equal(conditionBySlug('night').detail(c), '화 09:30~21:00');
  assert.equal(conditionBySlug('specialist').detail(c), '1명 · 치과교정과 1');
});

test('hub lists every match when short and links only district pages that exist', () => {
  const {pages} = render();
  const sunday = pages.get('/conditions/sunday/');
  assert.match(sunday.body, /일요일 진료시간이 등록되어 있는 치과는 전국 9곳 중 1곳\(11\.1%\)입니다\./);
  assert.match(sunday.body, /<h1>일요일 진료 치과, 전국 1곳<\/h1>/);
  assert.match(sunday.body, /서초일치과의원/);
  assert.match(sunday.body, /별도 목록을 열 만큼 해당 치과가 모인 시·군·구가 없습니다/);
  assert.match(sunday.body, /등록이 없다고 일요일 진료를 하지 않는다는 뜻은 아닙니다/);
  const night = pages.get('/conditions/night/');
  assert.match(night.body, /href="\/regions\/110000\/110001\/night\/">강남구 5곳/);
});

test('district links helper skips missing pages and can label with the district name', () => {
  const {regions} = fixture();
  const groups = districtConditionGroups(regions);
  assert.equal(districtConditionLinks(groups, '110000', '110002'), '');
  const html = districtConditionLinks(groups, '110000', '110001', {label: true});
  assert.match(html, /강남구 야간 진료 5곳/);
  assert.doesNotMatch(html, /일요일/);
});

test('condition counts equal the report metrics for the same snapshot', () => {
  const {clinics} = fixture();
  const reports = collectReports(clinics, {snapshotDate: '2026-09-30', observedAt: '2026-10-31T00:00:00Z', sourceSha256: 'x'.repeat(64)});
  const m = reports.national.metrics;
  for (const condition of CONDITIONS) assert.equal(clinics.filter(condition.test).length, m[condition.slug].count, condition.slug);
});

test('table escapes every cell', () => {
  const evil = {...fixture().clinics[0], name: '"><img onerror=1>', dong: '<b>', phone: '<i>'};
  const html = conditionTable(conditionBySlug('saturday'), [evil], {caption: '<c>'});
  assert.doesNotMatch(html, /<img|<b>|<i>|<c>/);
});
