#!/usr/bin/env node
// Monthly growth ledger for the phased plan: AI-citation checks, institution-name searches and the four phase gates.
// The fixed definition is data/content/growth-monitor.json; one hand-recorded file per month lives in
// data/content/growth-observations/YYYY-MM.json. Nothing here opens a search engine or any other network resource:
// a person (or a browser session) makes the observations by following docs/growth-monitor.md and this script only
// creates the blank month file, validates what was written and summarises it.
// A cell that was not measured stays null and is never counted as false, 0 or "not cited".
// The name sample is only a list of names to search; nothing here scores or ranks an institution.
// Usage:
//   node scripts/growth-monitor.mjs --template YYYY-MM
//   node scripts/growth-monitor.mjs --validate [file]
//   node scripts/growth-monitor.mjs --summary [--json | --text]
//   node scripts/growth-monitor.mjs --check [--manifest <dist>/build-manifest.json] [--clinics data/clinics.json]
// Every command also accepts --definition <file> and --dir <observation directory>.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL, domainToASCII } from 'node:url';
import { hasText, isIsoDate, percentage } from './common.mjs';
import { isIndexableRoute } from './seo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFINITION_FILE = path.join(root, 'data/content/growth-monitor.json');
export const OBSERVATION_DIR = path.join(root, 'data/content/growth-observations');
export const ORIGIN = 'https://dentaldatalab.com';
export const SITE_HOST = new URL(ORIGIN).hostname;
export const STATUS = Object.freeze({ MET: 'met', NOT_MET: 'not_met', NOT_MEASURED: 'not_measured' });
export const NOT_IN_TOP10 = 'not_in_top10';
const { MET, NOT_MET, NOT_MEASURED } = STATUS;

const QUESTION_COUNT = 20;
const SAMPLE_SIZE = 30;
const HOSPITAL_TYPE = '41';
const CRITERION_TYPES = ['inputAtLeast', 'inputIncreasedFromPreviousMonth', 'nameSearchTop10Share'];
const AI_CELL_KEYS = ['answerShown', 'cited', 'citedUrls', 'otherDomains', 'note'];
const NAME_CELL_KEYS = ['rank', 'url'];
const OBSERVATION_KEYS = ['schemaVersion', 'definitionVersion', 'origin', 'month', 'observedOn', 'observer', 'conditions', 'notes', 'gateInputs', 'aiCitations', 'nameSearch'];

const isPlain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => isPlain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const unique = values => new Set(values).size === values.length;
const fail = (label, problems) => { throw new Error(`${label}:\n- ${problems.join('\n- ')}`); };

export const isMonth = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value);
const shiftMonth = (month, by) => {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1 + by, 1)).toISOString().slice(0, 7);
};
export const previousMonth = month => shiftMonth(month, -1);
export const nextMonth = month => shiftMonth(month, 1);

