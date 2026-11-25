// Short answers: one question per page under /guides/<slug>/, the first sentence is the answer.
// Administrative and legal questions only (institution types, insurance procedure, copay and fee rates, registered counts). Every claim is a
// quoted primary source with its edition and 확인일, or a count computed from the registered data at build time.
// No institution names, no recommendations, no treatment advice; treatment questions stay in /questions/ until reviewed.
// Numeric answers take their first sentence from the build's own counts: `answer`, `details`, `caveats` and their
// items may be functions of the view that registerAnswerPages() builds from the clinics array and the report data.
import fs from 'node:fs';
import {esc, fmt, icon, SOURCE_URL} from '../src/shared.mjs';
import {percentage} from './common.mjs';
import {externalLink} from './html.mjs';
import {EXTERNAL_FACTS, externalFact} from './report-data.mjs';

const CHECKED_AT = '2026-11-26';
// 보건복지부 장애인구강진료센터 표: cell strings copied verbatim from the ministry page (see the file's source block).
export const DISABILITY_CENTERS = JSON.parse(fs.readFileSync(new URL('../data/content/disability-dental-centers.json', import.meta.url), 'utf8'));
const centers = DISABILITY_CENTERS.centers, centerSource = DISABILITY_CENTERS.source;
const centralCenters = centers.filter(c => c.level === '중앙'), regionalCenters = centers.filter(c => c.level === '권역');
const MEDICAL_ACT_EDITION = '법률 제21111호 · 시행 2026-11-12';
const MEDICAL_RULE_EDITION = '보건복지부령 제1177호 · 시행 2026-06-12';
const fact = externalFact;

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
  // The dataset every count on this site comes from. The edition is the portal page's own 수정일 on the 확인일.
  hiraDataset: {title: '공공데이터포털 「건강보험심사평가원_전국 병의원 및 약국 현황」 자료 설명', url: SOURCE_URL, edition: '제공기관 건강보험심사평가원 · 업데이트 주기 분기 · 수정일 2026-10-20', checkedAt: CHECKED_AT,
    quote: '요양기관 기본정보, 세부정보, 시설정보, 의료장비정보 등 요양기관별 상세 현황 정보입니다. … 해당 자료는 Open API를 기반으로 실시간 조회되는 자료를 분기별 및 연말에 조회하여 등록하는 자료이므로, 등록된 목록 이외의 과거시점 기준 자료는 제공하지 않습니다. ※ 해당 자료는 분기별로 산출하고 있으나, 업무상 추출일자에 따라 월말 기준 데이터와 집계상 차이가 있습니다. … ※ 연도말 기준 집계 자료는 공공데이터 포털에 등록된 건강보험심사평가원의 "요양기관 개설 현황" 파일데이터를 이용하여 주시기 바랍니다.'},
  names: {title: '의료법 제42조 (의료기관의 명칭)', url: 'https://www.law.go.kr/법령/의료법/제42조', edition: MEDICAL_ACT_EDITION, checkedAt: CHECKED_AT,
    quote: '①의료기관은 제3조제2항에 따른 의료기관의 종류에 따르는 명칭 외의 명칭을 사용하지 못한다. 다만, 다음 각 호의 어느 하나에 해당하는 경우에는 그러하지 아니하다. 1. 종합병원 또는 정신병원이 그 명칭을 병원으로 표시하는 경우 2. 제3조의4제1항에 따라 상급종합병원으로 지정받거나 제3조의5제1항에 따라 전문병원으로 지정받은 의료기관이 지정받은 기간 동안 그 명칭을 사용하는 경우 3. 제33조제8항 단서에 따라 개설한 의원급 의료기관이 면허 종별에 따른 종별명칭을 함께 사용하는 경우 4. 국가나 지방자치단체에서 개설하는 의료기관이 보건복지부장관이나 시ㆍ도지사와 협의하여 정한 명칭을 사용하는 경우 5. 다른 법령으로 따로 정한 명칭을 사용하는 경우 ②의료기관의 명칭 표시에 관한 사항은 보건복지부령으로 정한다. ③의료기관이 아니면 의료기관의 명칭이나 이와 비슷한 명칭을 사용하지 못한다.'},
  nameDisplay: {title: '의료법 시행규칙 제40조 (의료기관의 명칭 표시)', url: 'https://www.law.go.kr/법령/의료법시행규칙/제40조', edition: MEDICAL_RULE_EDITION, checkedAt: CHECKED_AT,
    quote: '법 제42조제2항에 따라 의료기관의 명칭 표시는 다음 각 호에 정하는 바에 따른다. 1. 의료기관이 명칭을 표시하는 경우에는 법 제3조제2항에 따른 의료기관의 종류에 따르는 명칭(종합병원ㆍ정신병원의 경우에는 병원을 포함한다) 앞에 고유명칭을 붙인다. 이 경우 의료기관의 종류 명칭의 글자 크기는 고유명칭의 2분의 1 범위에서 크거나 작게 하되, 고유 명칭은 의료기관의 종류 명칭과 혼동할 우려가 있거나 특정 진료과목 또는 질환명과 비슷한 명칭을 사용하지 못한다. … 4. 병원ㆍ한방병원ㆍ치과병원ㆍ의원ㆍ한의원 또는 치과의원의 개설자가 전문의인 경우에는 그 의료기관의 고유명칭 앞에 전문과목 및 전문의를 함께 표시하거나 의료기관의 고유명칭과 의료기관의 종류 명칭 사이에 인정받은 전문과목을 삽입하여 표시할 수 있다. 이 경우 전문과목에 “치과”가 포함된 치과병원ㆍ치과의원의 경우에는 제1호 전단에도 불구하고 의료기관의 종류 명칭에서 “치과”를 생략할 수 있다.'},
  // 별표 5 is a table. The quote keeps each cell's text as published and labels it with the table's own row and column headers.
  staffing: {title: '의료법 시행규칙 [별표 5] 의료기관에 두는 의료인의 정원(제38조 관련)', url: 'https://www.law.go.kr/법령별표서식/(의료법시행규칙,별표5)', edition: `${MEDICAL_RULE_EDITION} · 별표 5 개정 2015-05-29 · 표의 칸을 “구분 — 의료기관 종류: 칸 내용” 순으로 옮김`, checkedAt: CHECKED_AT,
    quote: '의료기관에 두는 의료인의 정원(제38조 관련) / 치과의사 — 종합병원: 의사의 경우와 같음 · 치과병원: 종합병원과 같음 · 치과의원: 종합병원과 같음 / 의사 — 종합병원: 연평균 1일 입원환자를 20명으로 나눈 수(이 경우 소수점은 올림). 외래환자 3명은 입원환자 1명으로 환산함'},
  // The amendment that set today's 종별가산율, and HIRA's consolidated fee schedule that still carries the same text.
  surcharge: {title: '「건강보험 행위 급여·비급여 목록표 및 급여 상대가치점수」 일부개정 · 제1편 제1부 Ⅱ. 요양기관 종별가산율', url: 'https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000230592', edition: '보건복지부고시 제2023-187호 (2023-10-10 일부개정) · 시행 2024-01-01', checkedAt: CHECKED_AT,
    quote: '제1편 제1부 Ⅱ. 요양기관 종별가산율 중 일부를 다음과 같이 한다. 1. 제2부 제2장 내지 제10장, 제13장 및 제14장, 제19장 및 제20장에 분류된 분류항목에 대하여는 소정점수에 점수당 단가를 곱한 금액을 모두 합산한 금액에 요양기관의 종별에 따라 다음 각 호의 비율을 가산한다. 가. 다음 각 항의 요양기관은 15% … (2) 상급종합병원에 설치된 치과대학 부속 치과병원 … 나. 다음 각 항의 요양기관은 10% … (2) 상급종합병원에 설치된 경우를 제외한 치과대학 부속 치과병원 … 다. 다음 각 항의 요양기관은 5% (1) 병원 (2) 위 “가-(2)” 또는 “나-(2)”에 해당되지 아니하는 치과병원 … 라. 다음 각 항의 요양기관은 종별가산율을 적용하지 아니한다. (1) 의원, 치과의원, 한의원, 보건의료원 … 이 고시는 2024년 1월 1일부터 시행한다.'},
  surchargeBook: {title: '건강보험심사평가원 「건강보험요양급여비용」 2026년 1월판 · 제1편 제1부 Ⅱ. 요양기관 종별가산율', url: 'https://www.hira.or.kr/ebooksc/2026/03/BZ202603053039374.pdf', edition: '발행 2026년 2월 · 보건복지부 고시 제2025-249호 수록 · 63쪽', checkedAt: CHECKED_AT,
    quote: 'Ⅱ. 요양기관 종별가산율 … 다. 다음 각 항의 요양기관은 5% (1) 병원 (2) 위 “가-(2)” 또는 “나-(2)”에 해당되지 아니하는 치과병원 … 라. 다음 각 항의 요양기관은 종별가산율을 적용하지 아니한다. (1) 의원, 치과의원, 한의원, 보건의료원'},
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

