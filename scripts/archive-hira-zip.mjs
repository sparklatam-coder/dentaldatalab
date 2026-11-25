#!/usr/bin/env node
// Keep every quarterly HIRA zip: data.go.kr serves only the current file and no past snapshots, so a quarter that is
// not archived here cannot be compared later. Copies the zip to snapshots/hira/ (local, git-ignored: ~20MB a quarter)
// and records its SHA-256 in data/content/hira-snapshots.json (tracked), so any copy elsewhere can be verified.
// Usage: node scripts/archive-hira-zip.mjs --zip <path> --snapshot 2026-12-31 [--registered 2027-01-20]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readZip, findFile, PAGE_URL } from './import-hira.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REGISTRY = path.join(root, 'data/content/hira-snapshots.json');
export const ARCHIVE_DIR = path.join(root, 'snapshots/hira');
export const REQUIRED_ENTRIES = ['병원정보서비스', '02_세부정보', '03_진료과목정보', '05_의료장비정보'];
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v ?? '') && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));

export const emptyRegistry = () => ({
  schemaVersion: 1, source: PAGE_URL,
  note: '공공데이터포털은 현재 파일만 제공하고 과거 시점 자료를 제공하지 않으므로 분기마다 원본 zip을 보관한다. 파일 자체는 snapshots/hira/(Git 제외)에 두고 여기에는 검증용 해시만 기록한다.',
  snapshots: [],
});

/** Adds one quarter; the same date with a different file is refused instead of silently replaced. */
export function upsertSnapshot(registry, entry) {
  for (const k of ['snapshotDate', 'fileName', 'sha256']) if (!entry?.[k]) throw new TypeError('missing ' + k);
  if (!isDate(entry.snapshotDate) || (entry.registeredOn != null && !isDate(entry.registeredOn))) throw new TypeError('dates must be YYYY-MM-DD');
  if (!/^[a-f0-9]{64}$/.test(entry.sha256)) throw new TypeError('sha256 must be 64 hex characters');
  const snapshots = [...(registry?.snapshots ?? [])];
  const existing = snapshots.find(s => s.snapshotDate === entry.snapshotDate);
  if (existing && existing.sha256 !== entry.sha256) throw new Error(`${entry.snapshotDate} is already archived with a different file (${existing.sha256.slice(0, 12)}…)`);
  if (existing) return { registry: { ...registry, snapshots }, added: false };
  snapshots.push(entry);
  snapshots.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
  return { registry: { ...(registry ?? emptyRegistry()), snapshots }, added: true };
}

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function main(argv) {
  const opt = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  const zip = opt('--zip'), snapshotDate = opt('--snapshot'), registeredOn = opt('--registered');
  if (!zip || !isDate(snapshotDate)) {
    console.log('node scripts/archive-hira-zip.mjs --zip <path> --snapshot YYYY-MM-DD [--registered YYYY-MM-DD]');
    process.exit(argv.includes('--help') ? 0 : 1);
  }
  const z = readZip(path.resolve(zip)); // validates the zip structure and every entry it reads below
  const entries = REQUIRED_ENTRIES.map(key => findFile(z.names, key)); // throws unless exactly one entry matches
  for (const name of entries) z.read(name);
  const fileName = `hira_hospital_pharmacy_${snapshotDate.replaceAll('-', '')}.zip`;
  const target = path.join(ARCHIVE_DIR, fileName);
  // Validate the registry entry first: a refused run (bad --registered, same date with another file) copies nothing.
  const registry = fs.existsSync(REGISTRY) ? JSON.parse(fs.readFileSync(REGISTRY, 'utf8')) : emptyRegistry();
  const { registry: next, added } = upsertSnapshot(registry, {
    snapshotDate, fileName, originalFileName: path.basename(zip), sha256: z.sha256, size: z.size, entryCount: z.names.length,
    registeredOn: registeredOn ?? null, archivedAt: new Date().toLocaleDateString('sv-SE'), archivePath: path.relative(root, target),
  });
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (fs.existsSync(target)) {
    if (sha256File(target) !== z.sha256) throw new Error(`${target} already exists with different contents`);
  } else {
    fs.copyFileSync(path.resolve(zip), target, fs.constants.COPYFILE_EXCL);
    if (sha256File(target) !== z.sha256) { fs.unlinkSync(target); throw new Error('copy verification failed'); }
  }
  if (added) fs.writeFileSync(REGISTRY, JSON.stringify(next, null, 2) + '\n');
  console.log(JSON.stringify({ snapshotDate, archived: path.relative(root, target), sha256: z.sha256, size: z.size, registryUpdated: added }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
