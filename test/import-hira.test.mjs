import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toObjects, csvObjects, hhmm, int, num, date, normalizeHours, buildClinic, buildClinics, groupByKey, tally, validateClinics, clinicId, UNCLEAR_REASONS } from '../scripts/import-hira.mjs';

const baseRow = (overrides = {}) => ({
  '암호화요양기호': 'KEY-1', '요양기관명': '가공치과의원', '종별코드': '51', '시도코드': '310000', '시도코드명': '경기', '시군구코드': '312700', '시군구코드명': '양주시',
  '읍면동': '옥정동', '우편번호': '11473', '주소': '경기도 양주시 옥정로 1', '전화번호': '031-123-4567', '병원홈페이지': 'www.example.org', '개설일자': '2020-02-29',
  '좌표(Y)': '37.8', '좌표(X)': '127.1', '총의사수': '', '치과일반의 인원수': '1', '치과인턴 인원수': '0', '치과레지던트 인원수': '0', '치과전문의 인원수': '1', ...overrides,
});
const detailRow = (overrides = {}) => ({ '암호화요양기호': 'KEY-1', '진료시작시간_월요일': '0900', '진료종료시간_월요일': '1800', '점심시간_평일': '13:00~14:00', ...overrides });
const days = ['월', '화', '수', '목', '금', '토', '일'];

test('CSV parsing strips the BOM, keeps quoted commas, newlines and doubled quotes, and rejects ragged rows', () => {
  const csv = parseCsv('﻿a,b\r\n1,"x, ""y""\nz"\r\n');
  assert.deepEqual(csv.head, ['a', 'b']);
  assert.deepEqual(toObjects(csv), [{ a: '1', b: 'x, "y"\nz' }]);
  assert.throws(() => parseCsv('a,b\n"open'), /Unclosed quoted/);
  assert.throws(() => toObjects(parseCsv('a,b\n1,2,3\n')), /width mismatch at row 2/);
  assert.throws(() => csvObjects('a,b\n1,2\n', 'x.csv', ['c']), /Missing CSV header c in x.csv/);
  assert.throws(() => parseCsv(''), /Empty CSV/);
});

test('time, count and date normalization never invent values: 0000 is unprovided, negatives are not counts, impossible dates are null', () => {
  assert.equal(hhmm('900'), '09:00');
  assert.equal(hhmm('1830'), '18:30');
  assert.equal(hhmm('2400'), '24:00');
  for (const raw of ['0', '0000', '2401', '1260', '25:00', 'abc', '', null, '12345']) assert.equal(hhmm(raw), null, String(raw));
  assert.equal(int('0'), 0);
  assert.equal(int(' 3 '), 3);
  for (const raw of ['-1', '1.5', '', null, 'x']) assert.equal(int(raw), null, String(raw));
  assert.equal(num('-1.5'), -1.5);
  assert.equal(date('2020-02-29'), '2020-02-29');
  for (const raw of ['2021-02-29', '2026-13-01', '2026-00-10', '20260101', '']) assert.equal(date(raw), null, String(raw));
});

