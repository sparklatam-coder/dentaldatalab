import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAssetInventory, loadAssetInventory, assetUrl, detectKind } from '../scripts/clinic-assets.mjs';
import { clinicAssetsPanel, registerClinicAssetsPages, observedWebsiteRow } from '../scripts/clinic-assets-pages.mjs';
import { buildNaverHoursCoverage } from '../scripts/naver-hours-coverage.mjs';
import { nationalHoursPanel, HOURS_STAGES } from '../scripts/naver-hours-pages.mjs';
import { esc, SOURCE_URL } from '../src/shared.mjs';

const metadata = { snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:00:00Z' };
const earlier = '2026-10-31T12:00:00Z', later = '2026-11-01T12:00:00Z';
const clinic = (id = 'clinic-a', overrides = {}) => ({
  id, name: '대조치과의원', typeCode: '51', sido: '경기', city: '양주시',
  address: '경기도 양주시 검증로 1', phone: '031-123-4567', website: null, ...overrides,
});
const source = 'https://clinic.example.com/';
const proof = (url = source) => [
  { field: 'name', value: '대조치과의원', sourceUrl: url },
  { field: 'phone', value: '031-123-4567', sourceUrl: url },
];
const asset = (overrides = {}) => ({
  kind: 'website', url: source, ownership: 'official', bodyStatus: 'read',
  evidenceUrls: [source], identityEvidence: proof(), checkedAt: earlier,
  notes: '본문에 표시된 기관명과 전화번호 대조.', ...overrides,
});
const batch = (assets = [], overrides = {}) => ({
  checkedAt: later,
  records: [{ clinicId: 'clinic-a', name: '대조치과의원', checkedAt: later, assets, searches: [], ...overrides }],
});
function inventory(clinics = [clinic()], options = {}) {
  return buildAssetInventory(clinics, { ...metadata, ...options });
}
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return value;
}
function render(result, options = {}) {
  const files = new Map(), pages = new Map();
  registerClinicAssetsPages({
    inventory: result, assetVersion: 'test-version', ...options,
    page: (route, options) => { assert(!pages.has(route)); pages.set(route, options); },
    put: (path, value) => { assert(!files.has(path)); files.set(path, value); },
  });
  return { files, pages };
}

test('institution labels follow registered type codes, and missing URLs do not assert channel absence', () => {
  const result = inventory([
    clinic('clinic-a', { name: '이름에병원이있어도치과의원', typeCode: '51' }),
    clinic('clinic-b', { name: '이름에의원이있어도치과병원', typeCode: '41' }),
    clinic('clinic-c', { name: '종별미상치과병원', typeCode: '99', website: 'http://' }),
  ]);
  assert.deepEqual(result.records.map(r => r.type), ['치과의원', '치과병원', '종별 미확인']);
  assert.deepEqual(result.summary.byType, { 치과병원: 1, 치과의원: 1 });
  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.withoutAssets, 3);
  assert.equal(result.summary.registeredWebsiteFields, 1);
  assert.equal(result.summary.validRegisteredUrls, 0);
  const panel = clinicAssetsPanel(result.records[0]);
  assert.match(panel, /홈페이지나 SNS가 없다는 의미는 아닙니다/);
  assert.match(panel, /네이버지도 본문 조사 전/);
  assert.match(panel, /심평원 종별 코드 51/);
  assert(panel.includes(SOURCE_URL));
});

test('the separate website row includes only safe confirmed or institution-linked websites with evidence grade and observation date', () => {
  const clinics = freezeDeep([clinic('clinic-a', { website: 'https://registered.example.com/' })]);
  const result = inventory(clinics, { batches: [batch([
    asset({ url: 'https://verified.example.com/' }),
    asset({ url: 'https://linked.example.com/', ownership: 'linked', bodyStatus: 'not_read', checkedAt: later,
      identityEvidence: [{ field: 'officialLink', value: '기관 페이지에 표시된 URL', sourceUrl: source }] }),
    asset({ url: 'https://candidate.example.com/', ownership: 'candidate' }),
    asset({ url: 'https://outside.example.com/', ownership: 'third_party' }),
    asset({ url: 'https://blog.naver.com/clinic-example', kind: 'naverBlog' }),
    asset({ url: 'https://blog.naver.com/misclassified-example', kind: 'website' }),
  ])] });
  const record = freezeDeep(result.records[0]), before = JSON.stringify({ clinics, record });
  const html = observedWebsiteRow(record);
  assert.match(html, /<th scope="row">웹에서 확인한 홈페이지<\/th>/);
  assert(html.includes('href="https://verified.example.com/"'));
  assert(html.includes('href="https://linked.example.com/"'));
  assert.match(html, /본문·기관 대조 · 본문 읽음 · 2026-10-31 확인/);
  assert.match(html, /기관 페이지에서 연결 · 대상 본문 미확인 · 2026-11-01 확인/);
  assert(html.includes('href="#marketing-assets"'));
  for (const url of ['registered.example.com', 'candidate.example.com', 'outside.example.com', 'blog.naver.com']) assert(!html.includes(url));
  assert(!html.includes('data-source='), 'Web observations must not use the HIRA registered-field source button');
  assert.equal(observedWebsiteRow(undefined), '');
  assert.equal(observedWebsiteRow({ assets: [asset({ url: 'javascript:alert(1)' }), asset({ url: 'http://127.0.0.1/private' }), asset({ ownership: 'candidate' })] }), '');
  assert.equal(JSON.stringify({ clinics, record }), before);
  assert.equal(clinics[0].website, 'https://registered.example.com/');
  assert.equal(record.registeredWebsite, clinics[0].website);
});

test('a map-only unresearched clinic explicitly says website and SNS research is pending, and hub totals disclose candidates', () => {
  const candidate = asset({ kind: 'naverMap', url: 'https://map.naver.com/p/entry/place/123', ownership: 'candidate', bodyStatus: 'not_read' });
  const result = inventory([clinic()], { batches: [batch([candidate], { researched: false })] });
  assert.equal(result.records[0].assetCount, 1);
  const panel = clinicAssetsPanel(result.records[0]);
  assert.match(panel, /홈페이지·SNS 개별 조사 전입니다/);
  assert.match(panel, /연결 주소 미확보는 실제 부재를 뜻하지 않습니다/);
  assert.equal(observedWebsiteRow(result.records[0]), '');
  const { pages } = render(result);
  assert.match(pages.get('/clinic-assets/').body, /<small>지도 후보 포함 URL 확보<\/small>/);
  const researched = inventory([clinic()], { batches: [batch([candidate])] }).records[0];
  assert(!clinicAssetsPanel(researched).includes('홈페이지·SNS 개별 조사 전입니다'));
});

