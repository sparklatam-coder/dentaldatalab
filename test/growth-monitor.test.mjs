import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ORIGIN, STATUS, NOT_IN_TOP10, loadDefinition, definitionProblems, drawNameSample, checkDefinition, buildTemplate,
  aiCellProblems, nameCellProblems, observationProblems, validateObservation, combineStatuses, evaluateCriterion,
  summarizeMonth, summarize, belowGateRun, formatSummary, isSiteUrl, isOtherDomain, previousMonth, nextMonth,
} from '../scripts/growth-monitor.mjs';
import { registerAnswerPages } from '../scripts/answer-pages.mjs';
import { registerHospitalPages } from '../scripts/hospital-pages.mjs';
import { REPORTS } from '../scripts/report-pages.mjs';
import { YANGJU_REPORT_ROUTE } from '../scripts/yangju-analysis.mjs';
import { isIndexableRoute } from '../scripts/seo.mjs';

const { MET, NOT_MET, NOT_MEASURED } = STATUS;
const SCRIPT = fileURLToPath(new URL('../scripts/growth-monitor.mjs', import.meta.url));
const def = loadDefinition();
const copy = value => JSON.parse(JSON.stringify(value));
let clinicsCache;
const clinicsData = () => (clinicsCache ??= JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8')));

const AI = def.engines.aiCitation.map(e => e.id);
const NAME = def.engines.nameSearch.map(e => e.id);
const cited = (urls, others = [], note = null) => ({ answerShown: true, cited: true, citedUrls: urls, otherDomains: others, note });
const notCited = (others = []) => ({ answerShown: true, cited: false, citedUrls: [], otherDomains: others, note: null });
const noAnswer = () => ({ answerShown: false, cited: false, citedUrls: [], otherDomains: [], note: null });
const ownPage = id => `${ORIGIN}/clinics/${id}/`;

/** A recorded month: gate inputs, and per name-search engine how many of the 30 names are in the top 10. */
function recorded(month, { inputs = {}, top10 = {}, measuredNames = 30 } = {}) {
  const obs = buildTemplate(def, month);
  obs.observedOn = month + '-15';
  obs.observer = 'tester';
  Object.assign(obs.gateInputs, inputs);
  for (const [engine, hits] of Object.entries(top10)) {
    obs.conditions[engine] = '로그아웃 · 시크릿 창 · 데스크톱';
    obs.nameSearch.slice(0, measuredNames).forEach((row, i) => { row.cells[engine] = i < hits ? { rank: (i % 10) + 1, url: ownPage(row.id) } : { rank: NOT_IN_TOP10, url: null }; });
  }
  return validateObservation(obs, def, { month });
}

test('the definition fixes 20 unique questions, the engines, the four gates and the two-month stop rule', () => {
  assert.deepEqual(definitionProblems(def), []);
  assert.equal(def.aiQuestions.length, 20);
  assert.equal(new Set(def.aiQuestions.map(q => q.id)).size, 20);
  assert.equal(new Set(def.aiQuestions.map(q => q.question)).size, 20);
  assert.deepEqual(def.aiQuestions.map(q => q.id), Array.from({ length: 20 }, (_, i) => 'q' + String(i + 1).padStart(2, '0')));
  for (const q of def.aiQuestions) assert.match(q.question, /[가-힣].*[?.]$/, q.id + ' is a Korean sentence a person would ask');
  assert.deepEqual(AI, ['chatgpt', 'googleAiOverview', 'naverAiBriefing']);
  assert.deepEqual(NAME, ['google', 'naver']);
  const intents = new Set(def.aiQuestions.map(q => q.intent));
  for (const intent of ['national-count', 'hospital-vs-clinic', 'bed-requirement', 'copay', 'referral', 'disability-care', 'districts-without-hospital', 'regional-list', 'data-source', 'condition-hours']) assert.ok(intents.has(intent), 'covers ' + intent);
  assert.ok(def.aiQuestions.filter(q => q.intent === 'regional-list').length >= 3);
  assert.ok(def.aiQuestions.filter(q => q.intent === 'condition-hours').length >= 3);

  assert.deepEqual(def.gateInputs.map(g => g.id), ['bingSiteResults', 'naverCollectedPages', 'referringDomains', 'handoffClicks']);
  assert.deepEqual(def.phaseGates.map(g => [g.phase, g.name]), [[0, '색인 기반'], [1, '정본화'], [2, '링크 엔진'], [3, '환자 유입']]);
  assert.deepEqual(def.phaseGates[0].criteria, [{ type: 'inputAtLeast', input: 'bingSiteResults', min: 1 }, { type: 'inputAtLeast', input: 'naverCollectedPages', min: 1000 }]);
  assert.deepEqual(def.phaseGates[1].criteria.map(c => [c.type, c.engine, c.minPercent, c.minMeasured]), [['nameSearchTop10Share', 'google', 30, 30], ['nameSearchTop10Share', 'naver', 30, 30]]);
  assert.deepEqual(def.phaseGates[2].criteria, [{ type: 'inputAtLeast', input: 'referringDomains', min: 20 }]);
  assert.deepEqual(def.phaseGates[3].criteria, [{ type: 'inputIncreasedFromPreviousMonth', input: 'handoffClicks' }]);
  assert.equal(def.stopRule.maxMonthsBelowGate, 2);
  assert.match(def.stopRule.text, /두 달 넘게/);
});

test('every expectedPath is an indexable route that the current page code registers', () => {
  const { clinics, snapshotDate } = clinicsData();
  const routes = new Set([...REPORTS.map(r => `/reports/${r.slug}/`), YANGJU_REPORT_ROUTE]);
  const page = route => routes.add(route);
  registerHospitalPages({ page, clinics, domain: ORIGIN, snapshotDate });
  registerAnswerPages({ page, clinics, snapshotDate });
  // The home and /data/ pages are registered inline by the build script.
  const build = fs.readFileSync(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  for (const route of ['/', '/data/']) if (build.includes(`page('${route}',`)) routes.add(route);
  for (const q of def.aiQuestions) {
    assert.ok(routes.has(q.expectedPath), `${q.id} ${q.expectedPath} is not a registered route`);
    assert.ok(isIndexableRoute(q.expectedPath), `${q.id} ${q.expectedPath} is not indexable`);
  }
  assert.equal(checkDefinition(def, { routes: [...routes] }).expectedPaths.status, 'ok');
});

test('the name sample is 30 unique 종별코드 41 institutions reproducible from the documented rule', t => {
  const { rule, institutions } = def.nameSearchSample;
  assert.equal(institutions.length, 30);
  assert.equal(new Set(institutions.map(c => c.id)).size, 30);
  assert.deepEqual([rule.typeCode, rule.sortBy, rule.size], ['41', 'id', 30]);
  const data = clinicsData();
  if (data.snapshotDate !== rule.snapshotDate) return t.skip(`data/clinics.json is now ${data.snapshotDate}; the sample stays as drawn from ${rule.snapshotDate}`);
  const hospitals = data.clinics.filter(c => c.typeCode === '41');
  assert.equal(rule.population, hospitals.length);
  assert.deepEqual(institutions, drawNameSample(data.clinics));
  const byId = new Map(data.clinics.map(c => [c.id, c]));
  for (const c of institutions) assert.deepEqual([byId.get(c.id)?.typeCode, byId.get(c.id)?.name, byId.get(c.id)?.sido], ['41', c.name, c.sido]);
  assert.deepEqual(checkDefinition(def, { clinics: data.clinics }).sampleInstitutions, { status: 'ok', checked: 30, problems: [] });
});

test('the sampling rule is deterministic and independent of input order', () => {
  const pool = Array.from({ length: 95 }, (_, i) => ({ id: 'c-' + String((i * 37) % 95).padStart(12, '0'), name: i % 19 === 0 ? '같은이름치과병원' : `치과병원${i}`, typeCode: i % 5 === 0 ? '51' : '41', sido: '서울', city: '중구' }));
  const sample = drawNameSample(pool, { size: 10 });
  assert.deepEqual(sample, drawNameSample([...pool].reverse(), { size: 10 }));
  const sorted = pool.filter(c => c.typeCode === '41').map(c => c.id).sort();
  assert.deepEqual(sample.map(c => c.id), Array.from({ length: 10 }, (_, i) => sorted[Math.floor(i * sorted.length / 10)]));
  assert.equal(new Set(sample.map(c => c.id)).size, 10);
  assert.ok(sample.every(c => c.sameNameCount >= 1));
  assert.throws(() => drawNameSample(pool.slice(0, 5), { size: 10 }), /cannot draw/);
  assert.throws(() => drawNameSample(null), TypeError);
});

test('a broken definition is refused with the reason', () => {
  const broken = change => { const d = copy(def); change(d); return definitionProblems(d).join('\n'); };
  assert.match(broken(d => d.aiQuestions.pop()), /exactly 20 questions/);
  assert.match(broken(d => { d.aiQuestions[1].question = d.aiQuestions[0].question; }), /question texts must be unique/);
  assert.match(broken(d => { d.aiQuestions[0].expectedPath = '/find/'; }), /indexable route/);
  assert.match(broken(d => { d.aiQuestions[0].expectedPath = '/data/?x=1'; }), /indexable route/);
  assert.match(broken(d => d.nameSearchSample.institutions.pop()), /exactly 30 institutions/);
  assert.match(broken(d => { d.nameSearchSample.institutions[1].id = d.nameSearchSample.institutions[0].id; }), /ids must be unique/);
  assert.match(broken(d => { d.phaseGates[1].criteria[0].engine = 'bing'; }), /name-search engine/);
  assert.match(broken(d => { d.phaseGates[0].criteria[0].input = 'unknown'; }), /must name a gate input/);
  assert.match(broken(d => { d.stopRule.maxMonthsBelowGate = 0; }), /stopRule/);
  assert.match(broken(d => { d.engines.nameSearch[0].id = 'chatgpt'; }), /unique across both/);
});

test('checkDefinition reports missing routes and changed institutions, and never calls an unchecked part ok', () => {
  assert.deepEqual(checkDefinition(def), {
    expectedPaths: { status: 'not_checked', checked: 0, problems: [] },
    sampleInstitutions: { status: 'not_checked', checked: 0, problems: [] },
    samplePages: { status: 'not_checked', checked: 0, problems: [] },
    problemCount: 0,
  });
  const [a, b, c, ...rest] = def.nameSearchSample.institutions;
  const clinics = [{ ...b, typeCode: '51' }, { ...c, typeCode: '41', name: c.name + ' 본점' }, ...rest.map(x => ({ ...x, typeCode: '41' }))];
  const routes = [...def.aiQuestions.map(q => q.expectedPath).filter(p => p !== '/data/'), ...def.nameSearchSample.institutions.slice(1).map(x => `/clinics/${x.id}/`)];
  const report = checkDefinition(def, { routes, clinics });
  assert.deepEqual(report.expectedPaths.problems, [{ id: 'q16', expectedPath: '/data/', problem: 'route_missing' }]);
  assert.deepEqual(report.sampleInstitutions.problems, [
    { id: a.id, name: a.name, problem: 'missing' },
    { id: b.id, name: b.name, problem: 'type_changed', current: '51' },
    { id: c.id, name: c.name, problem: 'renamed', current: c.name + ' 본점' },
  ]);
  assert.deepEqual(report.samplePages.problems, [{ id: a.id, name: a.name, problem: 'route_missing' }]);
  assert.equal(report.problemCount, 5);
});

test('the template holds every cell and gate input as null and is itself valid', () => {
  const blank = buildTemplate(def, '2026-11');
  assert.equal(blank.month, '2026-11');
  assert.deepEqual([blank.observedOn, blank.observer, blank.notes], [null, null, null]);
  assert.deepEqual(blank.gateInputs, { bingSiteResults: null, naverCollectedPages: null, referringDomains: null, handoffClicks: null });
  assert.deepEqual(blank.conditions, { chatgpt: null, googleAiOverview: null, naverAiBriefing: null, google: null, naver: null });
  assert.deepEqual(blank.aiCitations.map(r => [r.id, r.question]), def.aiQuestions.map(q => [q.id, q.question]));
  assert.deepEqual(blank.nameSearch.map(r => [r.id, r.name]), def.nameSearchSample.institutions.map(c => [c.id, c.name]));
  const aiCells = blank.aiCitations.flatMap(r => AI.map(e => r.cells[e]));
  const nameCells = blank.nameSearch.flatMap(r => NAME.map(e => r.cells[e]));
  assert.deepEqual([aiCells.length, nameCells.length], [60, 60]);
  assert.ok([...aiCells, ...nameCells].every(cell => cell === null));
  assert.deepEqual(observationProblems(blank, def, { month: '2026-11' }), []);
  assert.throws(() => buildTemplate(def, '2026-13'), TypeError);
  assert.throws(() => buildTemplate(def, '2026-1'), TypeError);
});

test('the committed month files are valid, and 2026-11 is the untouched blank template', () => {
  const dir = new URL('../data/content/growth-observations/', import.meta.url);
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.json'));
  assert.ok(files.includes('2026-11.json'));
  for (const name of files) assert.deepEqual(observationProblems(JSON.parse(fs.readFileSync(new URL(name, dir), 'utf8')), def, { month: name.slice(0, 7) }), [], name);
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('2026-11.json', dir), 'utf8')), buildTemplate(def, '2026-11'));
});

