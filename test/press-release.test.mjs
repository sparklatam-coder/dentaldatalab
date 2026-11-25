import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectReports } from '../scripts/report-data.mjs';
import { renderPressRelease, headlineFacts, pressReleaseTitle, pressReleaseFileName, COMMENT_PLACEHOLDER, INTERNAL_HEADING, TRADE_OUTLETS } from '../scripts/press-release.mjs';
import { validateOperator } from '../scripts/site-operations.mjs';
import { pct } from '../scripts/html.mjs';
import { fmt, localDate, SOURCE_URL } from '../src/shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const source = read('data/clinics.json');
const operator = validateOperator(read('data/content/site-operator.json'));
const reports = collectReports(source.clinics, { snapshotDate: source.snapshotDate, observedAt: source.observedAt, sourceSha256: read('data/source-manifest.json').archive.sha256 });
const domain = 'https://dentaldatalab.com';
const release = renderPressRelease(reports, { domain, operator });
const dec = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const NUMBER = /\d+(?:,\d{3})*(?:\.\d+)?/g;

const institutionName = '개별기관비공개표식';
const clinic = (id, overrides = {}) => ({
  id, name: institutionName, address: '개별주소비공개표식', typeCode: '51', sidoCode: '310000', sido: '경기', cityCode: '312700', city: '양주시',
  doctors: { specialist: null }, hours: {}, website: null, ...overrides,
});
const fixture = () => collectReports([
  clinic('private-a', { doctors: { specialist: 0 }, hours: { mon: { open: '09:00', close: '18:00' } } }),
  clinic('private-b', { typeCode: '41', doctors: { specialist: 2 }, openedOn: '2012-03-02', equipment: [{ name: '콘빔CT', count: 1 }] }),
  clinic('private-c', { cityCode: '310001', city: '가평군' }),
  clinic('private-d', { sidoCode: '110000', sido: '서울', cityCode: '110001', city: '강남구', typeCode: '41', doctors: { specialist: 5 } }),
  clinic('private-e', { sidoCode: '110000', sido: '서울', cityCode: '110001', city: '강남구' }),
], { snapshotDate: '2031-03-31', observedAt: '2031-04-20T01:00:00.000Z', sourceSha256: 'b'.repeat(64) });

