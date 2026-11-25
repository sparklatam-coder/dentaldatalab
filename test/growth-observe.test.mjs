import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  NOT_IN_TOP10, ORIGIN, aiCellProblems, buildTemplate, isInstant, isMonthComplete, loadDefinition, nameCellProblems, observationProblems,
  runProblems, formatSummary, summarize,
} from '../scripts/growth-monitor.mjs';
import {
  ALLOWED_PAGES, BING_SITE_URL, CHATGPT_PREFLIGHT_URL, ENGINES, GAP_MS, RUN_PAGE_BUDGET, SENTINEL, SITES, STALE_RUN, TOOL, buildAiCell, buildNameCell,
  buildPageScript, canonicalSiteUrl, conditionText, evidenceText, isAllowedUrl, notificationLine, observe, parseAsideOutput,
  parseResultCount, planTasks, readBingPage, readBingSiteCount, readChatgptPage, readSearchPage, runWarnings, sanitizeText,
  sourceDomain, targetOf,
} from '../scripts/growth-observe.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/growth-observe.mjs', import.meta.url));
const def = loadDefinition();
const MONTH = '2026-11';
const copy = value => JSON.parse(JSON.stringify(value));
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Small stand-ins for what the in-page extractors return. Shapes follow the live pages read on 2026-11-26.
const link = (href, text = '') => ({ href, text });
const googleAi = (links, text = 'AI 개요\n건강보험심사평가원 자료를 인용한 보도에 따르면 전국 치과병·의원은 총 1만9,608개소입니다.') => ({ text, hiddenMention: null, links });
const GOOGLE_UI = [link('https://support.google.com/websearch?p=ai_overviews', '자세히 알아보기'), link('https://policies.google.com/privacy', '개인정보처리방침'), link('https://www.google.com/search?q=%EC%B9%98%EA%B3%BC', '관련 검색 결과')];
const organicGoogle = hrefs => hrefs.map((href, i) => ({ href, title: `결과 ${i + 1}` }));
const OTHER_RESULTS = ['https://example-clinic.co.kr/', 'https://m.blog.naver.com/someone/1', 'https://www.modoodoc.com/hospital/1', 'https://www.instagram.com/clinic/', 'https://pf.kakao.com/_x/1', 'http://clinic.koweb.co.kr/a', 'https://www.goodoc.co.kr/hospitals/1'];
const page = (site, data, extra = {}) => ({
  finalAllowed: true, finalPage: { google: 'https://www.google.com/search', naver: 'https://search.naver.com/search.naver', chatgpt: 'https://chatgpt.com/', bing: 'https://www.bing.com/search' }[site],
  polls: 3, settled: true, elapsedMs: 4600, tree: '- main:\n  - heading "검색결과" [level=1]',
  data: { signature: [], pending: false, stop: false, hasResults: true, signedIn: site === 'google' ? true : site === 'naver' ? false : null, blocked: null, ...data }, ...extra,
});
const googlePage = ({ ai = null, organic = organicGoogle(OTHER_RESULTS) } = {}, extra) => page('google', { ai, organic }, extra);
const naverCard = (links, type = 'web') => ({ type, links: [...links, 'https://search.naver.com/search.naver?where=web&query=x', 'https://keep.naver.com/'], title: '카드' });
const naverPage = ({ ai = null, organic = OTHER_RESULTS.map(href => naverCard([href])) } = {}, extra) => page('naver', { ai, organic, cardRule: 'stream' }, extra);
const chatgptPage = (data = {}, extra) => page('chatgpt', { temporaryOn: true, loginWall: false, dialog: null, conversationPath: false, challenge: false, streaming: false, asked: true, promptWaiting: false, signedIn: true, answer: null, ...data }, extra);
const bingPage = (data = {}, extra) => page('bing', { countText: '1결과', items: [{ cite: 'https://dentaldatalab.com', title: '치과데이터랩' }], noResults: false, ...data }, extra);

test('only the four agreed result pages can ever be opened', () => {
  assert.deepEqual(ALLOWED_PAGES.map(([origin, pathname]) => origin + pathname), ['https://www.google.com/search', 'https://search.naver.com/search.naver', 'https://chatgpt.com/', 'https://www.bing.com/search']);
  for (const engine of Object.values(ENGINES)) assert.ok(isAllowedUrl(engine.url('유어스치과병원 & "따옴표" ?')), engine.site);
  assert.ok(isAllowedUrl(BING_SITE_URL));
  assert.ok(isAllowedUrl(CHATGPT_PREFLIGHT_URL));
  for (const refused of [
    'https://www.google.com/', 'https://www.google.com/sorry/index?continue=x', 'http://www.google.com/search?q=x', 'https://google.com/search?q=x',
    'https://accounts.google.com/ServiceLogin', 'https://mail.google.com/search', 'https://www.google.com.example.com/search?q=x', 'https://user@www.google.com/search?q=x',
    'https://chatgpt.com/c/0000', 'https://chatgpt.com/auth/login', 'https://search.naver.com/', 'https://nid.naver.com/nidlogin.login', 'https://www.bing.com/', 'https://dentaldatalab.com/', 'not a url', '',
  ]) assert.equal(isAllowedUrl(refused), false, refused);
  assert.ok(ENGINES.chatgpt.url('질문').endsWith('&hints=search&temporary-chat=true'), 'ChatGPT is only ever asked in a temporary chat');
  assert.ok(ENGINES.google.url('이름').includes('pws=0'));
});

