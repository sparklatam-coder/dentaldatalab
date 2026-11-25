// Short answers: one question per page under /guides/<slug>/, the first sentence is the answer.
// Administrative and legal questions only (institution types, insurance procedure, copay rates). Every claim is a
// quoted primary source with its edition and 확인일, or a count computed from the registered data at build time.
// No institution names, no recommendations, no treatment advice; treatment questions stay in /questions/ until reviewed.
import fs from 'node:fs';
import {esc, fmt, icon} from '../src/shared.mjs';
import {externalLink} from './html.mjs';
import {EXTERNAL_FACTS} from './report-data.mjs';

const CHECKED_AT = '2026-11-26';
// 보건복지부 장애인구강진료센터 표: cell strings copied verbatim from the ministry page (see the file's source block).
export const DISABILITY_CENTERS = JSON.parse(fs.readFileSync(new URL('../data/content/disability-dental-centers.json', import.meta.url), 'utf8'));
const centers = DISABILITY_CENTERS.centers, centerSource = DISABILITY_CENTERS.source;
const centralCenters = centers.filter(c => c.level === '중앙'), regionalCenters = centers.filter(c => c.level === '권역');
const MEDICAL_ACT_EDITION = '법률 제21111호 · 시행 2026-11-12';
const fact = id => {
  const f = EXTERNAL_FACTS.find(x => x.id === id);
  if (!f) throw new Error('Missing external fact: ' + id);
  return f;
};

