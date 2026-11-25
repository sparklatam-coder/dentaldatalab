import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  THIN_CLINIC_POLICY, THIN_CLINIC_POLICIES, SEO_INDEXING_FILE, clinicIndexSignals, clinicIndexTier, thinClinicPlan,
  setNoindexRoutes, isIndexedRoute, isIndexableRoute, primeSeoIndexing, robotsMeta, sitemapXml,
} from '../scripts/seo.mjs';
import { cloudflareWorker } from '../scripts/build-cloudflare.mjs';

// The registry is module state; every test that fills it empties it again.
const reset = t => t.after(() => setNoindexRoutes([]));
const clinic = (id, typeCode = '51', extra = {}) => ({
  id, typeCode, doctors: { specialist: 0 }, quality: { hoursAvailable: false }, ...extra,
});
const route = id => '/clinics/' + id + '/';
const thin = 'c-000000000051', hours = 'c-0000000000a1', specialist = 'c-0000000000b1', asset = 'c-0000000000c1', naver = 'c-0000000000d1', hospital = 'c-000000000041';

test('a 치과의원 page is basic only when it has no hours, no specialist, no confirmed channel and no Naver observation', () => {
  assert.equal(clinicIndexTier(clinic(thin)), 'basic');
  assert.equal(clinicIndexTier(clinic(thin), { assetRecord: { assets: [], naverPlaceObservations: [] }, naverStage: 'place_discovery' }), 'basic');
  // Each signal alone is enough.
  assert.equal(clinicIndexTier(clinic(thin, '51', { quality: { hoursAvailable: true } })), 'full');
  assert.equal(clinicIndexTier(clinic(thin), { naverStage: 'hours_available' }), 'full');
  assert.equal(clinicIndexTier(clinic(thin, '51', { doctors: { specialist: 1 } })), 'full');
  for (const ownership of ['official', 'linked']) {
    assert.equal(clinicIndexTier(clinic(thin), { assetRecord: { assets: [{ ownership, linkable: true }] } }), 'full', ownership);
    assert.equal(clinicIndexTier(clinic(thin), { assetRecord: { assets: [{ ownership }] } }), 'full', ownership + ' without an explicit link flag');
  }
  assert.equal(clinicIndexTier(clinic(thin), { assetRecord: { naverPlaceObservations: [{ sourceUrl: 'https://map.naver.com/p/entry/place/1' }] } }), 'full');
  assert.deepEqual(clinicIndexSignals(clinic(thin, '51', { doctors: { specialist: 2 } }), { naverStage: 'hours_available' }),
    { hours: true, specialist: true, confirmedAsset: false, naverPlace: false });
});

test('weaker evidence does not lift a 치과의원 page out of the basic tier', () => {
  // Unknown is not zero, and neither is a signal.
  for (const value of [0, null, undefined, '2']) assert.equal(clinicIndexTier(clinic(thin, '51', { doctors: { specialist: value } })), 'basic', String(value));
  assert.equal(clinicIndexTier({ id: thin, typeCode: '51' }), 'basic', 'missing sub-objects');
  // A registered URL, an unreviewed candidate, a third-party mention and a link that is switched off are not confirmed channels.
  for (const item of [{ ownership: 'registered', linkable: true }, { ownership: 'candidate', linkable: true }, { ownership: 'third_party', linkable: true }, { ownership: 'official', linkable: false }, { ownership: 'linked', linkable: false }]) {
    assert.equal(clinicIndexTier(clinic(thin), { assetRecord: { assets: [item], naverPlaceObservations: [] } }), 'basic', JSON.stringify(item));
  }
  // A map candidate that was found but never read is a stage, not an observation.
  for (const stage of ['hours_missing', 'identity_review', 'access_failed', 'place_ready', 'place_discovery', null]) {
    assert.equal(clinicIndexTier(clinic(thin), { naverStage: stage }), 'basic', String(stage));
  }
});

test('a 치과병원 page is always full, whatever its data looks like', () => {
  assert.equal(clinicIndexTier(clinic(hospital, '41')), 'full');
  assert.equal(clinicIndexTier({ id: hospital, typeCode: '41' }, { assetRecord: { assets: [], naverPlaceObservations: [] }, naverStage: 'place_discovery' }), 'full');
  // Only an explicit 51 can be demoted: a record this rule does not know stays indexed.
  for (const typeCode of ['11', 51, undefined]) assert.equal(clinicIndexTier({ id: thin, typeCode }), 'full', String(typeCode));
});

