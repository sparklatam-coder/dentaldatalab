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
  assert.equal(faq.items.length, 3);
  assert.equal(faq.items[0].q, '검증치과병원은 치과병원인가요?');
  assert.match(faq.items[0].a, /종별코드 41\(치과병원\)로 등록된 병원급 의료기관/);
  assert.match(faq.items[1].a, /치과전문의 3명이 등록/);
  assert.match(faq.items[2].a, /30병상 요건은 병원·한방병원에만/);
  assert.equal(faq.schema['@type'], 'FAQPage');
  assert.deepEqual(faq.schema.mainEntity.map(x => x.name), faq.items.map(x => x.q));
  assert.equal(faq.schema.mainEntity[0].acceptedAnswer.text, faq.items[0].a);
  assert.match(faq.html, /<dt>검증치과병원은 치과병원인가요\?<\/dt>/);
});

test('names are HTML-escaped in the FAQ markup but kept verbatim in the schema', () => {
  const tricky = {...hospital, name: '<b>치과병원</b> & "따옴표"'};
  const faq = hospitalFaq(tricky, {snapshot});
  assert.doesNotMatch(faq.html, /<b>/);
  assert.match(faq.html, /&lt;b&gt;치과병원&lt;\/b&gt; &amp; &quot;따옴표&quot;/);
  assert.match(faq.schema.mainEntity[0].name, /^<b>치과병원<\/b> & "따옴표"/);
});
