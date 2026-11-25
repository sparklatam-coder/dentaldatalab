import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  hospitalSummary, hospitalSpecialtySentence, hospitalRegionCounts, hospitalRegionContext, hospitalLedger, hospitalLedgerPanel,
  snapshotLedgerSource, validateHospitalConfirmations, hospitalConfirmationPanel, sharedChannelUrls, hospitalSchemaExtras,
  hospitalProfileContext, hospitalLeadPanel, hospitalProfileBlocks, CONFIRMATION_CHANNELS, CONFIRMABLE_FIELDS,
} from '../scripts/hospital-profile.mjs';
import {mailtoLink} from '../scripts/site-operations.mjs';
import {undoCloudflareEmailObfuscation} from '../scripts/indexnow.mjs';
import {loadAssetInventory} from '../scripts/clinic-assets.mjs';
import {ctCount, localDate} from '../src/shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = '2026-09-30';
const hospital = {
  id: 'c-h1', name: '검증치과병원', typeCode: '41', type: '치과병원', sido: '경남', sidoCode: '380000', city: '양산시', cityCode: '380300', dong: '중부동',
  address: '경상남도 양산시 검증로 1', phone: '055-555-0100', openedOn: '2016-01-01', doctors: {specialist: 4},
  specialties: [{code: '50', name: '구강악안면외과', specialists: 2}, {code: '51', name: '치과보철과', specialists: 0}, {code: '53', name: '소아치과', specialists: null}],
  quality: {specialtyCountDiscrepancy: false},
};
const sameCity = {...hospital, id: 'c-h2', name: '둘째치과병원'};
const sameSido = {...hospital, id: 'c-h3', name: '셋째치과병원', city: '김해시', cityCode: '380100'};
const otherSido = {...hospital, id: 'c-h4', name: '넷째치과병원', sido: '서울', sidoCode: '110000', city: '종로구', cityCode: '110016'};
const clinic = {...hospital, id: 'c-c1', name: '검증치과의원', typeCode: '51', type: '치과의원'};
const clinics = [hospital, sameCity, sameSido, otherSido, clinic];
const registry = {schemaVersion: 1, snapshots: [{snapshotDate: '2026-09-30', registeredOn: '2026-10-19', archivedAt: '2026-11-26'}]};
const record = {clinicId: 'c-h1', confirmedOn: '2026-11-20', channel: 'email', confirmedByRole: '원무과', evidence: '원무과 회신 이메일 보관', fields: {phone: '055-555-0199'}};
const file = (...records) => ({schemaVersion: 1, records});
const context = (overrides = {}) => hospitalProfileContext({clinics, snapshot, observedOn: '2026-10-31', snapshotRegistry: registry, confirmed: file(), operator: {correctionEmail: 'ops@example.org'}, ...overrides});
const text = html => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
// Words that would turn a count into a ranking, a recommendation or a quality claim.
const EVALUATIVE = /가장|번째|순위|상위|최고|최초|유일|추천|1위|우수|인기|더 많|더 적|보다 많|보다 적/;

test('치과의원 (51) gets nothing: empty blocks, empty schema, no panels', () => {
  const ctx = context();
  assert.deepEqual(hospitalProfileBlocks(clinic, ctx, {ctCount: 2}), {lead: '', tail: '', schema: {}});
  assert.equal(hospitalSummary(clinic, {snapshot, ctCount: 2}), null);
  assert.equal(hospitalSpecialtySentence(clinic), null);
  assert.equal(hospitalRegionContext(clinic, ctx.regionCounts), null);
  assert.equal(hospitalLedger(clinic, ctx), null);
  assert.equal(hospitalLedgerPanel(clinic, ctx), '');
  assert.equal(hospitalConfirmationPanel(clinic), '');
  assert.equal(hospitalLeadPanel(clinic, ctx, {ctCount: 2}), '');
  assert.deepEqual(hospitalSchemaExtras(clinic, {snapshot, ctCount: 2}), {});
  assert.deepEqual(hospitalProfileBlocks(undefined, ctx), {lead: '', tail: '', schema: {}});
});

test('summary answers first from the record alone, with the registered-count caveat', () => {
  const summary = hospitalSummary(hospital, {snapshot, ctCount: 2});
  assert.equal(summary.text, '검증치과병원은 경남 양산시 중부동에 있는 치과병원(종별코드 41)입니다. 건강보험심사평가원 2026-09-30 자료 기준 치과전문의 4명과 콘빔CT 2대가 등록돼 있고, 신고 개설일은 2016-01-01입니다.');
  assert.equal(summary.sentences.length, 2);
  assert.match(summary.caveat, /등록 수는 신고된 값이며 현재 근무 인력이나 진료 실력을 뜻하지 않습니다/);
  assert.match(hospitalSummary({...hospital, name: '미소치과'}, {snapshot, ctCount: 2}).text, /^미소치과는 /);
  // A registered 0 is a count and is printed as 0.
  assert.match(hospitalSummary({...hospital, doctors: {specialist: 0}}, {snapshot, ctCount: 1}).text, /치과전문의 0명, 콘빔CT 1대로 등록돼 있고, 신고 개설일은/);
  // The same name is not repeated when 시도 and 시군구 carry one label.
  assert.match(hospitalSummary({...hospital, sido: '세종', city: '세종', dong: '나성동'}, {snapshot, ctCount: 2}).text, /^검증치과병원은 세종 나성동에 있는 /);
});