// 종별가산율 before and after 보건복지부고시 제2023-187호 (its 신구조문대비표 gives the earlier rates), dental rows only.
export const TYPE_SURCHARGE = Object.freeze([
  {type: '치과의원', before: '15%', since: '적용하지 않음'},
  {type: '치과병원 (아래 두 경우가 아닌 곳)', before: '20%', since: '5%'},
  {type: '치과대학 부속 치과병원 (상급종합병원에 설치된 경우 제외)', before: '25%', since: '10%'},
  {type: '상급종합병원에 설치된 치과대학 부속 치과병원', before: '30%', since: '15%'},
]);

const tableNote = text => `<caption class="subtle-note" style="text-align:left;caption-side:bottom;padding-top:8px">${esc(text)}</caption>`;
const countCell = n => `<td>${fmt(n)}</td>`;

const surchargeTable = () => `<div class="table-scroll"><table class="simple-table">${tableNote('보건복지부고시 제2023-187호와 그 신구조문대비표 기준 · 고시가 정한 장의 행위 금액에 더하는 비율이며 약제비·치료재료대 등에는 붙지 않습니다.')}<thead><tr><th scope="col">요양기관</th><th scope="col">2023년까지</th><th scope="col">2024-01-01부터</th></tr></thead><tbody>${TYPE_SURCHARGE.map(r => `<tr><th scope="row">${esc(r.type)}</th><td>${esc(r.before)}</td><td>${esc(r.since)}</td></tr>`).join('')}</tbody></table></div>`;