test('official and linked assertions are downgraded when required evidence is absent', () => {
  const records = [
    asset({ url: source + 'valid' }),
    asset({ url: source + 'unread', bodyStatus: 'blocked' }),
    asset({ url: source + 'no-source', evidenceUrls: [] }),
    asset({ url: source + 'name-only', identityEvidence: [proof()[0]] }),
    asset({ url: source + 'unproven-link', ownership: 'linked', bodyStatus: 'not_read' }),
    asset({
      kind: 'naverBlog', url: 'https://blog.naver.com/clinic-example', ownership: 'linked', bodyStatus: 'blocked',
      identityEvidence: [{ field: 'officialLink', value: 'https://blog.naver.com/clinic-example', sourceUrl: source }],
    }),
    asset({ url: 'https://127.0.0.1/private' }),
    asset({ url: 'https://name:password@clinic.example.com/' }),
  ];
  const result = inventory([clinic()], { batches: [batch(records)] });
  const byUrl = new Map(result.records[0].assets.map(a => [a.url, a]));
  assert.equal(byUrl.get(source + 'valid').ownership, 'official');
  for (const path of ['unread', 'no-source', 'name-only', 'unproven-link']) {
    assert.equal(byUrl.get(source + path).ownership, 'candidate', path);
  }
  const blog = byUrl.get('https://blog.naver.com/clinic-example');
  assert.equal(blog.ownership, 'linked');
  assert.equal(blog.bodyStatus, 'blocked', 'An observed link never implies its destination was read');
  assert.equal(result.records[0].assets.length, 6);
  assert.equal(result.records[0].confirmedCount, 2);
  const panel = clinicAssetsPanel(result.records[0]);
  assert.match(panel, /기관 페이지에서 연결/);
  assert.match(panel, /본문 접근 실패/);
  assert.equal(assetUrl('https://name:password@clinic.example.com/'), null);
});

test('a later manual third-party correction overrides an older official conclusion regardless of batch order', () => {
  const old = batch([asset()]);
  const correction = batch([asset({ ownership: 'third_party', checkedAt: later, notes: '외부 작성자 글로 정정.' })]);
  for (const batches of [[old, correction], [correction, old]]) {
    const result = inventory([clinic()], { batches });
    const record = result.records[0];
    assert.equal(record.assets.length, 1);
    assert.equal(record.assets[0].ownership, 'third_party');
    assert.equal(record.assets[0].checkedAt, later);
    assert.equal(record.assets[0].notes, '외부 작성자 글로 정정.');
    assert.equal(record.assetCount, 0, 'Third-party mentions are not counted as institution assets');
    assert.equal(record.confirmedCount, 0);
    assert.equal(result.summary.byOwnership.third_party, 1);
    assert.match(clinicAssetsPanel(record), /기관 소유에서 제외/);
  }
});

test('manual ownership decisions win over registration, legacy conclusions and automated matches', () => {
  const legacy = { checkedAt: later, records: [{
    clinicId: 'clinic-a', name: '대조치과의원', checkedAt: later,
    facts: [{ field: 'phone', value: '031-123-4567', sourceUrl: source }],
    channels: { website: { url: source, status: 'verified', bodyVerified: true, identityVerified: true, evidenceUrls: [source] } },
  }] };
  const crawl = { results: [{
    url: source, finalUrl: source, checkedAt: later, status: 'read', clinicIds: ['clinic-a'],
    matches: { 'clinic-a': { name: true, phone: true } }, links: [],
  }] };
  const result = inventory([clinic('clinic-a', { website: source })], {
    legacy: [legacy], crawl,
    batches: [batch([asset({ ownership: 'third_party', checkedAt: earlier })])],
  });
  assert.equal(result.records[0].assets[0].ownership, 'third_party');
  assert.equal(result.records[0].assetCount, 0);
  const automated = inventory([clinic('clinic-a', { website: source })], { crawl });
  assert.equal(automated.records[0].assets[0].ownership, 'candidate', 'Matching strings alone do not establish a site operator');
  assert.equal(automated.records[0].confirmedCount, 0);
});

test('unrelated registered domains cannot donate social links and automatic partial matches remain candidates', () => {
  const social = 'https://www.instagram.com/unrelated-or-unreviewed/';
  for (const match of [{ name: false, phone: false }, { name: true, phone: false }, { name: false, phone: true }, { name: true, phone: true }]) {
    const result = inventory([clinic('clinic-a', { website: source })], { crawl: { results: [{
      url: source, finalUrl: source, checkedAt: later, status: 'read', clinicIds: ['clinic-a'],
      matches: { 'clinic-a': match }, links: [{ kind: 'instagram', url: social }],
    }] } });
    const record = result.records[0], homepage = record.assets.find(a => a.url === source);
    assert.equal(homepage.bodyStatus, 'read');
    assert.equal(homepage.ownership, 'candidate');
    assert.equal(record.confirmedCount, 0);
    const extracted = record.assets.filter(a => a.url === social);
    assert.equal(extracted.length, match.name || match.phone ? 1 : 0, JSON.stringify(match));
    if (extracted.length) {
      assert.equal(extracted[0].ownership, 'candidate');
      assert.equal(extracted[0].bodyStatus, 'not_read');
      assert.deepEqual(extracted[0].evidenceUrls, [source]);
    }
  }
});

