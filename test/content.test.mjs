import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prepareContent, loadContent, contentText } from '../scripts/content-data.mjs';
import { registerContentPage } from '../scripts/content-pages.mjs';
import { matchesQuestion } from '../src/content-studio.mjs';

const sample = overrides => ({ id: 'A001', category: 'implant', keyword: '임플란트 비용', question: '임플란트 비용은 어떻게 비교하나요?', hookTitle: '견적에서 확인할 비용 항목', intent: '비용', answer: '포함 항목을 확인하세요.', answerSources: [{ url: 'https://example.org', title: '출처' }], clinicalReviewStatus: 'pending', editorialPriority: 'P1', priorityReason: '비교 기준이 필요합니다.', ...overrides });
const evidence = { autocomplete: { observations: [{ id: 'o1', category: 'implant', seed: '임플란트', source: 'google_autocomplete', status: 'observed', suggestions: ['임플란트 비용'] }], keywords: [{ keyword: '임플란트 비용', sourceObservationIds: ['o1'] }] } };
const make = (questions, input = evidence) => prepareContent([{ questions }], input, { expectedCount: questions.length });

test('actual autocomplete matches, seed-based questions and editorial-only topics stay separate', () => {
  const c = make([sample(), sample({ id: 'A002', keyword: '임플란트비용', question: '띄어쓰기가 다른 질문' }), sample({ id: 'A003', category: 'safety', keyword: '치과 무서움', question: '다른 주제 질문' })]);
  assert.deepEqual(c.questions.map(q => q.demandEvidence.level), ['exact_autocomplete', 'seed_only', 'editorial']);
  assert(c.questions.every(q => q.searchRank === null && q.avgMonthlySearches === null));
  assert.equal(c.summary.exactAutocomplete, 1);
  assert.equal(c.rankingStatus, 'not_measured');
  const forged = structuredClone(evidence); forged.autocomplete.observations[0].suggestions = ['다른 단어'];
  assert.equal(make([sample()], forged).questions[0].demandEvidence.level, 'seed_only');
  forged.autocomplete.observations[0].status = 'access_restricted';
  assert.equal(make([sample()], forged).questions[0].demandEvidence.level, 'editorial');
});

test('duplicates, absent medical sources and unearned clinical review fail instead of silently publishing', () => {
  assert.throws(() => make([sample(), sample()]), /Duplicate/);
  assert.throws(() => make([sample({ answerSources: [] })]), /medical source/);
  assert.throws(() => make([sample({ answerSources: [{ title: 'bad', url: 'javascript:alert(1)' }] })]), /medical source/);
  assert.throws(() => make([sample({ clinicalReviewStatus: 'approved' })]), /Clinical review/);
});

test('content export preserves evidence and plain text; page escapes questions and has no ranking schema', () => {
  const c = make([sample({ hookTitle: '<img onerror=alert(1)>', answer: '답변 <script>bad</script>' })]);
  let html; const files = new Map();
  const pages = new Map();
  registerContentPage({ bundle: { content: c, evidence: {} }, page: (route, opts) => { pages.set(route, opts); assert.equal(opts.schema, undefined); }, put: (name, value) => files.set(name, value) });
  html = pages.get('/questions/').body;
  assert(pages.has('/questions/review/'));
  assert(html.includes('&lt;img'));
  assert(!html.includes('<script>bad'));
  assert(html.includes('검색량 순위는 아직 확인하지 않았습니다'));
  assert(contentText(c).includes('월간 검색량: 미확인'));
  assert.equal(JSON.parse(files.get('data/content/questions-100.json')).questions.length, 1);
  assert.equal(files.get('data/content/keyword-planner-seeds.txt').trim(), '임플란트 비용');
});

test('question filters combine intent, evidence, category and text without treating zero matches as failure', () => {
  const q = { text: '임플란트 비용 포함 항목', category: 'implant', intent: '비용', evidence: 'seed_only', priority: 'P1' };
  assert(matchesQuestion(q, { q: '임플란트 항목', category: 'implant', intent: '비용' }));
  assert(!matchesQuestion(q, { evidence: 'exact_autocomplete' }));
  assert(!matchesQuestion(q, { q: '사랑니' }));
  assert(matchesQuestion(q, {}));
});

test('the real content package contains exactly 100 distinct source-backed questions in ten categories', () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const bundle = loadContent(root);
  assert(bundle, 'Both authored batches and search evidence must be present');
  const c = bundle.content;
  assert.equal(c.questions.length, 100);
  assert(c.categories.every(cat => cat.count === 10));
  assert(c.questions.every(q => q.clinicalReviewStatus === 'pending' && q.searchRank === null && q.avgMonthlySearches === null));
  const raw = JSON.parse(fs.readFileSync(new URL('../data/content/search-evidence.json', import.meta.url), 'utf8'));
  assert.equal(raw.autocomplete.seeds.length, 20);
  assert.equal(c.summary.total, c.summary.exactAutocomplete + c.summary.seedOnly + c.summary.editorialOnly);
  const catalog = new Map(c.medicalSources.map(s => [s.url, s]));
  for (const q of c.questions) {
    assert(q.answerSources.length > 0);
    for (const source of q.answerSources) assert(catalog.get(source.url)?.checkedAt, `Missing source observation date: ${source.url}`);
  }
});
