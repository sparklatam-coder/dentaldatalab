// Small, data-derived notes for the /regions/ pages: which raw 시도 labels a code carries, which source code pairs
// describe the same 구 (DISTRICT_CODE_ALIASES), and a link to the region's dental-hospital list.
import { esc, fmt } from '../src/shared.mjs';
import { DISTRICT_CODE_ALIASES } from './report-data.mjs';

/** The most frequent raw 시도 label of a code (ties: Korean order), used for titles, H1s and breadcrumbs. */
export function majorityLabel(names) {
  const entries = [...(names instanceof Map ? names : new Map(Object.entries(names ?? {})))];
  if (!entries.length) throw new Error('A region needs at least one label.');
  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0][0];
}

/** Every raw label with its count, most frequent first. */
export const labelCounts = names => [...(names instanceof Map ? names : new Map(Object.entries(names ?? {})))].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));

export function regionLabelNote(region) {
  const labels = labelCounts(region.names);
  if (labels.length < 2) return '';
  return `<p class="subtle-note" style="margin:14px 0">원자료의 이 시도코드에는 표기가 ${labels.length}가지 있습니다: ${labels.map(([label, count]) => `${esc(label)} ${fmt(count)}곳`).join(' · ')}. 제목에는 가장 많은 표기를 쓰고, 각 기관 페이지에는 원문 표기를 그대로 둡니다.</p>`;
}

/** Links between the two code pairs that the source uses for the same 구. */
export function regionAliasNote({ sidoCode, cityCode = null }) {
  const out = DISTRICT_CODE_ALIASES.filter(a => a.sidoCode === sidoCode && (!cityCode || a.cityCode === cityCode))
    .map(a => `${esc(a.city)}는 원자료에서 시도코드 ${a.sidoCode}·시군구코드 ${a.cityCode}와 ${a.toSidoCode}·${a.toCityCode} 두 가지로 나옵니다. <a class="text-link" href="/regions/${a.toSidoCode}/${a.toCityCode}/">${a.toCityCode} 쪽 ${esc(a.city)} 목록 보기</a>`);
  const back = DISTRICT_CODE_ALIASES.filter(a => a.toSidoCode === sidoCode && (!cityCode || a.toCityCode === cityCode))
    .map(a => `같은 ${esc(a.city)} 표기로 시도코드 ${a.sidoCode}·시군구코드 ${a.cityCode}에 등록된 기관도 있습니다. <a class="text-link" href="/regions/${a.sidoCode}/${a.cityCode}/">${a.cityCode} 쪽 ${esc(a.city)} 목록 보기</a>`);
  const lines = cityCode ? [...out, ...back] : out;
  return lines.length ? `<div class="notice" role="note"><strong>지역 코드가 두 가지로 나옵니다</strong>${lines.map(l => `<p>${l}</p>`).join('')}<p>원자료 분류를 바꾸지 않고 두 목록을 서로 연결만 합니다.</p></div>` : '';
}

/** A link to /hospitals/{sido}/ when the region has at least one 치과병원 (종별코드 41). */
export function hospitalListLink({ sidoCode, name, clinics, scope = name }) {
  const hospitals = clinics.filter(c => c.typeCode === '41').length;
  if (!hospitals) return '';
  return `<p><a class="text-link" href="/hospitals/${esc(sidoCode)}/">${esc(name)} 치과병원 목록 보기</a> <span class="subtle-note">${esc(scope)}에 치과병원 ${fmt(hospitals)}곳 등록</span></p>`;
}

/**
 * One sentence, computed from the rows, describing every 시도코드 whose raw label varies or that is part of a
 * DISTRICT_CODE_ALIASES pair, with the first address word each label uses. Every page that explains the
 * 광주·전남 labels reuses it, so the counts never drift apart. Returns escaped HTML text ('' when nothing varies).
 */
export function regionLabelSentence(clinics) {
  const aliasCodes = new Set(DISTRICT_CODE_ALIASES.flatMap(a => [a.sidoCode, a.toSidoCode]));
  const byCode = new Map();
  for (const c of clinics) {
    if (!byCode.has(c.sidoCode)) byCode.set(c.sidoCode, new Map());
    const labels = byCode.get(c.sidoCode);
    if (!labels.has(c.sido)) labels.set(c.sido, { count: 0, prefixes: new Map() });
    const entry = labels.get(c.sido), prefix = String(c.address ?? '').trim().split(/\s+/)[0];
    entry.count++;
    if (prefix) entry.prefixes.set(prefix, (entry.prefixes.get(prefix) ?? 0) + 1);
  }
  const parts = [...byCode].filter(([code, labels]) => labels.size > 1 || aliasCodes.has(code))
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([code, labels]) => `시도코드 ${esc(code)}은 ${[...labels].sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], 'ko')).map(([label, e]) => {
      const prefix = [...e.prefixes].sort((a, b) => b[1] - a[1])[0]?.[0];
      return `‘${esc(label)}’ ${fmt(e.count)}곳${prefix ? `(주소 ‘${esc(prefix)}’)` : ''}`;
    }).join('·')}`);
  return parts.length ? `원자료에서 ${parts.join(', ')}으로 표기됩니다. 코드와 표기를 합치거나 고치지 않고 원문 그대로 집계했습니다.` : '';
}
