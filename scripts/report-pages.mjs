import { esc, fmt, icon, SOURCE_URL, localDate } from '../src/shared.mjs';
import { reportTable as table, csv, pct } from './html.mjs';
import { percentage } from './common.mjs';
import { buildYangjuAnalysis } from './yangju-analysis.mjs';
import { registerYangjuAnalysisPage, yangjuAnalysisCard } from './yangju-analysis-pages.mjs';

// title/description may be functions of the report data so headline counts come from the snapshot, never a literal.
export const REPORTS = [
  { slug: 'national-data-coverage', group: 'national', tag: '전국 · 데이터 수록 현황', title: '전국 치과 데이터, 어디까지 확인할 수 있을까?', description: '치과 등록 정보의 수록 범위와 빈칸을 함께 살펴봅니다.' },
  { slug: 'northern-gyeonggi-hours', group: 'northernGyeonggi', tag: '경기북부 · 등록시간 현황', title: '경기북부 치과의 야간·주말 등록시간', description: '10개 시·군의 시간 수록 현황과 조건별 등록 건수를 정리했습니다.' },
  { slug: 'dental-hospitals', group: 'dentalHospitals', kind: 'dentalHospitals', tag: '전국 · 치과병원 전수', title: g => `치과병원 ${fmt(g.total)}곳 전수 리포트`, description: '전문의·콘빔CT·지역·개설 시기·빈칸까지, 치과병원 등록 자료 전체를 같은 기준으로 집계했습니다.' },
  { slug: 'dental-hospital-vs-clinic', group: 'dentalHospitals', kind: 'hospitalVsClinic', tag: '종별 · 무엇이 다른가', title: '치과병원과 치과의원, 무엇이 다른가', description: '법령상 구분, 환자 부담, 등록 자료의 차이를 출처와 함께 정리합니다. 우열이 아니라 차이입니다.' },
];
const reportTitle = (item, g) => typeof item.title === 'function' ? item.title(g) : item.title;
const metricLabels = {
  specialist: '전문의 1명 이상 등록', hours: '하루 이상 시간 확인',
  night: '평일 19시 이후 종료 등록', saturday: '토요일 시간 확인',
  sunday: '일요일 시간 확인', website: '홈페이지 URL 형식 유효',
};
const route = item => `/reports/${item.slug}/`;
const dataPath = (item, ext) => `/data/reports/${item.slug}.${ext}`;

export function reportCards(reports) {
  return `<div class="report-grid">${REPORTS.map((item, i) => {
    const g = reports[item.group];
    return `<a class="report-card" href="${route(item)}"><div class="report-card-top"><span class="pill outline">${item.tag}</span><span class="report-number">0${i + 1}</span></div><h3>${reportTitle(item, g)}</h3><p>${item.description}</p><div class="report-card-bottom"><span>${fmt(g.total)}곳 · ${reports.snapshotDate} 기준</span><span class="text-link">리포트 읽기 ${icon('arrow')}</span></div></a>`;
  }).join('')}</div>`;
}

export function homePage(reports, regionGrid, { searchSources = false } = {}) {
  const g = reports.national;
  return `<section class="hero data-hero"><div class="wrap hero-grid"><div><p class="eyebrow">DENTAL DATA LAB / PUBLIC DATA REPORTS</p><h1>우리 동네 치과를<br><em>데이터로</em> 이해하다.</h1><p class="hero-copy">전국 치과의 등록 정보를 읽기 쉬운 통계로.<br>출처와 기준일, 확인되지 않은 정보까지 함께 봅니다.</p><div class="hero-actions"><a class="btn primary" href="/reports/">데이터 리포트 읽기 ${icon('arrow')}</a><a class="btn" href="/find/">조건에 맞는 치과 찾기</a></div><div class="hero-notes"><span>${icon('check')}공공데이터 기반</span><span>${icon('check')}집계 기준 공개</span><span>${icon('check')}광고 순위 없음</span></div></div><aside class="data-preview" aria-label="전국 시간 자료 수록 현황"><div class="data-preview-top"><span class="mini-label">이번 데이터에서 읽은 숫자</span><span class="pill outline">${reports.snapshotDate}</span></div><p class="data-preview-label">진료시간 자료가 수록된 치과</p><div class="data-preview-value">${pct(g.metrics.hours.percentOfTotal)}<small>${fmt(g.metrics.hours.count)} / ${fmt(g.total)}곳</small></div><div class="coverage-track" aria-hidden="true"><span style="width:${g.metrics.hours.percentOfTotal ?? 0}%"></span></div><div class="coverage-legend"><span><i></i>시간 자료 확인</span><span><i class="missing"></i>시간 자료 미확인</span></div><p class="subtle-note">미확인은 휴진을 뜻하지 않습니다.<br>통계는 확인할 수 있는 범위부터 설명합니다.</p><a class="text-link" href="/reports/national-data-coverage/">숫자의 분모와 한계 읽기 ${icon('arrow')}</a></aside></div></section>
  <div class="wrap"><div class="stat-strip" aria-label="데이터 개요"><div><div class="stat-value">${fmt(g.total)}<small>곳</small></div><div class="stat-label">치과병원·치과의원 수록</div></div><div><div class="stat-value">${fmt(g.types.clinic)}<small>곳</small></div><div class="stat-label">치과의원</div></div><div><div class="stat-value">${fmt(g.types.hospital)}<small>곳</small></div><div class="stat-label">치과병원</div></div><div><div class="stat-value">${reports.snapshotDate.replaceAll('-', '.')}</div><div class="stat-label">공통 데이터 기준일</div></div></div>
  <section class="section"><div class="section-head"><div><p class="eyebrow">DATA REPORTS</p><h2>숫자를 읽는 새로운 관점</h2><p>기관별 우열 대신, 지역의 현황과 데이터의 범위를 살펴봅니다.</p></div><a class="text-link" href="/reports/">전체 리포트 ${icon('arrow')}</a></div>${reportCards(reports)}</section>
  ${searchSources ? `<section class="source-home-feature"><div><p class="eyebrow">SEARCH DATA / RESEARCH NOTES</p><h2>많이 찾는 치과 질문,<br>검색량은 어디서 확인할까요?</h2><p>Google 공식 검색량과 외부 추정치의 차이, 실제로 찾은 출처와 조사 경로를 공개합니다.</p><span class="pill neutral">출처 조사 완료 · 검색량 수집 전</span></div><div class="source-home-actions"><a class="btn primary" href="/search-sources/">검색량 출처와 조사 방법 ${icon('arrow')}</a><a class="text-link" href="/questions/">먼저 정리한 질문 100개 ${icon('arrow')}</a></div></section>` : ''}
  <section class="section search-section"><div class="section-head"><div><p class="eyebrow">FIND YOUR CONDITIONS</p><h2>방문 전, 필요한 조건부터</h2><p>기관명이나 주소로 찾고 같은 기준의 등록 정보를 확인하세요.</p></div></div><form class="searchbox" action="/find/" method="get" role="search">${icon('search')}<label class="skip" for="home-q">기관명 또는 주소</label><input id="home-q" name="q" placeholder="예: 양주 옥정, 서울 강남구" autocomplete="off"><button type="submit">찾기</button></form><div class="condition-links"><a href="/find/?night=1">평일 19시 이후 종료 등록 ${icon('arrow')}</a><a href="/find/?saturday=1">토요일 시간 등록 ${icon('arrow')}</a><a href="/find/?specialist=1">전문의 1명 이상 등록 ${icon('arrow')}</a></div><p class="subtle-note">시간·인력 자료가 없는 기관은 해당 조건에서 제외됩니다. 실제 진료 여부는 방문 전에 확인해 주세요.</p></section>
  <section class="section"><div class="section-head"><div><h2>지역별 등록 정보</h2><p>원자료 지역 코드별 목록입니다. 현재 행정구역 통계와 다를 수 있습니다.</p></div><a class="text-link" href="/regions/">지역 전체 ${icon('arrow')}</a></div>${regionGrid}</section>
  <section class="section"><div class="principles"><div><div class="principle-num">01 / 출처부터 확인</div><h3>숫자의 근거를 함께</h3><p>원본 출처와 기준일을 명시하고, 리포트의 집계표를 내려받을 수 있습니다.</p><a class="text-link" href="/data/">데이터 출처 ${icon('arrow')}</a></div><div><div class="principle-num">02 / 빈칸도 정보</div><h3>0과 미확인을 구분</h3><p>원자료가 비어 있다고 실제로 없다고 판단하지 않습니다. 비율의 분모도 공개합니다.</p><a class="text-link" href="/methodology/">처리 기준 ${icon('arrow')}</a></div><div><div class="principle-num">03 / 방문 전 확인</div><h3>사실을 나란히 읽기</h3><p>최대 3곳의 등록 정보를 나란히 보고 방문 전에 확인할 질문을 정리하세요.</p><a class="text-link" href="/guides/comparison-checklist/">확인할 질문 ${icon('arrow')}</a></div></div></section></div>`;
}

