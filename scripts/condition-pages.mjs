// Condition landing pages: /conditions/ (index), /conditions/<slug>/ (national hub) and
// /regions/<sidoCode>/<cityCode>/<slug>/ (one 시·군·구 × one condition).
// Conditions reuse the report definitions so every count here matches the reports and the search filters.
// Listings are 가나다순 and never ranked; a district page exists only when MIN_DISTRICT_MATCHES clinics match,
// so no page is a near-empty shell. Registered hours are not live opening hours and every page says so.
import {esc, fmt, icon, clinicUrl, singlePhone, closesAtOrAfter, SOURCE_URL} from '../src/shared.mjs';
import { clinicItemList } from './html.mjs';
import {hasValidHours, REPORT_DEFINITIONS} from './report-data.mjs';

export const MIN_DISTRICT_MATCHES = 5;
/** National hubs list every matching clinic only when the list stays readable. */
export const HUB_FULL_LIST_LIMIT = 300;
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DAY_SHORT = {mon: '월', tue: '화', wed: '수', thu: '목', fri: '금', sat: '토', sun: '일'};
const knownCount = value => Number.isSafeInteger(value) && value >= 0;
const span = h => `${h.open}~${h.close}`;
const byName = (a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id);
const percent = (count, total) => total ? (Math.round(count / total * 1000) / 10).toFixed(1) + '%' : '산출 불가';

export const CONDITIONS = Object.freeze([
  {
    slug: 'night', name: '야간 진료', keyword: '야간 진료 치과', definition: REPORT_DEFINITIONS.night, findParam: 'night',
    phrase: '평일(월~금) 중 하루 이상 19시 이후 종료 시간이 등록되어 있습니다',
    titleSuffix: '평일 19시 이후 등록시간', column: '19시 이후 종료 요일',
    test: c => WEEKDAYS.some(d => closesAtOrAfter(c.hours?.[d], '19:00')),
    known: c => WEEKDAYS.some(d => hasValidHours(c.hours?.[d])),
    detail: c => WEEKDAYS.filter(d => closesAtOrAfter(c.hours?.[d], '19:00')).map(d => `${DAY_SHORT[d]} ${span(c.hours[d])}`).join(' · '),
  },
  {
    slug: 'saturday', name: '토요일 진료', keyword: '토요일 진료 치과', definition: REPORT_DEFINITIONS.saturday, findParam: 'saturday',
    phrase: '토요일 진료시간이 등록되어 있습니다',
    titleSuffix: '토요일 등록 진료시간', column: '토요일 등록시간',
    test: c => hasValidHours(c.hours?.sat),
    known: c => hasValidHours(c.hours?.sat),
    detail: c => span(c.hours.sat),
  },
  {
    slug: 'sunday', name: '일요일 진료', keyword: '일요일 진료 치과', definition: REPORT_DEFINITIONS.sunday, findParam: null,
    phrase: '일요일 진료시간이 등록되어 있습니다',
    titleSuffix: '일요일 등록 진료시간', column: '일요일 등록시간',
    test: c => hasValidHours(c.hours?.sun),
    known: c => hasValidHours(c.hours?.sun),
    detail: c => span(c.hours.sun),
  },
  {
    slug: 'specialist', name: '치과전문의 등록', keyword: '치과전문의 치과', definition: REPORT_DEFINITIONS.specialist, findParam: 'specialist',
    phrase: '치과전문의가 1명 이상 등록되어 있습니다',
    titleSuffix: '과목별 전문의 등록 인원', column: '전문의 등록',
    test: c => knownCount(c.doctors?.specialist) && c.doctors.specialist > 0,
    known: c => knownCount(c.doctors?.specialist),
    detail: c => {
      const fields = (c.specialties ?? []).filter(s => knownCount(s.specialists) && s.specialists > 0).map(s => `${s.name} ${s.specialists}`);
      return `${fmt(c.doctors.specialist)}명${fields.length ? ' · ' + fields.join(', ') : ''}`;
    },
  },
].map(Object.freeze));

export const conditionBySlug = slug => CONDITIONS.find(c => c.slug === slug) ?? null;
export const conditionHubRoute = slug => `/conditions/${slug}/`;
export const districtConditionRoute = (sidoCode, cityCode, slug) => `/regions/${sidoCode}/${cityCode}/${slug}/`;

