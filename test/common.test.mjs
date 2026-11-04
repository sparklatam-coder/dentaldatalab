import test from 'node:test';
import assert from 'node:assert/strict';
import { DAYS, WEEKDAYS, DAY_PAIRS, DENTAL_TYPES, dentalType, percentage, hasText, isIsoTimestamp, isIsoTimestampShape, isCalendarValid, isIsoDate } from '../scripts/common.mjs';
import { closesAtOrAfter, hoursMinutes, nightDays } from '../src/shared.mjs';
import { hasValidHours } from '../scripts/report-data.mjs';

test('one night definition: only a valid same-day pair that closes at or after the threshold qualifies', () => {
  const cases = [
    [{ open: '09:00', close: '19:00' }, true],
    [{ open: '09:00', close: '18:59' }, false],
    [{ open: '09:00', close: '24:00' }, true],
    [{ open: '00:00', close: '19:00' }, false],
    [{ open: '20:00', close: '02:00' }, false],
    [{ open: '20:00', close: '19:30' }, false],
    [{ open: '09:00', close: '19:99' }, false],
    [{ open: null, close: '19:00' }, false],
    [{ open: '9:00', close: '19:00' }, false],
    [undefined, false],
  ];
  for (const [hours, expected] of cases) {
    assert.equal(closesAtOrAfter(hours, '19:00'), expected, JSON.stringify(hours));
    if (expected) assert.equal(hasValidHours(hours), true);
  }
  assert.equal(closesAtOrAfter({ open: '09:00', close: '19:00' }, 'nineteen'), false, 'an invalid threshold never matches');
  assert.equal(hoursMinutes('00:00'), null);
  assert.equal(hoursMinutes('24:00'), 1440);
  const card = { hours: { mon: { open: '09:00', close: '19:00' }, tue: { open: '20:00', close: '19:30' }, wed: { open: '09:00', close: '19:99' }, sat: { open: '09:00', close: '21:00' } } };
  assert.deepEqual(nightDays(card), ['월'], 'string comparison no longer admits reversed or malformed pairs, and Saturday is excluded');
});

test('strict timestamps and dates reject rollover dates, bare dates and offsets without seconds', () => {
  for (const value of ['2026-11-02T03:53:06.904Z', '2026-11-02T12:53:06+09:00', '2024-02-29T00:00:00Z']) assert.equal(isIsoTimestamp(value), true, value);
  for (const value of ['2026-02-31T03:00:00Z', '2026-11-02', '2026-11-02T03:53Z', '2026-11-02T03:53:06', 'Mon Nov 02 2026', '', null, 1730000000000, '2026-13-01T00:00:00Z', '2026-11-02T24:00:00Z']) assert.equal(isIsoTimestamp(value), false, String(value));
  assert.equal(isIsoTimestampShape('2026-02-31T03:00:00Z'), true, 'shape alone does not check the calendar');
  assert.equal(isCalendarValid('2026-02-31T03:00:00Z'), false);
  assert.equal(isIsoDate('2026-09-30'), true);
  for (const value of ['2026-02-30', '2026-9-30', '20260930', '2026-09-30T00:00:00Z', null]) assert.equal(isIsoDate(value), false, String(value));
});

test('shared constants and helpers keep missing values distinct from zero', () => {
  assert.deepEqual([...DAYS], ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  assert.deepEqual([...WEEKDAYS], ['mon', 'tue', 'wed', 'thu', 'fri']);
  assert.deepEqual(DAY_PAIRS.map(([day, label]) => day + label), ['mon월요일', 'tue화요일', 'wed수요일', 'thu목요일', 'fri금요일', 'sat토요일', 'sun일요일']);
  assert.throws(() => { DAYS.push('x'); }, TypeError);
  assert.deepEqual(DENTAL_TYPES, { '41': '치과병원', '51': '치과의원' });
  assert.equal(dentalType('constructor'), null);
  assert.equal(dentalType('51'), '치과의원');
  assert.equal(percentage(0, 0), null);
  assert.equal(percentage(0, 3), 0);
  assert.equal(percentage(1, 3), 33.3);
  assert.equal(hasText(' a '), true);
  for (const value of ['', '  ', null, 0, 5, []]) assert.equal(hasText(value), false, String(value));
});
