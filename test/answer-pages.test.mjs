import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAnswerPages, SHORT_ANSWERS, ANSWER_SOURCES, OUTPATIENT_COPAY, TYPE_SURCHARGE, DISABILITY_CENTERS, answerCards, answerLinks, answerRoute, answerText } from '../scripts/answer-pages.mjs';
import { EXTERNAL_FACTS, collectReports } from '../scripts/report-data.mjs';
import { SOURCE_URL, esc } from '../src/shared.mjs';

const marker = '개별기관비공개표식 <script>privateRecord()</script>';
const clinic = (id, typeCode, name = marker, extra = {}) => ({ id, typeCode, name, address: '개별주소비공개표식', sidoCode: '110000', cityCode: '110001', sido: '가나', city: '다라구', ...extra });
// Three 치과병원 in one district (전문의 0명 · 2명 · not recorded) and four 치과의원, two of them in districts without a 치과병원.
const clinics = [
  clinic('h1', '41', `${marker}대학교치과병원`, { doctors: { specialist: 0 } }),
  clinic('h2', '41', `${marker}장애인치과병원`, { doctors: { specialist: 2 } }),
  clinic('h3', '41', `${marker}대학치과병원`),
  clinic('c1', '51'),
  clinic('c2', '51', marker, { cityCode: '110002', city: '마바구' }),
  clinic('c3', '51', marker, { sidoCode: '210000', cityCode: '210001', sido: '사아', city: '자차군' }),
  clinic('c4', '51', `${marker}치과병원의원`),
  clinic('x1', '11'),
];
const reportsFor = list => collectReports(list.filter(c => ['41', '51'].includes(c.typeCode)), { snapshotDate: '2026-09-30', observedAt: '2026-10-20T00:00:00+09:00', sourceSha256: 'test' });
const render = (list = clinics) => {
  const pages = new Map();
  const result = registerAnswerPages({ page: (route, opts) => pages.set(route, opts), clinics: list, snapshotDate: '2026-09-30', reports: reportsFor(list), domain: 'https://example.test' });
  return { pages, result };
};
const computed = SHORT_ANSWERS.filter(a => typeof a.answer === 'function');