test('registered and discovered homepage files merge without rewriting sources, and a linked website gains only observed body status', t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'ddl-homepage-merge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'data/assets'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data/research'), { recursive: true });
  const discoveredUrl = 'https://discovered.example.com/', social = 'https://www.instagram.com/discovered-example/';
  const oldCheck = { url: source, finalUrl: source, checkedAt: earlier, status: 'read', clinicIds: ['clinic-a'], matches: { 'clinic-a': { name: false, phone: false } }, links: [] };
  const newCheck = { url: discoveredUrl, finalUrl: discoveredUrl, checkedAt: later, status: 'read', clinicIds: ['clinic-a'],
    sourceType: 'discovered_homepage', bodySha256: 'observed-body', matches: { 'clinic-a': { name: true, phone: false, address: true } }, links: [{ kind: 'instagram', url: social }] };
  const linked = asset({ url: discoveredUrl, ownership: 'linked', bodyStatus: 'not_read',
    identityEvidence: [{ field: 'officialLink', value: discoveredUrl, sourceUrl: source }] });
  const fixtures = {
    'national-homepages.json': { results: [oldCheck] },
    'discovered-homepages.json': { results: [newCheck] },
    'naver-national-02.json': batch([linked]),
  };
  for (const [name, value] of Object.entries(fixtures)) fs.writeFileSync(path.join(root, 'data/assets', name), JSON.stringify(value));
  const data = freezeDeep({ ...metadata, clinics: [clinic('clinic-a', { website: source })] });
  const before = JSON.stringify(data), result = loadAssetInventory(root, data), record = result.records[0];
  assert.equal(result.summary.homepageUrlsChecked, 2);
  assert.equal(result.summary.homepageHtmlRead, 2);
  assert.deepEqual(record.homepageChecks.map(check => check.sourceType), ['registered_homepage', 'discovered_homepage']);
  assert.deepEqual(record.homepageChecks[1].matches, newCheck.matches['clinic-a']);
  const website = record.assets.find(a => a.url === discoveredUrl);
  assert.equal(website.ownership, 'linked');
  assert.equal(website.bodyStatus, 'read');
  assert.equal(website.checkedAt, later);
  assert.equal(website.notes, linked.notes);
  assert.equal(website.sourcePriority, 3);
  assert.deepEqual(website.provenance.find(p => p.type === 'homepage_body_check'), {
    type: 'homepage_body_check', sourceType: 'discovered_homepage', sourceUrl: discoveredUrl,
    checkedAt: later, bodySha256: 'observed-body', matches: newCheck.matches['clinic-a'],
  });
  const href = record.assets.find(a => a.url === social);
  assert.equal(href.ownership, 'candidate');
  assert.equal(href.bodyStatus, 'not_read');
  assert.equal(href.sourcePriority, 1);
  assert.match(clinicAssetsPanel(record), /등록 URL 점검/);
  assert.match(clinicAssetsPanel(record), /발굴한 홈페이지 점검/);
  assert.match(render(result).pages.get('/clinic-assets/').body, /네이버지도 등에서 발굴한 홈페이지도 별도로 점검합니다/);
  assert.equal(JSON.stringify(data), before);
  for (const [name, value] of Object.entries(fixtures)) assert.equal(fs.readFileSync(path.join(root, 'data/assets', name), 'utf8'), JSON.stringify(value));
});

test('homepage body refresh uses the latest positive read only, leaving failures, mismatches and curated exclusions unchanged', () => {
  const linked = asset({ ownership: 'linked', bodyStatus: 'not_read',
    identityEvidence: [{ field: 'officialLink', value: source, sourceUrl: 'https://m.place.naver.com/hospital/123/home' }] });
  const check = { url: source, finalUrl: source, status: 'read', checkedAt: later, sourceType: 'discovered_homepage',
    clinicIds: ['clinic-a'], matches: { 'clinic-a': { name: true, phone: false } }, links: [] };
  const newest = { ...check, checkedAt: '2026-11-02T12:00:00Z', matches: { 'clinic-a': { name: false, phone: true } } };
  const failed = { ...check, status: 'blocked', checkedAt: '2026-11-03T12:00:00Z' };
  for (const results of [[check, newest, failed], [failed, newest, check]]) {
    const crawl = freezeDeep({ results }), before = JSON.stringify(crawl);
    const record = inventory([clinic()], { crawl, batches: [batch([linked])] }).records[0];
    const website = record.assets.find(a => a.url === source);
    assert.equal(website.ownership, 'linked');
    assert.equal(website.bodyStatus, 'read');
    assert.equal(website.checkedAt, newest.checkedAt);
    assert.equal(website.provenance.filter(p => p.type === 'homepage_body_check').length, 1);
    assert.equal(JSON.stringify(crawl), before);
  }
  const cases = [
    { asset: linked, check: failed },
    { asset: linked, check: { ...check, matches: { 'clinic-a': { name: false, phone: false, address: true } } } },
    { asset: linked, check: { ...check, checkedAt: '2026-10-30T12:00:00Z' } },
    { asset: linked, check: { ...check, checkedAt: earlier } },
    { asset: linked, check: { ...check, checkedAt: 'invalid-date' } },
    { asset: { ...linked, ownership: 'third_party' }, check },
    { asset: asset(), check },
  ];
  for (const item of cases) {
    const record = inventory([clinic()], { crawl: { results: [item.check] }, batches: [batch([item.asset])] }).records[0];
    const website = record.assets.find(a => a.url === source);
    for (const field of ['ownership', 'bodyStatus', 'checkedAt', 'notes']) assert.equal(website[field], item.asset[field], JSON.stringify({ field, item }));
    assert(!(website.provenance??[]).some(p => p.type === 'homepage_body_check'));
  }
});

test('institutions are joined by ID and checked name, never by a same-name clinic alone', () => {
  assert.throws(() => inventory([clinic()], { batches: [batch([], { clinicId: 'other-id' })] }), /institution mismatch/i);
  assert.throws(() => inventory([clinic()], { batches: [batch([], { name: '동명 다른지점치과' })] }), /institution mismatch/i);
  assert.throws(() => inventory([clinic()], { legacy: [batch([], { name: '동명 다른지점치과' })] }), /institution mismatch/i);
  assert.throws(() => inventory([clinic()], { crawl: { results: [{ clinicIds: ['other-id'] }] } }), /Unknown crawler clinic/);
  const result = inventory([clinic(), clinic('clinic-b')], { batches: [batch([asset()])] });
  assert.equal(result.records[0].assets.length, 1);
  assert.equal(result.records[1].assets.length, 0);
});