/** A page of this site as the ledger writes it: https, the bare host, no query and no fragment. */
export function isSiteUrl(value) {
  if (typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  return url.href === value && url.origin === ORIGIN && !url.username && !url.password && !url.search && !url.hash && !value.includes('?') && !value.includes('#');
}

/** Another cited source: a lowercase hostname without scheme, path or a leading www., and not this site. */
export function isOtherDomain(value) {
  return typeof value === 'string' && value.length > 0 && value === value.toLowerCase() && !/[\s/:@?#]/.test(value)
    && value.includes('.') && !value.startsWith('.') && !value.endsWith('.') && !value.startsWith('www.')
    && domainToASCII(value) !== '' && value !== SITE_HOST && !value.endsWith('.' + SITE_HOST);
}

/**
 * The documented sampling rule. 종별코드 41 records are sorted by id (plain code-unit order; the id is a hash prefix, so
 * the order is unrelated to name, region or size) and the record at index floor(i × N / size) is taken for i = 0…size-1.
 * It only lists names to search. sameNameCount is how many records of the whole snapshot carry exactly that name.
 */
export function drawNameSample(clinics, { typeCode = HOSPITAL_TYPE, size = SAMPLE_SIZE } = {}) {
  if (!Array.isArray(clinics)) throw new TypeError('clinics must be an array');
  const population = clinics.filter(c => c?.typeCode === typeCode).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (population.length < size) throw new Error(`Only ${population.length} records of type ${typeCode}; cannot draw ${size}`);
  const sameName = new Map();
  for (const c of clinics) sameName.set(c.name, (sameName.get(c.name) ?? 0) + 1);
  return Array.from({ length: size }, (_, i) => population[Math.floor(i * population.length / size)])
    .map(c => ({ id: c.id, name: c.name, sido: c.sido, city: c.city, sameNameCount: sameName.get(c.name) }));
}

const engineIds = (def, group) => def.engines[group].map(engine => engine.id);
const allEngineIds = def => [...engineIds(def, 'aiCitation'), ...engineIds(def, 'nameSearch')];

/** Lists what is wrong with the fixed definition; an empty list means it can be used. */
export function definitionProblems(def) {
  const problems = [];
  if (!isPlain(def)) return ['definition must be an object'];
  if (def.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!Number.isSafeInteger(def.definitionVersion) || def.definitionVersion < 1) problems.push('definitionVersion must be a positive integer');
  if (def.origin !== ORIGIN) problems.push(`origin must be ${ORIGIN}`);
  if (!isIsoDate(def.definedOn)) problems.push('definedOn must be YYYY-MM-DD');

  const groups = ['aiCitation', 'nameSearch'];
  const enginesOk = isPlain(def.engines) && groups.every(group => Array.isArray(def.engines[group]) && def.engines[group].length > 0
    && def.engines[group].every(e => isPlain(e) && /^[a-z][A-Za-z0-9]*$/.test(e.id ?? '') && hasText(e.label)));
  if (!enginesOk) problems.push('engines.aiCitation and engines.nameSearch must be non-empty lists of {id, label}');
  else if (!unique(allEngineIds(def))) problems.push('engine ids must be unique across both measurements');

  const questions = def.aiQuestions;
  if (!Array.isArray(questions) || questions.length !== QUESTION_COUNT) problems.push(`aiQuestions must hold exactly ${QUESTION_COUNT} questions`);
  else {
    questions.forEach((q, i) => {
      const at = `aiQuestions[${i}]`;
      if (!isPlain(q)) return problems.push(`${at} must be an object`);
      if (!/^q\d{2}$/.test(q.id ?? '')) problems.push(`${at}.id must look like q01`);
      if (!/^[a-z][a-z-]*$/.test(q.intent ?? '')) problems.push(`${at}.intent must be a lowercase tag`);
      if (!hasText(q.question) || q.question !== q.question.trim()) problems.push(`${at}.question must be non-empty text without outer whitespace`);
      if (typeof q.expectedPath !== 'string' || !/^\/(?:[A-Za-z0-9-]+\/)*$/.test(q.expectedPath) || !isIndexableRoute(q.expectedPath)) problems.push(`${at}.expectedPath must be an indexable route such as /guides/<slug>/`);
    });
    if (!unique(questions.map(q => q?.id))) problems.push('question ids must be unique');
    if (!unique(questions.map(q => q?.question))) problems.push('question texts must be unique');
  }

  const sample = def.nameSearchSample;
  if (!isPlain(sample) || !isPlain(sample.rule) || !Array.isArray(sample.institutions)) problems.push('nameSearchSample must hold rule and institutions');
  else {
    const rule = sample.rule;
    if (rule.typeCode !== HOSPITAL_TYPE || rule.size !== SAMPLE_SIZE || rule.sortBy !== 'id' || !isIsoDate(rule.snapshotDate) || !isCount(rule.population) || rule.population < SAMPLE_SIZE || !hasText(rule.pick) || !hasText(rule.description)) {
      problems.push(`nameSearchSample.rule must document typeCode ${HOSPITAL_TYPE}, sortBy id, size ${SAMPLE_SIZE}, snapshotDate, population, pick and description`);
    }
    if (sample.institutions.length !== SAMPLE_SIZE) problems.push(`nameSearchSample.institutions must hold exactly ${SAMPLE_SIZE} institutions`);
    sample.institutions.forEach((c, i) => {
      if (!isPlain(c) || !/^c-[0-9a-f]{12}$/.test(c.id ?? '') || !hasText(c.name) || c.name !== c.name.trim() || !hasText(c.sido) || !hasText(c.city) || !isCount(c.sameNameCount) || c.sameNameCount < 1) {
        problems.push(`nameSearchSample.institutions[${i}] must be {id, name, sido, city, sameNameCount}`);
      }
    });
    if (!unique(sample.institutions.map(c => c?.id))) problems.push('sample institution ids must be unique');
  }

  const inputs = def.gateInputs;
  const inputsOk = Array.isArray(inputs) && inputs.length > 0 && inputs.every(g => isPlain(g) && /^[a-z][A-Za-z0-9]*$/.test(g.id ?? '') && hasText(g.label) && hasText(g.source)) && unique(inputs.map(g => g.id));
  if (!inputsOk) problems.push('gateInputs must be a list of unique {id, label, source}');

  const gates = def.phaseGates;
  if (!Array.isArray(gates) || gates.length === 0) problems.push('phaseGates must be a non-empty list');
  else gates.forEach((gate, i) => {
    const at = `phaseGates[${i}]`;
    if (!isPlain(gate) || gate.phase !== i || !hasText(gate.name) || !hasText(gate.work) || !hasText(gate.gate)) return problems.push(`${at} must be {phase: ${i}, name, work, gate, combine, criteria}`);
    if (!['all', 'any'].includes(gate.combine)) problems.push(`${at}.combine must be all or any`);
    if (!Array.isArray(gate.criteria) || gate.criteria.length === 0) return problems.push(`${at}.criteria must be a non-empty list`);
    gate.criteria.forEach((c, j) => {
      const where = `${at}.criteria[${j}]`;
      if (!isPlain(c) || !CRITERION_TYPES.includes(c.type)) return problems.push(`${where}.type must be one of ${CRITERION_TYPES.join(', ')}`);
      if (c.type === 'nameSearchTop10Share') {
        if (enginesOk && !engineIds(def, 'nameSearch').includes(c.engine)) problems.push(`${where}.engine must be a name-search engine`);
        if (typeof c.minPercent !== 'number' || !(c.minPercent > 0 && c.minPercent <= 100)) problems.push(`${where}.minPercent must be between 0 and 100`);
        if (!Number.isSafeInteger(c.minMeasured) || c.minMeasured < 1 || c.minMeasured > SAMPLE_SIZE) problems.push(`${where}.minMeasured must be 1–${SAMPLE_SIZE}`);
      } else {
        if (inputsOk && !inputs.some(g => g.id === c.input)) problems.push(`${where}.input must name a gate input`);
        if (c.type === 'inputAtLeast' && !isCount(c.min)) problems.push(`${where}.min must be a non-negative integer`);
      }
    });
  });

  if (!isPlain(def.stopRule) || !Number.isSafeInteger(def.stopRule.maxMonthsBelowGate) || def.stopRule.maxMonthsBelowGate < 1 || !hasText(def.stopRule.text)) problems.push('stopRule must be {maxMonthsBelowGate, text}');
  return problems;
}

export function validateDefinition(def) {
  const problems = definitionProblems(def);
  if (problems.length) fail('Invalid growth-monitor definition', problems);
  return def;
}

/**
 * Do the pages and institutions the definition points at still exist? `routes` is the routes list of a built dist's
 * build-manifest.json and `clinics` the records of data/clinics.json; a part whose input is missing is reported as
 * not_checked, never as ok.
 */
export function checkDefinition(def, { routes = null, clinics = null } = {}) {
  const routeSet = Array.isArray(routes) ? new Set(routes) : null;
  const byId = Array.isArray(clinics) ? new Map(clinics.map(c => [c.id, c])) : null;
  const part = (checked, issues) => ({ status: checked === null ? 'not_checked' : issues.length ? 'problems' : 'ok', checked: checked ?? 0, problems: issues });

  const missingPaths = routeSet ? def.aiQuestions.filter(q => !routeSet.has(q.expectedPath)).map(q => ({ id: q.id, expectedPath: q.expectedPath, problem: 'route_missing' })) : [];
  const institutionIssues = [];
  const pageIssues = [];
  for (const c of def.nameSearchSample.institutions) {
    const current = byId?.get(c.id);
    if (byId && !current) institutionIssues.push({ id: c.id, name: c.name, problem: 'missing' });
    else if (byId && current.typeCode !== def.nameSearchSample.rule.typeCode) institutionIssues.push({ id: c.id, name: c.name, problem: 'type_changed', current: current.typeCode });
    else if (byId && current.name !== c.name) institutionIssues.push({ id: c.id, name: c.name, problem: 'renamed', current: current.name });
    if (routeSet && !routeSet.has(`/clinics/${c.id}/`)) pageIssues.push({ id: c.id, name: c.name, problem: 'route_missing' });
  }
  const report = {
    expectedPaths: part(routeSet ? def.aiQuestions.length : null, missingPaths),
    sampleInstitutions: part(byId ? def.nameSearchSample.institutions.length : null, institutionIssues),
    samplePages: part(routeSet ? def.nameSearchSample.institutions.length : null, pageIssues),
  };
  report.problemCount = missingPaths.length + institutionIssues.length + pageIssues.length;
  return report;
}

/** A blank month: every (question × engine) and (institution × engine) cell and every gate input is null. */
export function buildTemplate(def, month) {
  if (!isMonth(month)) throw new TypeError('month must be YYYY-MM');
  const nulls = ids => Object.fromEntries(ids.map(id => [id, null]));
  return {
    schemaVersion: 1,
    definitionVersion: def.definitionVersion,
    origin: def.origin,
    month,
    observedOn: null,
    observer: null,
    conditions: nulls(allEngineIds(def)),
    notes: null,
    gateInputs: nulls(def.gateInputs.map(input => input.id)),
    aiCitations: def.aiQuestions.map(q => ({ id: q.id, question: q.question, cells: nulls(engineIds(def, 'aiCitation')) })),
    nameSearch: def.nameSearchSample.institutions.map(c => ({ id: c.id, name: c.name, cells: nulls(engineIds(def, 'nameSearch')) })),
  };
}

/** An AI cell is null (not measured) or {answerShown, cited, citedUrls, otherDomains, note}. */
export function aiCellProblems(cell) {
  if (cell === null) return [];
  if (!hasExactKeys(cell, AI_CELL_KEYS)) return [`must be null or an object with exactly: ${AI_CELL_KEYS.join(', ')}`];
  const problems = [];
  if (typeof cell.answerShown !== 'boolean') problems.push('answerShown must be true or false; leave the whole cell null when it was not measured');
  if (typeof cell.cited !== 'boolean') problems.push('cited must be true or false; leave the whole cell null when it was not measured');
  if (!Array.isArray(cell.citedUrls) || !cell.citedUrls.every(isSiteUrl) || !unique(cell.citedUrls)) problems.push(`citedUrls must be distinct ${ORIGIN}/… page URLs without query or fragment`);
  if (!Array.isArray(cell.otherDomains) || !cell.otherDomains.every(isOtherDomain) || !unique(cell.otherDomains)) problems.push('otherDomains must be distinct lowercase hostnames of other sites (no scheme, path or www.)');
  if (cell.note !== null && typeof cell.note !== 'string') problems.push('note must be text or null');
  if (problems.length) return problems;
  if (!cell.answerShown && (cell.cited || cell.citedUrls.length || cell.otherDomains.length)) problems.push('no AI answer was shown, so cited must be false and both lists empty');
  if (!cell.cited && cell.citedUrls.length) problems.push('citedUrls must be empty when cited is false');
  if (cell.cited && !cell.citedUrls.length && !hasText(cell.note)) problems.push('cited without a link: describe the named mention in note');
  return problems;
}

/** A name-search cell is null (not measured) or {rank: 1–10 | 'not_in_top10', url}. */
export function nameCellProblems(cell) {
  if (cell === null) return [];
  if (!hasExactKeys(cell, NAME_CELL_KEYS)) return [`must be null or an object with exactly: ${NAME_CELL_KEYS.join(', ')}`];
  if (cell.rank === NOT_IN_TOP10) return cell.url === null ? [] : [`url must be null when rank is ${NOT_IN_TOP10}`];
  if (!Number.isInteger(cell.rank) || cell.rank < 1 || cell.rank > 10) return [`rank must be an integer 1–10 or "${NOT_IN_TOP10}"; leave the whole cell null when it was not measured`];
  return isSiteUrl(cell.url) ? [] : [`url must be the ranked ${ORIGIN}/… result without query or fragment`];
}

/** Strict check of one month file against the definition. `month` is the month the file name promises. */
export function observationProblems(obs, def, { month = null } = {}) {
  if (!hasExactKeys(obs, OBSERVATION_KEYS)) return [`the file must be an object with exactly: ${OBSERVATION_KEYS.join(', ')}`];
  const problems = [];
  if (obs.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (obs.definitionVersion !== def.definitionVersion) problems.push(`definitionVersion must be ${def.definitionVersion}`);
  if (obs.origin !== def.origin) problems.push(`origin must be ${def.origin}`);
  if (!isMonth(obs.month)) problems.push('month must be YYYY-MM');
  else if (month !== null && obs.month !== month) problems.push(`month ${obs.month} does not match the file name ${month}`);
  if (obs.observedOn !== null && !(isIsoDate(obs.observedOn) && obs.observedOn.startsWith(obs.month + '-'))) problems.push('observedOn must be null or a real YYYY-MM-DD date inside this month');
  if (obs.observer !== null && !hasText(obs.observer)) problems.push('observer must be null or a name');
  if (obs.notes !== null && typeof obs.notes !== 'string') problems.push('notes must be null or text');

  const engines = allEngineIds(def);
  const conditionsOk = hasExactKeys(obs.conditions, engines) && engines.every(id => obs.conditions[id] === null || hasText(obs.conditions[id]));
  if (!conditionsOk) problems.push(`conditions must hold exactly ${engines.join(', ')}, each null or a description`);

  const inputIds = def.gateInputs.map(input => input.id);
  const inputsOk = hasExactKeys(obs.gateInputs, inputIds);
  if (!inputsOk) problems.push(`gateInputs must hold exactly ${inputIds.join(', ')}`);
  else for (const id of inputIds) if (obs.gateInputs[id] !== null && !isCount(obs.gateInputs[id])) problems.push(`gateInputs.${id} must be null (not read) or a non-negative integer`);

  const measuredEngines = new Set();
  const rows = (key, expected, textKey, group, cellProblems) => {
    const list = obs[key];
    if (!Array.isArray(list) || list.length !== expected.length) return problems.push(`${key} must list all ${expected.length} rows of the definition in order`);
    const ids = engineIds(def, group);
    list.forEach((row, i) => {
      const want = expected[i];
      const at = `${key}[${want.id}]`;
      if (!hasExactKeys(row, ['id', textKey, 'cells']) || row.id !== want.id) return problems.push(`${key}[${i}] must be {id: "${want.id}", ${textKey}, cells}`);
      if (row[textKey] !== want[textKey]) problems.push(`${at}.${textKey} must stay identical to the definition`);
      if (!hasExactKeys(row.cells, ids)) return problems.push(`${at}.cells must hold exactly ${ids.join(', ')}`);
      for (const id of ids) {
        if (row.cells[id] !== null) measuredEngines.add(id);
        for (const problem of cellProblems(row.cells[id])) problems.push(`${at}.cells.${id}: ${problem}`);
      }
    });
  };
  rows('aiCitations', def.aiQuestions, 'question', 'aiCitation', aiCellProblems);
  rows('nameSearch', def.nameSearchSample.institutions, 'name', 'nameSearch', nameCellProblems);

  // An observation is only usable with its date, observer and conditions.
  const anyInput = inputsOk && inputIds.some(id => obs.gateInputs[id] !== null);
  if ((measuredEngines.size || anyInput) && (obs.observedOn === null || obs.observer === null)) problems.push('observedOn and observer are required once anything is recorded');
  if (conditionsOk) for (const id of measuredEngines) if (obs.conditions[id] === null) problems.push(`conditions.${id} is required because ${id} cells are recorded`);
  return problems;
}

export function validateObservation(obs, def, options = {}) {
  const problems = observationProblems(obs, def, options);
  if (problems.length) fail(`Invalid growth observation${options.month ? ' ' + options.month : ''}`, problems);
  return obs;
}

/** Kleene three-valued combination: an unmeasured criterion is neither a pass nor a failure. */
export function combineStatuses(statuses, combine = 'all') {
  if (combine === 'any') return statuses.includes(MET) ? MET : statuses.includes(NOT_MEASURED) ? NOT_MEASURED : NOT_MET;
  return statuses.includes(NOT_MET) ? NOT_MET : statuses.includes(NOT_MEASURED) ? NOT_MEASURED : MET;
}

/** One gate criterion for one month. `nameSearch` is the per-engine name-search summary of that month. */
export function evaluateCriterion(criterion, { inputs = null, previousInputs = null, nameSearch = null } = {}) {
  if (criterion.type === 'inputAtLeast') {
    const value = inputs?.[criterion.input] ?? null;
    return { ...criterion, value, status: value === null ? NOT_MEASURED : value >= criterion.min ? MET : NOT_MET };
  }
  if (criterion.type === 'inputIncreasedFromPreviousMonth') {
    const value = inputs?.[criterion.input] ?? null;
    const previous = previousInputs?.[criterion.input] ?? null;
    return { ...criterion, value, previous, status: value === null || previous === null ? NOT_MEASURED : value > previous ? MET : NOT_MET };
  }
  if (criterion.type === 'nameSearchTop10Share') {
    const engine = nameSearch?.[criterion.engine];
    const measured = engine?.measured ?? 0;
    const top10 = engine?.top10 ?? null;
    // Compared on counts, not on the rounded percentage, so 29.96% never rounds up into a pass.
    const status = measured < criterion.minMeasured || top10 === null ? NOT_MEASURED : top10 * 100 >= criterion.minPercent * measured ? MET : NOT_MET;
    return { ...criterion, measured, top10, value: engine?.top10Share ?? null, status };
  }
  throw new Error('Unknown gate criterion: ' + criterion.type);
}

const evaluateGates = (def, context) => def.phaseGates.map(gate => {
  const criteria = gate.criteria.map(criterion => evaluateCriterion(criterion, context));
  return { phase: gate.phase, name: gate.name, gate: gate.gate, combine: gate.combine, status: combineStatuses(criteria.map(c => c.status), gate.combine), criteria };
});

const tally = (map, key, engine) => {
  if (!map.has(key)) map.set(key, { domain: key, cells: 0, byEngine: {} });
  const entry = map.get(key);
  entry.cells++;
  entry.byEngine[engine] = (entry.byEngine[engine] ?? 0) + 1;
};
const ranked = map => [...map.values()].sort((a, b) => b.cells - a.cells || a.domain.localeCompare(b.domain));

/** One month's numbers. Counts are null when no cell of that engine was measured, and rates use measured cells only. */
export function summarizeMonth(def, obs, previous = null) {
  const expectedUrl = new Map(def.aiQuestions.map(q => [q.id, def.origin + q.expectedPath]));
  const domains = new Map();
  const aiEngines = {};
  for (const engine of def.engines.aiCitation) {
    const measured = obs.aiCitations.filter(row => row.cells[engine.id] !== null).map(row => ({ id: row.id, cell: row.cells[engine.id] }));
    for (const { cell } of measured) for (const domain of cell.otherDomains) tally(domains, domain, engine.id);
    const count = test => (measured.length ? measured.filter(test).length : null);
    const cited = count(x => x.cell.cited);
    aiEngines[engine.id] = {
      label: engine.label, cells: obs.aiCitations.length, measured: measured.length,
      answerShown: count(x => x.cell.answerShown), cited,
      citedExpectedPath: count(x => x.cell.citedUrls.includes(expectedUrl.get(x.id))),
      citationRate: percentage(cited, measured.length),
    };
  }
  const nameEngines = {};
  for (const engine of def.engines.nameSearch) {
    const measured = obs.nameSearch.filter(row => row.cells[engine.id] !== null).map(row => ({ id: row.id, cell: row.cells[engine.id] }));
    const count = test => (measured.length ? measured.filter(test).length : null);
    const top10 = count(x => x.cell.rank !== NOT_IN_TOP10);
    nameEngines[engine.id] = {
      label: engine.label, cells: obs.nameSearch.length, measured: measured.length, top10,
      ownPage: count(x => x.cell.url === `${def.origin}/clinics/${x.id}/`),
      top10Share: percentage(top10, measured.length),
    };
  }
  return {
    month: obs.month, recorded: true, observedOn: obs.observedOn, observer: obs.observer,
    aiCitations: { engines: aiEngines, otherDomains: ranked(domains) },
    nameSearch: { engines: nameEngines },
    gateInputs: { ...obs.gateInputs },
    gates: evaluateGates(def, { inputs: obs.gateInputs, previousInputs: previous?.gateInputs ?? null, nameSearch: nameEngines }),
  };
}

/**
 * The current run of not_met months for one gate, walking back from the latest month. A met month ends the run. An
 * unmeasured month neither extends nor ends it: it is not counted as below the gate, and skipping a month cannot reset
 * the count either.
 */
export function belowGateRun(history) {
  let consecutiveNotMet = 0, belowSince = null, unmeasuredInRun = 0, pending = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const { month, status } = history[i];
    if (status === MET) break;
    if (status === NOT_MET) { consecutiveNotMet++; belowSince = month; unmeasuredInRun += pending; pending = 0; }
    else pending++;
  }
  return { consecutiveNotMet, belowSince, unmeasuredInRun };
}

/**
 * All months together. Calendar months without a file are listed as unrecorded and count as not measured. The current
 * phase is the first phase whose most recent measured gate status is not met (a blank newer month does not undo an
 * earlier pass, and a phase that was never measured is not treated as passed). The stop rule applies once the current
 * phase's gate has been not_met for more than stopRule.maxMonthsBelowGate measured months in a row, is false while the
 * run is shorter, and stays null while that gate has not been measured at all.
 */
export function summarize(def, observations) {
  const byMonth = new Map();
  for (const obs of observations) {
    if (byMonth.has(obs.month)) throw new Error('Two observation files for ' + obs.month);
    byMonth.set(obs.month, obs);
  }
  const recorded = [...byMonth.keys()].sort();
  const calendar = [];
  for (let month = recorded[0]; month && month <= recorded.at(-1); month = nextMonth(month)) calendar.push(month);
  const months = calendar.map(month => (byMonth.has(month)
    ? summarizeMonth(def, byMonth.get(month), byMonth.get(previousMonth(month)) ?? null)
    : { month, recorded: false, gates: evaluateGates(def, {}) }));

  const allDomains = new Map();
  for (const month of months) for (const entry of month.aiCitations?.otherDomains ?? []) {
    for (const [engine, cells] of Object.entries(entry.byEngine)) for (let i = 0; i < cells; i++) tally(allDomains, entry.domain, engine);
  }
  const phases = def.phaseGates.map(gate => {
    const history = months.map(month => ({ month: month.month, status: month.gates[gate.phase].status }));
    return {
      phase: gate.phase, name: gate.name, gate: gate.gate,
      latestStatus: history.at(-1)?.status ?? NOT_MEASURED,
      lastMeasured: history.findLast(h => h.status !== NOT_MEASURED) ?? null,
      lastMetMonth: history.findLast(h => h.status === MET)?.month ?? null,
      ...belowGateRun(history), history,
    };
  });
  const current = months.length ? phases.find(phase => phase.lastMeasured?.status !== MET) ?? null : null;
  const limit = def.stopRule.maxMonthsBelowGate;
  const applies = !months.length ? null : !current ? false : current.consecutiveNotMet > limit ? true : current.consecutiveNotMet > 0 ? false : null;
  return {
    schemaVersion: 1, origin: def.origin, definitionVersion: def.definitionVersion,
    recordedMonths: recorded, unrecordedMonths: months.filter(m => !m.recorded).map(m => m.month),
    latestMonth: recorded.at(-1) ?? null,
    months, otherDomainsAllMonths: ranked(allDomains), phases,
    currentPhase: current ? current.phase : null,
    stopRule: {
      text: def.stopRule.text, maxMonthsBelowGate: limit, applies,
      phase: current ? current.phase : null,
      consecutiveNotMet: current ? current.consecutiveNotMet : null,
      belowSince: current ? current.belowSince : null,
    },
  };
}

const STATUS_LABEL = { [MET]: '충족', [NOT_MET]: '미달', [NOT_MEASURED]: '측정 안 됨' };
// Hangul and other full-width characters take two terminal columns.
const displayWidth = text => [...text].reduce((width, ch) => width + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
const table = rows => {
  const widths = rows[0].map((_, column) => Math.max(...rows.map(row => displayWidth(String(row[column])))));
  return rows.map(row => row.map((cell, column) => String(cell) + ' '.repeat(widths[column] - displayWidth(String(cell)))).join('  ').trimEnd()).join('\n');
};
const shown = value => (value === null || value === undefined ? '–' : Number(value).toLocaleString('ko-KR'));
const rate = value => (value === null ? '측정 안 됨' : value.toFixed(1) + '%');

/** Compact Korean text for the terminal. A dash or '측정 안 됨' is an unmeasured value, not a zero. */
export function formatSummary(summary) {
  if (!summary.months.length) return '기록된 달이 없습니다. node scripts/growth-monitor.mjs --template YYYY-MM 으로 시작하세요.';
  const recorded = summary.months.filter(m => m.recorded);
  const lines = [`치과데이터랩 성장 점검 · 기록 ${recorded.length}개월 (${summary.recordedMonths[0]} ~ ${summary.latestMonth})`, "측정하지 않은 칸은 0이나 '아니오'로 세지 않습니다. 비율의 분모는 측정한 칸입니다."];
  if (summary.unrecordedMonths.length) lines.push(`기록 파일이 없는 달: ${summary.unrecordedMonths.join(', ')}`);

  lines.push('', '[AI 인용] 인용률 = 인용된 칸 ÷ 측정한 칸', table([
    ['월', '엔진', '측정', '답 표시', '인용', '기대 페이지 인용', '인용률'],
    ...recorded.flatMap(m => Object.values(m.aiCitations.engines).map(e => [m.month, e.label, `${e.measured}/${e.cells}`, shown(e.answerShown), shown(e.cited), shown(e.citedExpectedPath), rate(e.citationRate)])),
  ]));
  const top = summary.otherDomainsAllMonths.slice(0, 10);
  lines.push(`함께 인용된 다른 도메인 (전체 기간 · 칸 수): ${top.length ? top.map(d => `${d.domain} ${d.cells}`).join(' · ') : '기록 없음'}`);

  lines.push('', '[기관명 검색] 10위 안 비율 = 10위 안에 든 기관 ÷ 측정한 기관', table([
    ['월', '엔진', '측정', '10위 안', '그중 해당 기관 페이지', '비율'],
    ...recorded.flatMap(m => Object.values(m.nameSearch.engines).map(e => [m.month, e.label, `${e.measured}/${e.cells}`, shown(e.top10), shown(e.ownPage), rate(e.top10Share)])),
  ]));

  const inputIds = Object.keys(recorded[0].gateInputs);
  lines.push('', '[기준 입력값]', table([['월', ...inputIds], ...recorded.map(m => [m.month, ...inputIds.map(id => shown(m.gateInputs[id]))])]));

  lines.push('', '[단계 기준]', table([
    ['월', ...summary.phases.map(p => `${p.phase} ${p.name}`)],
    ...summary.months.map(m => [m.month, ...m.gates.map(g => (m.recorded ? STATUS_LABEL[g.status] : '기록 없음'))]),
  ]));
  lines.push('', '[미달 연속] 측정한 달만 세며, 측정하지 않은 달은 세지도 끊지도 않습니다', table([
    ['단계', '넘어가는 기준', '마지막 측정', '미달 연속', '미달 시작', '마지막 충족'],
    ...summary.phases.map(p => [`${p.phase} ${p.name}`, p.gate, p.lastMeasured ? `${STATUS_LABEL[p.lastMeasured.status]} (${p.lastMeasured.month})` : STATUS_LABEL[NOT_MEASURED], `${p.consecutiveNotMet}개월`, p.belowSince ?? '–', p.lastMetMonth ?? '–']),
  ]));

  const rule = summary.stopRule;
  const phase = summary.phases.find(p => p.phase === rule.phase);
  const verdict = rule.phase === null ? '모든 단계 기준 충족 · 적용 안 됨'
    : rule.applies === true ? `적용 — ${rule.phase}단계(${phase.name}) 기준이 ${rule.consecutiveNotMet}개월 연속 미달(${rule.belowSince}부터)입니다. 다음 단계로 넘어가지 말고 원인부터 고칩니다.`
    : rule.applies === false ? `아직 적용 안 됨 — ${rule.phase}단계(${phase.name}) 미달 연속 ${rule.consecutiveNotMet}개월 (${rule.maxMonthsBelowGate}개월을 넘으면 적용)`
    : `판정 불가 — ${rule.phase}단계(${phase.name}) 기준을 아직 측정하지 않았습니다`;
  lines.push('', `[멈춤 규칙] “${rule.text}”`, `현재 단계: ${rule.phase === null ? '없음' : `${rule.phase} ${phase.name}`}`, verdict);
  return lines.join('\n');
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const loadDefinition = (file = DEFINITION_FILE) => validateDefinition(readJson(file));

const monthOfFile = file => {
  const month = path.basename(file, '.json');
  if (!isMonth(month) || !file.endsWith('.json')) throw new Error(`${file}: observation files are named YYYY-MM.json`);
  return month;
};
export const observationFiles = (dir = OBSERVATION_DIR) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter(name => /^\d{4}-\d{2}\.json$/.test(name)).sort().map(name => path.join(dir, name)) : []);
/** Reads and strictly validates every month file; throws with every problem of the first invalid file. */
export const loadObservations = (def, dir = OBSERVATION_DIR) => observationFiles(dir).map(file => validateObservation(readJson(file), def, { month: monthOfFile(file) }));

const USAGE = `node scripts/growth-monitor.mjs --template YYYY-MM          빈 월 파일 만들기 (있으면 덮어쓰지 않음)
node scripts/growth-monitor.mjs --validate [file]            월 파일 검사 (file 생략 시 전체)
node scripts/growth-monitor.mjs --summary [--json | --text]  전체 월 요약
node scripts/growth-monitor.mjs --check [--manifest <dist>/build-manifest.json] [--clinics data/clinics.json]
공통: [--definition <file>] [--dir <observation directory>]`;

function main(argv) {
  const value = (flag, fallback = null) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
  const print = data => console.log(JSON.stringify(data, null, 2));
  const def = loadDefinition(path.resolve(value('--definition', DEFINITION_FILE)));
  const dir = path.resolve(value('--dir', OBSERVATION_DIR));

  if (argv.includes('--template')) {
    const month = value('--template');
    if (!isMonth(month)) throw new Error('--template needs a month such as 2026-11');
    const file = path.join(dir, month + '.json');
    fs.mkdirSync(dir, { recursive: true });
    // wx: creating fails when the file exists, so a recorded month is never replaced by a blank one.
    try { fs.writeFileSync(file, JSON.stringify(buildTemplate(def, month), null, 2) + '\n', { flag: 'wx' }); }
    catch (error) { if (error.code === 'EEXIST') throw new Error(`${file} already exists; it was not overwritten`); throw error; }
    return print({ created: file, month, aiCells: def.aiQuestions.length * def.engines.aiCitation.length, nameSearchCells: def.nameSearchSample.institutions.length * def.engines.nameSearch.length });
  }
  if (argv.includes('--validate')) {
    const files = value('--validate') ? [path.resolve(value('--validate'))] : observationFiles(dir);
    if (!files.length) throw new Error('No observation files in ' + dir);
    const count = (rows, test) => rows.reduce((n, row) => n + Object.values(row.cells).filter(test).length, 0);
    const results = files.map(file => {
      const month = monthOfFile(file);
      const obs = readJson(file);
      const problems = observationProblems(obs, def, { month });
      if (problems.length) return { file, month, valid: false, problems };
      const cells = [...obs.aiCitations, ...obs.nameSearch];
      return { file, month, valid: true, measuredCells: count(cells, cell => cell !== null), unmeasuredCells: count(cells, cell => cell === null), gateInputsRead: Object.values(obs.gateInputs).filter(v => v !== null).length };
    });
    print(results);
    if (results.some(result => !result.valid)) process.exitCode = 1;
    return;
  }
  if (argv.includes('--summary')) {
    const summary = summarize(def, loadObservations(def, dir));
    if (!argv.includes('--text')) print(summary);
    if (!argv.includes('--json')) console.log((argv.includes('--text') ? '' : '\n') + formatSummary(summary));
    return;
  }
  if (argv.includes('--check')) {
    const manifest = value('--manifest');
    const routes = manifest ? readJson(path.resolve(manifest)).routes : null;
    if (manifest && !Array.isArray(routes)) throw new Error(`${manifest} has no routes list; pass the build-manifest.json of a full build`);
    const data = readJson(path.resolve(value('--clinics', path.join(root, 'data/clinics.json'))));
    const report = checkDefinition(def, { routes, clinics: data.clinics });
    print({ snapshotDate: data.snapshotDate ?? null, sampleDrawnFrom: def.nameSearchSample.rule.snapshotDate, manifest: manifest ?? null, ...report });
    if (report.problemCount) process.exitCode = 1;
    return;
  }
  console.log(USAGE);
  process.exitCode = argv.includes('--help') ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