test('each short answer is one /guides/ page whose first visible sentence answers the question', () => {
  const { pages, result } = render();
  assert.deepEqual(result, {
    count: 11, snapshot: '2026-09-30', hospitals: 3, clinics: 4, university: 2, disability: 1, districts: 3, districtsWithoutHospital: 2,
    specialist: { known: 2, atLeastOne: 1, zero: 1, unknown: 1 }, names: { hospitalsEndingDentalHospital: 3, clinicsNamedDentalHospital: 1 },
  });
  assert.deepEqual([...pages.keys()], SHORT_ANSWERS.map(answerRoute));
  assert.equal(new Set(SHORT_ANSWERS.map(a => a.slug)).size, SHORT_ANSWERS.length);
  for (const a of SHORT_ANSWERS) {
    const p = pages.get(answerRoute(a)), answer = p.description;
    assert.match(a.question, /\?$/);
    assert.match(answer, /^(네|아니요|[가-힣])[^]*\.$/);
    if (typeof a.answer === 'string') assert.equal(answer, a.answer);
    assert.equal(p.title, a.question);
    const h1 = p.body.indexOf(`<h1>${a.question}</h1>`), at = p.body.indexOf(answer);
    assert.ok(h1 > 0 && at > h1, `${a.slug}: answer follows the question heading`);
    assert.ok(at < p.body.indexOf('근거 원문'), `${a.slug}: answer comes before the sources`);
    const [faq] = p.schema;
    assert.equal(faq['@type'], 'FAQPage');
    assert.equal(faq['@id'], `https://example.test${answerRoute(a)}#faq`, 'absolute @id like every other page');
    assert.equal(faq.mainEntity.length, 1);
    assert.equal(faq.mainEntity[0].name, a.question);
    assert.ok(faq.mainEntity[0].acceptedAnswer.text.startsWith(answer));
    // Aggregates only: no institution name, address or record id reaches the page.
    assert.doesNotMatch(p.body + JSON.stringify(p.schema), /개별기관비공개표식|개별주소비공개표식|privateRecord|\/clinics\//);
    // Facts only: nothing on an answer page ranks or recommends, and no function leaks into the copy unresolved.
    assert.doesNotMatch(p.body, /가장 많|가장 적|최다|최소|1위|추천|최고|우수|유명한|잘하는|=>|undefined|NaN|\[object/, a.slug);
    assert.ok(a.sources.length >= 1);
    for (const key of a.sources) assert.ok(p.body.includes(`확인 ${ANSWER_SOURCES[key].checkedAt}`), `${a.slug}: ${key} shows its 확인일`);
    for (const [href] of a.links) {
      assert.match(href, /^\/(guides|hospitals|reports)\/[a-z0-9/-]*$/);
      if (href.startsWith('/guides/')) assert.ok(pages.has(href), `${a.slug}: ${href} is a registered answer`);
    }
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

test('numeric answers state the count, the 기준일 and the scope in their first sentence', () => {
  const { pages } = render();
  assert.deepEqual(computed.map(a => a.slug), ['how-many-dental-hospitals', 'how-many-dental-institutions', 'districts-without-dental-hospital']);
  for (const a of computed) assert.match(pages.get(answerRoute(a)).description, /^건강보험심사평가원 2026-09-30 자료 기준으로 [^.]*\d+곳[^.]*\./, a.slug);

  const hospitals = pages.get('/guides/how-many-dental-hospitals/');
  assert.equal(hospitals.description, '건강보험심사평가원 2026-09-30 자료 기준으로 전국 치과병원은 3곳입니다. 종별코드 41(치과병원)로 등록된 기관을 센 숫자입니다.');
  assert.match(hospitals.body, /종별코드 51\(치과의원\)로 등록된 기관은 4곳입니다/);
  assert.match(hospitals.body, /시·군·구 3곳 중 치과병원이 1곳 이상 등록된 곳은 1곳입니다/);

  const all = pages.get('/guides/how-many-dental-institutions/');
  assert.equal(all.description, '건강보험심사평가원 2026-09-30 자료 기준으로 전국 치과는 7곳입니다. 치과의원 4곳과 치과병원 3곳을 더한 숫자입니다.');
  assert.match(all.body, /기관 수이며 치과의사 수가 아닙니다/);
  assert.match(all.body, /치과의원이 4곳\(57\.1%\), 치과병원이 3곳\(42\.9%\)입니다/);
  for (const p of [hospitals, all]) {
    // The 시도 table follows the source 시도코드 order and its rows add up to the national row.
    const first = p.body.indexOf('<th scope="row">가나</th><td>3</td><td>3</td><td>6</td>'), second = p.body.indexOf('<th scope="row">사아</th><td>0</td><td>1</td><td>1</td>');
    assert.ok(first > 0 && second > first);
    assert.ok(p.body.includes('<th scope="row">전국</th><td>3</td><td>4</td><td>7</td>'));
    assert.ok(!p.body.includes('지역 코드 없음'));
    assert.match(p.body, /순위가 아닙니다/);
    assert.match(p.body, /지금 운영 중인지 확인한 숫자가 아니며/);
    assert.match(p.body, /종별코드가 41·51이 아닌 기관은 포함하지 않습니다/);
    assert.match(p.body, /기준일과 집계 범위가 달라 이 숫자와 다를 수 있습니다/);
  }

  const districts = pages.get('/guides/districts-without-dental-hospital/');
  assert.equal(districts.description, '건강보험심사평가원 2026-09-30 자료 기준으로 치과가 등록된 시·군·구 3곳 중 2곳에는 치과병원이 없습니다. 이 2곳에도 치과의원은 모두 1곳 이상 등록되어 있습니다.');
  assert.match(districts.body, /치과병원이 1곳 이상 등록된 시·군·구는 1곳\(33\.3%\)입니다/);
  assert.match(districts.body, /군 1곳 중 1곳, 구 \(자치구\) 2곳 중 1곳입니다/);
  assert.doesNotMatch(districts.body, /세종·제주 행정시 포함\) 0곳/);
  assert.match(districts.body, /치과병원이 없는 2곳에 등록된 치과의원은 모두 2곳입니다/);
  assert.match(districts.body, /원자료 시군구코드 그대로 세면 3곳 중 2곳에 치과병원이 없습니다/);
  assert.ok(districts.body.includes('<th scope="row">가나</th><td>2</td><td>1</td><td>1</td>') && districts.body.includes('<th scope="row">전국</th><td>3</td><td>1</td><td>2</td>'));
  assert.match(districts.body, /치과 진료를 받을 수 없다는 뜻이 아닙니다/);
  assert.match(districts.body, /분모는 전국의 모든 시·군·구 수가 아닙니다/);
  assert.ok(districts.body.includes('href="/reports/dental-hospital-districts/"'));
});

test('institutions without a region code stay in the national total and get their own table row', () => {
  const { pages, result } = render([...clinics, clinic('c5', '51', marker, { sidoCode: null })]);
  assert.equal(result.clinics, 5);
  const body = pages.get('/guides/how-many-dental-institutions/').body;
  assert.ok(body.includes('<th scope="row">지역 코드 없음</th><td>0</td><td>1</td><td>1</td>'));
  assert.ok(body.includes('<th scope="row">전국</th><td>3</td><td>5</td><td>8</td>'));
});

test('the 치과전문의 answer quotes the staffing table and never counts an unrecorded hospital as 0명', () => {
  const { pages } = render();
  const p = pages.get('/guides/dental-hospital-specialist-requirement/');
  assert.match(p.description, /^아니요\. 의료법 시행규칙 별표 5는/);
  assert.match(p.body, /치과병원 3곳 중 치과전문의 인원수가 0명으로 등록된 곳은 1곳, 1명 이상으로 등록된 곳은 1곳, 인원수가 기록되지 않은 곳은 1곳입니다/);
  assert.match(p.body, /기록되지 않은 곳은 0명으로 세지 않았습니다/);
  assert.match(p.body, /현재 근무 인원이나 진료 수준을 뜻하지 않습니다/);
  assert.match(ANSWER_SOURCES.staffing.quote, /치과의사 — 종합병원: 의사의 경우와 같음 · 치과병원: 종합병원과 같음/);
  assert.match(ANSWER_SOURCES.staffing.quote, /연평균 1일 입원환자를 20명으로 나눈 수\(이 경우 소수점은 올림\)\. 외래환자 3명은 입원환자 1명으로 환산함/);
  assert.doesNotMatch(ANSWER_SOURCES.staffing.quote, /전문의/);
  assert.match(ANSWER_SOURCES.generalHospital.quote, /각 진료과목마다 전속하는 전문의를 둘 것/);
  assert.doesNotMatch(ANSWER_SOURCES.beds.quote, /전문의/);

  const unrecorded = render(clinics.map(c => ({ ...c, doctors: undefined }))).pages.get('/guides/dental-hospital-specialist-requirement/').body;
  assert.match(unrecorded, /치과병원 3곳에는 치과전문의 인원수가 기록된 곳이 없어 집계하지 않았습니다/);
  assert.doesNotMatch(unrecorded, /0명으로 등록된 곳/);
});

test('the name answer quotes 제42조 and counts registered names without naming an institution', () => {
  const { pages } = render();
  const p = pages.get('/guides/dental-hospital-name-rule/');
  assert.match(p.description, /^아니요\. 의료법 제42조 제1항은[^]*같은 항이 정한 예외가 아니면 ‘치과병원’이라는 명칭을 쓸 수 없습니다\.$/);
  assert.match(p.body, /치과병원 3곳 중 등록 기관명이 ‘치과병원’으로 끝나는 곳은 3곳이고, 치과의원 4곳 중 등록 기관명에 ‘치과병원’이 들어간 곳은 1곳입니다/);
  assert.match(p.body, /간판·광고·온라인 표기는 확인하지 않았습니다/);
  assert.match(ANSWER_SOURCES.names.quote, /^①의료기관은 제3조제2항에 따른 의료기관의 종류에 따르는 명칭 외의 명칭을 사용하지 못한다\./);
  assert.match(ANSWER_SOURCES.names.quote, /5\. 다른 법령으로 따로 정한 명칭을 사용하는 경우/);
  assert.match(ANSWER_SOURCES.nameDisplay.quote, /고유 명칭은 의료기관의 종류 명칭과 혼동할 우려가 있거나/);
  assert.match(ANSWER_SOURCES.nameDisplay.quote, /의료기관의 종류 명칭에서 “치과”를 생략할 수 있다\.$/);
});

test('the 종별가산율 answer follows the 2024 notice and agrees with the fact the reports cite', () => {
  const { pages } = render();
  const p = pages.get('/guides/dental-type-surcharge/');
  assert.equal(p.description, '건강보험 요양기관 종별가산율은 2024년 1월 1일부터 치과의원에는 적용되지 않고 치과병원에는 5%가 적용됩니다. 치과대학 부속 치과병원은 10%, 상급종합병원에 설치된 치과대학 부속 치과병원은 15%입니다.');
  assert.match(p.body, /2023년 이전 자료의 “치과병원 20%·치과의원 15%”는 현행 수치가 아닙니다/);
  assert.match(p.body, /어느 기관이 치과대학 부속 치과병원에 해당하는지는 이 자료로 알 수 없습니다/);
  for (const row of TYPE_SURCHARGE) assert.ok(p.body.includes(`<td>${row.before}</td><td>${row.since}</td>`), row.type);
  assert.match(ANSWER_SOURCES.surcharge.quote, /다\. 다음 각 항의 요양기관은 5% \(1\) 병원 \(2\) 위 “가-\(2\)” 또는 “나-\(2\)”에 해당되지 아니하는 치과병원/);
  assert.match(ANSWER_SOURCES.surcharge.quote, /라\. 다음 각 항의 요양기관은 종별가산율을 적용하지 아니한다\. \(1\) 의원, 치과의원, 한의원, 보건의료원/);
  assert.match(ANSWER_SOURCES.surcharge.quote, /나\. 다음 각 항의 요양기관은 10% … \(2\) 상급종합병원에 설치된 경우를 제외한 치과대학 부속 치과병원/);
  assert.match(ANSWER_SOURCES.surcharge.edition, /제2023-187호[^]*시행 2024-01-01/);
  assert.ok(ANSWER_SOURCES.surcharge.quote.includes(ANSWER_SOURCES.surchargeBook.quote.split(' … ')[1]));
  const cited = EXTERNAL_FACTS.find(f => f.id === 'type-surcharge-2024');
  assert.ok(cited.dentalHospital.startsWith(TYPE_SURCHARGE[1].since) && cited.dentalHospital.includes(TYPE_SURCHARGE[1].before));
  assert.ok(cited.dentalClinic.startsWith('0%') && cited.dentalClinic.includes(TYPE_SURCHARGE[0].before));
  assert.equal(TYPE_SURCHARGE[0].since, '적용하지 않음');
});

test('answer sources are primary, dated and consistent with the facts used elsewhere on the site', () => {
  for (const [key, s] of Object.entries(ANSWER_SOURCES)) {
    // 법령·고시, 건강보험공단, 보건복지부, 심평원, and the 공공데이터포털 page of the dataset the counts come from.
    assert.match(s.url, /^https:\/\/www\.(law\.go\.kr|nhis\.or\.kr|mohw\.go\.kr|hira\.or\.kr|data\.go\.kr)\//, key);
    assert.match(s.checkedAt, /^\d{4}-\d{2}-\d{2}$/, key);
    assert.ok(s.quote.length > 40 && s.edition, key);
  }
  assert.equal(ANSWER_SOURCES.hiraDataset.url, SOURCE_URL);
  assert.match(ANSWER_SOURCES.hiraDataset.quote, /추출일자에 따라 월말 기준 데이터와 집계상 차이가 있습니다/);
  for (const key of ['names', 'generalHospital']) assert.match(ANSWER_SOURCES[key].edition, /^법률 제21111호 · 시행 2026-11-12$/, key);
  for (const key of ['nameDisplay', 'staffing']) assert.match(ANSWER_SOURCES[key].edition, /^보건복지부령 제1177호 · 시행 2026-06-12/, key);
  for (const key of ['hiraDataset', 'names', 'nameDisplay', 'staffing', 'surcharge', 'surchargeBook']) assert.equal(ANSWER_SOURCES[key].checkedAt, '2026-11-26', key);
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
  const { pages } = render();
  const cards = answerCards(), links = answerLinks();
  for (const a of SHORT_ANSWERS) {
    assert.ok(cards.includes(`href="${answerRoute(a)}"`) && links.includes(`href="${answerRoute(a)}"`));
    // After registration a card shows the same first sentence as the page, computed answers included.
    assert.ok(cards.includes(`<p>${esc(pages.get(answerRoute(a)).description)}</p>`), a.slug);
  }
  assert.match(cards, /전국 치과는 7곳입니다/);
  assert.doesNotMatch(cards + links, /<script|=>/);
  // Without counts a computed answer has no text to show, and never a typed number.
  for (const a of computed) assert.equal(answerText(a, null), null);
  assert.equal(answerText(SHORT_ANSWERS[0], null), SHORT_ANSWERS[0].answer);
});

test('registration needs the report data of the same institutions', () => {
  const page = () => {};
  assert.throws(() => registerAnswerPages({ page: null, clinics, reports: reportsFor(clinics) }), TypeError);
  assert.throws(() => registerAnswerPages({ page, clinics, snapshotDate: '2026-09-30' }), TypeError);
  assert.throws(() => registerAnswerPages({ page, clinics, snapshotDate: '2026-09-30', reports: reportsFor(clinics.slice(1)) }), /different set of institutions/);
});
