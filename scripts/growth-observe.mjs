#!/usr/bin/env node
// Deterministic observer for the monthly growth ledger (docs/growth-monitor.md). No language model reads or judges a
// page: this script opens one fixed search URL at a time in the owner's Aside browser through the `aside` CLI, reads
// the page with a fixed in-page extractor, turns what it read into a ledger cell with the pure functions below and
// writes data/content/growth-observations/YYYY-MM.json after every cell. The sanitized evidence for each cell goes to
// data/research/growth-monitor/YYYY-MM/<engine>/<id>.txt (git-ignored) so a person can audit it.
//
// Browser safety rules, enforced in code:
// - Only the pages in ALLOWED_PAGES are ever opened, each in a tab this script opens and closes itself (try/finally).
//   It never lists or attaches to the owner's other tabs.
// - It never types, never logs in, never follows a result link and never clicks anything.
// - ChatGPT is only read in a temporary chat whose indicator is confirmed on the page; otherwise its cells stay null.
// - The evidence snapshot covers the page's main landmark only (no header with profile links, no footer). Lines that
//   contain an e-mail address, an account label or the browser's location are dropped from everything that is saved
//   or printed. The only account-related fact kept is whether the window was signed in (yes/no).
// - Requests to one site are sequential with a jittered 8–15 s gap, and one run opens at most RUN_PAGE_BUDGET pages on
//   a site; a captcha or a redirect off the allowed page stops that site for the run. Remaining cells stay null and
//   the next run resumes them.
// A cell that could not be read stays null. It is never written as "no answer", "not cited" or "not in the top 10".
//
// Usage:
//   node scripts/growth-observe.mjs --month YYYY-MM [--kind ai|name|gate] [--engine <id>] [--id <row>[,<row>…]]
//                                   [--limit N] [--redo] [--dry-run]
//     Open cells only, unless --redo. --limit caps the cells per engine. One cell again:
//       --engine googleAiOverview --id q05 --redo
//   node scripts/growth-observe.mjs --month YYYY-MM --is-complete     exit 0 when every cell is recorded, else 1
//   node scripts/growth-observe.mjs --month YYYY-MM --notification    one-line status for a desktop notification
// ASIDE_BIN overrides the `aside` executable. --definition, --dir and --evidence-dir override the default paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFINITION_FILE, NOT_IN_TOP10, OBSERVATION_DIR, ORIGIN, SITE_HOST, buildTemplate, isMonth, isMonthComplete, isOtherDomain,
  isSiteUrl, loadDefinition, observationProblems, summarizeMonth,
} from './growth-monitor.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOOL = 'scripts/growth-observe.mjs v1';
export const EVIDENCE_DIR = path.join(root, 'data/research/growth-monitor');
export const SENTINEL = '@@GROWTH-OBSERVE@@';
/** Gap between two requests to the same site, in milliseconds: a random value in this range. */
export const GAP_MS = Object.freeze([8000, 15000]);
/** An AI block with less body text than this is a heading without an answer. */
export const MIN_ANSWER_CHARS = 30;
/** An engine that shows no AI answer for this many cells in a row is reported as possibly stale. */
export const STALE_RUN = 10;
const FAILURES_BEFORE_STOP = 3;
/**
 * The most pages one run opens on a site. On 2026-11-26 Google answered the 42nd query of a single run (8–15 s apart,
 * signed-in window) with its unusual-traffic page, so a run stays well below that and the cells that are left wait for
 * the next run (the daily runner picks them up the next day). Sites without an entry have no limit.
 */
export const RUN_PAGE_BUDGET = Object.freeze({ google: 25 });
const RANKED_RESULTS = 10;

/** The only pages this tool may open. Origin and path must match exactly. */
export const ALLOWED_PAGES = Object.freeze([
  ['https://www.google.com', '/search'],
  ['https://search.naver.com', '/search.naver'],
  ['https://chatgpt.com', '/'],
  ['https://www.bing.com', '/search'],
]);

export function isAllowedUrl(value) {
  let url;
  try { url = new URL(value); } catch { return false; }
  return !url.username && !url.password && ALLOWED_PAGES.some(([origin, pathname]) => url.origin === origin && url.pathname === pathname);
}

const googleUrl = text => `https://www.google.com/search?hl=ko&gl=kr&pws=0&q=${encodeURIComponent(text)}`;
const naverUrl = text => `https://search.naver.com/search.naver?query=${encodeURIComponent(text)}`;
/** One entry per engine id of the definition: what it measures, which site it loads and the URL for a query. */
export const ENGINES = Object.freeze({
  chatgpt: { kind: 'ai', site: 'chatgpt', url: text => `https://chatgpt.com/?q=${encodeURIComponent(text)}&hints=search&temporary-chat=true` },
  googleAiOverview: { kind: 'ai', site: 'google', url: googleUrl },
  naverAiBriefing: { kind: 'ai', site: 'naver', url: naverUrl },
  google: { kind: 'name', site: 'google', url: googleUrl },
  naver: { kind: 'name', site: 'naver', url: naverUrl },
});
export const CHATGPT_PREFLIGHT_URL = 'https://chatgpt.com/?temporary-chat=true';
export const BING_ENGINE = 'bing';
export const BING_INPUT = 'bingSiteResults';
export const BING_SITE_URL = `https://www.bing.com/search?q=${encodeURIComponent('site:' + SITE_HOST)}&setlang=ko&cc=KR`;

// ---------------------------------------------------------------------------------------------------------------------
// In-page extractors. Each runs inside the result page (so it may only use page globals), is anchored on roles, visible
// headings and data attributes rather than generated class names, and returns plain data. None of them clicks, types or
// reads anything outside the result area; the only account-related thing that leaves the page is a signed-in boolean.
// `signature` is what the wait loop compares between polls, `pending` keeps it waiting and `stop` ends it at once.

/* eslint-disable no-undef */
const pageGoogle = () => {
  const text = el => (el ? (el.innerText || el.textContent || '') : '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,[role="heading"]')];
  const aiHeading = headings.find(h => /^AI (개요|Overview)$/.test(text(h))) || null;
  let region = aiHeading ? aiHeading.closest('section,[role="region"]') : null;
  if (aiHeading && !region) {
    // Fallback: the largest ancestor of the heading that holds no ordinary result title.
    region = aiHeading;
    while (region.parentElement && region.parentElement !== document.body && !region.parentElement.querySelector('a[href] h3')) region = region.parentElement;
  }
  const hidden = region ? (region.textContent || '').replace(/\s+/g, ' ') : '';
  const at = hidden.search(/치과데이터랩|dentaldatalab/i);
  const ai = region ? {
    text: text(region),
    hiddenMention: at < 0 ? null : hidden.slice(Math.max(0, at - 50), at + 70).trim(),
    links: [...region.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (text(a) || a.getAttribute('aria-label') || '').slice(0, 140) })),
  } : null;
  const results = document.querySelector('#rso') || document.querySelector('#search');
  const organic = results ? [...results.querySelectorAll('a[href]')]
    .filter(a => a.querySelector('h3') && !(region && region.contains(a)) && !a.closest('#tads,#tadsb,#bottomads,[data-text-ad]'))
    .map(a => ({ href: a.href, title: text(a.querySelector('h3')).slice(0, 160) })) : [];
  const signedOut = !!document.querySelector('a[href*="accounts.google.com/ServiceLogin"],a[href*="accounts.google.com/signin"],a[href*="accounts.google.com/v3/signin"]');
  const signedIn = !!document.querySelector('a[href*="accounts.google.com/SignOutOptions"]');
  const top = text(document.body).slice(0, 600);
  return {
    signature: [ai ? ai.text.length : -1, ai ? ai.links.length : -1, organic.length],
    pending: !!ai && ai.text.length < 80,
    stop: false,
    ai, organic,
    hasResults: !!results,
    signedIn: signedOut ? false : signedIn ? true : null,
    blocked: /\/sorry\//.test(location.pathname) || !!document.querySelector('#captcha-form,form[action*="/sorry"]') || /비정상적인 트래픽|unusual traffic/i.test(top) ? 'captcha' : null,
  };
};