test('unread Naver pages cannot contribute business values and non-Naver sources cannot masquerade as Naver', () => {
  const observation = { sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'blocked', fields: { phone: '0507-1234-5678' } };
  for (const bodyStatus of ['blocked', 'not_read']) {
    assert.throws(() => inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{ ...observation, bodyStatus }] })] }), /Unread Naver page/);
  }
  assert.throws(() => inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{ ...observation, sourceUrl: source, bodyStatus: 'read' }] })] }), /actual Naver Place URL/);
  const result = inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{ ...observation, fields: {} }] })] });
  assert.equal(result.summary.naverInspected, 1);
  assert.equal(result.summary.naverRead, 0);
  assert.equal(result.summary.naverWithFields, 0);
  const html = clinicAssetsPanel(result.records[0]);
  assert.match(html, /다른 출처의 값을 네이버 정보로 채우지 않았습니다/);
  assert(!html.includes('031-123-4567'), 'The registered phone is not substituted into the unread Naver table');
});

test('actual Naver observations stay separate from immutable public snapshot values', () => {
  const clinics = freezeDeep([clinic()]);
  const observations = freezeDeep([{ sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'read', fields: {
    name: '대조치과의원', phone: '0507-1234-5678', address: '경기도 양주시 검증로 1 2층', hours: { mon: '09:00~18:00' },
  }, notes: '화면에서 실제 읽은 공개 기관 정보.' }]);
  const before = JSON.stringify(clinics);
  const result = inventory(clinics, { batches: [batch([], { naverPlaceObservations: observations })] });
  assert.equal(JSON.stringify(clinics), before);
  const record = result.records[0];
  assert.equal(record.phone, '031-123-4567');
  assert.equal(record.address, '경기도 양주시 검증로 1');
  assert.equal(record.naverPlaceObservations[0].fields.phone, '0507-1234-5678');
  assert.equal(result.summary.naverRead, 1);
  assert.equal(result.summary.naverWithFields, 1);
  const html = clinicAssetsPanel(record);
  assert(html.includes('0507-1234-5678'));
  assert(html.includes('심평원 신고번호 031-123-4567'));
  assert.match(html, /값 다름 \(대표번호·안심번호 차이 가능\)/);
  assert(html.includes('09:00~18:00'));
});

test('matched Naver observations add their actual map and displayed channel URLs without claiming destination reads', () => {
  const map = 'https://m.place.naver.com/hospital/123/home';
  const fields = {
    name: '대조치과의원', phone: '031 123 4567', website: source,
    naverBlog: 'https://blog.naver.com/observed-clinic',
    youtube: 'https://www.youtube.com/@observed-clinic',
    instagram: 'https://www.instagram.com/observed_clinic/',
    booking: 'https://m.booking.naver.com/booking/13/bizes/1234',
    displayedChannelButtons: ['페이스북', '카카오톡', '홈페이지'],
    facebook: '페이스북 버튼 있음', kakaoChannel: 'www.example.com/not-an-observed-absolute-url',
  };
  const result = inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [
    { sourceUrl: map, checkedAt: later, bodyStatus: 'read', fields },
  ] })] });
  const record = result.records[0], byUrl = new Map(record.assets.map(a => [a.url, a]));
  assert.equal(record.assets.length, 6, 'Only the map and five observed absolute channel URLs are added');
  assert.equal(byUrl.get(map).kind, 'naverMap');
  assert.equal(byUrl.get(map).ownership, 'official');
  assert.equal(byUrl.get(map).bodyStatus, 'read');
  for (const field of ['website', 'naverBlog', 'youtube', 'instagram', 'booking']) {
    const channel = byUrl.get(fields[field]);
    assert(channel, field);
    assert.equal(channel.kind, field);
    assert.equal(channel.ownership, 'linked');
    assert.equal(channel.bodyStatus, 'not_read');
    assert.deepEqual(channel.evidenceUrls, [map]);
    assert(channel.identityEvidence.some(p => p.field === 'officialLink' && p.sourceUrl === map));
  }
  assert(!record.assets.some(a => ['facebook', 'kakaoChannel'].includes(a.kind)));
  assert.equal(record.phone, '031-123-4567');
});

test('name and same-city road address can identify a Naver place even when it uses a different safe-call number', () => {
  const map = 'https://m.place.naver.com/hospital/123/home';
  const result = inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{
    sourceUrl: map, checkedAt: later, bodyStatus: 'read', fields: {
      name: '대조 치과 의원', phone: '0507-1234-5678', address: '경기 양주시 검증로 1 2층', website: source,
    },
  }] })] });
  const record = result.records[0], place = record.assets.find(a => a.kind === 'naverMap');
  assert.equal(place.ownership, 'official');
  assert(place.identityEvidence.some(p => p.field === 'address'));
  assert(!place.identityEvidence.some(p => p.field === 'phone'), 'The safe-call number must not be described as matching the registered phone');
  assert.equal(record.assets.find(a => a.kind === 'website').ownership, 'linked');
  assert.equal(record.phone, '031-123-4567');
  assert.equal(record.naverPlaceObservations[0].fields.phone, '0507-1234-5678');
});

test('a read page with an unrelated or incomplete institution identity remains a candidate', () => {
  const identities = [
    { name: '다른치과의원', phone: '031-123-4567', address: '경기 양주시 검증로 1' },
    { name: '대조치과의원', phone: '031-999-9999', address: '경기 양주시 다른로 2' },
    { name: '대조치과의원' },
    { phone: '031-123-4567', address: '경기 양주시 검증로 1' },
  ];
  for (const fields of identities) {
    const result = inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{
      sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'read',
      fields: { ...fields, website: source },
    }] })] });
    assert(result.records[0].assets.every(a => a.ownership === 'candidate'), JSON.stringify(fields));
    assert.equal(result.records[0].confirmedCount, 0);
  }
});

test('same-name clinics on an identically named road in another city are not automatically matched', () => {
  for (const fields of [
    { phone: '02-999-9999', address: '서울특별시 중구 중앙로 1' },
    { phone: '031-123-4567', address: '서울특별시 중구 중앙로 1' },
    { phone: '031-123-4567', address: '경기 의정부시 중앙로 1' },
  ]) {
    const result = inventory([clinic('clinic-a', { address: '경기도 양주시 중앙로 1' })], { batches: [batch([], { naverPlaceObservations: [{
      sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'read',
      fields: { name: '대조치과의원', ...fields, website: source },
    }] })] });
    assert(result.records[0].assets.every(a => a.ownership === 'candidate'), JSON.stringify(fields));
    assert.equal(result.records[0].confirmedCount, 0, 'A matching phone does not erase an explicit different-city address');
  }
});