test('site URLs and other domains are written in one canonical form', () => {
  for (const ok of [ORIGIN + '/', ORIGIN + '/hospitals/', ownPage('c-000029b3fb02')]) assert.equal(isSiteUrl(ok), true, ok);
  for (const bad of [ORIGIN, 'http://dentaldatalab.com/', 'https://www.dentaldatalab.com/', ORIGIN + '/data/?utm_source=chatgpt.com', ORIGIN + '/data/#:~:text=x', ORIGIN + '/data/?', 'https://dentaldatalab.com.evil.test/', 'dentaldatalab.com/data/', null, 3]) assert.equal(isSiteUrl(bad), false, String(bad));
  for (const ok of ['dailydental.co.kr', 'blog.naver.com', 'my-doctor.io', '치의신보.kr']) assert.equal(isOtherDomain(ok), true, ok);
  for (const bad of ['www.dailydental.co.kr', 'https://dailydental.co.kr', 'dailydental.co.kr/news', 'DailyDental.co.kr', '치의신보', 'dentaldatalab.com', 'www.dentaldatalab.com', ' naver.com', '', null]) assert.equal(isOtherDomain(bad), false, String(bad));
});

test('an AI cell is null or a complete, consistent record; false is never a stand-in for "not measured"', () => {
  assert.deepEqual(aiCellProblems(null), []);
  assert.deepEqual(aiCellProblems(cited([ORIGIN + '/hospitals/'], ['dailydental.co.kr'])), []);
  assert.deepEqual(aiCellProblems(cited([], [], '출처 목록에 “치과데이터랩”이라고만 적힘')), []);
  assert.deepEqual(aiCellProblems(notCited(['hira.or.kr'])), []);
  assert.deepEqual(aiCellProblems(noAnswer()), []);
  const bad = cell => aiCellProblems(cell).join('\n');
  assert.match(bad(false), /must be null or an object/);
  assert.match(bad({}), /must be null or an object/);
  assert.match(bad({ answerShown: true, cited: false }), /must be null or an object/);
  assert.match(bad({ ...notCited(), rank: 1 }), /must be null or an object/);
  assert.match(bad({ ...notCited(), answerShown: null }), /answerShown must be true or false/);
  assert.match(bad({ ...notCited(), cited: 0 }), /cited must be true or false/);
  assert.match(bad(cited(['https://example.com/'])), /citedUrls/);
  assert.match(bad(cited([ORIGIN + '/data/?utm_source=chatgpt.com'])), /citedUrls/);
  assert.match(bad(cited([ORIGIN + '/data/', ORIGIN + '/data/'])), /citedUrls/);
  assert.match(bad(notCited(['https://dailydental.co.kr/'])), /otherDomains/);
  assert.match(bad(notCited(['dentaldatalab.com'])), /otherDomains/);
  assert.match(bad({ ...noAnswer(), otherDomains: ['hira.or.kr'] }), /no AI answer was shown/);
  assert.match(bad({ ...noAnswer(), cited: true, note: 'x' }), /no AI answer was shown/);
  assert.match(bad({ ...notCited(), citedUrls: [ORIGIN + '/data/'] }), /must be empty when cited is false/);
  assert.match(bad(cited([])), /describe the named mention/);
  assert.match(bad({ ...notCited(), note: 3 }), /note must be text or null/);
});

