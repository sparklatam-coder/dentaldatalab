// Share cards: the 1200×630 image a page shows when its link is pasted into KakaoTalk, 문자, Facebook or X.
// Card text is derived from the same data as the page, so a card never shows a number the page does not.
// Images are rendered offline (scripts/render-share-cards.mjs needs a local Chrome); the build only copies them
// and warns when the stored card text no longer matches the current data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fmt} from '../src/shared.mjs';
import {REPORTS} from './report-pages.mjs';
import {CONDITIONS, conditionHubRoute} from './condition-pages.mjs';

const reportTitle = (item, g) => typeof item.title === 'function' ? item.title(g) : item.title;

// One headline figure per report, read from the aggregate the report itself prints.
const REPORT_FIGURES = {
  'national-data-coverage': g => ({figure: `${fmt(g.total)}곳`, label: '전국 치과병원·치과의원 등록 자료'}),
  'northern-gyeonggi-hours': g => ({figure: `${fmt(g.total)}곳`, label: '경기북부 10개 시·군 치과의 등록시간'}),
  'dental-hospitals': g => ({figure: `${fmt(g.total)}곳`, label: '전국 치과병원(종별코드 41) 전수 집계'}),
  'dental-hospital-vs-clinic': (g, reports) => {
    const copay = reports.externalFacts?.find(f => f.id === 'nhis-outpatient-copay')?.headline;
    return copay ? {figure: `${copay.dentalClinic} · ${copay.dentalHospital}`, label: '외래 본인부담률 · 치과의원과 치과병원(동 지역)'} : null;
  },
  'dental-hospital-districts': g => ({figure: `${fmt(g.withHospital)} / ${fmt(g.total)}`, label: '치과병원이 있는 시·군·구'}),
};

/** Every card the site uses. `routes` are exact routes; condition cards are also used by district condition pages. */
export function shareCards(reports) {
  const cards = [];
  for (const item of REPORTS) {
    const g = reports[item.group];
    const figure = REPORT_FIGURES[item.slug]?.(g, reports);
    if (!figure) continue;
    cards.push({file: `report-${item.slug}`, routes: [`/reports/${item.slug}/`], eyebrow: item.tag, title: reportTitle(item, g), ...figure, note: `심평원 ${reports.snapshotDate} 기준 · 출처와 집계 기준 공개`});
  }
  cards.push({file: 'conditions', routes: ['/conditions/'], eyebrow: '조건별 치과 · 시·군·구별 목록', title: '야간·토요일·일요일 진료,\n치과전문의 등록 치과 찾기', figure: '', label: '', note: `심평원 ${reports.snapshotDate} 등록 자료 기준 · 가나다순, 순위 없음`});
  for (const c of CONDITIONS) {
    cards.push({file: `condition-${c.slug}`, routes: [conditionHubRoute(c.slug)], eyebrow: '조건별 치과 · 시·군·구별 목록', title: `${c.name} 치과`, figure: '', label: `${c.definition.label} · 우리 동네 목록과 전화번호`, note: `심평원 ${reports.snapshotDate} 등록 자료 기준 · 가나다순, 순위 없음`});
  }
  return cards;
}

export const cardHash = card => crypto.createHash('sha256').update(JSON.stringify([card.eyebrow, card.title, card.figure, card.label, card.note])).digest('hex').slice(0, 16);

/** route → image path for cards whose PNG exists; pages without a card keep the brand image. */
export function shareCardRoutes(cards, ogDir) {
  const map = new Map();
  for (const card of cards) {
    if (!fs.existsSync(path.join(ogDir, card.file + '.png'))) continue;
    for (const route of card.routes) map.set(route, `/assets/og/${card.file}.png`);
  }
  return map;
}

/** Cards whose stored text differs from the current data (re-render with scripts/render-share-cards.mjs). */
export function staleShareCards(cards, ogDir) {
  const file = path.join(ogDir, 'manifest.json');
  const stored = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return cards.filter(card => fs.existsSync(path.join(ogDir, card.file + '.png')) && stored[card.file] !== cardHash(card)).map(card => card.file);
}

const escHtml = v => String(v ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

/** Self-contained 1200×630 HTML for one card, in the brand style of /assets/og-share.png. */
export function shareCardHtml(card) {
  const title = escHtml(card.title).replace(/\n/g, '<br>');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden}
body{background:#f7f6f0;color:#16302f;font-family:"Apple SD Gothic Neo","Pretendard","Noto Sans KR",sans-serif;padding:64px 80px;display:flex;flex-direction:column;word-break:keep-all}
.top{display:flex;align-items:center;gap:18px}.mark{width:64px;height:64px;border-radius:16px;background:#087969;display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:15px}.mark i{background:#fff;border-radius:4px}.mark i:nth-child(2){opacity:.5}
.brand{font-size:30px;font-weight:700;letter-spacing:-.5px}.eyebrow{margin-left:auto;font-size:22px;color:#087969;background:#e3efe9;border-radius:999px;padding:9px 20px;font-weight:600}
h1{margin-top:54px;font-size:${card.figure ? 58 : 72}px;line-height:1.22;letter-spacing:-1.5px;font-weight:800;max-width:1040px}
.figure{margin-top:28px;display:flex;align-items:baseline;gap:22px}.figure strong{font-size:84px;color:#087969;font-weight:800;letter-spacing:-2px;font-variant-numeric:tabular-nums}.figure span{font-size:26px;color:#3d5654}
.label{margin-top:26px;font-size:30px;color:#087969;font-weight:600}
.bottom{margin-top:auto;display:flex;justify-content:space-between;font-size:21px;color:#5b6f6d}
</style></head><body><div class="top"><div class="mark"><i></i><i></i><i></i><i></i></div><div class="brand">치과데이터랩</div><div class="eyebrow">${escHtml(card.eyebrow)}</div></div>
<h1>${title}</h1>${card.figure ? `<div class="figure"><strong>${escHtml(card.figure)}</strong><span>${escHtml(card.label)}</span></div>` : card.label ? `<div class="label">${escHtml(card.label)}</div>` : ''}
<div class="bottom"><span>${escHtml(card.note)}</span><span>dentaldatalab.com</span></div></body></html>`;
}