// 시도별 기관 수. Rows follow the source 시도코드 order (never a ranking) and keep the source's own 시도 labels.
// Institutions without a region code are in no 시도 row, so they get a row of their own instead of vanishing from the total.
const sidoTable = ({snapshot, hospitals, clinics, districts: d}) => {
  const row = (label, h, c) => `<tr><th scope="row">${esc(label)}</th>${countCell(h)}${countCell(c)}${countCell(h + c)}</tr>`;
  const unplaced = [hospitals - d.hospitals, clinics - d.clinics];
  return `<div class="table-scroll"><table class="simple-table">${tableNote(`심평원 ${snapshot} 자료 · 단위: 곳 · 원자료 시도코드 순서이며 순위가 아닙니다 · 시도 이름과 묶음은 원자료 표기 그대로입니다.`)}<thead><tr><th scope="col">시도 (원자료 표기)</th><th scope="col">치과병원</th><th scope="col">치과의원</th><th scope="col">합계</th></tr></thead><tbody>${d.bySido.map(s => row(s.sido, s.hospitals, s.clinics)).join('')}${unplaced.some(Boolean) ? row('지역 코드 없음', ...unplaced) : ''}${row('전국', hospitals, clinics)}</tbody></table></div>`;
};

// 시도별로 시·군·구 몇 곳에 치과병원이 있고 없는지. Same order and labels as sidoTable.
const districtTable = ({snapshot, districts: d}) => {
  const row = s => `<tr><th scope="row">${esc(s.sido)}</th>${countCell(s.total)}${countCell(s.withHospital)}${countCell(s.withoutHospital)}</tr>`;
  return `<div class="table-scroll"><table class="simple-table">${tableNote(`심평원 ${snapshot} 자료 · 단위: 곳 · 치과가 1곳 이상 등록된 시·군·구만 셉니다 · 원자료 시도코드 순서이며 순위가 아닙니다.`)}<thead><tr><th scope="col">시도 (원자료 표기)</th><th scope="col">시·군·구</th><th scope="col">치과병원이 있는 곳</th><th scope="col">치과병원이 없는 곳</th></tr></thead><tbody>${d.bySido.map(row).join('')}${row({sido: '전국', total: d.total, withHospital: d.withHospital, withoutHospital: d.withoutHospital})}</tbody></table></div>`;
};

const share = (count, total) => { const value = percentage(count, total); return value === null ? '' : `(${value}%)`; };
const NOT_OPERATING_STATUS = '기준일의 등록 자료를 센 숫자입니다. 각 기관이 지금 운영 중인지 확인한 숫자가 아니며, 기준일 뒤의 개설·폐업은 들어 있지 않습니다.';
const OTHER_TYPES_EXCLUDED = '종합병원·상급종합병원 안의 치과, 보건소처럼 종별코드가 41·51이 아닌 기관은 포함하지 않습니다.';
const OTHER_FIGURES_DIFFER = '다른 통계나 기사의 숫자는 기준일과 집계 범위가 달라 이 숫자와 다를 수 있습니다. 자료 설명도 추출일자에 따라 월말 기준 데이터와 집계상 차이가 있다고 밝힙니다.';