test('the snapshot literal 전남광주통합특별시 matches only its 전남광주 abbreviation, preserving distinct province labels', () => {
  // This tests literal source spellings, not an assertion about administrative status.
  const clinics = freezeDeep([clinic('clinic-a', {
    sido: '전남광주', city: '북구', address: '전남광주통합특별시 북구 검증로 1', phone: '062-123-4567',
  })]);
  const before = JSON.stringify(clinics);
  for (const [prefix, matched] of [['전남광주', true], ['전남광주통합특별시', true], ['광주광역시', false], ['광주', false], ['전라남도', false], ['전남', false]]) {
    const result = inventory(clinics, { batches: [batch([], { naverPlaceObservations: [{
      sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'read', fields: {
        name: '대조치과의원', address: `${prefix} 북구 검증로 1 2층`,
        phone: matched ? '0507-1234-5678' : '062-123-4567', website: source,
      },
    }] })] });
    const record = result.records[0], observed = record.naverPlaceObservations[0];
    assert.equal(observed.identityMatch, matched, prefix);
    assert.equal(observed.identityComparison.sameJurisdiction, matched, prefix);
    assert.equal(observed.identityComparison.addressMatch, matched, prefix);
    assert.equal(record.assets.find(a => a.kind === 'naverMap').ownership, matched ? 'official' : 'candidate', prefix);
    assert.equal(record.address, clinics[0].address);
    assert.equal(record.sido, clinics[0].sido);
  }
  assert.equal(JSON.stringify(clinics), before);
});

test('manual name-variant review requires a reason and matching regional address or phone evidence', () => {
  const reason = '공공 등록명과 화면의 띄어쓰기 외 명칭 차이를 주소·전화와 함께 수동 대조함.';
  const reviewed = { confirmed: true, reason };
  const cases = [
    { fields: { address: '경기 양주시 검증로 1 2층', phone: '0507-1234-5678' }, review: reviewed, matched: true },
    { fields: { address: '경기 양주시 다른로 99', phone: '031-123-4567' }, review: reviewed, matched: true },
    { fields: { address: '경기 양주시 검증로 1', phone: '031-123-4567' }, review: { confirmed: true, reason: '   ' }, matched: false },
    { fields: { address: '경기 양주시 검증로 1', phone: '031-123-4567' }, review: { confirmed: false, reason }, matched: false },
    { fields: { address: '경기 양주시 다른로 99', phone: '031-999-9999' }, review: reviewed, matched: false },
    { fields: { address: '경기 의정부시 검증로 1', phone: '031-123-4567' }, review: reviewed, matched: false },
    { fields: { address: '서울특별시 중구 검증로 1', phone: '031-123-4567' }, review: reviewed, matched: false },
    { fields: { phone: '031-123-4567' }, review: reviewed, matched: false },
    { fields: {}, review: reviewed, matched: false },
  ];
  for (const item of cases) {
    const result = inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{
      sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'read',
      identityReview: item.review, fields: { name: '대조치과 양주', website: source, ...item.fields },
    }] })] });
    const record = result.records[0], map = record.assets.find(a => a.kind === 'naverMap');
    assert.equal(map.ownership, item.matched ? 'official' : 'candidate', JSON.stringify(item));
    assert.equal(record.naverPlaceObservations[0].identityMatch, item.matched);
    assert.equal(record.assets.find(a => a.kind === 'website').ownership, item.matched ? 'linked' : 'candidate');
    if (item.matched) assert(map.notes.includes(reason));
  }
});

test('button labels and unsafe or non-URL strings never fabricate channel links', () => {
  const result = inventory([clinic()], { batches: [batch([], { naverPlaceObservations: [{
    sourceUrl: 'https://m.place.naver.com/hospital/123/home', checkedAt: later, bodyStatus: 'read', fields: {
      name: '대조치과의원', phone: '031-123-4567', displayedChannelButtons: ['유튜브', '인스타그램', '블로그'],
      website: 'javascript:alert(1)', naverBlog: 'https://127.0.0.1/private',
      instagram: 'instagram.com/unknown-name', youtube: 'https://user:secret@youtube.com/@unknown-name',
    },
  }] })] });
  assert.deepEqual(result.records[0].assets.map(a => a.kind), ['naverMap']);
});

test('a newer manual correction still supersedes an older automatically matched Naver observation', () => {
  const map = 'https://m.place.naver.com/hospital/123/home';
  const observed = batch([], { checkedAt: earlier, naverPlaceObservations: [{
    sourceUrl: map, checkedAt: earlier, bodyStatus: 'read', fields: { name: '대조치과의원', phone: '031-123-4567', hours: '월 09:00 - 18:00' },
  }] });
  const corrected = batch([asset({ kind: 'naverMap', url: map, ownership: 'third_party', checkedAt: later, notes: '수동 재검토 후 다른 기관으로 정정.' })]);
  for (const batches of [[observed, corrected], [corrected, observed]]) {
    const result = inventory([clinic()], { batches });
    const record = result.records[0];
    assert.equal(record.assets.length, 1);
    assert.equal(record.assets[0].ownership, 'third_party');
    assert.equal(record.assets[0].checkedAt, later);
    assert.equal(record.confirmedCount, 0);
    const coverage = buildNaverHoursCoverage([clinic()], result).records[0];
    assert.equal(coverage.hours, null);
    assert.equal(coverage.stage, 'place_discovery');
    assert.deepEqual(coverage.sourceUrls, []);
  }
});

test('corrected historical observations retain their recorded fields but replace current identity banners with an exclusion notice', () => {
  const map = 'https://m.place.naver.com/hospital/123/home';
  const excludedNotice = '현재 기관 정보 반영 대상에서 제외된 과거 관찰입니다. 원문 기록을 보존합니다.';
  const matchedNotice = '기관명과 전화 또는 같은 지역의 도로명·건물번호 대조 일치';
  const unmatchedNotice = '이름·지역·전화 대조 조건을 충족하지 못했습니다.';
  for (const matched of [true, false]) {
    const observed = batch([], { checkedAt: earlier, naverPlaceObservations: [{
      sourceUrl: map, checkedAt: earlier, bodyStatus: 'read', fields: {
        name: matched ? '대조치과의원' : '다른치과의원', phone: '031-123-4567', hours: '월 09:00 - 18:00',
      },
    }] });
    const currentHtml = clinicAssetsPanel(inventory([clinic()], { batches: [observed] }).records[0]);
    assert(currentHtml.includes(matched ? matchedNotice : unmatchedNotice));
    assert(!currentHtml.includes(excludedNotice));
    const correction = batch([asset({ kind: 'naverMap', url: map, ownership: 'third_party', checkedAt: later })]);
    const record = freezeDeep(inventory([clinic()], { batches: [observed, correction] }).records[0]);
    const before = JSON.stringify(record);
    const html = clinicAssetsPanel(record);
    const history = html.match(/<article class="naver-observation">[\s\S]*?<\/article>/)?.[0];
    assert(history, 'The historical observation is retained for review');
    assert(history.includes(excludedNotice));
    assert(!history.includes(matchedNotice));
    assert(!history.includes(unmatchedNotice));
    assert(history.includes('월 09:00 - 18:00'));
    assert(history.includes('031-123-4567'));
    assert(history.includes(`href="${map}"`));
    assert.equal(JSON.stringify(record), before);
  }
});

