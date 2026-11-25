#!/usr/bin/env node
// Press-release draft for the current snapshot, rendered from collectReports(). Every number in the text comes from
// the report data; nothing here quotes a person. The draft carries one marked placeholder for the operator's own
// comment and an internal checklist, both of which a human resolves before anything is sent.
//
//   node scripts/press-release.mjs [--out docs/press] [--force]
//
// Writes <out>/<snapshot date>-dental-hospitals.md. A file whose comment placeholder was already replaced by a human
// is not overwritten unless --force is given.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fmt, localDate, SOURCE_URL } from '../src/shared.mjs';
import { pct } from './html.mjs';
import { siteOrigin } from './seo.mjs';
import { validateOperator } from './site-operations.mjs';
import { collectReports } from './report-data.mjs';
import { REPORTS } from './report-pages.mjs';
import { LICENSE, SOURCE_LICENSE, SOURCE_TITLE, NOT_COVERED, OPEN_DATA_ROUTE, PRESS_ROUTE, attributionText, reportRoute, reportDataPath, reportTitleOf } from './open-data.mjs';

export const COMMENT_PLACEHOLDER = '[작성 필요: 운영자 코멘트]';
export const INTERNAL_HEADING = '## 배포 전 확인 (내부용 · 보내기 전에 이 절을 지우세요)';
// Trade outlets the owner named. Contact addresses are deliberately not recorded: each outlet's own channel is used.
export const TRADE_OUTLETS = Object.freeze(['치의신보', '덴탈아리랑']);
const RELEASE_REPORTS = Object.freeze(['dental-hospital-districts', 'dental-hospitals', 'dental-hospital-vs-clinic']);

const dec = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
const unit = (value, suffix) => value == null ? '산출 불가' : dec(value) + suffix;
const sentence = text => String(text).replace(/[.\s]+$/, '') + '.';
const kindOf = (districts, key) => districts.kinds.find(kind => kind.kind === key) ?? { total: 0, withHospital: 0, withoutHospital: 0, percentWith: null };
export const pressReleaseFileName = reports => `${reports.snapshotDate}-dental-hospitals.md`;

/**
 * Headline numbers for the press page and the release. `headline` is one sentence that states the number and the
 * 기준일; `caveat` is the definition or limit the report already publishes for that number.
 */
export function headlineFacts(reports) {
  const g = reports.dentalHospitals, h = g.hospitals, d = reports.hospitalDistricts, n = reports.national;
  const basis = `(건강보험심사평가원 ${reports.snapshotDate} 기준)`;
  const gun = kindOf(d, '군'), si = kindOf(d, '시'), gu = kindOf(d, '구'), c = d.concentration, w = d.withoutHospitalClinics;
  return [
    { id: 'hospitals-total', report: 'dental-hospitals',
      headline: `전국 치과병원은 ${fmt(g.total)}곳입니다${basis}.`,
      detail: `같은 자료의 치과의원은 ${fmt(g.types.clinic)}곳입니다.`, caveat: g.definitions.population },
    { id: 'districts-coverage', report: 'dental-hospital-districts',
      headline: `치과가 등록된 시·군·구 ${fmt(d.total)}곳 중 치과병원이 있는 곳은 ${fmt(d.withHospital)}곳(${pct(d.percentWith)}), 없는 곳은 ${fmt(d.withoutHospital)}곳입니다${basis}.`,
      detail: w.units ? `치과병원이 없는 ${fmt(w.units)}곳에는 치과의원이 모두 ${fmt(w.clinics)}곳 등록되어 있습니다.` : '', caveat: d.definitions.coverage },
    ...(gun.total ? [{ id: 'districts-gun', report: 'dental-hospital-districts',
      headline: `군 지역 ${fmt(gun.total)}곳 중 치과병원이 있는 곳은 ${fmt(gun.withHospital)}곳(${pct(gun.percentWith)})입니다${basis}.`,
      detail: `시는 ${fmt(si.total)}곳 중 ${fmt(si.withHospital)}곳, 자치구는 ${fmt(gu.total)}곳 중 ${fmt(gu.withHospital)}곳입니다.`, caveat: d.definitions.noPopulation }] : []),
    ...(c.units != null ? [{ id: 'districts-concentration', report: 'dental-hospital-districts',
      headline: `전국 치과병원 ${fmt(d.hospitals)}곳 중 ${fmt(c.hospitals)}곳(${pct(c.percentOfHospitals)})이 ${fmt(c.units)}개 시·군·구에 등록되어 있습니다${basis}.`,
      detail: sentence(`${d.definitions.concentration}입니다`), caveat: '기관 수를 센 것이며 지역의 진료 수준이나 접근성을 평가한 순위가 아님' }] : []),
    ...(h.specialist.known ? [{ id: 'specialists', report: 'dental-hospitals',
      headline: `치과병원에 등록된 치과전문의는 기관당 평균 ${unit(h.specialist.mean, '명')}, 중앙값 ${unit(h.specialist.median, '명')}입니다${basis}.`,
      detail: `전문의 수가 기록된 ${fmt(h.specialist.known)}곳 기준이며, 1명 이상 등록된 곳은 ${fmt(h.specialist.atLeastOne.count)}곳(${pct(h.specialist.atLeastOne.percentOfKnown)})입니다.`, caveat: g.definitions.specialist }] : []),
    ...(h.total ? [{ id: 'cbct', report: 'dental-hospitals',
      headline: `콘빔CT가 등록된 치과병원은 ${fmt(h.cbct.registered.count)}곳으로 전체 ${fmt(h.total)}곳의 ${pct(h.cbct.registered.percentOfTotal)}입니다${basis}.`,
      detail: h.cbct.known ? `콘빔CT 항목이 기록된 ${fmt(h.cbct.known)}곳의 등록 대수는 평균 ${unit(h.cbct.mean, '대')}입니다.` : '', caveat: g.definitions.cbct },
    { id: 'opening', report: 'dental-hospitals',
      headline: `치과병원의 신고 개설 시기는 ${g.opening.filter(bucket => bucket.count > 0).map(bucket => `${bucket.label} ${fmt(bucket.count)}곳`).join(', ')}입니다${basis}.`,
      detail: '', caveat: g.definitions.opening }] : []),
    { id: 'hours-coverage', report: 'national-data-coverage',
      headline: `전국 치과병원·치과의원 ${fmt(n.total)}곳 중 하루 이상 진료시간이 등록된 곳은 ${fmt(n.metrics.hours.count)}곳(${pct(n.metrics.hours.percentOfTotal)})입니다${basis}.`,
      detail: `나머지 ${fmt(n.total - n.metrics.hours.count)}곳은 원자료에 시간이 없는 것이며 휴진을 뜻하지 않습니다.`, caveat: g.definitions.hours },
  ].map(fact => ({ ...fact, caveat: sentence(fact.caveat) }));
}

