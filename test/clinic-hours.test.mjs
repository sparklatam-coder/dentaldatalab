import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAssetInventory } from '../scripts/clinic-assets.mjs';
import { latestNaverHours, currentNaverPlaceObservations, splitObservedHours, clinicHoursPanel } from '../scripts/clinic-hours.mjs';
import { esc } from '../src/shared.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceData = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8'));
const sourceBefore = JSON.stringify(sourceData);
const inventory = loadAssetInventory(root, sourceData);
const browserBatch = JSON.parse(fs.readFileSync(new URL('../data/assets/naver-browser.json', import.meta.url), 'utf8'));
const actual = name => {
  const researched = browserBatch.records.find(r => r.name === name);
  assert(researched, name);
  const record = inventory.records.find(r => r.clinicId === researched.clinicId);
  assert(record, name);
  return record;
};
const options = {
  snapshot: '2026-09-30',
  registeredHtml: '<table data-source="hira"><tr><td>등록자료 미확인 표식</td></tr></table>',
};
const checkedAt = '2026-10-31T21:36:14.107Z';
const mapUrl = 'https://map.naver.com/p/entry/place/1984826113';
const observation = overrides => ({
  sourceUrl: mapUrl, checkedAt, bodyStatus: 'read', identityMatch: true,
  fields: { hours: '월 09:00 - 18:00 화 09:00 - 18:00 수 09:00 - 18:00 목 09:00 - 18:00 금 09:00 - 18:00 토 09:00 - 13:00 일 정기휴무 (매주 일요일)' },
  ...overrides,
});
function freezeDeep(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) freezeDeep(item);
  }
  return value;
}

test('Gangnam Yonsei shows observed Tuesday, Saturday and lunch hours before the separately preserved HIRA table', () => {
  const record = actual('강남연세치과의원');
  const hours = latestNaverHours(record);
  assert(hours);
  assert.match(new URL(hours.url).pathname,/\/(?:place|hospital)\/1984826113(?:\/|$)/);
  assert(record.naverPlaceObservations.some(o=>o.sourceUrl===hours.url&&o.checkedAt===hours.checkedAt&&o.fields.hours===hours.raw),'The displayed source and time must belong to the actual selected observation');
  const schedule = splitObservedHours(hours.raw);
  assert.deepEqual(schedule.rows.map(r => r.day), ['월', '화', '수', '목', '금', '토', '일']);
  assert.equal(schedule.rows.find(r => r.day === '화').detail, '09:30 - 20:30 13:00 - 14:00 휴게시간');
  assert.equal(schedule.rows.find(r => r.day === '토').detail, '09:30 - 13:30');
  assert.equal(schedule.rows.find(r => r.day === '일').detail, '정기휴무 (매주 일요일)');
  const html = clinicHoursPanel(record, options);
  const registered = html.indexOf('<details class="hours-registered">');
  const main = html.slice(0, registered);
  assert(registered > 0);
  assert.match(main, /네이버지도 안내/);
  assert.match(main, /2026-11-01 확인/, 'Observation date must be shown in Korea time');
  assert.match(main, /<th scope="row">화요일<\/th><td>09:30 - 20:30\n13:00 - 14:00 휴게시간/);
  assert.match(main, /<th scope="row">토요일<\/th><td>09:30 - 13:30/);
  assert(!main.includes('등록자료 미확인 표식'));
  assert(html.slice(registered).includes(options.registeredHtml));
  assert.match(html.slice(registered), /2026-09-30 기준/);
  assert.match(main, /확인일에 표시된 안내/);
});