const pageNaver = () => {
  const text = el => (el ? (el.innerText || el.textContent || '') : '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  const pack = document.querySelector('#main_pack');
  let block = pack ? pack.querySelector('[data-block-id^="ai-briefing"]') : null;
  if (pack && !block) block = [...pack.querySelectorAll('h1,h2,h3,[role="heading"]')].find(h => text(h) === 'AI 브리핑') || null;
  while (block && block.parentElement && block.parentElement !== pack) block = block.parentElement;
  const hidden = block ? (block.textContent || '').replace(/\s+/g, ' ') : '';
  const at = hidden.search(/치과데이터랩|dentaldatalab/i);
  const ai = block ? {
    text: text(block),
    hiddenMention: at < 0 ? null : hidden.slice(Math.max(0, at - 50), at + 70).trim(),
    links: [...block.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: (text(a) || a.getAttribute('aria-label') || '').slice(0, 140) })),
  } : null;
  // The integrated result stream: top-level "fsolid" blocks whose cards carry data-fender-root. Ads (a separate
  // section), the place pack, AI 브리핑 and the clip, image and related-search collections sit outside these blocks.
  const stream = pack ? [...pack.children].filter(el => /fsolid/.test(String(el.className || ''))) : [];
  let cards = stream.flatMap(el => [...el.querySelectorAll('[data-fender-root]')]);
  let cardRule = 'stream';
  if (!cards.length && pack) {
    cards = [...pack.querySelectorAll('[data-fender-root][data-meta-ssuid]')].filter(el => ['web', 'review', 'kin'].includes(el.getAttribute('data-meta-ssuid')));
    cardRule = 'fallback';
  }
  cards = cards.filter(card => !(card.parentElement && card.parentElement.closest('[data-fender-root]')) && !(block && (block === card || block.contains(card))));
  const organic = cards.map(card => {
    const anchors = [...card.querySelectorAll('a[href]')];
    return {
      type: card.getAttribute('data-meta-ssuid') || '',
      links: anchors.map(a => a.href).slice(0, 60),
      title: anchors.map(a => text(a).replace(/새 창 열림/g, '').trim()).filter(t => t.length >= 2 && !/^(Keep에 (저장|바로가기)|자세히 보기)$/.test(t)).slice(0, 4).join(' | ').slice(0, 260),
    };
  });
  // The header always holds both the login layer and the "my" layer and displays one of them. (Looking for a link
  // that says 로그인 is wrong: that link is in the page, hidden, while signed in.) Only the boolean leaves the page.
  const displayed = selector => { const el = document.querySelector(selector); return el ? getComputedStyle(el).display !== 'none' : null; };
  const myLayer = displayed('#gnb_my_layer');
  const loginLayer = displayed('#gnb_login_layer');
  const top = text(document.body).slice(0, 600);
  return {
    signature: [ai ? ai.text.length : -1, ai ? ai.links.length : -1, organic.length],
    pending: !!ai && ai.text.length < 80,
    stop: false,
    ai, organic, cardRule,
    hasResults: !!pack,
    signedIn: myLayer === true && loginLayer !== true ? true : loginLayer === true && myLayer !== true ? false : null,
    blocked: !pack && /자동입력 방지|비정상적인 (접근|검색)|captcha/i.test(top) ? 'captcha' : null,
  };
};