function sample() {
  const clinics = [
    clinic(hospital, '41'), clinic(thin), clinic('c-000000000052'),
    clinic(hours, '51', { quality: { hoursAvailable: true } }), clinic(specialist, '51', { doctors: { specialist: 3 } }), clinic(asset), clinic(naver),
  ];
  const assetRecords = new Map([
    [asset, { assets: [{ ownership: 'linked', linkable: true }], naverPlaceObservations: [] }],
    [naver, { assets: [{ ownership: 'candidate', linkable: false }], naverPlaceObservations: [{}] }],
    [thin, { assets: [{ ownership: 'registered', linkable: true }], naverPlaceObservations: [] }],
  ]);
  const naverStages = new Map([[naver, 'hours_available'], [thin, 'place_ready']]);
  return { clinics, assetRecords, naverStages };
}

test('both policies count the same tiers; only noindex lists routes, and never a 치과병원', () => {
  const { clinics, assetRecords, naverStages } = sample();
  const tiers = { 41: { full: 1, basic: 0 }, 51: { full: 4, basic: 2 } };
  const signals = { hours: 2, specialist: 1, confirmedAsset: 1, naverPlace: 1 };
  const kept = thinClinicPlan(clinics, { assetRecords, naverStages, policy: 'index' });
  assert.deepEqual(kept, { schemaVersion: 1, policy: 'index', tiers, signals, noindexRoutes: [] });
  const demoting = thinClinicPlan([...clinics].reverse(), { assetRecords, naverStages, policy: 'noindex' });
  assert.deepEqual(demoting, { schemaVersion: 1, policy: 'noindex', tiers, signals, noindexRoutes: [route(thin), route('c-000000000052')] });
  assert(!demoting.noindexRoutes.includes(route(hospital)));
  // Without inventory data the 치과병원 is still full and every signal-less 치과의원 is basic.
  assert.deepEqual(thinClinicPlan(clinics, { policy: 'noindex' }).tiers, { 41: { full: 1, basic: 0 }, 51: { full: 2, basic: 4 } });
  assert.throws(() => thinClinicPlan(clinics, { policy: 'hide' }), /Unknown THIN_CLINIC_POLICY/);
  assert(THIN_CLINIC_POLICIES.includes(THIN_CLINIC_POLICY), 'the shipped constant is one of the two supported values');
  assert.equal(thinClinicPlan(clinics).policy, THIN_CLINIC_POLICY);
});

test('the registry turns listed routes into noindex,follow and removes them from the sitemap; an empty registry changes nothing', t => {
  reset(t);
  const { clinics, assetRecords, naverStages } = sample();
  const routes = ['/', '/find/', '/questions/', '/hospitals/', ...clinics.map(c => route(c.id))];
  const before = { meta: routes.map(r => robotsMeta(r, true)), review: routes.map(r => robotsMeta(r)), sitemap: sitemapXml(routes, 'https://example.test', true), reviewSitemap: sitemapXml(routes, 'https://example.test') };

  // 'index': the plan lists nothing, so every output is byte-identical to a build without the policy.
  assert.equal(setNoindexRoutes(thinClinicPlan(clinics, { assetRecords, naverStages, policy: 'index' }).noindexRoutes), 0);
  assert.deepEqual(routes.map(r => robotsMeta(r, true)), before.meta);
  assert.equal(sitemapXml(routes, 'https://example.test', true), before.sitemap);
  assert.equal(sitemapXml(routes, 'https://example.test'), before.reviewSitemap);

  // 'noindex': the two basic pages stay crawlable (follow) but are no longer indexed or advertised.
  const demoted = thinClinicPlan(clinics, { assetRecords, naverStages, policy: 'noindex' }).noindexRoutes;
  assert.equal(setNoindexRoutes(demoted), 2);
  for (const r of routes) {
    const listed = demoted.includes(r);
    assert.equal(robotsMeta(r, true), listed ? 'noindex,follow' : before.meta[routes.indexOf(r)], r);
    assert.equal(isIndexedRoute(r), isIndexableRoute(r) && !listed, r);
    assert.equal(robotsMeta(r), 'noindex,nofollow', 'a review build is unaffected: ' + r);
  }
  assert.equal(robotsMeta(route(hospital), true), 'index,follow');
  assert.equal(robotsMeta(route(hours), true), 'index,follow');
  const sitemap = sitemapXml(routes, 'https://example.test', true);
  assert.equal((sitemap.match(/<url>/g) || []).length, (before.sitemap.match(/<url>/g) || []).length - 2);
  for (const r of demoted) {
    assert(!sitemap.includes(r), r);
    assert(!sitemapXml(routes, 'https://example.test').includes(r), 'also left out of a review sitemap: ' + r);
  }
  assert(sitemap.includes(`<loc>https://example.test${route(hospital)}</loc>`));

  // Reversible: clearing the registry restores every output.
  setNoindexRoutes([]);
  assert.deepEqual(routes.map(r => robotsMeta(r, true)), before.meta);
  assert.equal(sitemapXml(routes, 'https://example.test', true), before.sitemap);
});