test('Bigstar chooses the newest eligible observation by its own timestamp rather than array order or older summary', () => {
  const record = actual('큰별치과의원');
  const eligible = record.naverPlaceObservations.filter(o => o.bodyStatus === 'read' && o.identityMatch === true && o.fields?.hours);
  assert(eligible.length >= 2, 'Fixture retains both the latest complete hours and the earlier closure summary');
  const expected = eligible.toSorted((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
  const forward = latestNaverHours(record);
  const reverse = latestNaverHours({ ...record, naverPlaceObservations: [...record.naverPlaceObservations].reverse() });
  assert.deepEqual(forward, reverse);
  assert.equal(forward.checkedAt, expected.checkedAt);
  assert.equal(forward.raw, expected.fields.hours);
  assert.match(forward.raw, /월 10:00 - 18:30/);
  assert.match(forward.raw, /화 12:00 - 20:30/);
  assert.notEqual(forward.raw, '매주 일요일 휴무');
});

test('unread, unidentified, invalid-date and invalid-source observations cannot replace registered hours', () => {
  const invalid = [
    observation({ bodyStatus: 'blocked' }), observation({ bodyStatus: 'not_read' }),
    observation({ identityMatch: false }), observation({ identityMatch: undefined }),
    observation({ checkedAt: 'not-a-date' }), observation({ checkedAt: undefined }),
    observation({ sourceUrl: 'https://clinic.example.com/place/1984826113' }),
    observation({ sourceUrl: 'https://map.naver.com.evil.example/place/1984826113' }),
    observation({ sourceUrl: 'https://map.naver.com/' }),
    observation({ sourceUrl: 'https://map.naver.com/p/entry/place/1984826113spoof' }),
    observation({ sourceUrl: 'https://map.naver.com/p/search/nearby/place/1984826113' }),
    observation({ sourceUrl: '//map.naver.com/p/entry/place/1984826113' }),
    observation({ fields: { hours: '   ' } }),
  ];
  for (const item of invalid) {
    const record = { naverPlaceObservations: [item] };
    assert.equal(latestNaverHours(record), null, JSON.stringify(item));
    const html = clinicHoursPanel(record, options);
    assert.match(html, /기관 식별과 본문 확인을 마친 네이버 진료시간 자료가 아직 없습니다/);
    assert(html.includes(options.registeredHtml));
    assert(!html.includes('class="observed-hours"'));
  }
  const valid = observation();
  assert.equal(latestNaverHours({ naverPlaceObservations: [valid, ...invalid] }).checkedAt, checkedAt);
  assert.equal(latestNaverHours(undefined), null);
});

test('a current manual third-party correction removes older or simultaneous hours for the same Place ID across URL forms', () => {
  const current = {
    kind: 'naverMap', ownership: 'third_party', url: 'https://m.place.naver.com/hospital/1984826113/home',
    checkedAt: '2026-11-01T12:00:00Z',
  };
  for (const time of [checkedAt, current.checkedAt, undefined, 'invalid']) {
    const record = freezeDeep({ assets: [current], naverPlaceObservations: [observation({ checkedAt: time })] });
    const before = JSON.stringify(record);
    assert.equal(latestNaverHours(record), null);
    assert.deepEqual(currentNaverPlaceObservations(record), []);
    const html = clinicHoursPanel(record, options);
    assert(html.includes(options.registeredHtml));
    assert.doesNotMatch(html, /네이버지도 안내/);
    assert.equal(JSON.stringify(record), before, 'Historical observations are retained unchanged in the inventory');
  }
});

test('older corrections, another Place ID and a current reverified winner do not revoke a newer valid observation', () => {
  const observationItem = observation();
  const correction = {
    kind: 'naverMap', ownership: 'third_party', url: 'https://m.place.naver.com/hospital/1984826113/home',
    checkedAt: '2026-10-30T12:00:00Z',
  };
  const cases = [
    correction,
    { ...correction, url: 'https://m.place.naver.com/hospital/999/home', checkedAt: '2026-11-01T12:00:00Z' },
    { ...correction, ownership: 'official', checkedAt: '2026-11-01T12:00:00Z', provenance: [{ ownership: 'third_party' }] },
  ];
  for (const asset of cases) {
    const record = { assets: [asset], naverPlaceObservations: [observationItem] };
    assert.equal(latestNaverHours(record)?.checkedAt, checkedAt);
    assert.equal(currentNaverPlaceObservations(record).length, 1);
  }
});

test('dated closures stay dated and multiple rest periods or later closure notices remain visible', () => {
  const tong = splitObservedHours(latestNaverHours(actual('덕정통치과의원')).raw);
  assert.equal(tong.rows.find(r => r.day === '금').label, '금요일 (11/6)');
  assert.equal(tong.rows.find(r => r.day === '토').label, '토요일 (11/7)');
  assert.equal(tong.rows.find(r => r.day === '금').detail, '휴무');
  const tongHtml = clinicHoursPanel(actual('덕정통치과의원'), options);
  assert.match(tongHtml, /금요일 \(11\/6\)/);
  assert.doesNotMatch(tongHtml, /매주 금요일/);

  const limHours = latestNaverHours(actual('연세林(림)치과의원'));
  const lim = splitObservedHours(limHours.raw);
  const tuesday = lim.rows.find(r => r.day === '화');
  assert.match(tuesday.detail, /12:30 - 14:00 휴게시간/);
  assert.match(tuesday.detail, /17:00 - 18:00 휴게시간/);
  assert.match(tuesday.detail, /19:45 접수마감/);
  assert.equal(lim.rows.find(r => r.day === '수').label, '수요일 (11/4)');
  assert([...lim.notes, limHours.additional ?? ''].some(note => note.includes('11/14') && note.includes('11/21')));
  assert(!lim.rows.find(r => r.day === '토').detail.includes('11/14'), 'Dated closure notices must not become a Saturday recurring schedule');
  const limHtml = clinicHoursPanel(actual('연세林(림)치과의원'), options);
  assert.match(limHtml, /추가 시간·휴무 안내/);
  assert.match(limHtml, /11\/14 , 11\/21 휴무/);
  assert.doesNotMatch(limHtml, /매주 수요일/);
});

test('weekday groups are kept as source text and supplemental monthly or reception notices are not inferred away', () => {
  const kwak = actual('곽기재치과의원'), raw = latestNaverHours(kwak).raw;
  const grouped = splitObservedHours(raw);
  assert.equal(grouped.rows.length, 0);
  assert.equal(grouped.raw, raw);
  const html = clinicHoursPanel(kwak, options);
  assert(html.includes('<div class="observed-hours-text">' + esc(raw) + '</div>'));
  assert(!html.includes('<th scope="row">월요일</th>'));
  assert.match(html, /공휴일 휴무/);
  assert.match(html, /매달 2,4째 토요일 휴무/);

  const smile = clinicHoursPanel(actual('스마일치과의원'), options);
  assert.match(smile, /둘째,넷째주 토요일 격주휴무/);
  const yonsei365 = clinicHoursPanel(actual('연세365치과의원'), options);
  assert.match(yonsei365, /토,일 12:30분 접수마감, 평일 5:30분 접수마감/);
  assert.doesNotMatch(yonsei365, /평일 17:30분 접수마감/);
  const reon = clinicHoursPanel(actual('리온치과의원'), options);
  assert.match(reon, /매달 5번째 일요일 정기 휴무/);
});

test('observed text and additional notes are escaped while raw source observations and the public snapshot remain unchanged', () => {
  const unsafe = '<img src=x onerror="alert(1)"> & 임시 안내';
  const input = freezeDeep({ naverPlaceObservations: [observation({
    fields: { hours: unsafe, hoursAdditional: unsafe },
  })] });
  const before = JSON.stringify(input);
  const html = clinicHoursPanel(input, options);
  assert(!html.includes('<img src=x'));
  assert(html.includes(esc(unsafe)));
  assert(html.includes(options.registeredHtml), 'Registered HTML is the separately built trusted table');
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(sourceData), sourceBefore, 'The display integration must not replace source hours used by filters and reports');
  const realRecord = freezeDeep(structuredClone(actual('강남연세치과의원')));
  const realBefore = JSON.stringify(realRecord);
  clinicHoursPanel(realRecord, options);
  assert.equal(JSON.stringify(realRecord), realBefore);
});
