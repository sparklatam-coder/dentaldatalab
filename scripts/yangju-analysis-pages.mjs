import { esc, fmt, localDate } from '../src/shared.mjs';
import {citationPack,citationSection,registerCitationFiles} from './yangju-citation.mjs';
import { YANGJU_REPORT_ROUTE } from './yangju-analysis.mjs';

const pct = value => value == null ? '산출 불가' : value.toFixed(1) + '%';
const downloads = '/data/reports/yangju-hours-evidence';
const coverageLabels = { both: '심평원 시간쌍과 네이버 시간 원문 모두 확인', registeredOnly: '심평원 시간쌍만 확인', naverOnly: '네이버 시간 원문만 확인', neither: '두 출처 모두 시간 미확인' };
const csv = rows => '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
function table(headers, rows, caption) {
  return `<div class="report-table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="report-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, i) => i ? `<td>${esc(cell)}</td>` : `<th scope="row">${esc(cell)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export function yangjuAnalysisCard(analysis) {
  return `<a class="report-card" href="${YANGJU_REPORT_ROUTE}"><span class="pill outline">양주 · 출처별 시간 자료 분석</span><h3>양주 치과 ${fmt(analysis.scope.total)}곳, 시간 정보는 어디까지 확인됐을까?</h3><p>읍면동 분포·요일별 등록시간과 네이버 시간 원문의 수록 범위를 구분합니다.</p><span class="text-link">분모와 근거 읽기 ↗</span></a>`;
}

export function registerYangjuAnalysisPage({ page, put, analysis: a, domain, archives=[] }) {
  registerCitationFiles({put,analysis:a,domain,archives});
  const title = `양주 치과 ${fmt(a.scope.total)}곳의 시간 정보: 등록 자료와 네이버 안내 분석`;
  const description = `양주 치과 ${fmt(a.scope.total)}곳 중 심평원 시간쌍 ${fmt(a.registered.hours)}곳, 평일 19시 이후 종료 등록 ${fmt(a.registered.night)}곳. 읍면동 분포와 기관 식별을 확인한 네이버 시간 원문의 수록 범위를 출처별로 읽습니다.`;
  put(downloads.slice(1) + '.json', JSON.stringify(a, null, 2));
  const rows = [['집계구분', '항목', '기관수', '전체분모', '심평원기준일', '해석제한']];
  for (const row of a.byDong) rows.push(['읍면동분포', row.name, row.total, a.scope.total, a.snapshotDate, '원자료 읍면동 표기. 현재 행정구역이나 영업기관 전체 수가 아님']);
  for (const row of a.weekdays) {
    rows.push(['요일별시간쌍', row.label, row.registered, a.scope.total, a.snapshotDate, '동일 요일의 유효한 시작·종료 등록. 현재 진료 확인 아님']);
    if (row.weekdayNineteenOrLater != null) rows.push(['평일19시이후종료등록', row.label, row.weekdayNineteenOrLater, a.scope.total, a.snapshotDate, '19:00 종료 포함. 접수 가능 시각·현재 야간진료 아님']);
  }
  for (const [key, count] of Object.entries(a.coverage)) rows.push(['출처별시간수록', coverageLabels[key], count, a.scope.total, a.snapshotDate, a.interpretation]);
  put(downloads.slice(1) + '.csv', csv(rows));
  page(YANGJU_REPORT_ROUTE, {
    title, description, current: 'reports', breadcrumb: [{ label: '데이터 리포트', url: '/reports/' }, { label: '양주 출처별 시간 분석' }],
    schema: [{ '@context': 'https://schema.org', '@type': 'Dataset', '@id': domain + YANGJU_REPORT_ROUTE + '#dataset', name: title, description,
      url: domain + YANGJU_REPORT_ROUTE, version:citationPack(a,domain).version, image:domain+citationPack(a,domain).base+'.svg', inLanguage: 'ko-KR', spatialCoverage: { '@type': 'Place', name: '양주시' },
      isBasedOn: { '@type': 'Dataset', name: '건강보험심사평가원 전국 병의원 및 약국 현황', url: a.sourceUrl },
      measurementTechnique: a.interpretation,
      distribution: ['csv', 'json'].map(ext => ({ '@type': 'DataDownload', encodingFormat: ext === 'csv' ? 'text/csv' : 'application/json', contentUrl: domain + downloads + '.' + ext })) }],
    body: `<article class="wrap report-article"><header class="page-intro"><span class="pill outline">양주 · 출처별 자료 분석</span><h1>${esc(title)}</h1><p>${esc(description)}</p><p class="report-meta">심평원 기준 ${esc(a.snapshotDate)} · 네이버 관찰 ${a.naver.earliestCheckedAt ? localDate(a.naver.earliestCheckedAt) + '–' + localDate(a.naver.latestCheckedAt) : '미확인'}</p><div class="hero-actions"><a class="btn small" href="${downloads}.csv" download>집계표 CSV</a><a class="btn small" href="${downloads}.json" download>관찰 근거·집계 JSON</a><a class="btn small" href="#key-findings">핵심 발견·인용·그래프</a></div></header>${citationSection(a,domain)}<div class="source-banner warning"><div><strong>시간표의 일치율이나 현재 영업 비율을 계산한 자료가 아닙니다.</strong><p>기준일이 다른 두 출처에서 시간 정보를 어디까지 읽었는지 비교합니다. 미확인은 휴진이나 네이버 안내 부재를 뜻하지 않습니다.</p></div></div>
<section class="report-section"><h2>양주 치과는 원자료에서 어디에 분포하나요?</h2><p>경기 시도코드 310000·양주 시군구코드 312700의 치과의원 ${fmt(a.scope.clinic)}곳과 치과병원 ${fmt(a.scope.hospital)}곳, 총 ${fmt(a.scope.total)}곳입니다. 종합병원의 치과는 제외합니다. 읍면동은 원자료 표기를 보존하며 주소에서 추정하지 않았습니다. 가나다순이며 추천 순위가 아닙니다.</p>${table(['원자료 읍면동', '전체 기관', '심평원 시간쌍', '평일 19시 이후 종료 등록', '네이버 시간 원문'], a.byDong.map(row => [row.name, row.total, row.registeredHours, row.registeredNight, row.naverHours]), '양주 원자료 읍면동별 기관 분포와 출처별 시간 수록 기관 수')}</section>
<section class="report-section"><h2>요일별 등록시간에서 읽을 수 있는 범위</h2><p>심평원 자료에서 하루 이상 유효한 시간쌍은 ${fmt(a.registered.hours)}곳(${pct(a.registered.hoursPercentOfTotal)}), 미확인은 ${fmt(a.registered.missing)}곳입니다. 평일 19:00 이상 종료 등록은 ${fmt(a.registered.night)}곳(${pct(a.registered.nightPercentOfTotal)})이며 분모는 모두 ${fmt(a.scope.total)}곳입니다. 여러 요일에 중복되므로 아래 행을 더해 기관 수로 해석하면 안 됩니다.</p>${table(['요일', '시간쌍 확인', '시간쌍 미확인', '19:00 이상 종료 등록(평일)'], a.weekdays.map(row => [row.label, row.registered, row.missing, row.weekdayNineteenOrLater ?? '해당 없음']), '양주 요일별 심평원 시간쌍과 평일 종료시각 조건')}<p class="subtle-note">19:00 종료도 포함합니다. 접수 마감이나 현재 야간진료를 뜻하지 않습니다. 시작·종료가 유효하고 종료가 시작보다 늦을 때만 포함하며 자정 넘김을 추정하지 않습니다.</p></section>
<section class="report-section"><h2>등록 자료의 빈칸을 네이버 안내로 읽을 수 있나요?</h2><p>기관 식별과 본문 확인을 통과한 네이버 시간 원문은 ${fmt(a.naver.hours)}곳(${pct(a.naver.percentOfTotal)})입니다. ${a.naver.available ? '' : '네이버 관찰 입력이 제공되지 않아 이 출처의 수집 여부를 판단할 수 없습니다. '}심평원 시간쌍 미확인 ${fmt(a.registered.missing)}곳 중 ${fmt(a.coverage.naverOnly)}곳은 별도 네이버 관찰에서 시간 원문을 확보했고, ${fmt(a.coverage.neither)}곳은 두 출처 모두 시간 미확인으로 남았습니다. 이 차이는 분기 등록 파일의 빈칸만으로 시간 안내의 부재를 판단할 수 없는 이유입니다. 아래 네 집단은 중복 없이 ${fmt(a.scope.total)}곳 전체를 나눕니다. ‘둘 다 확인’은 시간 내용이 같다는 뜻이 아닙니다.</p>${table(['시간 정보 수록 상태', '기관 수', '전체 분모'], Object.entries(a.coverage).map(([key, count]) => [coverageLabels[key], count, a.scope.total]), '양주 기관별 두 출처의 시간 정보 수록 여부 교차표')}<p>네이버 원문을 주간 시간표나 야간 조건으로 새로 변환하지 않았습니다. 날짜가 붙은 임시휴진·주차별 안내·접수 마감은 기관 상세의 원문에서 확인해야 합니다. 한 출처의 값을 다른 출처의 원자료에 덮어쓰지 않았습니다.</p></section>
<section class="report-section prose"><h2>누가 같은 숫자를 재현할 수 있나요?</h2><ol><li>위 원자료 지역·종별 코드로 모집단을 고정합니다.</li><li>기존 공공데이터 리포트와 같은 유효 시간쌍 함수를 적용합니다.</li><li>네이버는 현재 정정 이력에 의해 제외되지 않은 Place에서 본문 읽음·기관 식별 일치·시간 원문·유효 확인시각을 충족한 최신 관찰만 사용합니다. 검색 후보와 접근 실패는 포함하지 않습니다.</li><li>JSON의 관찰 근거에는 기관 ID·확인시각·원문 URL을 기록합니다. 네이버는 전수 현황을 보장하는 무작위 표본이 아니며 관찰일도 분기 자료 기준일과 다릅니다.</li></ol><p><a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener noreferrer">심평원 원자료 출처 ↗</a> · <a href="/regions/310000/312700/">양주 전체 등록기관 목록</a> · <a href="/reports/northern-gyeonggi-hours/">경기북부의 같은 등록시간 기준</a> · <a href="/guides/reading-data/">0과 미확인 읽는 법</a></p><p>원본 SHA-256: <code>${esc(a.sourceSha256)}</code></p><p>${esc(a.interpretation)}</p></section></article>`,
  });
}