/**
 * Pure grouping of matches per 시·군·구 code. Region names come from the caller's region list so the
 * labels match the existing /regions/ pages.
 */
export function districtConditionGroups(regions) {
  const groups = [];
  for (const r of regions) for (const city of r.cities) {
    const list = [...city.clinics].sort(byName);
    for (const condition of CONDITIONS) {
      const matches = list.filter(condition.test);
      groups.push({
        sidoCode: r.sidoCode, sido: r.name, cityCode: city.code, city: city.name, slug: condition.slug,
        total: list.length, known: list.filter(condition.known).length, matches,
        route: matches.length >= MIN_DISTRICT_MATCHES ? districtConditionRoute(r.sidoCode, city.code, condition.slug) : null,
      });
    }
  }
  return groups;
}

/** Links from an existing district page or clinic page to the condition pages that exist for that district. */
// Clinic pages call districtConditionLinks once each (~19,700 times), so index the published groups by district once.
const districtIndex = new WeakMap();
function publishedByDistrict(groups) {
  let index = districtIndex.get(groups);
  if (!index) {
    index = new Map();
    for (const g of groups) {
      if (!g.route) continue;
      const key = `${g.sidoCode}:${g.cityCode}`;
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(g);
    }
    districtIndex.set(groups, index);
  }
  return index;
}

export function districtConditionLinks(groups, sidoCode, cityCode, {current = null, label = null} = {}) {
  const own = (publishedByDistrict(groups).get(`${sidoCode}:${cityCode}`) ?? []).filter(g => g.slug !== current);
  if (!own.length) return '';
  return `<div class="condition-links">${own.map(g => `<a href="${g.route}">${esc(label ? `${g.city} ${conditionBySlug(g.slug).name}` : conditionBySlug(g.slug).name)} ${fmt(g.matches.length)}곳 ${icon('arrow')}</a>`).join('')}</div>`;
}

const phoneCell = c => {
  const tel = singlePhone(c.phone);
  return tel ? `<a href="tel:${tel}" data-outbound="tel" data-clinic="${esc(c.id)}">${esc(c.phone)}</a>` : (c.phone ? esc(c.phone) : '<span class="unknown">자료 미확인</span>');
};

/** Table rows show the evidence for the condition next to each name; no row is ordered by that evidence. */
export function conditionTable(condition, clinics, {caption, showDistrict = false} = {}) {
  return `<div class="table-scroll condition-table-wrap"><table class="simple-table condition-table"><caption class="sr-only">${esc(caption)}</caption><thead><tr><th scope="col">기관명</th><th scope="col">${showDistrict ? '시·군·구 · 동' : '동'}</th><th scope="col">${esc(condition.column)}</th><th scope="col">신고 전화</th></tr></thead><tbody>${clinics.map(c => `<tr><th scope="row"><a href="${clinicUrl(c)}">${esc(c.name)}</a><small>${esc(c.type)}</small></th><td data-label="${showDistrict ? '지역' : '동'}">${esc(showDistrict ? [c.city, c.dong].filter(Boolean).join(' ') : (c.dong || c.city))}</td><td data-label="${esc(condition.column)}" class="condition-evidence">${esc(condition.detail(c))}</td><td data-label="전화">${phoneCell(c)}</td></tr>`).join('')}</tbody></table></div>`;
}

const shareButton = () => `<button type="button" class="btn small share-button" data-share>${icon('link')}링크 공유</button>`;

function definitionBlock(condition, snapshot) {
  const d = condition.definition;
  return `<section class="section prose condition-definition" aria-labelledby="condition-definition"><h2 id="condition-definition">이 목록의 기준</h2><ul><li><strong>포함 조건:</strong> ${esc(d.countDefinition)}.</li><li><strong>자료가 확인되는 기관:</strong> ${esc(d.knownDefinition)}.</li><li><strong>해석할 때:</strong> ${esc(d.limitation)}</li><li><strong>원자료:</strong> <a href="${SOURCE_URL}" rel="noopener" target="_blank">건강보험심사평가원 「전국 병의원 및 약국 현황」</a> ${esc(snapshot)} 기준. 같은 기준을 쓰는 <a href="/reports/national-data-coverage/">전국 데이터 수록 현황</a>과 숫자가 일치합니다.</li></ul><p class="subtle-note">가나다순 목록이며 추천·순위가 아닙니다. 광고나 비용을 받고 목록에 넣거나 빼지 않습니다. 등록시간은 실시간 진료 여부가 아니므로 방문 전 전화로 확인해 주세요.</p></section>`;
}

