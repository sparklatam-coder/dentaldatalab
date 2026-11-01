#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { safeWebsite } from '../src/shared.mjs';

export const CHANNELS = ['website', 'naverPlace', 'naverBlog'];
const STATES = ['verified', 'candidate', 'blocked', 'not_found'];
const isUrl = value => {
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
};

export function auditResearch(clinics, batches) {
  const known = new Map(clinics.map(c => [c.id, c]));
  const records = batches.flatMap(batch => batch.records ?? []);
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.clinicId)) throw new Error(`Duplicate clinic: ${record.clinicId}`);
    seen.add(record.clinicId);
    const clinic = known.get(record.clinicId);
    if (!clinic || clinic.name !== record.name) throw new Error(`Clinic identity mismatch: ${record.clinicId}`);
    if (!Number.isFinite(Date.parse(record.checkedAt))) throw new Error(`Missing checkedAt: ${record.clinicId}`);
    for (const key of CHANNELS) {
      const ch = record.channels?.[key];
      if (!ch || !STATES.includes(ch.status)) throw new Error(`Invalid status: ${record.clinicId}/${key}`);
      if (ch.url != null && !isUrl(ch.url)) throw new Error(`Unsafe URL: ${record.clinicId}/${key}`);
      if (ch.status === 'not_found' && ch.url) throw new Error(`not_found must not contain a URL: ${record.clinicId}/${key}`);
      if (ch.status !== 'not_found' && !ch.url) throw new Error(`Missing discovered URL: ${record.clinicId}/${key}`);
      if (!Array.isArray(ch.evidenceUrls) || ch.evidenceUrls.some(url => !isUrl(url))) throw new Error(`Invalid evidence: ${record.clinicId}/${key}`);
      if (ch.url && !ch.evidenceUrls.length) throw new Error(`Missing evidence: ${record.clinicId}/${key}`);
      if (ch.status === 'verified' && (ch.bodyVerified !== true || ch.identityVerified !== true || ch.identityStatus === 'candidate' || ch.officiality === 'unconfirmed')) throw new Error(`False verification: ${record.clinicId}/${key}`);
    }
    for (const fact of record.facts ?? []) {
      if (!isUrl(fact.sourceUrl ?? fact.evidenceUrls?.[0])) throw new Error(`Unattributed fact: ${record.clinicId}/${fact.field}`);
    }
  }
  const byChannel = Object.fromEntries(CHANNELS.map(key => [key, {
    ...Object.fromEntries(STATES.map(state => [state, records.filter(r => r.channels[key].status === state).length])),
    discovered: records.filter(r => r.channels[key].url).length,
  }]));
  const byId = new Map(records.map(r => [r.clinicId, r]));
  const queue = clinics.map(c => {
    const r = byId.get(c.id);
    return {
      clinicId: c.id, name: c.name, sido: c.sido, city: c.city,
      publicWebsiteSeed: safeWebsite(c.website),
      channels: Object.fromEntries(CHANNELS.map(key => [key, r?.channels[key].status ?? 'not_checked'])),
      nextAction: !r ? 'search_and_match_identity' : CHANNELS.every(key => r.channels[key].status === 'verified') ? 'periodic_recheck' : 'resolve_unverified_channels',
    };
  });
  return {
    records,
    summary: {
      nationalPopulation: clinics.length,
      researchedInstitutions: records.length,
      notResearchedInstitutions: clinics.length - records.length,
      allThreeChannelsVerified: records.filter(r => CHANNELS.every(key => r.channels[key].status === 'verified')).length,
      byChannel,
      publicWebsiteSeeds: queue.filter(r => r.publicWebsiteSeed).length,
      currentOperatingStatusVerified: 0,
      note: 'URL 발굴 수는 현재 영업 또는 모든 정보가 맞다고 확인한 기관 수가 아닙니다. 후보·접근 제한·미발굴·조사 대기는 별도 상태입니다.',
    },
    queue,
  };
}

export function writeAudit(root) {
  const clinics = JSON.parse(fs.readFileSync(path.join(root, 'data/clinics.json'), 'utf8')).clinics;
  const dir = path.join(root, 'data/research');
  const files = fs.readdirSync(dir).filter(name => /^yangju-\d+\.json$/.test(name)).sort();
  const batches = files.map(name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
  const result = auditResearch(clinics, batches);
  const checkedAt = new Date().toISOString();
  fs.writeFileSync(path.join(root, 'docs/research-summary.json'), JSON.stringify({ checkedAt, inputFiles: files, ...result.summary }, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'national-discovery-queue.jsonl'), result.queue.map(row => JSON.stringify(row)).join('\n') + '\n');
  console.log(JSON.stringify(result.summary, null, 2));
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  writeAudit(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
}