function summary(g) {
  return `<div class="report-metrics"><div><span>집계 대상</span><strong>${fmt(g.total)}<small>곳</small></strong><p>치과병원·치과의원</p></div><div><span>하루 이상 시간 확인</span><strong>${fmt(g.metrics.hours.count)}<small>곳</small></strong><p>전체의 ${pct(g.metrics.hours.percentOfTotal)}</p></div><div><span>시간 자료 미확인</span><strong>${fmt(g.total - g.metrics.hours.count)}<small>곳</small></strong><p>휴진 또는 운영 중단이라는 뜻이 아닙니다.</p></div></div>`;
}

function definitions(reports, northern) {
  return `<section id="report-methodology" class="report-section prose"><h2>집계 방법과 해석 범위</h2><ol><li><strong>모집단:</strong> ${reports.snapshotDate} 심평원 자료의 종별코드 41(치과병원), 51(치과의원)만 포함합니다. 종합병원의 치과 진료과목은 제외됩니다.</li><li><strong>시간 확인:</strong> 같은 요일의 시작·종료가 모두 유효하고 종료가 시작보다 늦은 경우입니다. 자정을 넘기는 진료는 추정하지 않습니다.</li><li><strong>평일 19시 이후 종료 등록:</strong> 월~금 중 하루 이상 유효한 종료 시각이 19:00 이상인 기관 수입니다. 19:00 종료도 포함하며 접수 가능 시각을 의미하지 않습니다.</li><li><strong>토요일·일요일:</strong> 해당 요일의 유효한 시간쌍이 있는 기관 수입니다. 원자료 공란이나 불명확한 시각은 미확인으로 남깁니다.</li><li><strong>비율:</strong> 별도 표기하지 않은 비율은 조건에 해당하는 기관 수 ÷ 전체 집계 대상 × 100이며 소수 첫째 자리로 반올림합니다. 자료 누락 때문에 실제 야간·주말 진료 비율로 해석할 수 없습니다.</li><li><strong>전문의:</strong> 기본 정보의 전문의 수가 1명 이상인 기관 수입니다. 과목별 인원을 합산하지 않으며 현재 근무나 진료 수준을 평가하지 않습니다.</li></ol>
  ${northern ? `<h3>경기북부의 범위</h3><p>이 리포트는 경기 시도코드 310000의 가평·고양·구리·남양주·동두천·양주·연천·의정부·파주·포천을 집계합니다. 고양은 원자료의 세 구를 묶습니다. 주소 문자열로 임의 재분류하지 않습니다.</p>${table(['시·군', '원자료 시군구코드'], reports.northernGyeonggi.cities.map(c => [esc(c.name), `<code>${c.cityCodes.map(esc).join(', ')}</code>`]), '경기북부 집계에 사용한 원자료 코드')}` : `<h3>지역 구분의 한계</h3><p>원자료에는 ‘전남광주’와 ‘전남’ 등 지역 표기가 혼재합니다. 전국 합계에는 포함하되 이 리포트에서 현재 시도별 치과 수로 재분류하지 않았습니다. 홈페이지 URL 형식 유효는 실제 운영·공식성·최신성을 확인했다는 뜻이 아닙니다.</p>`}
  <p>홈페이지 수동 관찰 4곳은 이 집계에 섞지 않았습니다. 가격·후기·실시간 운영·예약 가능 여부는 수집하지 않았습니다. 이 자료는 의료적 진단이나 치료 판단을 대체하지 않습니다.</p></section>`;
}

function nationalContent(g) {
  const rows = Object.entries(metricLabels).map(([key, label]) => {
    const m = g.metrics[key];
    return [label, `${fmt(m.count)}곳`, `${fmt(g.total)}곳`, pct(m.percentOfTotal)];
  });
  return `<section class="report-section"><h2>어떤 정보가 수록되어 있나요?</h2><p class="report-section-copy">서로 다른 항목이므로 아래 수치를 더해도 전체 기관 수가 되지 않습니다.</p>${table(['등록 항목', '해당 기관 수', '전체 분모', '전체 대비'], rows, '전국 치과 등록 항목별 수록 현황')}<p class="subtle-note">홈페이지 URL 형식 유효는 URL 구문 검사 결과입니다. 웹사이트 접속·소유·운영 여부를 검증한 수가 아닙니다.</p></section><section class="report-section report-reading"><h2>빈칸이 모두 같은 뜻은 아닙니다</h2><p>전문의 수의 0은 원자료에 기록된 값이고, 장비 행의 부재는 미확인입니다. 시간 자료가 확인되는 ${fmt(g.metrics.hours.count)}곳만으로 전체 치과의 진료시간을 대표할 수 없습니다.</p><a class="text-link" href="/guides/reading-data/">등록 정보 읽는 법 ${icon('arrow')}</a></section>`;
}