const pageChatgpt = () => {
  const text = el => (el ? (el.innerText || el.textContent || '') : '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  // Only <main> and dialogs are read. The sidebar (chat history, profile) is never touched.
  const main = document.querySelector('main');
  const controls = [...document.querySelectorAll('button,a')];
  const temporaryOn = controls.some(el => /임시 채팅 끄기|Turn off temporary chat/i.test(el.getAttribute('aria-label') || ''));
  const loginWall = controls.some(el => /^(로그인|Log in|회원가입|무료로 회원 가입|Sign up|Sign up for free)$/.test(text(el)));
  const dialogEl = document.querySelector('[role="dialog"],[role="alertdialog"]');
  const dialog = dialogEl ? (/임시 채팅|Temporary chat/i.test(text(dialogEl)) ? 'temporary-chat-notice' : 'other') : null;
  const turns = main ? [...main.querySelectorAll('[data-message-author-role]')] : [];
  const assistant = turns.filter(t => t.getAttribute('data-message-author-role') === 'assistant');
  const last = assistant[assistant.length - 1] || null;
  const turn = last ? (last.closest('article') || last) : null;
  const asked = turns.some(t => t.getAttribute('data-message-author-role') === 'user');
  const streaming = !!document.querySelector('[data-testid="stop-button"],button[aria-label*="스트리밍 중지"],button[aria-label*="Stop streaming"]');
  const composer = document.querySelector('#prompt-textarea');
  const conversationPath = location.pathname !== '/';
  const challenge = /Just a moment|사람인지 확인|Verify you are human/i.test(document.title);
  const answerText = last ? text(last) : '';
  return {
    signature: [answerText.length, turn ? turn.querySelectorAll('a[href]').length : -1, streaming, asked],
    pending: streaming || (asked && !last) || (!!last && answerText.length < 40),
    // A dialog, a challenge or a conversation address ends the visit at once; a missing temporary-chat indicator or a
    // login control only after the page has had its minimum time to load.
    stop: !!dialog || conversationPath || challenge,
    giveUp: !temporaryOn || loginWall,
    temporaryOn, loginWall, dialog, conversationPath, challenge, streaming, asked,
    promptWaiting: !!composer && text(composer).length > 0 && !asked,
    signedIn: loginWall ? false : true,
    answer: last ? { text: answerText, hiddenMention: null, links: [...turn.querySelectorAll('a[href]')].map(a => ({ href: a.href, text: text(a).slice(0, 140) })) } : null,
    blocked: null,
  };
};

const pageBing = () => {
  const text = el => (el ? (el.innerText || el.textContent || '') : '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
  const count = document.querySelector('.sb_count');
  const items = [...document.querySelectorAll('#b_results > li.b_algo')].map(li => ({ cite: text(li.querySelector('cite')).slice(0, 200), title: text(li.querySelector('h2')).slice(0, 160) }));
  const noResults = !!document.querySelector('#b_results .b_no');
  return {
    signature: [count ? text(count) : '', items.length, noResults],
    pending: !count && !items.length && !noResults,
    stop: false,
    countText: count ? text(count).slice(0, 80) : null,
    items, noResults,
    hasResults: !!document.querySelector('#b_results'),
    signedIn: null,
    blocked: /captcha|사람인지 확인/i.test(document.title) ? 'captcha' : null,
  };
};
/* eslint-enable no-undef */

// The evidence snapshot is only ever taken of the page's main landmark. The header (profile, mail and notification
// links of a signed-in window), the sidebar and the footer (the located district) are never captured.
const MAIN_LANDMARK = 'main, [role="main"]';

/**
 * How each site is read: the extractor, how long to wait for it to settle and which part to snapshot as evidence.
 * An AI block can arrive seconds after the result list, so a page read for its AI answer waits longer (aiMinMs) before
 * "no AI block" is believed. Every budget stays well under the 120 s limit of one `aside repl` call.
 */
export const SITES = Object.freeze({
  google: { extractor: pageGoogle, minMs: 4500, aiMinMs: 9000, maxMs: 24000, pollMs: 1500, settle: 2, selector: MAIN_LANDMARK },
  naver: { extractor: pageNaver, minMs: 3500, aiMinMs: 7500, maxMs: 20000, pollMs: 1500, settle: 2, selector: MAIN_LANDMARK },
  chatgpt: { extractor: pageChatgpt, minMs: 12000, aiMinMs: 12000, maxMs: 95000, pollMs: 2500, settle: 3, selector: 'main' },
  bing: { extractor: pageBing, minMs: 3500, aiMinMs: 3500, maxMs: 12000, pollMs: 1500, settle: 2, selector: MAIN_LANDMARK },
});

/**
 * The script one `aside repl` call runs: open one allowed URL, wait until the extractor's signature stops changing,
 * take a snapshot for the evidence file, close the tab in `finally` and print one sentinel line of JSON.
 * The allowlist is checked here, again inside the script and once more on the URL the tab ended up on.
 */
export function buildPageScript(url, site, { preflight = false, kind = null } = {}) {
  if (!isAllowedUrl(url)) throw new Error('Refusing to open a page outside the allowlist');
  const spec = SITES[site];
  if (!spec) throw new Error('No extractor for site ' + site);
  const minMs = preflight ? 6000 : kind === 'ai' ? spec.aiMinMs : spec.minMs;
  const maxMs = preflight ? 15000 : spec.maxMs;
  return `await (async () => {
  const url = ${JSON.stringify(url)};
  const allowed = ${JSON.stringify(ALLOWED_PAGES)};
  const isAllowed = value => {
    try { const u = new URL(value); return allowed.some(([origin, pathname]) => u.origin === origin && u.pathname === pathname); } catch { return false; }
  };
  if (!isAllowed(url)) throw new Error('URL outside the allowlist');
  const extract = ${spec.extractor.toString()};
  const where = tab => { try { const u = new URL(tab.url()); return u.origin + u.pathname.split('/').slice(0, 2).join('/'); } catch { return null; } };
  const out = { finalAllowed: false, finalPage: null, data: null, tree: null, polls: 0, settled: false, elapsedMs: 0 };
  const tab = await openTab(url);
  try {
    const started = Date.now();
    out.finalPage = where(tab);
    out.finalAllowed = isAllowed(tab.url());
    let last = null;
    let stable = 0;
    while (out.finalAllowed && Date.now() - started < ${maxMs}) {
      await sleep(${spec.pollMs});
      out.finalPage = where(tab);
      out.finalAllowed = isAllowed(tab.url());
      if (!out.finalAllowed) break;
      out.data = await tab.evaluate(extract);
      out.polls += 1;
      const now = JSON.stringify(out.data.signature);
      stable = now === last ? stable + 1 : 0;
      last = now;
      out.settled = stable >= ${spec.settle} && !out.data.pending;
      if (out.data.stop || out.data.blocked) break;
      if (Date.now() - started >= ${minMs} && (out.settled || out.data.giveUp)) break;
    }
    if (out.finalAllowed) {
      // Never the whole page: when the main landmark cannot be found there is no snapshot at all.
      try { out.tree = (await snapshot(tab, { selector: ${JSON.stringify(spec.selector)} })).tree; } catch (error) { out.tree = null; }
    }
    out.elapsedMs = Date.now() - started;
  } finally {
    await closeTab(tab);
  }
  console.log(${JSON.stringify(SENTINEL)} + JSON.stringify(out));
})();
`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Pure parsing and cell building.

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const ACCOUNT_LABEL = /계정|accounts?\b|내정보 보기|내 프로필/i;
const LOCATION_LABEL = /정확한 위치 사용|위치 정보가 사용되는 방식|이전 활동 기준|IP 주소 기반|위치 업데이트/;
const SITE_NAME = /치과데이터랩|dentaldatalab/i;

/**
 * Drops every line that holds an e-mail address, an account label ("Google 계정: …", Naver's "<id> 내정보 보기") or
 * the browser's location.
 * Google prints the district it located the browser in as a bare heading right above its location controls, so the
 * line before "정확한 위치 사용" goes too. Everything that is saved or printed passes through here.
 */
export function sanitizeText(text) {
  const lines = String(text ?? '').split('\n');
  const drop = lines.map(line => EMAIL.test(line) || ACCOUNT_LABEL.test(line) || LOCATION_LABEL.test(line));
  lines.forEach((line, i) => { if (i > 0 && /정확한 위치 사용/.test(line)) drop[i - 1] = true; });
  return lines.filter((_, i) => !drop[i]).join('\n');
}

const compact = text => String(text ?? '').replace(/\s+/g, ' ').trim();
const distinct = values => [...new Set(values)];

/** The page a result link leads to, as a URL: http(s) only, with Google's /url?q= wrapper removed. */
export function targetOf(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (/(^|\.)google\.(?:com|co\.[a-z]{2}|[a-z]{2})$/.test(url.hostname) && url.pathname === '/url') {
    try { return new URL(url.searchParams.get('q') ?? url.searchParams.get('url') ?? ''); } catch { return null; }
  }
  return url;
}

const isSiteHost = host => host === SITE_HOST || host === 'www.' + SITE_HOST;

/** A link to this site in the ledger's form (https, bare host, no query or fragment), or null for any other link. */
export function canonicalSiteUrl(href) {
  const url = targetOf(href);
  if (!url || !isSiteHost(url.hostname.toLowerCase())) return null;
  const value = ORIGIN + url.pathname;
  return isSiteUrl(value) ? value : null;
}

// Links that belong to the engine's own interface (help, policy, search-again, login) are not cited sources.
const OWN_HOST = {
  google: host => /(^|\.)google\.(?:com|co\.[a-z]{2}|[a-z]{2})$/.test(host) || /(^|\.)(?:gstatic\.com|googleusercontent\.com|googleadservices\.com|g\.co|goo\.gl)$/.test(host),
  naver: host => host === 'naver.com' || /^(?:m\.)?(?:search|keep|help|ader|adcr|nid|policy)\.naver\.com$/.test(host) || /(^|\.)(?:pstatic\.net|naver\.net)$/.test(host),
  chatgpt: host => /(^|\.)(?:chatgpt\.com|openai\.com|oaiusercontent\.com)$/.test(host),
  bing: host => /(^|\.)(?:bing\.com|microsoft\.com|msn\.com)$/.test(host),
};

/** The hostname of another cited source (lowercase, no www.), or null for this site, the engine itself or a non-link. */
export function sourceDomain(href, site) {
  const url = targetOf(href);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (isSiteHost(host) || host.endsWith('.' + SITE_HOST) || OWN_HOST[site]?.(host)) return null;
  return isOtherDomain(host) ? host : null;
}

const mentionOf = block => {
  const visible = compact(block.text);
  const at = visible.search(SITE_NAME);
  const excerpt = at >= 0 ? visible.slice(Math.max(0, at - 50), at + 70).trim() : compact(block.hiddenMention) || null;
  if (excerpt === null) return null;
  return EMAIL.test(excerpt) || ACCOUNT_LABEL.test(excerpt) ? '(발췌 생략)' : excerpt;
};

/**
 * An AI cell from the AI block the extractor found: {text, links: [{href}], hiddenMention} or null when the page showed
 * no such block. cited is true when one of the block's links leads to this site, or the block names 치과데이터랩 /
 * dentaldatalab without a link (then the note quotes the mention).
 */
export function buildAiCell(block, site) {
  const body = block ? compact(block.text).replace(/^AI (?:개요|브리핑|Overview)\s*/, '') : '';
  if (!block || body.length < MIN_ANSWER_CHARS) {
    return { answerShown: false, cited: false, citedUrls: [], otherDomains: [], note: block ? 'AI 답 영역의 제목만 있고 본문은 표시되지 않았습니다.' : null };
  }
  const hrefs = (block.links ?? []).map(link => link.href);
  const citedUrls = distinct(hrefs.map(canonicalSiteUrl).filter(Boolean));
  const otherDomains = distinct(hrefs.map(href => sourceDomain(href, site)).filter(Boolean));
  if (citedUrls.length) return { answerShown: true, cited: true, citedUrls, otherDomains, note: null };
  if (hrefs.some(href => isSiteHost(targetOf(href)?.hostname.toLowerCase() ?? ''))) return { answerShown: true, cited: true, citedUrls, otherDomains, note: '이 사이트로 가는 링크가 있었지만 주소를 기록 형식으로 바꾸지 못했습니다.' };
  const named = mentionOf(block);
  return { answerShown: true, cited: named !== null, citedUrls, otherDomains, note: named === null ? null : `링크 없이 이름으로 언급: “${named}”` };
}

/**
 * A name-search cell from the result list in display order ([{links: [href, …]}]): the position of the first of the
 * first ten results that links to this site, else not_in_top10. An empty list is not an observation, so it gives null.
 */
export function buildNameCell(results) {
  if (!Array.isArray(results) || !results.length) return null;
  const top = results.slice(0, RANKED_RESULTS);
  for (let i = 0; i < top.length; i++) {
    const url = (top[i].links ?? []).map(canonicalSiteUrl).find(Boolean);
    if (url) return { rank: i + 1, url };
  }
  return { rank: NOT_IN_TOP10, url: null };
}

/** The one number in a result-count label such as "1결과", "결과 약 1,230개" or "1-10 of 1,230 results"; else null. */
export function parseResultCount(text) {
  if (typeof text !== 'string') return null;
  const of = text.match(/\bof\s+(\d{1,3}(?:,\d{3})+|\d+)/i);
  const numbers = of ? [of[1]] : text.match(/\d{1,3}(?:,\d{3})+|\d+/g) ?? [];
  if (numbers.length !== 1) return null;
  const value = Number(numbers[0].replaceAll(',', ''));
  return Number.isSafeInteger(value) ? value : null;
}

const citeHost = cite => {
  const first = compact(cite).split(/[\s›>]/)[0];
  try { return new URL(/^https?:\/\//.test(first) ? first : 'https://' + first).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
};

/**
 * Bing's count for site:dentaldatalab.com, or null when it cannot be read reliably: the count label must hold exactly
 * one number, and a count of one or more must come with at least one listed result of this site. An explicit
 * no-results page is 0.
 */
export function readBingSiteCount(data) {
  if (!data || data.blocked || !data.hasResults) return null;
  const ours = (data.items ?? []).filter(item => citeHost(item.cite) === SITE_HOST).length;
  if (data.noResults && !(data.items ?? []).length) return 0;
  const count = parseResultCount(data.countText);
  if (count === null || count < ours || (count > 0 && ours === 0)) return null;
  return count;
}

const SIGNED = { true: '로그인 상태', false: '로그인 안 한 상태', null: '로그인 여부 확인 못 함' };
/** The conditions line stored once per engine. It states only what the tool did and what it saw on the page. */
export function conditionText(engine, signedIn = null) {
  const signed = SIGNED[String(signedIn ?? null)];
  const lines = {
    chatgpt: `자동 관찰 · Aside 브라우저 일반 창 · ChatGPT ${signed} · 임시 채팅(기록에 남지 않음, 메모리와 사용자 지정 지침은 참조될 수 있음) · 웹 검색 힌트(hints=search) · 질문 1회 · 클릭 없음`,
    googleAiOverview: `자동 관찰 · Aside 브라우저 일반 창 · Google ${signed} · www.google.com/search?hl=ko&gl=kr&pws=0 첫 페이지 · 'AI 개요' 영역의 링크(접힌 출처 포함) · 클릭 없음`,
    naverAiBriefing: `자동 관찰 · Aside 브라우저 일반 창 · 네이버 ${signed} · search.naver.com/search.naver 통합검색 첫 페이지 · 'AI 브리핑' 영역의 링크 · 클릭 없음`,
    google: `자동 관찰 · Aside 브라우저 일반 창 · Google ${signed} · www.google.com/search?hl=ko&gl=kr&pws=0 첫 페이지만 · 제목 링크가 있는 일반 결과 위에서부터 최대 10개(광고·AI 개요·지도 묶음·관련 질문 제외, 2페이지는 열지 않음)`,
    naver: `자동 관찰 · Aside 브라우저 일반 창 · 네이버 ${signed} · search.naver.com/search.naver 통합검색 첫 페이지 · 본문 결과 카드(웹·블로그·카페·지식iN) 위에서부터 10개(파워링크 광고·플레이스·AI 브리핑·이미지·클립 묶음 제외)`,
  };
  return lines[engine] ?? null;
}

/** Why a loaded page must not be read as an observation ({reason, stop}), or null when it can be. */
export function pageProblem(page) {
  if (!page || page.asideError) return { reason: 'aside 실행 실패' + (page?.asideError ? `: ${page.asideError}` : ''), stop: false, aside: true };
  if (!page.finalAllowed) return { reason: `허용한 페이지 밖으로 이동함(${page.finalPage ?? '주소 확인 못 함'})`, stop: true };
  if (!page.data) return { reason: '페이지 내용을 읽지 못함', stop: false };
  if (page.data.blocked) return { reason: `차단 화면(${page.data.blocked})`, stop: true };
  return null;
}

/** A Google or Naver result page → {cell} or {failure}. A page with neither an AI block nor a result list is not read. */
export function readSearchPage(task, page) {
  const failure = pageProblem(page);
  if (failure) return { failure };
  const data = page.data;
  const organic = (data.organic ?? []).map(result => ({ ...result, links: result.links ?? [result.href] }));
  if (!data.hasResults || (!organic.length && !(task.kind === 'ai' && data.ai))) return { failure: { reason: '결과 목록을 찾지 못함(페이지 구조가 바뀌었을 수 있음)', stop: false } };
  return task.kind === 'name' ? { cell: buildNameCell(organic), organicCount: organic.length } : { cell: buildAiCell(data.ai, task.site) };
}

/**
 * A ChatGPT page → {ok} for the preflight, {cell} for an answered question, or {failure}. Anything that leaves
 * temporary-chat mode unconfirmed, or that would need a click to continue, blocks the engine for the run.
 */
export function readChatgptPage(page, { preflight = false } = {}) {
  const failure = pageProblem(page);
  if (failure) return { failure: failure.stop ? { ...failure, blocked: true } : failure };
  const data = page.data;
  const block = reason => ({ failure: { reason, stop: true, blocked: true } });
  if (data.conversationPath) return block('임시 채팅 주소가 아닌 대화 주소로 바뀌어 즉시 중단함');
  if (data.challenge) return block('사람 확인(캡차) 화면');
  if (data.loginWall) return block('로그인 화면이거나 로그아웃 상태');
  if (!data.temporaryOn) return block('임시 채팅 표시를 확인하지 못함');
  if (data.dialog) return block(`${data.dialog === 'temporary-chat-notice' ? '임시 채팅 안내 창' : '안내 창'}이 떠 있어 질문이 전송되지 않음(닫으려면 클릭이 필요해 자동 실행은 누르지 않음)`);
  if (preflight) return { ok: true };
  if (!data.answer) return block(data.promptWaiting ? '질문이 입력창에 채워지기만 하고 전송되지 않음(전송하려면 클릭이 필요해 중단)' : '답이 나타나지 않음');
  if (data.streaming || !page.settled) return { failure: { reason: '답이 제한 시간 안에 끝나지 않음', stop: false } };
  return { cell: buildAiCell(data.answer, 'chatgpt') };
}

/** The Bing site: page → {value} or {failure}. */
export function readBingPage(page) {
  const failure = pageProblem(page);
  if (failure) return { failure };
  const value = readBingSiteCount(page.data);
  return value === null ? { failure: { reason: '결과 수를 믿을 만하게 읽지 못함', stop: false } } : { value };
}

const numbered = (items, line) => (items.length ? items.map((item, i) => `${String(i + 1).padStart(2, ' ')}. ${line(item)}`).join('\n') : '(없음)');

/** The audit record of one query, already sanitized. */
export function evidenceText({ task, observedAt, page, outcome }) {
  const data = page?.data ?? {};
  const block = data.ai ?? data.answer ?? null;
  const parts = [
    '# growth-observe evidence',
    `tool: ${TOOL}`,
    `engine: ${task.engine}`,
    `id: ${task.id}`,
    `query: ${task.query}`,
    `url: ${task.url}`,
    `observedAt: ${observedAt}`,
    `finalPage: ${page?.finalPage ?? 'unknown'} (allowed: ${page?.finalAllowed === true})`,
    `signedIn: ${data.signedIn ?? 'unknown'}`,
    `waited: ${page?.elapsedMs ?? 'unknown'} ms, ${page?.polls ?? 0} polls, settled: ${page?.settled === true}`,
    outcome.failure ? `result: NOT RECORDED — ${outcome.failure.reason}` : `result: recorded`,
    `recorded: ${JSON.stringify(outcome.cell ?? outcome.value ?? null)}`,
  ];
  if (task.site === 'chatgpt') parts.push(`temporaryChatConfirmed: ${data.temporaryOn === true}`, `dialog: ${data.dialog ?? 'none'}`, `loginWall: ${data.loginWall === true}`, `promptSubmitted: ${data.asked === true}`);
  if (task.site === 'bing') parts.push(`countLabel: ${data.countText ?? '(없음)'}`, `noResultsNotice: ${data.noResults === true}`, '', `## Listed results (${(data.items ?? []).length})`, numbered(data.items ?? [], item => `${item.title} — ${item.cite}`));
  if (task.kind === 'ai') {
    parts.push('', `## AI block (${block ? 'found' : 'not found'})`, block ? block.text : '(없음)');
    parts.push('', `## AI block links (${block ? block.links.length : 0})`, numbered(block ? block.links : [], link => `${compact(link.text) || '(텍스트 없음)'} — ${link.href}`));
  }
  if (task.site === 'google' || task.site === 'naver') {
    const organic = data.organic ?? [];
    parts.push('', `## Result list in display order (${organic.length}; the first ${RANKED_RESULTS} are ranked${data.cardRule ? `; rule: ${data.cardRule}` : ''})`);
    // A Naver card holds several links; the audit line shows the first one that is not part of Naver's own interface.
    const shown = result => result.href ?? (result.links ?? []).find(href => canonicalSiteUrl(href) || sourceDomain(href, task.site)) ?? '(외부 링크 없음)';
    parts.push(numbered(organic, result => `${result.type ? `[${result.type}] ` : ''}${compact(result.title) || '(제목 없음)'} — ${shown(result)}`));
  }
  parts.push('', '## Page snapshot (accessibility tree of the main landmark only; the browser tool cuts it at 16 KiB)', page?.tree ?? '(없음)');
  return sanitizeText(parts.join('\n')) + '\n';
}

// ---------------------------------------------------------------------------------------------------------------------
// Planning and the run loop.

const engineIdsOf = def => [...def.engines.aiCitation, ...def.engines.nameSearch].map(engine => engine.id);
const cellsOf = (obs, engine) => [...obs.aiCitations, ...obs.nameSearch].filter(row => Object.hasOwn(row.cells, engine)).map(row => row.cells[engine]);

/**
 * The cells to observe, in ledger order. A recorded cell is skipped unless `redo`; `limit` caps the cells per engine.
 * `kinds` picks ai, name and/or gate (the Bing site: count), `engines` narrows to the listed engine ids and `ids` to
 * the listed rows (q05, c-…), which is how one cell is observed again.
 */
export function planTasks(def, obs, { kinds = ['ai', 'name', 'gate'], engines = null, ids = null, limit = null, redo = false } = {}) {
  const tasks = [];
  const taken = new Map();
  const wanted = id => engines === null || engines.includes(id);
  if (ids !== null) {
    const known = new Set([...obs.aiCitations, ...obs.nameSearch].map(row => row.id));
    const unknown = ids.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`No such row in the month file: ${unknown.join(', ')}`);
  }
  const add = task => {
    const count = taken.get(task.engine) ?? 0;
    if (limit !== null && count >= limit) return;
    if (!isAllowedUrl(task.url)) throw new Error(`Refusing to plan a page outside the allowlist for ${task.engine}`);
    taken.set(task.engine, count + 1);
    tasks.push(task);
  };
  const rows = (kind, list, group, textKey) => {
    if (!kinds.includes(kind)) return;
    for (const row of list) for (const engine of def.engines[group]) {
      if (!wanted(engine.id) || (ids !== null && !ids.includes(row.id)) || (row.cells[engine.id] !== null && !redo)) continue;
      const spec = ENGINES[engine.id];
      if (!spec || spec.kind !== kind) throw new Error(`No extractor for engine ${engine.id}`);
      add({ kind, engine: engine.id, site: spec.site, id: row.id, query: row[textKey], url: spec.url(row[textKey]) });
    }
  };
  rows('ai', obs.aiCitations, 'aiCitation', 'question');
  rows('name', obs.nameSearch, 'nameSearch', 'name');
  if (kinds.includes('gate') && ids === null && wanted(BING_ENGINE) && Object.hasOwn(obs.gateInputs, BING_INPUT) && (obs.gateInputs[BING_INPUT] === null || redo)) {
    add({ kind: 'gate', engine: BING_ENGINE, site: 'bing', id: 'site', query: 'site:' + SITE_HOST, url: BING_SITE_URL });
  }
  return tasks;
}

/** Engines the options select, whether or not any of their cells are still open. */
export function selectedEngines(def, { kinds = ['ai', 'name', 'gate'], engines = null } = {}) {
  const ids = [...(kinds.includes('ai') ? def.engines.aiCitation : []), ...(kinds.includes('name') ? def.engines.nameSearch : [])].map(engine => engine.id);
  return ids.filter(id => engines === null || engines.includes(id));
}

/**
 * File-level warnings after a run. An engine whose AI cells all show no answer (ten or more in this run, or ten or
 * more in the whole file) is flagged instead of silently standing as "no AI answers"; so is a name search that parsed
 * fewer than five results per query on average.
 */
export function runWarnings(def, obs, previous, { recorded = new Map(), organicCounts = new Map(), conditionChanges = new Set() } = {}) {
  const warnings = [];
  const kept = (code, engine) => previous.find(warning => warning.code === code && warning.engine === engine) ?? null;
  for (const engine of def.engines.aiCitation) {
    const inRun = recorded.get(engine.id) ?? [];
    const inFile = cellsOf(obs, engine.id).filter(cell => cell !== null);
    const silent = cells => cells.length >= STALE_RUN && cells.every(cell => !cell.answerShown);
    if (silent(inRun) || silent(inFile)) {
      const n = silent(inRun) ? inRun.length : inFile.length;
      warnings.push({ code: 'extractor_may_be_stale', engine: engine.id, message: `측정한 ${n}칸 모두 AI 답이 없다고 기록됐습니다. 추출 규칙이 낡았을 수 있습니다(extractor may be stale). 증거 파일과 실제 화면을 비교하세요.` });
    } else if (!inRun.length && kept('extractor_may_be_stale', engine.id)) warnings.push(kept('extractor_may_be_stale', engine.id));
  }
  for (const engine of def.engines.nameSearch) {
    const counts = organicCounts.get(engine.id) ?? [];
    const average = counts.length ? counts.reduce((sum, n) => sum + n, 0) / counts.length : null;
    if (counts.length >= STALE_RUN && average < 5) {
      warnings.push({ code: 'few_results_parsed', engine: engine.id, message: `검색 ${counts.length}건에서 읽은 결과가 평균 ${average.toFixed(1)}개뿐입니다. 추출 규칙이 낡았을 수 있습니다(extractor may be stale). 증거 파일과 실제 화면을 비교하세요.` });
    } else if (!counts.length && kept('few_results_parsed', engine.id)) warnings.push(kept('few_results_parsed', engine.id));
  }
  for (const id of engineIdsOf(def)) {
    const before = kept('conditions_changed', id);
    if (conditionChanges.has(id)) warnings.push({ code: 'conditions_changed', engine: id, message: '이번 실행의 로그인 상태가 conditions 에 적힌 것과 달랐습니다. 이 달의 칸에 서로 다른 조건이 섞여 있습니다.' });
    else if (before) warnings.push(before);
  }
  return warnings;
}

const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const comparable = obs => JSON.stringify({ ...obs, run: obs.run ? { ...obs.run, lastRunAt: null } : null });

/**
 * Runs the planned observations against `deps.openPage` and returns {obs, changed, report}. `deps`:
 *   openPage(url, site, {preflight}) → the object the page script printed, or {asideError}
 *   sleep(ms), random() in [0, 1), now() → Date, save(obs), saveEvidence(relativePath, text), log(line)
 * The month file is saved after every recorded cell; nothing is saved when a run changes nothing but its time.
 * `pageBudget` ({site: pages}) caps the pages one run opens per site; cells beyond it stay null for the next run.
 */
export async function observe({ def, obs: initial, kinds = ['ai', 'name', 'gate'], engines = null, ids = null, limit = null, redo = false, pageBudget = RUN_PAGE_BUDGET }, deps) {
  const { openPage, sleep, random = Math.random, now = () => new Date(), save, saveEvidence = () => {}, log = () => {} } = deps;
  const obs = structuredClone(initial);
  const before = comparable(obs);
  const options = { kinds, engines, ids, limit, redo };
  const tasks = planTasks(def, obs, options);
  const selected = selectedEngines(def, options);
  const month = obs.month;
  const today = localDate(now());
  if (tasks.length && today.slice(0, 7) !== month) throw new Error(`Observations can only be recorded during their own month: today is ${today}, the file is ${month}`);

  const readyAt = new Map();
  const opened = new Map();
  const stoppedSites = new Map();
  const stoppedEngines = new Map();
  const blockedEngines = new Map();
  const failures = new Map();
  const lastFailure = new Map();
  const recorded = new Map();
  const organicCounts = new Map();
  const conditionChanges = new Set();
  let asideFailures = 0;
  let aborted = null;
  let chatgptChecked = false;
  let done = 0;

  const visit = async (url, site, extra = {}) => {
    if (!isAllowedUrl(url)) throw new Error('Refusing to open a page outside the allowlist');
    const wait = (readyAt.get(site) ?? 0) - now().getTime();
    if (wait > 0) await sleep(wait);
    let page;
    opened.set(site, (opened.get(site) ?? 0) + 1);
    try { page = await openPage(url, site, extra); } catch (error) { page = { asideError: sanitizeText(String(error?.message ?? error)).split('\n')[0].slice(0, 200) }; }
    readyAt.set(site, now().getTime() + GAP_MS[0] + Math.floor(random() * (GAP_MS[1] - GAP_MS[0] + 1)));
    return page;
  };
  const persist = () => {
    const problems = observationProblems(obs, def, { month });
    if (problems.length) throw new Error(`Refusing to write an invalid month file:\n- ${problems.join('\n- ')}`);
    save(obs);
  };
  const stamp = (engine, signedIn) => {
    if (obs.observedOn === null) obs.observedOn = today;
    if (obs.observer === null) obs.observer = `자동 관찰 · ${TOOL} (Aside 브라우저)`;
    const text = conditionText(engine, signedIn);
    if (text === null) return;
    if (obs.conditions[engine] === null) obs.conditions[engine] = text;
    else if (obs.conditions[engine].startsWith('자동 관찰') && obs.conditions[engine] !== text) conditionChanges.add(engine);
  };
  const fail = (task, failure) => {
    lastFailure.set(task.engine, failure.reason);
    if (failure.aside) {
      asideFailures += 1;
      if (asideFailures >= FAILURES_BEFORE_STOP || /ENOENT/.test(failure.reason)) aborted = failure.reason;
    }
    if (failure.blocked) blockedEngines.set(task.engine, failure.reason);
    else if (failure.stop) stoppedSites.set(task.site, failure.reason);
    else {
      failures.set(task.engine, (failures.get(task.engine) ?? 0) + 1);
      if (failures.get(task.engine) >= FAILURES_BEFORE_STOP) stoppedEngines.set(task.engine, `연속 ${FAILURES_BEFORE_STOP}회 실패 · ${failure.reason}`);
    }
  };

  const spent = site => Number.isInteger(pageBudget?.[site]) && (opened.get(site) ?? 0) >= pageBudget[site];
  const open = task => !blockedEngines.has(task.engine) && !stoppedEngines.has(task.engine) && !stoppedSites.has(task.site) && !spent(task.site);
  const pending = [...tasks];
  while (!aborted) {
    const candidates = pending.filter(open);
    if (!candidates.length) break;
    const task = candidates.reduce((best, candidate) => ((readyAt.get(candidate.site) ?? 0) < (readyAt.get(best.site) ?? 0) ? candidate : best));
    pending.splice(pending.indexOf(task), 1);

    if (task.site === 'chatgpt' && !chatgptChecked) {
      // Nothing is asked until a prompt-free page has confirmed temporary-chat mode. Any failure here, even a
      // technical one, leaves the engine blocked for the whole run.
      const check = await visit(CHATGPT_PREFLIGHT_URL, 'chatgpt', { preflight: true });
      const result = readChatgptPage(check, { preflight: true });
      saveEvidence(path.join(month, task.engine, 'preflight.txt'), evidenceText({ task: { ...task, id: 'preflight', query: '(질문 없음)', url: CHATGPT_PREFLIGHT_URL, kind: 'preflight' }, observedAt: now().toISOString(), page: check, outcome: result.failure ? result : { cell: null } }));
      if (result.failure) {
        fail(task, { ...result.failure, blocked: true });
        log(`${task.engine} 사전 확인 실패 → ${result.failure.reason}`);
        continue;
      }
      chatgptChecked = true;
    }

    const page = await visit(task.url, task.site, { kind: task.kind });
    const outcome = task.kind === 'gate' ? readBingPage(page) : task.site === 'chatgpt' ? readChatgptPage(page) : readSearchPage(task, page);
    if (!outcome.failure && task.kind !== 'gate' && outcome.cell === null) outcome.failure = { reason: '결과 목록이 비어 있음', stop: false };
    done += 1;
    saveEvidence(path.join(month, task.engine, `${task.id}.txt`), evidenceText({ task, observedAt: now().toISOString(), page, outcome }));
    if (outcome.failure) {
      fail(task, outcome.failure);
      log(`[${done}/${tasks.length}] ${task.engine} ${task.id} → 기록 안 함: ${outcome.failure.reason}`);
      continue;
    }
    failures.set(task.engine, 0);
    asideFailures = 0;
    if (task.kind === 'gate') {
      obs.gateInputs[BING_INPUT] = outcome.value;
      stamp(task.engine, null);
      log(`[${done}/${tasks.length}] ${task.engine} ${task.id} → ${BING_INPUT} ${outcome.value}`);
    } else {
      if (EMAIL.test(JSON.stringify(outcome.cell))) throw new Error(`A cell for ${task.engine} ${task.id} held an e-mail address; nothing was written`);
      const row = (task.kind === 'ai' ? obs.aiCitations : obs.nameSearch).find(entry => entry.id === task.id);
      row.cells[task.engine] = outcome.cell;
      stamp(task.engine, page.data.signedIn ?? null);
      recorded.set(task.engine, [...(recorded.get(task.engine) ?? []), outcome.cell]);
      if (task.kind === 'name') organicCounts.set(task.engine, [...(organicCounts.get(task.engine) ?? []), outcome.organicCount]);
      log(`[${done}/${tasks.length}] ${task.engine} ${task.id} → ${task.kind === 'ai'
        ? `답 ${outcome.cell.answerShown ? '표시' : '없음'} · 인용 ${outcome.cell.cited ? '예' : '아니오'} · 다른 도메인 ${outcome.cell.otherDomains.length}`
        : `순위 ${outcome.cell.rank === NOT_IN_TOP10 ? '10위 밖' : outcome.cell.rank} (결과 ${outcome.organicCount}개)`}`);
    }
    persist();
  }

  const previous = obs.run ?? null;
  const engineStatus = {};
  for (const id of engineIdsOf(def)) {
    const left = cellsOf(obs, id).filter(cell => cell === null).length;
    const site = ENGINES[id]?.site;
    if (!selected.includes(id)) engineStatus[id] = previous?.engineStatus[id]?.status === 'ok' && left ? { status: 'partial', note: `${left}칸 남음` } : previous?.engineStatus[id] ?? null;
    else if (!left) engineStatus[id] = { status: 'ok', note: null };
    else if (blockedEngines.has(id)) engineStatus[id] = { status: 'blocked', note: blockedEngines.get(id) };
    else if (stoppedSites.has(site) || stoppedEngines.has(id) || aborted) engineStatus[id] = { status: 'stopped', note: stoppedSites.get(site) ?? stoppedEngines.get(id) ?? aborted };
    else engineStatus[id] = { status: 'partial', note: `${left}칸 남음${spent(site) ? ` · 한 번 실행에 ${pageBudget[site]}쪽까지만 엽니다(다음 실행에서 이어서)` : ''}${lastFailure.has(id) ? ` · 마지막 실패: ${lastFailure.get(id)}` : ''}` };
  }
  for (const site of Object.keys(pageBudget ?? {})) if (spent(site)) log(`${site}: 이번 실행 한도 ${pageBudget[site]}쪽에 도달 · 남은 칸은 다음 실행에서 이어집니다`);
  const complete = isMonthComplete(obs);
  const instant = now().toISOString();
  obs.run = {
    tool: TOOL,
    lastRunAt: instant,
    completedAt: complete ? previous?.completedAt ?? instant : null,
    engineStatus,
    warnings: runWarnings(def, obs, previous?.warnings ?? [], { recorded, organicCounts, conditionChanges }),
  };
  const changed = comparable(obs) !== before;
  if (changed) persist();
  else if (previous) obs.run.lastRunAt = previous.lastRunAt;
  return {
    obs, changed,
    report: {
      month, planned: tasks.length, attempted: done, recordedCells: [...recorded.values()].reduce((sum, cells) => sum + cells.length, 0),
      complete, aborted, engineStatus, warnings: obs.run.warnings.map(warning => `${warning.engine ?? 'file'}: ${warning.message}`),
    },
  };
}

/** One line for a desktop notification: citations over measured AI cells, top-10 names and what is still open. */
export function notificationLine(def, obs) {
  const summary = summarizeMonth(def, obs);
  const total = engines => Object.values(engines).reduce((sum, engine) => ({ measured: sum.measured + engine.measured, cells: sum.cells + engine.cells, cited: sum.cited + (engine.cited ?? 0), top10: sum.top10 + (engine.top10 ?? 0) }), { measured: 0, cells: 0, cited: 0, top10: 0 });
  const ai = total(summary.aiCitations.engines);
  const names = total(summary.nameSearch.engines);
  const open = Object.entries({ ...summary.aiCitations.engines, ...summary.nameSearch.engines }).filter(([, engine]) => engine.measured < engine.cells)
    .map(([id, engine]) => `${engine.label} ${engine.measured}/${engine.cells}${obs.run?.engineStatus[id] ? `(${{ ok: '기록', partial: '일부', stopped: '중단', blocked: '막힘' }[obs.run.engineStatus[id].status]})` : ''}`);
  return [
    `${obs.month} AI 인용 ${ai.measured ? `${ai.cited}/${ai.measured}칸` : '측정 안 됨'} (측정 ${ai.measured}/${ai.cells})`,
    `기관명 10위 안 ${names.measured ? `${names.top10}/${names.measured}` : '측정 안 됨'} (측정 ${names.measured}/${names.cells})`,
    open.length ? `남음: ${open.join(', ')}` : '모든 칸 기록',
    ...(obs.run?.warnings.length ? [`주의 ${obs.run.warnings.length}건`] : []),
  ].join(' · ');
}

// ---------------------------------------------------------------------------------------------------------------------
// The real browser and file system.

/** Finds the page script's sentinel line in `aside repl --json` output; null when it is not there. */
export function parseAsideOutput(stdout) {
  let text = String(stdout ?? '');
  let error = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.run) {
      error = parsed.run.error ?? null;
      text = (parsed.run.content ?? []).map(part => part?.text ?? '').join('\n');
    }
  } catch { /* plain output: search it as it is */ }
  const line = text.split('\n').find(candidate => candidate.startsWith(SENTINEL));
  if (!line) return { page: null, error: error ? String(error).split('\n')[0] : 'no result line' };
  try { return { page: JSON.parse(line.slice(SENTINEL.length)), error: null }; } catch { return { page: null, error: 'unreadable result line' }; }
}

/** Runs one page script through the aside CLI. The script file lives in a private temporary directory. */
export function openPageWithAside(url, site, { preflight = false, kind = null } = {}, { bin = process.env.ASIDE_BIN || 'aside' } = {}) {
  const script = buildPageScript(url, site, { preflight, kind });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-observe-'));
  const file = path.join(dir, 'page.js');
  fs.writeFileSync(file, script);
  const timeoutMs = (preflight ? 15000 : SITES[site].maxMs) + 45000;
  return new Promise(resolve => {
    const done = result => { fs.rmSync(dir, { recursive: true, force: true }); resolve(result); };
    const child = spawn(bin, ['repl', '--json', '--file', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); done({ asideError: error.code === 'ENOENT' ? `ENOENT: ${bin} 실행 파일을 찾지 못함` : 'aside 프로세스를 시작하지 못함' }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const { page, error } = parseAsideOutput(stdout);
      done(page ?? { asideError: signal ? `시간 초과로 종료(${signal})` : `exit ${code} · ${sanitizeText(error ?? '').slice(0, 160)}` });
    });
  });
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeAtomic = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
};

const USAGE = `node scripts/growth-observe.mjs --month YYYY-MM [--kind ai|name|gate] [--engine <id>] [--id <row>[,<row>…]] [--limit N] [--redo] [--dry-run]
node scripts/growth-observe.mjs --month YYYY-MM --is-complete     모든 칸이 기록됐으면 종료 코드 0, 아니면 1
node scripts/growth-observe.mjs --month YYYY-MM --notification    알림용 한 줄
엔진: ${Object.keys(ENGINES).join(', ')}, ${BING_ENGINE} · 환경 변수 ASIDE_BIN · 공통: [--definition <file>] [--dir <observation directory>] [--evidence-dir <dir>]`;

async function main(argv) {
  const value = (flag, fallback = null) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback; };
  const month = value('--month');
  if (!isMonth(month)) { console.log(USAGE); process.exitCode = argv.includes('--help') ? 0 : 1; return; }
  const def = loadDefinition(path.resolve(value('--definition', DEFINITION_FILE)));
  const file = path.join(path.resolve(value('--dir', OBSERVATION_DIR)), month + '.json');
  const evidenceDir = path.resolve(value('--evidence-dir', EVIDENCE_DIR));
  const exists = fs.existsSync(file);
  const obs = exists ? readJson(file) : buildTemplate(def, month);
  const problems = observationProblems(obs, def, { month });
  if (problems.length) throw new Error(`${file} is not a valid month file:\n- ${problems.join('\n- ')}`);

  if (argv.includes('--is-complete')) { process.exitCode = exists && isMonthComplete(obs) ? 0 : 1; return; }
  if (argv.includes('--notification')) { console.log(notificationLine(def, obs)); return; }

  const kind = value('--kind');
  if (kind !== null && !['ai', 'name', 'gate'].includes(kind)) throw new Error('--kind must be ai, name or gate');
  const engine = value('--engine');
  if (engine !== null && !Object.hasOwn(ENGINES, engine) && engine !== BING_ENGINE) throw new Error(`--engine must be one of ${Object.keys(ENGINES).join(', ')}, ${BING_ENGINE}`);
  const limitText = value('--limit');
  if (limitText !== null && !/^[1-9]\d*$/.test(limitText)) throw new Error('--limit must be a positive integer');
  const idText = value('--id');
  const options = { kinds: kind ? [kind] : ['ai', 'name', 'gate'], engines: engine ? [engine] : null, ids: idText === null ? null : idText.split(',').map(id => id.trim()).filter(Boolean), limit: limitText === null ? null : Number(limitText), redo: argv.includes('--redo') };

  if (argv.includes('--dry-run')) {
    const tasks = planTasks(def, obs, options);
    const perEngine = {};
    for (const task of tasks) perEngine[task.engine] = (perEngine[task.engine] ?? 0) + 1;
    console.log(JSON.stringify({ month, file, exists, dryRun: true, planned: tasks.length, perEngine, first: tasks.slice(0, 5).map(task => ({ engine: task.engine, id: task.id, url: task.url })) }, null, 2));
    return;
  }

  const { changed, report } = await observe({ def, obs, ...options }, {
    openPage: openPageWithAside,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    save: next => writeAtomic(file, JSON.stringify(next, null, 2) + '\n'),
    saveEvidence: (relative, text) => writeAtomic(path.join(evidenceDir, relative), text),
    log: line => console.log(sanitizeText(line)),
  });
  console.log(JSON.stringify({ file, evidenceDir, changed, ...report }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(sanitizeText(error.message)); process.exitCode = 1; });
}
