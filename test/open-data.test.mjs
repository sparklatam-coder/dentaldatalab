import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectReports } from '../scripts/report-data.mjs';
import { registerReportPages, REPORTS } from '../scripts/report-pages.mjs';
import { registerOpenDataPages, openDataCatalog, CATALOG_FILE } from '../scripts/open-data-pages.mjs';
import { LICENSE, SOURCE_LICENSE, NOT_COVERED, OPEN_DATA_ROUTE, PRESS_ROUTE, attributionText, attributionHtml, reportRoute, reportDataPath } from '../scripts/open-data.mjs';
import { textContent } from '../scripts/html.mjs';
import { esc, SOURCE_URL } from '../src/shared.mjs';

const domain = 'https://dentaldatalab.example';
const metadata = { snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:27:09.045Z', sourceSha256: 'a'.repeat(64) };
const institutionName = '개별기관비공개표식 <script>privateRecord()</script>';
const clinic = (id, overrides = {}) => ({
  id, name: institutionName, address: '개별주소비공개표식', typeCode: '51', sidoCode: '310000', sido: '경기', cityCode: '312700', city: '양주시',
  doctors: { specialist: null }, hours: {}, website: null, ...overrides,
});
const fixture = () => collectReports([
  clinic('private-a', { doctors: { specialist: 0 }, hours: { mon: { open: '09:00', close: '18:00' } } }),
  clinic('private-b', { typeCode: '41', doctors: { specialist: 2 }, openedOn: '2012-03-02', equipment: [{ name: '콘빔CT', count: 1 }] }),
  clinic('private-c', { cityCode: '310001', city: '가평군' }),
  clinic('private-d', { sidoCode: '110000', sido: '서울', cityCode: '110001', city: '강남구', typeCode: '41', doctors: { specialist: 5 } }),
  clinic('private-e', { sidoCode: '110000', sido: '서울', cityCode: '110001', city: '강남구' }),
], metadata);
const realReports = () => {
  const source = JSON.parse(fs.readFileSync(new URL('../data/clinics.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/source-manifest.json', import.meta.url), 'utf8'));
  return collectReports(source.clinics, { snapshotDate: source.snapshotDate, observedAt: source.observedAt, sourceSha256: manifest.archive.sha256 });
};

function render(reports, operator = { operatorName: '검증운영자', correctionEmail: 'press@example.org' }) {
  const pages = new Map(), files = new Map();
  const page = (route, options) => { assert(!pages.has(route), route); pages.set(route, options); };
  const put = (path, value) => { assert(!files.has(path), path); files.set(path, value); };
  registerReportPages({ reports, domain, page, put });
  const result = registerOpenDataPages({ reports, domain, page, put, operator });
  return { pages, files, result };
}
const citeFor = item => attributionText({ pageUrl: domain + reportRoute(item), snapshotDate: metadata.snapshotDate });

test('every report Dataset declares the licence, free access, the shared publisher node, its credit line and its catalog', () => {
  for (const reports of [fixture(), realReports()]) {
    const { pages } = render(reports);
    for (const item of REPORTS) {
      const dataset = pages.get(reportRoute(item)).schema.find(node => node['@type'] === 'Dataset');
      assert.equal(dataset.license, 'https://creativecommons.org/licenses/by/4.0/', item.slug);
      assert.equal(dataset.isAccessibleForFree, true);
      assert.deepEqual(dataset.creator, { '@type': 'Organization', '@id': domain + '/#publisher', name: '치과데이터랩', url: domain });
      assert.deepEqual(dataset.publisher, { '@id': domain + '/#publisher' });
      assert.equal(dataset.creditText, attributionText({ pageUrl: domain + reportRoute(item), snapshotDate: reports.snapshotDate }));
      assert.deepEqual(dataset.includedInDataCatalog, { '@type': 'DataCatalog', '@id': domain + '/data/open/#catalog', name: '치과데이터랩 공개 집계 데이터', url: domain + '/data/open/' });
      assert(dataset.keywords.includes('치과병원') && dataset.keywords.includes('건강보험심사평가원'));
      assert(Array.isArray(dataset.variableMeasured) && dataset.variableMeasured.length >= 3 && dataset.variableMeasured.every(value => typeof value === 'string' && value));
      assert(dataset.description.length >= 50 && dataset.description.length <= 5000, `${item.slug}: Google requires a 50–5000 character description`);
      assert(dataset.name && dataset.distribution.every(download => download.contentUrl.startsWith(domain + '/data/reports/')));
    }
  }
});

test('report JSON, CSV and the visible source block carry the licence and the attribution for their own page', () => {
  const reports = fixture();
  const { pages, files } = render(reports);
  for (const item of REPORTS) {
    const cite = citeFor(item);
    const json = JSON.parse(files.get(reportDataPath(item, 'json').slice(1)));
    assert.deepEqual(json.license, { name: 'CC BY 4.0', spdx: 'CC-BY-4.0', url: LICENSE.url, deedUrl: 'https://creativecommons.org/licenses/by/4.0/deed.ko', scope: json.license.scope, notCovered: json.license.notCovered });
    assert.match(json.license.scope, /집계 데이터.*표·그래프/);
    assert.equal(json.license.notCovered.length, NOT_COVERED.length);
    assert(json.license.notCovered.some(text => /제3자 관찰 자료/.test(text)) && json.license.notCovered.some(text => /로고/.test(text)));
    assert.deepEqual(json.sourceLicense, { name: '공공누리 제1유형(출처표시)', url: SOURCE_LICENSE.url, appliesTo: '건강보험심사평가원 「전국 병의원 및 약국 현황」 원자료' });
    assert.equal(json.requiredAttribution, cite);
    assert.equal(json.citationUrl, domain + reportRoute(item));
    assert.equal(json.openDataUrl, domain + OPEN_DATA_ROUTE);
    assert.equal(json.attribution, reports.attribution, 'the source attribution field is unchanged');

    const lines = files.get(reportDataPath(item, 'csv').slice(1)).split('\r\n').filter(Boolean);
    assert(lines[0].endsWith(',"이용조건","출처표기"'), item.slug);
    assert(lines.length > 1 && lines.slice(1).every(line => line.endsWith(`,"${cite}"`) && line.includes(',"CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)')), item.slug);

    const body = pages.get(reportRoute(item)).body;
    assert.equal(body.split('id="report-attribution"').length, 2, 'one copy target per page');
    assert(body.includes(`>${esc(cite)}</code><button type="button" class="btn small" data-copy-citation data-citation-target="report-attribution">`), item.slug);
    assert.match(body, /<a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/deed\.ko" target="_blank" rel="license noopener noreferrer">CC BY 4\.0<span class="sr-only"> \(새 창\)<\/span><\/a>/);
    assert(body.includes(`href="${SOURCE_LICENSE.url}"`) && body.includes('공공누리 제1유형(출처표시)'));
    assert(body.includes(`<a href="${OPEN_DATA_ROUTE}">`) && body.includes(`<a href="${PRESS_ROUTE}">`));
    assert(body.indexOf('id="report-attribution"') > body.indexOf('<h2>출처와 변경 기록</h2>'), 'inside the source block');
  }
  const hub = pages.get('/reports/').body;
  assert(hub.includes(`<a href="${OPEN_DATA_ROUTE}">`) && hub.includes(`<a href="${PRESS_ROUTE}">`));
});

test('the hub lists every aggregate dataset with real download links, plain terms, copy-ready attribution and what is excluded', () => {
  const reports = fixture();
  const { pages, files, result } = render(reports);
  assert.deepEqual(result, { datasets: REPORTS.length, catalog: 'data/open/catalog.json' });
  const page = pages.get('/data/open/');
  assert.equal(page.current, 'data');
  assert.equal((page.body.match(/<h1(?:\s|>)/g) || []).length, 1);
  assert.match(page.description, new RegExp(`집계표 ${REPORTS.length}종을 CSV·JSON으로`));
  for (const item of REPORTS) {
    const report = pages.get(reportRoute(item));
    assert(page.body.includes(`<a href="${reportRoute(item)}">${esc(report.title)}</a>`), item.slug);
    for (const ext of ['csv', 'json']) {
      assert(page.body.includes(`<a href="${reportDataPath(item, ext)}" download>`), `${item.slug}.${ext}`);
      assert(files.has(reportDataPath(item, ext).slice(1)), 'the linked download is a file the report build writes');
    }
  }
  // Every /data/reports/ and /reports/ link on the hub resolves to something the build produced.
  for (const [, href] of page.body.matchAll(/href="(\/[^"#]*)"/g)) {
    if (href.startsWith('/data/')) assert(files.has(href.slice(1)), href);
    if (href.startsWith('/reports/')) assert(pages.has(href), href);
  }
  assert(page.body.includes(`<span class="pill neutral">자료 기준일 ${metadata.snapshotDate}</span>`));
  assert.match(page.body, /rel="license noopener noreferrer">CC BY 4\.0 \(크리에이티브 커먼즈 저작자표시 4\.0 국제\)<span class="sr-only"> \(새 창\)<\/span><\/a>/);
  assert(page.body.includes(`href="${LICENSE.legalCodeUrl}"`) && page.body.includes(`href="${SOURCE_LICENSE.url}"`));
  assert.match(page.body, /영리 목적의 매체·서비스에서 쓰기/);
  assert.match(page.body, /가공했다는 사실을 밝힙니다/);
  for (const entry of NOT_COVERED) assert(page.body.includes(esc(entry.what)), entry.id);
  assert.match(page.body, /네이버 플레이스나 기관 홈페이지에서 옮긴/);
  assert.match(page.body, /<a href="\/corrections\/">정정 요청 방법/);
  // Only the plain helper anchor: indexnow.mjs can undo Cloudflare's e-mail rewrite for exactly this form.
  assert.equal(page.body.split('mailto:').length, 2);
  assert(page.body.includes('<a href="mailto:press@example.org">press@example.org</a>'));
  assert(page.body.includes(`href="${SOURCE_URL}"`));

  // Each copy button points at an element whose text is exactly the attribution: plain text and a usable <a href> line.
  const targets = [...page.body.matchAll(/data-citation-target="([^"]+)"/g)].map(match => match[1]);
  assert.equal(targets.length, 2 + REPORTS.length * 2);
  const copied = id => { const match = new RegExp(`<code id="${id}"[^>]*>([^<]*)</code>`).exec(page.body); assert(match, id); return textContent(match[1]); };
  const hubTerms = { pageUrl: domain + '/data/open/', snapshotDate: metadata.snapshotDate };
  assert.equal(copied('cite-text-open-data'), `출처: 치과데이터랩(${domain}/data/open/) · 원자료: 건강보험심사평가원 「전국 병의원 및 약국 현황」(2026-09-30 기준)`);
  assert.equal(copied('cite-html-open-data'), attributionHtml(hubTerms));
  assert.equal(copied('cite-html-open-data'), `출처: <a href="${domain}/data/open/">치과데이터랩</a> · 원자료: <a href="${SOURCE_URL}">건강보험심사평가원 「전국 병의원 및 약국 현황」</a>(2026-09-30 기준)`);
  for (const item of REPORTS) {
    assert.equal(copied(`cite-text-${item.slug}`), citeFor(item));
    assert(copied(`cite-html-${item.slug}`).includes(`<a href="${domain}${reportRoute(item)}">치과데이터랩</a>`));
  }
  assert.doesNotMatch(page.body, /&amp;amp;|undefined|NaN/);

  const output = JSON.stringify(page) + files.get(CATALOG_FILE);
  for (const forbidden of [institutionName, esc(institutionName), 'private-a', '개별주소비공개표식', '/clinics/']) assert(!output.includes(forbidden), forbidden);
});

test('DataCatalog JSON-LD and catalog.json describe the same datasets as the report pages', () => {
  const reports = fixture();
  const { pages, files } = render(reports);
  const catalog = pages.get('/data/open/').schema[0];
  assert.equal(catalog['@type'], 'DataCatalog');
  assert.equal(catalog['@id'], domain + '/data/open/#catalog', 'first schema node carries the @id the shell uses for mainEntity');
  assert.equal(catalog.license, LICENSE.url);
  assert.equal(catalog.isAccessibleForFree, true);
  assert.deepEqual(catalog.publisher, { '@id': domain + '/#publisher' });
  assert.equal(catalog.dataset.length, REPORTS.length);
  REPORTS.forEach((item, index) => {
    const nested = catalog.dataset[index], own = pages.get(reportRoute(item)).schema.find(node => node['@type'] === 'Dataset');
    assert.equal(nested['@id'], own['@id']);
    assert.equal(nested.name, own.name);
    assert.equal(nested.url, own.url);
    assert.equal(nested.license, LICENSE.url);
    assert(nested.description.length >= 50 && nested.description.length <= 5000, item.slug);
    assert.deepEqual(nested.distribution, own.distribution);
  });

  const json = JSON.parse(files.get(CATALOG_FILE));
  assert.deepEqual(json, JSON.parse(JSON.stringify(openDataCatalog({ reports, domain }))));
  assert.equal(files.get(CATALOG_FILE), JSON.stringify(openDataCatalog({ reports: fixture(), domain }), null, 2) + '\n', 'no timestamp: equal inputs give equal bytes');
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.snapshotDate, metadata.snapshotDate);
  assert.equal(json.source.sha256, metadata.sourceSha256);
  assert.equal(json.source.url, SOURCE_URL);
  assert.equal(json.license.spdx, 'CC-BY-4.0');
  assert.equal(json.license.url, LICENSE.url);
  assert.equal(json.source.license.name, '공공누리 제1유형(출처표시)');
  assert.equal(json.correctionsUrl, domain + '/corrections/');
  assert.deepEqual(json.datasets.map(dataset => dataset.id), REPORTS.map(item => item.slug));
  for (const dataset of json.datasets) {
    assert(pages.has(new URL(dataset.landingPage).pathname));
    for (const url of Object.values(dataset.downloads)) assert(files.has(new URL(url).pathname.slice(1)), url);
    assert.equal(dataset.title, pages.get(new URL(dataset.landingPage).pathname).title);
    assert.equal(dataset.requiredAttribution, attributionText({ pageUrl: dataset.landingPage, snapshotDate: metadata.snapshotDate }));
    assert(dataset.attributionHtml.includes(`<a href="${dataset.landingPage}">`));
    assert(dataset.variables.length >= 3);
  }
});
