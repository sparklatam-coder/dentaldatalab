import test from 'node:test';
import assert from 'node:assert/strict';
import { pageSeo, pageSeoErrors, duplicateMeta } from '../scripts/qa-seo.mjs';

const D = 'https://example.test';
const doc = ({ canonical = D + '/a/', og = canonical, headings = '<h1>x</h1><h2>y</h2><h3>z</h3><h2>w</h2>', id = D + '/a/#page', title = '제목 &amp; 부제' } = {}) =>
  `<title>${title}</title><meta name="description" content="설명 &quot;인용&quot;"><link rel="canonical" href="${canonical}"><meta property="og:url" content="${og}"><script type="application/ld+json">{"@id":"${id}","mainEntity":{"@id":"${id}x"}}</script>${headings}`;

test('a well-formed page has no SEO errors and its meta text is decoded', () => {
  assert.deepEqual(pageSeoErrors('/a/', doc(), D), []);
  const p = pageSeo(doc());
  assert.equal(p.title, '제목 & 부제');
  assert.equal(p.description, '설명 "인용"');
  assert.deepEqual(p.headings, [1, 2, 3, 2]);
  assert.deepEqual(p.ids, [D + '/a/#page', D + '/a/#pagex']);
});

test('og:url mismatch, relative @id, skipped heading levels and empty titles are reported', () => {
  assert.match(pageSeoErrors('/a/', doc({ og: D + '/b/' }), D).join(), /og:url differs/);
  assert.match(pageSeoErrors('/a/', doc({ id: '/a/#faq' }), D).join(), /relative or foreign JSON-LD @id \/a\/#faq/);
  assert.match(pageSeoErrors('/a/', doc({ headings: '<h1>x</h1><h3>z</h3>' }), D).join(), /skips from h1 to h3/);
  assert.deepEqual(pageSeoErrors('/a/', doc({ headings: '<h1>x</h1><h2>a</h2><h3>b</h3><h2>c</h2>' }), D), [], 'going back up is fine');
  assert.match(pageSeoErrors('/a/', doc({ title: ' ' }), D).join(), /empty title/);
});

test('duplicate titles are grouped with their routes', () => {
  const pages = [{ route: '/a/', title: 'X' }, { route: '/b/', title: 'Y' }, { route: '/c/', title: 'X' }];
  assert.deepEqual(duplicateMeta(pages, 'title'), [{ value: 'X', routes: ['/a/', '/c/'] }]);
});