function districtPage(group, condition, groups, {snapshot}) {
  const {sido, city, total, known, matches} = group;
  const unknown = total - known;
  const others = groups.filter(g => g.sidoCode === group.sidoCode && g.slug === group.slug && g.route && g.cityCode !== group.cityCode);
  const lead = `${sido} ${city} 치과 ${fmt(total)}곳 중 ${fmt(matches.length)}곳(${percent(matches.length, total)})에 ${condition.phrase}.`;
  const missing = condition.slug === 'specialist'
    ? `전문의 인원 자료가 없는 ${fmt(unknown)}곳은 목록에 없으며, 전문의가 없다는 뜻이 아닙니다.`
    : `이 조건을 판단할 시간 자료가 없는 ${fmt(unknown)}곳은 목록에 없으며, 휴진한다는 뜻이 아닙니다.`;
  const findLink = condition.findParam ? `<a class="text-link" href="/find/?sido=${group.sidoCode}&amp;city=${group.sidoCode}%3A${group.cityCode}&amp;${condition.findParam}=1">다른 조건과 함께 좁히기 ${icon('arrow')}</a>` : '';
  return `<div class="wrap"><div class="page-intro"><div class="pill-row"><span class="pill">심평원 ${esc(snapshot)} 기준</span><span class="pill neutral">가나다순 · 순위 없음</span></div><h1>${esc(city)} ${esc(condition.name)} 치과 ${fmt(matches.length)}곳</h1><p>${esc(sido)} ${esc(city)}에서 ${esc(condition.phrase.replace(/습니다$/, '는 치과'))} 목록입니다. 요일별 등록시간과 신고 전화를 함께 보여드립니다.</p></div>
  <div class="answer-box"><p class="answer-lead">${esc(lead)}</p><p>${esc(missing)} 등록시간은 실시간 진료 여부가 아니므로 방문 전 전화로 확인해 주세요.</p><div class="answer-actions">${shareButton()}${findLink}</div></div>
  <section class="section" aria-labelledby="condition-list"><h2 id="condition-list">${esc(city)} ${esc(condition.name)} 치과 목록</h2>${conditionTable(condition, matches, {caption: `${sido} ${city} ${condition.name} 치과 ${matches.length}곳, 가나다순`})}<p class="subtle-note">기관명을 누르면 주소·출처별 진료시간·등록 인력을 볼 수 있습니다. 표를 좌우로 넘겨 모든 열을 볼 수 있습니다.</p></section>
  <section class="section" aria-labelledby="condition-more"><h2 id="condition-more">${esc(city)} 치과 더 보기</h2>${districtConditionLinks(groups, group.sidoCode, group.cityCode, {current: group.slug})}<p><a class="text-link" href="/regions/${group.sidoCode}/${group.cityCode}/">${esc(city)} 치과 ${fmt(total)}곳 전체 목록 ${icon('arrow')}</a></p>${others.length ? `<h3>${esc(sido)} 다른 시·군·구의 ${esc(condition.name)} 치과</h3><div class="condition-links">${others.map(g => `<a href="${g.route}">${esc(g.city)} ${fmt(g.matches.length)}곳</a>`).join('')}</div>` : ''}<p><a class="text-link" href="${conditionHubRoute(condition.slug)}">전국 ${esc(condition.name)} 치과 현황 ${icon('arrow')}</a></p></section>
  ${definitionBlock(condition, snapshot)}</div>`;
}