test('unknown counts and dates are 자료 미확인, never 0', () => {
  const noSpecialist = hospitalSummary({...hospital, doctors: {specialist: null}}, {snapshot, ctCount: 2}).text;
  assert.match(noSpecialist, /콘빔CT 2대로 등록돼 있고 치과전문의 등록 수는 자료 미확인이며, 신고 개설일은 2016-01-01입니다\./);
  const noCt = hospitalSummary(hospital, {snapshot, ctCount: null}).text;
  assert.match(noCt, /치과전문의 4명으로 등록돼 있고 콘빔CT 등록 수는 자료 미확인이며/);
  const nothing = hospitalSummary({...hospital, doctors: undefined, openedOn: null, dong: null}, {snapshot}).text;
  assert.equal(nothing, '검증치과병원은 경남 양산시에 있는 치과병원(종별코드 41)입니다. 건강보험심사평가원 2026-09-30 자료 기준 치과전문의와 콘빔CT 등록 수는 자료 미확인이며, 신고 개설일은 자료 미확인입니다.');
  for (const value of [noSpecialist, noCt, nothing]) assert.doesNotMatch(value, /0명|0대|undefined|null|NaN/);
});

test('registered 진료과목 sentence separates a registered specialist, a registered 0 and a missing count', () => {
  const subjects = hospitalSpecialtySentence(hospital);
  assert.equal(subjects.text, '등록 진료과목은 3개입니다. 전문의가 1명 이상 등록된 과목은 구강악안면외과(2명)이고, 치과보철과는 전문의 0명으로 등록돼 있습니다. 소아치과의 전문의 수는 자료 미확인입니다.');
  assert.match(subjects.caveat, /0명은 이 자료의 해당 항목에 0으로 등록된 상태입니다\. 현재의 전문의 부재를 별도로 검증한 결과가 아닙니다\./);
  assert.doesNotMatch(subjects.caveat, /합산하지 않습니다/);
  assert.match(hospitalSpecialtySentence({...hospital, quality: {specialtyCountDiscrepancy: true}}).caveat, /과목별 합계는 중복 자격·등록 기준 차이로 다를 수 있어 합산하지 않습니다/);
  const allZero = hospitalSpecialtySentence({...hospital, specialties: [{name: '치주과', specialists: 0}, {name: '구강내과', specialists: 0}]});
  assert.equal(allZero.text, '등록 진료과목은 2개입니다. 전문의가 1명 이상 등록된 과목은 없습니다. 치주과·구강내과는 전문의 0명으로 등록돼 있습니다.');
  const allStaffed = hospitalSpecialtySentence({...hospital, specialties: [{name: '치주과', specialists: 1}]});
  assert.equal(allStaffed.text, '등록 진료과목은 1개입니다. 전문의가 1명 이상 등록된 과목은 치주과(1명)입니다.');
  assert.doesNotMatch(allStaffed.caveat, /0명/);
  const none = hospitalSpecialtySentence({...hospital, specialties: []});
  assert.match(none.text, /진료과목 자료 미확인/);
  assert.doesNotMatch(none.text, /0개/);
});

test('regional context is two counts and two links, computed in one pass and never a rank', () => {
  const counts = hospitalRegionCounts(clinics);
  assert.equal(counts.total, 4);
  assert.deepEqual([...counts.sido], [['380000', 3], ['110000', 1]]);
  assert.deepEqual([...counts.city], [['380000/380300', 2], ['380000/380100', 1], ['110000/110016', 1]]);
  const region = hospitalRegionContext(hospital, counts);
  assert.equal(region.text, '원자료 지역 코드 기준으로 이 기관을 포함해 양산시에 치과병원 2곳, 경남에 3곳이 등록돼 있습니다.');
  assert.equal(region.hospitalsHref, '/hospitals/380000/');
  assert.equal(region.districtHref, '/regions/380000/380300/');
  assert.doesNotMatch(region.text, EVALUATIVE);
  // Each record is visited once: the counts never depend on a per-institution scan.
  let reads = 0;
  const counted = clinics.map(c => new Proxy(c, {get(target, key) { if (key === 'typeCode') reads++; return target[key]; }}));
  hospitalRegionCounts(counted);
  assert.equal(reads, clinics.length);
  assert.equal(hospitalRegionContext({...hospital, sidoCode: '999999'}, counts), null);
});

