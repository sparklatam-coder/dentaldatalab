import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CRAWL_RESULT_FILES } from '../scripts/clinic-assets.mjs';
import { RESULT_FILES } from '../scripts/prepare-candidate-homepages.mjs';

test('the JS crawl result file list and the Python collector RESULT_FILES name the same files', () => {
  const js = Object.keys(CRAWL_RESULT_FILES).map(f => f.replace(/\.json$/, '')).sort();
  assert.deepEqual(RESULT_FILES.map(f => f.replace(/^data\/assets\//, '').replace(/\.json$/, '')).sort(), js);
  const py = fs.readFileSync(new URL('../scripts/continuous-homepage-collector.py', import.meta.url), 'utf8');
  const tuple = py.match(/RESULT_FILES = \{[^}]*for name in\s*\(([^)]*)\)/);
  assert.ok(tuple, 'RESULT_FILES literal not found in the Python collector');
  const names = [...tuple[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  assert.deepEqual(names, js);
});