test('a day where only one side parses is nulled and preserved in unclearHours with its own reason', () => {
  const detail = detailRow({
    '진료시작시간_화요일': '0900', '진료종료시간_화요일': '0',
    '진료시작시간_수요일': '', '진료종료시간_수요일': '1900',
    '진료시작시간_목요일': '2000', '진료종료시간_목요일': '0900',
    '진료시작시간_금요일': '0900', '진료종료시간_금요일': '0900',
  });
  const { hours, hoursAvailable, unclearHours } = normalizeHours(detail);
  assert.equal(hoursAvailable, true);
  assert.deepEqual(hours.mon, { open: '09:00', close: '18:00' });
  for (const day of ['tue', 'wed', 'thu', 'fri', 'sat', 'sun']) assert.deepEqual(hours[day], { open: null, close: null }, day);
  assert.deepEqual(unclearHours, [
    { day: 'tue', open: '09:00', close: null, reason: UNCLEAR_REASONS.oneSided },
    { day: 'wed', open: null, close: '19:00', reason: UNCLEAR_REASONS.oneSided },
    { day: 'thu', open: '20:00', close: '09:00', reason: UNCLEAR_REASONS.notLater },
    { day: 'fri', open: '09:00', close: '09:00', reason: UNCLEAR_REASONS.notLater },
  ]);
  const none = normalizeHours(null);
  assert.equal(none.hoursAvailable, false);
  assert.deepEqual(none.unclearHours, []);
  assert.deepEqual(Object.keys(none.hours), ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
});

test('row mapping derives the id from the encrypted key, keeps zero distinct from missing and records the derived total', () => {
  const clinic = buildClinic(baseRow(), { detail: detailRow(), specRows: [{ '진료과목코드': '49', '진료과목코드명': '치과', '과목별 전문의수': '2' }], eqRows: [] });
  assert.equal(clinic.id, clinicId('KEY-1'));
  assert.match(clinic.id, /^c-[a-f0-9]{12}$/);
  assert.equal(clinic.type, '치과의원');
  assert.deepEqual(clinic.doctors, { general: 1, intern: 0, resident: 0, specialist: 1, total: 2, totalDerived: true });
  assert.equal(clinic.quality.specialtyCountDiscrepancy, true);
  assert.equal(clinic.quality.specialtyComparison, 'different');
  assert.equal(clinic.quality.hoursAvailable, true);
  assert.equal(clinic.hoursNotes.lunch, '평일 13:00~14:00');
  assert.deepEqual(clinic.sourceIds, ['hira-base', 'hira-detail', 'hira-specialties']);
  assert.equal(clinic.openedOn, '2020-02-29');
  const missing = buildClinic(baseRow({ '총의사수': '', '치과인턴 인원수': '' }));
  assert.equal(missing.doctors.total, null, 'an unknown component never becomes 0 for the sum');
  assert.equal(missing.doctors.totalDerived, false);
  assert.deepEqual(missing.sourceIds, ['hira-base']);
  assert.equal(missing.quality.specialtyComparison, 'unavailable');
  assert.throws(() => buildClinic(baseRow({ '종별코드': '01' })), /non-dental/);
  assert.throws(() => buildClinic(baseRow({ '종별코드': 'constructor' })), /non-dental/);
  assert.throws(() => buildClinic(baseRow({ '암호화요양기호': '' })), /missing/);
});

test('batch assembly rejects duplicate detail rows and id collisions, and validation catches leaked one-sided hours', () => {
  const base = [baseRow(), baseRow({ '암호화요양기호': 'KEY-2', '요양기관명': '둘째치과병원', '종별코드': '41' })];
  const clinics = buildClinics(base, { detailBy: groupByKey([detailRow()]), specBy: new Map(), equipBy: new Map() });
  assert.deepEqual(clinics.map(c => c.id), [...clinics.map(c => c.id)].sort());
  assert.throws(() => buildClinics(base, { detailBy: groupByKey([detailRow(), detailRow()]), specBy: new Map(), equipBy: new Map() }), /Multiple detail rows/);
  assert.throws(() => buildClinics([baseRow(), baseRow()], { detailBy: new Map(), specBy: new Map(), equipBy: new Map() }), /id collision/);
  const leaked = structuredClone(clinics); leaked[0].hours.tue = { open: '09:00', close: null };
  assert(validateClinics(leaked).includes('one-sided hours leaked into hours'));
  const reversed = structuredClone(clinics); reversed[0].hours.wed = { open: '20:00', close: '09:00' };
  assert(validateClinics(reversed).includes('invalid same-day hours'));
  assert(validateClinics(clinics).includes('Unexpected dental row count, manual review required'), 'a two-row fixture is not a national file');
  assert(!validateClinics(clinics).some(issue => /hours/.test(issue)));
});

test('tallies keyed by source values cannot collide with Object.prototype', () => {
  const counts = tally([{ k: 'constructor' }, { k: '__proto__' }, { k: 'constructor' }, { k: 'toString' }], item => item.k);
  // An object literal would turn `__proto__:` into a prototype assignment, so compare own entries instead.
  assert.deepEqual(Object.entries(counts), [['constructor', 2], ['__proto__', 1], ['toString', 1]]);
  assert.equal(Object.keys(counts).length, 3);
  assert.equal(Object.getPrototypeOf(counts), Object.prototype, 'the returned tally is a plain object safe for JSON output');
});
