import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {rssFeed, rfc822} from '../scripts/feed.mjs';

test('dates are RFC 822 at KST midnight and impossible dates fail', () => {
  assert.equal(rfc822('2026-11-26'), 'Thu, 26 Nov 2026 00:00:00 +0900');
  assert.equal(rfc822('2026-11-01'), 'Sun, 01 Nov 2026 00:00:00 +0900');
  for (const bad of ['2026-02-30', '26-11-01', '', null]) assert.throws(() => rfc822(bad));
});

test('feed orders newest first, escapes text and skips pages that were not built', () => {
  const meta = new Map([['/a/', {title: 'A & <b>', description: '"설명"'}], ['/b/', {title: 'B', description: 'b'}]]);
  const {xml, missing} = rssFeed({items: [{route: '/a/', publishedOn: '2026-11-01'}, {route: '/b/', publishedOn: '2026-11-26'}, {route: '/gone/', publishedOn: '2026-11-20'}], meta, domain: 'https://example.test'});
  assert.deepEqual(missing, ['/gone/']);
  assert.ok(xml.indexOf('https://example.test/b/') < xml.indexOf('https://example.test/a/'));
  assert.match(xml, /<title>A &amp; &lt;b&gt;<\/title>/);
  assert.match(xml, /<description>&quot;설명&quot;<\/description>/);
  assert.match(xml, /<lastBuildDate>Thu, 26 Nov 2026 00:00:00 \+0900<\/lastBuildDate>/);
  assert.match(xml, /<atom:link href="https:\/\/example.test\/feed.xml" rel="self"/);
});

test('feed config has valid unique routes and dates', () => {
  const {items} = JSON.parse(fs.readFileSync('data/content/feed.json', 'utf8'));
  const meta = new Map(items.map(i => [i.route, {title: 't', description: 'd'}]));
  assert.equal(rssFeed({items, meta, domain: 'https://dentaldatalab.com'}).missing.length, 0);
  assert.throws(() => rssFeed({items: [...items, items[0]], meta, domain: 'https://dentaldatalab.com'}), /Duplicate/);
});
