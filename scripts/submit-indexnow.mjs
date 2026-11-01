#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareIndexNow, submitIndexNow } from './indexnow.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let directory = path.resolve(process.env.DIST_DIR || path.join(root, '.cloudflare-dist'));
let submit = false;
const urls = [];
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--submit') submit = true;
  else if (arg === '--dist' && process.argv[i + 1]) directory = path.resolve(process.argv[++i]);
  else if (arg === '--url' && process.argv[i + 1]) urls.push(process.argv[++i]);
  else if (arg === '--help') {
    console.log('node scripts/submit-indexnow.mjs [--dist DIR] [--url HTTPS_URL (up to 8)] [--submit]\nDefault: local dry run; no network or files changed. --submit checks the deployed key and HTML before one IndexNow POST.');
    process.exit(0);
  } else throw new Error('Unknown or incomplete option: ' + arg);
}
const logDirectory = path.join(root, 'data/research/indexnow');
const stateFile = path.join(logDirectory, 'accepted.json');
const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { accepted: {} };
const plan = prepareIndexNow({ root, directory, state, ...(urls.length ? { urls } : {}) });
console.log(JSON.stringify({ mode: submit ? 'submit' : 'dry-run', keyLocation: plan.payload.keyLocation, selected: plan.selected.length, unchanged: plan.selected.filter(item => item.unchanged).length, urls: plan.payload.urlList }, null, 2));
if (submit && plan.changed.length) {
  // Prevent parallel manual invocations from racing the duplicate-submission state.
  fs.mkdirSync(logDirectory, { recursive: true });
  const lock = path.join(logDirectory, 'submit.lock');
  const handle = fs.openSync(lock, 'wx');
  try {
    const latest = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { accepted: {} };
    const current = prepareIndexNow({ root, directory, state: latest, ...(urls.length ? { urls } : {}) });
    const result = await submitIndexNow(current);
    const at = new Date().toISOString();
    if (result.submitted) {
      latest.accepted ??= {};
      for (const item of current.changed) latest.accepted[item.url] = { digest: item.digest, key: current.payload.key, at, httpStatus: result.httpStatus };
      fs.writeFileSync(stateFile + '.tmp', JSON.stringify(latest, null, 2));
      fs.renameSync(stateFile + '.tmp', stateFile);
    }
    fs.appendFileSync(path.join(logDirectory, 'submissions.jsonl'), JSON.stringify({ at, ...result, urls: current.payload.urlList }) + '\n');
    console.log(JSON.stringify(result));
  } catch (error) {
    fs.appendFileSync(path.join(logDirectory, 'submissions.jsonl'), JSON.stringify({ at: new Date().toISOString(), status: 'failed', error: error.message, urls: plan.payload.urlList }) + '\n');
    throw error;
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(lock);
  }
}
