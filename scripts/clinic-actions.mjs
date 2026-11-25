// The first thing a patient needs on a clinic page: call, find it on a map, check hours, open its own site.
// Only links the inventory already treats as active (official / linked) or the clinic's registered homepage are used;
// candidate links stay disabled exactly as in the asset panel. Every hand-off carries data-outbound/data-clinic so
// click measurement can hook in without changing this markup.
import {esc, singlePhone, safeWebsite} from '../src/shared.mjs';
import {assetUrl} from './clinic-assets.mjs';
import {safeGeneratedSearchUrl} from './naver-hours-coverage.mjs';

const ACTIVE = new Set(['official', 'linked']);
const active = (record, kind) => (record?.assets ?? []).find(a => a.kind === kind && ACTIVE.has(a.ownership) && assetUrl(a.url)) ?? null;
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** A verified Naver place link opens the same place in the app or mobile web instead of the desktop iframe page. */
export function naverPlaceLink(url) {
  const id = String(url ?? '').match(/(?:place\.naver\.com\/(?:[a-z]+)|map\.naver\.com\/p\/entry\/place|map\.naver\.com\/v5\/entry\/place)\/(\d{4,})/)?.[1];
  return id ? `https://map.naver.com/p/entry/place/${id}` : assetUrl(url);
}

/** Pure: the ordered hand-offs for one clinic. */
export function clinicActionLinks(clinic, record) {
  const links = [];
  const tel = singlePhone(clinic.phone);
  if (tel) links.push({kind: 'tel', label: '전화', sub: clinic.phone, href: `tel:${tel}`, primary: true});
  const place = active(record, 'naverMap');
  if (place) links.push({kind: 'map', label: '네이버지도', sub: '위치·길찾기', href: naverPlaceLink(place.url), external: true});
  else {
    const search = safeGeneratedSearchUrl(clinic);
    if (search) links.push({kind: 'map', label: '지도에서 찾기', sub: '이름·주소로 검색', href: search, external: true});
  }
  links.push({kind: 'hours', label: '진료시간', sub: '출처별 확인', href: '#hours'});
  const site = active(record, 'website')?.url ?? safeWebsite(clinic.website);
  const siteUrl = site ? assetUrl(site) : null;
  if (siteUrl) links.push({kind: 'homepage', label: '홈페이지', sub: host(siteUrl), href: siteUrl, external: true});
  const booking = active(record, 'booking');
  if (booking) links.push({kind: 'booking', label: '예약 페이지', sub: '기관이 연결한 화면', href: assetUrl(booking.url), external: true});
  return links;
}

export function clinicQuickActions(clinic, record) {
  const links = clinicActionLinks(clinic, record);
  const item = l => `<a class="quick-action${l.primary ? ' primary' : ''}" href="${esc(l.href)}"${l.external ? ' target="_blank" rel="noopener nofollow"' : ''}${l.kind === 'hours' ? '' : ` data-outbound="${l.kind}" data-clinic="${esc(clinic.id)}"`}><strong>${esc(l.label)}</strong><small>${esc(l.sub)}</small></a>`;
  return `<nav class="quick-actions" aria-label="${esc(clinic.name)} 바로가기">${links.map(item).join('')}<button type="button" class="quick-action" data-share data-outbound="share" data-clinic="${esc(clinic.id)}"><strong>공유</strong><small>링크 보내기</small></button></nav><p class="quick-actions-note">전화번호·진료시간은 등록·관찰 시점의 자료입니다. 방문 전 기관에 확인해 주세요. 치과데이터랩은 예약을 중개하지 않으며 링크로 비용을 받지 않습니다.</p>`;
}
