import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetInventory, channelFromHref, LINKED_CHANNEL_MAX_CLINICS, OWNERSHIP } from '../scripts/clinic-assets.mjs';
import { assetItem, PENDING_REVIEW_LABEL } from '../scripts/clinic-assets-pages.mjs';

const metadata = { snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:00:00Z' };
const verifiedAt = '2026-11-26T12:00:00Z';
const clinic = (id, phone = '031-123-4567') => ({ id, name: '대조치과의원', typeCode: '51', sido: '경기', city: '양주시', address: '경기도 양주시 검증로 1', phone, website: null });
const check = (overrides = {}) => ({
  url: 'https://clinic.example.com/', finalUrl: 'https://clinic.example.com/', checkedAt: verifiedAt, clinicIds: ['a'], status: 'read', httpStatus: 200,
  sourceType: 'candidate_homepage', bodySha256: 'abc', datasetPhoneCount: 1, hostClinicCount: 1,
  matches: { a: { name: true, phone: true, address: false } }, links: [], ...overrides,
});
const build = (checks, clinics = [clinic('a')]) => buildAssetInventory(clinics, { ...metadata, crawl: { results: checks } });
const channels = (result, id = 'a') => result.records.find(r => r.clinicId === id).assets.filter(a => a.kind !== 'website').map(a => [a.kind, a.url, a.ownership, a.linkable]);

test('channelFromHref reduces an href to the profile, channel or place it names, or nothing', () => {
  const cases = [
    ['https://blog.naver.com/dentiskin9/222764937194', 'https://blog.naver.com/dentiskin9'],
    ['https://m.blog.naver.com/PostView.naver?blogId=drkimsdent&logNo=223141312937', 'https://blog.naver.com/drkimsdent'],
    ['https://blog.naver.com/prologue/PrologueList.naver?blogId=x', null],
    ['https://www.instagram.com/greatrootdc/', 'https://www.instagram.com/greatrootdc'],
    ['https://www.instagram.com/p/Cxyz/', null],
    ['https://www.instagram.com/reel/Cxyz/', null],
    ['https://www.youtube.com/@miso_dental', 'https://www.youtube.com/@miso_dental'],
    ['https://m.youtube.com/channel/UCvUopFYP-4s3J8xC_HyDdKA', 'https://www.youtube.com/channel/UCvUopFYP-4s3J8xC_HyDdKA'],
    ['https://www.youtube.com/watch?v=abc', null],
    ['https://youtu.be/abc', null],
    ['https://pf.kakao.com/_xnxdawb/chat', 'https://pf.kakao.com/_xnxdawb'],
    ['https://m.booking.naver.com/booking/13/bizes/563632/items/4034248?area=pll', 'https://booking.naver.com/booking/13/bizes/563632'],
    ['https://map.naver.com/p/entry/place/1350995313', 'https://map.naver.com/p/entry/place/1350995313'],
    ['https://m.place.naver.com/hospital/1350995313/review/visitor', 'https://map.naver.com/p/entry/place/1350995313'],
    ['https://map.naver.com/p/search/%EC%B9%98%EA%B3%BC/place/1789426620', null], // search results are not a place identity
    ['https://naver.me/abc', null],
    ['https://place.map.kakao.com/683745703', 'https://place.map.kakao.com/683745703'],
    ['https://map.kakao.com/link/map/683745703', 'https://place.map.kakao.com/683745703'],
    ['https://map.kakao.com/', null],
    ['https://map.kakao.com/link/search/%EC%B9%98%EA%B3%BC', null],
    ['https://www.facebook.com/rodendentalgroup', 'https://www.facebook.com/rodendentalgroup'],
    ['https://www.facebook.com/profile.php?id=1', null],
    ['https://www.facebook.com/sharer/sharer.php?u=x', null],
    ['https://linktr.ee/x', null],
    ['https://other-clinic.example.com/', null],
    ['not a url', null],
  ];
  for (const [href, expected] of cases) assert.equal(channelFromHref(href)?.url ?? null, expected, href);
  assert.equal(channelFromHref('https://blog.naver.com/dentiskin9/1').kind, 'naverBlog');
  assert.equal(channelFromHref('https://map.kakao.com/link/map/683745703').kind, 'kakaoMap');
});

test('profiles linked from a verified homepage become linked, linkable channels; posts and videos stay candidates', () => {
  const result = build([check({ links: [
    { kind: 'instagram', url: 'https://www.instagram.com/daejo_dental/' },
    { kind: 'naverBlog', url: 'https://blog.naver.com/daejo/223000000001' },
    { kind: 'youtube', url: 'https://youtu.be/abc' },
    { kind: 'booking', url: 'https://m.booking.naver.com/booking/13/bizes/563632/items/1?area=pll' },
    { kind: 'naverMap', url: 'https://map.naver.com/p/entry/place/1350995313' },
    { kind: 'other', url: 'https://directory.example.net/listing/1' },
  ] })]);
  assert.deepEqual(channels(result).sort(), [
    ['booking', 'https://booking.naver.com/booking/13/bizes/563632', 'linked', true],
    ['instagram', 'https://www.instagram.com/daejo_dental', 'linked', true],
    ['naverBlog', 'https://blog.naver.com/daejo', 'linked', true],
    ['naverMap', 'https://map.naver.com/p/entry/place/1350995313', 'linked', true],
    ['other', 'https://directory.example.net/listing/1', 'candidate', false],
    ['youtube', 'https://youtu.be/abc', 'candidate', false],
  ].sort());
  const blog = result.records[0].assets.find(a => a.kind === 'naverBlog');
  assert.equal(blog.bodyStatus, 'not_read');
  assert.deepEqual(blog.evidenceUrls, ['https://clinic.example.com/']);
  assert.deepEqual(blog.identityEvidence.map(x => x.field), ['name', 'phone', 'officialLink']);
  assert.match(blog.identityEvidence.at(-1).value, /원래 href: https:\/\/blog\.naver\.com\/daejo\/223000000001/);
  const prov = blog.provenance.find(p => p.type === 'verified_homepage_channel');
  assert.deepEqual(prov, { type: 'verified_homepage_channel', sourceType: 'candidate_homepage', href: 'https://blog.naver.com/daejo/223000000001', bodySha256: 'abc', linkedByClinics: 1, checkedAt: verifiedAt });
  assert.match(blog.notes, /채널 페이지 본문은 읽지 않았으며/);
  assert.equal(result.summary.byOwnership.linked, 4);
  // Rendering: live link, "기관 페이지에서 연결" pill, no pending label.
  const html = assetItem(blog);
  assert.match(html, /href="https:\/\/blog\.naver\.com\/daejo"/);
  assert(html.includes(OWNERSHIP.linked));
  assert(!html.includes(PENDING_REVIEW_LABEL));
});

test('an unverified homepage donates nothing beyond candidates, whatever the href looks like', () => {
  const links = [{ kind: 'instagram', url: 'https://www.instagram.com/daejo_dental/' }];
  // name only
  assert.deepEqual(channels(build([check({ links, matches: { a: { name: true, phone: false, address: false } } })])), []);
  // name + phone but a directory-shaped page: candidate homepages donate no hrefs at all until verified
  assert.deepEqual(channels(build([check({ links, datasetPhoneCount: 3 })])), []);
  // name + phone on a linked-homepage scan (not the candidate pipeline) keeps today's behaviour
  assert.deepEqual(channels(build([check({ links, sourceType: 'discovered_homepage' })])), [['instagram', 'https://www.instagram.com/daejo_dental/', 'candidate', false]]);
  // not read
  assert.deepEqual(channels(build([check({ links, status: 'blocked', httpStatus: 403 })])), []);
});

test('a channel that more than two verified homepages link is a group channel and stays a candidate', () => {
  const links = [{ kind: 'instagram', url: 'https://www.instagram.com/brand_dental/' }];
  const site = n => `https://clinic${n}.example.com/`;
  const checks = n => Array.from({ length: n }, (_, i) => check({ url: site(i), finalUrl: site(i), clinicIds: [`c${i}`], matches: { [`c${i}`]: { name: true, phone: true } }, links }));
  const clinics = n => Array.from({ length: n }, (_, i) => clinic(`c${i}`, `031-000-000${i}`));
  assert.equal(LINKED_CHANNEL_MAX_CLINICS, 2);
  const two = build(checks(2), clinics(2));
  assert.deepEqual(channels(two, 'c0'), [['instagram', 'https://www.instagram.com/brand_dental', 'linked', true]]);
  assert.deepEqual(channels(two, 'c1'), [['instagram', 'https://www.instagram.com/brand_dental', 'linked', true]]);
  const three = build(checks(3), clinics(3));
  for (const id of ['c0', 'c1', 'c2']) {
    assert.deepEqual(channels(three, id), [['instagram', 'https://www.instagram.com/brand_dental/', 'candidate', false]], id);
    const asset = three.records.find(r => r.clinicId === id).assets.find(a => a.kind === 'instagram');
    assert.match(asset.notes, /3개 기관의 검증된 홈페이지가 같은 채널을 연결/);
    assert.equal(asset.provenance.find(p => p.type === 'homepage_href').sharedByClinics, 3);
  }
  // Only verified homepages count: two verified plus one unverified page linking the same profile is still two.
  const mixed = build([...checks(2), check({ url: site(9), finalUrl: site(9), clinicIds: ['c9'], matches: { c9: { name: true, phone: false } }, links })], [...clinics(2), clinic('c9', '031-999-9999')]);
  assert.equal(channels(mixed, 'c0')[0][2], 'linked');
  assert.deepEqual(channels(mixed, 'c9'), []);
});

test('two institutions sharing one verified two-clinic homepage both get its channels', () => {
  const result = build([check({ clinicIds: ['a', 'b'], datasetPhoneCount: 2, matches: { a: { name: true, phone: true }, b: { name: true, phone: true } }, links: [{ kind: 'kakaoChannel', url: 'https://pf.kakao.com/_abc/chat' }] })], [clinic('a'), clinic('b', '031-765-4321')]);
  assert.deepEqual(channels(result, 'a'), [['kakaoChannel', 'https://pf.kakao.com/_abc', 'linked', true]]);
  assert.deepEqual(channels(result, 'b'), [['kakaoChannel', 'https://pf.kakao.com/_abc', 'linked', true]]);
});