/**
 * The published short answers. `answer` is the first sentence(s) and must answer the question on its own;
 * `details` explain the basis; `data(view)` adds counts from the registered data; `caveats` say what the answer does not cover.
 * `answer`, `details`, `caveats` and their items may be functions of the view (see registerAnswerPages) when they carry counts.
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
  {
    slug: 'how-many-dental-hospitals', question: '전국 치과병원은 몇 곳인가요?',
    answer: ({snapshot, hospitals}) => `건강보험심사평가원 ${snapshot} 자료 기준으로 전국 치과병원은 ${fmt(hospitals)}곳입니다. 종별코드 41(치과병원)로 등록된 기관을 센 숫자입니다.`,
    details: [
      '공공데이터포털에 공개된 건강보험심사평가원 「전국 병의원 및 약국 현황」 파일에서 종별코드가 41(치과병원)인 기관을 셌습니다. 기관명에 ‘치과병원’이 들어 있는지로 센 숫자가 아닙니다.',
      ({clinics}) => `의료법 제3조 제2항은 치과병원을 병원급 의료기관으로, 치과의원을 의원급 의료기관으로 나눕니다. 같은 자료에서 종별코드 51(치과의원)로 등록된 기관은 ${fmt(clinics)}곳입니다.`,
      '아래 표는 원자료 시도코드별 기관 수입니다. 원자료 코드 순서로 적었으며 많고 적음을 견준 순위가 아닙니다.',
    ],
    table: sidoTable,
    data: ({hospitals, university, districts: d}) => `치과가 등록된 시·군·구 ${fmt(d.total)}곳 중 치과병원이 1곳 이상 등록된 곳은 ${fmt(d.withHospital)}곳입니다. 치과병원 ${fmt(hospitals)}곳 중 기관명에 ‘대학’이 들어간 곳은 ${fmt(university)}곳이며, 대학 부속 여부를 확인하지 않은 이름 기준 숫자입니다.`,
    caveats: [NOT_OPERATING_STATUS, OTHER_TYPES_EXCLUDED, OTHER_FIGURES_DIFFER],
    sources: ['hiraDataset', 'classification'],
    links: [['/hospitals/', '전국 치과병원 목록'], ['/reports/dental-hospital-districts/', '시·군·구별 치과병원·치과의원 수'], ['/reports/dental-hospitals/', '전국 치과병원 자료 보고서']],
  },
  {
    slug: 'how-many-dental-institutions', question: '전국 치과는 몇 곳인가요?',
    answer: ({snapshot, total, hospitals, clinics}) => `건강보험심사평가원 ${snapshot} 자료 기준으로 전국 치과는 ${fmt(total)}곳입니다. 치과의원 ${fmt(clinics)}곳과 치과병원 ${fmt(hospitals)}곳을 더한 숫자입니다.`,
    details: [
      '여기서 ‘치과’는 건강보험심사평가원 「전국 병의원 및 약국 현황」 파일에 종별코드 51(치과의원) 또는 41(치과병원)로 등록된 기관입니다. 기관 수이며 치과의사 수가 아닙니다.',
      ({total, hospitals, clinics}) => `전체 ${fmt(total)}곳 가운데 치과의원이 ${fmt(clinics)}곳${share(clinics, total)}, 치과병원이 ${fmt(hospitals)}곳${share(hospitals, total)}입니다.`,
      '아래 표는 원자료 시도코드별 기관 수입니다. 원자료 코드 순서로 적었으며 많고 적음을 견준 순위가 아닙니다.',
    ],
    table: sidoTable,
    data: ({districts: d}) => `치과가 1곳 이상 등록된 시·군·구는 ${fmt(d.total)}곳입니다. 이 가운데 ${fmt(d.withoutHospital)}곳에는 치과병원 없이 치과의원만 등록되어 있습니다.`,
    caveats: [NOT_OPERATING_STATUS, OTHER_TYPES_EXCLUDED, OTHER_FIGURES_DIFFER, '자료 설명은 연도말 기준 집계에는 공공데이터포털의 건강보험심사평가원 “요양기관 개설 현황” 파일데이터를 이용하라고 안내합니다.'],
    sources: ['hiraDataset', 'classification'],
    links: [['/guides/how-many-dental-hospitals/', '전국 치과병원은 몇 곳인가요?'], ['/reports/dental-hospital-vs-clinic/', '치과병원과 치과의원, 무엇이 다른가'], ['/reports/dental-hospital-districts/', '시·군·구별 치과병원·치과의원 수']],
  },
  {
    slug: 'districts-without-dental-hospital', question: '치과병원이 없는 시·군·구는 몇 곳인가요?',
    answer: ({snapshot, districts: d}) => `건강보험심사평가원 ${snapshot} 자료 기준으로 치과가 등록된 시·군·구 ${fmt(d.total)}곳 중 ${fmt(d.withoutHospital)}곳에는 치과병원이 없습니다.${d.withoutHospital && d.withoutHospitalClinics.minClinics >= 1 ? ` 이 ${fmt(d.withoutHospital)}곳에도 치과의원은 모두 1곳 이상 등록되어 있습니다.` : ''}`,
    details: [
      ({districts: d}) => `치과병원이 1곳 이상 등록된 시·군·구는 ${fmt(d.withHospital)}곳${share(d.withHospital, d.total)}입니다. 치과병원이 없는 곳을 구분별로 보면 ${d.kinds.filter(k => k.total).map(k => `${k.label} ${fmt(k.total)}곳 중 ${fmt(k.withoutHospital)}곳`).join(', ')}입니다.`,
      ({districts: d}) => `치과병원이 없는 ${fmt(d.withoutHospitalClinics.units)}곳에 등록된 치과의원은 모두 ${fmt(d.withoutHospitalClinics.clinics)}곳입니다.`,
      ({districts: d}) => `집계 단위: ${d.definitions.unit}.`,
    ],
    table: districtTable,
    data: ({districts: d}) => `일반구를 합치지 않고 원자료 시군구코드 그대로 세면 ${fmt(d.codeLevel.total)}곳 중 ${fmt(d.codeLevel.withoutHospital)}곳에 치과병원이 없습니다. 원자료 코드가 둘로 나뉜 지역: ${d.definitions.aliases}.`,
    caveats: [
      '치과병원이 없다는 것은 원자료에 종별코드 41 기관이 없다는 뜻이며, 치과 진료를 받을 수 없다는 뜻이 아닙니다.',
      '치과가 한 곳도 등록되지 않은 시·군·구는 이 집계에 나타나지 않습니다. 분모는 전국의 모든 시·군·구 수가 아닙니다.',
      '인구 자료를 결합하지 않았으므로 인구 대비 수치나 접근성 지표가 아닙니다.',
      NOT_OPERATING_STATUS,
    ],
    sources: ['hiraDataset'],
    links: [['/reports/dental-hospital-districts/', '시·군·구별 치과병원·치과의원 수'], ['/hospitals/', '전국 치과병원 목록'], ['/guides/how-many-dental-hospitals/', '전국 치과병원은 몇 곳인가요?']],
  },
  {
    slug: 'dental-hospital-specialist-requirement', question: '치과병원에는 치과전문의가 반드시 있어야 하나요?',
    answer: '아니요. 의료법 시행규칙 별표 5는 치과병원에 두는 치과의사 수를 환자 수에 따라 정할 뿐이며, 치과전문의를 두도록 한 요건은 이 정원 기준에도 의료법 제3조의2의 치과병원 요건에도 없습니다.',
    details: [
      '별표 5(의료기관에 두는 의료인의 정원)는 치과병원의 치과의사 정원을 “종합병원과 같음”, 종합병원의 치과의사 정원을 “의사의 경우와 같음”으로 적습니다. 종합병원의 의사 정원은 “연평균 1일 입원환자를 20명으로 나눈 수(이 경우 소수점은 올림). 외래환자 3명은 입원환자 1명으로 환산함”입니다. 치과의사 수를 정한 기준이며 전문의 자격은 적혀 있지 않습니다.',
      '의료법 제3조의3은 종합병원이 필수 진료과목마다 “전속하는 전문의”를 두도록 정합니다. 반면 치과병원을 포함한 “병원등”의 요건을 정한 제3조의2에는 전문의에 관한 문구가 없습니다.',
      '따라서 ‘치과병원’이라는 종별만으로는 그 기관에 치과전문의가 있는지 알 수 없습니다.',
    ],
    data: ({snapshot, hospitals, specialist: s}) => s.known
      ? `심평원 ${snapshot} 자료의 치과병원 ${fmt(hospitals)}곳 중 치과전문의 인원수가 0명으로 등록된 곳은 ${fmt(s.zero)}곳, 1명 이상으로 등록된 곳은 ${fmt(s.atLeastOne)}곳${s.unknown ? `, 인원수가 기록되지 않은 곳은 ${fmt(s.unknown)}곳` : ''}입니다. 등록 자료의 인원수이며 현재 근무 인원이나 진료 수준을 뜻하지 않습니다.${s.unknown ? ' 기록되지 않은 곳은 0명으로 세지 않았습니다.' : ''}`
      : `심평원 ${snapshot} 자료의 치과병원 ${fmt(hospitals)}곳에는 치과전문의 인원수가 기록된 곳이 없어 집계하지 않았습니다.`,
    caveats: [
      '수련치과병원 지정, 전문병원 지정(의료법 제3조의5), 상급종합병원 지정(제3조의4)처럼 따로 지정받는 제도의 인력 기준은 이 답에서 다루지 않습니다.',
      '같은 별표에는 의과 진료과목을 추가로 둔 치과병원의 의사 정원과 간호사(치과의료기관은 치과위생사 또는 간호사) 정원이 따로 있습니다.',
      '치과전문의 등록 여부는 진료의 질이나 범위에 대한 평가가 아닙니다.',
    ],
    sources: ['staffing', 'beds', 'generalHospital'],
    links: [['/reports/dental-hospitals/', '전국 치과병원 자료 보고서'], ['/reports/dental-hospital-vs-clinic/', '치과병원과 치과의원, 무엇이 다른가'], ['/guides/dental-hospital-30-beds/', '치과병원은 30병상이 있어야 하나요?']],
  },
  {
    slug: 'dental-hospital-name-rule', question: '‘치과병원’이라는 이름은 치과의원도 쓸 수 있나요?',
    answer: '아니요. 의료법 제42조 제1항은 의료기관이 자기 종류에 따르는 명칭 외의 명칭을 쓰지 못하게 하므로, 치과의원으로 개설된 기관은 같은 항이 정한 예외가 아니면 ‘치과병원’이라는 명칭을 쓸 수 없습니다.',
    details: [
      '의료기관의 종류는 의료법 제3조 제2항이 정하며, 치과의원은 의원급, 치과병원은 병원급 의료기관으로 서로 다른 종류입니다. 시행규칙 제40조 제1호는 종류에 따르는 명칭 앞에 고유명칭을 붙이게 하고, 고유명칭으로 의료기관의 종류 명칭과 혼동할 우려가 있는 명칭을 쓰지 못하게 합니다.',
      '제42조 제1항 단서의 예외는 다섯 가지입니다. 종합병원·정신병원이 ‘병원’으로 표시하는 경우, 상급종합병원·전문병원으로 지정받은 기관이 지정 기간에 그 명칭을 쓰는 경우, 제33조 제8항 단서에 따라 개설한 의원급 의료기관이 면허 종별에 따른 종별명칭을 함께 쓰는 경우, 국가·지방자치단체가 개설한 기관이 협의해 정한 명칭을 쓰는 경우, 다른 법령으로 명칭을 따로 정한 경우입니다.',
      '반대로 이름에서 ‘치과’가 빠질 수는 있습니다. 시행규칙 제40조 제4호는 개설자가 전문의인 치과병원·치과의원이 고유명칭과 종류 명칭 사이에 전문과목을 넣어 표시할 수 있게 하고, 전문과목에 “치과”가 들어 있으면 종류 명칭에서 “치과”를 생략할 수 있게 합니다.',
      '의료기관이 아닌 곳은 의료기관의 명칭이나 이와 비슷한 명칭을 쓸 수 없습니다(제42조 제3항).',
    ],
    data: ({snapshot, hospitals, clinics, names: n}) => `심평원 ${snapshot} 자료에서 치과병원 ${fmt(hospitals)}곳 중 등록 기관명이 ‘치과병원’으로 끝나는 곳은 ${fmt(n.hospitalsEndingDentalHospital)}곳이고, 치과의원 ${fmt(clinics)}곳 중 등록 기관명에 ‘치과병원’이 들어간 곳은 ${fmt(n.clinicsNamedDentalHospital)}곳입니다. 등록된 기관명 문자열을 센 숫자입니다.`,
    caveats: [
      '등록된 기관명만 셌으며 간판·광고·온라인 표기는 확인하지 않았습니다. 개별 기관의 표기가 규정에 맞는지는 이 답에서 판단하지 않습니다.',
      '명칭 규정을 어겼을 때의 벌칙과 행정처분은 이 답에서 다루지 않습니다.',
      '명칭은 의료기관 종류에 따른 표시이며 진료의 질이나 범위를 뜻하지 않습니다.',
    ],
    sources: ['names', 'nameDisplay', 'classification'],
    links: [['/reports/dental-hospital-vs-clinic/', '치과병원과 치과의원, 무엇이 다른가'], ['/hospitals/', '전국 치과병원 목록'], ['/guides/dental-hospital-vs-general-hospital-dentistry/', '치과병원과 종합병원 치과는 무엇이 다른가요?']],
  },
  {
    slug: 'dental-type-surcharge', question: '치과병원과 치과의원의 종별가산율은 몇 %인가요?',
    answer: `건강보험 요양기관 종별가산율은 2024년 1월 1일부터 치과의원에는 적용되지 않고 치과병원에는 ${TYPE_SURCHARGE[1].since}가 적용됩니다. 치과대학 부속 치과병원은 ${TYPE_SURCHARGE[2].since}, 상급종합병원에 설치된 치과대학 부속 치과병원은 ${TYPE_SURCHARGE[3].since}입니다.`,
    details: [
      `2023년까지는 치과의원 ${TYPE_SURCHARGE[0].before}, 치과병원 ${TYPE_SURCHARGE[1].before}, 치과대학 부속 치과병원 ${TYPE_SURCHARGE[2].before}(상급종합병원에 설치된 경우 ${TYPE_SURCHARGE[3].before})였습니다. 보건복지부고시 제2023-187호가 2024년 1월 1일부터 각 단계를 15%포인트씩 낮췄습니다. 2023년 이전 자료의 “치과병원 ${TYPE_SURCHARGE[1].before}·치과의원 ${TYPE_SURCHARGE[0].before}”는 현행 수치가 아닙니다.`,
      '종별가산율은 고시가 정한 장(제2장~제10장, 제13장·제14장, 제19장·제20장)에 분류된 행위의 금액에 요양기관 종별에 따라 더하는 비율입니다. 치과 처치·수술료(제10장)는 여기에 들어가고, 기본진료료(제1장)와 치과의 보철료(제18장)는 들어가지 않습니다. 약제비·치료재료대, 검체 검사료, 방사선일반영상진단료처럼 같은 고시가 따로 정한 항목에도 붙지 않습니다.',
      '이 가산은 요양급여비용을 계산할 때 더하는 비율이고, 환자가 내는 본인부담률은 그렇게 계산한 요양급여비용 총액에 적용하는 별개의 비율입니다.',
    ],
    table: surchargeTable,
    data: ({snapshot, hospitals, clinics, university}) => `심평원 ${snapshot} 자료 기준으로 치과의원은 ${fmt(clinics)}곳, 치과병원은 ${fmt(hospitals)}곳입니다. 치과병원 중 기관명에 ‘대학’이 들어간 곳은 ${fmt(university)}곳이지만 이름 기준 숫자여서, 어느 기관이 치과대학 부속 치과병원에 해당하는지는 이 자료로 알 수 없습니다.`,
    caveats: [
      `종별가산율은 보건복지부 고시로 정하며 바뀔 수 있습니다. 이 답은 ${CHECKED_AT}에 확인한 문언 기준입니다.`,
      '소아·야간·공휴 가산 같은 다른 가산과 점수당 단가는 이 답에서 다루지 않습니다.',
      '건강보험 급여 행위에 대한 기준이며 비급여 진료비에는 해당하지 않습니다.',
      '가산율은 기관 종별에 따른 수가 기준이며 진료의 질이나 범위를 뜻하지 않습니다.',
    ],
    sources: ['surcharge', 'surchargeBook'],
    links: [['/guides/dental-copay-by-institution-type/', '치과병원은 치과의원보다 본인부담률이 높나요?'], ['/reports/dental-hospital-vs-clinic/', '치과병원과 치과의원, 무엇이 다른가']],
  },
]);

export const answerRoute = a => `/guides/${a.slug}/`;

const sourceItem = s => `<li><strong>${esc(s.title)}</strong><p>${esc(s.edition)} · 확인 ${esc(s.checkedAt)}</p><p>“${esc(s.quote)}”</p>${externalLink(s.url, '원문 보기', {withIcon: true})}</li>`;

// Text that carries counts is a function of the view; everything else is a plain string.
const resolve = (value, view) => typeof value === 'function' ? value(view) : value;
const resolveList = (list, view) => resolve(list, view).map(item => resolve(item, view));

// The view of the last registerAnswerPages() call. The build registers the pages before it renders /guides/, so
// answerCards() can show the computed first sentences without being handed the data again.
let registeredView = null;

/** The first sentence(s) of an answer, or null for a computed answer before its counts are known. */
export const answerText = (a, view = registeredView) => typeof a.answer === 'function' ? (view ? a.answer(view) : null) : a.answer;