test('directory candidates do not count as manual research or supersede an earlier manual finding', () => {
  const map = 'https://m.place.naver.com/hospital/123/home';
  const directory = batch([asset({
    kind: 'naverMap', url: 'https://map.naver.com/p/entry/place/123', ownership: 'candidate', bodyStatus: 'not_read',
    checkedAt: later, notes: '공개 디렉토리의 실제 지도 링크. 대상 본문 미확인.',
  })], { researched: false });
  const only = inventory([clinic()], { batches: [directory] });
  assert.equal(only.records[0].researched, false);
  assert.equal(only.summary.manuallyResearched, 0);
  assert.equal(only.summary.naverRead, 0);
  assert.equal(only.records[0].assets[0].ownership, 'candidate');
  assert.equal(only.records[0].confirmedCount, 0);
  assert.deepEqual(only.records[0].naverPlaceObservations, []);
  for (const ownership of ['official', 'third_party']) {
    const manual = batch([asset({ kind: 'naverMap', url: map, ownership, checkedAt: earlier, notes: '수동 본문 판정' })], { checkedAt: earlier });
    for (const batches of [[manual, directory], [directory, manual]]) {
      const result = inventory([clinic()], { batches });
      const record = result.records[0];
      assert.equal(record.researched, true);
      assert.equal(result.summary.manuallyResearched, 1);
      assert.equal(record.assets.length, 1);
      assert.equal(record.assets[0].ownership, ownership);
      assert.equal(record.assets[0].bodyStatus, 'read');
      assert.equal(record.assets[0].checkedAt, earlier);
      assert.equal(record.assets[0].notes, '수동 본문 판정');
      assert.equal(record.confirmedCount, ownership === 'official' ? 1 : 0);
    }
  }
});

test('national hours JSON, pending JSONL, index filters and visible stage links use the same institution states', () => {
  const clinics = Object.keys(HOURS_STAGES).map(id => clinic(id));
  const observed = (bodyStatus, fields) => ({ sourceUrl: 'https://m.place.naver.com/hospital/123/home', bodyStatus, checkedAt: later, fields });
  const sourceRows = [
    { clinicId: 'hours_available', naverPlaceObservations: [observed('read', { name: '대조치과의원', phone: '031-123-4567', hours: '월 09:00 - 18:00' })] },
    { clinicId: 'hours_missing', naverPlaceObservations: [observed('read', { name: '대조치과의원', phone: '031-123-4567' })] },
    { clinicId: 'identity_review', naverPlaceObservations: [observed('read', { name: '다른기관', hours: '월 09:00 - 18:00' })] },
    { clinicId: 'access_failed', naverPlaceObservations: [observed('blocked', {})] },
    { clinicId: 'place_ready', researched: false, assets: [asset({ kind: 'naverMap', url: 'https://map.naver.com/p/entry/place/456', ownership: 'candidate', bodyStatus: 'not_read' })] },
  ].map(record => ({ name: '대조치과의원', checkedAt: later, ...record }));
  const result = inventory(clinics, { batches: [{ checkedAt: later, records: sourceRows }] });
  const coverage = buildNaverHoursCoverage(clinics, result);
  for (const record of result.records) record.naverHoursStatus = coverage.records.find(item => item.clinicId === record.clinicId);
  const directory = { status: 'partial', records: [{ clinicId: 'place_ready' }] };
  const { files, pages } = render(result, { coverage, directory });
  const downloaded = JSON.parse(files.get('data/clinic-assets/naver-hours-coverage.json'));
  assert.deepEqual(downloaded, coverage);
  const pending = files.get('data/clinic-assets/naver-hours-pending.jsonl').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(pending.length, coverage.summary.pending);
  assert(pending.every(record => record.stage !== 'hours_available'));
  assert.deepEqual(pending, coverage.records.filter(record => record.stage !== 'hours_available'));
  assert.deepEqual(JSON.parse(files.get('data/clinic-assets/naver-directory-discovery.json')), directory);
  const index = JSON.parse(files.get('data/clinic-assets/index.json'));
  for (const row of index) {
    assert.equal(row.naverHoursStage, row.clinicId);
    assert.equal(row.naverHoursLabel, HOURS_STAGES[row.clinicId]);
  }
  const page = pages.get('/clinic-assets/').body;
  for (const stage of Object.keys(HOURS_STAGES)) {
    assert(page.includes(`href="/clinic-assets/?status=&amp;hours=${stage}#asset-search"`));
    assert(page.includes(`<option value="${stage}">`));
  }
  for (const path of ['naver-hours-coverage.json', 'naver-hours-pending.jsonl', 'naver-directory-discovery.json']) {
    assert(page.includes(`href="/data/clinic-assets/${path}" download`));
  }
  assert.match(page, /나머지 5곳은 수집·대조가 남아 있습니다/);
  assert.match(page, /시간 미확보는 휴진을 뜻하지 않습니다/);
});

test('an empty collection scope renders a finite percentage and a valid empty pending JSONL download', () => {
  const result = inventory([]);
  const coverage = buildNaverHoursCoverage([], result);
  const { files } = render(result, { coverage });
  assert.equal(files.get('data/clinic-assets/naver-hours-pending.jsonl'), '');
  const panel = nationalHoursPanel(coverage);
  assert.doesNotMatch(panel, /NaN|Infinity/);
  assert.match(panel, /0\.0%/);
});

