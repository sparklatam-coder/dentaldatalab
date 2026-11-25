import test from 'node:test';
import assert from 'node:assert/strict';
import { majorityLabel, labelCounts, regionLabelNote, regionAliasNote, hospitalListLink, regionLabelSentence } from '../scripts/region-notes.mjs';
import { DISTRICT_CODE_ALIASES } from '../scripts/report-data.mjs';

test('a 시도 code is titled by its most frequent raw label, and every raw label stays visible', () => {
  const names = new Map([['전남', 2], ['전남광주', 1193]]);
  assert.equal(majorityLabel(names), '전남광주');
  assert.equal(majorityLabel({ 서울: 4948 }), '서울');
  assert.deepEqual(labelCounts(names), [['전남광주', 1193], ['전남', 2]]);
  const note = regionLabelNote({ names });
  assert.match(note, /표기가 2가지/);
  assert.match(note, /전남광주 1,193곳 · 전남 2곳/);
  assert.equal(regionLabelNote({ names: new Map([['서울', 1]]) }), '');
  assert.throws(() => majorityLabel(new Map()), /at least one label/);
});

test('the two code pairs the source uses for the same 구 link to each other, and nothing else gets a note', () => {
  for (const a of DISTRICT_CODE_ALIASES) {
    const stale = regionAliasNote({ sidoCode: a.sidoCode, cityCode: a.cityCode });
    assert.ok(stale.includes(`href="/regions/${a.toSidoCode}/${a.toCityCode}/"`));
    const target = regionAliasNote({ sidoCode: a.toSidoCode, cityCode: a.toCityCode });
    assert.ok(target.includes(`href="/regions/${a.sidoCode}/${a.cityCode}/"`));
    assert.ok(regionAliasNote({ sidoCode: a.sidoCode }).includes(`href="/regions/${a.toSidoCode}/${a.toCityCode}/"`));
  }
  assert.equal(regionAliasNote({ sidoCode: '110000' }), '');
  assert.equal(regionAliasNote({ sidoCode: '360000' }), '', 'the 시도 page of the target code is not cluttered');
  assert.equal(regionAliasNote({ sidoCode: '360000', cityCode: '360803' }), '');
});

test('regions link to their dental-hospital list only when a 41 record exists', () => {
  const html = hospitalListLink({ sidoCode: '310000', name: '경기', clinics: [{ typeCode: '41' }, { typeCode: '51' }, { typeCode: '41' }], scope: '양주시' });
  assert.match(html, /href="\/hospitals\/310000\/"/);
  assert.match(html, /양주시에 치과병원 2곳 등록/);
  assert.equal(hospitalListLink({ sidoCode: '240000', name: '광주', clinics: [{ typeCode: '51' }] }), '');
});

test('regionLabelSentence counts every label of a mixed or aliased 시도코드 with its address word', () => {
  const rows = [
    ...Array.from({ length: 3 }, () => ({ sidoCode: '360000', sido: '전남광주', address: '전남광주통합특별시 서구 1' })),
    { sidoCode: '360000', sido: '전남', address: '전라남도 여수시 1' },
    { sidoCode: '240000', sido: '광주', address: '광주광역시 동구 1' },
    { sidoCode: '110000', sido: '서울', address: '서울특별시 종로구 1' },
  ];
  const s = regionLabelSentence(rows);
  assert.match(s, /시도코드 360000은 ‘전남광주’ 3곳\(주소 ‘전남광주통합특별시’\)·‘전남’ 1곳\(주소 ‘전라남도’\)/);
  assert.match(s, /시도코드 240000은 ‘광주’ 1곳\(주소 ‘광주광역시’\)/);
  assert.ok(!s.includes('110000'), 'a code with one label and no alias is not mentioned');
  assert.equal(regionLabelSentence(rows.slice(5)), '');
});
