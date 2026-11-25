import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildAssetInventory, loadAssetInventory, candidateHomepageVerified, linkableAsset } from '../scripts/clinic-assets.mjs';
import { assetItem, observedWebsiteRow } from '../scripts/clinic-assets-pages.mjs';

const metadata = { snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:00:00Z' };
const discovered = '2026-11-04T12:00:00Z', verified = '2026-11-26T12:00:00Z';
const clinic = (id = 'clinic-a', overrides = {}) => ({
  id, name: '대조치과의원', typeCode: '51', sido: '경기', city: '양주시',
  address: '경기도 양주시 검증로 1', phone: '031-123-4567', website: null, ...overrides,
});
const site = 'https://clinic.example.com/';
// What the research loop stores: a model-found candidate backed only by a search-result page.
const researchBatch = (clinicId = 'clinic-a') => ({
  checkedAt: discovered, sourceType: 'automated_web_research',
  records: [{ clinicId, name: '대조치과의원', checkedAt: discovered, researched: true, searches: [{ query: '대조치과의원 양주' }], assets: [{
    kind: 'website', url: site, ownership: 'candidate', bodyStatus: 'not_read', label: '자동 발굴 · 귀속 검토 필요',
    evidenceUrls: ['https://search.example.net/results'], notes: '검색 결과에서 홈페이지로 표시됨',
    identityEvidence: [{ field: 'name', value: '대조치과의원', sourceUrl: 'https://search.example.net/results' }],
    provenance: [{ type: 'automated_web_research' }],
  }] }],
});
// What stream 1's collector stores for the same URL.
const check = (overrides = {}) => ({
  url: site, finalUrl: site, checkedAt: verified, clinicIds: ['clinic-a'], status: 'read', httpStatus: 200,
  sourceType: 'candidate_homepage', bodySha256: 'abc', datasetPhoneCount: 1, hostClinicCount: 1,
  matches: { 'clinic-a': { name: true, phone: true, address: true } },
  links: [{ kind: 'instagram', url: 'https://www.instagram.com/daejo_dental' }],
  ...overrides,
});
const build = (checks, clinics = [clinic()]) => buildAssetInventory(clinics, { ...metadata, batches: [researchBatch()], crawl: { results: checks } });
const website = result => result.records[0].assets.find(a => a.kind === 'website');
const links = result => result.records[0].assets.filter(a => a.kind !== 'website');

test('a candidate homepage whose body shows the phone and road address becomes a linkable official asset', () => {
  const result = build([check()]);
  const asset = website(result);
  assert.equal(asset.ownership, 'official');
  assert.equal(asset.bodyStatus, 'read');
  assert.equal(asset.linkable, true);
  assert.equal(asset.checkedAt, verified);
  assert.deepEqual(asset.identityEvidence.map(x => x.field), ['name', 'phone', 'address']);
  assert(asset.identityEvidence.every(x => x.sourceUrl === site));
  assert.deepEqual(asset.evidenceUrls.sort(), [site, 'https://search.example.net/results'].sort());
  const verification = asset.provenance.find(p => p.type === 'candidate_homepage_verification');
  assert.deepEqual(verification, { type: 'candidate_homepage_verification', sourceType: 'candidate_homepage', bodySha256: 'abc', matches: { name: true, phone: true, address: true }, datasetPhoneCount: 1, hostClinicCount: 1, checkedAt: verified });
  const superseded = asset.provenance.find(p => p.type === 'superseded_observation');
  assert.equal(superseded.ownership, 'candidate');
  assert.equal(superseded.bodyStatus, 'not_read');
  assert.equal(superseded.checkedAt, discovered);
  assert.match(asset.notes, /기관명과 전화번호·도로명 주소/);
  // The verified page's own profile hrefs become linked channels with the proof attached (see linked-channel tests).
  assert.deepEqual(links(result).map(a => [a.kind, a.ownership, a.linkable]), [['instagram', 'linked', true]]);
  assert(links(result)[0].identityEvidence.some(x => x.field === 'officialLink'));
  assert.equal(result.records[0].confirmedCount, 2); // the official homepage plus the Instagram profile it links
  assert.equal(result.summary.byOwnership.official, 1);
  assert.equal(result.summary.byOwnership.linked, 1);
  // Rendering: the link is live and the pill says the body was matched.
  const item = assetItem(asset);
  assert.match(item, /href="https:\/\/clinic\.example\.com\/"/);
  assert.match(item, /본문·기관 대조/);
  assert.doesNotMatch(item, /검토 중 · 링크 비활성/);
  assert.match(observedWebsiteRow(result.records[0]), /웹에서 확인한 홈페이지[\s\S]*href="https:\/\/clinic\.example\.com\/"/);
});

test('name plus phone is enough when the page prints no road address; the proof omits the address', () => {
  const result = build([check({ matches: { 'clinic-a': { name: true, phone: true, address: false } } })]);
  const asset = website(result);
  assert.equal(asset.ownership, 'official');
  assert.equal(asset.linkable, true);
  assert.deepEqual(asset.identityEvidence.map(x => x.field), ['name', 'phone']);
  assert.match(asset.notes, /기관명과 전화번호를/);
  assert.deepEqual(asset.provenance.find(p => p.type === 'candidate_homepage_verification').matches, { name: true, phone: true, address: false });
});

test('name plus road address without the phone is also accepted, as in the Naver map rule', () => {
  const asset = website(build([check({ matches: { 'clinic-a': { name: true, phone: false, address: true } } })]));
  assert.equal(asset.ownership, 'official');
  assert.deepEqual(asset.identityEvidence.map(x => x.field), ['name', 'address']);
  assert.match(asset.notes, /기관명과 도로명 주소를/);
});

test('phone or address without the institution name stays an unlinked candidate', () => {
  for (const matches of [{ name: false, phone: true, address: true }, { name: false, phone: true, address: false }]) {
    const result = build([check({ matches: { 'clinic-a': matches } })]);
    const asset = website(result);
    assert.equal(asset.ownership, 'candidate');
    assert.equal(asset.linkable, false);
    // The unverified scan does not outrank the research-loop candidate; the read stays on record as a check.
    assert.deepEqual(result.records[0].homepageChecks.map(c => [c.sourceType, c.status, c.matches.name]), [['candidate_homepage', 'read', false]]);
    assert(!asset.provenance.some(p => p.type === 'candidate_homepage_verification'));
    assert(!asset.identityEvidence.some(x => x.field === 'address'));
    assert.match(assetItem(asset), /검토 중 · 링크 비활성/);
    // Unverified candidate pages donate no hrefs, even though the phone matched.
    assert.deepEqual(links(result), []);
  }
  assert.equal(candidateHomepageVerified(check(), { name: true, phone: false, address: false }), false);
});

test('a page listing many registered phone numbers is treated as a directory: no promotion, no donated links', () => {
  const result = build([check({ datasetPhoneCount: 3 })]);
  assert.equal(website(result).ownership, 'candidate');
  assert.equal(website(result).linkable, false);
  assert.deepEqual(links(result), []);
  assert.equal(candidateHomepageVerified(check({ datasetPhoneCount: 3 }), { name: true, phone: true, address: true }), false);
  assert.equal(candidateHomepageVerified(check({ datasetPhoneCount: 2 }), { name: true, phone: true, address: true }), true);
});

test('a row without the directory guard count is never promoted', () => {
  for (const row of [check({ datasetPhoneCount: undefined }), check({ datasetPhoneCount: null }), check({ datasetPhoneCount: 'many' })]) {
    const result = build([row]);
    assert.equal(website(result).ownership, 'candidate');
    assert.deepEqual(links(result), []);
  }
});

test('an unread or non-website candidate row is not promoted', () => {
  assert.equal(website(build([check({ status: 'http_error', httpStatus: 500 })])).ownership, 'candidate');
  assert.equal(website(build([check({ status: 'blocked', httpStatus: 403 })])).ownership, 'candidate');
  const blog = 'https://blog.naver.com/daejo';
  const result = buildAssetInventory([clinic()], { ...metadata, crawl: { results: [check({ url: blog, finalUrl: blog, links: [] })] } });
  const asset = result.records[0].assets.find(a => a.url === blog);
  assert.equal(asset.kind, 'naverBlog');
  assert.equal(asset.ownership, 'candidate');
});

test('linked-homepage scans keep their existing behaviour: a full match still stays a candidate and still donates links', () => {
  const result = build([check({ sourceType: 'discovered_homepage' })]);
  assert.equal(website(result).ownership, 'candidate');
  assert.equal(website(result).linkable, false);
  assert(!website(result).identityEvidence.some(x => x.field === 'address'));
  assert.deepEqual(links(result).map(a => a.kind), ['instagram']);
  const registered = buildAssetInventory([clinic()], { ...metadata, crawl: { results: [check({ sourceType: 'registered_homepage' })] } });
  assert.equal(website(registered).ownership, 'candidate');
});

test('registered and linked assets of the same institution are untouched by the verification', () => {
  const other = 'https://registered.example.com/';
  const result = buildAssetInventory([clinic('clinic-a', { website: other })], { ...metadata, batches: [researchBatch()], crawl: { results: [check()] } });
  const registered = result.records[0].assets.find(a => a.url === other);
  assert.equal(registered.ownership, 'registered');
  assert.equal(registered.bodyStatus, 'not_read');
  assert.equal(website(result).url, site);
  assert.equal(website(result).ownership, 'official');
  assert.equal(result.records[0].assets.filter(a => a.kind === 'website').length, 2);
});

test('a verification row naming an unknown institution is rejected', () => {
  assert.throws(() => build([check({ clinicIds: ['clinic-zzz'], matches: { 'clinic-zzz': { name: true, phone: true, address: true } } })]), /Unknown crawler clinic/);
});

test('loadAssetInventory reads candidate-homepages.json with the candidate_homepage source type', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'candidate-homepages-'));
  fs.mkdirSync(path.join(root, 'data/assets'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/assets/national-web-auto.json'), JSON.stringify({ schemaVersion: 1, sourceType: 'automated_web_research', scope: 'test', checkedAt: discovered, records: researchBatch().records }));
  const { sourceType, ...row } = check();
  fs.writeFileSync(path.join(root, 'data/assets/candidate-homepages.json'), JSON.stringify({ schemaVersion: 1, state: 'idle', results: [row] }));
  const result = loadAssetInventory(root, { ...metadata, clinics: [clinic()] });
  const asset = website(result);
  assert.equal(asset.ownership, 'official');
  assert.equal(asset.provenance.find(p => p.type === 'candidate_homepage_verification').sourceType, 'candidate_homepage');
  assert.equal(result.records[0].homepageChecks[0].sourceType, 'candidate_homepage');
  assert.equal(result.summary.homepageUrlsChecked, 1);
  // Without the file nothing changes.
  fs.rmSync(path.join(root, 'data/assets/candidate-homepages.json'));
  assert.equal(website(loadAssetInventory(root, { ...metadata, clinics: [clinic()] })).ownership, 'candidate');
  assert.equal(linkableAsset(website(loadAssetInventory(root, { ...metadata, clinics: [clinic()] }))), false);
});