test('a name-search cell is null or {rank 1–10 | not_in_top10, url}', () => {
  const url = ownPage('c-000029b3fb02');
  assert.deepEqual(nameCellProblems(null), []);
  assert.deepEqual(nameCellProblems({ rank: 1, url }), []);
  assert.deepEqual(nameCellProblems({ rank: 10, url: ORIGIN + '/hospitals/380000/' }), []);
  assert.deepEqual(nameCellProblems({ rank: NOT_IN_TOP10, url: null }), []);
  for (const bad of [{ rank: 0, url }, { rank: 11, url }, { rank: '3', url }, { rank: 2.5, url }, { rank: null, url: null }, { rank: false, url: null }, { rank: 3, url: null }, { rank: 3, url: 'https://example.com/' },
    { rank: NOT_IN_TOP10, url }, { rank: 3 }, { rank: 3, url, note: 'x' }, 0, false, 'not_in_top10']) assert.notDeepEqual(nameCellProblems(bad), [], JSON.stringify(bad));
});

test('month files are validated strictly against the fixed definition', () => {
  const problems = change => { const obs = copy(recorded('2026-11', { inputs: { bingSiteResults: 0 }, top10: { google: 3 } })); change(obs); return observationProblems(obs, def, { month: '2026-11' }).join('\n'); };
  assert.equal(problems(() => {}), '');
  assert.match(problems(o => { o.extra = 1; }), /exactly/);
  assert.match(problems(o => { delete o.notes; }), /exactly/);
  assert.match(problems(o => { o.month = '2026-12'; }), /does not match the file name/);
  assert.match(problems(o => { o.definitionVersion = 2; }), /definitionVersion/);
  assert.match(problems(o => { o.observedOn = '2026-12-01'; }), /inside this month/);
  assert.match(problems(o => { o.observedOn = '2026-11-31'; }), /inside this month/);
  assert.match(problems(o => { o.observedOn = null; }), /observedOn and observer are required/);
  assert.match(problems(o => { o.observer = null; }), /observedOn and observer are required/);
  assert.match(problems(o => { o.conditions.google = null; }), /conditions\.google is required/);
  assert.match(problems(o => { o.aiCitations[0].cells.chatgpt = notCited(); }), /conditions\.chatgpt is required/);
  assert.match(problems(o => { o.gateInputs.bingSiteResults = -1; }), /gateInputs\.bingSiteResults/);
  assert.match(problems(o => { o.gateInputs.naverCollectedPages = '1000'; }), /gateInputs\.naverCollectedPages/);
  assert.match(problems(o => { o.gateInputs.referringDomains = false; }), /gateInputs\.referringDomains/);
  assert.match(problems(o => { delete o.gateInputs.handoffClicks; }), /gateInputs must hold exactly/);
  assert.match(problems(o => { o.aiCitations[2].question += ' '; }), /aiCitations\[q03\]\.question must stay identical/);
  assert.match(problems(o => { o.aiCitations.pop(); }), /all 20 rows/);
  assert.match(problems(o => { o.aiCitations.reverse(); }), /aiCitations\[0\] must be \{id: "q01"/);
  assert.match(problems(o => { delete o.aiCitations[0].cells.naverAiBriefing; }), /cells must hold exactly/);
  assert.match(problems(o => { o.aiCitations[0].cells.chatgpt = false; o.conditions.chatgpt = 'x'; }), /aiCitations\[q01\]\.cells\.chatgpt: must be null or an object/);
  assert.match(problems(o => { o.nameSearch[0].cells.google = { rank: 0, url: null }; }), /nameSearch\[c-000029b3fb02\]\.cells\.google: rank must be/);
  assert.match(problems(o => { o.nameSearch[0].name = '다른치과병원'; }), /name must stay identical/);
  assert.throws(() => validateObservation({}, def, { month: '2026-11' }), /Invalid growth observation 2026-11/);
  // A blank month needs no date; a genuine zero is a value, not a missing one.
  const zero = buildTemplate(def, '2026-11');
  zero.gateInputs.bingSiteResults = 0;
  assert.match(observationProblems(zero, def).join('\n'), /observedOn and observer are required/);
});

test('rates use measured cells only and an unmeasured month reports nothing as zero', () => {
  const blank = summarizeMonth(def, buildTemplate(def, '2026-11'));
  for (const id of AI) assert.deepEqual(blank.aiCitations.engines[id], { label: def.engines.aiCitation.find(e => e.id === id).label, cells: 20, measured: 0, answerShown: null, cited: null, citedExpectedPath: null, citationRate: null });
  for (const id of NAME) assert.deepEqual(blank.nameSearch.engines[id], { label: def.engines.nameSearch.find(e => e.id === id).label, cells: 30, measured: 0, top10: null, ownPage: null, top10Share: null });
  assert.deepEqual(blank.aiCitations.otherDomains, []);
  assert.deepEqual(blank.gates.map(g => g.status), [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]);

  const obs = recorded('2026-11', { top10: { google: 30 } });
  obs.conditions.chatgpt = obs.conditions.googleAiOverview = '로그아웃 · 시크릿 창';
  const [q1, q2, q3, q4] = obs.aiCitations;
  q1.cells.chatgpt = cited([ORIGIN + '/reports/national-data-coverage/'], ['dailydental.co.kr', 'hira.or.kr']);
  q2.cells.chatgpt = cited([ORIGIN + '/reports/dental-hospitals/'], ['dailydental.co.kr']);
  q3.cells.chatgpt = notCited(['dailydental.co.kr', 'law.go.kr']);
  q4.cells.chatgpt = noAnswer();
  q1.cells.googleAiOverview = notCited(['hira.or.kr']);
  q2.cells.googleAiOverview = noAnswer();
  obs.nameSearch.forEach((row, i) => { row.cells.google = i >= 20 ? null : i < 5 ? { rank: i + 1, url: i < 3 ? ownPage(row.id) : ORIGIN + '/hospitals/' } : { rank: NOT_IN_TOP10, url: null }; });
  const month = summarizeMonth(def, validateObservation(obs, def, { month: '2026-11' }));
  assert.deepEqual(month.aiCitations.engines.chatgpt, { label: 'ChatGPT 검색', cells: 20, measured: 4, answerShown: 3, cited: 2, citedExpectedPath: 1, citationRate: 50 });
  assert.deepEqual(month.aiCitations.engines.googleAiOverview, { label: '구글 AI 개요', cells: 20, measured: 2, answerShown: 1, cited: 0, citedExpectedPath: 0, citationRate: 0 });
  assert.equal(month.aiCitations.engines.naverAiBriefing.citationRate, null, 'no measured cell: unknown, not 0%');
  assert.deepEqual(month.aiCitations.otherDomains, [
    { domain: 'dailydental.co.kr', cells: 3, byEngine: { chatgpt: 3 } },
    { domain: 'hira.or.kr', cells: 2, byEngine: { chatgpt: 1, googleAiOverview: 1 } },
    { domain: 'law.go.kr', cells: 1, byEngine: { chatgpt: 1 } },
  ]);
  assert.deepEqual(month.nameSearch.engines.google, { label: '구글 검색', cells: 30, measured: 20, top10: 5, ownPage: 3, top10Share: 25 });
  assert.equal(month.nameSearch.engines.naver.top10Share, null);

  const text = formatSummary(summarize(def, [buildTemplate(def, '2026-11')]));
  assert.match(text, /측정 안 됨/);
  assert.doesNotMatch(text, /\b0(?:\.0)?%/);
  assert.match(text, /판정 불가/);
});

test('gate criteria are three-valued: null is not_measured, a real 0 is not_met', () => {
  const [bing, naver] = def.phaseGates[0].criteria;
  assert.equal(evaluateCriterion(bing, { inputs: { bingSiteResults: null } }).status, NOT_MEASURED);
  assert.equal(evaluateCriterion(bing, {}).status, NOT_MEASURED);
  assert.equal(evaluateCriterion(bing, { inputs: { bingSiteResults: 0 } }).status, NOT_MET);
  assert.equal(evaluateCriterion(bing, { inputs: { bingSiteResults: 1 } }).status, MET);
  assert.equal(evaluateCriterion(naver, { inputs: { naverCollectedPages: 999 } }).status, NOT_MET);
  assert.equal(evaluateCriterion(naver, { inputs: { naverCollectedPages: 1000 } }).status, MET);
  const clicks = def.phaseGates[3].criteria[0];
  assert.equal(evaluateCriterion(clicks, { inputs: { handoffClicks: 10 }, previousInputs: null }).status, NOT_MEASURED);
  assert.equal(evaluateCriterion(clicks, { inputs: { handoffClicks: null }, previousInputs: { handoffClicks: 5 } }).status, NOT_MEASURED);
  assert.equal(evaluateCriterion(clicks, { inputs: { handoffClicks: 10 }, previousInputs: { handoffClicks: 0 } }).status, MET);
  assert.equal(evaluateCriterion(clicks, { inputs: { handoffClicks: 10 }, previousInputs: { handoffClicks: 10 } }).status, NOT_MET);
  const share = def.phaseGates[1].criteria[0];
  const engine = (measured, top10) => ({ nameSearch: { google: { measured, top10: measured ? top10 : null, top10Share: null } } });
  assert.equal(evaluateCriterion(share, engine(30, 9)).status, MET, '9 of 30 is exactly 30%');
  assert.equal(evaluateCriterion(share, engine(30, 8)).status, NOT_MET);
  assert.equal(evaluateCriterion(share, engine(29, 29)).status, NOT_MEASURED, 'the gate is defined on the whole sample');
  assert.equal(evaluateCriterion(share, engine(0, 0)).status, NOT_MEASURED);
  assert.equal(evaluateCriterion({ ...share, minMeasured: 3, minPercent: 30 }, engine(1000, 299)).status, NOT_MET, 'compared on counts, not on a rounded percentage');
  assert.throws(() => evaluateCriterion({ type: 'unknown' }), /Unknown gate criterion/);

  assert.equal(combineStatuses([MET, MET]), MET);
  assert.equal(combineStatuses([MET, NOT_MEASURED]), NOT_MEASURED);
  assert.equal(combineStatuses([NOT_MET, NOT_MEASURED]), NOT_MET, 'one failed part already fails an all-gate');
  assert.equal(combineStatuses([MET, NOT_MEASURED], 'any'), MET);
  assert.equal(combineStatuses([NOT_MET, NOT_MEASURED], 'any'), NOT_MEASURED);
  assert.equal(combineStatuses([NOT_MET, NOT_MET], 'any'), NOT_MET);
});

test('the four phase gates are evaluated per month from the recorded values', () => {
  const statuses = obs => summarizeMonth(def, obs).gates.map(g => g.status);
  assert.deepEqual(statuses(recorded('2026-11', { inputs: { bingSiteResults: 0 } })), [NOT_MET, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]);
  assert.deepEqual(statuses(recorded('2026-11', { inputs: { bingSiteResults: 12 } })), [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED]);
  assert.deepEqual(statuses(recorded('2026-11', { inputs: { bingSiteResults: 12, naverCollectedPages: 1000, referringDomains: 19 }, top10: { google: 9, naver: 9 } })), [MET, MET, NOT_MET, NOT_MEASURED]);
  assert.deepEqual(statuses(recorded('2026-11', { inputs: { referringDomains: 20 }, top10: { google: 30, naver: 8 } })), [NOT_MEASURED, NOT_MET, MET, NOT_MEASURED]);
  assert.deepEqual(statuses(recorded('2026-11', { top10: { google: 30 } })), [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED], 'naver not searched yet');
  assert.deepEqual(statuses(recorded('2026-11', { top10: { google: 29, naver: 29 }, measuredNames: 29 })), [NOT_MEASURED, NOT_MEASURED, NOT_MEASURED, NOT_MEASURED], 'an incomplete sample is not judged');

  const months = summarize(def, [
    recorded('2026-11', { inputs: { handoffClicks: 40 } }),
    recorded('2026-12', { inputs: { handoffClicks: 55 } }),
    recorded('2027-01', { inputs: { handoffClicks: 55 } }),
    recorded('2027-03', { inputs: { handoffClicks: 90 } }),
  ]).months;
  assert.deepEqual(months.map(m => [m.month, m.recorded, m.gates[3].status]), [
    ['2026-11', true, NOT_MEASURED], ['2026-12', true, MET], ['2027-01', true, NOT_MET], ['2027-02', false, NOT_MEASURED], ['2027-03', true, NOT_MEASURED],
  ]);
  assert.deepEqual([previousMonth('2027-01'), nextMonth('2026-12'), previousMonth('2026-03')], ['2026-12', '2027-01', '2026-02']);
});

test('the stop rule applies after more than two measured months below the current gate', () => {
  const run = statuses => belowGateRun(statuses.map((status, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, status })));
  assert.deepEqual(run([]), { consecutiveNotMet: 0, belowSince: null, unmeasuredInRun: 0 });
  assert.deepEqual(run([NOT_MET, NOT_MET]), { consecutiveNotMet: 2, belowSince: '2026-01', unmeasuredInRun: 0 });
  assert.deepEqual(run([NOT_MET, MET, NOT_MET]), { consecutiveNotMet: 1, belowSince: '2026-03', unmeasuredInRun: 0 });
  assert.deepEqual(run([NOT_MET, NOT_MEASURED, NOT_MET, NOT_MEASURED]), { consecutiveNotMet: 2, belowSince: '2026-01', unmeasuredInRun: 2 }, 'an unmeasured month neither counts nor resets');
  assert.deepEqual(run([NOT_MET, NOT_MET, NOT_MET, MET]), { consecutiveNotMet: 0, belowSince: null, unmeasuredInRun: 0 });
  assert.deepEqual(run([NOT_MEASURED, NOT_MEASURED]), { consecutiveNotMet: 0, belowSince: null, unmeasuredInRun: 0 });

  const below = month => recorded(month, { inputs: { bingSiteResults: 0, naverCollectedPages: 120 } });
  const passed = month => recorded(month, { inputs: { bingSiteResults: 40, naverCollectedPages: 2400 }, top10: { google: 4, naver: 2 } });

  assert.deepEqual(summarize(def, []).stopRule, { text: def.stopRule.text, maxMonthsBelowGate: 2, applies: null, phase: null, consecutiveNotMet: null, belowSince: null });
  const blank = summarize(def, [buildTemplate(def, '2026-11')]);
  assert.deepEqual([blank.currentPhase, blank.stopRule.applies, blank.stopRule.consecutiveNotMet], [0, null, 0], 'nothing measured: unknown, not "does not apply"');

  const two = summarize(def, [below('2026-11'), below('2026-12')]);
  assert.deepEqual([two.currentPhase, two.stopRule.applies, two.stopRule.consecutiveNotMet, two.stopRule.belowSince], [0, false, 2, '2026-11']);
  const three = summarize(def, [below('2027-01'), below('2026-11'), below('2026-12')]);
  assert.deepEqual([three.currentPhase, three.stopRule.applies, three.stopRule.consecutiveNotMet, three.stopRule.belowSince], [0, true, 3, '2026-11']);
  assert.match(formatSummary(three), /적용 — 0단계\(색인 기반\) 기준이 3개월 연속 미달\(2026-11부터\)/);
  assert.match(formatSummary(two), /아직 적용 안 됨 — 0단계\(색인 기반\) 미달 연속 2개월/);

  // Passing phase 0 moves the rule to phase 1; its own run starts where phase 1 was first measured below the gate.
  const advanced = summarize(def, [below('2026-11'), below('2026-12'), below('2027-01'), passed('2027-02'), passed('2027-03')]);
  assert.deepEqual(advanced.phases.map(p => [p.latestStatus, p.consecutiveNotMet, p.lastMetMonth]), [[MET, 0, '2027-03'], [NOT_MET, 2, null], [NOT_MEASURED, 0, null], [NOT_MEASURED, 0, null]]);
  assert.deepEqual([advanced.currentPhase, advanced.stopRule.applies, advanced.stopRule.belowSince], [1, false, '2027-02']);
  const stuck = summarize(def, [passed('2027-02'), passed('2027-03'), passed('2027-04')]);
  assert.deepEqual([stuck.currentPhase, stuck.stopRule.applies, stuck.stopRule.consecutiveNotMet], [1, true, 3]);
  // A blank newer month neither undoes the earlier pass of phase 0 nor hides the phase 1 run behind "not measured".
  const pending = summarize(def, [passed('2027-02'), passed('2027-03'), passed('2027-04'), buildTemplate(def, '2027-05')]);
  assert.deepEqual([pending.phases[0].latestStatus, pending.phases[0].lastMeasured, pending.currentPhase, pending.stopRule.applies, pending.stopRule.consecutiveNotMet],
    [NOT_MEASURED, { month: '2027-04', status: MET }, 1, true, 3]);
  const regressed = summarize(def, [passed('2027-02'), below('2027-03')]);
  assert.deepEqual([regressed.currentPhase, regressed.stopRule.applies, regressed.stopRule.consecutiveNotMet], [0, false, 1], 'a gate that is measured below again becomes the current phase');

  // A skipped month (no file) and a blank month are both unmeasured: the run is neither extended nor reset.
  const gap = summarize(def, [below('2026-11'), below('2026-12'), below('2027-02'), buildTemplate(def, '2027-03')]);
  assert.deepEqual(gap.unrecordedMonths, ['2027-01']);
  assert.deepEqual([gap.phases[0].latestStatus, gap.phases[0].consecutiveNotMet, gap.phases[0].unmeasuredInRun, gap.stopRule.applies], [NOT_MEASURED, 3, 2, true]);
  const short = summarize(def, [below('2026-11'), buildTemplate(def, '2026-12'), below('2027-01')]);
  assert.deepEqual([short.phases[0].consecutiveNotMet, short.stopRule.applies], [2, false], 'two measured months below is not yet "more than two"');

  const done = summarize(def, [
    recorded('2026-11', { inputs: { bingSiteResults: 40, naverCollectedPages: 2400, referringDomains: 25, handoffClicks: 10 }, top10: { google: 12, naver: 9 } }),
    recorded('2026-12', { inputs: { bingSiteResults: 40, naverCollectedPages: 2400, referringDomains: 25, handoffClicks: 30 }, top10: { google: 12, naver: 9 } }),
  ]);
  assert.deepEqual([done.currentPhase, done.stopRule.applies, done.stopRule.phase], [null, false, null]);
  assert.match(formatSummary(done), /모든 단계 기준 충족/);
  assert.throws(() => summarize(def, [below('2026-11'), below('2026-11')]), /Two observation files/);
});

