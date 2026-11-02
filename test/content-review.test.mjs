import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { prepareContent, loadContent } from '../scripts/content-data.mjs';
import { auditContentReview, contentRevision } from '../scripts/content-review-data.mjs';
import { registerContentPage } from '../scripts/content-pages.mjs';
import { robotsMeta, sitemapXml } from '../scripts/seo.mjs';

const now = '2026-11-02T05:00:00Z';
const source = { url: 'https://medical.example.org/guide', title: '회귀 검사 전용 가상 출처', publisher: '회귀 검사 기관', checkedAt: '2026-11-01T02:00:00Z' };
const question = { id: 'A001', category: 'implant', keyword: '회귀 검사용 키워드', question: '회귀 검사용 질문', hookTitle: '회귀 검사용 제목', intent: '치료 선택', answer: '실제 의료 조언이 아닌 회귀 검사 문안입니다.', answerSources: [{ url: source.url, title: source.title }], clinicalReviewStatus: 'pending', editorialPriority: 'P1', priorityReason: '테스트 데이터' };
const content = () => prepareContent([{ questions: [structuredClone(question)], sources: [structuredClone(source)] }], {}, { expectedCount: 1 });
// This fixture is never saved into the real review ledger or published exports.
const reviewRecord = q => ({ questionId: q.id, contentRevision: contentRevision(q), decision: 'approved',
  reviewer: { name: '회귀 검사 전용 가상 검토자', profession: 'dentist', qualification: '가상 자격', credentialEvidenceUrl: 'https://medical.example.org/test-credential', credentialVerified: true, credentialCheckedAt: '2026-11-01T01:00:00Z', credentialVerifiedBy: '회귀 검사 운영자' },
  reviewedAt: '2026-11-02T04:00:00Z', nextReviewAt: '2027-02-01T04:00:00Z', reviewEvidenceUrl: 'https://medical.example.org/test-record',
  sourceChecks: [{ url: source.url, checkedAt: '2026-11-02T03:00:00Z', supportsAnswer: true, locator: '가상 절', rationale: '회귀 검사용 대응 범위' }],
  titleReviewed: true, koreanContextReviewed: true, patientSafetyReviewed: true,
  editorial: { decision: 'approved', reviewedBy: '회귀 검사 편집자', reviewedAt: '2026-11-02T04:30:00Z', evidenceUrl: 'https://medical.example.org/test-editorial' },
});
const audit = (c, reviews = []) => auditContentReview(c, { asOf: now, ledger: { schemaVersion: 1, reviews } });

test('a source date or successful web access never becomes a clinical review date', () => {
  const c = content();
  const report = auditContentReview(c, { asOf: now, sourceChecks: { checks: [{ url: source.url, status: 'read', checkedAt: '2026-11-02T03:00:00Z' }] } });
  assert.equal(report.summary.sourcesReopened, 1);
  assert.equal(report.summary.clinicalApproved, 0);
  assert.equal(report.questions[0].reviewedAt, null);
  assert.equal(report.questions[0].reviewer, null);
  assert.equal(report.questions[0].publicationEligible, false);
  assert(report.questions[0].blockers.some(b => b.code === 'claim_support'));
});

test('only a complete current revision review record satisfies the publication prerequisites; indexing stays disabled', () => {
  const c = content(), before = structuredClone(c), report = audit(c, [reviewRecord(c.questions[0])]);
  assert.equal(report.summary.clinicalApproved, 1);
  assert.equal(report.summary.publicationEligible, 1);
  assert.equal(report.indexable, false);
  assert.equal(report.publicationMode, 'draft_only');
  assert.deepEqual(c, before);
  for (const field of ['answer', 'hookTitle', 'question', 'priorityReason']) {
    const changed = structuredClone(c); changed.questions[0][field] += ' 변경';
    const next = audit(changed, [reviewRecord(c.questions[0])]);
    assert.equal(next.summary.publicationEligible, 0, field);
    assert(next.questions[0].blockers.some(b => b.code === 'revision_changed'));
  }
});