/** Primary sources quoted on the answer pages. */
export const ANSWER_SOURCES = Object.freeze({
  classification: {title: fact('medical-service-act-3-2').title, url: fact('medical-service-act-3-2').sourceUrl, edition: MEDICAL_ACT_EDITION, checkedAt: fact('medical-service-act-3-2').checkedAt,
    quote: fact('medical-service-act-3-2').quote},
  beds: {title: fact('medical-service-act-3-2bis').title, url: fact('medical-service-act-3-2bis').sourceUrl, edition: MEDICAL_ACT_EDITION, checkedAt: fact('medical-service-act-3-2bis').checkedAt,
    quote: fact('medical-service-act-3-2bis').quote},
  generalHospital: {title: '의료법 제3조의3 (종합병원)', url: 'https://www.law.go.kr/법령/의료법/제3조의3', edition: MEDICAL_ACT_EDITION, checkedAt: CHECKED_AT,
    quote: '① 종합병원은 다음 각 호의 요건을 갖추어야 한다. 1. 100개 이상의 병상을 갖출 것 2. 100병상 이상 300병상 이하인 경우에는 내과ㆍ외과ㆍ소아청소년과ㆍ산부인과 중 3개 진료과목, 영상의학과, 마취통증의학과와 진단검사의학과 또는 병리과를 포함한 7개 이상의 진료과목을 갖추고 각 진료과목마다 전속하는 전문의를 둘 것 3. 300병상을 초과하는 경우에는 내과, 외과, 소아청소년과, 산부인과, 영상의학과, 마취통증의학과, 진단검사의학과 또는 병리과, 정신건강의학과 및 치과를 포함한 9개 이상의 진료과목을 갖추고 각 진료과목마다 전속하는 전문의를 둘 것 ② 종합병원은 제1항제2호 또는 제3호에 따른 진료과목(이하 이 항에서 “필수진료과목”이라 한다) 외에 필요하면 추가로 진료과목을 설치ㆍ운영할 수 있다.'},
  benefitSteps: {title: '국민건강보험 요양급여의 기준에 관한 규칙 제2조 (요양급여의 절차)', url: 'https://www.law.go.kr/법령/국민건강보험요양급여의기준에관한규칙/제2조', edition: '보건복지부령 제1209호 · 2026-11-13 일부개정', checkedAt: CHECKED_AT,
    quote: '② 1단계 요양급여는 「의료법」제3조의4에 따른 상급종합병원을 제외한 요양기관에서 받는 요양급여(건강진단 또는 건강검진을 포함한다)를 말하며, 2단계 요양급여는 상급종합병원에서 받는 요양급여를 말한다. ③ … 가입자등이 다음 각호의 1에 해당하는 경우에는 상급종합병원에서 1단계 요양급여를 받을 수 있다. … 3. 치과에서 요양급여를 받는 경우 … ④ 가입자등이 상급종합병원에서 2단계 요양급여를 받고자 하는 때에는 상급종합병원에서의 요양급여가 필요하다는 의사소견이 기재된 건강진단ㆍ건강검진결과서 또는 별지 제4호서식의 요양급여의뢰서를 건강보험증 또는 신분증명서 … 와 함께 제출하여야 한다.'},
  disabilityCenters: {title: centerSource.title, url: centerSource.url, edition: `${centerSource.department} · 최종수정일 ${centerSource.pageModifiedAt}`, checkedAt: centerSource.checkedAt,
    quote: [centerSource.purpose, ...centerSource.support, centerSource.supportCondition].join(' / ')},
  oralHealthAct: {title: '구강보건법 제15조의2 (장애인구강진료센터의 설치 등)', url: 'https://www.law.go.kr/법령/구강보건법/제15조의2', edition: '법률 제19474호 · 시행 2025-06-14', checkedAt: CHECKED_AT,
    quote: '① 보건복지부장관은 장애인의 구강보건 및 구강건강증진에 관한 다음 각 호의 업무를 수행하기 위하여 중앙장애인구강진료센터를 설치ㆍ운영하여야 한다. … ② 시ㆍ도지사는 장애인의 구강진료 등 구강보건 및 구강건강증진을 효율적으로 추진하기 위하여 권역장애인구강진료센터 및 지역장애인구강진료센터를 설치ㆍ운영할 수 있다. 이 경우 권역장애인구강진료센터는 각 시ㆍ도에 1개소 이상 설치ㆍ운영하여야 한다. ③ 보건복지부장관과 시ㆍ도지사는 … 설치ㆍ운영을 업무에 필요한 전문인력과 시설을 갖춘 기관에 위탁할 수 있다.'},
  copay: {title: '국민건강보험공단 「본인일부부담금」 안내 (외래)', url: fact('nhis-outpatient-copay').sourceUrl, edition: '근거: 국민건강보험법 시행령 제19조 제1항·별표 2', checkedAt: CHECKED_AT,
    quote: '상급종합병원: 진찰료 총액 + (요양급여비용 총액 - 진찰료총액) × 60/100. 종합병원: 동지역 요양급여비용 총액 × 50/100, 읍·면지역 × 45/100. 병원, 치과병원, 한방병원, 요양병원: 동지역 × 40/100, 읍·면지역 × 35/100. 의원, 치과의원, 한의원, 보건의료원: 요양급여비용 총액 × 30/100. (임신부·1세 미만 영유아 외래진료는 별도 비율)'},
});

// 일반 환자 외래 본인부담률, as listed on the NHIS page above.
export const OUTPATIENT_COPAY = Object.freeze([
  {type: '치과의원 (의원급)', dong: '30%', eupmyeon: '30%'},
  {type: '치과병원 (병원급)', dong: '40%', eupmyeon: '35%'},
  {type: '종합병원', dong: '50%', eupmyeon: '45%'},
  {type: '상급종합병원', dong: '진찰료 전액 + 나머지의 60%', eupmyeon: '진찰료 전액 + 나머지의 60%'},
]);

// Phone numbers stay verbatim; each number inside the cell becomes a tel: link that does not break across lines.
const telLinks = text => esc(text).replace(/\b(?:0\d{1,2}-\d{3,4}-\d{4}|1\d{3}-\d{4})\b/g, n => `<a href="tel:${n.replaceAll('-', '')}" style="white-space:nowrap">${n}</a>`);
const centerTable = () => `<div class="table-scroll" tabindex="0" role="region" aria-label="장애인구강진료센터 ${centers.length}곳 표"><table class="simple-table"><caption class="subtle-note" style="text-align:left;caption-side:bottom;padding-top:8px">${esc(centerSource.department)} 안내 · 최종수정일 ${esc(centerSource.pageModifiedAt)} · 원문 표의 문자열을 그대로 옮겼습니다.</caption><thead><tr><th scope="col">연번</th><th scope="col">센터 · 운영기관</th><th scope="col">주소</th><th scope="col">진료문의</th></tr></thead><tbody>${centers.map(c => `<tr><td>${c.no}</td><th scope="row">${esc([c.region, c.level].filter(Boolean).join(' '))}<small style="display:block;font-weight:400">${esc(c.operator)}</small></th><td>${esc(c.address)}</td><td>${telLinks(c.phone)}</td></tr>`).join('')}</tbody></table></div>`;

