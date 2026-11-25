import test from 'node:test';
import assert from 'node:assert/strict';
import {clinicActionLinks, clinicQuickActions, naverPlaceLink} from '../scripts/clinic-actions.mjs';

const clinic = (extra = {}) => ({id: 'c-0123456789ab', name: '검증치과의원', city: '양산시', address: '경상남도 양산시 양산역로 71, 8층', phone: '055-364-7600', website: '', ...extra});
const asset = (kind, url, ownership) => ({kind, url, ownership});

test('verified place link becomes a mobile-friendly entry link; unknown shapes stay as given', () => {
  assert.equal(naverPlaceLink('https://pcmap.place.naver.com/hospital/11736894/home?from=map'), 'https://map.naver.com/p/entry/place/11736894');
  assert.equal(naverPlaceLink('https://m.place.naver.com/place/1234567/home'), 'https://map.naver.com/p/entry/place/1234567');
  assert.equal(naverPlaceLink('https://naver.me/abc'), 'https://naver.me/abc');
});

test('order is call, map, hours, homepage, booking and only active links are used', () => {
  const record = {assets: [asset('naverMap', 'https://pcmap.place.naver.com/hospital/11736894/home', 'official'), asset('website', 'https://candidate.example/', 'candidate'), asset('booking', 'https://booking.naver.com/booking/13/bizes/1', 'linked')]};
  const links = clinicActionLinks(clinic(), record);
  assert.deepEqual(links.map(l => l.kind), ['tel', 'map', 'hours', 'booking'], 'candidate homepage is not offered');
  assert.equal(links[0].href, 'tel:0553647600');
  assert.equal(links[1].label, '네이버지도');
});

test('without a verified place the map link is an honest name/address search', () => {
  const links = clinicActionLinks(clinic({phone: '전화 없음', website: 'www.registered.example'}), {assets: []});
  assert.deepEqual(links.map(l => l.kind), ['map', 'hours', 'homepage']);
  assert.equal(links[0].label, '지도에서 찾기');
  assert.match(links[0].href, /^https:\/\/map\.naver\.com\/p\/search\//);
  assert.equal(links[2].href, 'https://www.registered.example/');
  assert.equal(links[2].sub, 'registered.example');
});

test('markup escapes values and tags every hand-off for measurement', () => {
  const html = clinicQuickActions(clinic({name: '<b>"치과"</b>'}), {assets: [asset('website', 'https://ok.example/?a=1&b=2', 'official')]});
  assert.doesNotMatch(html, /<b>"치과"/);
  assert.match(html, /href="https:\/\/ok\.example\/\?a=1&amp;b=2" target="_blank" rel="noopener nofollow" data-outbound="homepage" data-clinic="c-0123456789ab"/);
  assert.match(html, /data-outbound="tel"/);
  assert.match(html, /data-share data-outbound="share"/);
  assert.doesNotMatch(html, /href="#hours"[^>]*data-outbound/);
  assert.match(html, /예약을 중개하지 않으며/);
});
