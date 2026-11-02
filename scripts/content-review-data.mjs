import { createHash } from 'node:crypto';

export const REVIEW_POLICY = {
  version: 1, sourceCheckMaxAgeDays: 90, reviewMaxAgeDays: 366,
  note: '서비스의 편집 운영 기준입니다. 법정 검토 주기나 의료적 유효기간을 뜻하지 않습니다. 기록 조건 충족은 자동 게시 또는 검색 노출 허용이 아닙니다.',
};
const day = 86400000;
const text = value => typeof value === 'string' && value.trim().length > 0;
export function publicSourceUrl(value) {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !u.port && u.hostname.includes('.') && !/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/i.test(u.hostname) && !/^172\.(?:1[6-9]|2\d|3[01])\./.test(u.hostname); }
  catch { return false; }
}
function validTime(value, now) {
  if (!text(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const ms = Date.parse(value), [y, m, d, h, min, sec] = value.slice(0, 19).split(/[-T:]/).map(Number);
  return Number.isFinite(ms) && ms <= now && m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && h < 24 && min < 60 && sec < 60;
}
export function contentRevision(question) {
  const fields = ['id', 'category', 'keyword', 'question', 'hookTitle', 'intent', 'answer', 'answerSources', 'editorialPriority', 'priorityReason'];
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(fields.map(key => [key, question[key]])))).digest('hex');
}

