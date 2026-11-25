import { esc, icon, safeWebsite } from '../src/shared.mjs';
import { clinicUrl } from '../src/shared.mjs';

// Absolute http(s) URL without credentials, or null. Relative values and other schemes never become hrefs.
export const externalUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? safeWebsite(value) : null;

// The single way page modules render an outbound link. An invalid URL degrades to plain text instead of
// shipping whatever the data file contained.
// Same-origin link: a root-relative path only (no scheme, no protocol-relative '//'). Anything else degrades to text.
export const internalPath = value => typeof value === 'string' && /^\/(?!\/)[^\s<>"']*$/.test(value) ? value : null;
export function internalLink(path, label, { className = '' } = {}) {
  const safe = internalPath(path);
  const text = esc(label ?? safe ?? '');
  return safe ? `<a href="${esc(safe)}"${className ? ` class="${esc(className)}"` : ''}>${text}</a>` : text;
}

export function externalLink(url, label, { withIcon = false, rel = 'noopener noreferrer', className = '' } = {}) {
  const safe = externalUrl(url);
  const text = esc(label ?? safe ?? '');
  if (!safe) return text;
  return `<a href="${esc(safe)}"${className ? ` class="${esc(className)}"` : ''} target="_blank" rel="${esc(rel)}">${text}<span class="sr-only"> (새 창)</span>${withIcon ? ' ' + icon('link') : ''}</a>`;
}

// Plain text of an HTML fragment built with esc(): tags removed, the five entities esc() emits decoded.
// Use it when already-rendered markup must be re-escaped exactly once (e.g. into a data attribute).
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export const textContent = html => String(html ?? '').replace(/<[^>]+>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ENTITIES[entity]);

// Percentage already computed by the aggregation layer; null stays visible as unavailable instead of NaN.
export const pct = value => value == null ? '산출 불가' : `${Number(value).toFixed(1)}%`;

// Accessible report table. Cells are HTML unless escapeCells is set; the first cell is a row header unless rowHeader is false.
export function reportTable(headers, rows, caption, { rowHeader = true, escapeCells = false } = {}) {
  const cell = value => escapeCells ? esc(value) : value;
  return `<div class="report-table-scroll" tabindex="0" role="region" aria-label="${esc(caption)}"><table class="report-table"><caption>${esc(caption)}</caption><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((value, i) => rowHeader && i === 0 ? `<th scope="row">${cell(value)}</th>` : `<td>${cell(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

// UTF-8 BOM + CRLF CSV with every cell quoted, as spreadsheet imports of Korean text expect. null/undefined become empty cells.
export const csv = rows => '﻿' + rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';

// ItemList JSON-LD for a page that lists institutions: one shape for the hospital, condition and district pages.
// Summary-page form: each ListItem carries only position and url (the institution page holds the entity), so no
// registered name is repeated in raw JSON-LD and the list never reads as an endorsement of the names in it.
export const clinicItemList = (domain, route, name, clinics) => ({
  '@context': 'https://schema.org', '@type': 'ItemList', '@id': domain + route + '#list', name, numberOfItems: clinics.length,
  itemListElement: clinics.map((c, i) => ({ '@type': 'ListItem', position: i + 1, url: domain + clinicUrl(c) })),
});