/** What the data cannot say. Each text is the caveat the reports already publish, with a short label. */
export function dataLimits(reports) {
  const g = reports.dentalHospitals.definitions, d = reports.hospitalDistricts.definitions;
  return [
    { label: '순위·평가가 아님', text: '등록 자료를 센 집계이며 기관 간 순위나 평가가 아님. 진료 실력이나 치료 결과를 뜻하지 않음' },
    { label: '치과병원이 없다는 것', text: d.coverage },
    { label: '인구 대비·접근성', text: d.noPopulation },
    { label: '대상', text: g.population },
    { label: '전문의 수', text: g.specialist },
    { label: '콘빔CT', text: g.cbct },
    { label: '진료시간', text: g.hours },
    { label: '시점', text: `${reports.snapshotDate} 기준 분기 자료 한 건. 현재 운영 여부를 확인한 것이 아니며 여러 분기의 변화는 아직 비교하지 않음` },
    { label: '수집하지 않은 것', text: '가격·후기·실시간 운영·예약 가능 여부는 수집하지 않음' },
  ].map(limit => ({ ...limit, text: sentence(limit.text) }));
}

export function pressReleaseTitle(reports) {
  const g = reports.dentalHospitals, d = reports.hospitalDistricts;
  return `전국 치과병원 ${fmt(g.total)}곳, 시·군·구 ${fmt(d.total)}곳 중 ${fmt(d.withHospital)}곳에 등록`;
}

// Markdown table. Value columns are right-aligned unless the cells are text (numeric: false).
const mdTable = (headers, rows, { numeric = true } = {}) => [`| ${headers.join(' | ')} |`, `|${headers.map((_, index) => index && numeric ? '---:' : '---').join('|')}|`, ...rows.map(row => `| ${row.join(' | ')} |`)].join('\n');
const countShare = (count, percent) => `${fmt(count)}곳 (${pct(percent)})`;

/**
 * Korean press release in Markdown. Pure: the same reports, origin and operator always give the same text.
 * @param {object} reports collectReports() output
 * @param {{domain?: string, operator?: {operatorName?: string|null, correctionEmail?: string|null}}} [options]
 */