test('lead panel is one block: summary, 진료과목 with a link to the staff table, regional links', () => {
  const ctx = context();
  const html = hospitalLeadPanel(hospital, ctx, {ctCount: 2});
  assert.match(html, /^<section class="fact-panel" id="hospital-summary"/);
  assert.equal((html.match(/<h2/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<h1/);
  assert(html.includes(`<p id="hospital-summary-text" style="font-size:16px;line-height:1.8">${hospitalSummary(hospital, {snapshot, ctCount: 2}).text}</p>`));
  assert.match(html, /href="#staff"/);
  assert.doesNotMatch(html, /<table/); // the per-subject table stays in #staff
  assert.match(html, /href="\/hospitals\/380000\/"/);
  assert.match(html, /href="\/regions\/380000\/380300\/"/);
  assert.doesNotMatch(html, /href="#hospital-confirmed"/);
  assert.doesNotMatch(text(html), EVALUATIVE);
  const tricky = hospitalLeadPanel({...hospital, name: '<b>치과병원</b> & "따옴표"', specialties: [{name: '<i>과</i>', specialists: 1}]}, ctx, {ctCount: 2});
  assert.doesNotMatch(tricky, /<b>|<i>/);
  assert.match(tricky, /&lt;b&gt;치과병원&lt;\/b&gt; &amp; &quot;따옴표&quot;/);
});

test('ledger lists the snapshot dates that exist, newest first, and names the checks with no record', () => {
  const ledger = hospitalLedger(hospital, context());
  assert.deepEqual(ledger.entries.map(e => [e.date, e.kind]), [['2026-10-31', 'hira-collected'], ['2026-10-19', 'hira-registered'], ['2026-09-30', 'hira-reference']]);
  assert.deepEqual(ledger.missing, ['홈페이지 점검', '네이버지도 관찰', '병원 직접 확인']);
  // The archive date of the current file is bookkeeping, not a refresh of this page.
  assert(!ledger.entries.some(e => e.date === '2026-11-26'));
  // A snapshot the registry does not list has no portal registration date to show.
  const unlisted = hospitalLedger(hospital, context({snapshotRegistry: {snapshots: []}}));
  assert.deepEqual(unlisted.entries.map(e => e.kind), ['hira-collected', 'hira-reference']);
  const noCollection = hospitalLedger(hospital, context({observedOn: '자료 미확인', snapshotRegistry: null}));
  assert.deepEqual(noCollection.entries.map(e => e.kind), ['hira-reference']);
  const html = hospitalLedgerPanel(hospital, context());
  assert.match(html, /^<section class="fact-panel" id="update-ledger"><h2>갱신 기록<\/h2>/);
  assert.deepEqual([...html.matchAll(/<time datetime="([^"]+)">/g)].map(m => m[1]), ['2026-10-31', '2026-10-19', '2026-09-30']);
  assert.match(html, /아직 기록이 없는 확인: 홈페이지 점검 · 네이버지도 관찰 · 병원 직접 확인\. 아직 확인하지 않았다는 뜻이며/);
});

test('ledger grows with the snapshot registry and needs no code change for a second quarter', () => {
  const twoQuarters = {snapshots: [
    {snapshotDate: '2026-12-31', registeredOn: '2027-01-18'},
    {snapshotDate: '2026-09-30', registeredOn: '2026-10-19'},
    {snapshotDate: '2026-06-30', registeredOn: null},
  ]};
  assert.deepEqual(snapshotLedgerSource(twoQuarters).map(s => s.snapshotDate), ['2026-06-30', '2026-09-30', '2026-12-31']);
  // Still on the September import: the December file is archived but not what this page shows, so it is not listed.
  const before = hospitalLedger(hospital, context({snapshotRegistry: twoQuarters}));
  assert.deepEqual(before.entries.map(e => [e.date, e.kind]), [['2026-10-31', 'hira-collected'], ['2026-10-19', 'hira-registered'], ['2026-09-30', 'hira-reference'], ['2026-06-30', 'hira-earlier']]);
  // After the December import the earlier quarters stay as dated rows.
  const after = hospitalLedger(hospital, hospitalProfileContext({clinics, snapshot: '2026-12-31', observedOn: '2027-01-20', snapshotRegistry: twoQuarters, confirmed: file()}));
  assert.deepEqual(after.entries.map(e => [e.date, e.kind]), [['2027-01-20', 'hira-collected'], ['2027-01-18', 'hira-registered'], ['2026-12-31', 'hira-reference'], ['2026-09-30', 'hira-earlier'], ['2026-06-30', 'hira-earlier']]);
  assert.match(after.entries.at(-2).detail, /공공데이터포털 등록일 2026-10-19/);
  assert.doesNotMatch(after.entries.at(-1).detail, /공공데이터포털 등록일/);
  assert.throws(() => snapshotLedgerSource({snapshots: [{snapshotDate: '2026-09-31'}]}), /snapshotDate/);
  assert.throws(() => snapshotLedgerSource({snapshots: [{snapshotDate: '2026-09-30'}, {snapshotDate: '2026-09-30'}]}), /unique/);
  assert.throws(() => snapshotLedgerSource({snapshots: [{snapshotDate: '2026-09-30', registeredOn: '10/19'}]}), /registeredOn/);
  assert.throws(() => snapshotLedgerSource({}), /snapshots must be an array/);
});

test('ledger uses the inventory\'s own check times, in Korean dates, and only for checks that ran', () => {
  const assetRecord = {
    homepageChecks: [
      {url: 'http://a.example/', status: 'error', checkedAt: '2026-11-20T01:00:00Z'},
      {url: 'http://a.example/', status: 'read', checkedAt: '2026-11-01T16:30:00+00:00'}, // 2026-11-02 01:30 in Seoul
      {url: 'http://b.example/', status: 'blocked', checkedAt: '2026-11-25T00:00:00Z'},
    ],
    naverPlaceObservations: [
      {bodyStatus: 'blocked', identityMatch: null, checkedAt: '2026-11-10T09:00:00+09:00'},
      {bodyStatus: 'read', identityMatch: true, checkedAt: '2026-11-01T07:42:00+09:00'},
    ],
  };
  const ledger = hospitalLedger(hospital, context(), assetRecord);
  const homepage = ledger.entries.find(e => e.kind === 'homepage-check'), naver = ledger.entries.find(e => e.kind === 'naver-observation');
  assert.equal(homepage.date, '2026-11-02');
  assert.equal(homepage.date, localDate('2026-11-01T16:30:00+00:00'));
  assert.equal(homepage.detail, '등록·발굴 홈페이지 주소 2개를 점검했고 HTML을 받은 주소는 1개입니다. 날짜는 마지막으로 HTML을 받은 점검일입니다.');
  assert.equal(homepage.href, '#marketing-assets');
  assert.equal(naver.date, '2026-11-01');
  assert.match(naver.detail, /마지막으로 읽은 날짜입니다\. 이름·지역·전화 대조 조건을 충족했습니다\./);
  assert.equal(naver.href, '#naver-observed');
  assert.deepEqual(ledger.missing, ['병원 직접 확인']);
  assert.deepEqual(ledger.entries.map(e => e.date), ['2026-11-02', '2026-11-01', '2026-10-31', '2026-10-19', '2026-09-30']);
  // Nothing was read: the row says it is an attempt, and an unmatched observation is not called this institution's.
  const failed = hospitalLedger(hospital, context(), {
    homepageChecks: [{url: 'http://a.example/', status: 'http_error', checkedAt: '2026-11-20T01:00:00Z'}],
    naverPlaceObservations: [{bodyStatus: 'read', identityMatch: false, checkedAt: '2026-11-03T00:00:00Z'}],
  });
  assert.match(failed.entries.find(e => e.kind === 'homepage-check').detail, /HTML을 받은 주소는 0개입니다\. 날짜는 마지막 점검 시도일입니다\./);
  assert.match(failed.entries.find(e => e.kind === 'naver-observation').detail, /충족하지 못해 이 기관의 확정 정보로 보지 않습니다/);
  const blocked = hospitalLedger(hospital, context(), {naverPlaceObservations: [{bodyStatus: 'blocked', checkedAt: '2026-11-03T00:00:00Z'}]});
  assert.match(blocked.entries.find(e => e.kind === 'naver-observation').detail, /읽지 못한 마지막 시도일/);
  // A check without a usable time is not given a date.
  const undated = hospitalLedger(hospital, context(), {homepageChecks: [{url: 'http://a.example/', status: 'read', checkedAt: null}]});
  assert(!undated.entries.some(e => e.kind === 'homepage-check'));
  assert(undated.missing.includes('홈페이지 점검'));
});

test('hospital-confirmed.json: the empty file and a complete record validate', () => {
  assert.equal(validateHospitalConfirmations(file(), clinics).size, 0);
  const full = {...record, fields: {phone: '055-555-0199', website: 'https://www.example-dental.kr/', bookingUrl: 'https://booking.example.com/b/1', hours: {mon: {open: '09:00', close: '18:00'}, sat: {open: '09:00', close: '13:00'}}, closedNote: '매월 둘째 주 수요일 휴진'}};
  const older = {...record, confirmedOn: '2026-10-02', channel: 'phone', fields: {closedNote: '일요일 휴진'}};
  const map = validateHospitalConfirmations(file(older, full), clinics);
  assert.deepEqual([...map.keys()], ['c-h1']);
  assert.deepEqual(map.get('c-h1').map(r => r.confirmedOn), ['2026-11-20', '2026-10-02']); // newest first
  for (const role of ['원무과', '행정팀', '경영지원실', '접수데스크', '홍보담당']) assert.equal(validateHospitalConfirmations(file({...record, confirmedByRole: role}), clinics).size, 1, role);
  assert.deepEqual(Object.keys(CONFIRMATION_CHANNELS), ['email', 'phone', 'document']);
  assert.deepEqual(Object.keys(CONFIRMABLE_FIELDS), ['phone', 'website', 'bookingUrl', 'hours', 'closedNote']);
  // The file in the repository is valid against the real institutions.
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/clinics.json'), 'utf8'));
  const real = JSON.parse(fs.readFileSync(path.join(root, 'data/content/hospital-confirmed.json'), 'utf8'));
  assert.deepEqual(real, {schemaVersion: 1, records: []});
  assert.equal(validateHospitalConfirmations(real, data.clinics).size, 0);
});

test('hospital-confirmed.json: anything unexpected throws', () => {
  const bad = (value, pattern, label) => assert.throws(() => validateHospitalConfirmations(value, clinics), pattern, label ?? JSON.stringify(value));
  const withFields = fields => file({...record, fields});
  bad(null, /must be an object/);
  bad([], /must be an object/);
  bad({schemaVersion: 1, records: [], note: 'x'}, /unexpected key "note"/);
  bad({schemaVersion: 2, records: []}, /schemaVersion must be 1/);
  bad({schemaVersion: '1', records: []}, /schemaVersion must be 1/);
  bad({schemaVersion: 1}, /records must be an array/);
  bad(file('c-h1'), /must be an object/);
  bad(file({...record, promotion: '임플란트 상담'}), /unexpected key "promotion"/);
  bad(file({...record, confirmedBy: '홍길동'}), /unexpected key "confirmedBy"/);
  // clinicId: must exist and be 종별코드 41.
  bad(file({...record, clinicId: 'c-missing'}), /existing 종별코드 41/);
  bad(file({...record, clinicId: 'c-c1'}), /existing 종별코드 41/);
  bad(file({...record, clinicId: undefined}), /existing 종별코드 41/);
  // confirmedOn: a real calendar date.
  for (const confirmedOn of ['2026-02-30', '2026-2-3', '20261120', '2026-11-20T09:00:00Z', '', null, 20261120]) bad(file({...record, confirmedOn}), /confirmedOn/);
  for (const channel of ['sms', 'kakao', 'Email', '', null]) bad(file({...record, channel}), /channel must be one of email\|phone\|document/);
  // confirmedByRole: a department, never a title, a name with a title, or free text.
  for (const confirmedByRole of ['원장', '실장', '김철수 실장', '홍길동', '원무과 김대리', 'front desk', '과', '', null, '원무과<b>']) bad(file({...record, confirmedByRole}), /confirmedByRole/);
  for (const evidence of ['', ' 앞 공백', '두 줄\n근거', '<b>근거</b>', 'kim@example.com 회신', '055-555-0100 통화', 'https://example.com/mail', '가'.repeat(121), null]) bad(file({...record, evidence}), /evidence/);
  // fields: only the five factual items.
  bad(withFields({}), /at least one item/);
  bad(withFields(null), /fields must be an object/);
  bad(withFields({intro: '친절한 진료'}), /unexpected key "intro"/);
  bad(withFields({phone: '055-555-0199', specialties: ['임플란트']}), /unexpected key "specialties"/);
  for (const phone of ['055-555', '055-555-0199,0200', '055-555-0199~1', '', 5555550199]) bad(withFields({phone}), /phone must be one dialable number/);
  for (const key of ['website', 'bookingUrl']) for (const url of ['javascript:alert(1)', 'ftp://example.com/', '/booking', 'example.com', 'http://localhost/', 'http://192.168.0.2/', ' https://example.com/', '', null]) bad(withFields({[key]: url}), new RegExp(key + ' must be an absolute public'));
  bad(withFields({hours: {}}), /hours must list at least one day/);
  bad(withFields({hours: []}), /hours must list at least one day/);
  bad(withFields({hours: {holiday: {open: '09:00', close: '13:00'}}}), /unexpected key "holiday"/);
  bad(withFields({hours: {mon: {open: '09:00', close: '18:00', lunch: '13:00'}}}), /unexpected key "lunch"/);
  bad(withFields({hours: {mon: '09:00~18:00'}}), /hours\.mon must be \{open, close\}/);
  for (const pair of [{open: '9:00', close: '18:00'}, {open: '09:00', close: '25:00'}, {open: '18:00', close: '09:00'}, {open: '09:00', close: '09:00'}, {open: '09:00'}, {open: 900, close: 1800}]) bad(withFields({hours: {mon: pair}}), /needs HH:MM open before close/);
  for (const closedNote of ['', '가'.repeat(121), '두 줄\n안내', '<b>휴진</b>', '자세한 안내 https://example.com', '지역 최고 수준의 진료', '임플란트 할인 이벤트', '교정 전문 병원', 12]) bad(withFields({closedNote}), /closedNote must be one factual line/);
  // 전문의 is a registered qualification, not advertising vocabulary.
  assert.equal(validateHospitalConfirmations(withFields({closedNote: '전문의 학회 참석일 휴진'}), clinics).size, 1);
  bad(file(record, {...record, fields: {closedNote: '일요일 휴진'}}), /duplicate confirmation/);
});

test('without a confirmation the panel is an invitation that promises no change in order or presentation', () => {
  const html = hospitalConfirmationPanel(hospital, null, {correctionEmail: 'ops@example.org'});
  assert.match(html, /^<section class="fact-panel" id="hospital-confirmed"><h2>병원이 직접 확인한 정보<\/h2>/);
  assert.match(html, /아직 이 병원이 직접 확인한 정보는 없습니다/);
  assert(html.includes(`href="/corrections/?clinic=${encodeURIComponent('검증치과병원')}"`));
  // Exactly the operator-page mailto form, so the Cloudflare e-mail reversal in IndexNow still recognises it.
  assert(html.includes(mailtoLink('ops@example.org')));
  assert.equal((html.match(/mailto:/g) ?? []).length, 1);
  assert.match(text(html), /확인은 무료이며, 확인 여부는 목록 순서나 표시 방식에 영향을 주지 않습니다\. 목록은 가나다순이고 유료 노출 상품은 없습니다\./);
  assert.match(text(html), /심평원 등록값과 따로 표시하며, 등록값을 고치지 않습니다/);
  // Cloudflare rewrites that anchor on the live site; the IndexNow byte comparison must be able to restore this panel.
  const cfEncode = (value, key = 0x5a) => Buffer.from([key, ...Buffer.from(value, 'utf8').map(byte => byte ^ key)]).toString('hex');
  const live = html.replace(/<a href="mailto:([^"]+)">([^<]+)<\/a>/g, (_, address, label) => `<a href="/cdn-cgi/l/email-protection#${cfEncode(address)}"><span class="__cf_email__" data-cfemail="${cfEncode(label)}">[email&#160;protected]</span></a>`);
  assert.notEqual(live, html);
  assert.equal(undoCloudflareEmailObfuscation(live), html);
  const noEmail = hospitalConfirmationPanel(hospital, null);
  assert.doesNotMatch(noEmail, /mailto:|이메일로/);
  assert.match(noEmail, /href="\/corrections\/\?clinic=/);
  assert.doesNotMatch(hospitalConfirmationPanel({...hospital, name: '<b>병원'}, null), /<b>병원/);
});

test('a confirmation is a separate dated panel and never overwrites or mixes with the HIRA values', () => {
  const full = {...record, fields: {phone: '055-555-0199', website: 'https://www.example-dental.kr/', bookingUrl: 'https://booking.example.com/b/1?x=1&y=2', hours: {sat: {open: '09:00', close: '13:00'}, mon: {open: '09:00', close: '18:00'}}, closedNote: '매월 둘째 주 수요일 휴진'}};
  const older = {...record, confirmedOn: '2026-10-02', channel: 'phone', confirmedByRole: '행정팀', fields: {closedNote: '일요일 휴진'}};
  const ctx = context({confirmed: file(older, full)}), plain = context();
  const html = hospitalConfirmationPanel(hospital, ctx.confirmations.get('c-h1')[0], {correctionEmail: 'ops@example.org'});
  assert.match(html, /<h2>병원이 직접 확인한 정보 · 확인일 2026-11-20<\/h2>/);
  assert.match(html, /<span class="pill neutral">이메일 · 원무과<\/span>/);
  assert.match(html, /<a href="tel:0555550199">055-555-0199<\/a>/);
  assert.match(html, /<a href="https:\/\/www\.example-dental\.kr\/" target="_blank" rel="noopener noreferrer">/);
  assert.match(html, /href="https:\/\/booking\.example\.com\/b\/1\?x=1&amp;y=2"/);
  assert.match(html, /월요일 09:00 ~ 18:00<br>토요일 09:00 ~ 13:00/); // week order, not file order
  assert.match(html, /확인받지 않은 요일은 적지 않았습니다\. 휴진을 뜻하지 않습니다\./);
  assert.match(html, /매월 둘째 주 수요일 휴진/);
  assert.match(html, /확인 근거: 원무과 회신 이메일 보관\./);
  assert.match(html, /심평원 등록값을 고치거나 대신하지 않으며, 두 값이 다르면 둘 다 그대로 둡니다/);
  assert.match(text(html), /목록 순서나 표시 방식에 영향을 주지 않습니다/);
  assert.doesNotMatch(html, /055-555-0100/); // the HIRA phone is not repeated or replaced here
  assert.doesNotMatch(html, /일요일 휴진/); // the older confirmation is not merged into the newest
  // Blocks: the summary text and the JSON-LD are the same with and without a confirmation.
  const confirmed = hospitalProfileBlocks(hospital, ctx, {ctCount: 2}), unconfirmed = hospitalProfileBlocks(hospital, plain, {ctCount: 2});
  assert.deepEqual(confirmed.schema, unconfirmed.schema);
  assert.doesNotMatch(JSON.stringify(confirmed.schema), /0199|example-dental|booking\.example/);
  const summaryText = html => html.match(/<p id="hospital-summary-text"[^>]*>([^<]*)<\/p>/)[1];
  assert.equal(summaryText(confirmed.lead), summaryText(unconfirmed.lead));
  assert.match(confirmed.lead, /<a class="text-link" href="#hospital-confirmed">병원이 직접 확인한 정보 · 확인일 2026-11-20 ↓<\/a>/);
  assert.match(confirmed.tail, /id="hospital-confirmed"[\s\S]*id="update-ledger"/);
  // Every confirmation is a ledger row; the "no record" note no longer lists it.
  const ledger = hospitalLedger(hospital, ctx);
  assert.deepEqual(ledger.entries.filter(e => e.kind === 'hospital-confirmation').map(e => e.date), ['2026-11-20', '2026-10-02']);
  assert.equal(ledger.entries[0].detail, '확인 경로 이메일 · 확인 부서 원무과 · 확인 항목 전화번호·홈페이지·예약 주소·진료시간·휴진 안내');
  assert(!ledger.missing.includes('병원 직접 확인'));
  // Another hospital on the same build is unaffected.
  assert.match(hospitalProfileBlocks(sameCity, ctx, {ctCount: 2}).tail, /아직 이 병원이 직접 확인한 정보는 없습니다/);
});

const asset = (url, kind, ownership, rest = {}) => ({url, kind, ownership, bodyStatus: 'read', ...rest});

test('JSON-LD extras: registered facts as additionalProperty, unknown counts left out', () => {
  const extras = hospitalSchemaExtras(hospital, {snapshot, ctCount: 2});
  assert.deepEqual(Object.keys(extras), ['additionalProperty', 'medicalSpecialty']);
  assert.equal(extras.medicalSpecialty, 'https://schema.org/Dentistry');
  assert.deepEqual(extras.additionalProperty.map(p => [p['@type'], p.name, p.value, p.unitText]), [
    ['PropertyValue', '종별', '치과병원', undefined],
    ['PropertyValue', '치과전문의 등록 수', 4, '명'],
    ['PropertyValue', '콘빔CT 등록 수', 2, '대'],
    ['PropertyValue', '자료 기준일', '2026-09-30', undefined],
  ]);
  assert.match(extras.additionalProperty[0].description, /종별코드 41/);
  assert.match(extras.additionalProperty[1].description, /2026-09-30 자료의 등록 수이며 현재 현황이 아닙니다/);
  const zero = hospitalSchemaExtras({...hospital, doctors: {specialist: 0}}, {snapshot, ctCount: 0});
  assert.deepEqual(zero.additionalProperty.map(p => p.value), ['치과병원', 0, 0, '2026-09-30']);
  const unknown = hospitalSchemaExtras({...hospital, doctors: {specialist: null}}, {snapshot, ctCount: null});
  assert.deepEqual(unknown.additionalProperty.map(p => p.name), ['종별', '자료 기준일']);
  assert.doesNotMatch(JSON.stringify(unknown), /:0[,}]/);
});

test('JSON-LD extras: url only for one body-matched linkable homepage; sameAs for other attributed channels', () => {
  const assets = [
    asset('https://www.example-dental.kr/', 'website', 'official'),
    asset('https://www.instagram.com/example_dental/?hl=ko', 'instagram', 'linked'),
    asset('https://blog.naver.com/example_dental/223000000000', 'naverBlog', 'official'),
    asset('https://pf.kakao.com/_abcde', 'kakaoChannel', 'linked'),
    asset('https://booking.naver.com/booking/13/bizes/123456', 'booking', 'official'),
    asset('https://linktr.ee/example_dental', 'linkHub', 'linked'),
    asset('https://candidate.example.kr/', 'website', 'candidate'),
    asset('https://registered.example.kr/', 'website', 'registered'),
    asset('https://review.example.com/clinic/1', 'blog', 'third_party'),
    asset('https://www.youtube.com/@example_dental', 'youtube', 'official', {linkable: false}),
  ];
  const extras = hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: {assets}});
  assert.equal(extras.url, 'https://www.example-dental.kr/');
  // Profile-level addresses: no tracking parameter, no single post.
  assert.deepEqual(extras.sameAs, ['https://www.instagram.com/example_dental', 'https://blog.naver.com/example_dental', 'https://pf.kakao.com/_abcde']);
  const json = JSON.stringify(extras);
  for (const hidden of ['booking.naver.com', 'linktr.ee', 'candidate.example', 'registered.example', 'review.example', 'youtube.com']) assert(!json.includes(hidden), hidden);
  // No evaluative or unverified property is ever emitted.
  for (const key of ['openingHours', 'openingHoursSpecification', 'foundingDate', 'aggregateRating', 'review', 'priceRange', 'award', 'slogan', 'description']) assert(!(key in extras), key);
  // Ownership or linkability short of the bar: no url, and no sameAs key at all.
  for (const ownership of ['candidate', 'registered', 'third_party', 'linked']) assert.equal(hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: {assets: [asset('https://www.example-dental.kr/', 'website', ownership)]}}).url, undefined, ownership);
  const notLinkable = hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: {assets: [asset('https://www.example-dental.kr/', 'website', 'official', {linkable: false})]}});
  assert.deepEqual(Object.keys(notLinkable), ['additionalProperty', 'medicalSpecialty']);
  // A website the hospital's verified page links is a reference, not the homepage.
  assert.deepEqual(hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: {assets: [asset('https://group.example.kr/', 'website', 'linked')]}}).sameAs, ['https://group.example.kr/']);
  // An unsafe address never reaches the markup.
  assert.deepEqual(Object.keys(hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: {assets: [asset('javascript:alert(1)', 'website', 'official')]}})), ['additionalProperty', 'medicalSpecialty']);
});