function northernContent(g) {
  const rows = g.cities.map(c => [esc(c.name), `${fmt(c.total)}곳`, `${fmt(c.metrics.hours.count)}곳<small>${pct(c.metrics.hours.percentOfTotal)}</small>`, `${fmt(c.metrics.night.count)}곳<small>${pct(c.metrics.night.percentOfTotal)}</small>`, `${fmt(c.metrics.saturday.count)}곳<small>${pct(c.metrics.saturday.percentOfTotal)}</small>`, `${fmt(c.metrics.sunday.count)}곳<small>${pct(c.metrics.sunday.percentOfTotal)}</small>`]);
  return `<section class="report-section"><h2>10개 시·군의 등록시간 현황</h2><p class="report-section-copy">가나다순입니다. 각 비율의 분모는 해당 행의 전체 기관 수이며, 병원이나 지역의 우수성 순위가 아닙니다.</p>${table(['시·군', '전체 기관', '하루 이상 시간 확인', '평일 19시 이후', '토요일 시간', '일요일 시간'], rows, '경기북부 시·군별 등록시간 조건 집계')}<p class="subtle-note">모바일에서는 표를 좌우로 넘겨 모든 항목을 볼 수 있습니다. 하나의 기관이 여러 조건에 중복 포함될 수 있습니다.</p></section><section class="report-section"><h2>자료가 있는 범위를 함께 읽기</h2><div class="coverage-chart">${g.cities.map(c => `<div class="coverage-chart-row"><span>${esc(c.name)}</span><div class="coverage-track" aria-hidden="true"><span style="width:${c.metrics.hours.percentOfTotal ?? 0}%"></span></div><strong>${pct(c.metrics.hours.percentOfTotal)}</strong><small>${fmt(c.metrics.hours.count)} / ${fmt(c.total)}곳</small></div>`).join('')}</div><p class="subtle-note">막대는 하루 이상 유효한 시간 자료가 있는 기관의 비율입니다. 길이가 짧아도 해당 지역에 진료 가능한 치과가 적다는 뜻은 아닙니다.</p></section><section class="report-section report-reading"><h2>같은 건수도 분모에 따라 다르게 읽힙니다</h2><p>경기북부 전체 ${fmt(g.total)}곳 중 평일 19시 이후 종료가 등록된 곳은 ${fmt(g.metrics.night.count)}곳(${pct(g.metrics.night.percentOfTotal)})입니다. 평일 시간 자료가 하루라도 있는 ${fmt(g.metrics.night.known)}곳을 분모로 하면 ${pct(g.metrics.night.percentOfKnown)}입니다.</p><p>평일 일부 요일만 등록된 기관도 있습니다. 확인되지 않은 요일은 주간 진료나 휴진으로 간주하지 않습니다. 어느 분모를 쓰더라도 현재 실제 야간 진료 비율을 뜻하지 않습니다.</p></section>`;
}

// ---------- 치과병원 reports (aggregates only; no institution names, ids or detail links) ----------
const dec = value => value == null ? '산출 불가' : Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const unit = (value, suffix) => value == null ? '산출 불가' : dec(value) + suffix;
const countPct = (count, percent) => `${fmt(count)}곳<small>${pct(percent)}</small>`;
const FRAMING = '등록 자료의 집계이며 진료 실력·현재 운영 상태가 아닙니다.';

function datasetSchema({ item, g, reports, domain, description, technique }) {
  return { '@context': 'https://schema.org', '@type': 'Dataset', '@id': domain + route(item) + '#dataset', name: reportTitle(item, g), description, url: domain + route(item), inLanguage: 'ko-KR', temporalCoverage: reports.snapshotDate, spatialCoverage: { '@type': 'Place', name: '대한민국 전국' }, creator: { '@type': 'Organization', name: '치과데이터랩' }, isBasedOn: { '@type': 'Dataset', name: '건강보험심사평가원 전국 병의원 및 약국 현황', url: SOURCE_URL }, measurementTechnique: technique, distribution: ['csv', 'json'].map(ext => ({ '@type': 'DataDownload', encodingFormat: ext === 'csv' ? 'text/csv' : 'application/json', contentUrl: domain + dataPath(item, ext) })) };
}

function reportHeader(item, g, reports, description) {
  return `<header class="page-intro report-heading"><span class="pill outline">${item.tag}</span><h1>${esc(reportTitle(item, g))}</h1><p class="report-summary">${esc(description)}</p><p class="report-meta">자료 기준 ${reports.snapshotDate} · 원본 수집 ${localDate(reports.observedAt)} · 건강보험심사평가원</p><div class="hero-actions"><a class="btn small" href="${dataPath(item, 'csv')}" download>집계표 CSV</a><a class="btn small" href="${dataPath(item, 'json')}" download>근거 포함 JSON</a><button class="btn small" data-copy-citation>출처 포함 인용문 복사</button><a class="text-link" href="#report-methodology">집계 방법</a></div></header>`;
}

function reportSource(reports, indexingEnabled, title) {
  return `<section class="report-section report-source"><h2>출처와 변경 기록</h2><p><a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">건강보험심사평가원 · 전국 병의원 및 약국 현황 ${icon('link')}</a></p><p>원자료 이용 조건: 공공저작물 출처표시 제1유형. 치과데이터랩이 기관별 데이터를 선별·집계했습니다.</p><details><summary>재현에 사용한 원본 SHA-256</summary><code>${esc(reports.sourceSha256)}</code></details><p>리포트 집계 버전 1 · ${reports.snapshotDate} 자료로 최초 작성한 ${indexingEnabled ? '공개본' : '로컬 검토본'}. 아직 여러 분기의 변화를 비교하지 않습니다.</p><a class="text-link" href="/corrections/?clinic=${encodeURIComponent(title)}">집계 오류 정정 메모 ${icon('arrow')}</a></section>`;
}

const registeredBanner = `<div class="source-banner warning">${icon('info')}<div><strong>등록 자료의 집계이며, 기관 간 우열이나 진료의 질을 평가한 결과가 아닙니다.</strong><p>자료가 없는 기관도 모집단에 포함합니다. 공란을 휴진·미보유로 바꾸지 않으며 방문 전 기관에 확인해야 합니다.</p></div></div>`;