/** The cards shown on /guides/ and the link list shown on /hospitals/. */
export const answerCards = () => `<div class="guide-grid">${SHORT_ANSWERS.map((a, i) => { const answer = answerText(a); return `<a class="guide-card" href="${answerRoute(a)}"><small>짧은 답 ${String(i + 1).padStart(2, '0')}</small><h3>${esc(a.question)}</h3>${answer ? `<p>${esc(answer)}</p>` : ''}</a>`; }).join('')}</div>`;
export const answerLinks = () => `<div class="condition-links">${SHORT_ANSWERS.map(a => `<a href="${answerRoute(a)}">${esc(a.question)} ${icon('arrow')}</a>`).join('')}</div>`;

/**
 * Registers one page per short answer. Counts come from the clinics array and from `reports` (collectReports() of the
 * same institutions: the district and 치과전문의 aggregates are reused, not recomputed). No institution is named.
 */
export function registerAnswerPages({page, clinics, snapshotDate, reports, domain = ''}) {
  if (typeof page !== 'function' || !Array.isArray(clinics)) throw new TypeError('registerAnswerPages needs page() and a clinics array');
  const districts = reports?.hospitalDistricts, profile = reports?.dentalHospitals;
  if (!districts || !profile) throw new TypeError('registerAnswerPages needs reports from collectReports()');
  const hospitalsList = clinics.filter(c => c?.typeCode === '41'), clinicsList = clinics.filter(c => c?.typeCode === '51');
  if (profile.total !== hospitalsList.length || profile.types.clinic !== clinicsList.length) throw new Error('registerAnswerPages: reports were computed from a different set of institutions');
  const named = (list, test) => list.filter(c => test(String(c.name ?? ''))).length;
  const registered = profile.hospitals.specialist;
  const summary = {
    snapshot: snapshotDate,
    hospitals: hospitalsList.length,
    clinics: clinicsList.length,
    university: named(hospitalsList, name => name.includes('대학')),
    disability: named(hospitalsList, name => name.includes('장애인')),
  };
  const view = {
    ...summary,
    total: summary.hospitals + summary.clinics,
    districts,
    // 치과전문의 인원수 as registered: a hospital without a recorded number is unknown, never counted as 0명.
    specialist: {known: registered.known, atLeastOne: registered.atLeastOne.count, zero: registered.known - registered.atLeastOne.count, unknown: summary.hospitals - registered.known},
    names: {
      hospitalsEndingDentalHospital: named(hospitalsList, name => name.trim().endsWith('치과병원')),
      clinicsNamedDentalHospital: named(clinicsList, name => name.includes('치과병원')),
    },
  };
  registeredView = view;
  for (const a of SHORT_ANSWERS) {
    const route = answerRoute(a);
    const sources = a.sources.map(k => ANSWER_SOURCES[k]);
    const checked = sources.map(s => s.checkedAt).sort().at(-1);
    const answer = answerText(a, view), details = resolveList(a.details, view), caveats = resolveList(a.caveats, view);
    const schemaAnswer = [answer, ...details.slice(0, 1)].join(' ');
    const related = SHORT_ANSWERS.filter(x => x !== a);
    page(route, {
      title: a.question,
      description: answer,
      current: 'guides',
      breadcrumb: [{label: '치과 비교 가이드', url: '/guides/'}, {label: a.question}],
      schema: [{'@context': 'https://schema.org', '@type': 'FAQPage', '@id': `${domain}${route}#faq`, mainEntity: [{'@type': 'Question', name: a.question, acceptedAnswer: {'@type': 'Answer', text: schemaAnswer}}]}],
      body: `<div class="wrap narrow"><div class="page-intro"><div class="pill-row"><span class="pill">짧은 답</span><span class="pill neutral">출처 확인 ${esc(checked)}</span></div><h1>${esc(a.question)}</h1></div>
      <section class="fact-panel" id="answer"><h2>짧은 답</h2><p class="answer-text"><strong>${esc(answer)}</strong></p>${details.map(d => `<p class="answer-text">${esc(d)}</p>`).join('')}${a.table ? a.table(view) : ''}</section>
      <section class="fact-panel" id="data"><h2>치과데이터랩 자료로 보면</h2><p class="answer-text">${esc(a.data(view))}</p></section>
      <div class="source-banner warning">${icon('info')}<div><strong>이 답이 다루지 않는 것</strong>${caveats.map(c => `<p>${esc(c)}</p>`).join('')}<p>치료 방법이나 기관 선택을 권하는 답이 아닙니다. 개인 상황에 따른 비용과 절차는 해당 기관이나 국민건강보험공단에 확인하세요.</p></div></div>
      <section class="fact-panel" id="sources"><h2>근거 원문</h2><ul class="source-list">${sources.map(sourceItem).join('')}</ul></section>
      <section class="section" aria-labelledby="related-title"><h2 id="related-title">함께 보기</h2><div class="condition-links">${a.links.map(([href, label]) => `<a href="${esc(href)}">${esc(label)} ${icon('arrow')}</a>`).join('')}</div><h3 style="margin-top:28px">다른 짧은 답</h3><div class="condition-links">${related.map(x => `<a href="${answerRoute(x)}">${esc(x.question)} ${icon('arrow')}</a>`).join('')}</div></section></div>`,
    });
  }
  return {count: SHORT_ANSWERS.length, ...summary, districts: districts.total, districtsWithoutHospital: districts.withoutHospital, specialist: view.specialist, names: view.names};
}
