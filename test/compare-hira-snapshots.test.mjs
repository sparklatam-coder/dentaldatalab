import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compareSnapshots, roadBase, phoneDigits, nameStem, CONTINUITY_WARNING } from '../scripts/compare-hira-snapshots.mjs';
import { upsertSnapshot, emptyRegistry } from '../scripts/archive-hira-zip.mjs';

const c = (id, typeCode, name, address, phone, extra = {}) => ({ id, typeCode, name, address, phone, sidoCode: '310000', sido: '경기', cityCode: '312700', city: '양주시', openedOn: '2020-01-01', ...extra });
const snap = (snapshotDate, clinics) => ({ snapshotDate, clinics });
const base = [
  c('c-keep1', '51', '가람치과의원', '경기도 양주시 옥정로 10, 2층 (옥정동)', '031-111-1111'),
  c('c-keep2', '41', '나무치과병원', '경기도 양주시 회천로 20, 3층', '031-222-2222'),
  c('c-conv', '51', '다솜치과의원', '경기도 양주시 평화로 30, 4층 (덕정동)', '031-333-3333'),
  c('c-gone', '51', '라온치과의원', '경기도 양주시 부흥로 40', '031-444-4444'),
  c('c-same-building', '51', '마루치과의원', '경기도 양주시 평화로 30, 5층', '031-555-5555'),
];

test('key normalizers drop the 시도 token, floors and notes, and keep one-syllable name stems', () => {
  assert.equal(roadBase('경상남도 양산시 양산역로 71, 8,9층 (중부동, 노바메디컬케어)'), '양산시양산역로71');
  assert.equal(roadBase('경남 양산시 양산역로 71 (중부동)'), '양산시양산역로71', 'a renamed 시도 label still matches');
  assert.equal(roadBase('주소없음'), null);
  assert.equal(roadBase('서울특별시 강남구 테헤란로 123 3층'), roadBase('서울 강남구 테헤란로 123 4층'), 'a floor without a comma is not part of the key');
  assert.equal(roadBase('서울특별시 강남구 테헤란로 123 지하1층 101호'), '강남구테헤란로123');
  assert.equal(roadBase('서울특별시 강남구 테헤란로 123 2~3층'), '강남구테헤란로123');
  assert.equal(roadBase('서울특별시 중구 세종대로 110'), '중구세종대로110', 'a building number is kept');
  assert.equal(phoneDigits('031-111-1111'), '0311111111');
  assert.equal(phoneDigits('703-0073'), null, 'numbers without an area code are too short to match on');
  assert.equal(nameStem('수치과의원'), '수');
  assert.equal(nameStem('다솜 치과병원'), '다솜');
  assert.equal(nameStem('치과의원'), null);
});

test('a quarter compared with itself has full id continuity and no changes', () => {
  const r = compareSnapshots(snap('2026-09-30', base), snap('2026-09-30', base), { allowSameDate: true });
  assert.deepEqual(r.idContinuity, { kept: 5, beforeOnly: 0, afterOnly: 0, keptShare: 1, threshold: CONTINUITY_WARNING });
  assert.equal(r.summary.opened.total + r.summary.closed.total + r.pairs.length, 0);
  assert.deepEqual(r.warnings, ['같은 기준일끼리 비교함(점검용)']);
  assert.throws(() => compareSnapshots(snap('2026-09-30', base), snap('2026-09-30', base)), /must be later/);
  assert.throws(() => compareSnapshots(snap('2026-12-31', base), snap('2026-09-30', base)), /must be later/);
  assert.throws(() => compareSnapshots({ clinics: [] }, snap('2026-12-31', base)), TypeError);
});

test('a 의원→병원 conversion under a new id is paired, not counted as one closure plus one opening', () => {
  const after = [
    base[0],
    { ...base[1], name: '나무치과병원 본점' },
    c('c-new-hospital', '41', '다솜치과병원', '경기도 양주시 평화로 30, 4~6층 (덕정동)', '031-333-3333'),
    base[4],
    c('c-new-clinic', '51', '바다치과의원', '경기도 양주시 고읍로 50', '031-666-6666'),
  ];
  const r = compareSnapshots(snap('2026-09-30', base), snap('2026-12-31', after));
  assert.equal(r.idContinuity.kept, 3);
  assert.deepEqual([r.summary.opened.total, r.summary.closed.total], [2, 2]);
  const strong = r.pairs.filter(p => p.confidence === 'strong');
  assert.equal(strong.length, 1);
  assert.deepEqual([strong[0].kind, strong[0].before.id, strong[0].after.id, strong[0].matchedOn], ['clinicToHospital', 'c-conv', 'c-new-hospital', ['address', 'phone', 'name']]);
  assert.deepEqual(r.summary.strongPairs, { clinicToHospital: 1, hospitalToClinic: 0, relisted: 0, typeChange: 0 });
  assert.deepEqual(r.netOpened.map(x => x.id), ['c-new-clinic']);
  assert.deepEqual(r.netClosed.map(x => x.id), ['c-gone']);
  assert.deepEqual(r.sameIdChanges.renamed, [{ id: 'c-keep2', from: '나무치과병원', to: '나무치과병원 본점' }]);
  assert.equal(r.summary.sameId.moved, 0);
});