// Two-column comparison rows reused by both reports: same definition, two denominators.
function comparisonRows(g) {
  const h = g.hospitals, c = g.clinics;
  return [
    ['치과전문의 등록 평균 (중앙값)', `${unit(h.specialist.mean, '명')} (${unit(h.specialist.median, '명')})`, `${unit(c.specialist.mean, '명')} (${unit(c.specialist.median, '명')})`, `분모: 전문의 수가 기록된 기관 ${fmt(h.specialist.known)}곳 / ${fmt(c.specialist.known)}곳`],
    ['전문의 1명 이상 등록', countPct(h.specialist.atLeastOne.count, h.specialist.atLeastOne.percentOfKnown), countPct(c.specialist.atLeastOne.count, c.specialist.atLeastOne.percentOfKnown), '비율의 분모는 전문의 수가 기록된 기관'],
    ['전문의 3명 이상 등록', countPct(h.specialist.atLeastThree.count, h.specialist.atLeastThree.percentOfKnown), countPct(c.specialist.atLeastThree.count, c.specialist.atLeastThree.percentOfKnown), '비율의 분모는 전문의 수가 기록된 기관'],
    ['콘빔CT 등록 기관 (평균 대수)', `${countPct(h.cbct.registered.count, h.cbct.registered.percentOfTotal)} · ${unit(h.cbct.mean, '대')}`, `${countPct(c.cbct.registered.count, c.cbct.registered.percentOfTotal)} · ${unit(c.cbct.mean, '대')}`, `평균의 분모는 콘빔CT 항목이 기록된 기관 ${fmt(h.cbct.known)}곳 / ${fmt(c.cbct.known)}곳. 항목 없음은 미보유가 아님`],
    ['홈페이지 URL 형식 유효', countPct(h.website.count, h.website.percentOfTotal), countPct(c.website.count, c.website.percentOfTotal), '전체 대비. 실제 운영·공식성은 확인하지 않음'],
    ['하루 이상 진료시간 확인', countPct(h.hours.count, h.hours.percentOfTotal), countPct(c.hours.count, c.hours.percentOfTotal), '전체 대비. 시간 없음은 휴진이 아님'],
  ];
}

function dentalHospitalsBody(item, g, reports, description, indexingEnabled) {
  const h = g.hospitals;
  const summary = `<div class="report-metrics"><div><span>치과병원</span><strong>${fmt(g.total)}<small>곳</small></strong><p>치과의원 ${fmt(g.types.clinic)}곳과 같은 분기 자료</p></div><div><span>치과전문의 등록 평균</span><strong>${dec(h.specialist.mean)}<small>명</small></strong><p>중앙값 ${unit(h.specialist.median, '명')} · 기록된 ${fmt(h.specialist.known)}곳 기준</p></div><div><span>콘빔CT 등록</span><strong>${fmt(h.cbct.registered.count)}<small>곳</small></strong><p>평균 ${unit(h.cbct.mean, '대')} · 등록 대수이며 보유 인증이 아닙니다.</p></div></div>`;
  const comparison = `<section class="report-section"><h2>치과의원과 같은 기준으로 나란히 보기</h2><p class="report-section-copy">${FRAMING} 각 행의 분모를 표에 적었습니다.</p>${table(['등록 항목', `치과병원 ${fmt(g.total)}곳`, `치과의원 ${fmt(g.types.clinic)}곳`, '분모·해석'], comparisonRows(g), '치과병원과 치과의원의 등록 항목 비교')}<p class="subtle-note">전문의 수의 0은 원자료에 기록된 값이고, 콘빔CT 항목의 부재는 미확인입니다. 종별은 법적 분류이며 진료의 질을 결정하지 않습니다. <a href="/reports/dental-hospital-vs-clinic/">종별의 법적 차이 읽기 ${icon('arrow')}</a></p></section>`;
  const u = g.university;
  const university = `<section class="report-section"><h2>기관명에 ‘대학’이 들어간 ${fmt(u.count)}곳과 나머지 ${fmt(u.others.count)}곳</h2><p class="report-section-copy">명칭 기준 분류입니다. 대학 부속 여부나 교육·수련 기능을 확인한 것이 아니며, 전문의 등록 수는 기관 규모의 지표일 뿐 진료 실력이 아닙니다.</p>${table(['구분', '기관 수', '전문의 등록 평균', '중앙값', '최소~최대'], [
    ['기관명에 ‘대학’ 포함', `${fmt(u.count)}곳<small>${pct(u.percentOfTotal)}</small>`, `${unit(u.specialist.mean, '명')}`, `${unit(u.specialist.median, '명')}`, u.specialist.known ? `${fmt(u.specialist.min)}~${fmt(u.specialist.max)}명` : '산출 불가'],
    ['그 밖의 치과병원', `${fmt(u.others.count)}곳`, `${unit(u.others.specialist.mean, '명')}`, `${unit(u.others.specialist.median, '명')}`, u.others.specialist.known ? `${fmt(u.others.specialist.min)}~${fmt(u.others.specialist.max)}명` : '산출 불가'],
  ], '명칭에 대학이 포함된 치과병원과 그 밖의 치과병원의 전문의 등록 분포')}<p class="subtle-note">개별 기관의 이름이나 순위는 싣지 않습니다. 기관별 등록 정보는 <a href="/find/?type=41">치과병원 전체 목록</a>에서 같은 기준으로 확인할 수 있습니다.</p></section>`;
  const regions = `<section class="report-section"><h2>어느 지역에 있나요?</h2><p class="report-section-copy">원자료의 시도 표기를 그대로 집계했습니다. ‘전남광주’처럼 혼재된 표기는 현재 행정구역으로 재분류하지 않았습니다.</p>${table(['원자료 시도 표기', '치과병원 수', '전체 대비'], g.regions.map(r => [esc(r.sido), `${fmt(r.count)}곳`, pct(r.percentOfTotal)]), '원자료 시도 표기별 치과병원 수')}${g.topCities.length ? `<h3>치과병원이 많은 시·군·구 ${fmt(g.topCities.length)}곳</h3>${table(['원자료 시도·시군구 표기', '치과병원 수'], g.topCities.map(c => [esc(c.label), `${fmt(c.count)}곳`]), '치과병원 수 상위 시·군·구')}<p class="subtle-note">기관 수가 많다는 뜻이며 지역의 진료 수준이나 접근성을 평가한 것이 아닙니다.</p>` : ''}</section>`;
  const opening = `<section class="report-section"><h2>언제 개설됐나요?</h2><p class="report-section-copy">원자료 개설일의 연도입니다. 개설일은 현재 운영 여부를 뜻하지 않습니다.</p>${table(['개설 시기', '치과병원 수', '전체 대비'], g.opening.map(b => [esc(b.label), `${fmt(b.count)}곳`, pct(b.percentOfTotal)]), '개설 시기별 치과병원 수')}</section>`;
  const specialties = `<section class="report-section"><h2>과목별 전문의가 1명 이상 등록된 치과병원</h2><p class="report-section-copy">한 기관이 여러 과목에 포함될 수 있으므로 합계는 기관 수와 다릅니다. 과목 표시만 있고 전문의가 0명인 기관은 세지 않았습니다.</p>${g.specialties.length ? table(['진료과목', '전문의 1명 이상 등록 기관', '치과병원 전체 대비'], g.specialties.map(s => [`${esc(s.name)}<small>코드 ${esc(s.code)}</small>`, `${fmt(s.count)}곳`, pct(s.percentOfTotal)]), '과목별 전문의 등록 치과병원 수') : '<p class="subtle-note">과목별 전문의 등록 자료가 없어 산출 불가입니다.</p>'}</section>`;
  const blanks = `<section class="report-section report-reading"><h2>빈칸도 정보입니다</h2><p>치과병원 ${fmt(g.total)}곳 중 홈페이지 URL 형식이 유효한 곳은 ${fmt(h.website.count)}곳(${pct(h.website.percentOfTotal)}), 하루 이상 진료시간이 확인되는 곳은 ${fmt(h.hours.count)}곳(${pct(h.hours.percentOfTotal)})입니다. 나머지는 원자료가 비어 있는 것이지 홈페이지가 없거나 휴진이라는 뜻이 아닙니다.</p><a class="text-link" href="/guides/reading-data/">등록 정보 읽는 법 ${icon('arrow')}</a></section>`;
  const method = `<section id="report-methodology" class="report-section prose"><h2>집계 방법과 해석 범위</h2><ol>${Object.entries(g.definitions).map(([key, text]) => `<li><strong>${esc({ population: '모집단', specialist: '전문의', cbct: '콘빔CT', university: '대학', regions: '지역', opening: '개설 시기', specialties: '과목별 전문의', website: '홈페이지', hours: '진료시간', comparison: '비교' }[key] ?? key)}:</strong> ${esc(text)}.</li>`).join('')}</ol><p>별도 표기하지 않은 비율은 조건에 해당하는 기관 수 ÷ 분모 × 100이며 소수 첫째 자리로 반올림합니다. 가격·후기·실시간 운영·예약 가능 여부는 수집하지 않았습니다. 이 자료는 의료적 진단이나 치료 판단을 대체하지 않습니다.</p></section>`;
  return `<article class="wrap report-article">${reportHeader(item, g, reports, description)}${summary}${registeredBanner}${comparison}${university}${regions}${opening}${specialties}${blanks}${method}${reportSource(reports, indexingEnabled, reportTitle(item, g))}</article>`;
}

