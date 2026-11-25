#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareIndexNow, submitIndexNow, recordAccepted, INDEXNOW_SETS, INDEXNOW_SET_LIMIT } from './indexnow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let directory = path.resolve(process.env.DIST_DIR || path.join(root, '.cloudflare-dist'));
let submit = false;
let set = null;
const urls = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--submit') submit = true;
  else if (arg === '--dist' && process.argv[i + 1]) directory = path.resolve(process.argv[++i]);
  else if (arg === '--url' && process.argv[i + 1]) urls.push(process.argv[++i]);
  else if (arg === '--set' && process.argv[i + 1] && set === null) set = process.argv[++i];
  else if (arg === '--help') {
    console.log(`node scripts/submit-indexnow.mjs [--dist DIR] [--url HTTPS_URL (up to 8) | --set NAME] [--submit]
Default: local dry run; no network or files changed. --submit checks the deployed key and HTML before one IndexNow POST.
--url   explicit URLs; any live page that differs from the build aborts the run.
--set   a named set (${Object.keys(INDEXNOW_SETS).join(', ')}): one POST of up to ${INDEXNOW_SET_LIMIT} URLs; live pages that are missing, not 200, noindex or different from the build are skipped and listed.`);
    process.exit(0);
  } else throw new Error('Unknown or incomplete option: ' + arg);
}
if (set !== null && urls.length) throw new Error('--set and --url cannot be combined.');
const selection = set !== null ? { set } : urls.length ? { urls } : {};
const logDirectory = path.join(root, 'data/research/indexnow');
const stateFile = path.join(logDirectory, 'accepted.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { accepted: {} };
const plan = prepareIndexNow({ root, directory, state, ...selection });
console.log(JSON.stringify({ mode: submit ? 'submit' : 'dry-run', ...(set !== null ? { set } : {}), keyLocation: plan.payload.keyLocation, selected: plan.selected.length, unchanged: plan.selected.filter(item => item.unchanged).length, ...(set !== null ? { toSubmit: plan.changed.length, deferred: plan.deferred.map(item => item.url) } : {}), urls: plan.payload.urlList }, null, 2));
if (submit && plan.changed.length) {
  // Prevent parallel manual invocations from racing the duplicate-submission state.
  fs.mkdirSync(logDirectory, { recursive: true });
  const lock = path.join(logDirectory, 'submit.lock');
  const handle = fs.openSync(lock, 'wx');
  try {
    const latest = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { accepted: {} };
    const current = prepareIndexNow({ root, directory, state: latest, ...selection });
    const result = await submitIndexNow(current);
    const at = new Date().toISOString();
    if (result.submitted) {
      // Only what was actually sent is recorded; pages a named set skipped stay pending for a later run.
      fs.writeFileSync(stateFile + '.tmp', JSON.stringify(recordAccepted(latest, current, result, at), null, 2));
      fs.renameSync(stateFile + '.tmp', stateFile);
    }
    fs.appendFileSync(path.join(logDirectory, 'submissions.jsonl'), JSON.stringify({ at, ...(set !== null ? { set } : {}), ...result, urls: result.urls ?? current.payload.urlList }) + '\n');
    console.log(set !== null ? JSON.stringify({ ...result, urls: undefined, deferred: current.deferred.length }, null, 2) : JSON.stringify(result));
  } catch (error) {
    fs.appendFileSync(path.join(logDirectory, 'submissions.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...(set !== null ? { set } : {}), status: 'failed', error: error.message, urls: plan.payload.urlList }) + '\n');
    throw error;
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}