test('only institution profile routes can be demoted, and a rejected list leaves the registry as it was', t => {
  reset(t);
  setNoindexRoutes([route(thin)]);
  for (const bad of ['/', '/hospitals/', '/regions/110000/', '/clinics/', '/clinics/c-abc/', route(thin) + 'extra/', route(thin).slice(0, -1), 'https://dentaldatalab.com' + route(thin), null, 51]) {
    assert.throws(() => setNoindexRoutes([route(hours), bad]), /Only institution profile routes/, String(bad));
  }
  assert.equal(robotsMeta(route(thin), true), 'noindex,follow');
  assert.equal(robotsMeta(route(hours), true), 'index,follow');
  assert.equal(robotsMeta('/hospitals/', true), 'index,follow');
});

test('a build directory primes the same registry for QA and IndexNow; a directory without the record demotes nothing', t => {
  reset(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddl-seo-indexing-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  setNoindexRoutes([route(hours)]);
  assert.equal(primeSeoIndexing(dir), null);
  assert.equal(robotsMeta(route(hours), true), 'index,follow', 'a stale registry is cleared');
  for (const policy of THIN_CLINIC_POLICIES) {
    const record = { ...thinClinicPlan(sample().clinics, { policy }), indexingEnabled: true };
    fs.writeFileSync(path.join(dir, SEO_INDEXING_FILE), JSON.stringify(record));
    assert.deepEqual(primeSeoIndexing(dir), record);
    assert.equal(robotsMeta(route(thin), true), policy === 'noindex' ? 'noindex,follow' : 'index,follow', policy);
    assert.equal(robotsMeta(route(hospital), true), 'index,follow', policy);
  }
  for (const broken of [{ policy: 'hide', noindexRoutes: [] }, { policy: 'noindex' }, { policy: 'noindex', noindexRoutes: ['/hospitals/'] }]) {
    fs.writeFileSync(path.join(dir, SEO_INDEXING_FILE), JSON.stringify(broken));
    assert.throws(() => primeSeoIndexing(dir), undefined, JSON.stringify(broken));
  }
});

test('the compact Worker serves a demoted page unchanged: the robots meta in the HTML is the only control', async () => {
  const worker = (await import('data:text/javascript;base64,' + Buffer.from(cloudflareWorker({ review: false, canonicalOrigin: 'https://dentaldatalab.com', pagesHost: 'dentaldatalab.pages.dev' })).toString('base64'))).default;
  const pages = {
    'c-abc123456789': '<html><meta name="robots" content="noindex,follow"><h1>기본 정보만 있는 치과의원</h1></html>',
    'c-abc987654321': '<html><meta name="robots" content="index,follow"><h1>치과병원</h1></html>',
  };
  const env = { ASSETS: { async fetch() { return new Response(JSON.stringify(pages)); } } };
  for (const [id, html] of Object.entries(pages)) {
    const response = await worker.fetch(new Request('https://dentaldatalab.com/clinics/' + id + '/'), env);
    assert.equal(response.status, 200);
    // No header competes with, or duplicates, the meta tag; a demoted page stays readable so its links can be followed.
    assert.equal(response.headers.get('X-Robots-Tag'), null, id);
    assert.equal(await response.text(), html, id);
  }
});