// CSV layout shared with the coverage reports: columns 8–9 are percentages and stay empty when a ratio is undefined.
const CSV_HEADER = ['자료기준일', '구분', '전체기관수', '항목', '값', '자료확인기관수', '자료미확인기관수', '전체대비비율(%)', '확인자료대비비율(%)', '단위', '정의', '해석제한', '원본출처', '원본SHA256'];
function dentalHospitalsCsv(g, reports) {
  const rows = [CSV_HEADER];
  const push = (scope, total, label, value, known, unknown, pTotal, pKnown, unit, definition, limitation) => rows.push([reports.snapshotDate, scope, total, label, value, known, unknown, pTotal ?? '', pKnown ?? '', unit, definition, limitation, reports.sourceUrl, reports.sourceSha256]);
  for (const [scope, p] of [['치과병원', g.hospitals], ['치과의원', g.clinics]]) {
    push(scope, p.total, '치과전문의 등록 평균', p.specialist.mean ?? '', p.specialist.known, p.total - p.specialist.known, null, null, '명', g.definitions.specialist, g.definitions.comparison);
    push(scope, p.total, '치과전문의 등록 중앙값', p.specialist.median ?? '', p.specialist.known, p.total - p.specialist.known, null, null, '명', g.definitions.specialist, g.definitions.comparison);
    push(scope, p.total, '전문의 1명 이상 등록', p.specialist.atLeastOne.count, p.specialist.atLeastOne.known, p.specialist.atLeastOne.unknown, p.specialist.atLeastOne.percentOfTotal, p.specialist.atLeastOne.percentOfKnown, '곳', g.definitions.specialist, g.definitions.comparison);
    push(scope, p.total, '전문의 3명 이상 등록', p.specialist.atLeastThree.count, p.specialist.atLeastThree.known, p.specialist.atLeastThree.unknown, p.specialist.atLeastThree.percentOfTotal, p.specialist.atLeastThree.percentOfKnown, '곳', g.definitions.specialist, g.definitions.comparison);
    push(scope, p.total, '콘빔CT 등록 기관', p.cbct.registered.count, p.cbct.registered.known, p.cbct.registered.unknown, p.cbct.registered.percentOfTotal, p.cbct.registered.percentOfKnown, '곳', g.definitions.cbct, g.definitions.comparison);
    push(scope, p.total, '콘빔CT 등록 평균 대수', p.cbct.mean ?? '', p.cbct.known, p.total - p.cbct.known, null, null, '대', g.definitions.cbct, g.definitions.comparison);
    push(scope, p.total, '홈페이지 URL 형식 유효', p.website.count, p.website.known, p.website.unknown, p.website.percentOfTotal, p.website.percentOfKnown, '곳', g.definitions.website, g.definitions.comparison);
    push(scope, p.total, '하루 이상 진료시간 확인', p.hours.count, p.hours.known, p.hours.unknown, p.hours.percentOfTotal, p.hours.percentOfKnown, '곳', g.definitions.hours, g.definitions.comparison);
  }
  for (const [label, group] of [['기관명에 대학 포함', g.university], ['그 밖의 치과병원', g.university.others]]) {
    push('치과병원', g.total, `${label} 기관 수`, group.count, group.count, g.total - group.count, percentage(group.count, g.total), null, '곳', g.definitions.university, g.definitions.comparison);
    push('치과병원', g.total, `${label} 전문의 등록 평균`, group.specialist.mean ?? '', group.specialist.known, group.count - group.specialist.known, null, null, '명', g.definitions.university, g.definitions.specialist);
    push('치과병원', g.total, `${label} 전문의 등록 중앙값`, group.specialist.median ?? '', group.specialist.known, group.count - group.specialist.known, null, null, '명', g.definitions.university, g.definitions.specialist);
  }
  for (const r of g.regions) push('치과병원', g.total, `시도 ${r.sido}`, r.count, g.total, 0, r.percentOfTotal, null, '곳', g.definitions.regions, g.definitions.comparison);
  for (const c of g.topCities) push('치과병원', g.total, `시군구 ${c.label}`, c.count, g.total, 0, percentage(c.count, g.total), null, '곳', g.definitions.regions, '기관 수 상위 5곳');
  for (const b of g.opening) push('치과병원', g.total, `개설 ${b.label}`, b.count, g.total, 0, b.percentOfTotal, null, '곳', g.definitions.opening, g.definitions.comparison);
  for (const s of g.specialties) push('치과병원', g.total, `과목 ${s.name} (${s.code}) 전문의 1명 이상`, s.count, g.total, 0, s.percentOfTotal, null, '곳', g.definitions.specialties, '한 기관이 여러 과목에 포함될 수 있음');
  return rows;
}

