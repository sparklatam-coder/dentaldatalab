import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {shareCards, shareCardHtml, shareCardRoutes, staleShareCards, cardHash, nextManifest} from '../scripts/share-cards.mjs';
import {CONDITIONS} from '../scripts/condition-pages.mjs';

const reports = {
  snapshotDate: '2026-09-30',
  national: {total: 19681}, northernGyeonggi: {total: 1190}, dentalHospitals: {total: 248}, hospitalDistricts: {total: 230, withHospital: 102},
};

test('cards carry the same figures as the reports and one card per condition', () => {
  const cards = shareCards(reports);
  const byFile = Object.fromEntries(cards.map(c => [c.file, c]));
  assert.equal(byFile['report-dental-hospitals'].title, '치과병원 248곳 전수 리포트');
  assert.equal(byFile['report-dental-hospitals'].figure, '248곳');
  assert.equal(byFile['report-dental-hospital-districts'].figure, '102 / 230');
  assert.deepEqual(byFile['report-dental-hospital-districts'].routes, ['/reports/dental-hospital-districts/']);
  for (const c of CONDITIONS) assert.deepEqual(byFile['condition-' + c.slug].routes, [`/conditions/${c.slug}/`]);
  for (const card of cards) assert.match(card.file, /^[a-z0-9-]+$/);
});

test('card HTML escapes text and keeps line breaks only where the title asks for them', () => {
  const html = shareCardHtml({eyebrow: '<e>', title: 'a\n<b>', figure: '1곳', label: '"l"', note: '&'});
  assert.match(html, /&lt;e&gt;/);
  assert.match(html, /a<br>&lt;b&gt;/);
  assert.match(html, /&quot;l&quot;/);
  assert.doesNotMatch(html, /<e>|<b>/);
});

test('only rendered cards are mapped, and a changed figure is reported as stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cards-'));
  try {
    const cards = shareCards(reports);
    fs.writeFileSync(path.join(dir, 'report-dental-hospitals.png'), 'png');
    const map = shareCardRoutes(cards, dir);
    assert.deepEqual([...map.entries()], [['/reports/dental-hospitals/', '/assets/og/report-dental-hospitals.png']]);
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({'report-dental-hospitals': cardHash(cards.find(c => c.file === 'report-dental-hospitals'))}));
    assert.deepEqual(staleShareCards(cards, dir), []);
    const changed = shareCards({...reports, dentalHospitals: {total: 250}});
    assert.deepEqual(staleShareCards(changed, dir), ['report-dental-hospitals']);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('committed card manifest matches the committed PNG files', () => {
  const dir = path.resolve('src/assets/og');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const pngs = fs.readdirSync(dir).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)).sort();
  assert.deepEqual(Object.keys(manifest).sort(), pngs);
});

test('a partial render keeps skipped cards stale and drops removed cards', () => {
  const a = {file: 'a', eyebrow: 'e', title: 'A', figure: '', label: '', note: 'n'};
  const b = {file: 'b', eyebrow: 'e', title: 'B changed', figure: '', label: '', note: 'n'};
  const stored = {a: 'old-a', b: 'old-b', gone: 'x'};
  const next = nextManifest([a, b], stored, new Set(['a']));
  assert.equal(next.b, 'old-b', 'skipped card keeps its old hash, so the build still flags it');
  assert.notEqual(next.a, 'old-a');
  assert.ok(!('gone' in next));
});