test('one shared attribute is only a weak review candidate and does not remove anything from the net lists', () => {
  const after = [...base.filter(x => x.id !== 'c-gone'), c('c-other', '51', '사랑치과의원', '경기도 양주시 부흥로 40, 2층', '031-777-7777')];
  const r = compareSnapshots(snap('2026-09-30', base), snap('2026-12-31', after));
  assert.equal(r.pairs.length, 1);
  assert.deepEqual([r.pairs[0].confidence, r.pairs[0].kind, r.pairs[0].matchedOn], ['weak', 'relisted', ['address']]);
  assert.equal(r.summary.weakPairs, 1);
  assert.deepEqual(r.netClosed.map(x => x.id), ['c-gone']);
  assert.deepEqual(r.netOpened.map(x => x.id), ['c-other']);
});

test('a broken id key across quarters raises warnings instead of reporting mass closures as facts', () => {
  const after = base.map(x => ({ ...x, id: x.id + '-v2' }));
  const r = compareSnapshots(snap('2026-09-30', base), snap('2026-12-31', after));
  assert.equal(r.idContinuity.keptShare, 0);
  assert.equal(r.summary.strongPairs.relisted, 5);
  assert.equal(r.summary.netClosed.total, 0);
  assert.ok(r.warnings.some(w => w.includes('암호화요양기호가 유지되지 않았을 수')));
  assert.ok(r.warnings.some(w => w.includes('식별자 변경 여부')));
});

test('ties between candidates are flagged as ambiguous', () => {
  const before = [c('c-a', '51', '하나치과의원', '경기도 양주시 평화로 30, 4층', null)];
  const after = [c('c-b', '41', '둘치과병원', '경기도 양주시 평화로 30, 5층', null), c('c-c', '41', '셋치과병원', '경기도 양주시 평화로 30, 6층', null)];
  const r = compareSnapshots(snap('2026-09-30', before), snap('2026-12-31', after));
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].ambiguous, true);
  assert.ok(r.warnings.some(w => w.includes('수동 확인')));
});

test('the snapshot registry refuses a different file for an archived quarter and keeps the order', () => {
  const sha = x => x.repeat(64);
  let { registry, added } = upsertSnapshot(emptyRegistry(), { snapshotDate: '2026-12-31', fileName: 'b.zip', sha256: sha('b') });
  assert.equal(added, true);
  ({ registry, added } = upsertSnapshot(registry, { snapshotDate: '2026-09-30', fileName: 'a.zip', sha256: sha('a') }));
  assert.deepEqual(registry.snapshots.map(s => s.snapshotDate), ['2026-09-30', '2026-12-31']);
  assert.equal(upsertSnapshot(registry, { snapshotDate: '2026-09-30', fileName: 'a.zip', sha256: sha('a') }).added, false);
  assert.throws(() => upsertSnapshot(registry, { snapshotDate: '2026-09-30', fileName: 'a2.zip', sha256: sha('c') }), /different file/);
  assert.throws(() => upsertSnapshot(registry, { snapshotDate: '2026-13-40', fileName: 'x.zip', sha256: sha('d') }), TypeError);
  assert.throws(() => upsertSnapshot(registry, { snapshotDate: '2027-03-31', fileName: 'x.zip', sha256: 'abc' }), TypeError);
});

test('the tracked registry matches the snapshot the site is built from', () => {
  const registry = JSON.parse(fs.readFileSync(new URL('../data/content/hira-snapshots.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/source-manifest.json', import.meta.url), 'utf8'));
  const current = registry.snapshots.find(s => s.snapshotDate === manifest.snapshotDate);
  assert.ok(current, 'the current snapshot is archived');
  assert.equal(current.sha256, manifest.archive.sha256);
  assert.equal(current.size, manifest.archive.size);
});
