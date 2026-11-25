#!/usr/bin/env node
// Render the share cards to src/assets/og/*.png with a local Chrome and record their text hashes.
// Run after a data refresh when the build warns that a card is stale:  node scripts/render-share-cards.mjs
// CHROME_PATH overrides the browser location. The build itself never needs Chrome.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectReports} from './report-data.mjs';
import {shareCards, shareCardHtml, cardHash} from './share-cards.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ogDir = path.join(root, 'src/assets/og');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(chrome)) throw new Error('Chrome not found. Set CHROME_PATH to a Chrome or Chromium binary.');

const data = JSON.parse(fs.readFileSync(path.join(root, 'data/clinics.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'data/source-manifest.json'), 'utf8'));
const reports = collectReports(data.clinics, {snapshotDate: data.snapshotDate, observedAt: data.observedAt, sourceSha256: manifest.archive.sha256});
const cards = shareCards(reports);
const only = new Set(process.argv.slice(2));
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-share-cards-'));
fs.mkdirSync(ogDir, {recursive: true});
const hashes = {};
try {
  for (const card of cards) {
    hashes[card.file] = cardHash(card);
    if (only.size && !only.has(card.file)) continue;
    const html = path.join(work, card.file + '.html');
    const out = path.join(ogDir, card.file + '.png');
    fs.writeFileSync(html, shareCardHtml(card));
    const run = spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--window-size=1200,630', `--screenshot=${out}`, 'file://' + html], {encoding: 'utf8'});
    if (run.status !== 0 || !fs.existsSync(out)) throw new Error(`Chrome failed for ${card.file}: ${run.stderr}`);
    console.log('rendered', path.relative(root, out));
  }
} finally {
  fs.rmSync(work, {recursive: true, force: true});
}
fs.writeFileSync(path.join(ogDir, 'manifest.json'), JSON.stringify(hashes, null, 2) + '\n');
