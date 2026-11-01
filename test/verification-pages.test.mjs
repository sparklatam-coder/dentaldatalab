import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { prepareVerification, loadVerification, registerVerificationPage, clinicChannelPanel } from '../scripts/verification-pages.mjs';

const clinic = (id, name = '치과 ' + id, extra = {}) => ({ id, name, address: '경기도 양주시', sidoCode: '310000', cityCode: '312700', ...extra });
const checked = { url: 'https://example.org/', status: 'verified', evidenceUrls: ['https://example.org/contact'], bodyVerified: true, identityVerified: true };
const source = (count = 1) => ({ sourceVerification: { status: 'official_snapshot_matched', completedAt: '2026-10-31T14:00:00Z', expectedSnapshotDate: '2026-09-30', download: { archiveMatchesManifest: true, sha256: 'a'.repeat(64), size: 123, downloadPath: '/private/never-publish' }, comparison: { mismatchCount: 0, dentalRows: count, byType: { 치과의원: count } } }, apiAccess: { credentialNote: 'must not publish internal API details' } });
const render = verification => {
  let result;
  const files = new Map();
  registerVerificationPage({ verification, put: (name, body) => files.set(name, body), page: (route, options) => { result = { route, ...options }; } });
  return { ...result, files };
};

test('every source institution stays in the roster and missing records mean pending, not absent', () => {
  const clinics = [clinic('b', '나치과'), clinic('a', '가치과'), clinic('outside', '다른 지역', { cityCode: '311000' })];
  const before = JSON.stringify(clinics);
  const v = prepareVerification(clinics, [{ records: [{ clinicId: 'a', name: '가치과', checkedAt: '2026-10-31', channels: { website: { status: 'not_found', url: null } } }] }]);
  assert.equal(v.scope.total, 2);
  assert.equal(v.summary.researched, 1);
  assert.equal(v.summary.pending, 1);
  assert.deepEqual(v.records.map(record => record.clinicId), ['a', 'b']);
  assert.equal(v.records[0].channels.website.status, 'not_found');
  assert.equal(v.records[1].channels.website.status, 'pending');
  assert.equal(JSON.stringify(clinics), before);
  assert.equal(clinicChannelPanel(clinics[2], v), '');
});

test('links without body checks, restricted pages and uncorroborated candidates never count as verified', () => {
  const clinics = ['a', 'b', 'c'].map(id => clinic(id));
  const records = [
    { clinicId: 'a', name: '치과 a', channels: { website: checked, naverPlace: { ...checked, bodyVerified: false }, naverBlog: { ...checked, status: 'blocked' } } },
    { clinicId: 'b', name: '치과 b', channels: { website: { ...checked, evidenceUrls: [] }, naverPlace: { ...checked, identityVerified: false }, naverBlog: { ...checked, status: 'candidate' } } },
    { clinicId: 'c', name: '치과 c', channels: { website: { ...checked, url: 'javascript:alert(1)' } } },
  ];
  const v = prepareVerification(clinics, [{ records }]);
  assert.equal(v.summary.verifiedChannelCount, 1);
  assert.equal(v.records[0].channels.naverPlace.status, 'linked');
  assert.equal(v.records[0].channels.naverBlog.status, 'blocked');
  assert.equal(v.records[1].channels.website.status, 'candidate');
  assert.equal(v.records[1].channels.naverPlace.status, 'candidate');
  assert.equal(v.records[2].channels.website.url, null);
  const html = render(v).body;
  assert(html.includes('본문 접근 실패 · 미확인'));
  assert(html.includes('링크 확인 · 본문 미확인'));
  assert(!html.includes('javascript:'));
});

test('only explicitly observed or verified facts with a usable source are shown, and all text is escaped', () => {
  const clinics = [clinic('a', '<script>기관</script>')];
  const v = prepareVerification(clinics, [{ records: [{ clinicId: 'a', name: clinics[0].name, checkedAt: '2026-10-31', channels: { website: { ...checked, notes: '<img onerror="attack">' } }, facts: [
    { field: 'phone', value: '031-123-4567', status: 'verified', sourceUrl: 'https://example.org/', notes: '<script>notes</script>' },
    { field: 'hoursSummary', value: '월요일 09:00~18:00', status: 'observed', sourceUrl: 'https://example.org/', sourceEvidenceMode: 'direct_page' },
    { field: 'phone', value: 'UNCONFIRMED', status: 'candidate', sourceUrl: 'https://example.org/' },
    { field: 'hours', value: 'INVALID_SOURCE', status: 'verified', sourceUrl: 'javascript:alert(1)' },
  ] }] }]);
  const html = render(v).body;
  assert.equal(v.summary.observedFactCount, 2);
  assert(html.includes('031-123-4567'));
  assert(!html.includes('UNCONFIRMED'));
  assert(!html.includes('INVALID_SOURCE'));
  assert(!html.includes('<script>'));
  assert(!html.includes('<img'));
  assert(html.includes('&lt;script&gt;기관'));
  assert(clinicChannelPanel(clinics[0], v).includes('페이지 자체 안내'));
});

