import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadContent } from '../scripts/content-data.mjs';
import { loadSearchGuide, validateSearchGuide, searchSourceSummary, registerSearchSourcePage } from '../scripts/search-source-pages.mjs';
import { homePage } from '../scripts/report-pages.mjs';
import { collectReports } from '../scripts/report-data.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('source discovery keeps evidence-linked access conditions separate from measured volumes', () => {
  const guide = loadSearchGuide(root);
  assert.equal(guide.sources.length, 10);
  assert(guide.sources.every(s => s.volumeAcquired === false));
  assert.equal(guide.rankingStatus, 'not_measured');
  assert.equal(guide.monthlyVolumes, null);
  assert.equal(guide.sources.find(s => s.id === 'ahrefs').kind, 'model');
  assert.equal(guide.sources.find(s => s.id === 'google-trends').kind, 'relative');
  assert.equal(guide.sources.find(s => s.id === 'naver-searchad').kind, 'naver');
  assert.equal(guide.acquisitionAttempts[0].userAccountAccessChecked, false);
  const changed = structuredClone(guide);
  changed.sources[0].volumeAcquired = true;
  assert.throws(() => validateSearchGuide(changed), /acquired search volumes/);
  changed.sources[0].volumeAcquired = false;
  changed.sources[0].references = ['no-such-evidence'];
  assert.throws(() => validateSearchGuide(changed), /Missing source reference/);
});

test('only actual successful observations count as collected suggestions', () => {
  const bundle = loadContent(root);
  const summary = searchSourceSummary(bundle.evidence, bundle.content);
  assert.equal(summary.autocompleteKeywordCount, 198);
  assert.equal(summary.observedSeedCount, 20);
  assert.equal(summary.contentQuestionCount, 100);
  assert.equal(summary.measuredMonthlyKeywordCount, 0);
  const evidence = { autocomplete: { observations: [
    { source: 'google_autocomplete', status: 'access_restricted', suggestions: ['unobserved'] },
    { source: 'google_autocomplete', status: 'observed', suggestions: ['임플란트', ' 임플란트 '] },
  ] } };
  assert.equal(searchSourceSummary(evidence, bundle.content).autocompleteKeywordCount, 1);
});

test('research page exports the full provenance and escapes text without inventing rank data', () => {
  const guide = loadSearchGuide(root), bundle = loadContent(root);
  const files = new Map(); let result;
  guide.sources[0].name = '<img onerror=alert(1)>';
  registerSearchSourcePage({ guide, bundle, page: (route, opts) => { result = { route, ...opts }; }, put: (file, value) => files.set(file, value) });
  assert.equal(result.route, '/search-sources/');
  assert(result.body.includes('&lt;img onerror=alert(1)&gt;'));
  assert(result.body.includes('익명 접근 결과'));
  assert(result.body.includes('검색량 순위는 아직 산출하지 않았습니다'));
  for (const r of guide.references) assert(result.body.includes(`id="ref-${r.id}"`));
  const exported = JSON.parse(files.get('data/content/search-source-guide.json'));
  assert.equal(exported.currentProject.measuredMonthlyKeywordCount, 0);
  assert.equal(exported.references.length, guide.references.length);
  const ranked = structuredClone(bundle);
  ranked.content.questions[0].searchRank = 1;
  assert.throws(() => registerSearchSourcePage({ guide, bundle: ranked, page() {}, put() {} }), /measured ranking/);
  const unsafe = structuredClone(guide);
  unsafe.references[0].url = 'javascript:alert(1)';
  assert.throws(() => validateSearchGuide(unsafe), /Invalid search reference/);
  unsafe.references[0].url = guide.references[0].url;
  unsafe.references[0].id = 'x" onmouseover="alert(1)';
  assert.throws(() => validateSearchGuide(unsafe), /Invalid search reference/);
});

test('homepage research link is opt-in and absent when the private content hub is unavailable', () => {
  const reports = collectReports([], { snapshotDate: '2026-09-30', observedAt: '2026-10-31T00:00:00Z', sourceSha256: 'a'.repeat(64) });
  assert(!homePage(reports, '').includes('href="/search-sources/"'));
  assert(homePage(reports, '', { searchSources: true }).includes('href="/search-sources/"'));
});
