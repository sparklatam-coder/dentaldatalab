import { esc, fmt, icon, SOURCE_URL, localDate } from '../src/shared.mjs';

export const REPORTS = [
  { slug: 'national-data-coverage', group: 'national', tag: '전국 · 데이터 수록 현황', title: '전국 치과 데이터, 어디까지 확인할 수 있을까?', description: '치과 등록 정보의 수록 범위와 빈칸을 함께 살펴봅니다.' },
  { slug: 'northern-gyeonggi-hours', group: 'northernGyeonggi', tag: '경기북부 · 등록시간 현황', title: '경기북부 치과의 야간·주말 등록시간', description: '10개 시·군의 시간 수록 현황과 조건별 등록 건수를 정리했습니다.' },
];
const metricLabels = {
  specialist: '전문의 1명 이상 등록', hours: '하루 이상 시간 확인',
  night: '평일 19시 이후 종료 등록', saturday: '토요일 시간 확인',
  sunday: '일요일 시간 확인', website: '홈페이지 URL 형식 유효',
};
const pct = value => value == null ? '산출 불가' : `${Number(value).toFixed(1)}%`;
const route = item => `/reports/${item.slug}/`;
const dataPath = (item, ext) => `/data/reports/${item.slug}.${ext}`;

export function reportCards(reports) {
  return `<div class="report-grid">${REPORTS.map((item, i) => {
    const g = reports[item.group];
    return `<a class="report-card" href="${route(item)}"><div class="report-card-top"><span class="pill outline">${item.tag}</span><span class="report-number">0${i + 1}</span></div><h3>${item.title}</h3><p>${item.description}</p><div class="report-card-bottom"><span>${fmt(g.total)}곳 · ${reports.snapshotDate} 기준</span><span class="text-link">리포트 읽기 ${icon('arrow')}</span></div></a>`;
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

function table(headers, rows, caption) {
  return `<div class="report-table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="report-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => i === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
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

export function registerReportPages({ page, put, reports, domain }) {
  page('/reports/', {
    title: '치과 공공데이터 리포트', description: '전국과 경기북부의 치과 공공데이터를 모집단·기준일·누락 범위와 함께 읽습니다.', current: 'reports',
    breadcrumb: [{ label: '데이터 리포트' }],
    body: `<div class="wrap"><div class="page-intro"><p class="eyebrow">PUBLIC DATA REPORTS</p><h1>치과를 이해하는 데이터</h1><p>확인된 숫자와 확인되지 않은 범위를 함께 설명합니다.</p></div>${reportCards(reports)}<div class="source-banner">${icon('source')}<div><strong>모든 리포트는 ${reports.snapshotDate} 분기 자료에서 계산합니다.</strong><p>출처, 집계 기준, 분모를 공개합니다. 원자료의 등록 상태이며 현재 운영이나 진료 성과를 평가하지 않습니다.</p></div></div><div class="report-reading"><h2>다음 데이터를 준비하고 있습니다</h2><p>비급여 가격 분포, 아동 인구 대비 전문의, 디지털 현황은 필요한 원자료와 검증 절차를 마련한 뒤 추가합니다.</p><a class="text-link" href="/data/">지금 확인 가능한 데이터 ${icon('arrow')}</a></div></div>`,
  });

  for (const item of REPORTS) {
    const g = reports[item.group], northern = item.group === 'northernGyeonggi';
    const description = `${reports.snapshotDate} 자료에서 ${g.name} 치과 ${fmt(g.total)}곳 중 하루 이상 진료시간이 확인되는 기관은 ${fmt(g.metrics.hours.count)}곳(${pct(g.metrics.hours.percentOfTotal)})입니다.`;
    const exportData = { schemaVersion: reports.schemaVersion, title: item.title, snapshotDate: reports.snapshotDate, observedAt: reports.observedAt, sourceUrl: reports.sourceUrl, sourceSha256: reports.sourceSha256, attribution: reports.attribution, population: reports.population, percentageNote: reports.percentageNote, regionIssues: reports.regionIssues, definitions: reports.definitions, scope: g };
    put(dataPath(item, 'json').slice(1), JSON.stringify(exportData, null, 2));
    const csvRows = [['자료기준일', '지역', '전체기관수', '항목', '해당기관수', '자료확인기관수', '자료미확인기관수', '전체대비비율(%)', '확인자료대비비율(%)', '해당기관수정의', '확인자료분모정의', '해석제한', '원본출처', '원본SHA256']];
    for (const group of [g, ...(g.cities ?? [])]) for (const [key, label] of Object.entries(metricLabels)) {
      const m = group.metrics[key];
      csvRows.push([reports.snapshotDate, group.name, group.total, label, m.count, m.known, m.unknown, m.percentOfTotal ?? '', m.percentOfKnown ?? '', reports.definitions[key].countDefinition, reports.definitions[key].knownDefinition, reports.definitions[key].limitation, reports.sourceUrl, reports.sourceSha256]);
    }
    const csv = '\uFEFF' + csvRows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
    put(dataPath(item, 'csv').slice(1), csv);
    page(route(item), {
      title: item.title, description, current: 'reports', breadcrumb: [{ label: '데이터 리포트', url: '/reports/' }, { label: northern ? '경기북부 등록시간' : '전국 데이터 수록 현황' }],
      schema: [{ '@context': 'https://schema.org', '@type': 'Dataset', '@id': domain + route(item) + '#dataset', name: item.title, description, url: domain + route(item), inLanguage: 'ko-KR', temporalCoverage: reports.snapshotDate, spatialCoverage: { '@type': 'Place', name: g.name }, creator: { '@type': 'Organization', name: '치과데이터랩' }, isBasedOn: { '@type': 'Dataset', name: '건강보험심사평가원 전국 병의원 및 약국 현황', url: SOURCE_URL }, measurementTechnique: '동일 분기 기관별 자료를 지역 코드와 유효한 시간쌍 기준으로 집계. 전체 기관 대비와 항목별 자료 확인 기관 대비 비율을 구분하고 각 분모를 명시. 미확인 자료는 휴진으로 추정하지 않음.', distribution: ['csv', 'json'].map(ext => ({ '@type': 'DataDownload', encodingFormat: ext === 'csv' ? 'text/csv' : 'application/json', contentUrl: domain + dataPath(item, ext) })) }],
      body: `<article class="wrap report-article"><header class="page-intro report-heading"><span class="pill outline">${item.tag}</span><h1>${item.title}</h1><p class="report-summary">${esc(description)}</p><p class="report-meta">자료 기준 ${reports.snapshotDate} · 원본 수집 ${localDate(reports.observedAt)} · 건강보험심사평가원</p><div class="hero-actions"><a class="btn small" href="${dataPath(item, 'csv')}" download>집계표 CSV</a><a class="btn small" href="${dataPath(item, 'json')}" download>근거 포함 JSON</a><button class="btn small" data-copy-citation>출처 포함 인용문 복사</button><a class="text-link" href="#report-methodology">집계 방법</a></div></header>${summary(g)}<div class="source-banner warning">${icon('info')}<div><strong>등록된 시간의 집계이며, 실제 진료 여부를 확인한 비율이 아닙니다.</strong><p>자료가 없는 기관도 모집단에 포함합니다. 공란을 휴진으로 바꾸지 않으며 방문 전 기관에 확인해야 합니다.</p></div></div>${northern ? northernContent(g) : nationalContent(g)}${definitions(reports, northern)}<section class="report-section report-source"><h2>출처와 변경 기록</h2><p><a href="${SOURCE_URL}" target="_blank" rel="noopener noreferrer">건강보험심사평가원 · 전국 병의원 및 약국 현황 ${icon('link')}</a></p><p>원자료 이용 조건: 공공저작물 출처표시 제1유형. 치과데이터랩이 기관별 데이터를 선별·집계했습니다.</p><details><summary>재현에 사용한 원본 SHA-256</summary><code>${esc(reports.sourceSha256)}</code></details><p>리포트 집계 버전 1 · ${reports.snapshotDate} 자료로 최초 작성한 로컬 검토본. 아직 여러 분기의 변화를 비교하지 않습니다.</p><a class="text-link" href="/corrections/?clinic=${encodeURIComponent(item.title)}">집계 오류 정정 메모 ${icon('arrow')}</a></section></article>`,
    });
  }
}
