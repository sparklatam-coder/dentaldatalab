import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAnswerPages, SHORT_ANSWERS, ANSWER_SOURCES, OUTPATIENT_COPAY, DISABILITY_CENTERS, answerCards, answerLinks, answerRoute } from '../scripts/answer-pages.mjs';
import { EXTERNAL_FACTS } from '../scripts/report-data.mjs';

const marker = '개별기관비공개표식 <script>privateRecord()</script>';
const clinic = (id, typeCode, name = marker) => ({ id, typeCode, name, address: '개별주소비공개표식', sidoCode: '110000', cityCode: '110001' });
const clinics = [
  clinic('h1', '41', `${marker}대학교치과병원`), clinic('h2', '41', `${marker}장애인치과병원`), clinic('h3', '41', `${marker}대학치과병원`),
  clinic('c1', '51'), clinic('c2', '51'), clinic('c3', '51'), clinic('c4', '51'), clinic('x1', '11'),
];
const render = () => {
  const pages = new Map();
  const result = registerAnswerPages({ page: (route, opts) => pages.set(route, opts), clinics, snapshotDate: '2026-09-30' });
  return { pages, result };
};

test('each short answer is one /guides/ page whose first visible sentence answers the question', () => {
  const { pages, result } = render();
  assert.deepEqual(result, { count: 5, snapshot: '2026-09-30', hospitals: 3, clinics: 4, university: 2, disability: 1 });
  assert.deepEqual([...pages.keys()], SHORT_ANSWERS.map(answerRoute));
  for (const a of SHORT_ANSWERS) {
    const p = pages.get(answerRoute(a));
    assert.match(a.question, /\?$/);
    assert.match(a.answer, /^(네|아니요|[가-힣])[^]*\.$/);
    assert.equal(p.title, a.question);
    assert.equal(p.description, a.answer);
    const h1 = p.body.indexOf(`<h1>${a.question}</h1>`), answer = p.body.indexOf(a.answer);
    assert.ok(h1 > 0 && answer > h1, `${a.slug}: answer follows the question heading`);
    assert.ok(answer < p.body.indexOf('근거 원문'), `${a.slug}: answer comes before the sources`);
    const [faq] = p.schema;
    assert.equal(faq['@type'], 'FAQPage');
    assert.equal(faq.mainEntity.length, 1);
    assert.equal(faq.mainEntity[0].name, a.question);
    assert.ok(faq.mainEntity[0].acceptedAnswer.text.startsWith(a.answer));
    // Aggregates only: no institution name, address or record id reaches the page.
    assert.doesNotMatch(p.body + JSON.stringify(p.schema), /개별기관비공개표식|개별주소비공개표식|privateRecord|\/clinics\//);
    assert.ok(a.sources.length >= 1);
    for (const key of a.sources) assert.ok(p.body.includes(`확인 ${ANSWER_SOURCES[key].checkedAt}`), `${a.slug}: ${key} shows its 확인일`);
    for (const [href] of a.links) assert.match(href, /^\/(guides|hospitals|reports)\/[a-z0-9/-]*$/);
  }
});

test('answer pages count from the data and keep the 대학 count name-based', () => {
  const { pages } = render();
  assert.match(pages.get('/guides/dental-hospital-30-beds/').body, /치과병원은 3곳\(심평원 2026-09-30 기준\)/);
  assert.match(pages.get('/guides/dental-copay-by-institution-type/').body, /치과의원은 4곳, 치과병원은 3곳/);
  const university = pages.get('/guides/university-dental-hospital-referral/').body;
  assert.match(university, /치과병원 3곳 중 기관명에 ‘대학’이 들어간 곳은 2곳/);
  assert.match(university, /대학 부속 여부를 확인한 숫자가 아닙니다/);
});

test('answer sources are primary, dated and consistent with the facts used elsewhere on the site', () => {
  for (const [key, s] of Object.entries(ANSWER_SOURCES)) {
    assert.match(s.url, /^https:\/\/www\.(law\.go\.kr|nhis\.or\.kr|mohw\.go\.kr)\//, key);
    assert.match(s.checkedAt, /^\d{4}-\d{2}-\d{2}$/, key);
    assert.ok(s.quote.length > 40 && s.edition, key);
  }
  assert.match(ANSWER_SOURCES.beds.quote, /30개 이상의 병상\(병원ㆍ한방병원만 해당한다\)/);
  assert.match(ANSWER_SOURCES.generalHospital.quote, /300병상을 초과하는 경우에는[^]*치과를 포함한 9개 이상/);
  assert.match(ANSWER_SOURCES.benefitSteps.quote, /3\. 치과에서 요양급여를 받는 경우/);
  // The copay table matches the 30% / 40%·35% fact the dental-hospital reports already cite.
  const copay = EXTERNAL_FACTS.find(f => f.id === 'nhis-outpatient-copay');
  assert.equal(copay.dentalClinic, OUTPATIENT_COPAY[0].dong);
  assert.equal(copay.dentalHospital, `동지역 ${OUTPATIENT_COPAY[1].dong} · 읍·면지역 ${OUTPATIENT_COPAY[1].eupmyeon}`);
});

test('the disability-center answer reproduces the ministry table and keeps 지역센터 and name counts apart', () => {
  const { centers, source } = DISABILITY_CENTERS;
  assert.equal(source.url, 'https://www.mohw.go.kr/menu.es?mid=a10706030200');
  assert.match(source.pageModifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(centers.map(c => c.no), centers.map((_, i) => i + 1));
  assert.equal(centers.filter(c => c.level === '중앙').length, 1);
  for (const c of centers) {
    assert.ok(c.label.includes(c.operator) && c.label.includes(`${c.level}장애인구강진료센터`), c.label);
    assert.ok(c.address && c.phone, c.label);
  }
  const { pages } = render();
  const body = pages.get('/guides/disability-dental-centers/').body;
  for (const c of centers) assert.ok(body.includes(c.address.replaceAll('&', '&amp;')), c.operator);
  assert.match(body, new RegExp(`중앙 1곳\\(${centers.find(c => c.level === '중앙').operator}\\)과 권역 ${centers.length - 1}곳, 모두 ${centers.length}곳`));
  assert.match(body, /지역센터는 아래 표에 나오지 않습니다/);
  assert.match(body, /치과병원 3곳 중 기관명에 ‘장애인’이 들어간 곳은 1곳이며, 센터 지정과는 별개인 이름 기준 숫자입니다/);
  assert.match(body, /비급여 진료비 총액의 50%/);
});

test('hub cards and link lists cover every short answer and escape the question text', () => {
  const cards = answerCards(), links = answerLinks();
  for (const a of SHORT_ANSWERS) {
    assert.ok(cards.includes(`href="${answerRoute(a)}"`) && links.includes(`href="${answerRoute(a)}"`));
  }
  assert.doesNotMatch(cards + links, /<script/);
  assert.throws(() => registerAnswerPages({ page: null, clinics }), TypeError);
});