test('the page script opens one allowed tab, closes it in finally and never clicks, types or touches other tabs', () => {
  assert.throws(() => buildPageScript('https://www.google.com/sorry/index', 'google'), /allowlist/);
  assert.throws(() => buildPageScript('https://example.com/', 'google'), /allowlist/);
  assert.throws(() => buildPageScript(ENGINES.google.url('x'), 'unknown'), /No extractor/);
  for (const [site, url] of [['google', ENGINES.google.url('유어스치과병원')], ['naver', ENGINES.naver.url('유어스치과병원')], ['chatgpt', ENGINES.chatgpt.url('질문?')], ['chatgpt', CHATGPT_PREFLIGHT_URL], ['bing', BING_SITE_URL]]) {
    const script = buildPageScript(url, site, { preflight: url === CHATGPT_PREFLIGHT_URL, kind: 'ai' });
    assert.doesNotThrow(() => new AsyncFunction('openTab', 'closeTab', 'snapshot', 'sleep', script), site + ' script parses');
    assert.equal(script.match(/openTab\(/g).length, 1, site);
    assert.match(script, /finally \{\s*await closeTab\(tab\);\s*\}/, site);
    assert.ok(script.indexOf('if (!isAllowed(url)) throw') < script.indexOf('openTab('), 'the allowlist is checked before the tab opens');
    assert.match(script, /out\.finalAllowed = isAllowed\(tab\.url\(\)\)/);
    for (const forbidden of ['attachBrowserTab', 'attachActiveBrowserTab', 'listBrowserTabs', 'getTabByTargetId', '.click(', '.fill(', '.type(', '.press(', 'keyboard', '.goto(', 'fetch(', 'localStorage', 'cookie']) {
      assert.equal(script.includes(forbidden), false, `${site} script must not contain ${forbidden}`);
    }
    assert.ok(script.includes(JSON.stringify(url)));
    assert.ok(script.includes(SENTINEL));
    assert.equal(script.match(/snapshot\(/g).length, 1, site);
    assert.match(script, /snapshot\(tab, \{ selector: "main(, \[role=\\"main\\"\])?" \}\)/, `${site} evidence is the main landmark only, never the header with its account links`);
  }
  assert.match(buildPageScript(ENGINES.chatgpt.url('질문'), 'chatgpt'), /snapshot\(tab, \{ selector: "main" \}\)/, 'ChatGPT evidence never includes the sidebar');
  for (const spec of Object.values(SITES)) assert.ok(spec.maxMs <= 100000 && spec.aiMinMs >= spec.minMs, 'every wait fits one 120 s aside call');
});

test('sanitizeText drops lines with an e-mail address, an account label or the browser location', () => {
  const dirty = [
    '- button "Google 앱" [ref=e9]',
    '- button "Google 계정: 홍길동 (hong@example.com)" [ref=e10]',
    '- link "someone.else@corp.co.kr" [ref=e11]',
    '- link "Google Account" [ref=e12]',
    '    - link "내 프로필 이미지" [ref=e5]:',
    '      - image "내 프로필 이미지"',
    '      - text: "someid 내정보 보기"',
    '  - heading [level=2]: "어느구"',
    '  - button "정확한 위치 사용" [ref=e22]',
    '  - button "위치 정보가 사용되는 방식" [ref=e23]',
    '  - button "어느구 서울특별시 - 이전 활동 기준" [ref=e74]',
    '  - link "유어스치과병원 (@yours.dental_)" [ref=e58]',
    '  - link "accounting 치과 세무" [ref=e59]',
  ].join('\n');
  assert.equal(sanitizeText(dirty), ['- button "Google 앱" [ref=e9]', '  - link "유어스치과병원 (@yours.dental_)" [ref=e58]', '  - link "accounting 치과 세무" [ref=e59]'].join('\n'));
  assert.equal(sanitizeText(null), '');
});

test('links are reduced to this site\'s page URL or another source\'s hostname', () => {
  assert.equal(canonicalSiteUrl('https://dentaldatalab.com/guides/dental-hospital-30-beds/?utm_source=chatgpt.com'), ORIGIN + '/guides/dental-hospital-30-beds/');
  assert.equal(canonicalSiteUrl('https://www.dentaldatalab.com/hospitals/#:~:text=%EC%B9%98%EA%B3%BC'), ORIGIN + '/hospitals/');
  assert.equal(canonicalSiteUrl('http://dentaldatalab.com'), ORIGIN + '/');
  assert.equal(canonicalSiteUrl('https://www.google.com/url?q=https://dentaldatalab.com/data/&sa=U'), ORIGIN + '/data/');
  for (const other of ['https://dentaldatalab.com.example.com/', 'https://notdentaldatalab.com/', 'https://blog.naver.com/dentaldatalab', 'mailto:a@dentaldatalab.com', 'javascript:void(0)', 'nonsense']) assert.equal(canonicalSiteUrl(other), null, other);
  assert.equal(targetOf('javascript:void(0)'), null);

  assert.equal(sourceDomain('https://www.dentalnews.or.kr/news/article.html?no=48521', 'google'), 'dentalnews.or.kr');
  assert.equal(sourceDomain('https://m.blog.naver.com/realkc/223514043159', 'google'), 'm.blog.naver.com');
  assert.equal(sourceDomain('https://www.youtube.com/watch?v=x', 'google'), 'youtube.com');
  assert.equal(sourceDomain('http://유어스치과병원.com/', 'naver'), 'xn--vb0b731a0leurdxtbunl13b.com');
  assert.equal(sourceDomain('https://blog.naver.com/the_insight_archi/224395048605', 'naver'), 'blog.naver.com');
  assert.equal(sourceDomain('https://www.law.go.kr/x?utm_source=chatgpt.com', 'chatgpt'), 'law.go.kr');
  for (const [href, site] of [
    ['https://support.google.com/websearch?p=ai_overviews', 'google'], ['https://policies.google.com/terms', 'google'], ['https://www.google.co.kr/search?q=x', 'google'],
    ['https://search.naver.com/search.naver?where=nexearch&query=x', 'naver'], ['https://help.naver.com/x', 'naver'], ['https://keep.naver.com/', 'naver'],
    ['https://chatgpt.com/share/x', 'chatgpt'], ['https://dentaldatalab.com/hospitals/', 'google'], ['https://www.dentaldatalab.com/', 'naver'], ['javascript:void(0)', 'google'], ['http://localhost/x', 'google'],
  ]) assert.equal(sourceDomain(href, site), null, href);
});

test('an AI cell records the block\'s links: this site as citedUrls, other sources as hostnames, engine chrome ignored', () => {
  const others = [link('https://www.hira.or.kr/', '건강보험심사평가원'), link('https://www.dentalnews.or.kr/news/article.html?no=48521', '치과신문'), link('https://www.dentalnews.or.kr/news/article.html?no=48521', '치과신문'), link('https://occupationalhealthblog.net/dentist/', '산업보건이야기')];
  const notCited = buildAiCell(googleAi([...others, ...GOOGLE_UI]), 'google');
  assert.deepEqual(notCited, { answerShown: true, cited: false, citedUrls: [], otherDomains: ['hira.or.kr', 'dentalnews.or.kr', 'occupationalhealthblog.net'], note: null });

  const cited = buildAiCell(googleAi([...others, link('https://dentaldatalab.com/reports/national-data-coverage/#:~:text=19%2C681'), link('https://www.dentaldatalab.com/reports/national-data-coverage/?utm_source=x'), link('https://dentaldatalab.com/hospitals/')]), 'google');
  assert.deepEqual([cited.cited, cited.citedUrls, cited.note], [true, [ORIGIN + '/reports/national-data-coverage/', ORIGIN + '/hospitals/'], null]);
  assert.equal(cited.otherDomains.includes('dentaldatalab.com'), false);

  const named = buildAiCell({ text: 'AI 브리핑\n치과데이터랩이 정리한 심평원 자료에 따르면 전국 치과병원은 248곳입니다. 자세한 수치는 출처를 확인하세요.', hiddenMention: null, links: [link('https://dentstat.com/stats')] }, 'naver');
  assert.deepEqual([named.answerShown, named.cited, named.citedUrls, named.otherDomains], [true, true, [], ['dentstat.com']]);
  assert.match(named.note, /^링크 없이 이름으로 언급: “.*치과데이터랩/);
  const collapsed = buildAiCell({ text: 'AI 개요\n전국 치과병원은 248곳이며 대부분 수도권에 있습니다. 더보기를 누르면 이어집니다.', hiddenMention: '접힌 본문에서 dentaldatalab 자료를 인용', links: [] }, 'google');
  assert.equal(collapsed.cited, true);
  assert.match(collapsed.note, /dentaldatalab/);

  assert.deepEqual(buildAiCell(null, 'google'), { answerShown: false, cited: false, citedUrls: [], otherDomains: [], note: null });
  const headingOnly = buildAiCell({ text: 'AI 개요', hiddenMention: null, links: [link('https://dentaldatalab.com/')] }, 'google');
  assert.deepEqual([headingOnly.answerShown, headingOnly.cited, headingOnly.citedUrls], [false, false, []]);
  assert.match(headingOnly.note, /본문은 표시되지 않았습니다/);
  const chat = buildAiCell({ text: '치과병원과 치과의원은 의료법상 종별이 다릅니다. 치과병원은 병원급 의료기관입니다.', hiddenMention: null, links: [link('https://dentaldatalab.com/reports/dental-hospital-vs-clinic/?utm_source=chatgpt.com', '치과데이터랩'), link('https://www.law.go.kr/법령/의료법?utm_source=chatgpt.com')] }, 'chatgpt');
  assert.deepEqual(chat, { answerShown: true, cited: true, citedUrls: [ORIGIN + '/reports/dental-hospital-vs-clinic/'], otherDomains: ['law.go.kr'], note: null });
  for (const cell of [notCited, cited, named, collapsed, headingOnly, chat, buildAiCell(null, 'naver')]) assert.deepEqual(aiCellProblems(cell), [], JSON.stringify(cell));
});

test('a name-search cell is the position of the first of the first ten results that leads to this site', () => {
  const own = ORIGIN + '/clinics/c-000029b3fb02/';
  const results = hrefs => hrefs.map(href => ({ links: [href] }));
  assert.deepEqual(buildNameCell(results([...OTHER_RESULTS.slice(0, 3), own + '?ref=x', ...OTHER_RESULTS.slice(3)])), { rank: 4, url: own });
  assert.deepEqual(buildNameCell(results(['https://www.dentaldatalab.com/hospitals/'])), { rank: 1, url: ORIGIN + '/hospitals/' });
  assert.deepEqual(buildNameCell(results(OTHER_RESULTS)), { rank: NOT_IN_TOP10, url: null }, 'a first page with fewer than ten results and none of ours');
  const eleven = [...OTHER_RESULTS, ...OTHER_RESULTS.slice(0, 3), own];
  assert.equal(eleven.length, 11);
  assert.deepEqual(buildNameCell(results(eleven)), { rank: NOT_IN_TOP10, url: null }, 'position 11 is outside the top ten');
  assert.deepEqual(buildNameCell(results([...eleven.slice(0, 9), own])), { rank: 10, url: own });
  assert.deepEqual(buildNameCell([naverCard(['https://blog.naver.com/a']), naverCard(['https://help.naver.com/x', own, own + 'more/'])]), { rank: 2, url: own }, 'a Naver card is ours when any of its links is');
  assert.equal(buildNameCell([]), null, 'no parsed results is not an observation');
  assert.equal(buildNameCell(null), null);
  for (const cell of [buildNameCell(results([own])), buildNameCell(results(OTHER_RESULTS))]) assert.deepEqual(nameCellProblems(cell), []);
});

test('the Bing site: count is only read when the label holds one number that the listed results support', () => {
  assert.deepEqual(['1결과', '결과 약 1,230개', '약 12,300,000개 결과', 'About 5,430 results', '1-10 of 1,230 results', '12 results'].map(parseResultCount), [1, 1230, 12300000, 5430, 1230, 12]);
  assert.deepEqual(['', '결과', '1-10 / 230', null, undefined, 12].map(parseResultCount), [null, null, null, null, null, null]);
  const data = bingPage().data;
  assert.equal(readBingSiteCount(data), 1);
  assert.equal(readBingSiteCount({ ...data, countText: '결과 약 1,230개', items: [{ cite: 'https://dentaldatalab.com › guides › dental-hospital-30-beds', title: 'x' }, { cite: 'dentaldatalab.com/hospitals', title: 'y' }] }), 1230);
  assert.equal(readBingSiteCount({ ...data, countText: null, items: [], noResults: true }), 0, 'an explicit no-results page is a real zero');
  assert.equal(readBingSiteCount({ ...data, countText: null }), null, 'no count label');
  assert.equal(readBingSiteCount({ ...data, countText: '12결과', items: [{ cite: 'https://other.example.com', title: 'x' }] }), null, 'a count without one listed page of this site');
  assert.equal(readBingSiteCount({ ...data, countText: '1결과', items: [...data.items, ...data.items] }), null, 'fewer counted than listed');
  assert.equal(readBingSiteCount({ ...data, blocked: 'captcha' }), null);
  assert.equal(readBingSiteCount({ ...data, hasResults: false }), null);
  assert.deepEqual(readBingPage(bingPage()), { value: 1 });
  assert.match(readBingPage(bingPage({ countText: null })).failure.reason, /결과 수/);
});

test('a search page is only read when it is the allowed page, is not a challenge and shows results', () => {
  const ai = { kind: 'ai', site: 'google' };
  const name = { kind: 'name', site: 'google' };
  assert.deepEqual(readSearchPage(ai, googlePage()).cell, { answerShown: false, cited: false, citedUrls: [], otherDomains: [], note: null }, 'results without an AI block is a real "no AI answer"');
  assert.deepEqual(readSearchPage(name, googlePage()), { cell: { rank: NOT_IN_TOP10, url: null }, organicCount: 7 });
  assert.equal(readSearchPage(ai, googlePage({ ai: googleAi([]), organic: [] })).cell.answerShown, true);

  const sorry = readSearchPage(name, { finalAllowed: false, finalPage: 'https://www.google.com/sorry', data: null });
  assert.deepEqual([sorry.failure.stop, /허용한 페이지 밖/.test(sorry.failure.reason), sorry.cell], [true, true, undefined]);
  assert.equal(readSearchPage(ai, googlePage({}, { data: { ...googlePage().data, blocked: 'captcha' } })).failure.stop, true);
  const empty = readSearchPage(ai, googlePage({ organic: [] }));
  assert.deepEqual([empty.failure.stop, empty.cell], [false, undefined], 'an unreadable page is never written as "no AI answer"');
  assert.equal(readSearchPage(name, googlePage({ organic: [] })).failure.stop, false);
  assert.equal(readSearchPage(name, naverPage({}, { data: { ...naverPage().data, hasResults: false } })).failure.stop, false);
  assert.equal(readSearchPage(name, { asideError: 'exit 1' }).failure.aside, true);
  assert.equal(readSearchPage(name, null).failure.aside, true);
  assert.equal(readSearchPage(name, { finalAllowed: true, finalPage: 'https://www.google.com/search', data: null }).failure.stop, false);
});

test('ChatGPT is only read in a confirmed temporary chat and never needs a click', () => {
  assert.deepEqual(readChatgptPage(chatgptPage({ asked: false }), { preflight: true }), { ok: true });
  const blocked = (data, options) => { const { failure } = readChatgptPage(chatgptPage(data), options); return [failure.blocked, failure.stop, failure.reason]; };
  assert.match(blocked({ dialog: 'temporary-chat-notice', asked: false }, { preflight: true })[2], /임시 채팅 안내 창.*클릭/);
  assert.match(blocked({ dialog: 'other' })[2], /^안내 창/);
  assert.match(blocked({ temporaryOn: false })[2], /임시 채팅 표시를 확인하지 못함/);
  assert.match(blocked({ loginWall: true })[2], /로그인/);
  assert.match(blocked({ challenge: true })[2], /캡차/);
  assert.match(blocked({ conversationPath: true })[2], /대화 주소/);
  assert.match(blocked({ asked: false, promptWaiting: true })[2], /전송되지 않음/);
  assert.match(blocked({ answer: null })[2], /답이 나타나지 않음/);
  for (const data of [{ dialog: 'other' }, { temporaryOn: false }, { loginWall: true }, { conversationPath: true }, { asked: false, promptWaiting: true }]) assert.deepEqual(blocked(data).slice(0, 2), [true, true]);
  const left = readChatgptPage({ finalAllowed: false, finalPage: 'https://chatgpt.com/c', data: null });
  assert.deepEqual([left.failure.blocked, left.failure.stop], [true, true], 'a conversation address is outside the allowlist');

  const answer = { text: '치과병원은 병원급 의료기관이고 치과의원은 의원급 의료기관입니다. 개설 절차와 시설 기준이 다릅니다.', hiddenMention: null, links: [link('https://dentaldatalab.com/reports/dental-hospital-vs-clinic/?utm_source=chatgpt.com'), link('https://moondental.co.kr/faq/?utm_source=chatgpt.com')] };
  assert.deepEqual(readChatgptPage(chatgptPage({ answer })).cell, { answerShown: true, cited: true, citedUrls: [ORIGIN + '/reports/dental-hospital-vs-clinic/'], otherDomains: ['moondental.co.kr'], note: null });
  const slow = readChatgptPage(chatgptPage({ answer, streaming: true }, { settled: false }));
  assert.deepEqual([slow.failure.stop, slow.failure.blocked, slow.cell], [false, undefined, undefined], 'a half-streamed answer is not recorded');
});

test('the plan lists open cells in ledger order and honours kind, engine, limit and redo', () => {
  const blank = buildTemplate(def, MONTH);
  const all = planTasks(def, blank);
  assert.equal(all.length, 20 * 3 + 30 * 2 + 1);
  assert.deepEqual(all.slice(0, 3).map(task => [task.engine, task.id]), [['chatgpt', 'q01'], ['googleAiOverview', 'q01'], ['naverAiBriefing', 'q01']]);
  assert.deepEqual([all.at(-1).engine, all.at(-1).url], ['bing', BING_SITE_URL]);
  assert.ok(all.every(task => isAllowedUrl(task.url)));
  assert.equal(all.find(task => task.engine === 'google').url, ENGINES.google.url(def.nameSearchSample.institutions[0].name));
  assert.deepEqual([...new Set(planTasks(def, blank, { kinds: ['name'] }).map(task => task.engine))], ['google', 'naver']);
  assert.equal(planTasks(def, blank, { kinds: ['gate'] }).length, 1);
  assert.equal(planTasks(def, blank, { engines: ['naverAiBriefing'] }).length, 20);
  assert.equal(planTasks(def, blank, { engines: ['bing'] }).length, 1);
  assert.equal(planTasks(def, blank, { limit: 2 }).length, 2 * 5 + 1);

  const partly = copy(blank);
  partly.aiCitations[0].cells.googleAiOverview = buildAiCell(null, 'google');
  partly.nameSearch[0].cells.naver = { rank: NOT_IN_TOP10, url: null };
  partly.gateInputs.bingSiteResults = 0;
  assert.equal(planTasks(def, partly).length, all.length - 3, 'recorded cells, false and 0 included, are not observed again');
  assert.equal(planTasks(def, partly, { redo: true }).length, all.length);
  assert.deepEqual(planTasks(def, partly, { engines: ['googleAiOverview'], ids: ['q01'] }), [], 'a recorded cell needs --redo');
  assert.deepEqual(planTasks(def, partly, { engines: ['googleAiOverview'], ids: ['q01'], redo: true }).map(task => [task.engine, task.id]), [['googleAiOverview', 'q01']], 'one cell again');
  assert.deepEqual(planTasks(def, partly, { ids: ['q02', 'c-000029b3fb02'] }).map(task => task.engine), ['chatgpt', 'googleAiOverview', 'naverAiBriefing', 'google'], 'the Bing count is not part of a row selection');
  assert.throws(() => planTasks(def, partly, { ids: ['q99'] }), /No such row in the month file: q99/);
  assert.throws(() => planTasks({ ...def, engines: { ...def.engines, nameSearch: [...def.engines.nameSearch, { id: 'daum', label: '다음' }] } }, { ...copy(blank), nameSearch: blank.nameSearch.map(row => ({ ...row, cells: { ...row.cells, daum: null } })) }), /No extractor for engine daum/);
});

/** A fake browser and clock: pages come from `respond`, every sleep and page load advances the clock. */
function harness(respond, { random = () => 0.5, pageMs = 5000, start = new Date(2026, 10, 26, 12, 0, 0) } = {}) {
  let clock = start.getTime();
  const state = { opened: [], sleeps: [], saves: [], evidence: new Map(), logs: [] };
  const deps = {
    openPage: async (url, site, options = {}) => {
      state.opened.push({ url, site, at: clock, preflight: options.preflight === true, kind: options.kind ?? null });
      const result = await respond(url, site, options, state.opened.length);
      clock += pageMs;
      state.opened.at(-1).end = clock;
      return result;
    },
    sleep: async ms => { state.sleeps.push(ms); clock += ms; },
    random, now: () => new Date(clock),
    save: obs => state.saves.push(copy(obs)),
    saveEvidence: (relative, text) => state.evidence.set(relative, text),
    log: line => state.logs.push(line),
  };
  return { deps, state };
}
const answering = (url, site, options) => {
  if (site === 'google') return googlePage({ ai: options.kind === 'ai' ? googleAi([link('https://www.dentalnews.or.kr/a'), ...GOOGLE_UI]) : null });
  if (site === 'naver') return naverPage({ ai: options.kind === 'ai' ? { text: 'AI 브리핑\n전국 치과 수는 통계 기준에 따라 약 19,659곳에서 20,122곳으로 차이가 있습니다.', hiddenMention: null, links: [link('https://dentstat.com/stats')] } : null });
  if (site === 'bing') return bingPage();
  if (options.preflight) return chatgptPage({ asked: false });
  return chatgptPage({ answer: { text: '전국 치과병원은 248곳이고 치과의원은 19,433곳으로 집계됩니다. 출처에 따라 수치는 조금 다릅니다.', hiddenMention: null, links: [link('https://dentaldatalab.com/hospitals/?utm_source=chatgpt.com')] } });
};
const noticeDialog = (url, site, options) => (site === 'chatgpt' ? chatgptPage({ dialog: 'temporary-chat-notice', asked: false }) : answering(url, site, options));

test('a run records cells, saves after every cell, paces each site and leaves a blocked ChatGPT untouched', async () => {
  const { deps, state } = harness(noticeDialog);
  const { obs, changed, report } = await observe({ def, obs: buildTemplate(def, MONTH), limit: 2 }, deps);
  assert.equal(changed, true);
  assert.deepEqual(observationProblems(obs, def, { month: MONTH }), []);
  assert.deepEqual([report.planned, report.attempted, report.recordedCells, report.complete], [11, 9, 8, false]);

  assert.ok(state.opened.every(visit => isAllowedUrl(visit.url)));
  assert.deepEqual(state.opened.filter(visit => visit.site === 'chatgpt').map(visit => visit.url), [CHATGPT_PREFLIGHT_URL], 'no question is sent while temporary chat is not usable');
  assert.deepEqual(obs.aiCitations.map(row => row.cells.chatgpt), Array(20).fill(null));
  assert.equal(obs.conditions.chatgpt, null);
  assert.deepEqual(obs.run.engineStatus.chatgpt.status, 'blocked');
  assert.match(obs.run.engineStatus.chatgpt.note, /임시 채팅 안내 창/);

  assert.equal(obs.observedOn, '2026-11-26');
  assert.match(obs.observer, /자동 관찰/);
  assert.equal(obs.aiCitations[0].cells.googleAiOverview.answerShown, true);
  assert.deepEqual(obs.aiCitations[1].cells.naverAiBriefing.otherDomains, ['dentstat.com']);
  assert.deepEqual(obs.nameSearch[1].cells.google, { rank: NOT_IN_TOP10, url: null });
  assert.equal(obs.aiCitations[2].cells.googleAiOverview, null, '--limit leaves the rest null');
  assert.equal(obs.gateInputs.bingSiteResults, 1);
  assert.deepEqual([obs.gateInputs.naverCollectedPages, obs.gateInputs.referringDomains, obs.gateInputs.handoffClicks], [null, null, null], 'console figures are never filled in');
  assert.equal(obs.conditions.googleAiOverview, conditionText('googleAiOverview', true));
  assert.equal(obs.conditions.naver, conditionText('naver', false));
  assert.deepEqual([obs.run.tool, obs.run.completedAt, obs.run.warnings, obs.run.engineStatus.google], [TOOL, null, [], { status: 'partial', note: '28칸 남음' }]);
  assert.ok(isInstant(obs.run.lastRunAt));

  assert.equal(state.saves.length, 9 + 1, 'one save per recorded cell or gate input, and one for the run record');
  state.saves.forEach(saved => assert.deepEqual(observationProblems(saved, def, { month: MONTH }), []));
  assert.equal(state.saves[0].run, undefined);
  assert.deepEqual(Object.keys(state.saves.at(-1)).at(-1), 'run');

  for (const site of ['google', 'naver']) {
    const visits = state.opened.filter(visit => visit.site === site);
    assert.equal(visits.length, 4);
    for (let i = 1; i < visits.length; i++) {
      const gap = visits[i].at - visits[i - 1].end;
      assert.ok(gap >= GAP_MS[0] && gap <= GAP_MS[1], `${site} gap ${gap}`);
    }
  }
  assert.deepEqual(state.opened.filter(visit => visit.site === 'google').map(visit => visit.kind), ['ai', 'ai', 'name', 'name']);
  assert.ok([...state.evidence.keys()].includes(path.join(MONTH, 'chatgpt', 'preflight.txt')));
  assert.ok([...state.evidence.keys()].includes(path.join(MONTH, 'google', 'c-000029b3fb02.txt')));
  assert.equal(state.evidence.size, 10);
});

test('the gap between two requests to one site is always 8–15 s, whatever the random draw', async () => {
  for (const [draw, expected] of [[0, 8000], [0.5, 11500], [0.999999, 15000]]) {
    const { deps, state } = harness(answering, { random: () => draw });
    await observe({ def, obs: buildTemplate(def, MONTH), engines: ['google'], limit: 3 }, deps);
    const visits = state.opened;
    assert.equal(visits.length, 3);
    assert.deepEqual(visits.slice(1).map((visit, i) => visit.at - visits[i].end), [expected, expected]);
  }
  assert.deepEqual([...GAP_MS], [8000, 15000]);
});

test('evidence is sanitized before it is saved and shows what the cell was built from', async () => {
  const dirtyTree = ['- main:', '  - button "Google 계정: 홍길동 (hong@example.com)" [ref=e10]', '  - heading [level=2]: "어느구"', '  - button "정확한 위치 사용" [ref=e22]', '  - heading "웹 검색결과" [level=2]'].join('\n');
  const { deps, state } = harness((url, site, options) => ({ ...answering(url, site, options), tree: dirtyTree }));
  await observe({ def, obs: buildTemplate(def, MONTH), engines: ['googleAiOverview', 'naver'], limit: 1 }, deps);
  const ai = state.evidence.get(path.join(MONTH, 'googleAiOverview', 'q01.txt'));
  for (const leaked of ['hong@example.com', '홍길동', '계정', '어느구', '정확한 위치']) for (const text of state.evidence.values()) assert.equal(text.includes(leaked), false, leaked);
  assert.match(ai, /engine: googleAiOverview\nid: q01\nquery: 전국 치과 수는 모두 몇 곳인가요\?/);
  assert.match(ai, /recorded: \{"answerShown":true,"cited":false,"citedUrls":\[\],"otherDomains":\["dentalnews\.or\.kr"\],"note":null\}/);
  assert.match(ai, /## AI block links \(4\)\n 1\. \(텍스트 없음\) — https:\/\/www\.dentalnews\.or\.kr\/a/);
  assert.match(ai, /웹 검색결과/);
  const name = state.evidence.get(path.join(MONTH, 'naver', 'c-000029b3fb02.txt'));
  assert.match(name, /## Result list in display order \(7; the first 10 are ranked; rule: stream\)\n 1\. \[web\] 카드 — https:\/\/example-clinic\.co\.kr\//);
  const text = evidenceText({ task: { kind: 'ai', site: 'chatgpt', engine: 'chatgpt', id: 'q01', query: '질문', url: ENGINES.chatgpt.url('질문') }, observedAt: '2026-11-26T03:00:00.000Z', page: chatgptPage({ dialog: 'temporary-chat-notice', asked: false }), outcome: readChatgptPage(chatgptPage({ dialog: 'temporary-chat-notice', asked: false })) });
  assert.match(text, /result: NOT RECORDED — 임시 채팅 안내 창/);
  assert.match(text, /temporaryChatConfirmed: true\ndialog: temporary-chat-notice/);
});

test('a challenge page stops that site for the run and the remaining cells stay null', async () => {
  let googleVisits = 0;
  const { deps, state } = harness((url, site, options) => {
    if (site !== 'google') return answering(url, site, options);
    googleVisits += 1;
    return googleVisits === 3 ? { finalAllowed: false, finalPage: 'https://www.google.com/sorry', data: null, tree: null } : answering(url, site, options);
  });
  const { obs, report } = await observe({ def, obs: buildTemplate(def, MONTH), kinds: ['ai', 'name'], engines: ['googleAiOverview', 'google', 'naver'], limit: 4 }, deps);
  assert.equal(googleVisits, 3, 'nothing more is requested from Google after the challenge');
  assert.equal(state.opened.filter(visit => visit.site === 'naver').length, 4, 'Naver carries on');
  assert.deepEqual(obs.aiCitations.slice(0, 4).map(row => row.cells.googleAiOverview !== null), [true, true, false, false]);
  assert.deepEqual(obs.nameSearch.map(row => row.cells.google), Array(30).fill(null));
  for (const id of ['googleAiOverview', 'google']) {
    assert.equal(obs.run.engineStatus[id].status, 'stopped');
    assert.match(obs.run.engineStatus[id].note, /허용한 페이지 밖으로 이동함\(https:\/\/www\.google\.com\/sorry\)/);
  }
  assert.equal(obs.run.engineStatus.naver.status, 'partial');
  assert.equal(obs.run.engineStatus.chatgpt, null, 'an engine the run did not select keeps no status');
  assert.equal(report.complete, false);
  assert.deepEqual(observationProblems(obs, def, { month: MONTH }), []);
});

test('pages that cannot be read leave their cells null, and three in a row stop the engine', async () => {
  const { deps, state } = harness((url, site, options) => (site === 'naver' ? naverPage({ organic: [] }) : answering(url, site, options)));
  const { obs } = await observe({ def, obs: buildTemplate(def, MONTH), kinds: ['name'], limit: 5 }, deps);
  assert.equal(state.opened.filter(visit => visit.site === 'naver').length, 3);
  assert.deepEqual(obs.nameSearch.map(row => row.cells.naver), Array(30).fill(null), 'never written as not_in_top10');
  assert.equal(obs.conditions.naver, null);
  assert.deepEqual([obs.run.engineStatus.naver.status, /연속 3회 실패 · 결과 목록을 찾지 못함/.test(obs.run.engineStatus.naver.note)], ['stopped', true]);
  assert.equal(obs.nameSearch.slice(0, 5).every(row => row.cells.google !== null), true);
  assert.match(state.evidence.get(path.join(MONTH, 'naver', 'c-000029b3fb02.txt')), /result: NOT RECORDED — 결과 목록을 찾지 못함/);

  const missing = harness(() => ({ asideError: 'ENOENT: aside 실행 파일을 찾지 못함' }));
  const result = await observe({ def, obs: buildTemplate(def, MONTH), kinds: ['name'] }, missing.deps);
  assert.equal(missing.state.opened.length, 1, 'a missing aside binary ends the run at once');
  assert.match(result.report.aborted, /ENOENT/);
  assert.deepEqual([result.obs.observedOn, result.obs.run.engineStatus.google.status, result.obs.run.engineStatus.naver.status], [null, 'stopped', 'stopped']);
  const thrown = harness(() => { throw new Error('boom user@example.com'); });
  const crashed = await observe({ def, obs: buildTemplate(def, MONTH), engines: ['google'], limit: 1 }, thrown.deps);
  assert.equal(crashed.obs.run.engineStatus.google.note.includes('@'), false);
});

test('a run resumes where the last one stopped, and a run that changes nothing writes nothing', async () => {
  const first = harness(noticeDialog);
  const one = await observe({ def, obs: buildTemplate(def, MONTH), limit: 2 }, first.deps);
  const second = harness(noticeDialog, { start: new Date(2026, 10, 27, 9, 0, 0) });
  const two = await observe({ def, obs: one.obs, kinds: ['name'], limit: 1 }, second.deps);
  assert.deepEqual(second.state.opened.map(visit => new URL(visit.url).searchParams.get('q') ?? new URL(visit.url).searchParams.get('query')), Array(2).fill(def.nameSearchSample.institutions[2].name));
  assert.equal(two.obs.observedOn, '2026-11-26', 'observedOn stays the first observation day');
  assert.equal(two.obs.run.engineStatus.chatgpt.status, 'blocked', 'an engine the run did not select keeps its last status');
  assert.equal(two.obs.aiCitations[0].cells.googleAiOverview.answerShown, true);
  assert.equal(two.obs.nameSearch.filter(row => row.cells.google !== null).length, 3);

  // One run opens at most RUN_PAGE_BUDGET.google pages on Google; the next day's run finishes the month.
  const full = harness(answering);
  const dayOne = await observe({ def, obs: buildTemplate(def, MONTH) }, full.deps);
  const perSite = state => Object.fromEntries(['chatgpt', 'google', 'naver', 'bing'].map(site => [site, state.opened.filter(visit => visit.site === site).length]));
  assert.equal(RUN_PAGE_BUDGET.google, 25);
  assert.deepEqual(perSite(full.state), { chatgpt: 21, google: 25, naver: 50, bing: 1 }, 'every cell, the Bing count and one ChatGPT preflight, but only 25 Google pages');
  assert.deepEqual([dayOne.report.complete, dayOne.obs.run.completedAt, dayOne.obs.run.engineStatus.googleAiOverview.status], [false, null, 'ok']);
  assert.deepEqual(dayOne.obs.run.engineStatus.google, { status: 'partial', note: '25칸 남음 · 한 번 실행에 25쪽까지만 엽니다(다음 실행에서 이어서)' });
  assert.deepEqual(dayOne.obs.nameSearch.map(row => row.cells.google !== null), [...Array(5).fill(true), ...Array(25).fill(false)]);
  assert.ok(full.state.logs.some(line => /^google: 이번 실행 한도 25쪽에 도달/.test(line)));
  const nextDay = harness(answering, { start: new Date(2026, 10, 27, 9, 0, 0) });
  const done = await observe({ def, obs: dayOne.obs }, nextDay.deps);
  assert.deepEqual(perSite(nextDay.state), { chatgpt: 0, google: 25, naver: 0, bing: 0 });
  assert.deepEqual([done.report.complete, isMonthComplete(done.obs), isInstant(done.obs.run.completedAt), done.obs.observedOn], [true, true, true, '2026-11-26']);
  assert.ok(Object.values(done.obs.run.engineStatus).every(entry => entry.status === 'ok' && entry.note === null));
  assert.equal(done.obs.aiCitations[0].cells.chatgpt.cited, true);
  assert.equal(done.obs.conditions.chatgpt, conditionText('chatgpt', true));
  const chatVisits = full.state.opened.filter(visit => visit.site === 'chatgpt');
  assert.deepEqual([chatVisits[0].url, chatVisits[0].preflight, chatVisits.length], [CHATGPT_PREFLIGHT_URL, true, 21], 'the preflight comes before the first question');
  const unlimited = harness(answering);
  const oneGo = await observe({ def, obs: buildTemplate(def, MONTH), pageBudget: {} }, unlimited.deps);
  assert.deepEqual([unlimited.state.opened.length, oneGo.report.complete], [121 + 1, true], 'without a budget one run opens every page');

  const again = harness(answering, { start: new Date(2026, 10, 28, 9, 0, 0) });
  const idle = await observe({ def, obs: done.obs }, again.deps);
  assert.deepEqual([again.state.opened.length, again.state.saves.length, idle.changed], [0, 0, false], 'a completed month is a no-op');
  assert.deepEqual(idle.obs, done.obs);

  const stuck = harness(noticeDialog, { start: new Date(2026, 10, 29, 9, 0, 0) });
  const blockedAgain = await observe({ def, obs: two.obs, engines: ['chatgpt'] }, stuck.deps);
  assert.deepEqual([stuck.state.opened.length, stuck.state.saves.length, blockedAgain.changed], [1, 0, false], 'a still-blocked engine costs one preflight and no write');

  const redo = harness(answering, { start: new Date(2026, 10, 28, 9, 0, 0) });
  const redone = await observe({ def, obs: done.obs, engines: ['naver'], limit: 2, redo: true }, redo.deps);
  assert.deepEqual([redo.state.opened.length, redone.obs.run.completedAt], [2, done.obs.run.completedAt]);

  const late = harness(answering, { start: new Date(2026, 11, 1, 9, 0, 0) });
  await assert.rejects(() => observe({ def, obs: buildTemplate(def, MONTH), limit: 1 }, late.deps), /only be recorded during their own month/);
  assert.equal(late.state.opened.length, 0);
});

test('an engine that shows no AI answer for ten cells in a row is flagged instead of silently recorded', async () => {
  const silent = harness((url, site, options) => (site === 'google' ? googlePage() : answering(url, site, options)));
  const { obs } = await observe({ def, obs: buildTemplate(def, MONTH), engines: ['googleAiOverview', 'naverAiBriefing'], limit: STALE_RUN }, silent.deps);
  assert.deepEqual(obs.aiCitations.slice(0, STALE_RUN).map(row => row.cells.googleAiOverview.answerShown), Array(STALE_RUN).fill(false));
  assert.deepEqual(obs.run.warnings.map(warning => [warning.code, warning.engine]), [['extractor_may_be_stale', 'googleAiOverview']]);
  assert.match(obs.run.warnings[0].message, /^측정한 10칸 모두 AI 답이 없다고 기록됐습니다.*extractor may be stale/);
  assert.deepEqual(observationProblems(obs, def, { month: MONTH }), []);
  assert.match(formatSummary(summarize(def, [obs])), /\n  주의 · 구글 AI 개요: 측정한 10칸 모두 AI 답이 없다고 기록됐습니다/);
  assert.match(notificationLine(def, obs), /주의 1건/);

  const nine = harness((url, site) => (site === 'google' ? googlePage() : null));
  const short = await observe({ def, obs: buildTemplate(def, MONTH), engines: ['googleAiOverview'], limit: STALE_RUN - 1 }, nine.deps);
  assert.deepEqual(short.obs.run.warnings, [], 'nine silent cells are not yet a pattern');

  const kept = await observe({ def, obs, engines: ['naver'], limit: 1 }, harness(answering).deps);
  assert.equal(kept.obs.run.warnings.length, 1, 'a later run of another engine keeps the warning');
  const cleared = await observe({ def, obs, engines: ['googleAiOverview'], limit: 1 }, harness(answering).deps);
  assert.deepEqual(cleared.obs.run.warnings, [], 'an answer in a later run clears it');

  const few = runWarnings(def, buildTemplate(def, MONTH), [], { organicCounts: new Map([['naver', Array(10).fill(2)], ['google', Array(10).fill(7)]]) });
  assert.deepEqual(few.map(warning => [warning.code, warning.engine]), [['few_results_parsed', 'naver']]);
  const signedOut = harness((url, site, options) => ({ ...answering(url, site, options), data: { ...answering(url, site, options).data, signedIn: false } }));
  const firstCell = await observe({ def, obs, engines: ['google'], limit: 1 }, signedOut.deps);
  assert.equal(firstCell.obs.run.warnings.some(warning => warning.code === 'conditions_changed'), false, 'the first cell of an engine sets its conditions');
  const signedInLater = await observe({ def, obs: firstCell.obs, engines: ['google'], limit: 1 }, harness(answering).deps);
  assert.deepEqual(signedInLater.obs.run.warnings.filter(warning => warning.code === 'conditions_changed').map(warning => warning.engine), ['google']);
  assert.equal(signedInLater.obs.conditions.google, conditionText('google', false), 'the recorded conditions are not rewritten');
});

test('the run record is validated: complete means no null cell, ok means the engine has none', () => {
  const engineStatus = Object.fromEntries([...def.engines.aiCitation, ...def.engines.nameSearch].map(engine => [engine.id, null]));
  const base = () => ({ ...buildTemplate(def, MONTH), run: { tool: TOOL, lastRunAt: '2026-11-26T03:00:00.000Z', completedAt: null, engineStatus: copy(engineStatus), warnings: [] } });
  const problems = change => { const obs = base(); change(obs); return observationProblems(obs, def, { month: MONTH }).join('\n'); };
  assert.equal(problems(() => {}), '');
  assert.deepEqual(runProblems(base().run, def, base()), []);
  assert.match(problems(o => { o.run.extra = 1; }), /run must be an object with exactly/);
  assert.match(problems(o => { o.run = null; }), /run must be an object with exactly/);
  assert.match(problems(o => { o.run.tool = ''; }), /run\.tool/);
  assert.match(problems(o => { o.run.lastRunAt = '2026-11-26'; }), /run\.lastRunAt/);
  assert.match(problems(o => { o.run.lastRunAt = '2026-11-31T03:00:00.000Z'; }), /run\.lastRunAt/);
  assert.match(problems(o => { o.run.completedAt = '2026-11-26T03:00:00.000Z'; }), /completedAt is set although cells are still null/);
  assert.match(problems(o => { o.run.completedAt = 'yes'; }), /completedAt must be null or a UTC instant/);
  assert.match(problems(o => { delete o.run.engineStatus.naver; }), /run\.engineStatus must hold exactly/);
  assert.match(problems(o => { o.run.engineStatus.google = { status: 'ok', note: null }; }), /status is ok although google cells are still null/);
  assert.match(problems(o => { o.run.engineStatus.google = { status: 'done', note: null }; }), /run\.engineStatus\.google must be null or/);
  assert.match(problems(o => { o.run.engineStatus.chatgpt = { status: 'blocked', note: null }; }), /note must say why the engine was blocked/);
  assert.match(problems(o => { o.run.engineStatus.google = { status: 'stopped', note: null }; }), /note must say why the engine was stopped/);
  assert.equal(problems(o => { o.run.engineStatus.google = { status: 'partial', note: null }; }), '');
  assert.match(problems(o => { o.run.warnings = [{ code: 'other', engine: null, message: 'x' }]; }), /run\.warnings\[0\]/);
  assert.match(problems(o => { o.run.warnings = [{ code: 'extractor_may_be_stale', engine: 'daum', message: 'x' }]; }), /run\.warnings\[0\]/);
  assert.match(problems(o => { o.run.warnings = Array(2).fill({ code: 'extractor_may_be_stale', engine: 'google', message: 'x' }); }), /one entry per code and engine/);
  assert.match(problems(o => { o.run.warnings = 'none'; }), /run\.warnings must be a list/);
  assert.match(observationProblems({ ...buildTemplate(def, MONTH), extra: 1 }, def, { month: MONTH }).join('\n'), /plus an optional run/);
  assert.equal(isMonthComplete(buildTemplate(def, MONTH)), false);
  assert.deepEqual([isInstant('2026-11-26T03:00:00.000Z'), isInstant('2026-11-26T03:00:00Z'), isInstant('2026-11-26T12:00:00.000+09:00'), isInstant(null)], [true, false, false, false]);
});

test('the notification line counts citations over measured cells and never turns unmeasured into zero', async () => {
  assert.equal(notificationLine(def, buildTemplate(def, MONTH)), '2026-11 AI 인용 측정 안 됨 (측정 0/60) · 기관명 10위 안 측정 안 됨 (측정 0/60) · 남음: ChatGPT 검색 0/20, 구글 AI 개요 0/20, 네이버 AI 브리핑 0/20, 구글 검색 0/30, 네이버 검색 0/30');
  const partial = await observe({ def, obs: buildTemplate(def, MONTH), limit: 2 }, harness(noticeDialog).deps);
  assert.equal(notificationLine(def, partial.obs), '2026-11 AI 인용 0/4칸 (측정 4/60) · 기관명 10위 안 0/4 (측정 4/60) · 남음: ChatGPT 검색 0/20(막힘), 구글 AI 개요 2/20(일부), 네이버 AI 브리핑 2/20(일부), 구글 검색 2/30(일부), 네이버 검색 2/30(일부)');
  const full = await observe({ def, obs: buildTemplate(def, MONTH), pageBudget: {} }, harness(answering).deps);
  assert.equal(notificationLine(def, full.obs), '2026-11 AI 인용 20/60칸 (측정 60/60) · 기관명 10위 안 0/60 (측정 60/60) · 모든 칸 기록');
  const text = formatSummary(summarize(def, [partial.obs]));
  assert.match(text, /\[자동 실행\]/);
  assert.match(text, /2026-11: 아직 빈 칸 있음 · 마지막 실행 \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\n/);
  assert.match(text, /ChatGPT 검색: 막힘 — 임시 채팅 안내 창/);
  assert.match(formatSummary(summarize(def, [full.obs])), /2026-11: 모든 칸 기록 완료\(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC\) · 마지막 실행 /);
  assert.doesNotMatch(formatSummary(summarize(def, [buildTemplate(def, MONTH)])), /자동 실행/);
});

test('aside output is read from the sentinel line in JSON or plain form', () => {
  const body = { finalAllowed: true, data: { organic: [] } };
  const json = JSON.stringify({ run: { content: [{ type: 'text', text: `✔︎ Opened a new tab\n${SENTINEL}${JSON.stringify(body)}\n[system] last tab closed.` }], error: null, elapsedMs: 5000 } });
  assert.deepEqual(parseAsideOutput(json), { page: body, error: null });
  assert.deepEqual(parseAsideOutput(`noise\n${SENTINEL}${JSON.stringify(body)}\n`), { page: body, error: null });
  assert.deepEqual(parseAsideOutput(JSON.stringify({ run: { content: [{ type: 'text', text: '' }], error: 'Error: boom\n    at <eval>', elapsedMs: 6 } })), { page: null, error: 'Error: boom' });
  assert.deepEqual(parseAsideOutput(`${SENTINEL}{broken`), { page: null, error: 'unreadable result line' });
  assert.deepEqual(parseAsideOutput(''), { page: null, error: 'no result line' });
});

test('CLI: dry-run plans without a browser, and a run through ASIDE_BIN writes the month file and sanitized evidence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-observe-'));
  try {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const dir = path.join(tmp, 'obs');
    const evidence = path.join(tmp, 'evidence');
    const calls = path.join(tmp, 'calls.log');
    const fake = path.join(tmp, 'fake-aside.mjs');
    const result = bingPage({ countText: '12결과', items: [{ cite: 'https://dentaldatalab.com › guides', title: '치과데이터랩' }] }, { tree: '- main:\n  - link "owner@example.com" [ref=e1]\n  - text: "12결과"' });
    fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const script = fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8');
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: args.slice(0, 3), bing: script.includes(${JSON.stringify(JSON.stringify(BING_SITE_URL))}) }) + '\\n');
console.log(JSON.stringify({ run: { content: [{ type: 'text', text: 'opened\\n' + ${JSON.stringify(SENTINEL)} + ${JSON.stringify(JSON.stringify(result))} }], error: null, elapsedMs: 5000 } }));
`);
    fs.chmodSync(fake, 0o755);
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--dir', dir, '--evidence-dir', evidence], { encoding: 'utf8', env: { ...process.env, ASIDE_BIN: fake } });

    const usage = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(usage.status, 1);
    assert.match(usage.stdout, /--month YYYY-MM/);
    const dry = run('--month', month, '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual([JSON.parse(dry.stdout).planned, JSON.parse(dry.stdout).exists, fs.existsSync(dir), fs.existsSync(calls)], [121, false, false, false], 'a dry run opens nothing and writes nothing');
    assert.equal(run('--month', month, '--is-complete').status, 1);
    assert.equal(run('--month', month, '--kind', 'video').status, 1);
    assert.equal(run('--month', month, '--engine', 'daum').status, 1);
    assert.equal(run('--month', month, '--limit', '0').status, 1);

    const observed = run('--month', month, '--engine', 'bing');
    assert.equal(observed.status, 0, observed.stderr);
    assert.match(observed.stdout, /bing site → bingSiteResults 12/);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, month + '.json'), 'utf8'));
    assert.deepEqual(observationProblems(saved, def, { month }), []);
    assert.deepEqual([saved.gateInputs.bingSiteResults, saved.observedOn.slice(0, 7), saved.run.completedAt], [12, month, null]);
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [{ args: ['repl', '--json', '--file'], bing: true }]);
    const text = fs.readFileSync(path.join(evidence, month, 'bing', 'site.txt'), 'utf8');
    assert.match(text, /countLabel: 12결과/);
    assert.equal(text.includes('owner@example.com'), false);
    assert.deepEqual(fs.readdirSync(dir), [month + '.json'], 'no temporary file is left behind');

    const again = run('--month', month, '--engine', 'bing');
    assert.equal(JSON.parse(again.stdout.slice(again.stdout.indexOf('{'))).changed, false);
    assert.equal(fs.readFileSync(calls, 'utf8').trim().split('\n').length, 1, 'a recorded gate input is not read again');
    assert.equal(run('--month', month, '--is-complete').status, 1);
    assert.match(run('--month', month, '--notification').stdout, new RegExp(`^${month} AI 인용 측정 안 됨`));

    fs.writeFileSync(path.join(dir, month + '.json'), '{"month":"broken"}');
    const broken = run('--month', month, '--engine', 'bing');
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /is not a valid month file/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the daily runner commits only the month file, stays quiet when nothing changes and skips a completed month', async t => {
  if (spawnSync('git', ['--version']).status !== 0 || spawnSync('bash', ['-c', 'true']).status !== 0) return t.skip('needs git and bash');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'growth-run-'));
  try {
    const source = fileURLToPath(new URL('..', import.meta.url));
    const repo = path.join(tmp, 'repo');
    // The two scripts plus whatever they import, so the copy keeps working when their imports change.
    const needed = new Set(['scripts/growth-monitor-run.sh', 'data/content/growth-monitor.json']);
    const follow = file => {
      if (needed.has(file) || !fs.existsSync(path.join(source, file))) return;
      needed.add(file);
      for (const [, a, b] of fs.readFileSync(path.join(source, file), 'utf8').matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) follow(path.join(path.dirname(file), a ?? b));
    };
    ['scripts/growth-observe.mjs', 'scripts/growth-monitor.mjs'].forEach(follow);
    for (const file of needed) {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      fs.copyFileSync(path.join(source, file), path.join(repo, file));
    }
    fs.writeFileSync(path.join(repo, '.gitignore'), '/data/research/*\n');
    fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'committed\n');
    const calls = path.join(tmp, 'calls.log');
    const fake = path.join(tmp, 'fake-aside.mjs');
    const pages = {
      bing: bingPage({ countText: '12결과' }),
      chatgpt: chatgptPage({ dialog: 'temporary-chat-notice', asked: false }),
      challenge: { finalAllowed: false, finalPage: 'https://www.google.com/sorry', data: null, tree: null },
    };
    fs.writeFileSync(fake, `#!/usr/bin/env node
import fs from 'node:fs';
const args = process.argv.slice(2);
const script = fs.readFileSync(args[args.indexOf('--file') + 1], 'utf8');
const pages = ${JSON.stringify(pages)};
const site = script.includes('const url = "https://www.bing.com/') ? 'bing' : script.includes('const url = "https://chatgpt.com/') ? 'chatgpt' : 'challenge';
fs.appendFileSync(${JSON.stringify(calls)}, site + '\\n');
console.log(JSON.stringify({ run: { content: [{ type: 'text', text: ${JSON.stringify(SENTINEL)} + JSON.stringify(pages[site]) }], error: null, elapsedMs: 1 } }));
`);
    fs.chmodSync(fake, 0o755);
    const env = {
      ...process.env, ASIDE_BIN: fake, NODE_BIN: process.execPath, GROWTH_NOTIFY: '0', GROWTH_SKIP_PULL: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'runner test', GIT_AUTHOR_EMAIL: 'runner@test.invalid', GIT_COMMITTER_NAME: 'runner test', GIT_COMMITTER_EMAIL: 'runner@test.invalid',
    };
    const git = (...args) => { const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8', env }); assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`); return result.stdout.trim(); };
    const runner = () => spawnSync('bash', [path.join(repo, 'scripts/growth-monitor-run.sh')], { cwd: tmp, encoding: 'utf8', env });
    const seen = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : []);
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'Base');
    fs.writeFileSync(path.join(repo, 'unrelated.txt'), 'staged by someone else\n');
    git('add', 'unrelated.txt');

    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const monthFile = `data/content/growth-observations/${month}.json`;
    const first = runner();
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(seen().sort(), ['bing', 'challenge', 'challenge', 'chatgpt']);
    assert.equal(git('rev-list', '--count', 'HEAD'), '2');
    assert.equal(git('log', '-1', '--format=%s'), `Record the ${month} growth observations (automated run)`);
    assert.equal(git('show', '--name-only', '--format=', 'HEAD'), monthFile, 'the commit holds the month file and nothing else');
    assert.equal(git('diff', '--cached', '--name-only'), 'unrelated.txt', 'someone else\'s staged change is left staged and uncommitted');
    const saved = JSON.parse(fs.readFileSync(path.join(repo, monthFile), 'utf8'));
    assert.deepEqual(observationProblems(saved, def, { month }), []);
    assert.deepEqual([saved.gateInputs.bingSiteResults, saved.run.engineStatus.chatgpt.status, saved.run.engineStatus.google.status, saved.run.engineStatus.naver.status, saved.run.completedAt], [12, 'blocked', 'stopped', 'stopped', null]);
    assert.match(fs.readFileSync(path.join(repo, `data/research/growth-monitor/run-${month}.log`), 'utf8'), /observer exit: 0/);
    assert.match(fs.readFileSync(path.join(repo, `data/research/growth-monitor/summary-${month}.txt`), 'utf8'), /\[자동 실행\]/);
    assert.equal(git('status', '--porcelain'), 'M  unrelated.txt', 'logs and evidence are ignored');
    assert.equal(fs.existsSync(path.join(repo, 'data/research/growth-monitor/.run.lock')), false);

    const second = runner();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(seen().length, 4 + 3, 'the open cells are tried again, the recorded Bing count is not');
    assert.equal(git('rev-list', '--count', 'HEAD'), '2', 'nothing new was recorded, so nothing is committed');
    assert.match(fs.readFileSync(path.join(repo, `data/research/growth-monitor/run-${month}.log`), 'utf8'), /no change\n$/);

    fs.mkdirSync(path.join(repo, 'data/research/growth-monitor/.run.lock'));
    assert.equal(runner().status, 0);
    assert.equal(seen().length, 7, 'a second runner does nothing while one holds the lock');
    fs.rmdirSync(path.join(repo, 'data/research/growth-monitor/.run.lock'));

    const complete = await observe({ def, obs: buildTemplate(def, month), pageBudget: {} }, harness(answering, { start: new Date() }).deps);
    fs.writeFileSync(path.join(repo, monthFile), JSON.stringify(complete.obs, null, 2) + '\n');
    const third = runner();
    assert.equal(third.status, 0, third.stderr);
    assert.deepEqual([seen().length, git('rev-list', '--count', 'HEAD')], [7, '2'], 'a completed month opens no tab and commits nothing');

    fs.writeFileSync(path.join(repo, monthFile), '{"month":"broken"}\n');
    const broken = runner();
    assert.equal(broken.status, 1, 'an invalid month file is reported, not committed');
    assert.equal(git('rev-list', '--count', 'HEAD'), '2');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