const copayTable = () => `<div class="table-scroll" tabindex="0" role="region" aria-label="의료기관 종별 외래 본인부담률 표"><table class="simple-table"><caption class="subtle-note" style="text-align:left;caption-side:bottom;padding-top:8px">요양급여비용 총액 중 본인이 내는 비율 · 일반 환자 외래 기준 · 비급여 항목에는 적용되지 않습니다.</caption><thead><tr><th scope="col">기관 종별</th><th scope="col">동 지역</th><th scope="col">읍·면 지역</th></tr></thead><tbody>${OUTPATIENT_COPAY.map(r => `<tr><th scope="row">${esc(r.type)}</th><td>${esc(r.dong)}</td><td>${esc(r.eupmyeon)}</td></tr>`).join('')}</tbody></table></div>`;

/**
 * The published short answers. `answer` is the first sentence(s) and must answer the question on its own;
 * `details` explain the basis; `data(ctx)` adds counts from the registered data; `caveats` say what the answer does not cover.
 */
export const SHORT_ANSWERS = Object.freeze([
  {
    slug: 'dental-hospital-30-beds', question: '치과병원은 30병상이 있어야 하나요?',
    answer: '아니요. 의료법 제3조의2가 정한 30개 이상 병상 요건은 병원·한방병원에만 적용되며, 치과병원은 여기에 해당하지 않습니다.',
    details: [
      '같은 조문은 병원·치과병원·한방병원·요양병원을 “병원등”으로 묶지만, 30병상 요건에는 “병원·한방병원만 해당한다”는 괄호를 붙였습니다. 요양병원에는 요양병상 요건이 따로 있습니다.',
      '치과병원은 의료법 제3조 제2항에서 병원급 의료기관으로 분류됩니다. 법은 병원급을 “주로 입원환자를 대상으로” 하는 기관으로 설명하지만, 이는 법령의 분류 기준이며 각 치과병원의 실제 입원 진료 비중을 뜻하지 않습니다.',
    ],
    data: ({hospitals, snapshot}) => `치과데이터랩이 수록한 치과병원은 ${fmt(hospitals)}곳(심평원 ${snapshot} 기준)입니다. 이 사이트는 병상 수 자료를 수록하지 않아 기관별 병상 수는 보여주지 않습니다.`,
    caveats: ['입원실 등 세부 시설 기준(의료법 시행규칙 별표 3)은 이 답에서 다루지 않습니다.', '“30병상 이상이면 치과병원”이라는 설명은 법령 문언과 다릅니다.'],
    sources: ['beds', 'classification'],
    links: [['/hospitals/', '전국 치과병원 목록'], ['/reports/dental-hospital-vs-clinic/', '치과병원과 치과의원, 무엇이 다른가']],
  },
  {
    slug: 'dental-copay-by-institution-type', question: '치과병원은 치과의원보다 본인부담률이 높나요?',
    answer: '네. 일반 환자의 건강보험 외래 진료 기준으로 요양급여비용 총액 중 본인이 내는 비율은 치과의원 30%, 치과병원은 동 지역 40%·읍·면 지역 35%입니다.',
    details: [
      '이 비율은 건강보험이 적용되는 급여 진료의 본인일부부담금에 쓰입니다. 스케일링(치석 제거)도 건강보험이 적용되는 경우라면 이 비율로 계산하며, 비급여 항목에는 적용되지 않습니다.',
      '같은 진료라도 기관 종별에 따라 요양급여비용 총액 자체가 다를 수 있어, 실제로 내는 금액의 차이는 비율의 차이와 같지 않습니다.',
    ],
    table: copayTable,
    data: ({hospitals, clinics, snapshot}) => `심평원 ${snapshot} 자료 기준으로 치과의원은 ${fmt(clinics)}곳, 치과병원은 ${fmt(hospitals)}곳입니다.`,
    caveats: ['65세 이상 외래 정액제, 임신부·1세 미만 영유아 등은 같은 안내에 별도 기준이 있고, 산정특례·의료급여 대상은 다른 기준을 따릅니다.', '본인부담률은 기관 종별에 따른 법정 비율이며 진료의 질이나 범위를 뜻하지 않습니다.'],
    sources: ['copay', 'classification'],
    links: [['/reports/dental-hospital-vs-clinic/', '치과병원과 치과의원, 무엇이 다른가'], ['/guides/dental-hospital-vs-general-hospital-dentistry/', '종합병원 치과와는 무엇이 다른가요?']],
  },
  {
    slug: 'dental-hospital-vs-general-hospital-dentistry', question: '치과병원과 종합병원 치과는 무엇이 다른가요?',
    answer: '치과병원은 그 자체가 의료법상 하나의 의료기관 종류이고, 종합병원 치과는 여러 진료과목을 갖춘 종합병원 안의 한 진료과목입니다. 외래 본인부담률도 달라 일반 환자 기준 동 지역에서 치과병원은 40%, 종합병원은 50%입니다.',
    details: [
      '의료법 제3조 제2항은 치과병원과 종합병원을 각각 병원급 의료기관의 한 종류로 둡니다. 종합병원은 100개 이상의 병상을 갖추고, 필수 진료과목마다 전속 전문의를 두어야 합니다(제3조의3).',
      '치과가 필수 진료과목인지는 병상 규모에 따라 다릅니다. 300병상을 초과하는 종합병원은 치과를 포함한 9개 이상의 진료과목을 갖춰야 합니다. 100~300병상 종합병원의 필수 진료과목에는 치과가 들어 있지 않으며, 치과는 필요하면 추가로 두는 진료과목입니다.',
    ],
    table: copayTable,
    data: () => '치과데이터랩의 기관 수와 목록은 심평원 종별코드 41(치과병원)과 51(치과의원)만 집계합니다. 종합병원·상급종합병원의 치과는 포함하지 않습니다.',
    caveats: ['종별은 법적 분류이며 진료 범위나 수준의 차이를 뜻하지 않습니다.', '상급종합병원은 종합병원 중 보건복지부장관이 지정한 기관(의료법 제3조의4)으로, 본인부담 기준이 따로 있습니다.'],
    sources: ['classification', 'generalHospital', 'copay'],
    links: [['/hospitals/', '전국 치과병원 목록'], ['/guides/dental-copay-by-institution-type/', '치과병원은 치과의원보다 본인부담률이 높나요?']],
  },
  {
    slug: 'university-dental-hospital-referral', question: '대학 치과병원에서 진료받으려면 진료의뢰서가 필요한가요?',
    answer: '건강보험 기준으로는 필요하지 않습니다. 치과병원은 의뢰서 없이 이용하는 1단계 요양기관이고, 상급종합병원이라도 치과 진료는 의뢰서 없이 받을 수 있는 예외에 해당합니다.',
    details: [
      '「국민건강보험 요양급여의 기준에 관한 규칙」 제2조는 상급종합병원을 뺀 요양기관에서 받는 진료를 1단계, 상급종합병원에서 받는 진료를 2단계로 나눕니다. 2단계 진료를 받으려면 요양급여의뢰서나, 상급종합병원 진료가 필요하다는 의사 소견이 적힌 건강검진 결과서를 내야 합니다.',
      '같은 조 제3항 제3호는 “치과에서 요양급여를 받는 경우” 상급종합병원에서도 1단계 요양급여를 받을 수 있다고 정합니다. 대학 치과병원이 치과병원(종별코드 41)으로 등록돼 있든 상급종합병원 안의 치과이든, 건강보험 적용을 위해 의뢰서를 낼 필요가 없습니다.',
      '의뢰서와 별개로 예약 방식과 첫 진료 절차는 기관마다 다르므로 방문 전에 해당 기관에 확인하세요.',
    ],
    data: ({hospitals, university, snapshot}) => `심평원 ${snapshot} 자료의 치과병원 ${fmt(hospitals)}곳 중 기관명에 ‘대학’이 들어간 곳은 ${fmt(university)}곳입니다. 기관명 기준이며 대학 부속 여부를 확인한 숫자가 아닙니다.`,
    caveats: ['이전 진료 기록이나 영상 자료를 가져와야 하는지는 이 규칙이 정하지 않으며, 기관 안내를 따릅니다.', '의뢰서가 필요 없다는 것과 본인부담률은 별개입니다. 본인부담률은 기관 종별에 따라 다릅니다.'],
    sources: ['benefitSteps'],
    links: [['/hospitals/university/', '기관명에 ‘대학’이 있는 치과병원'], ['/guides/dental-copay-by-institution-type/', '치과병원은 치과의원보다 본인부담률이 높나요?']],
  },
  {
    slug: 'disability-dental-centers', question: '장애인 치과병원은 어디에 있나요?',
    answer: `보건복지부가 안내하는 장애인구강진료센터는 중앙 ${centralCenters.length}곳(${centralCenters.map(c => c.operator).join('·')})과 권역 ${regionalCenters.length}곳, 모두 ${centers.length}곳입니다. 대학(치과)병원 등에 위탁해 운영하며, 시도별 운영기관과 진료문의 번호는 이 페이지의 표에 있습니다.`,
    details: [
      '구강보건법 제15조의2에 따라 보건복지부장관은 중앙장애인구강진료센터를 설치·운영하고, 시·도지사는 권역장애인구강진료센터를 각 시·도에 1곳 이상 설치·운영해야 합니다. 시·도는 지역장애인구강진료센터를 둘 수도 있는데, 보건복지부 표는 중앙·권역센터만 싣고 있어 지역센터는 아래 표에 나오지 않습니다.',
      `센터에서 진료받는 장애인은 구비서류(장애인 복지카드, 해당자는 기초생활수급자증명서)를 지참하면 예산 범위 안에서 비급여 진료비 일부를 지원받을 수 있습니다. 보건복지부 안내 기준으로 기초생활수급자 장애인은 비급여 진료비 총액의 50%, 치과영역 중증 장애인은 30%, 기타 장애인은 10%입니다.`,
      '예약 방법과 진료 일정은 센터마다 다르므로 표의 진료문의 번호로 확인하세요.',
    ],
    table: centerTable,
    data: ({hospitals, disability}) => `심평원 자료에는 장애인 진료 지정 여부 항목이 없습니다. 치과병원 ${fmt(hospitals)}곳 중 기관명에 ‘장애인’이 들어간 곳은 ${fmt(disability)}곳이며, 센터 지정과는 별개인 이름 기준 숫자입니다. 센터 운영기관 ${centers.length}곳 중 ${centers.filter(c => !c.operator.includes('치과')).length}곳은 이름에 ‘치과’가 없는 병원·의료원이어서, 치과병원·치과의원만 다루는 이 사이트의 기관 목록에는 나오지 않을 수 있습니다.`,
    caveats: ['센터 목록은 보건복지부 안내를 그대로 옮긴 것이며, 이 사이트가 각 센터의 현재 운영 상태를 확인한 것은 아닙니다.', '진료비 지원은 비급여 진료비에 대한 것으로 예산 범위 안에서 이뤄집니다. 건강보험 급여 진료의 본인부담은 별도 기준을 따릅니다.'],
    sources: ['disabilityCenters', 'oralHealthAct'],
    links: [['/hospitals/disability/', '기관명에 ‘장애인’이 있는 치과병원'], ['/hospitals/', '전국 치과병원 목록']],
  },
]);

