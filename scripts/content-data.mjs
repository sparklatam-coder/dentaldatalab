import fs from 'node:fs';
import path from 'node:path';
import { auditContentReview, publicSourceUrl } from './content-review-data.mjs';

export const CATEGORIES = [
  ['implant', '임플란트'], ['orthodontics', '치아교정'], ['caries', '충치·레진·인레이'],
  ['endodontics', '신경치료'], ['extraction', '사랑니·발치'], ['prosthetics', '크라운·브릿지·틀니'],
  ['periodontal', '스케일링·잇몸치료'], ['cosmetic', '미백·라미네이트'],
  ['pediatric', '소아·예방치료'], ['safety', '치과공포·응급·치료안전'],
].map(([id, label]) => ({ id, label }));
export const INTENTS = ['비용', '통증', '치료 선택', '치료 과정', '회복·관리', '보험', '응급'];
export const EVIDENCE_LABELS = {
  exact_autocomplete: '검색어 일치 · 자동완성 관찰', seed_only: '분류의 자동완성만 확인 · 편집 질문', editorial: '편집 제안 · 검색 신호 미확인',
};
const FORMATS = { 비용: '견적 체크리스트', 통증: '경과와 진료 필요 신호', '치료 선택': '선택 기준 비교', '치료 과정': '치료 단계 설명', '회복·관리': '회복 중 확인할 사항', 보험: '적용 조건 확인', 응급: '우선 행동 안내' };
export const normalizeKeyword = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const safeUrl = publicSourceUrl;

