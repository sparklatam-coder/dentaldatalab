import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { directorySummary, directorySummaryPanel, clinicMetadata, clinicLocation, cityPageDescription, directoryPagination, clinicDirectoryLinks } from '../scripts/directory-content.mjs';

test('regional facts separate source categories, unknown counts, and invalid hours without summing specialty qualifications', () => {
  const clinics = [
    { typeCode: '51', doctors: { specialist: 0 }, hours: { mon: { open: '09:00', close: '18:00' } } },
    { typeCode: '41', doctors: { specialist: 1 }, specialties: [{ specialists: 4 }], hours: { mon: { open: '18:00', close: '09:00' } } },
    { typeCode: '51', doctors: { specialist: null }, hours: { mon: { open: '9:00', close: '18:00' } } },
    { typeCode: '51', doctors: { specialist: -1 }, hours: { mon: { open: '00:00', close: '18:00' } } },
    { typeCode: '51', doctors: { specialist: 2 }, hours: { mon: { open: '09:00', close: '24:00' } } },
  ];
  assert.deepEqual(directorySummary(clinics), { total: 5, clinics: 4, hospitals: 1, specialists: 2, specialistMissing: 2, hours: 2 });
  const html = directorySummaryPanel(clinics, { name: '<img src=x onerror=alert(1)>', snapshot: '2026-09-30' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /미확인은 2곳/);
  assert.match(html, /현재 영업 중인 전체 치과 수와는 다를/);
  assert.match(html, /href="\/data\/"/);
});

test('actual regional counts reconcile with the immutable official snapshot', () => {
  const source = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url)));
  const before = JSON.stringify(source);
  const summary = directorySummary(source.clinics);
  assert.deepEqual(summary, { total: 19681, clinics: 19433, hospitals: 248, specialists: 7436, specialistMissing: 0, hours: 4826 });
  const groups = new Map();
  for (const clinic of source.clinics) {
    const key = clinic.sidoCode + '/' + clinic.cityCode;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(clinic);
  }
  assert.equal(groups.size, 258);
  for (const key of Object.keys(summary)) assert.equal([...groups.values()].reduce((sum, rows) => sum + directorySummary(rows)[key], 0), summary[key], key);
  assert.equal(JSON.stringify(source), before);
});

test('clinic snippets retain real identity and source phone while distinguishing zero and unknown registration', () => {
  const clinic = { name: '같은이름치과의원', type: '치과의원', sido: '경기', city: '양주시', dong: '옥정동', address: '경기도 양주시 옥정로 204', phone: '031-865-2875', doctors: { specialist: 0 } };
  const metadata = clinicMetadata(clinic, '2026-09-30');
  assert.match(metadata.title, /^같은이름치과의원 \| 경기 양주시 옥정동/);
  assert.match(metadata.description, /옥정로 204/);
  assert.match(metadata.description, /신고 전화 031-865-2875/);
  assert.match(metadata.description, /등록 0명/);
  const missing = clinicMetadata({ ...clinic, phone: null, doctors: { specialist: null } }, '2026-09-30');
  assert.match(missing.description, /전화 자료 미확인/);
  assert.match(missing.description, /치과전문의 등록 자료 미확인/);
  const multiple = clinicMetadata({ ...clinic, phone: '031-865-2875,6' }, '2026-09-30');
  assert.doesNotMatch(multiple.description, /신고 전화 031/);
  assert.match(multiple.description, /전화 원문은 상세에서 확인/);
});