test('JSON-LD extras: several official homepages single none out, and a page shared by two institutions identifies neither', () => {
  const two = hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: {assets: [asset('https://www.example-dental.kr/', 'website', 'official'), asset('https://second.example-dental.kr/', 'website', 'official')]}});
  assert.equal(two.url, undefined);
  assert.deepEqual(two.sameAs, ['https://www.example-dental.kr/', 'https://second.example-dental.kr/']);
  const inventory = {records: [
    {clinicId: 'c-h1', assets: [asset('https://group.example.kr/', 'website', 'official'), asset('https://pf.kakao.com/_group', 'kakaoChannel', 'linked'), asset('https://www.instagram.com/own_account/', 'instagram', 'linked')]},
    {clinicId: 'c-c1', assets: [asset('https://group.example.kr/', 'website', 'official'), asset('https://pf.kakao.com/_group/', 'kakaoChannel', 'linked'), asset('https://www.instagram.com/own_account/', 'instagram', 'candidate')]},
  ]};
  const shared = sharedChannelUrls(inventory);
  // The same channel written two ways is one channel; a candidate on the other record is not an attribution.
  assert.deepEqual([...shared].sort(), ['https://group.example.kr/', 'https://pf.kakao.com/_group']);
  const extras = hospitalSchemaExtras(hospital, {snapshot, ctCount: 2, assetRecord: inventory.records[0], sharedUrls: shared});
  assert.equal(extras.url, undefined);
  assert.deepEqual(extras.sameAs, ['https://www.instagram.com/own_account']);
  assert.equal(sharedChannelUrls(null).size, 0);
});