test('Naver booking mobile URLs and query variations merge by business ID while distinct businesses stay distinct', () => {
  const oldUrl = 'https://m.booking.naver.com/booking/13/bizes/1243920?area=pll&theme=place';
  const newUrl = 'https://booking.naver.com/booking/13/bizes/1243920?theme=place&area=pll';
  const legacy = { checkedAt: earlier, records: [{
    clinicId: 'clinic-a', name: '대조치과의원', checkedAt: earlier,
    channels: { naverBooking: { url: oldUrl, status: 'blocked', evidenceUrls: [source] } },
  }] };
  const link = url => asset({ kind: 'booking', url, ownership: 'linked', bodyStatus: 'not_read', checkedAt: later,
    identityEvidence: [{ field: 'officialLink', value: url, sourceUrl: source }],
  });
  const result = inventory([clinic()], { legacy: [legacy], batches: [batch([
    link(newUrl), link('https://m.booking.naver.com/booking/13/bizes/999'),
    asset({ kind: 'naverMap', url: 'https://map.naver.com/p/entry/place/123' }),
    asset({ kind: 'naverMap', url: 'https://m.place.naver.com/hospital/123/home', checkedAt: later }),
  ])] });
  assert.equal(detectKind(oldUrl), 'booking');
  assert.equal(detectKind(newUrl), 'booking');
  const bookings = result.records[0].assets.filter(a => a.kind === 'booking');
  assert.equal(bookings.length, 2);
  assert(bookings.some(a => a.url === newUrl));
  assert(!result.records[0].assets.some(a => a.kind === 'website'));
  assert.equal(result.records[0].assets.filter(a => a.kind === 'naverMap').length, 1);
});

test('rendered evidence is escaped and downloadable records reconcile with channel counts and ownership', () => {
  const unsafe = '<img src=x onerror="alert(1)"> & 소개';
  const result = inventory([clinic('clinic-a', { name: unsafe })], { batches: [batch([
    asset({ label: unsafe, notes: unsafe, identityEvidence: [{ field: 'phone', value: unsafe, sourceUrl: source }] }),
    asset({ kind: 'blog', url: 'https://outside.example.com/article', ownership: 'third_party' }),
  ], { name: unsafe, searches: [{ query: unsafe, outcome: unsafe }], naverPlaceObservations: [{
    sourceUrl: 'https://m.place.naver.com/hospital/123/home', bodyStatus: 'read', checkedAt: later,
    fields: { description: unsafe, hours: { notice: unsafe } }, notes: unsafe,
  }] })] });
  const { files, pages } = render(result);
  const html = clinicAssetsPanel(result.records[0]) + pages.get('/clinic-assets/').body;
  assert(!html.includes('<img src=x'));
  assert(html.includes(esc(unsafe)));
  assert.match(html, /기관 소유에서 제외/);
  const index = JSON.parse(files.get('data/clinic-assets/index.json'));
  const record = JSON.parse(files.get('data/clinic-assets/records/clinic-a.json'));
  const all = JSON.parse(files.get('data/clinic-assets/inventory.json'));
  assert.deepEqual(record, all.records[0]);
  assert.equal(index[0].assetCount, 2);
  assert.equal(record.assets.length, 3, 'The actual observed map URL is added as a candidate; third-party evidence remains excluded from the channel count');
  assert.deepEqual(index[0].kinds, ['website', 'naverMap']);
  assert.equal(record.assets.find(a => a.kind === 'naverMap').ownership, 'candidate', 'Reading a description alone does not identify the institution');
  assert.equal(record.naverPlaceObservations[0].fields.description, unsafe);
  assert.deepEqual(JSON.parse(files.get('data/clinic-assets/summary.json')).byOwnership, result.summary.byOwnership);
  assert.match(pages.get('/clinic-assets/').body, /미수집은 실제 부재가 아닙니다/);
});