test('search snippets keep their evidence mode and never render as direct page confirmation', () => {
  const v = prepareVerification([clinic('a')], [{ records: [{ clinicId: 'a', name: '치과 a', facts: [{ field: 'phone', value: '031-000-0000', status: 'observed', sourceUrl: 'https://example.org', sourceEvidenceMode: 'search_index' }] }] }]);
  assert.equal(v.records[0].facts[0].sourceEvidenceMode, 'search_index');
  assert(clinicChannelPanel(clinic('a'), v).includes('검색 색인에서 관찰 · 대상 본문 미확인'));
  assert(!clinicChannelPanel(clinic('a'), v).includes('페이지 자체 안내 · 본문 열람'));
});

test('a verified label cannot override missing identity checks or explicitly unconfirmed provenance', () => {
  for (const override of [{ bodyVerified: undefined }, { identityVerified: undefined }, { identityStatus: 'candidate' }, { officiality: 'unconfirmed' }]) {
    const v = prepareVerification([clinic('a')], [{ records: [{ clinicId: 'a', name: '치과 a', channels: { website: { ...checked, ...override } } }] }]);
    assert.equal(v.summary.verifiedChannelCount, 0);
    assert.equal(v.records[0].channels.website.bodyVerified, false);
  }
});

test('source verification requires matching archive, field audit and actual population, with private metadata excluded', () => {
  const clinics = [clinic('a')];
  const v = prepareVerification(clinics, [], source());
  assert.equal(v.source.status, 'matched');
  assert.equal(prepareVerification(clinics, [], source(2)).source.status, 'incomplete');
  const bad = source(); bad.sourceVerification.comparison.mismatchCount = 1;
  assert.equal(prepareVerification(clinics, [], bad).source.status, 'incomplete');
  const result = render(v);
  const json = result.files.get('data/verification.json');
  assert(!json.includes('/private/'));
  assert(!json.includes('credentialNote'));
  assert(result.body.includes('현재 영업·진료시간·전화 연결·홈페이지 운영의 전수 확인이 아닙니다.'));
});

test('missing research and source files safely show pending; malformed identity joins fail loudly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-verification-test-'));
  try {
    const v = loadVerification(dir, [clinic('a')]);
    assert.equal(v.source.status, 'pending');
    assert.equal(v.summary.pending, 1);
    assert(render(v).body.includes('공식 원본 대조 결과를 확인 중'));
  } finally { fs.rmSync(dir, { recursive: true }); }
  assert.throws(() => prepareVerification([clinic('a')], [{ records: [{ clinicId: 'a', name: '다른 기관' }] }]), /name mismatch/);
  assert.throws(() => prepareVerification([clinic('a')], [{ records: [{ clinicId: 'unknown', name: '치과' }] }]), /outside Yangju/);
  assert.throws(() => prepareVerification([clinic('a')], [{ records: [{ clinicId: 'a', name: '치과 a' }, { clinicId: 'a', name: '치과 a' }] }]), /Duplicate/);
});

test('actual handoff snapshot contributes exactly 67 Yangju institutions and source provenance remains separate', () => {
  const clinics = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8')).clinics;
  const provenance = JSON.parse(fs.readFileSync(new URL('../docs/source-verification.json', import.meta.url), 'utf8'));
  const v = prepareVerification(clinics, [], provenance);
  assert.equal(v.scope.total, 67);
  assert.equal(v.source.status, 'matched');
  assert.equal(v.source.dentalCount, 19681);
  assert.equal(v.summary.verifiedChannelCount, 0);
  assert.equal(v.summary.pending, 67);
  const html = render(v).body;
  assert.equal((html.match(/<tr>/g) ?? []).length, 68);
});