test('the release states the collectReports values, with the number and 기준일 in the first sentence', () => {
  const g = reports.dentalHospitals, h = g.hospitals, c = g.clinics, d = reports.hospitalDistricts, w = d.withoutHospitalClinics;
  const lines = release.split('\n');
  assert.equal(lines[0], `# 전국 치과병원 ${fmt(g.total)}곳, 시·군·구 ${fmt(d.total)}곳 중 ${fmt(d.withHospital)}곳에 등록`);
  assert.equal(lines[0], `# ${pressReleaseTitle(reports)}`);
  assert.match(lines[2], /^\*\*.+\*\*$/, 'subtitle');
  const lead = lines.find(line => line && !/^[#*\-|>]/.test(line));
  assert(lead.startsWith(`전국 치과병원은 ${fmt(g.total)}곳이며(건강보험심사평가원 ${reports.snapshotDate} 기준), 치과가 등록된 시·군·구 ${fmt(d.total)}곳 가운데 ${fmt(d.withHospital)}곳(${pct(d.percentWith)})에 1곳 이상 등록되어 있다.`), lead);
  assert(lead.includes(`${fmt(reports.national.total)}곳을 같은 기준으로 집계`));

  assert(release.includes(`### 치과병원 ${fmt(g.total)}곳, 치과의원 ${fmt(g.types.clinic)}곳`));
  assert(release.includes(`치과병원이 1곳 이상 등록된 시·군·구는 ${fmt(d.withHospital)}곳(${pct(d.percentWith)}), 없는 곳은 ${fmt(d.withoutHospital)}곳이다.`));
  assert(release.includes(`치과병원이 없는 시·군·구 ${fmt(w.units)}곳에도 치과의원은 모두 ${fmt(w.clinics)}곳이 등록되어 있다.`));
  assert(release.includes(`지역별로 ${fmt(w.minClinics)}곳부터 ${fmt(w.maxClinics)}곳까지다.`));
  for (const bucket of d.hospitalCountBuckets) assert(release.includes(`| ${bucket.label} | ${fmt(bucket.units)}곳 |`), bucket.label);
  assert.equal(d.hospitalCountBuckets.reduce((sum, bucket) => sum + bucket.units, 0), d.total);
  for (const kind of d.kinds) assert(release.includes(`| ${kind.label} | ${fmt(kind.total)}곳 | ${fmt(kind.withHospital)}곳 | ${fmt(kind.withoutHospital)}곳 | ${pct(kind.percentWith)} |`), kind.label);
  const gun = d.kinds.find(kind => kind.kind === '군');
  assert(release.includes(`군 지역 ${fmt(gun.total)}곳 중 치과병원이 등록된 곳은 ${fmt(gun.withHospital)}곳(${pct(gun.percentWith)})이다.`));
  assert(release.includes(`전국 ${fmt(d.hospitals)}곳 중 ${fmt(d.concentration.hospitals)}곳(${pct(d.concentration.percentOfHospitals)})이 ${fmt(d.concentration.units)}개 시·군·구에 있다.`));
  assert(d.bySido.length > 10);
  for (const sido of d.bySido) assert(release.includes(`| ${sido.sido} | ${fmt(sido.total)}곳 | ${fmt(sido.withHospital)}곳 (${pct(sido.percentWith)}) | ${fmt(sido.hospitals)}곳 | ${fmt(sido.clinics)}곳 |`), sido.sido);
  assert.equal(d.bySido.reduce((sum, sido) => sum + sido.hospitals, 0), g.total, 'the 시도 table adds up to the headline number');

  assert(release.includes(`| 등록 항목 | 치과병원 ${fmt(h.total)}곳 | 치과의원 ${fmt(c.total)}곳 |`));
  assert(release.includes(`| 치과전문의 등록 평균 (중앙값) | ${dec(h.specialist.mean)}명 (${dec(h.specialist.median)}명) | ${dec(c.specialist.mean)}명 (${dec(c.specialist.median)}명) |`));
  assert(release.includes(`| 전문의 1명 이상 등록 | ${fmt(h.specialist.atLeastOne.count)}곳 (${pct(h.specialist.atLeastOne.percentOfKnown)}) | ${fmt(c.specialist.atLeastOne.count)}곳 (${pct(c.specialist.atLeastOne.percentOfKnown)}) |`));
  assert(release.includes(`| 전문의 3명 이상 등록 | ${fmt(h.specialist.atLeastThree.count)}곳 (${pct(h.specialist.atLeastThree.percentOfKnown)}) | ${fmt(c.specialist.atLeastThree.count)}곳 (${pct(c.specialist.atLeastThree.percentOfKnown)}) |`));
  assert(release.includes(`| 콘빔CT 등록 기관 | ${fmt(h.cbct.registered.count)}곳 (${pct(h.cbct.registered.percentOfTotal)}) | ${fmt(c.cbct.registered.count)}곳 (${pct(c.cbct.registered.percentOfTotal)}) |`));
  assert(release.includes(`| 콘빔CT 등록 평균 대수 | ${dec(h.cbct.mean)}대 | ${dec(c.cbct.mean)}대 |`));
  assert(release.includes(`분모는 전문의 수가 기록된 기관(치과병원 ${fmt(h.specialist.known)}곳, 치과의원 ${fmt(c.specialist.known)}곳)`));
  assert(release.includes(`콘빔CT 항목이 기록된 기관(치과병원 ${fmt(h.cbct.known)}곳, 치과의원 ${fmt(c.cbct.known)}곳)`));
  for (const bucket of g.opening) assert(release.includes(`| ${bucket.label} | ${fmt(bucket.count)}곳 | ${pct(bucket.percentOfTotal)} |`), bucket.label);

  assert(release.includes(`- 자료 기준일: ${reports.snapshotDate} · 건강보험심사평가원 「전국 병의원 및 약국 현황」 · ${localDate(reports.observedAt)} 수집`));
  assert(release.includes(`원본 압축파일 SHA-256 ${reports.sourceSha256}`));
  assert(release.includes(`- 원자료: ${SOURCE_URL}`));
});

test('every number in the release comes from the report data, and changes when the data changes', () => {
  // Numbers the reports object can produce: each numeric value in the three formats the release uses, and digits inside its strings.
  const allowed = new Set(['4.0', '1', '3']); // CC BY 4.0, 공공누리 제1유형, the "1곳/1명 이상" and "3명 이상" thresholds
  const collect = value => {
    if (typeof value === 'number' && Number.isFinite(value)) for (const text of [fmt(value), dec(value), value.toFixed(1)]) allowed.add(text);
    else if (typeof value === 'string') for (const token of value.match(NUMBER) ?? []) allowed.add(token);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  collect(reports);
  const body = release.replaceAll(reports.sourceSha256, '').replace(/https?:\/\/\S+/g, '').replaceAll(reports.snapshotDate, '').replaceAll(localDate(reports.observedAt), '');
  const typed = [...new Set(body.match(NUMBER) ?? [])].filter(token => !allowed.has(token));
  assert.deepEqual(typed, [], 'numbers that are not in collectReports output');

  const changed = structuredClone(reports);
  changed.dentalHospitals.total = 987654;
  changed.hospitalDistricts.withHospital = 876543;
  changed.hospitalDistricts.withoutHospitalClinics.clinics = 765432;
  const other = renderPressRelease(changed, { domain, operator });
  assert(other.startsWith('# 전국 치과병원 987,654곳, '));
  assert(other.includes('곳 중 876,543곳에 등록') && other.includes('치과의원은 모두 765,432곳이 등록되어 있다'));
  assert(!other.includes(`전국 치과병원은 ${fmt(reports.dentalHospitals.total)}곳이며`));

  const small = fixture(), text = renderPressRelease(small, { domain: 'https://dentaldatalab.example', operator: {} });
  assert.equal(text.split('\n')[0], `# 전국 치과병원 ${fmt(small.dentalHospitals.total)}곳, 시·군·구 ${fmt(small.hospitalDistricts.total)}곳 중 ${fmt(small.hospitalDistricts.withHospital)}곳에 등록`);
  assert(text.includes('(건강보험심사평가원 2031-03-31 기준)') && !text.includes(reports.snapshotDate));
  assert(text.includes('https://dentaldatalab.example/reports/dental-hospitals/') && !text.includes('dentaldatalab.com'));
  assert.doesNotMatch(text, /undefined|NaN|null|\[object/);
  assert.equal(pressReleaseFileName(small), '2031-03-31-dental-hospitals.md');
});

test('the release and the headline facts contain no institution name, ranking or quality wording', () => {
  const names = [...new Set(source.clinics.map(item => item.name).filter(name => typeof name === 'string' && name.trim()))];
  assert(names.length > 10000);
  const facts = headlineFacts(reports), factText = facts.map(fact => `${fact.headline} ${fact.detail} ${fact.caveat}`).join('\n');
  for (const text of [release, factText]) {
    assert.deepEqual(names.filter(name => text.includes(name)), []);
    assert.doesNotMatch(text, /\/clinics\/|c-[0-9a-f]{12}/);
    assert.doesNotMatch(text, /더 안전|더 실력|믿을 수 있는|고려하세요|우수한|소외|공백 지역|의료 취약|사각지대|1위|최고|최다|가장 (많|적|높|낮)|상위 \d|TOP|베스트/);
  }
  const small = renderPressRelease(fixture(), { domain });
  for (const forbidden of [institutionName, '개별주소비공개표식', 'private-a']) assert(!small.includes(forbidden), forbidden);

  // The first sentence of each fact states a number and the 기준일.
  assert(facts.length >= 6);
  assert.equal(facts[0].headline, `전국 치과병원은 ${fmt(reports.dentalHospitals.total)}곳입니다(건강보험심사평가원 ${reports.snapshotDate} 기준).`);
  assert.equal(new Set(facts.map(fact => fact.id)).size, facts.length);
  for (const fact of facts) {
    assert.match(fact.headline, /\d/, fact.id);
    assert(fact.headline.endsWith(`(건강보험심사평가원 ${reports.snapshotDate} 기준).`), fact.id);
    assert(!fact.headline.includes('. '), `${fact.id}: the headline is one sentence`);
    assert(fact.caveat.length > 10 && fact.caveat.endsWith('.'), fact.id);
  }
});

test('no person is quoted: one marked placeholder, the operator as the only contact, outlets named without addresses', () => {
  assert.equal(release.split(COMMENT_PLACEHOLDER).length, 2, 'exactly one placeholder');
  const placeholderLine = release.split('\n').find(line => line.includes(COMMENT_PLACEHOLDER));
  assert(placeholderLine.startsWith(`> ${COMMENT_PLACEHOLDER} `));
  assert.equal(release.split('\n## 운영자 코멘트\n').length, 2);
  assert.doesNotMatch(release, /[“”"]/, 'no quotation marks: nothing is attributed to a speaker');
  assert.doesNotMatch(release, /라고 (말했다|밝혔다|전했다|설명했다|강조했다|덧붙였다)|관계자는|대표는|원장은|교수는|씨는/);

  const emails = release.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [];
  assert(emails.length >= 1 && emails.every(email => email === operator.correctionEmail), emails.join(','));
  assert.deepEqual(renderPressRelease(reports, { domain, operator: {} }).match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [], []);

  // Outlets are named only in the internal checklist, with an instruction to use each outlet's own channel.
  const [publicPart, internal] = release.split(INTERNAL_HEADING);
  assert(internal && release.split(INTERNAL_HEADING).length === 2);
  assert.deepEqual([...TRADE_OUTLETS], ['치의신보', '덴탈아리랑']);
  for (const outlet of TRADE_OUTLETS) { assert(internal.includes(outlet)); assert(!publicPart.includes(outlet)); }
  assert.match(internal, /각 매체가 홈페이지에서 안내하는 보도자료·기사제보 창구/);
  assert.match(internal, /매체 연락처를 싣지 않는다/);
  const hosts = [...new Set([...release.matchAll(/https?:\/\/([^/\s)]+)/g)].map(match => match[1]))].sort();
  assert.deepEqual(hosts, ['creativecommons.org', 'dentaldatalab.com', 'www.data.go.kr', 'www.law.go.kr']);

  // Reuse terms and the required attribution, per report.
  assert(release.includes('CC BY 4.0(https://creativecommons.org/licenses/by/4.0/deed.ko)'));
  assert(release.includes('공공누리 제1유형(출처표시)'));
  for (const slug of ['dental-hospital-districts', 'dental-hospitals', 'dental-hospital-vs-clinic']) {
    assert(release.includes(`\`출처: 치과데이터랩(${domain}/reports/${slug}/) · 원자료: 건강보험심사평가원 「전국 병의원 및 약국 현황」(${reports.snapshotDate} 기준)\``), slug);
    assert(release.includes(`${domain}/data/reports/${slug}.csv`) && release.includes(`${domain}/data/reports/${slug}.json`), slug);
  }
  assert(release.includes(`${domain}/data/open/`) && release.includes(`${domain}/press/`) && release.includes(`${domain}/corrections/`));
  for (const heading of ['## 주요 집계 결과', '## 자료 설명과 한계', '## 이용 조건', '## 자료 링크', '## 문의', '## 치과데이터랩 소개']) assert(release.includes(`\n${heading}\n`), heading);
  assert.equal(renderPressRelease(reports, { domain, operator }), release, 'pure: same input, same text');
});

test('the committed draft is the generator output for the current data until a person edits it', t => {
  const file = path.join(root, 'docs/press', pressReleaseFileName(reports));
  if (!fs.existsSync(file)) return t.skip(`no draft for ${reports.snapshotDate} yet: run node scripts/press-release.mjs`);
  const committed = fs.readFileSync(file, 'utf8');
  if (!committed.includes(COMMENT_PLACEHOLDER)) return t.skip('the draft was edited by a person and is no longer compared with the generator');
  assert.equal(committed, release, 'docs/press draft is stale: run node scripts/press-release.mjs');
});

test('the CLI writes the draft and refuses to overwrite a file a person has edited', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-press-'));
  try {
    const run = (...args) => spawnSync(process.execPath, [path.join(root, 'scripts/press-release.mjs'), '--out', out, ...args], { encoding: 'utf8', env: { ...process.env, SITE_ORIGIN: domain } });
    const file = path.join(out, pressReleaseFileName(reports));
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).file, file);
    assert.equal(fs.readFileSync(file, 'utf8'), release);
    assert.equal(run().status, 0, 'an untouched draft is regenerated');

    const edited = release.replace(COMMENT_PLACEHOLDER, '운영자가 직접 쓴 문장');
    fs.writeFileSync(file, edited);
    const refused = run();
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /already edited by a person/);
    assert.equal(fs.readFileSync(file, 'utf8'), edited, 'the edited file is left alone');
    assert.equal(run('--force').status, 0);
    assert.equal(fs.readFileSync(file, 'utf8'), release);
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
