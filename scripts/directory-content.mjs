import { esc, fmt, singlePhone, SOURCE_URL } from '../src/shared.mjs';
import { hasValidHours } from './report-data.mjs';

const knownCount = value => Number.isSafeInteger(value) && value >= 0;

// All counts describe this snapshot's records, never current clinical ability.
export function directorySummary(clinics) {
  return {
    total: clinics.length,
    clinics: clinics.filter(c => c.typeCode === '51').length,
    hospitals: clinics.filter(c => c.typeCode === '41').length,
    specialists: clinics.filter(c => knownCount(c.doctors?.specialist) && c.doctors.specialist > 0).length,
    specialistMissing: clinics.filter(c => !knownCount(c.doctors?.specialist)).length,
    hours: clinics.filter(c => Object.values(c.hours ?? {}).some(hasValidHours)).length,
  };
}

export function directorySummaryPanel(clinics, { name, snapshot }) {
  const s = directorySummary(clinics);
  const metrics = [['치과의원', s.clinics], ['치과병원', s.hospitals], ['치과전문의 1명 이상 등록', s.specialists], ['시작·종료 시간쌍 확인', s.hours]];
  return `<section class="section" id="region-data-summary" aria-labelledby="region-summary-title"><h2 id="region-summary-title">${esc(name)} 치과 등록 자료 한눈에</h2><p>${esc(snapshot)} 심평원 원자료의 이 지역 분류에 포함된 ${fmt(s.total)}곳을 직접 집계했습니다. 현재 영업 중인 전체 치과 수와는 다를 수 있습니다.</p><div class="coverage-grid">${metrics.map(([label, value]) => `<div class="metric"><small>${esc(label)}</small><strong>${fmt(value)}<small>곳</small></strong></div>`).join('')}</div><p class="subtle-note">전문의 수 미확인은 ${fmt(s.specialistMissing)}곳이며, 0명 등록과 구분합니다. 시간쌍 확인은 최소 1개 요일의 시작·종료가 확인된 기관 수이며, 현재 진료 여부나 휴진을 뜻하지 않습니다. 종합병원 등의 치과는 이 집계에 포함하지 않습니다.</p><p><a class="text-link" href="${esc(SOURCE_URL)}" target="_blank" rel="noopener noreferrer">심평원 원자료 출처 ↗</a> · <a class="text-link" href="/data/">수록 범위·자료 기준 확인</a> · <a class="text-link" href="/guides/comparison-checklist/">방문 전 확인할 항목</a></p></section>`;
}

export function clinicMetadata(clinic, snapshot) {
  const location = [...new Set([clinic.sido, clinic.city, clinic.dong].filter(Boolean))].join(' ');
  const phone = singlePhone(clinic.phone);
  const specialist = clinic.doctors?.specialist;
  return {
    title: `${clinic.name} | ${location} 주소·전화·진료시간 자료`,
    description: `${clinic.type} ${clinic.name}. ${clinic.address}. ${phone ? '신고 전화 ' + clinic.phone : clinic.phone ? '신고 전화 원문은 상세에서 확인' : '신고 전화 자료 미확인'}. 치과전문의 등록 ${!knownCount(specialist) ? '자료 미확인' : fmt(specialist) + '명'}. 심평원 ${snapshot} 기준이며 현재 진료시간·홈페이지 안내는 출처별로 구분합니다.`,
  };
}

export function cityPageDescription({ region, city, clinics, page, size = 24, snapshot }) {
  const first = (page - 1) * size;
  const shown = clinics.slice(first, first + size);
  if (!shown.length) throw new Error('Cannot describe an empty district list page.');
  return `${region} ${city} 치과 ${fmt(clinics.length)}곳 중 ${fmt(first + 1)}–${fmt(first + shown.length)}번째 목록(${page}페이지). ${shown[0].name}${shown.length > 1 ? '부터 ' + shown.at(-1).name + '까지' : ''} 가나다순으로 주소·종별·등록 정보를 확인하세요. 심평원 ${snapshot} 기준, 추천 순위가 아닙니다.`;
}

export function directoryPagination(base, current, total) {
  if (total <= 1) return '';
  const range = [...new Set([1, current - 1, current, current + 1, total])].filter(x => x > 0 && x <= total).sort((a, b) => a - b);
  const url = page => page === 1 ? base : base + `page/${page}/`;
  let last = 0;
  const numbered = range.map(page => {
    const gap = last && page > last + 1 ? '<span aria-hidden="true">…</span>' : '';
    last = page;
    return `${gap}<a href="${url(page)}" aria-label="${page}페이지" ${page === current ? 'aria-current="page"' : ''}>${page}</a>`;
  }).join('');
  return `<nav class="pagination" aria-label="시군구 치과 목록 페이지">${current > 1 ? `<a href="${url(current - 1)}" aria-label="이전 목록: ${current - 1}페이지">이전</a>` : ''}${numbered}${current < total ? `<a href="${url(current + 1)}" aria-label="다음 목록: ${current + 1}페이지">다음</a>` : ''}</nav>`;
}

export function clinicDirectoryLinks(clinic) {
  return `<div class="fact-panel"><h3>이 지역 치과와 자료 확인</h3><p><a class="text-link" href="/regions/${esc(clinic.sidoCode)}/${esc(clinic.cityCode)}/">${esc(clinic.city)} 치과 전체 목록</a></p><p><a class="text-link" href="/regions/${esc(clinic.sidoCode)}/">${esc(clinic.sido)} 시군구별 치과</a></p><p><a class="text-link" href="#basic">주소·신고 전화 확인</a> · <a class="text-link" href="#hours">출처별 진료시간 자료</a></p><p><a class="text-link" href="#marketing-assets">홈페이지·네이버지도·채널 확인</a></p></div>`;
}
