import test from 'node:test';
import assert from 'node:assert/strict';
import {hospitalClassificationPanel, hospitalFaq, topicParticle, isDentalHospital} from '../scripts/hospital-content.mjs';
import {EXTERNAL_FACTS} from '../scripts/report-data.mjs';

const hospital = {id: 'c-h', name: '검증치과병원', typeCode: '41', sido: '서울', sidoCode: '110000', city: '강남구', doctors: {specialist: 3}};
const clinic = {...hospital, id: 'c-c', name: '검증치과의원', typeCode: '51'};
const snapshot = '2026-09-30';

test('topic particle follows the final consonant of the institution name', () => {
  assert.equal(topicParticle('서울대학교치과병원'), '은');
  assert.equal(topicParticle('미소치과'), '는');
  assert.equal(topicParticle('Dental Hospital'), '은(는)');
});

test('classification panel and FAQ are produced only for 종별코드 41', () => {
  assert.equal(isDentalHospital(clinic), false);
  assert.equal(hospitalClassificationPanel(clinic, {snapshot}), '');
  assert.equal(hospitalFaq(clinic, {snapshot}), null);
  assert.equal(hospitalClassificationPanel(undefined, {snapshot}), '');
});

test('classification panel cites the record type and both law articles with their check dates', () => {
  const html = hospitalClassificationPanel(hospital, {snapshot, ctCount: 2});
  assert.match(html, /종별코드 41 · 치과병원/);
  assert.match(html, /2026-09-30 자료에 등록된 종별/);
  for (const id of ['medical-service-act-3-2', 'medical-service-act-3-2bis']) {
    const fact = EXTERNAL_FACTS.find(f => f.id === id);
    assert(html.includes(`href="${fact.sourceUrl.replaceAll('&', '&amp;')}"`), id);
    assert(html.includes(`확인 ${fact.checkedAt}`), id);
  }
  assert.match(html, /병상 수 요건 없음/);
  assert.match(html, /치과전문의 3명 · 콘빔CT 2대 등록/);
  assert.match(html, /href="\/hospitals\/110000\/"/);
  assert.match(html, /href="\/reports\/dental-hospital-vs-clinic\/"/);
  // No evaluation language.
  for (const word of ['더 좋', '실력 있', '믿을 수 있', '추천']) assert(!html.includes(word), word);
});

test('missing counts are stated as unknown, never as zero', () => {
  const html = hospitalClassificationPanel({...hospital, doctors: {}}, {snapshot, ctCount: null});
  assert.match(html, /치과전문의 자료 미확인 · 콘빔CT 자료 미확인 등록/);
  const faq = hospitalFaq({...hospital, doctors: {specialist: null}}, {snapshot});
  assert.match(faq.items[1].a, /기록돼 있지 않습니다/);
  assert.doesNotMatch(faq.items[1].a, /0명/);
});

test('FAQ answers come from the record and the law, and ship as FAQPage JSON-LD', () => {
  const faq = hospitalFaq(hospital, {snapshot});
  assert.equal(faq.items.length, 6);
  assert.equal(faq.items[0].q, '검증치과병원은 치과병원인가요?');
  assert.match(faq.items[0].a, /종별코드 41\(치과병원\)로 등록된 병원급 의료기관/);
  assert.match(faq.items[1].a, /치과전문의 3명이 등록/);
  assert.match(faq.items[2].a, /30병상 요건은 병원·한방병원에만/);
  assert.equal(faq.schema['@type'], 'FAQPage');
  assert.deepEqual(faq.schema.mainEntity.map(x => x.name), faq.items.map(x => x.q));
  assert.equal(faq.schema.mainEntity[0].acceptedAnswer.text, faq.items[0].a);
  assert.match(faq.html, /<dt>검증치과병원은 치과병원인가요\?<\/dt>/);
});

test('name-search questions answer address, phone, hours and 진료과목 from the record alone', () => {
  const full = {...hospital, address: '서울특별시 강남구 검증로 1', phone: '02-555-0100',
    hours: {mon: {open: '09:00', close: '18:00'}, tue: {open: '09:00', close: '18:00'}, wed: {open: '09:00', close: '20:00'}, thu: {open: '18:00', close: '09:00'}, sat: {open: '09:00', close: '13:00'}},
    specialties: [{code: '50', name: '구강악안면외과', specialists: 2}, {code: '51', name: '치과보철과', specialists: 0}, {code: '52', name: '치과교정과', specialists: null}]};
  const faq = hospitalFaq(full, {snapshot});
  const [address, hours, subjects] = faq.items.slice(3);
  assert.equal(address.q, '검증치과병원의 주소와 전화번호는 무엇인가요?');
  assert.match(address.a, /등록 주소는 서울특별시 강남구 검증로 1입니다\. 신고 전화번호는 02-555-0100입니다\./);
  assert.equal(hours.q, '검증치과병원의 진료시간은 어떻게 되나요?');
  // Consecutive days with the same pair are one run; an inverted pair (목) is not a registered time.
  assert.match(hours.a, /월~화요일 09:00~18:00, 수요일 09:00~20:00, 토요일 09:00~13:00입니다\./);
  assert.match(hours.a, /목요일·금요일·일요일은 등록된 시간이 없으며 휴진을 뜻하지 않습니다\./);
  assert.match(subjects.a, /등록된 진료과목은 3개\(구강악안면외과, 치과보철과, 치과교정과\)입니다\./);
  assert.match(subjects.a, /전문의가 1명 이상 등록된 과목은 구강악안면외과 2명입니다\./);
  assert.match(subjects.a, /1개 과목은 전문의 0명으로 등록돼 있습니다\. 1개 과목은 전문의 수가 기록돼 있지 않습니다\./);
  // The FAQPage node carries the same six answers.
  assert.deepEqual(faq.schema.mainEntity.map(x => x.acceptedAnswer.text), faq.items.map(x => x.a));
  for (const item of faq.items) assert.doesNotMatch(item.a, /undefined|NaN|null/);
});

test('missing address, phone, hours and 진료과목 are said to be missing, never turned into 0 or "closed"', () => {
  const faq = hospitalFaq(hospital, {snapshot});
  const [address, hours, subjects] = faq.items.slice(3);
  assert.match(address.a, /등록 주소는 자료 미확인입니다\. 신고 전화번호는 이 자료에 기록돼 있지 않습니다\./);
  assert.match(hours.a, /진료시간이 등록돼 있지 않습니다\. 휴진이나 운영 중단을 뜻하지 않으며/);
  assert.doesNotMatch(hours.a, /\d{2}:\d{2}/);
  assert.match(subjects.a, /진료과목이 기록돼 있지 않습니다\. 해당 진료를 하지 않는다는 뜻은 아닙니다\./);
  assert.doesNotMatch(subjects.a, /0개|0명/);
  for (const item of faq.items) assert.doesNotMatch(item.a, /undefined|NaN|null/);
});

test('names are HTML-escaped in the FAQ markup but kept verbatim in the schema', () => {
  const tricky = {...hospital, name: '<b>치과병원</b> & "따옴표"'};
  const faq = hospitalFaq(tricky, {snapshot});
  assert.doesNotMatch(faq.html, /<b>/);
  assert.match(faq.html, /&lt;b&gt;치과병원&lt;\/b&gt; &amp; &quot;따옴표&quot;/);
  assert.match(faq.schema.mainEntity[0].name, /^<b>치과병원<\/b> & "따옴표"/);
});