export function hospitalVsClinicFaq(g, reports) {
  const facts = Object.fromEntries(reports.externalFacts.map(fact => [fact.id, fact]));
  return [
    { q: '치과병원은 30병상 이상이어야 하나요?', a: '아니요. 의료법 제3조의2의 30병상 요건은 병원·한방병원에만 해당하며, 치과병원에는 병상 수 요건이 없습니다.' },
    { q: '치과병원과 치과의원의 법적 차이는 무엇인가요?', a: '의료법 제3조는 치과의원을 주로 외래환자를 대상으로 하는 의원급 의료기관으로, 치과병원을 주로 입원환자를 대상으로 하는 병원급 의료기관으로 구분합니다.' },
    { q: '치과병원 외래 본인부담률은 얼마인가요?', a: `국민건강보험공단 안내 기준 일반 환자는 치과병원 ${facts['nhis-outpatient-copay']?.dentalHospital ?? '산출 불가'}, 치과의원 ${facts['nhis-outpatient-copay']?.dentalClinic ?? '산출 불가'}이며 65세 이상 등 예외는 별도입니다.` },
    { q: '치과병원이 치과의원보다 좋은가요?', a: '종별은 의료법상의 분류이며 진료의 질을 뜻하지 않습니다. 치과데이터랩은 기관 간 우열을 평가하지 않고 등록 자료의 차이만 보여줍니다.' },
    { q: '전국에 치과병원은 몇 곳인가요?', a: `${reports.snapshotDate} 건강보험심사평가원 자료 기준 치과병원은 ${fmt(g.total)}곳, 치과의원은 ${fmt(g.types.clinic)}곳입니다.` },
  ];
}

function hospitalVsClinicBody(item, g, reports, description, indexingEnabled) {
  const facts = reports.externalFacts;
  const sourceCell = fact => `<a href="${esc(fact.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(fact.sourceTitle)} ${icon('link')}</a><small>확인 ${esc(fact.checkedAt)}${fact.sourceKind === 'secondary' ? ' · 2차 자료, 고시 원문 대조 전' : ''}</small>`;
  const factRows = ids => facts.filter(fact => ids.includes(fact.id)).map(fact => [`${esc(fact.topic)}<small>${esc(fact.title)}</small>`, esc(fact.dentalHospital), esc(fact.dentalClinic), sourceCell(fact)]);
  const quotes = ids => `<details><summary>법령·안내 원문 발췌</summary><ul>${facts.filter(fact => ids.includes(fact.id)).map(fact => `<li><strong>${esc(fact.title)}</strong>: ${esc(fact.quote)}<br><small>${esc(fact.note)}</small></li>`).join('')}</ul></details>`;
  const summary = `<div class="report-metrics"><div><span>법적 구분</span><strong>병원급<small>vs 의원급</small></strong><p>의료법 제3조. 주로 입원환자 / 주로 외래환자</p></div><div><span>외래 본인부담률 (일반)</span><strong>40%<small>vs 30%</small></strong><p>치과병원 동지역 기준. 읍·면 35%. 예외 별도</p></div><div><span>치과병원 수</span><strong>${fmt(g.total)}<small>곳</small></strong><p>치과의원 ${fmt(g.types.clinic)}곳 · ${reports.snapshotDate} 기준</p></div></div>`;
  const legal = `<section class="report-section"><h2>법령은 무엇을 기준으로 나누나요?</h2><p class="report-section-copy">종별은 의료법의 분류입니다. 어느 쪽이 더 낫다는 뜻이 아니며, 각 기관의 실제 진료 범위는 기관에 확인해야 합니다.</p>${table(['항목', '치과병원', '치과의원', '출처 · 확인일'], factRows(['medical-service-act-3-2', 'medical-service-act-3-2bis']), '의료법상 치과병원과 치과의원의 구분')}${quotes(['medical-service-act-3-2', 'medical-service-act-3-2bis'])}<div class="report-reading"><h3>흔한 오해 바로잡기: “30병상 이상이면 치과병원”</h3><p>의료법 제3조의2는 30개 이상의 병상 요건을 괄호 안에서 병원·한방병원으로 한정합니다. 치과병원은 병원등에 포함되지만 병상 수 요건은 적용되지 않습니다. 병상 수로 치과병원을 설명하는 자료는 법령 문언과 다릅니다.</p></div></section>`;
  const cost = `<section class="report-section"><h2>환자 부담은 어떻게 다른가요?</h2><p class="report-section-copy">치과병원은 외래 본인부담률이 더 높습니다. 차이를 설명하는 글이므로 비용이 더 드는 부분도 그대로 적습니다.</p>${table(['항목', '치과병원', '치과의원', '출처 · 확인일'], factRows(['nhis-outpatient-copay', 'type-surcharge-2024']), '외래 본인부담률과 종별가산율의 차이')}${quotes(['nhis-outpatient-copay', 'type-surcharge-2024'])}<p class="subtle-note">본인부담률은 요양급여비용 총액 기준 일반 환자의 비율이며 비급여 진료에는 적용되지 않습니다. 종별가산율은 2024-01-01부터 축소되었으므로 그 이전 자료의 20%·15%는 현행이 아닙니다. 실제 부담액은 진료 내용에 따라 다릅니다.</p></section>`;
  const data = `<section class="report-section"><h2>등록 자료로 본 차이</h2><p class="report-section-copy">같은 분기 심평원 자료를 같은 정의로 집계했습니다. ${FRAMING} 종별이 진료의 질을 결정하지 않습니다.</p>${table(['등록 항목', `치과병원 ${fmt(g.total)}곳`, `치과의원 ${fmt(g.types.clinic)}곳`, '분모·해석'], comparisonRows(g), '치과병원과 치과의원의 등록 항목 비교')}<p class="subtle-note">전문의 수는 등록 인원이지 진료 실력이 아니며, 콘빔CT 항목의 부재는 미확인입니다. 전수 집계와 지역·개설 시기 분포는 <a href="/reports/dental-hospitals/">치과병원 ${fmt(g.total)}곳 전수 리포트</a>에 있습니다.</p></section>`;
  const faq = hospitalVsClinicFaq(g, reports);
  const qa = `<section class="report-section" id="faq"><h2>짧게 묻고 답하기</h2><dl class="prose">${faq.map(({ q, a }) => `<dt><strong>${esc(q)}</strong></dt><dd>${esc(a)}</dd>`).join('')}</dl></section>`;
  const method = `<section id="report-methodology" class="report-section prose"><h2>집계 방법과 해석 범위</h2><ol><li><strong>법령·제도:</strong> 각 행의 출처를 확인일과 함께 표시합니다. 1차 자료는 국가법령정보센터와 국민건강보험공단 안내이며, 2차 자료로 표시한 행은 고시 원문과 대조하기 전입니다. 법령 개정 시 내용이 달라질 수 있습니다.</li><li><strong>등록 자료:</strong> ${esc(g.definitions.population)}. ${esc(g.definitions.comparison)}.</li><li><strong>전문의·콘빔CT:</strong> ${esc(g.definitions.specialist)}. ${esc(g.definitions.cbct)}.</li><li><strong>쓰지 않는 표현:</strong> 안전성·실력·신뢰도를 종별로 비교하는 우열 표현은 쓰지 않습니다. 의료법 제56조는 다른 의료기관과 비교하는 광고를 금지하며, 이 페이지는 차이를 설명할 뿐 선택을 권하지 않습니다.</li><li><strong>진료 판단:</strong> 어떤 경우에 어느 종별을 찾아야 하는지는 의료진 검토 전이므로 싣지 않았습니다. 이 자료는 의료적 진단이나 치료 판단을 대체하지 않습니다.</li></ol></section>`;
  return `<article class="wrap report-article">${reportHeader(item, g, reports, description)}${summary}${registeredBanner}${legal}${cost}${data}${qa}${method}${reportSource(reports, indexingEnabled, reportTitle(item, g))}</article>`;
}