export function prepareContent(batches, evidence = {}, { expectedCount = 100 } = {}) {
  const questions = batches.flatMap(batch => batch.questions ?? []);
  if (questions.length !== expectedCount) throw new Error(`Expected ${expectedCount} questions, got ${questions.length}`);
  const ids = new Set(), keywords = new Set(), titles = new Set();
  const observations = new Map((evidence.autocomplete?.observations ?? []).filter(o => o.status === 'observed' && o.source === 'google_autocomplete' && Array.isArray(o.suggestions)).map(o => [o.id, o]));
  const exactKeywords = new Map((evidence.autocomplete?.keywords ?? []).map(k => [normalizeKeyword(k.keyword), k]));
  const rows = questions.map(question => {
    if (!/^A\d{3}$/.test(question.id) || ids.has(question.id)) throw new Error(`Duplicate/invalid content ID: ${question.id}`);
    ids.add(question.id);
    if (!CATEGORIES.some(c => c.id === question.category)) throw new Error(`Unknown category: ${question.category}`);
    if (!INTENTS.includes(question.intent)) throw new Error(`Unknown intent: ${question.intent}`);
    const keyword = normalizeKeyword(question.keyword);
    if (!keyword || keywords.has(keyword)) throw new Error(`Duplicate/empty keyword: ${keyword}`);
    keywords.add(keyword);
    for (const field of ['question', 'hookTitle', 'answer', 'priorityReason']) if (typeof question[field] !== 'string' || !question[field].trim()) throw new Error(`Missing ${field}: ${question.id}`);
    if (titles.has(normalizeKeyword(question.question))) throw new Error(`Duplicate question: ${question.id}`);
    titles.add(normalizeKeyword(question.question));
    if (!['P1', 'P2', 'P3'].includes(question.editorialPriority)) throw new Error(`Invalid editorial priority: ${question.id}`);
    if (question.clinicalReviewStatus !== 'pending') throw new Error(`Clinical review was not supplied: ${question.id}`);
    if (!question.answerSources?.length || question.answerSources.some(s => !safeUrl(s.url) || !s.title)) throw new Error(`Missing/unsafe medical source: ${question.id}`);
    const hit = exactKeywords.get(keyword);
    // A keyword is observed only when the recorded response actually contains it.
    const exactObservations = (hit?.sourceObservationIds ?? []).map(id => observations.get(id)).filter(o => o && (o.suggestions ?? []).some(s => normalizeKeyword(s) === keyword));
    const seedObservations = [...observations.values()].filter(o => o.category === question.category && o.suggestions?.length);
    const matches = exactObservations.length ? exactObservations : seedObservations;
    const level = exactObservations.length ? 'exact_autocomplete' : seedObservations.length ? 'seed_only' : 'editorial';
    return {
      ...question, keyword, searchRank: null, avgMonthlySearches: null,
      suggestedFormat: FORMATS[question.intent],
      demandEvidence: { level, label: EVIDENCE_LABELS[level], observationIds: matches.map(o => o.id), seeds: [...new Set(matches.map(o => o.seed))], note: level === 'exact_autocomplete' ? '이 검색어를 자동완성 응답에서 관찰했습니다. 검색량·인기도 순위나 질문 문장 자체의 검색 빈도는 확인하지 않았습니다.' : level === 'seed_only' ? '이 치료 분류의 시작 검색어에서 자동완성을 관찰했습니다. 이 세부 검색어·질문의 수요를 직접 확인한 것은 아닙니다.' : '환자의 의사결정을 돕기 위한 편집 제안입니다. 검색 수요 근거는 아직 없습니다.' },
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  if (expectedCount === 100) {
    for (let n = 1; n <= 100; n++) if (!ids.has(`A${String(n).padStart(3, '0')}`)) throw new Error(`Missing content ID: A${n}`);
    for (const c of CATEGORIES) if (rows.filter(q => q.category === c.id).length !== 10) throw new Error(`Expected ten questions in ${c.id}`);
  }
  const firstBatch = CATEGORIES.map(c => rows.find(q => q.category === c.id && q.editorialPriority === 'P1') ?? rows.find(q => q.category === c.id)).filter(Boolean).map(q => q.id);
  const citedUrls = new Set(rows.flatMap(q => q.answerSources.map(s => s.url)));
  const medicalSources = [...new Map(batches.flatMap(batch => batch.sources ?? []).filter(s => citedUrls.has(s.url)).map(s => [s.url, s])).values()];
  return {
    schemaVersion: 1, preparedAt: '2026-11-01', market: { country: 'KR', language: 'ko', audience: '한국 거주 환자·보호자' },
    title: '치과치료 검색 키워드·질문 100개',
    rankingStatus: 'not_measured', clinicalReviewStatus: 'pending',
    method: 'Google 한국어 자동완성의 관찰 신호와 환자 의사결정 관점을 바탕으로 편집한 질문입니다. 검색량 상위 100위 목록이 아니며 번호는 편집 ID입니다. P1/P2/P3는 제작 우선순위이고 검색량 순위가 아닙니다.',
    categories: CATEGORIES.map(c => ({ ...c, count: rows.filter(q => q.category === c.id).length })),
    summary: { total: rows.length, exactAutocomplete: rows.filter(q => q.demandEvidence.level === 'exact_autocomplete').length, seedOnly: rows.filter(q => q.demandEvidence.level === 'seed_only').length, editorialOnly: rows.filter(q => q.demandEvidence.level === 'editorial').length, medicalSourceCount: new Set(rows.flatMap(q => q.answerSources.map(s => s.url))).size },
    firstBatch, medicalSources, questions: rows,
  };
}

export function loadContent(root, { asOf } = {}) {
  const dir = path.join(root, 'data/content');
  const parts = ['questions-01.json', 'questions-02.json', 'search-evidence.json'];
  if (!parts.every(file => fs.existsSync(path.join(dir, file)))) return null;
  const [a, b, evidence] = parts.map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  const readOptional = file => fs.existsSync(path.join(dir, file)) ? JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) : {};
  const content = prepareContent([a, b], evidence);
  const review = auditContentReview(content, { ledger: readOptional('review-ledger.json'), sourceChecks: readOptional('review-source-checks.json'), ...(asOf ? { asOf } : {}) });
  return { content, evidence, review };
}

export function contentText(content) {
  return `${content.title}\n대상: 한국·한국어·환자용 | 작성: ${content.preparedAt}\n${content.method}\n답변은 의료진 검토 전 편집 초안이며 개인별 진단·치료 지시가 아닙니다.\n\n` + content.questions.map(q => `${q.id} | ${content.categories.find(c => c.id === q.category).label} | ${q.intent}\n검색어: ${q.keyword}\n질문: ${q.question}\n후킹 제목: ${q.hookTitle}\n답변: ${q.answer}\n제작 우선순위: ${q.editorialPriority} — ${q.priorityReason}\n검색 근거: ${q.demandEvidence.label}. ${q.demandEvidence.note}\n월간 검색량: 미확인 / 검색량 순위: 미확인\n출처: ${q.answerSources.map(s => `${s.title} (${s.url})`).join(' ; ')}\n`).join('\n');
}