test('business-authored text stays outside the fact table with raw whitespace, escaped content and unexpanded dateless notices', () => {
  const map = 'https://m.place.naver.com/hospital/123/information';
  const raw = '업체 소개 <img src=x onerror="alert(1)">\n\n5/5 어린이날 휴진\n예약 시 준비사항은 전화로 안내합니다.';
  const fields = { name: '대조치과의원', phone: '031-123-4567', description: raw,
    representativeKeywords: ['치과', '<b>대표 키워드</b>'], businessNotices: '추석 당일 휴진',
    directions: '지하철역 2번 출구\n건물 2층', visitorPreparation: '방문 전 전화 확인' };
  const observed = more => batch([], { naverPlaceObservations: [{ sourceUrl: map, checkedAt: later, bodyStatus: 'read', fields: more }] });
  const result = inventory([clinic()], { batches: [observed(fields)] });
  const record = freezeDeep(result.records[0]), before = JSON.stringify(record), html = clinicAssetsPanel(record);
  const authored = html.match(/<details class="asset-method business-authored"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert(authored);
  assert.match(authored, /업체가 직접 작성한 안내/);
  assert.match(authored, /객관적으로 검증한 사실이나 치료 권고가 아닙니다/);
  assert.match(authored, /연도가 적혀 있지 않은 공휴일·휴진 안내는 적용 연도나 현재 유효 여부를 추정하지 않습니다/);
  assert(authored.includes(`<div class="asset-field-value">${esc(raw)}</div>`));
  assert(authored.includes('2026-11-01 확인'));
  assert(authored.includes(`href="${map}"`));
  assert(!html.includes('<img src=x'));
  assert(!html.includes('<b>대표 키워드</b>'));
  assert(authored.includes('<span class="pill neutral">&lt;b&gt;대표 키워드&lt;/b&gt;</span>'));
  assert.equal(html.split(esc(raw)).length, 2, 'The description is displayed once without extracting its reservation sentence');
  assert(!authored.includes('<h4>예약 안내</h4>'));
  assert(!html.match(/<table class="fact-table">[\s\S]*?<\/table>/)?.[0].includes(esc(raw)));
  assert(html.indexOf('</table>') < html.indexOf('class="asset-method business-authored"'));
  assert.doesNotMatch(authored, /2026-05-05|2026년 5월/);
  assert(!html.includes('업체 작성 안내는 추가 조사 전입니다'));
  assert.equal(JSON.stringify(record), before);
  for (const field of ['description','representativeKeywords','directions']) assert.equal(result.summary.naverFieldCoverage[field], 1);
  const { pages, files } = render(result);
  assert.match(pages.get('/clinic-assets/').body, /업체 작성 소개 1 · 대표키워드 1 · 찾아오는 길 1곳/);
  assert.equal(JSON.parse(files.get('data/clinic-assets/records/clinic-a.json')).naverPlaceObservations[0].fields.description, raw);
  const missing = inventory([clinic()], { batches: [observed({ name: fields.name, phone: fields.phone, description: '  ', representativeKeywords: [] })] });
  assert.match(clinicAssetsPanel(missing.records[0]), /업체 작성 안내는 추가 조사 전입니다/);
  assert(!clinicAssetsPanel(missing.records[0]).includes('class="asset-method business-authored"'));
  for (const field of ['description','representativeKeywords','directions']) assert.equal(missing.summary.naverFieldCoverage[field], 0);
  const uncertain = inventory([clinic()], { batches: [observed({ name: fields.name, description: raw })] }).records[0];
  assert.equal(uncertain.naverPlaceObservations[0].identityMatch, false);
  assert.match(clinicAssetsPanel(uncertain), /이 기관의 확정 정보로 보지 말고 원문을 확인해 주세요/);
  const separate = inventory([clinic()], { batches: [observed({ ...fields, reservationNotice: '별도 예약 항목 원문' })] }).records[0];
  const reservationSection=clinicAssetsPanel(separate).match(/<section><h4>예약 안내<\/h4>[\s\S]*?<\/section>/)?.[0];
  assert(reservationSection?.includes(`href="${map}"`));
  assert(reservationSection?.includes(`datetime="${later}"`));
  assert(reservationSection?.includes('<div class="asset-field-value">별도 예약 항목 원문</div>'));
  const previous = observed({ name: fields.name, phone: fields.phone });
  previous.records[0].naverPlaceObservations[0].checkedAt = earlier;
  previous.records[0].naverPlaceObservations[0].notes = '당시 소개 수집은 보류함';
  for (const batches of [[previous, observed(fields)], [observed(fields), previous]]) {
    const historyRecord = freezeDeep(inventory([clinic()], { batches }).records[0]);
    const historyBefore = JSON.stringify(historyRecord), rendered = clinicAssetsPanel(historyRecord);
    const historyAt = rendered.indexOf('<details class="asset-method observation-history">');
    assert(historyAt > rendered.indexOf(esc(raw)), 'The newest source text is shown before collapsed historical observations');
    assert.match(rendered, /이전 관찰 기록 1개/);
    assert(rendered.slice(historyAt).includes('당시 소개 수집은 보류함'));
    assert(rendered.includes('href="#business-authored-clinic-a">소개·예약 안내 보기'));
    assert(rendered.includes('class="asset-method business-authored" id="business-authored-clinic-a" open'));
    assert(!rendered.includes('업체 작성 안내는 추가 조사 전입니다'));
    assert.equal(JSON.stringify(historyRecord), historyBefore);
  }
});

test('a later Naver listing observation never clears a linked social destination read or blocked result in either batch order', () => {
  const channels = [
    { kind: 'instagram', url: 'https://www.instagram.com/clinic-example/', bodyStatus: 'blocked' },
    { kind: 'facebook', url: 'https://www.facebook.com/clinic-example/', bodyStatus: 'blocked' },
    { kind: 'youtube', url: 'https://www.youtube.com/@clinic-example', bodyStatus: 'read' },
  ];
  const prior = batch(channels.map(channel => asset({ ...channel, ownership: 'linked', checkedAt: earlier,
    identityEvidence: [{ field: 'officialLink', value: channel.url, sourceUrl: source }],
  })), { checkedAt: earlier });
  const fields = { name: '대조치과의원', phone: '031-123-4567', description: '새로 수집한 업체 소개' };
  for (const channel of channels) fields[channel.kind] = channel.url;
  const newer = batch([], { checkedAt: later, naverPlaceObservations: [{
    sourceUrl: 'https://m.place.naver.com/hospital/123/information', checkedAt: later, bodyStatus: 'read', fields,
  }] });
  for (const batches of [[prior, newer], [newer, prior]]) {
    const record = inventory([clinic()], { batches }).records[0];
    for (const channel of channels) {
      const stored = record.assets.find(a => a.url === channel.url);
      assert.equal(stored.ownership, 'linked');
      assert.equal(stored.bodyStatus, channel.bodyStatus);
      assert.equal(stored.checkedAt, earlier);
    }
    assert.equal(record.naverPlaceObservations[0].checkedAt, later);
    assert.equal(record.naverPlaceObservations[0].fields.description, fields.description);
  }
});

test('the real national inventory preserves institution IDs, types, registered facts and distinct Naver observations', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const sourceData = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8'));
  const before = JSON.stringify(sourceData);
  const result = loadAssetInventory(root, sourceData);
  assert.equal(JSON.stringify(sourceData), before, 'Building the inventory must not rewrite public source values');
  assert.equal(result.records.length, sourceData.clinics.length);
  assert.equal(new Set(result.records.map(r => r.clinicId)).size, sourceData.clinics.length);
  const byId = new Map(result.records.map(r => [r.clinicId, r]));
  for (const c of sourceData.clinics) {
    const r = byId.get(c.id);
    assert.equal(r.name, c.name);
    assert.equal(r.typeCode, c.typeCode);
    assert.equal(r.type, c.typeCode === '41' ? '치과병원' : c.typeCode === '51' ? '치과의원' : '종별 미확인');
    assert.equal(r.address, c.address);
    assert.equal(r.phone, c.phone);
    for (const o of r.naverPlaceObservations) {
      if (o.bodyStatus !== 'read') assert.deepEqual(o.fields, {});
      for (const field of ['reviews','reviewBody']) assert(!Object.hasOwn(o.fields,field),'Visitor review bodies remain deferred by user request');
    }
  }
  const easy = result.records.find(r => r.name === '양주이지치과의원');
  assert(easy);
  const sameReservation = easy.assets.filter(a => new URL(a.url).pathname.includes('/bizes/1243920'));
  assert.equal(sameReservation.length, 1, 'Regression: legacy mobile booking must not duplicate a newer booking as a homepage');
  assert.equal(sameReservation[0].kind, 'booking');
  assert.equal(result.summary.withAssets + result.summary.withoutAssets, result.summary.total);
});