test('the summary aggregates other cited domains across months', () => {
  const withDomains = (month, domains) => {
    const obs = recorded(month);
    obs.conditions.naverAiBriefing = '로그아웃';
    obs.aiCitations[0].cells.naverAiBriefing = notCited(domains);
    return validateObservation(obs, def, { month });
  };
  const summary = summarize(def, [withDomains('2026-11', ['dailydental.co.kr', 'my-doctor.io']), withDomains('2026-12', ['dailydental.co.kr'])]);
  assert.deepEqual(summary.otherDomainsAllMonths, [
    { domain: 'dailydental.co.kr', cells: 2, byEngine: { naverAiBriefing: 2 } },
    { domain: 'my-doctor.io', cells: 1, byEngine: { naverAiBriefing: 1 } },
  ]);
  assert.match(formatSummary(summary), /dailydental\.co\.kr 2 · my-doctor\.io 1/);
});

test('CLI: template refuses to overwrite, validate and summary read a directory, check reads a manifest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-monitor-'));
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--dir', dir], { encoding: 'utf8' });
  try {
    const created = run('--template', '2026-11');
    assert.equal(created.status, 0, created.stderr);
    const file = path.join(dir, '2026-11.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), buildTemplate(def, '2026-11'));
    assert.deepEqual([JSON.parse(created.stdout).aiCells, JSON.parse(created.stdout).nameSearchCells], [60, 60]);

    const filled = recorded('2026-11', { inputs: { bingSiteResults: 0, naverCollectedPages: 120 } });
    fs.writeFileSync(file, JSON.stringify(filled, null, 2) + '\n');
    const again = run('--template', '2026-11');
    assert.equal(again.status, 1);
    assert.match(again.stderr, /already exists; it was not overwritten/);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), filled, 'the recorded month is untouched');
    assert.equal(run('--template', '2026-00').status, 1);

    const valid = run('--validate');
    assert.equal(valid.status, 0, valid.stderr);
    assert.deepEqual(JSON.parse(valid.stdout).map(r => [r.month, r.valid, r.measuredCells, r.unmeasuredCells, r.gateInputsRead]), [['2026-11', true, 0, 120, 2]]);

    const bad = copy(filled);
    bad.aiCitations[0].cells.chatgpt = { answerShown: false };
    fs.writeFileSync(path.join(dir, '2026-12.json'), JSON.stringify({ ...bad, month: '2026-12', observedOn: '2026-12-15' }));
    const invalid = run('--validate', path.join(dir, '2026-12.json'));
    assert.equal(invalid.status, 1);
    assert.match(JSON.parse(invalid.stdout)[0].problems.join('\n'), /aiCitations\[q01\]\.cells\.chatgpt/);
    const refused = run('--summary');
    assert.equal(refused.status, 1, 'an invalid month is never summarised');
    assert.match(refused.stderr, /Invalid growth observation 2026-12/);

    fs.writeFileSync(path.join(dir, '2026-12.json'), JSON.stringify(recorded('2026-12', { inputs: { bingSiteResults: 0, naverCollectedPages: 300 } })));
    fs.writeFileSync(path.join(dir, '2027-01.json'), JSON.stringify(recorded('2027-01', { inputs: { bingSiteResults: 0, naverCollectedPages: 700 } })));
    const json = run('--summary', '--json');
    assert.equal(json.status, 0, json.stderr);
    const summary = JSON.parse(json.stdout);
    assert.deepEqual([summary.recordedMonths, summary.currentPhase, summary.stopRule.applies, summary.stopRule.consecutiveNotMet], [['2026-11', '2026-12', '2027-01'], 0, true, 3]);
    const both = run('--summary');
    assert.match(both.stdout, /"stopRule"/);
    assert.match(both.stdout, /\[멈춤 규칙\]/);
    assert.match(run('--summary', '--text').stdout, /^치과데이터랩 성장 점검 · 기록 3개월 \(2026-11 ~ 2027-01\)/);

    const manifest = path.join(dir, 'build-manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ routes: [...def.aiQuestions.map(q => q.expectedPath), ...def.nameSearchSample.institutions.map(c => `/clinics/${c.id}/`)] }));
    const clinics = path.join(dir, 'clinics.json');
    fs.writeFileSync(clinics, JSON.stringify({ snapshotDate: '2026-09-30', clinics: def.nameSearchSample.institutions.map(c => ({ ...c, typeCode: '41' })) }));
    const ok = run('--check', '--manifest', manifest, '--clinics', clinics);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout).problemCount, 0);
    fs.writeFileSync(manifest, JSON.stringify({ routes: ['/'] }));
    const missing = run('--check', '--manifest', manifest, '--clinics', clinics);
    assert.equal(missing.status, 1);
    assert.equal(JSON.parse(missing.stdout).expectedPaths.status, 'problems');
    assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' }).status, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
