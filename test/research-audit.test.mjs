import test from 'node:test';
import assert from 'node:assert/strict';
import { auditResearch } from '../scripts/audit-research.mjs';

const clinic = { id: 'a', name: '가치과', website: 'https://example.org', city: '양주시' };
const missing = () => ({ url: null, status: 'not_found', evidenceUrls: [] });
const record = () => ({ clinicId: 'a', name: '가치과', checkedAt: '2026-10-31T00:00:00Z', channels: { website: missing(), naverPlace: missing(), naverBlog: missing() }, facts: [] });

test('discovered and blocked URLs never inflate verified coverage; untouched clinics stay not_checked', () => {
  const r = record();
  r.channels.naverPlace = { status: 'blocked', url: 'https://map.naver.com/p/entry/place/1', evidenceUrls: ['https://example.org'], bodyVerified: false };
  const result = auditResearch([clinic, { ...clinic, id: 'b', name: '나치과' }], [{ records: [r] }]);
  assert.equal(result.summary.byChannel.naverPlace.discovered, 1);
  assert.equal(result.summary.byChannel.naverPlace.verified, 0);
  assert.equal(result.summary.allThreeChannelsVerified, 0);
  assert.equal(result.summary.notResearchedInstitutions, 1);
  assert.equal(result.queue[1].channels.website, 'not_checked');
  assert.equal(result.queue[0].nextAction, 'resolve_unverified_channels');
});

test('entity collisions, unsupported verification and untrusted URLs fail the audit', () => {
  assert.throws(() => auditResearch([clinic], [{ records: [record(), record()] }]), /Duplicate/);
  const wrong = record(); wrong.name = '다른 치과';
  assert.throws(() => auditResearch([clinic], [{ records: [wrong] }]), /identity mismatch/);
  const r = record();
  r.channels.website = { url: 'javascript:alert(1)', status: 'candidate', evidenceUrls: ['https://example.org'] };
  assert.throws(() => auditResearch([clinic], [{ records: [r] }]), /Unsafe URL/);
  r.channels.website = { url: 'https://example.org', status: 'verified', evidenceUrls: ['https://example.org'], bodyVerified: false };
  assert.throws(() => auditResearch([clinic], [{ records: [r] }]), /False verification/);
});