export function renderPressRelease(reports, { domain = 'https://dentaldatalab.com', operator = {} } = {}) {
  const g = reports.dentalHospitals, h = g.hospitals, c = g.clinics, d = reports.hospitalDistricts, n = reports.national;
  const w = d.withoutHospitalClinics, conc = d.concentration, gun = kindOf(d, '군');
  const snapshot = reports.snapshotDate, collected = localDate(reports.observedAt);
  const items = RELEASE_REPORTS.map(slug => REPORTS.find(item => item.slug === slug)).filter(Boolean);
  const cite = slug => attributionText({ pageUrl: domain + reportRoute({ slug }), snapshotDate: snapshot });
  // The legal classification is stated only while the report data carries its primary source.
  const law = (reports.externalFacts ?? []).find(fact => fact.id === 'medical-service-act-3-2' && fact.sourceKind === 'primary');
  const operatorLabel = operator.operatorName ? `치과데이터랩 (운영: ${operator.operatorName})` : '치과데이터랩';
  const lines = [
    `# ${pressReleaseTitle(reports)}`,
    '',
    `**치과데이터랩, 건강보험심사평가원 ${snapshot} 기준 자료의 집계표를 ${LICENSE.name}으로 공개${w.units ? ` · 치과병원이 없는 ${fmt(w.units)}곳에는 치과의원 ${fmt(w.clinics)}곳 등록` : ''}**`,
    '',
    '- 구분: 보도자료 (배포 즉시 보도 가능)',
    `- 자료 기준일: ${snapshot} · ${SOURCE_TITLE} · ${collected} 수집`,
    `- 문의: ${operatorLabel}${operator.correctionEmail ? ` · ${operator.correctionEmail}` : ''} · ${domain}${PRESS_ROUTE}`,
    '',
    `전국 치과병원은 ${fmt(g.total)}곳이며(건강보험심사평가원 ${snapshot} 기준), 치과가 등록된 시·군·구 ${fmt(d.total)}곳 가운데 ${fmt(d.withHospital)}곳(${pct(d.percentWith)})에 1곳 이상 등록되어 있다. 치과 공공데이터 서비스 치과데이터랩은 ${SOURCE_TITLE}에서 치과병원(종별코드 41)과 치과의원(종별코드 51) ${fmt(n.total)}곳을 같은 기준으로 집계하고, 출처를 표시하면 누구나 쓸 수 있도록 집계표를 ${LICENSE.name} 조건으로 공개했다.`,
    '',
    ...(w.units ? [`치과병원이 없는 시·군·구 ${fmt(w.units)}곳에도 치과의원은 모두 ${fmt(w.clinics)}곳이 등록되어 있다. ${law ? `치과병원과 치과의원은 ${law.title.replace(/\s*\(.*\)$/, '')}이 병원급과 의원급 의료기관으로 구분하는 종별이다. ` : ''}치과병원이 없다는 것은 원자료에 종별코드 41 기관이 없다는 뜻이며 치과 진료를 받을 수 없다는 뜻이 아니다.`, ''] : []),
    '## 주요 집계 결과',
    '',
    `### 치과병원 ${fmt(g.total)}곳, 치과의원 ${fmt(g.types.clinic)}곳`,
    '',
    `같은 분기 자료에 치과병원은 ${fmt(g.total)}곳, 치과의원은 ${fmt(g.types.clinic)}곳이 등록되어 있다. 종합병원과 상급종합병원의 치과 진료과목은 이 집계에 포함하지 않았다.`,
    '',
    `### 시·군·구 ${fmt(d.total)}곳 중 ${fmt(d.withHospital)}곳에 치과병원`,
    '',
    `치과병원이 1곳 이상 등록된 시·군·구는 ${fmt(d.withHospital)}곳(${pct(d.percentWith)}), 없는 곳은 ${fmt(d.withoutHospital)}곳이다.${w.units ? ` 치과병원이 없는 곳의 치과의원 수는 지역별로 ${fmt(w.minClinics)}곳부터 ${fmt(w.maxClinics)}곳까지다.` : ''}`,
    '',
    mdTable(['시·군·구별 치과병원 수', '시·군·구'], d.hospitalCountBuckets.map(bucket => [bucket.label, `${fmt(bucket.units)}곳`])),
    '',
    '### 시·군·자치구로 나눠 보면',
    '',
    ...(gun.total ? [`군 지역 ${fmt(gun.total)}곳 중 치과병원이 등록된 곳은 ${fmt(gun.withHospital)}곳(${pct(gun.percentWith)})이다. 인구 자료를 결합하지 않았으므로 인구 대비 수치나 접근성 지표는 산출하지 않았다.`, ''] : []),
    mdTable(['구분', '시·군·구', '치과병원 있음', '치과병원 없음', '있는 곳의 비율'], d.kinds.map(kind => [kind.label, `${fmt(kind.total)}곳`, `${fmt(kind.withHospital)}곳`, `${fmt(kind.withoutHospital)}곳`, pct(kind.percentWith)])),
    '',
    ...(conc.units != null ? [
      `### 치과병원 절반 이상이 ${fmt(conc.units)}개 시·군·구에`,
      '',
      `치과병원이 많이 등록된 시·군·구부터 더하면 전국 ${fmt(d.hospitals)}곳 중 ${fmt(conc.hospitals)}곳(${pct(conc.percentOfHospitals)})이 ${fmt(conc.units)}개 시·군·구에 있다. 기관 수를 센 것이며 지역의 진료 수준이나 접근성을 평가한 순위가 아니다.`,
      '',
    ] : []),
    '### 시도별 분포',
    '',
    mdTable(['원자료 시도', '시·군·구', '치과병원이 있는 시·군·구', '치과병원', '치과의원'], d.bySido.map(sido => [sido.sido, `${fmt(sido.total)}곳`, countShare(sido.withHospital, sido.percentWith), `${fmt(sido.hospitals)}곳`, `${fmt(sido.clinics)}곳`])),
    '',
    '시도 이름은 원자료 표기를 그대로 썼으며 현재 행정구역으로 재분류하지 않았다. 시도마다 시·군·구 수와 면적, 인구가 다르므로 비율로 지역의 진료 수준을 판단할 수 없다.',
    '',
    '### 전문의·콘빔CT 등록',
    '',
    mdTable(['등록 항목', `치과병원 ${fmt(h.total)}곳`, `치과의원 ${fmt(c.total)}곳`], [
      ['치과전문의 등록 평균 (중앙값)', `${unit(h.specialist.mean, '명')} (${unit(h.specialist.median, '명')})`, `${unit(c.specialist.mean, '명')} (${unit(c.specialist.median, '명')})`],
      ['전문의 1명 이상 등록', countShare(h.specialist.atLeastOne.count, h.specialist.atLeastOne.percentOfKnown), countShare(c.specialist.atLeastOne.count, c.specialist.atLeastOne.percentOfKnown)],
      ['전문의 3명 이상 등록', countShare(h.specialist.atLeastThree.count, h.specialist.atLeastThree.percentOfKnown), countShare(c.specialist.atLeastThree.count, c.specialist.atLeastThree.percentOfKnown)],
      ['콘빔CT 등록 기관', countShare(h.cbct.registered.count, h.cbct.registered.percentOfTotal), countShare(c.cbct.registered.count, c.cbct.registered.percentOfTotal)],
      ['콘빔CT 등록 평균 대수', unit(h.cbct.mean, '대'), unit(c.cbct.mean, '대')],
    ]),
    '',
    `전문의 비율의 분모는 전문의 수가 기록된 기관(치과병원 ${fmt(h.specialist.known)}곳, 치과의원 ${fmt(c.specialist.known)}곳)이고, 콘빔CT 등록 기관 비율의 분모는 전체 기관이다. 평균 대수는 콘빔CT 항목이 기록된 기관(치과병원 ${fmt(h.cbct.known)}곳, 치과의원 ${fmt(c.cbct.known)}곳)만으로 계산했으며, 항목이 없는 기관을 보유하지 않은 것으로 보지 않았다. 두 종별의 등록 항목을 같은 정의로 나란히 집계한 것이며 종별 간 우열이나 진료의 질을 평가하지 않는다.`,
    '',
    '### 개설 시기',
    '',
    mdTable(['신고 개설 시기', '치과병원', '전체 대비'], g.opening.map(bucket => [bucket.label, `${fmt(bucket.count)}곳`, pct(bucket.percentOfTotal)])),
    '',
    '원자료 개설일의 연도다. 개설일은 현재 운영 여부를 뜻하지 않으며 법인·종별 변경 때 바뀔 수 있다.',
    '',
    '## 운영자 코멘트',
    '',
    `> ${COMMENT_PLACEHOLDER} 자동 생성된 자리표시입니다. 운영자가 직접 쓴 한두 문장으로 바꾸거나, 쓰지 않으려면 이 절을 지우세요. 이 초안은 사람의 말을 지어내지 않습니다.`,
    '',
    '## 자료 설명과 한계',
    '',
    `- 원자료: ${SOURCE_TITLE} ${snapshot} 기준 분기 파일(공공데이터포털, ${collected} 수집). 원본 압축파일 SHA-256 ${reports.sourceSha256}`,
    ...dataLimits(reports).map(limit => `- ${limit.label}: ${limit.text}`),
    '- 기관명과 기관별 순위는 싣지 않았다. 집계 방법과 분모는 각 리포트의 「집계 방법과 해석 범위」에 있다.',
    '',
    '## 이용 조건',
    '',
    `- 아래 리포트의 집계표·그래프와 CSV·JSON은 ${LICENSE.name}(${LICENSE.deedUrl})으로 공개한다. 출처를 표시하면 허락을 따로 구하지 않고 인용·가공·재배포할 수 있고 영리 목적도 가능하다.`,
    ...items.map(item => `- 출처 표기 (${reportTitleOf(item, reports)}): \`${cite(item.slug)}\``),
    `- 원자료는 ${SOURCE_LICENSE.name} 조건을 그대로 따른다.`,
    `- 적용되지 않는 것: ${NOT_COVERED.filter(entry => entry.id !== 'source').map(entry => entry.what).join(' / ')}`,
    `- 전체 조건과 내려받기: ${domain}${OPEN_DATA_ROUTE}`,
    '',
    '## 자료 링크',
    '',
    mdTable(['리포트', '페이지', 'CSV', 'JSON'], items.map(item => [reportTitleOf(item, reports), domain + reportRoute(item), domain + reportDataPath(item, 'csv'), domain + reportDataPath(item, 'json')]), { numeric: false }),
    '',
    `- 원자료: ${SOURCE_URL}`,
    ...(law ? [`- ${law.title}: ${law.sourceUrl}`] : []),
    `- 보도·인용 안내: ${domain}${PRESS_ROUTE}`,
    '',
    '## 문의',
    '',
    `- ${operatorLabel}`,
    ...(operator.correctionEmail ? [`- 이메일: ${operator.correctionEmail}`] : []),
    `- 수치 오류 제보: ${domain}/corrections/`,
    '',
    '## 치과데이터랩 소개',
    '',
    `치과데이터랩(${domain})은 건강보험심사평가원 공개 자료를 지역 통계와 조건 검색으로 정리하는 정보 서비스다. 치과를 점수로 줄 세우지 않으며 광고·후기·추천 점수·예약 중개를 제공하지 않는다. 제작에는 치과 관련 마케팅 업무 경험이 반영되어 있고 독립적인 평가기관이라고 주장하지 않는다(${domain}/about/).`,
    '',
    '---',
    '',
    INTERNAL_HEADING,
    '',
    '- [ ] 「운영자 코멘트」 절의 자리표시 줄을 운영자가 직접 쓴 문장으로 바꿨거나 그 절을 지웠다.',
    '- [ ] 수치가 사이트의 현재 리포트와 같은지 확인했다. `node scripts/press-release.mjs`는 같은 기준일 자료에서 같은 수치를 다시 만든다.',
    `- [ ] ${TRADE_OUTLETS.join(', ')} 등 치과 전문지에는 각 매체가 홈페이지에서 안내하는 보도자료·기사제보 창구로 보낸다. 받는 주소는 각 매체의 안내에서 직접 확인한다. 이 초안은 매체 연락처를 싣지 않는다.`,
    '- [ ] 보낸 뒤 `data/content/press-releases.json`에서 이 항목의 `status`를 `released`로, `releasedOn`을 배포일로 바꾼다. 그러면 /press/ 목록에 이 문서가 공개된다.',
    '',
  ];
  return lines.join('\n');
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (argv.includes('--help')) { console.log('node scripts/press-release.mjs [--out docs/press] [--force]'); return; }
  const outIndex = argv.indexOf('--out');
  if (outIndex >= 0 && !argv[outIndex + 1]) throw new Error('--out needs a directory');
  const out = path.resolve(outIndex >= 0 ? argv[outIndex + 1] : path.join(root, 'docs/press'));
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const data = read('data/clinics.json'), manifest = read('data/source-manifest.json'), operator = validateOperator(read('data/content/site-operator.json'));
  const reports = collectReports(data.clinics, { snapshotDate: data.snapshotDate, observedAt: data.observedAt, sourceSha256: manifest.archive.sha256 });
  const file = path.join(out, pressReleaseFileName(reports));
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes(COMMENT_PLACEHOLDER) && !argv.includes('--force')) {
    throw new Error(`${file} was already edited by a person (the comment placeholder is gone). Pass --force to overwrite it.`);
  }
  const text = renderPressRelease(reports, { domain: siteOrigin(process.env.SITE_ORIGIN), operator });
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(file, text);
  console.log(JSON.stringify({ file, snapshotDate: reports.snapshotDate, bytes: Buffer.byteLength(text) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