export const answerRoute = a => `/guides/${a.slug}/`;

const sourceItem = s => `<li><strong>${esc(s.title)}</strong><p>${esc(s.edition)} · 확인 ${esc(s.checkedAt)}</p><p>“${esc(s.quote)}”</p>${externalLink(s.url, '원문 보기', {withIcon: true})}</li>`;

/** The cards shown on /guides/ and the link list shown on /hospitals/. */
export const answerCards = () => `<div class="guide-grid">${SHORT_ANSWERS.map((a, i) => `<a class="guide-card" href="${answerRoute(a)}"><small>짧은 답 ${String(i + 1).padStart(2, '0')}</small><h3>${esc(a.question)}</h3><p>${esc(a.answer)}</p></a>`).join('')}</div>`;
export const answerLinks = () => `<div class="condition-links">${SHORT_ANSWERS.map(a => `<a href="${answerRoute(a)}">${esc(a.question)} ${icon('arrow')}</a>`).join('')}</div>`;

/** Registers one page per short answer. Counts come from the clinics array; no institution is named. */
export function registerAnswerPages({page, clinics, snapshotDate, domain = ''}) {
  if (typeof page !== 'function' || !Array.isArray(clinics)) throw new TypeError('registerAnswerPages needs page() and a clinics array');
  const hospitalsList = clinics.filter(c => c?.typeCode === '41');
  const ctx = {
    snapshot: snapshotDate,
    hospitals: hospitalsList.length,
    clinics: clinics.filter(c => c?.typeCode === '51').length,
    university: hospitalsList.filter(c => String(c.name ?? '').includes('대학')).length,
    disability: hospitalsList.filter(c => String(c.name ?? '').includes('장애인')).length,
  };
  for (const a of SHORT_ANSWERS) {
    const route = answerRoute(a);
    const sources = a.sources.map(k => ANSWER_SOURCES[k]);
    const checked = sources.map(s => s.checkedAt).sort().at(-1);
    const schemaAnswer = [a.answer, ...a.details.slice(0, 1)].join(' ');
    const related = SHORT_ANSWERS.filter(x => x !== a);
    page(route, {
      title: a.question,
      description: a.answer,
      current: 'guides',
      breadcrumb: [{label: '치과 비교 가이드', url: '/guides/'}, {label: a.question}],
      schema: [{'@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${domain}${route}#faq`, mainEntity: [{'@type': 'Question', name: a.question, acceptedAnswer: {'@type': 'Answer', text: schemaAnswer}}]}],
      body: `<div class="wrap narrow"><div class="page-intro"><div class="pill-row"><span class="pill">짧은 답</span><span class="pill neutral">출처 확인 ${esc(checked)}</span></div><h1>${esc(a.question)}</h1></div>
      <section class="fact-panel" id="answer"><h2>짧은 답</h2><p class="answer-text"><strong>${esc(a.answer)}</strong></p>${a.details.map(d => `<p class="answer-text">${esc(d)}</p>`).join('')}${a.table ? a.table() : ''}</section>
      <section class="fact-panel" id="data"><h2>치과데이터랩 자료로 보면</h2><p class="answer-text">${esc(a.data(ctx))}</p></section>
      <div class="source-banner warning">${icon('info')}<div><strong>이 답이 다루지 않는 것</strong>${a.caveats.map(c => `<p>${esc(c)}</p>`).join('')}<p>치료 방법이나 기관 선택을 권하는 답이 아닙니다. 개인 상황에 따른 비용과 절차는 해당 기관이나 국민건강보험공단에 확인하세요.</p></div></div>
      <section class="fact-panel" id="sources"><h2>근거 원문</h2><ul class="source-list">${sources.map(sourceItem).join('')}</ul></section>
      <section class="section" aria-labelledby="related-title"><h2 id="related-title">함께 보기</h2><div class="condition-links">${a.links.map(([href, label]) => `<a href="${esc(href)}">${esc(label)} ${icon('arrow')}</a>`).join('')}</div><h3 style="margin-top:28px">다른 짧은 답</h3><div class="condition-links">${related.map(x => `<a href="${answerRoute(x)}">${esc(x.question)} ${icon('arrow')}</a>`).join('')}</div></section></div>`,
    });
  }
  return {count: SHORT_ANSWERS.length, ...ctx};
}
