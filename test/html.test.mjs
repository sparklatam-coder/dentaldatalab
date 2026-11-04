import test from 'node:test';
import assert from 'node:assert/strict';
import { externalLink, externalUrl, internalLink, textContent, reportTable, csv, pct } from '../scripts/html.mjs';
import { esc } from '../src/shared.mjs';

test('externalLink only emits anchors for absolute http(s) URLs and escapes everything', () => {
  assert.equal(externalLink('https://clinic.example/about?x=1&y=2', '안내 <b>'), '<a href="https://clinic.example/about?x=1&amp;y=2" target="_blank" rel="noopener noreferrer">안내 &lt;b&gt;</a>');
  assert.match(externalLink('http://clinic.example', 'x', { withIcon: true }), /^<a href="http:\/\/clinic\.example\/"[^>]*>x <svg/);
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', '/relative/', 'clinic.example', 'https://user:pw@clinic.example/', 'https://localhost', '', null, undefined, 42])
    assert.equal(externalLink(bad, 'label <'), 'label &lt;', String(bad));
  assert.equal(externalLink('javascript:alert(1)'), '');
  assert.equal(externalUrl('HTTPS://Clinic.Example/path'), 'https://clinic.example/path');
});

test('textContent recovers the original text of escaped markup so re-escaping it never doubles entities', () => {
  const raw = 'R&D 센터 <2층> "본관" \'별관\'';
  const html = `<a href="tel:0">${esc(raw)}</a><small>${esc('추가 & 안내')}</small>`;
  assert.equal(textContent(html), ` ${raw}  추가 & 안내 `);
  assert.equal(esc(textContent(html)), ` ${esc(raw)}  ${esc('추가 & 안내')} `);
  assert(!esc(textContent(esc('R&D'))).includes('&amp;amp;'));
  assert.equal(textContent(null), '');
  assert.equal(textContent(42), '42');
});

test('pct keeps unavailable ratios explicit and rounds the computed percentage', () => {
  assert.equal(pct(null), '산출 불가');
  assert.equal(pct(undefined), '산출 불가');
  assert.equal(pct(0), '0.0%');
  assert.equal(pct(33.333), '33.3%');
  assert.equal(pct('12.5'), '12.5%');
});

test('reportTable escapes headers and caption, and treats cells as HTML, text or data rows as requested', () => {
  const headers = ['항목 <b>', '값'], caption = '설명 "표"';
  const rows = [['<em>강조</em>', '<b>굵게</b>'], ['둘째', 2]];
  const html = reportTable(headers, rows, caption);
  assert(html.startsWith(`<div class="report-table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="report-table"><caption>${esc(caption)}</caption><thead><tr><th scope="col">항목 &lt;b&gt;</th><th scope="col">값</th></tr></thead>`));
  assert(html.includes('<tbody><tr><th scope="row"><em>강조</em></th><td><b>굵게</b></td></tr><tr><th scope="row">둘째</th><td>2</td></tr></tbody></table></div>'));
  assert(reportTable(headers, rows, caption, { escapeCells: true }).includes('<tr><th scope="row">&lt;em&gt;강조&lt;/em&gt;</th><td>&lt;b&gt;굵게&lt;/b&gt;</td></tr>'));
  assert(reportTable(headers, rows, caption, { rowHeader: false }).includes('<tr><td><em>강조</em></td><td><b>굵게</b></td></tr>'));
  assert(reportTable(headers, [], caption).includes('<tbody></tbody>'));
});

test('csv emits a BOM, CRLF rows, quoted cells with doubled quotes, and empty cells for missing values', () => {
  const value = csv([['a', 'b'], ['quote "x"', null], [0, undefined]]);
  assert.equal(value, '﻿"a","b"\r\n"quote ""x""",""\r\n"0",""\r\n');
});

test('internalLink accepts only root-relative paths and never a scheme or protocol-relative URL', () => {
  assert.equal(internalLink('/data/clinic-assets/records/c-1.json', '기관별 JSON'), '<a href="/data/clinic-assets/records/c-1.json">기관별 JSON</a>');
  for (const bad of ['//evil.example/x', 'https://clinic.example/', 'javascript:alert(1)', 'data/x.json', '', null, '/a b']) assert.equal(internalLink(bad, 'L <'), 'L &lt;', String(bad));
});
