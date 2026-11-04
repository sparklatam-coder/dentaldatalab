import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssetInventory, institutionType } from '../scripts/clinic-assets.mjs';
import { assetItem, clinicAssetsPanel } from '../scripts/clinic-assets-pages.mjs';

const metadata = { snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:00:00Z' };
const earlier = '2026-10-31T12:00:00Z', later = '2026-11-01T12:00:00Z';
const source = 'https://clinic.example.com/';
const clinic = (id = 'clinic-a', overrides = {}) => ({ id, name: '대조치과의원', typeCode: '51', sido: '경기', city: '양주시', address: '경기도 양주시 검증로 1', phone: '031-123-4567', website: null, ...overrides });
const asset = (overrides = {}) => ({ kind: 'website', url: source, ownership: 'official', bodyStatus: 'read', evidenceUrls: [source], identityEvidence: [{ field: 'name', value: '대조치과의원', sourceUrl: source }, { field: 'phone', value: '031-123-4567', sourceUrl: source }], checkedAt: earlier, notes: '본문 대조.', ...overrides });
const batch = (assets, overrides = {}) => ({ checkedAt: later, records: [{ clinicId: 'clinic-a', name: '대조치과의원', checkedAt: later, assets, searches: [], ...overrides }] });
const legacyBatch = (channel = {}, facts = []) => ({ checkedAt: earlier, records: [{ clinicId: 'clinic-a', name: '대조치과의원', checkedAt: earlier, searchQueries: [], channels: { website: { url: source, status: 'verified', bodyVerified: true, identityVerified: true, evidenceUrls: [source], notes: '기존 조사: 본문에서 기관명과 주소를 대조함', ...channel } }, facts }] });
const inventory = (options = {}, clinics = [clinic()]) => buildAssetInventory(clinics, { ...metadata, ...options });

test('a prose-only legacy verification is cited as a research record, not rendered as an address comparison', () => {
  const record = inventory({ legacy: [legacyBatch()] }).records[0];
  const website = record.assets.find(a => a.url === source);
  assert.equal(website.ownership, 'official', 'strictly verified legacy research still passes the official gate');
  assert.deepEqual(website.identityEvidence.map(x => x.field), ['legacy_record']);
  assert(!website.identityEvidence.some(x => ['address', 'phone'].includes(x.field)));
  assert.match(website.identityEvidence[0].value, /^기존 조사에서 기관명·주소\/전화 대조 기록: 기존 조사/);
  const html = assetItem(website);
  assert.match(html, /기존 조사 기록 \(주소·전화 원문 미첨부\)/);
  assert(!/<li>주소: /.test(html), 'the research log must not be labelled as the address');
  assert(!/<li>legacy_record/.test(html), 'the new field has a readable label');
  assert.match(clinicAssetsPanel(record), /기존 조사 기록/);
  const withFacts = inventory({ legacy: [legacyBatch({}, [{ field: 'address', value: '경기도 양주시 검증로 1', sourceUrl: source }])] }).records[0].assets.find(a => a.url === source);
  assert.deepEqual(withFacts.identityEvidence.map(x => x.field), ['address'], 'recorded facts are cited as themselves');
});

test('legacy_record only satisfies the official gate for legacy_research provenance; other sources cannot borrow it', () => {
  const borrowed = asset({ identityEvidence: [{ field: 'legacy_record', value: '임의 주장', sourceUrl: source }] });
  const website = inventory({ batches: [batch([borrowed])] }).records[0].assets.find(a => a.url === source);
  assert.equal(website.ownership, 'candidate');
  assert.deepEqual(website.identityEvidence, [], 'the unsupported claim is dropped rather than displayed');
  const unverifiedLegacy = inventory({ legacy: [legacyBatch({ identityVerified: false })] }).records[0].assets.find(a => a.url === source);
  assert.equal(unverifiedLegacy.ownership, 'candidate');
  assert.deepEqual(unverifiedLegacy.identityEvidence, []);
});

test('a malformed asset checkedAt is replaced by the batch time or null, never kept as a fake date', () => {
  const fromBatch = inventory({ batches: [batch([asset({ checkedAt: 'not a date' })])] }).records[0].assets.find(a => a.url === source);
  assert.equal(fromBatch.checkedAt, later);
  const undated = inventory({ batches: [{ records: [{ clinicId: 'clinic-a', name: '대조치과의원', assets: [asset({ checkedAt: '31/10/2026' })] }] }] }).records[0].assets.find(a => a.url === source);
  assert.equal(undated.checkedAt, null);
  const numeric = inventory({ batches: [batch([asset({ checkedAt: 1730000000000 })])] }).records[0].assets.find(a => a.url === source);
  assert.equal(numeric.checkedAt, later, 'only ISO strings are observation times');
  const kept = inventory({ batches: [batch([asset({ checkedAt: '2026-11-01T21:00:00+09:00' })])] }).records[0].assets.find(a => a.url === source);
  assert.equal(kept.checkedAt, '2026-11-01T21:00:00+09:00');
});

test('generatedAt is derived from the inputs, so identical inputs produce identical bytes', () => {
  const options = { batches: [batch([asset()])], crawl: { results: [{ url: 'https://other.example.com/', clinicIds: ['clinic-a'], status: 'blocked', checkedAt: '2026-11-03T00:00:00Z' }] } };
  const first = inventory(options), second = inventory(structuredClone(options));
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.equal(first.generatedAt, '2026-11-03T00:00:00.000Z', 'the newest checkedAt among the inputs');
  assert.equal(inventory().generatedAt, '2026-10-31T10:00:00.000Z', 'falls back to observedAt when no input carries a time');
  assert.equal(buildAssetInventory([clinic()], { snapshotDate: '2026-09-30' }).generatedAt, null);
});

test('institution labels are looked up as own properties only', () => {
  assert.equal(institutionType('41'), '치과병원');
  assert.equal(institutionType('constructor'), '종별 미확인');
  assert.equal(institutionType(undefined), '종별 미확인');
});