test('치과병원 (41) snippets lead with the name and location and say what the page holds; 치과의원 snippets say only what the record has', () => {
  const hospital = { name: '검증치과병원', type: '치과병원', typeCode: '41', sido: '경기', city: '양주시', dong: '옥정동', address: '경기도 양주시 옥정로 222', phone: '031-928-5098', doctors: { specialist: 0 }, specialties: [{ name: '치주과', specialists: 0 }, { name: '소아치과', specialists: 1 }] };
  const metadata = clinicMetadata(hospital, '2026-09-30');
  assert.equal(metadata.title, '검증치과병원 | 경기 양주시 옥정동 주소·전화·전문의·진료과목·진료시간 등록 정보');
  assert.match(metadata.description, /^검증치과병원: 경기 양주시 옥정동 치과병원\(종별코드 41\)\. 주소 경기도 양주시 옥정로 222\. 신고 전화 031-928-5098\./);
  assert.match(metadata.description, /치과전문의 등록 0명, 등록 진료과목 2개\./);
  assert.match(metadata.description, /심평원 2026-09-30 기준 등록 정보/);
  const missing = clinicMetadata({ ...hospital, phone: null, doctors: {}, specialties: [] }, '2026-09-30');
  assert.match(missing.description, /신고 전화 자료 미확인\. 치과전문의 등록 자료 미확인, 등록 진료과목 자료 미확인\./);
  assert.doesNotMatch(missing.description, /0명|0개|undefined|null/);
  // The same record as a 치과의원: 진료시간 is named in the title only when the registry has a valid entry, and the
  // description ends with this record's own facts. Unknown hours or 개설일 are never written as a value.
  const record = { ...hospital, name: '검증치과의원', type: '치과의원', typeCode: '51' };
  const clinic = clinicMetadata(record, '2026-09-30');
  assert.equal(clinic.title, '검증치과의원 | 경기 양주시 옥정동 주소·전화 등록 정보');
  assert.match(clinic.description, /^치과의원 검증치과의원\. 경기도 양주시 옥정로 222\./);
  assert.match(clinic.description, /치과전문의 등록 0명, 진료시간 등록 자료 미확인\. 심평원 2026-09-30 기준 등록 정보이며 현재 상태와 다를 수 있습니다\.$/);
  const withHours = clinicMetadata({ ...record, quality: { hoursAvailable: true }, openedOn: '2012-02-23' }, '2026-09-30');
  assert.equal(withHours.title, '검증치과의원 | 경기 양주시 옥정동 주소·전화·진료시간 등록 정보');
  assert.match(withHours.description, /진료시간 등록 있음, 개설일 2012-02-23\. 심평원/);
  assert.doesNotMatch(clinicMetadata({ ...record, openedOn: '미상' }, '2026-09-30').description, /개설일/);
  assert.equal(clinicLocation({ sido: '세종', city: '세종', dong: null }), '세종');
});

test('district pages have unique, visible range descriptions and crawlable adjacent pagination', () => {
  const clinics = Array.from({ length: 26 }, (_, i) => ({ name: `치과${String(i + 1).padStart(2, '0')}` }));
  const opts = { region: '경기', city: '양주시', clinics, snapshot: '2026-09-30' };
  const withTypes = clinics.map((c, i) => ({ ...c, typeCode: i < 2 ? '41' : '51', doctors: { specialist: i % 2 }, hours: {} }));
  const first = cityPageDescription({ ...opts, clinics: withTypes, page: 1 });
  assert.match(first, /^경기 양주시 치과 26곳: 치과의원 24곳·치과병원 2곳, 치과전문의 등록 13곳, 진료시간 등록 0곳\./, 'page 1 summarises the district');
  assert.doesNotMatch(first, /번째|부터/);
  assert.match(cityPageDescription({ ...opts, clinics: withTypes, page: 2 }), /25–26번째.*치과25부터 치과26까지/);
  assert.throws(() => cityPageDescription({ ...opts, page: 3 }), /empty/);
  const base = '/regions/310000/312700/';
  assert.equal(directoryPagination(base, 1, 1), '');
  for (let p = 1; p <= 47; p++) {
    const html = directoryPagination(base, p, 47);
    assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
    assert.ok(html.includes(`href="${p === 1 ? base : base + `page/${p}/`}" aria-label="${p}페이지" aria-current="page"`));
    if (p > 1) assert.ok(html.includes(`href="${p === 2 ? base : base + `page/${p - 1}/`}" aria-label="이전 목록:`));
    if (p < 47) assert.ok(html.includes(`href="${base}page/${p + 1}/" aria-label="다음 목록:`));
    assert.doesNotMatch(html, /page\/0\/|onclick=/);
  }
  // Up to 30 pages every page is linked directly, so no list page is more than one click from page 1.
  const all = directoryPagination(base, 1, 23);
  for (let p = 2; p <= 23; p++) assert.ok(all.includes(`href="${base}page/${p}/" aria-label="${p}페이지"`), `page ${p}`);
  assert.doesNotMatch(all, /…/);
});

test('profile navigation points to existing geographic routes and original section IDs', () => {
  const html = clinicDirectoryLinks({ sidoCode: '310000', cityCode: '312700', sido: '경기', city: '양주시' });
  for (const href of ['/regions/310000/312700/', '/regions/310000/', '#basic', '#hours', '#marketing-assets']) assert.ok(html.includes(`href="${href}"`));
});