function hospitalVsClinicCsv(g, reports) {
  const rows = [CSV_HEADER];
  for (const fact of reports.externalFacts) {
    rows.push([reports.snapshotDate, '법령·제도', '', `${fact.topic} · 치과병원`, fact.dentalHospital, '', '', '', '', fact.sourceKind === 'secondary' ? '2차 자료, 고시 원문 대조 전' : '1차 자료', `${fact.title}: ${fact.quote}`, fact.note, fact.sourceUrl, `확인 ${fact.checkedAt}`]);
    rows.push([reports.snapshotDate, '법령·제도', '', `${fact.topic} · 치과의원`, fact.dentalClinic, '', '', '', '', fact.sourceKind === 'secondary' ? '2차 자료, 고시 원문 대조 전' : '1차 자료', `${fact.title}: ${fact.quote}`, fact.note, fact.sourceUrl, `확인 ${fact.checkedAt}`]);
  }
  for (const row of dentalHospitalsCsv(g, reports).slice(1, 17)) rows.push(row);
  return rows;
}

function registerDentalHospitalReports({ item, reports, page, put, domain, indexingEnabled }) {
  const g = reports.dentalHospitals, h = g.hospitals;
  const description = item.kind === 'dentalHospitals'
    ? `${reports.snapshotDate} 자료의 치과병원 ${fmt(g.total)}곳은 치과전문의 등록 평균 ${unit(h.specialist.mean, '명')}(중앙값 ${unit(h.specialist.median, '명')}), 전문의 1명 이상 등록 ${pct(h.specialist.atLeastOne.percentOfKnown)}, 콘빔CT 등록 ${fmt(h.cbct.registered.count)}곳입니다. 치과의원 ${fmt(g.types.clinic)}곳과 같은 기준으로 비교했습니다.`
    : `치과의원은 주로 외래환자를 보는 의원급, 치과병원은 주로 입원환자를 보는 병원급 의료기관입니다(의료법 제3조). 외래 본인부담률은 치과병원 40%(읍·면 35%), 치과의원 30%이며, ${reports.snapshotDate} 기준 치과병원 ${fmt(g.total)}곳의 등록 자료를 치과의원과 같은 기준으로 비교합니다.`;
  const exportData = { schemaVersion: reports.schemaVersion, title: reportTitle(item, g), snapshotDate: reports.snapshotDate, observedAt: reports.observedAt, sourceUrl: reports.sourceUrl, sourceSha256: reports.sourceSha256, attribution: reports.attribution, population: reports.population, percentageNote: reports.percentageNote, regionIssues: reports.regionIssues, definitions: g.definitions, ...(item.kind === 'hospitalVsClinic' ? { externalFacts: reports.externalFacts, faq: hospitalVsClinicFaq(g, reports) } : {}), scope: g };
  put(dataPath(item, 'json').slice(1), JSON.stringify(exportData, null, 2));
  put(dataPath(item, 'csv').slice(1), csv(item.kind === 'dentalHospitals' ? dentalHospitalsCsv(g, reports) : hospitalVsClinicCsv(g, reports)));
  const technique = item.kind === 'dentalHospitals'
    ? '동일 분기 종별코드 41 기관 전체를 전문의 인원, 콘빔CT 대수, 원자료 시도 표기, 개설 연도, 과목별 전문의 등록으로 집계하고 종별코드 51과 같은 정의로 비교. 각 지표의 분모를 명시하며 미확인 자료를 0이나 미보유로 추정하지 않음.'
    : '법령·보험 안내의 원문을 확인일과 함께 인용하고, 동일 분기 종별코드 41·51 기관의 등록 항목을 같은 정의로 비교. 종별 간 우열이나 진료의 질을 평가하지 않음.';
  const schema = [datasetSchema({ item, g, reports, domain, description, technique })];
  if (item.kind === 'hospitalVsClinic') schema.push({ '@context': 'https://schema.org', '@type': 'FAQPage', '@id': domain + route(item) + '#faq', mainEntity: hospitalVsClinicFaq(g, reports).map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  page(route(item), {
    title: reportTitle(item, g), description, current: 'reports', breadcrumb: [{ label: '데이터 리포트', url: '/reports/' }, { label: item.kind === 'dentalHospitals' ? '치과병원 전수' : '치과병원과 치과의원의 차이' }],
    schema,
    body: item.kind === 'dentalHospitals' ? dentalHospitalsBody(item, g, reports, description, indexingEnabled) : hospitalVsClinicBody(item, g, reports, description, indexingEnabled),
  });
}

// indexingEnabled: public/indexable build. operatorName: public operator shown in citations (falls back to the current value).
export function registerReportPages({ page, put, reports, domain, clinics, assetInventory, yangjuArchives=[], indexingEnabled = false, operatorName = null }) {
  const yangju = Array.isArray(clinics) && assetInventory?.records
    ? buildYangjuAnalysis(clinics, assetInventory, reports) : null;
  page('/reports/', {
    title: '치과 공공데이터 리포트', description: '전국과 경기북부의 치과 공공데이터를 모집단·기준일·누락 범위와 함께 읽습니다.', current: 'reports',
    breadcrumb: [{ label: '데이터 리포트' }],
    body: `<div class="wrap"><div class="page-intro"><p class="eyebrow">PUBLIC DATA REPORTS</p><h1>치과를 이해하는 데이터</h1><p>확인된 숫자와 확인되지 않은 범위를 함께 설명합니다.</p></div>${reportCards(reports)}${yangju?.scope.total ? `<section class="section"><h2>양주에서 출처별 자료의 차이 읽기</h2><div class="report-grid">${yangjuAnalysisCard(yangju)}</div></section>` : ''}<div class="source-banner">${icon('source')}<div><strong>공공데이터 집계는 ${reports.snapshotDate} 분기 자료를 사용합니다.</strong><p>별도 네이버 관찰 분석은 각 페이지에 확인 기간을 구분합니다. 출처, 집계 기준, 분모를 공개하며 현재 운영이나 진료 성과를 평가하지 않습니다.</p></div></div><div class="report-reading"><h2>다음 데이터를 준비하고 있습니다</h2><p>비급여 가격 분포, 아동 인구 대비 전문의, 디지털 현황은 필요한 원자료와 검증 절차를 마련한 뒤 추가합니다.</p><a class="text-link" href="/data/">지금 확인 가능한 데이터 ${icon('arrow')}</a></div></div>`,
  });

  for (const item of REPORTS) {
    if (item.kind) { registerDentalHospitalReports({ item, reports, page, put, domain, indexingEnabled }); continue; }
    const g = reports[item.group], northern = item.group === 'northernGyeonggi';
    const description = `${reports.snapshotDate} 자료에서 ${g.name} 치과 ${fmt(g.total)}곳 중 하루 이상 진료시간이 확인되는 기관은 ${fmt(g.metrics.hours.count)}곳(${pct(g.metrics.hours.percentOfTotal)})입니다.`;
    const exportData = { schemaVersion: reports.schemaVersion, title: item.title, snapshotDate: reports.snapshotDate, observedAt: reports.observedAt, sourceUrl: reports.sourceUrl, sourceSha256: reports.sourceSha256, attribution: reports.attribution, population: reports.population, percentageNote: reports.percentageNote, regionIssues: reports.regionIssues, definitions: reports.definitions, scope: g };
    put(dataPath(item, 'json').slice(1), JSON.stringify(exportData, null, 2));
    const csvRows = [['자료기준일', '지역', '전체기관수', '항목', '해당기관수', '자료확인기관수', '자료미확인기관수', '전체대비비율(%)', '확인자료대비비율(%)', '해당기관수정의', '확인자료분모정의', '해석제한', '원본출처', '원본SHA256']];
    for (const group of [g, ...(g.cities ?? [])]) for (const [key, label] of Object.entries(metricLabels)) {
      const m = group.metrics[key];
      csvRows.push([reports.snapshotDate, group.name, group.total, label, m.count, m.known, m.unknown, m.percentOfTotal ?? '', m.percentOfKnown ?? '', reports.definitions[key].countDefinition, reports.definitions[key].knownDefinition, reports.definitions[key].limitation, reports.sourceUrl, reports.sourceSha256]);
    }
    put(dataPath(item, 'csv').slice(1), csv(csvRows));
    page(route(item), {
      title: item.title, description, current: 'reports', breadcrumb: [{ label: '데이터 리포트', url: '/reports/' }, { label: northern ? '경기북부 등록시간' : '전국 데이터 수록 현황' }],
      schema: [{ '@context': 'https://schema.org', '@type': 'Dataset', '@id': domain + route(item) + '#dataset', name: item.title, description, url: domain + route(item), inLanguage: 'ko-KR', temporalCoverage: reports.snapshotDate, spatialCoverage: { '@type': 'Place', name: g.name }, creator: { '@type': 'Organization', name: '치과데이터랩' }, isBasedOn: { '@type': 'Dataset', name: '건강보험심사평가원 전국 병의원 및 약국 현황', url: SOURCE_URL }, measurementTechnique: '동일 분기 기관별 자료를 지역 코드와 유효한 시간쌍 기준으로 집계. 전체 기관 대비와 항목별 자료 확인 기관 대비 비율을 구분하고 각 분모를 명시. 미확인 자료는 휴진으로 추정하지 않음.', distribution: ['csv', 'json'].map(ext => ({ '@type': 'DataDownload', encodingFormat: ext === 'csv' ? 'text/csv' : 'application/json', contentUrl: domain + dataPath(item, ext) })) }],
      body: `<article class="wrap report-article"><header class="page-intro report-heading"><span class="pill outline">${item.tag}</span><h1>${item.title}</h1><p class="report-summary">${esc(description)}</p><p class="report-meta">자료 기준 ${reports.snapshotDate} · 원본 수집 ${localDate(reports.observedAt)} · 건강보험심사평가원</p><div class="hero-actions"><a class="btn small" href="${dataPath(item, 'csv')}" download>집계표 CSV</a><a class="btn small" href="${dataPath(item, 'json')}" download>근거 포함 JSON</a><button class="btn small" data-copy-citation>출처 포함 인용문 복사</button><a class="text-link" href="#report-methodology">집계 방법</a></div></header>${summary(g)}<div class="source-banner warning">${icon('info')}<div><strong>등록된 시간의 집계이며, 실제 진료 여부를 확인한 비율이 아닙니다.</strong><p>자료가 없는 기관도 모집단에 포함합니다. 공란을 휴진으로 바꾸지 않으며 방문 전 기관에 확인해야 합니다.</p></div></div>${northern ? northernContent(g) : nationalContent(g)}${definitions(reports, northern)}<section class="report-section report-source"><h2>출처와 변경 기록</h2><p><a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">건강보험심사평가원 · 전국 병의원 및 약국 현황 ${icon('link')}</a></p><p>원자료 이용 조건: 공공저작물 출처표시 제1유형. 치과데이터랩이 기관별 데이터를 선별·집계했습니다.</p><details><summary>재현에 사용한 원본 SHA-256</summary><code>${esc(reports.sourceSha256)}</code></details><p>리포트 집계 버전 1 · ${reports.snapshotDate} 자료로 최초 작성한 ${indexingEnabled ? '공개본' : '로컬 검토본'}. 아직 여러 분기의 변화를 비교하지 않습니다.</p><a class="text-link" href="/corrections/?clinic=${encodeURIComponent(item.title)}">집계 오류 정정 메모 ${icon('arrow')}</a></section></article>`,
    });
  }
  if (yangju?.scope.total) registerYangjuAnalysisPage({ page, put, analysis: yangju, domain,archives:yangjuArchives, operatorName });
}