test('context is built once per build and refuses a bad input file', () => {
  assert.throws(() => hospitalProfileContext({snapshot}), /clinics array/);
  assert.throws(() => hospitalProfileContext({clinics, snapshot: '2026-09'}), /snapshot date/);
  assert.throws(() => hospitalProfileContext({clinics, snapshot, confirmed: file({...record, clinicId: 'c-c1'})}), /existing 종별코드 41/);
  const ctx = hospitalProfileContext({clinics, snapshot});
  assert.equal(ctx.observedOn, null);
  assert.equal(ctx.correctionEmail, null);
  assert.deepEqual(ctx.snapshots, []);
  assert.equal(ctx.confirmations.size, 0);
  assert.equal(ctx.regionCounts.total, 4);
});

test('real data: every 치과병원 gets complete blocks and every 치과의원 gets none', () => {
  const data = JSON.parse(fs.readFileSync(path.join(root, 'data/clinics.json'), 'utf8'));
  const read = name => JSON.parse(fs.readFileSync(path.join(root, 'data/content', name), 'utf8'));
  const inventory = loadAssetInventory(root, data), assetsById = new Map(inventory.records.map(r => [r.clinicId, r]));
  const operator = read('site-operator.json');
  const ctx = hospitalProfileContext({clinics: data.clinics, snapshot: data.snapshotDate, observedOn: localDate(data.observedAt), snapshotRegistry: read('hira-snapshots.json'), confirmed: read('hospital-confirmed.json'), inventory, operator});
  const hospitals = data.clinics.filter(c => c.typeCode === '41');
  assert.equal(ctx.regionCounts.total, hospitals.length);
  for (const counts of [ctx.regionCounts.sido, ctx.regionCounts.city]) assert.equal([...counts.values()].reduce((sum, n) => sum + n, 0), hospitals.length);
  const forbidden = ['openingHours', 'openingHoursSpecification', 'foundingDate', 'aggregateRating', 'review', 'priceRange'];
  let withUrl = 0;
  for (const c of hospitals) {
    const assetRecord = assetsById.get(c.id), blocks = hospitalProfileBlocks(c, ctx, {assetRecord, ctCount: ctCount(c)});
    assert.match(blocks.lead, /^<section class="fact-panel" id="hospital-summary"/, c.id);
    assert(blocks.lead.includes(c.sido) && blocks.lead.includes(`/hospitals/${c.sidoCode}/`) && blocks.lead.includes(`/regions/${c.sidoCode}/${c.cityCode}/`), c.id);
    assert.match(blocks.tail, /id="hospital-confirmed"[\s\S]*id="update-ledger"/, c.id);
    assert(blocks.tail.includes(mailtoLink(operator.correctionEmail)), c.id);
    // Record strings may contain any syllables (용인기흥구 holds "인기"); everything around them must stay free of ranking language.
    const prose = [c.name, c.sido, c.city, c.dong].filter(Boolean).reduce((value, own) => value.replaceAll(own, ''), text(blocks.lead + blocks.tail));
    assert.doesNotMatch(prose, EVALUATIVE, c.id);
    assert.doesNotMatch(prose, /undefined|NaN|null|Invalid Date/, c.id);
    assert(blocks.schema.additionalProperty.length >= 2 && blocks.schema.additionalProperty.every(p => p['@type'] === 'PropertyValue' && p.name && p.value != null), c.id);
    for (const key of forbidden) assert(!(key in blocks.schema), c.id + ' ' + key);
    const official = (assetRecord?.assets ?? []).filter(a => a.kind === 'website' && a.ownership === 'official' && a.linkable !== false);
    if (blocks.schema.url) { withUrl++; assert(official.length >= 1 && official.some(a => new URL(a.url).href === blocks.schema.url), c.id); }
    for (const url of blocks.schema.sameAs ?? []) { assert.match(url, /^https?:\/\//, c.id); assert(!ctx.sharedUrls.has(url), c.id + ' ' + url); assert.notEqual(url, blocks.schema.url, c.id); }
    const ledger = hospitalLedger(c, ctx, assetRecord);
    assert(ledger.entries.some(e => e.kind === 'hira-reference' && e.date === data.snapshotDate), c.id);
    assert.deepEqual(ledger.entries.map(e => e.date), ledger.entries.map(e => e.date).toSorted().toReversed(), c.id);
  }
  assert(withUrl > 0 && withUrl < hospitals.length);
  const empty = hospitalProfileBlocks(data.clinics.find(c => c.typeCode === '51'), ctx, {});
  for (const c of data.clinics) if (c.typeCode !== '41') assert.equal(hospitalProfileBlocks(c, ctx, {assetRecord: assetsById.get(c.id), ctCount: ctCount(c)}), empty);
  assert.deepEqual(empty, {lead: '', tail: '', schema: {}});
});