function hubPage(condition, clinics, groups, regions, {snapshot}) {
  const matches = clinics.filter(condition.test).sort(byName);
  const lead = `심평원 ${snapshot} 자료에서 ${condition.phrase.replace(/습니다$/, '는')} 치과는 전국 ${fmt(clinics.length)}곳 중 ${fmt(matches.length)}곳(${percent(matches.length, clinics.length)})입니다.`;
  const known = clinics.filter(condition.known).length;
  const context = condition.slug === 'specialist'
    ? `전문의 인원 자료가 없는 ${fmt(clinics.length - known)}곳은 포함하지 않았습니다.`
    : `심평원 자료에 진료시간이 등록된 치과 자체가 일부라서, 등록이 없다고 ${condition.name}를 하지 않는다는 뜻은 아닙니다. 실제로 진료하는 곳은 이보다 많을 수 있습니다.`;
  const sidoRows = regions.map(r => {
    const count = r.clinics.filter(condition.test).length;
    return `<tr><th scope="row"><a href="/regions/${r.sidoCode}/">${esc(r.name)}</a></th><td>${fmt(r.count)}곳</td><td>${fmt(count)}곳</td><td>${percent(count, r.count)}</td></tr>`;
  }).join('');
  const districts = regions.map(r => {
    const own = groups.filter(g => g.sidoCode === r.sidoCode && g.slug === condition.slug && g.route);
    return own.length ? `<div class="condition-sido"><h3>${esc(r.name)}</h3><div class="condition-links">${own.map(g => `<a href="${g.route}">${esc(g.city)} ${fmt(g.matches.length)}곳</a>`).join('')}</div></div>` : '';
  }).join('');
  const fullList = matches.length <= HUB_FULL_LIST_LIMIT
    ? `<section class="section" aria-labelledby="hub-full-list"><h2 id="hub-full-list">전국 ${esc(condition.name)} 치과 ${fmt(matches.length)}곳 전체 목록</h2>${regions.map(r => { const own = matches.filter(c => c.sidoCode === r.sidoCode); return own.length ? `<h3 class="condition-group-title">${esc(r.name)} <small>${fmt(own.length)}곳</small></h3>${conditionTable(condition, own, {caption: `${r.name} ${condition.name} 치과 ${own.length}곳`, showDistrict: true})}` : ''; }).join('')}</section>`
    : '';
  return `<div class="wrap"><div class="page-intro"><div class="pill-row"><span class="pill">심평원 ${esc(snapshot)} 기준</span><span class="pill neutral">지역별 집계 · 순위 없음</span></div><h1>${esc(condition.name)} 치과, 전국 ${fmt(matches.length)}곳</h1><p>${esc(condition.keyword)}를 지역별로 찾을 수 있게 시도·시·군·구별로 정리했습니다.</p></div>
  <div class="answer-box"><p class="answer-lead">${esc(lead)}</p><p>${esc(context)} 등록시간은 실시간 진료 여부가 아니므로 방문 전 전화로 확인해 주세요.</p><div class="answer-actions">${shareButton()}${condition.findParam ? `<a class="text-link" href="/find/?${condition.findParam}=1">조건 검색에서 보기 ${icon('arrow')}</a>` : ''}</div></div>
  <section class="section" aria-labelledby="hub-districts"><h2 id="hub-districts">시·군·구별 ${esc(condition.name)} 치과</h2><p class="subtle-note">해당 치과가 ${MIN_DISTRICT_MATCHES}곳 이상인 시·군·구만 별도 목록으로 엽니다. 그보다 적은 지역은 ${condition.findParam ? '조건 검색이나 ' : ''}각 지역 전체 목록에서 확인하세요.</p>${districts || '<p class="empty">별도 목록을 열 만큼 해당 치과가 모인 시·군·구가 없습니다.</p>'}</section>
  ${fullList}
  <section class="section" aria-labelledby="hub-sido"><h2 id="hub-sido">시도별 집계</h2><div class="table-scroll"><table class="simple-table"><caption class="sr-only">시도별 ${esc(condition.name)} 치과 수. 비율의 분모는 각 시도의 전체 치과 수.</caption><thead><tr><th scope="col">시도(원자료 코드)</th><th scope="col">전체 치과</th><th scope="col">${esc(condition.name)}</th><th scope="col">전체 대비</th></tr></thead><tbody>${sidoRows}</tbody></table></div><p class="subtle-note">원자료 시도코드 순서입니다. 비율은 자료 수록 범위의 차이를 함께 반영하므로 지역의 진료 여건 순위로 읽지 않습니다.</p></section>
  ${definitionBlock(condition, snapshot)}</div>`;
}

const itemList = clinicItemList;