test('unverified credentials, invalid or future dates, stale reviews and unsupported citations cannot be approved', () => {
  const c = content();
  for (const mutate of [
    r => r.reviewer.credentialVerified = false,
    r => r.reviewer.credentialEvidenceUrl = 'javascript:alert(1)',
    r => r.reviewedAt = '2026-11-02T06:00:00Z',
    r => r.reviewedAt = '2026-02-31T03:00:00Z',
    r => r.nextReviewAt = '2026-11-02T04:59:59Z',
    r => r.sourceChecks = [],
    r => r.sourceChecks[0].url = 'https://medical.example.org/other',
    r => r.sourceChecks[0].checkedAt = '2026-01-01T03:00:00Z',
    r => r.sourceChecks[0].supportsAnswer = false,
    r => r.koreanContextReviewed = false,
    r => r.editorial = {},
  ]) {
    const record = reviewRecord(c.questions[0]); mutate(record);
    assert.equal(audit(c, [record]).summary.publicationEligible, 0);
  }
  const record = reviewRecord(c.questions[0]);
  assert.equal(audit(c, [record, { ...record, decision: 'changes_requested' }]).summary.publicationEligible, 0);
  assert.throws(() => audit(c, [{ ...record, questionId: 'A999' }]), /Unknown reviewed question/);
});

test('missing source metadata blocks an otherwise complete record and an invalid future access date is not counted', () => {
  const c = content(), record = reviewRecord(c.questions[0]); c.medicalSources = [];
  const report = auditContentReview(c, { asOf: now, ledger: { reviews: [record] }, sourceChecks: { checks: [{ url: source.url, status: 'read', checkedAt: '2027-01-01T00:00:00Z' }] } });
  assert.equal(report.summary.publicationEligible, 0);
  assert.equal(report.summary.sourceMetadataComplete, 0);
  assert.equal(report.summary.sourcesReopened, 0);
});

test('review routes are noindex and absent from public sitemaps, with escaped traceable evidence', () => {
  const c = content(); c.questions[0].question = '<img src=x onerror=alert(1)>'; c.medicalSources[0].publisher = '<script>unsafe</script>';
  const pages = new Map(), files = new Map();
  registerContentPage({ bundle: { content: c, evidence: {}, review: audit(c) }, page: (route, options) => pages.set(route, options), put: (name, value) => files.set(name, value) });
  for (const route of pages.keys()) {
    assert(robotsMeta(route, true).startsWith('noindex'));
    assert(!sitemapXml([...pages.keys()], 'https://dentaldatalab.com', true).includes(route));
  }
  const html = pages.get('/questions/review/').body;
  assert(html.includes('&lt;img')); assert(html.includes('&lt;script&gt;unsafe'));
  assert(!html.includes('<script>unsafe'));
  assert(html.includes('검토 기록 대기'));
  assert(html.includes('#review-A001')); assert(html.includes('#S001'));
  const report = JSON.parse(files.get('data/content/review-audit.json'));
  assert.equal(report.questions[0].reviewedAt, null);
});

test('the actual package has 100 pending clinical reviews and distinguishes 8 source reopens from 59 recorded sources', () => {
  const { content: c, review } = loadContent(fileURLToPath(new URL('../', import.meta.url)), { asOf: now });
  assert.equal(c.questions.length, 100);
  assert.equal(review.summary.sources, 59);
  assert.equal(review.summary.sourceMetadataComplete, 59);
  assert.equal(review.summary.sourcesReopened, 8);
  assert.equal(review.summary.sourcesNotReopened, 51);
  assert.equal(review.summary.clinicalApproved, 0);
  assert.equal(review.summary.publicationEligible, 0);
  assert.equal(review.summary.pending, 100);
  assert(review.questions.every(q => q.reviewedAt === null && q.reviewer === null));
});
