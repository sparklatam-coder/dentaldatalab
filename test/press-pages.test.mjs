import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReports } from '../scripts/report-data.mjs';
import { registerReportPages, REPORTS } from '../scripts/report-pages.mjs';
import { registerPressPages, validatePressReleases, loadPressReleases, releasePath, PRESS_RELEASES_FILE } from '../scripts/press-pages.mjs';
import { headlineFacts, dataLimits, renderPressRelease, COMMENT_PLACEHOLDER, INTERNAL_HEADING } from '../scripts/press-release.mjs';
import { attributionText, attributionHtml } from '../scripts/open-data.mjs';
import { isIndexableRoute } from '../scripts/seo.mjs';
import { mailtoLink } from '../scripts/site-operations.mjs';
import { undoCloudflareEmailObfuscation } from '../scripts/indexnow.mjs';
import { textContent } from '../scripts/html.mjs';
import { esc, fmt } from '../src/shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const source = read('data/clinics.json');
const reports = collectReports(source.clinics, { snapshotDate: source.snapshotDate, observedAt: source.observedAt, sourceSha256: read('data/source-manifest.json').archive.sha256 });
const domain = 'https://dentaldatalab.example';
const operator = { operatorName: '검증운영자', correctionEmail: 'press@example.org' };

function render(options = {}) {
  const pages = new Map(), files = new Map();
  const page = (route, value) => { assert(!pages.has(route), route); pages.set(route, value); };
  const put = (file, value) => { assert(!files.has(file), file); files.set(file, value); };
  registerReportPages({ reports, domain, page, put });
  const result = registerPressPages({ reports, domain, page, put, operator, ...options });
  return { pages, files, result, press: pages.get('/press/') };
}
// A finished release: the placeholder line and the internal checklist were removed by a person.
const finished = () => renderPressRelease(reports, { domain, operator }).split(INTERNAL_HEADING)[0].replace(/\n## 운영자 코멘트\n\n> .*\n/, '\n').replace(/\n---\n\s*$/, '\n');

test('/press/ states each headline number with its 기준일 first and links it to the report and its CSV', () => {
  const { pages, files, result, press } = render();
  const facts = headlineFacts(reports);
  assert.deepEqual(result, { facts: facts.length, releases: 0 });
  assert.equal(press.title, '보도·인용 안내');
  assert.equal((press.body.match(/<h1(?:\s|>)/g) || []).length, 1);
  assert(press.body.includes('<h1>보도·인용 안내</h1>'));
  assert(isIndexableRoute('/press/'));
  assert(press.description.includes(`전국 치과병원 ${fmt(reports.dentalHospitals.total)}곳`) && press.description.includes(reports.snapshotDate));

  const cards = [...press.body.matchAll(/<article class="fact-panel" id="fact-([a-z-]+)">(.*?)<\/article>/g)];
  assert.deepEqual(cards.map(card => card[1]), facts.map(fact => fact.id));
  assert(cards.length >= 6);
  cards.forEach(([, id, html], index) => {
    const fact = facts[index], item = REPORTS.find(entry => entry.slug === fact.report);
    // The card opens with the sentence that carries the number and the 기준일.
    assert(html.startsWith(`<h3 style="margin-top:0">${esc(fact.headline)}</h3>`), id);
    assert.match(fact.headline, /\d/);
    assert(fact.headline.endsWith(`(건강보험심사평가원 ${reports.snapshotDate} 기준).`), id);
    assert(html.includes(`<p class="subtle-note">읽을 때 주의: ${esc(fact.caveat)}</p>`), id);
    assert(html.includes(`<a href="/reports/${item.slug}/">리포트: ${esc(pages.get(`/reports/${item.slug}/`).title)} `), id);
    assert(html.includes(`<a href="/data/reports/${item.slug}.csv" download>집계표 CSV</a>`), id);
    assert(files.has(`data/reports/${item.slug}.csv`) && files.has(`data/reports/${item.slug}.json`), id);
    const copied = new RegExp(`<code id="press-cite-${id}"[^>]*>([^<]*)</code><button type="button" class="btn small" data-copy-citation data-citation-target="press-cite-${id}">`).exec(html);
    assert.equal(textContent(copied[1]), attributionText({ pageUrl: `${domain}/reports/${item.slug}/`, snapshotDate: reports.snapshotDate }), id);
  });
  assert(press.body.includes(`<h3 style="margin-top:0">전국 치과병원은 ${fmt(reports.dentalHospitals.total)}곳입니다(건강보험심사평가원 ${reports.snapshotDate} 기준).</h3>`));

  // Every copy button has exactly one target, and every internal link resolves.
  const targets = [...press.body.matchAll(/data-citation-target="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(targets).size, targets.length);
  for (const id of targets) assert.equal(press.body.split(`<code id="${id}"`).length, 2, id);
  const hub = { pageUrl: `${domain}/data/open/`, snapshotDate: reports.snapshotDate };
  assert(press.body.includes(`>${esc(attributionText(hub))}</code>`) && press.body.includes(`>${esc(attributionHtml(hub))}</code>`));
  const known = new Set(['/data/open/', '/corrections/', '/about/', '/methodology/']);
  for (const [, href] of press.body.matchAll(/href="(\/[^"#]*)"/g)) assert(pages.has(href) || files.has(href.slice(1)) || known.has(href), href);

  for (const limit of dataLimits(reports)) assert(press.body.includes(`<li><strong>${esc(limit.label)}:</strong> ${esc(limit.text)}</li>`), limit.label);
  assert(dataLimits(reports).some(limit => limit.text.includes(reports.hospitalDistricts.definitions.coverage)), 'limits reuse the caveats the reports publish');
  assert.match(press.body, /href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/deed\.ko" target="_blank" rel="license noopener noreferrer">CC BY 4\.0<\/a>/);
  assert.match(press.body, /<h2>인용하는 방법<\/h2>/);
  assert.doesNotMatch(press.body, /undefined|NaN|&amp;amp;/);
});

test('/press/ carries no institution name, id, detail link or ranking wording', () => {
  const { press } = render();
  const output = JSON.stringify(press);
  const names = [...new Set(source.clinics.map(item => item.name).filter(name => typeof name === 'string' && name.trim()))];
  assert(names.length > 10000);
  assert.deepEqual(names.filter(name => output.includes(name) || output.includes(esc(name))), []);
  assert.doesNotMatch(output, /\/clinics\/|c-[0-9a-f]{12}/);
  assert.doesNotMatch(output, /더 안전|더 실력|믿을 수 있는|고려하세요|추천|우수한|소외|공백 지역|의료 취약|사각지대|1위|최고|최다|가장 (많|적|높|낮)|상위 \d|TOP|베스트/);
});

test('the press contact is the operator e-mail through the mailto helper, or a notice when none is set', () => {
  const { press } = render();
  const link = mailtoLink('press@example.org');
  assert.equal(link, '<a href="mailto:press@example.org">press@example.org</a>');
  assert(press.body.includes(`<div class="condition-links">${link}</div>`));
  assert.equal(press.body.split('mailto:').length, 2, 'the address appears once, as the helper anchor');
  // Cloudflare rewrites that anchor on the live page; IndexNow compares live and local HTML after undoing it.
  const cf = text => '2a' + [...Buffer.from(text)].map(byte => (byte ^ 0x2a).toString(16).padStart(2, '0')).join('');
  const live = press.body.replace(link, `<a href="/cdn-cgi/l/email-protection#${cf('press@example.org')}"><span class="__cf_email__" data-cfemail="${cf('press@example.org')}">[email&#160;protected]</span></a>`);
  assert.notEqual(live, press.body);
  assert.equal(undoCloudflareEmailObfuscation(live), press.body);
  assert(press.body.includes('서비스 이름: 치과데이터랩 · 운영: 검증운영자'));
  assert.deepEqual([...new Set(press.body.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g))], ['press@example.org']);
  const none = render({ operator: {} }).press;
  assert.doesNotMatch(none.body, /mailto:|@/);
  assert(none.body.includes('문의 이메일은 확인 중입니다.'));
  const escaped = render({ operator: { operatorName: '<b>운영</b>', correctionEmail: 'a&b@example.org' } }).press;
  assert(escaped.body.includes('운영: &lt;b&gt;운영&lt;/b&gt;') && !escaped.body.includes('<b>운영</b>'));
});

test('only releases a person marked as released are listed and published', () => {
  const draft = render({ releases: [{ id: '2026-09-30-dental-hospitals', snapshotDate: '2026-09-30', status: 'draft', releasedOn: null }] });
  assert.equal(draft.result.releases, 0);
  assert(draft.press.body.includes('배포한 보도자료는 아직 없습니다.'));
  assert(![...draft.files.keys()].some(file => file.startsWith('press/')));
  assert.doesNotMatch(draft.press.body, /press\/releases|작성 필요/);

  const text = finished();
  const released = render({ releases: [{ id: '2026-09-30-dental-hospitals', snapshotDate: '2026-09-30', status: 'released', releasedOn: '2026-12-01', title: '제목 <확인>', text }] });
  assert.equal(released.result.releases, 1);
  assert.equal(releasePath('2026-09-30-dental-hospitals'), 'press/releases/2026-09-30-dental-hospitals.txt');
  assert.equal(released.files.get('press/releases/2026-09-30-dental-hospitals.txt'), text);
  assert(released.press.body.includes('<strong>제목 &lt;확인&gt;</strong><p>배포 2026-12-01 · 자료 기준일 2026-09-30</p><a href="/press/releases/2026-09-30-dental-hospitals.txt">'));
  assert(!released.press.body.includes('배포한 보도자료는 아직 없습니다.'));
});

test('the release list is validated, and an unfinished document cannot be marked released', () => {
  const entry = { id: '2026-09-30-dental-hospitals', snapshotDate: '2026-09-30', file: 'docs/press/2026-09-30-dental-hospitals.md', status: 'draft', releasedOn: null };
  const config = (...releases) => ({ schemaVersion: 1, releases });
  const neverRead = () => { throw new Error('a draft must not be read'); };
  assert.deepEqual(validatePressReleases(config(entry), neverRead), [{ id: entry.id, snapshotDate: '2026-09-30', status: 'draft', releasedOn: null }]);

  const generated = renderPressRelease(reports, { domain, operator }), text = finished();
  assert(!text.includes(COMMENT_PLACEHOLDER) && !text.includes(INTERNAL_HEADING) && text.includes('## 자료 설명과 한계'));
  const released = { ...entry, status: 'released', releasedOn: '2026-12-01' };
  const [valid] = validatePressReleases(config(released), file => { assert.equal(file, entry.file); return text; });
  assert.equal(valid.title, generated.split('\n')[0].slice(2));
  assert.equal(valid.text, text);
  assert.throws(() => validatePressReleases(config(released), () => generated), /still has the comment placeholder or the internal checklist/);
  assert.throws(() => validatePressReleases(config(released), () => generated.split(INTERNAL_HEADING)[0]), /still has the comment placeholder/);
  assert.throws(() => validatePressReleases(config(released), () => text + '\n' + INTERNAL_HEADING), /internal checklist/);
  assert.throws(() => validatePressReleases(config(released), () => '제목 줄이 없는 문서'), /no "# " title line/);

  for (const [bad, pattern] of [
    [{ ...entry, id: '../secret' }, /Invalid or duplicate/], [{ ...entry, id: 'Dental' }, /Invalid or duplicate/],
    [{ ...entry, file: 'docs/press/other.md' }, /file must be/], [{ ...entry, file: '../../etc/passwd' }, /file must be/],
    [{ ...entry, snapshotDate: '2026-02-30' }, /snapshotDate/], [{ ...entry, status: 'published' }, /status must be/],
    [{ ...entry, releasedOn: '2026-12-01' }, /a draft has no releasedOn/], [{ ...released, releasedOn: null }, /needs releasedOn/], [{ ...released, releasedOn: '12/01' }, /needs releasedOn/],
  ]) assert.throws(() => validatePressReleases(config(bad), () => text), pattern, JSON.stringify(bad));
  assert.throws(() => validatePressReleases(config(entry, entry), neverRead), /Invalid or duplicate/);
  assert.throws(() => validatePressReleases({ releases: [] }, neverRead), /schemaVersion 1/);

  const newer = { ...released, id: '2026-12-31-dental-hospitals', file: 'docs/press/2026-12-31-dental-hospitals.md', snapshotDate: '2026-12-31', releasedOn: '2027-02-01' };
  assert.deepEqual(validatePressReleases(config(released, newer), () => text).map(item => item.id), [newer.id, released.id], 'newest release first');
});

test('the committed release list is valid and names files that exist', () => {
  const config = read(PRESS_RELEASES_FILE);
  const releases = loadPressReleases(root);
  assert.equal(releases.length, config.releases.length);
  for (const entry of config.releases) {
    assert(fs.existsSync(path.join(root, entry.file)), entry.file);
    // No headline or number is typed into the list: the title is read from the document.
    assert.deepEqual(Object.keys(entry).sort(), ['file', 'id', 'releasedOn', 'snapshotDate', 'status']);
  }
});