/** shareImages: route → share-card path for cards whose PNG exists (build.mjs shareCardMap). District pages reuse their hub's card. */
export function registerConditionPages({page, clinics, regions, domain, snapshotDate, shareImages = new Map()}) {
  if (typeof page !== 'function' || !Array.isArray(clinics) || !Array.isArray(regions)) throw new TypeError('registerConditionPages needs page(), clinics and regions');
  const snapshot = snapshotDate;
  const groups = districtConditionGroups(regions);
  const totals = Object.fromEntries(CONDITIONS.map(c => [c.slug, clinics.filter(c.test).length]));
  page('/conditions/', {
    title: '조건별 치과 찾기 | 야간·토요일·일요일 진료, 치과전문의',
    description: `야간·토요일·일요일 진료시간이 등록된 치과와 치과전문의가 등록된 치과를 시·군·구별로 찾습니다. 심평원 ${snapshot} 기준 등록 자료이며 추천 순위가 아닙니다.`,
    current: 'conditions', breadcrumb: [{label: '조건별 치과'}],
    body: `<div class="wrap"><div class="page-intro"><div class="pill-row"><span class="pill">심평원 ${esc(snapshot)} 기준</span></div><h1>조건별로 치과 찾기</h1><p>퇴근 후·주말에 갈 수 있는지, 전문의가 등록되어 있는지부터 확인하세요. 지역을 고르면 해당 치과의 등록시간과 전화번호를 바로 볼 수 있습니다.</p></div><div class="condition-hub-grid">${CONDITIONS.map(c => `<a class="condition-hub-card" href="${conditionHubRoute(c.slug)}"><span class="mini-label">${esc(c.titleSuffix)}</span><strong>${esc(c.name)} 치과</strong><span class="condition-hub-count">전국 ${fmt(totals[c.slug])}곳</span><span class="text-link">시·군·구별 보기 ${icon('arrow')}</span></a>`).join('')}</div><div class="source-banner">${icon('source')}<div><strong>등록 자료로 찾는 조건입니다.</strong><p>심평원 자료에 시간이 등록된 치과는 전국의 일부입니다. 목록에 없다고 진료하지 않는 것이 아니며, 목록에 있어도 현재 시간이 바뀌었을 수 있습니다.</p></div></div></div>`,
  });
  for (const condition of CONDITIONS) {
    const route = conditionHubRoute(condition.slug);
    const n = totals[condition.slug];
    page(route, {
      title: `${condition.keyword} 전국 ${fmt(n)}곳 | 시·군·구별 ${condition.titleSuffix}`,
      description: `심평원 ${snapshot} 자료에서 ${condition.phrase.replace(/습니다$/, '는')} 치과 ${fmt(n)}곳을 시도·시·군·구별로 정리했습니다. 등록 정보이며 실시간 진료 여부와 추천 순위가 아닙니다.`,
      current: 'conditions', breadcrumb: [{label: '조건별 치과', url: '/conditions/'}, {label: condition.name}],
      schema: n <= HUB_FULL_LIST_LIMIT ? [itemList(domain, route, `전국 ${condition.keyword} ${n}곳`, clinics.filter(condition.test).sort(byName))] : [],
      body: hubPage(condition, clinics, groups, regions, {snapshot}),
    });
  }
  for (const group of groups) {
    if (!group.route) continue;
    const condition = conditionBySlug(group.slug);
    page(group.route, {
      title: `${group.sido} ${group.city} ${condition.name} 치과 ${fmt(group.matches.length)}곳 | ${condition.titleSuffix}`,
      description: `${group.sido} ${group.city} 치과 ${fmt(group.total)}곳 중 심평원 ${snapshot} 자료에 ${condition.phrase.replace(/습니다$/, '는')} ${fmt(group.matches.length)}곳의 가나다순 목록입니다. 등록시간과 신고 전화를 함께 보여주며 현재 진료 여부는 방문 전 확인이 필요합니다.`,
      current: 'conditions',
      breadcrumb: [{label: '지역별 보기', url: '/regions/'}, {label: group.sido, url: `/regions/${group.sidoCode}/`}, {label: group.city, url: `/regions/${group.sidoCode}/${group.cityCode}/`}, {label: condition.name}],
      schema: [itemList(domain, group.route, `${group.sido} ${group.city} ${condition.name} 치과 ${group.matches.length}곳`, group.matches)],
      ogImage: shareImages.get(conditionHubRoute(condition.slug)),
      body: districtPage(group, condition, groups, {snapshot}),
    });
  }
  return {groups, totals, districtPages: groups.filter(g => g.route).length};
}
