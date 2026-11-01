import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function until(fn, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(30);
  }
  throw new Error(`Timed out: ${label}`);
}

test('dev rebuilds serially, preserves the last complete build on failure and leaves dist alone', { timeout: 20000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-dev-'));
  let child;
  t.after(async () => {
    if (child && child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  for (const folder of ['scripts', 'data', 'src', 'dist']) fs.mkdirSync(path.join(dir, folder));
  for (const file of ['dev.mjs', 'server.mjs']) fs.copyFileSync(path.join(project, 'scripts', file), path.join(dir, 'scripts', file));
  fs.writeFileSync(path.join(dir, 'dist/kept.txt'), 'keep this production candidate');
  const input = path.join(dir, 'data/content.json');
  fs.writeFileSync(input, JSON.stringify({ text: 'first' }));
  fs.writeFileSync(path.join(dir, 'scripts/build.mjs'), `
    import fs from 'node:fs'; import path from 'node:path';
    import { setTimeout } from 'node:timers/promises';
    const lock = '.build-lock';
    if (fs.existsSync(lock)) throw new Error('Concurrent build');
    fs.writeFileSync(lock, 'building');
    try {
      const content = JSON.parse(fs.readFileSync('data/content.json'));
      const out = process.env.DIST_DIR;
      fs.writeFileSync(path.join(out, 'index.html'), 'INCOMPLETE');
      console.log('fixture: started ' + content.text);
      await setTimeout(240);
      if (content.fail) throw new Error('intentional build failure');
      fs.writeFileSync(path.join(out, 'index.html'), content.text);
      fs.writeFileSync(path.join(out, '404.html'), 'missing');
      fs.writeFileSync(path.join(out, 'build-manifest.json'), JSON.stringify({mode:process.env.DDL_PRODUCTION === '0' ? 'private-review' : 'production'}));
    } finally { fs.unlinkSync(lock); }
  `);
  let output = '';
  child = spawn(process.execPath, ['scripts/dev.mjs'], {
    cwd: dir, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DDL_PRODUCTION: '1', DDL_LAUNCH_REVIEWED: 'YES' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const url = await until(() => output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0], 'server address');
  const read = async () => { const res = await fetch(url); return { status: res.status, text: await res.text(), robots: res.headers.get('x-robots-tag') }; };
  await until(async () => (await read()).text === 'first', 'initial build');
  fs.writeFileSync(input, JSON.stringify({ text: 'second' }));
  await until(() => output.includes('fixture: started second'), 'rebuild start');
  assert.equal((await read()).text, 'first');
  // Editing again during a build queues another run; it does not run concurrently.
  fs.writeFileSync(input, JSON.stringify({ text: 'third' }));
  await until(async () => (await read()).text === 'third', 'queued rebuild');
  fs.writeFileSync(input, JSON.stringify({ text: 'broken', fail: true }));
  await until(() => output.includes('intentional build failure'), 'failed rebuild');
  assert.equal((await read()).text, 'third');
  fs.writeFileSync(input, JSON.stringify({ text: 'recovered' }));
  await until(async () => (await read()).text === 'recovered', 'recovery');
  assert.equal((await read()).robots, 'noindex, nofollow');
  assert.equal(fs.readFileSync(path.join(dir, 'dist/kept.txt'), 'utf8'), 'keep this production candidate');
  assert(!output.includes('Concurrent build'));
  const stopped = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  assert.equal(await stopped, 0);
  assert.deepEqual(fs.readdirSync(path.join(dir, '.dev-dist')), ['.dentaldatalab-dev']);
});