export function auditContentReview(content, { ledger = {}, sourceChecks = {}, asOf = new Date().toISOString() } = {}) {
  const now = Date.parse(asOf);
  if (!validTime(asOf, now)) throw new Error('Content audit requires a valid explicit timestamp');
  if (ledger.schemaVersion !== undefined && ledger.schemaVersion !== 1) throw new Error('Unknown clinical review ledger version');
  const ids = new Set(content.questions.map(q => q.id));
  const reviews = new Map();
  for (const review of ledger.reviews ?? []) {
    if (!ids.has(review.questionId)) throw new Error(`Unknown reviewed question: ${review.questionId}`);
    if (!reviews.has(review.questionId)) reviews.set(review.questionId, []);
    reviews.get(review.questionId).push(review);
  }
  const catalog = new Map((content.medicalSources ?? []).map(s => [s.url, s]));
  const urls = [...new Set(content.questions.flatMap(q => q.answerSources.map(s => s.url)))].sort();
  const sources = urls.map((url, index) => {
    const record = catalog.get(url);
    const observations = (sourceChecks.checks ?? []).filter(s => s.url === url && ['read', 'blocked', 'unavailable'].includes(s.status) && validTime(s.checkedAt, now)).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt));
    const latest = observations[0];
    return { id: `S${String(index + 1).padStart(3, '0')}`, url,
      title: record?.title ?? content.questions.flatMap(q => q.answerSources).find(s => s.url === url)?.title ?? '제목 미기록',
      publisher: record?.publisher ?? null, catalogCheckedAt: record?.checkedAt ?? null,
      catalogComplete: Boolean(publicSourceUrl(url) && text(record?.title) && text(record?.publisher) && validTime(record?.checkedAt, now)),
      latestAccessCheck: latest ? { status: latest.status, checkedAt: latest.checkedAt, method: latest.method, note: latest.note ?? '', sourcePageReviewedAt: latest.sourcePageReviewedAt ?? null } : null,
      questionIds: content.questions.filter(q => q.answerSources.some(s => s.url === url)).map(q => q.id),
    };
  });
  const sourceMap = new Map(sources.map(s => [s.url, s]));
  const questions = content.questions.map(question => {
    const blockers = [], add = (code, label) => { if (!blockers.some(b => b.code === code)) blockers.push({ code, label }); };
    const revision = contentRevision(question), records = reviews.get(question.id) ?? [], review = records.length === 1 ? records[0] : null;
    if (question.answerSources.some(s => !sourceMap.get(s.url)?.catalogComplete)) add('source_metadata', '출처의 발행기관·제목·원문 확인일 보완');
    if (!records.length) add('clinical_review_missing', '치과의사의 실제 문안 검토 및 기록 필요');
    else if (records.length !== 1) add('ambiguous_review', '중복 검토 기록 정리 필요');
    if (review) {
      if (review.decision !== 'approved') add('clinical_not_approved', review.decision === 'changes_requested' ? '의료진이 요청한 수정·재검토 필요' : '의료진 승인 기록 필요');
      if (review.contentRevision !== revision) add('revision_changed', '현재 질문·제목·답변 문안으로 재검토 필요');
      const person = review.reviewer ?? {};
      if (!text(person.name) || person.profession !== 'dentist' || !text(person.qualification) || !publicSourceUrl(person.credentialEvidenceUrl) || person.credentialVerified !== true || !validTime(person.credentialCheckedAt, now) || !text(person.credentialVerifiedBy)) add('reviewer_evidence', '치과의사 검토자와 자격 확인 근거 필요');
      if (!validTime(review.reviewedAt, now) || !publicSourceUrl(review.reviewEvidenceUrl)) add('review_date_evidence', '실제 의료진 검토일과 검토 기록 근거 필요');
      const at = Date.parse(review.reviewedAt), next = Date.parse(review.nextReviewAt);
      if (!validTime(review.nextReviewAt, Infinity) || next <= now || next <= at || next - at > REVIEW_POLICY.reviewMaxAgeDays * day || now - at > REVIEW_POLICY.reviewMaxAgeDays * day) add('review_due', '다음 검토일 지정 또는 기한 지난 문안 재검토 필요');
      if (validTime(person.credentialCheckedAt, now) && Date.parse(person.credentialCheckedAt) > at) add('reviewer_evidence', '검토 이전의 자격 확인 근거 필요');
      for (const citation of question.answerSources) {
        const checks = (review.sourceChecks ?? []).filter(s => s.url === citation.url);
        const check = checks.length === 1 ? checks[0] : null;
        if (!check || check.supportsAnswer !== true || !text(check.locator) || !text(check.rationale) || !validTime(check.checkedAt, at) || at - Date.parse(check.checkedAt) > REVIEW_POLICY.sourceCheckMaxAgeDays * day) add('claim_support', '인용별 해당 절·답변 뒷받침 범위와 예외 검토 필요');
      }
      if (review.titleReviewed !== true || review.koreanContextReviewed !== true || review.patientSafetyReviewed !== true) add('clinical_scope', '제목·한국 적용 조건·환자 안전 문구 검토 필요');
      const editorial = review.editorial ?? {};
      if (editorial.decision !== 'approved' || !text(editorial.reviewedBy) || !validTime(editorial.reviewedAt, now) || Date.parse(editorial.reviewedAt) < at || !publicSourceUrl(editorial.evidenceUrl)) add('editorial_review', '의료 검토 후 편집 승인과 근거 기록 필요');
    } else add('claim_support', '인용별 답변 뒷받침 범위·한국 적용 조건 검토 필요');
    const clinicalApproved = Boolean(review && !blockers.some(b => b.code !== 'editorial_review'));
    return { id: question.id, category: question.category, question: question.question, contentRevision: revision,
      sourceIds: question.answerSources.map(s => sourceMap.get(s.url).id), sourceUrls: question.answerSources.map(s => s.url),
      clinicalReviewStatus: clinicalApproved ? 'approved_record_present' : review?.decision === 'changes_requested' ? 'changes_requested' : 'pending',
      reviewer: clinicalApproved ? { name: review.reviewer.name, qualification: review.reviewer.qualification } : null,
      reviewedAt: clinicalApproved ? review.reviewedAt : null, nextReviewAt: clinicalApproved ? review.nextReviewAt : null,
      publicationEligible: blockers.length === 0, blockers,
    };
  });
  return { schemaVersion: 1, auditedAt: asOf, policy: REVIEW_POLICY,
    scope: '보관 중인 문안·출처 메타데이터·별도 검토 기록의 감사입니다. 원문 페이지 열람은 의료진 검토나 모든 문장의 근거 검증을 뜻하지 않습니다.',
    indexable: false, publicationMode: 'draft_only',
    summary: { total: questions.length, sources: sources.length, sourceMetadataComplete: sources.filter(s => s.catalogComplete).length,
      sourcesReopened: sources.filter(s => s.latestAccessCheck?.status === 'read').length,
      sourcesNotReopened: sources.filter(s => !s.latestAccessCheck).length,
      clinicalApproved: questions.filter(q => q.clinicalReviewStatus === 'approved_record_present').length,
      publicationEligible: questions.filter(q => q.publicationEligible).length, pending: questions.filter(q => !q.publicationEligible).length },
    categories: content.categories.map(c => ({ ...c, clinicalApproved: questions.filter(q => q.category === c.id && q.clinicalReviewStatus === 'approved_record_present').length, pending: questions.filter(q => q.category === c.id && !q.publicationEligible).length })),
    questions, sources,
  };
}
