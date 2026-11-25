import test from 'node:test';
import assert from 'node:assert/strict';
import { esc } from '../src/shared.mjs';
import {
  infoCardSnippet, infoCardTextLink, infoCardImageSnippet, infoCardBadgeSvg, infoCardPanel, registerInfoCardPages,
  INFO_CARD_ROUTE, INFO_CARD_BADGES, INFO_CARD_BADGE_SIZE, INFO_CARD_LABEL, INFO_CARD_ACTION, INFO_CARD_DISCLAIMER, INFO_CARD_USAGE_RULE,
} from '../scripts/hospital-info-card.mjs';

const DOMAIN = 'https://dentaldatalab.com';
// Words that would turn a registry link into a claim of certification, endorsement, ranking or partnership.
const BANNED = ['인증', '추천', '우수', '선정', '제휴', '공식 인정', '보증', '1위', '최고'];
const clinic = (id, name, typeCode, sido = '서울', city = '강남구') => ({
  id, name, typeCode, type: typeCode === '41' ? '치과병원' : '치과의원', sidoCode: '110000', sido, cityCode: '110023', city,
});
const hospital = clinic('c-00000000000a', '하나치과병원', '41');
const hostileName = '<img src=x onerror=alert(1)>대학치과병원 & "따옴표" \'작은따옴표\'';
const hostile = clinic('c-00000000000b', hostileName, '41', '서울', '서초구');
const fixture = () => [
  hospital,
  clinic('c-000000000002', '가나치과병원', '41'),
  hostile,
  clinic('c-000000000004', '까치치과병원', '41', '부산', '부산수영구'),
  clinic('c-000000000005', '365하루치과병원', '41', '경기', '평택시'),
  clinic('c-000000000006', '가나치과병원', '41', '대구', '대구중구'),
  clinic('c-000000000007', '다라치과의원', '51'),
  clinic('c-000000000008', '가가치과의원', '51', '제주', '제주시'),
];
function render(clinics = fixture()) {
  const pages = new Map(), files = new Map();
  const result = registerInfoCardPages({ page: (route, opts) => pages.set(route, opts), put: (file, body) => files.set(file, body), clinics, domain: DOMAIN, snapshotDate: '2026-09-30' });
  return { pages, files, result, page: pages.get(INFO_CARD_ROUTE) };
}

const count = (text, part) => text.split(part).length - 1;
const anchors = html => [...html.matchAll(/<a\s[^>]*>/g)].map(m => m[0]);
// What a browser hands to textContent: tags removed, character references decoded once.
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"' };
const browserText = html => html.replace(/<[^>]+>/g, '').replace(/&(?:#(\d+)|(amp|lt|gt|quot));/g, (_, code, name) => code ? String.fromCharCode(Number(code)) : NAMED[name]);
const codeOf = (html, id) => {
  const found = html.match(new RegExp(`<pre id="${id}"[^>]*><code[^>]*>([\\s\\S]*?)</code></pre>`));
  assert.ok(found, `missing <pre id="${id}">`);
  return browserText(found[1]);
};
const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// An event-handler attribute on any tag. Quoted attribute values are emptied first: an escaped name inside alt="" is inert text.
const hasEventAttribute = html => /<[^>]*\son\w+\s*=/i.test(html.replace(/"[^"]*"/g, '""'));
const assertNoBanned = (text, where) => { for (const word of BANNED) assert.ok(!text.includes(word), `${where}: ${word}`); };

test('card snippet is self-contained with exactly one link to the canonical institution page', () => {
  const html = infoCardSnippet(hospital, { domain: DOMAIN });
  assert.deepEqual(anchors(html).map(a => a.match(/href="([^"]*)"/)[1]), ['https://dentaldatalab.com/clinics/c-00000000000a/']);
  assert.equal(count(html, '</a>'), 1);
  assert.equal(count(html, 'href='), 1);
  assert.match(html, /<a href="https:\/\/dentaldatalab\.com\/clinics\/c-00000000000a\/"[^>]*>하나치과병원 · 치과데이터랩에서 등록 정보 보기<\/a>/);
  assert.equal(browserText(html), `${INFO_CARD_LABEL}하나치과병원 · ${INFO_CARD_ACTION}`);
  assert.equal(INFO_CARD_LABEL, '건강보험심사평가원 등록 정보 확인');
  // Inline styles only: nothing is fetched from anywhere and nothing can run.
  for (const external of ['src=', 'url(', '@import', '<script', '<link', '<img', '<style', '<iframe', 'class=']) assert.ok(!html.toLowerCase().includes(external), external);
  assert.ok(!hasEventAttribute(html));
  // One line, so CMS editors that turn newlines into <br> leave it alone.
  assert.ok(!/[\r\n]/.test(html));
  // The snapshot date would go stale on the hospital's site.
  assert.ok(!/\d{4}[-.]\d{2}[-.]\d{2}|기준일/.test(html));
  assert.equal(infoCardSnippet(hospital), html, 'defaults to the production origin');
  assert.match(infoCardSnippet(hospital, { domain: 'https://example.test' }), /href="https:\/\/example\.test\/clinics\/c-00000000000a\/"/);
});

test('card text stays visible: no hiding styles, readable contrast on its own background', () => {
  const html = infoCardSnippet(hospital, { domain: DOMAIN });
  for (const hidden of ['display:none', 'visibility:hidden', 'opacity:0', 'font-size:0', 'text-indent', 'position:absolute', 'height:0', 'width:0', 'clip']) assert.ok(!html.includes(hidden), hidden);
  // Container, label and link each carry their own text and background colour, so a host stylesheet or dark-mode plugin
  // that repaints one of them cannot leave dark text on a dark box.
  const styles = [...html.matchAll(/ style="([^"]*)"/g)].map(m => m[1]);
  assert.equal(styles.length, 3);
  assert.equal(count(html, '!important'), 6, 'only the six colour declarations are forced');
  for (const style of styles) {
    const background = style.match(/(?:^|;)background-color:(#[0-9a-f]{6}) !important/), colour = style.match(/(?:^|;)color:(#[0-9a-f]{6}) !important/);
    assert.ok(background && colour, style);
    assert.equal(background[1], '#ffffff');
    assert.ok(contrast(colour[1], background[1]) >= 7, `${colour[1]} on ${background[1]}`);
  }
  for (const size of [...html.matchAll(/font-size:(\d+)px/g)].map(m => Number(m[1]))) assert.ok(size >= 12, `font-size ${size}px`);
  assert.match(html, /text-decoration:underline/);
});

test('text link variant is one plain anchor on one line', () => {
  const html = infoCardTextLink(hospital, { domain: DOMAIN });
  assert.equal(html, '<a href="https://dentaldatalab.com/clinics/c-00000000000a/" target="_blank" rel="noopener">하나치과병원 건강보험심사평가원 등록 정보 확인 · 치과데이터랩</a>');
  assert.equal(anchors(html).length, 1);
  assert.ok(!/[\r\n]/.test(html));
});

test('image variant links the hosted badge without inline styles', () => {
  const light = infoCardImageSnippet(hospital, { domain: DOMAIN }), dark = infoCardImageSnippet(hospital, { domain: DOMAIN, dark: true });
  assert.equal(light, '<a href="https://dentaldatalab.com/clinics/c-00000000000a/" target="_blank" rel="noopener"><img src="https://dentaldatalab.com/badge/hira-registered-info.svg" alt="하나치과병원 건강보험심사평가원 등록 정보 확인 · 치과데이터랩" width="288" height="64"></a>');
  assert.match(dark, /<img src="https:\/\/dentaldatalab\.com\/badge\/hira-registered-info-dark\.svg" /);
  for (const html of [light, dark]) {
    assert.equal(anchors(html).length, 1);
    assert.equal(count(html, '<img '), 1);
    assert.ok(!html.includes('style='));
    assert.ok(!html.includes('<script'));
  }
  assert.deepEqual(INFO_CARD_BADGES, { light: '/badge/hira-registered-info.svg', dark: '/badge/hira-registered-info-dark.svg' });
});

test('a hostile institution name is escaped in every variant', () => {
  for (const [label, html] of [['card', infoCardSnippet(hostile, { domain: DOMAIN })], ['text', infoCardTextLink(hostile, { domain: DOMAIN })], ['image', infoCardImageSnippet(hostile, { domain: DOMAIN })]]) {
    assert.ok(!html.includes(hostileName), label);
    assert.ok(!html.includes('<img src=x'), label);
    assert.ok(!html.includes('onerror=alert(1)>'), label);
    assert.ok(html.includes(esc(hostileName)), label);
    assert.equal(anchors(html).length, 1, label);
    assert.equal(count(html, '<img'), label === 'image' ? 1 : 0, label);
    // The name must not break out of the alt attribute or add attributes of its own.
    assert.ok(!hasEventAttribute(html), label);
  }
  assert.equal(browserText(infoCardTextLink(hostile, { domain: DOMAIN })), `${hostileName} ${INFO_CARD_LABEL} · 치과데이터랩`);
});

test('unexpected ids, missing names and non-HTTPS origins fail loudly', () => {
  for (const bad of [clinic('c-123', '짧은치과병원', '41'), clinic('c-00000000000a"><script>', '주입치과병원', '41'), clinic('../../etc', '경로치과병원', '41'), { ...hospital, name: ' ' }, { ...hospital, name: undefined }, null]) {
    for (const make of [infoCardSnippet, infoCardTextLink, infoCardImageSnippet]) assert.throws(() => make(bad, { domain: DOMAIN }), TypeError);
  }
  assert.throws(() => infoCardSnippet(hospital, { domain: 'http://dentaldatalab.com' }));
  assert.throws(() => infoCardSnippet(hospital, { domain: 'https://dentaldatalab.com/path' }));
  assert.throws(() => infoCardSnippet(hospital, { domain: 'javascript:alert(1)' }));
});

test('hosted badges are small accessible SVGs with the card wording and readable contrast', () => {
  const light = infoCardBadgeSvg(), dark = infoCardBadgeSvg({ dark: true });
  assert.notEqual(light, dark);
  for (const [label, svg] of [['light', light], ['dark', dark]]) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="288" height="64" viewBox="0 0 288 64" role="img" /, label);
    const title = svg.match(/<title id="([^"]+)">([^<]+)<\/title>/), desc = svg.match(/<desc id="([^"]+)">([^<]+)<\/desc>/);
    assert.equal(title[2], INFO_CARD_LABEL, label);
    assert.ok(desc[2].length > 20, label);
    assert.ok(svg.includes(`aria-labelledby="${title[1]} ${desc[1]}"`), label);
    const texts = [...svg.matchAll(/<text [^>]*fill="(#[0-9a-f]{6})"[^>]*>([^<]+)<\/text>/g)];
    assert.deepEqual(texts.map(t => t[2]), [INFO_CARD_LABEL, INFO_CARD_ACTION], label);
    const background = svg.match(/<rect [^>]*fill="(#[0-9a-f]{6})" stroke=/)[1];
    for (const [, fill, text] of texts) assert.ok(contrast(fill, background) >= 7, `${label}: ${text} ${fill} on ${background}`);
    // Rendered through <img> on other sites: no script, no stylesheet, nothing fetched.
    for (const external of ['<script', '<style', 'style=', 'href', 'url(', '<image', '<foreignObject', '@import', '<a ']) assert.ok(!svg.includes(external), `${label}: ${external}`);
    assert.equal(count(svg, 'http'), 1, `${label}: only the SVG namespace`);
    assert.ok(Buffer.byteLength(svg) < 2048, label);
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(svg), label);
  }
  assert.equal(INFO_CARD_BADGE_SIZE.width, 288);
  assert.equal(INFO_CARD_BADGE_SIZE.height, 64);
  assert.ok(contrast(light.match(/<rect [^>]*fill="(#[0-9a-f]{6})" stroke=/)[1], dark.match(/<rect [^>]*fill="(#[0-9a-f]{6})" stroke=/)[1]) >= 7, 'the dark variant has a dark background');
});

test('panel is rendered for dental hospitals (종별코드 41) only', () => {
  assert.equal(infoCardPanel(clinic('c-000000000007', '다라치과의원', '51'), { domain: DOMAIN }), '');
  assert.equal(infoCardPanel({ ...hospital, typeCode: 41 }, { domain: DOMAIN }), '', 'typeCode is the source string');
  assert.equal(infoCardPanel(null, { domain: DOMAIN }), '');
  assert.equal(infoCardPanel(undefined), '');
  assert.match(infoCardPanel(hospital, { domain: DOMAIN }), /^<section class="fact-panel" id="info-card">/);
});

test('panel shows a same-origin preview, copy-ready code and the two usage sentences', () => {
  const panel = infoCardPanel(hospital, { domain: DOMAIN });
  assert.equal(count(panel, 'id="info-card"'), 1);
  assert.equal(count(panel, '<h2'), 1);
  assert.equal(count(panel, '<h1'), 0);
  // Every copy button points at a <pre> that exists, through the handler src/app.mjs already has.
  const targets = [...panel.matchAll(/<button type="button" class="btn [a-z]+" data-copy-citation data-citation-target="([^"]+)" data-copy-message="코드를 복사했습니다.">/g)].map(m => m[1]);
  assert.deepEqual(targets, ['info-card-code', 'info-card-code-text', 'info-card-code-image', 'info-card-code-image-dark']);
  for (const id of targets) assert.equal(count(panel, `id="${id}"`), 1, id);
  // What the button copies is exactly the snippet for this institution on the canonical origin.
  assert.equal(codeOf(panel, 'info-card-code'), infoCardSnippet(hospital, { domain: DOMAIN }));
  assert.equal(codeOf(panel, 'info-card-code-text'), infoCardTextLink(hospital, { domain: DOMAIN }));
  assert.equal(codeOf(panel, 'info-card-code-image'), infoCardImageSnippet(hospital, { domain: DOMAIN }));
  assert.equal(codeOf(panel, 'info-card-code-image-dark'), infoCardImageSnippet(hospital, { domain: DOMAIN, dark: true }));
  // Live previews stay on this origin: CSP img-src 'self' and review builds on other hosts.
  assert.equal(count(panel, '<a href="/clinics/c-00000000000a/" target="_blank" rel="noopener"'), 4);
  assert.ok(panel.includes('<img src="/badge/hira-registered-info.svg" '));
  assert.ok(panel.includes('<img src="/badge/hira-registered-info-dark.svg" '));
  assert.ok(!/(?:href|src)="https?:/.test(panel), 'absolute URLs appear only as escaped sample code');
  assert.ok(panel.includes(`href="${INFO_CARD_ROUTE}"`));
  assert.ok(panel.includes(`<p class="subtle-note" style="margin-top:16px">${INFO_CARD_DISCLAIMER} ${INFO_CARD_USAGE_RULE}</p>`));
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(panel));
  assert.ok(!panel.includes('<script'));
});

test('panel sample code survives a hostile name without leaking markup or double-escaped entities', () => {
  const panel = infoCardPanel(hostile, { domain: DOMAIN });
  assert.ok(!panel.includes(hostileName));
  assert.ok(!panel.includes('<img src=x'));
  assert.ok(!hasEventAttribute(panel));
  assert.ok(!panel.includes('&amp;amp;'), 'static QA treats &amp;amp; as an escaping bug');
  assert.equal(codeOf(panel, 'info-card-code'), infoCardSnippet(hostile, { domain: DOMAIN }));
  assert.equal(codeOf(panel, 'info-card-code-text'), infoCardTextLink(hostile, { domain: DOMAIN }));
  assert.equal(codeOf(panel, 'info-card-code-image'), infoCardImageSnippet(hostile, { domain: DOMAIN }));
  assert.equal(count(panel, '<img '), 2, 'only the two badge previews are images');
});

test('instructions page is registered once under 치과병원 with the two badge files', () => {
  const { pages, files, result, page } = render();
  assert.deepEqual([...pages.keys()], ['/hospitals/info-card/']);
  assert.deepEqual([...files.keys()], ['badge/hira-registered-info.svg', 'badge/hira-registered-info-dark.svg']);
  assert.equal(files.get('badge/hira-registered-info.svg'), infoCardBadgeSvg());
  assert.equal(files.get('badge/hira-registered-info-dark.svg'), infoCardBadgeSvg({ dark: true }));
  assert.deepEqual(result, { route: '/hospitals/info-card/', total: 6, badges: ['/badge/hira-registered-info.svg', '/badge/hira-registered-info-dark.svg'] });
  assert.equal(count(page.body, '<h1'), 1);
  assert.deepEqual(page.breadcrumb, [{ label: '치과병원', url: '/hospitals/' }, { label: '등록 정보 확인 카드' }]);
  assert.equal(page.schema, undefined, 'no ItemList or other extra schema');
  assert.ok(page.title.length > 10 && page.description.length > 40);
});

test('instructions copy: counts from the data, what the card is, free of charge, how to use it, wording rules', () => {
  const { page } = render();
  assert.match(page.description, /^치과병원 6곳이 /);
  assert.match(page.body, /치과병원\(종별코드 41\)으로 등록된 6곳이/);
  assert.match(page.body, /<h2>치과병원 6곳 · 가나다순<\/h2>/);
  assert.match(page.body, /2026-09-30/);
  const fewer = render(fixture().filter(c => c.id !== 'c-000000000004')).page;
  assert.match(fewer.description, /^치과병원 5곳이 /);
  assert.match(fewer.body, /<h2>치과병원 5곳 · 가나다순<\/h2>/);
  for (const id of ['what', 'terms', 'how', 'rules', 'sample', 'institutions']) assert.equal(count(page.body, ` id="${id}"`), 1, id);
  assert.match(page.body, /카드 사용은 무료이고 신청 절차가 없습니다/);
  assert.match(page.body, /목록 순서\(가나다순\), 조건 검색 결과, 기관 페이지의 표시 내용에 영향을 주지 않습니다/);
  assert.match(page.body, /<code>#info-card<\/code>/);
  assert.match(page.body, /문구와 링크 주소는 바꾸지 않고 그대로 사용합니다/);
  assert.match(page.body, /<code>rel=&quot;nofollow&quot;<\/code>를 추가해도 됩니다/);
  assert.match(page.body, /건강보험심사평가원이 운영하는 사이트가 아닙니다/);
  assert.ok(page.body.includes('href="/hospitals/"'));
  assert.ok(page.body.includes('href="/corrections/"'));
});

test('instructions page shows the three variants for the first institution in 가나다순', () => {
  // Without the hostile fixture the first name in 가나다순 is the digit-initial one.
  const { page } = render(fixture().filter(c => c !== hostile));
  const example = clinic('c-000000000005', '365하루치과병원', '41', '경기', '평택시');
  assert.match(page.body, /가나다순 첫 기관인 365하루치과병원의 코드로 만든 예시/);
  assert.equal(codeOf(page.body, 'info-card-sample-code'), infoCardSnippet(example, { domain: DOMAIN }));
  assert.equal(codeOf(page.body, 'info-card-sample-code-text'), infoCardTextLink(example, { domain: DOMAIN }));
  assert.equal(codeOf(page.body, 'info-card-sample-code-image'), infoCardImageSnippet(example, { domain: DOMAIN }));
  assert.equal(codeOf(page.body, 'info-card-sample-code-image-dark'), infoCardImageSnippet(example, { domain: DOMAIN, dark: true }));
  const targets = [...page.body.matchAll(/data-copy-citation data-citation-target="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(targets, ['info-card-sample-code', 'info-card-sample-code-text', 'info-card-sample-code-image', 'info-card-sample-code-image-dark']);
  // Rendered samples link and load images on this origin; the canonical URLs exist only as escaped code.
  assert.equal(count(page.body, '<a href="/clinics/c-000000000005/" target="_blank" rel="noopener"'), 4);
  assert.ok(page.body.includes('<img src="/badge/hira-registered-info.svg" '));
  assert.ok(page.body.includes('<img src="/badge/hira-registered-info-dark.svg" '));
  assert.ok(!/(?:href|src)="https?:/.test(page.body));
});

test('institution list holds every 치과병원 once in 가나다순, linked to #info-card, and never a 치과의원', () => {
  const { page } = render();
  const list = page.body.slice(page.body.indexOf('id="institutions"'));
  const links = [...list.matchAll(/<a class="region-item"[^>]* href="\/clinics\/(c-[a-f0-9]{12})\/#info-card"><strong>([^<]*)<\/strong><span>([^<]*)<\/span><\/a>/g)];
  assert.deepEqual(links.map(m => m[1]), ['c-00000000000b', 'c-000000000005', 'c-000000000002', 'c-000000000006', 'c-000000000004', 'c-00000000000a']);
  assert.equal(count(list, 'class="region-item"'), 6);
  // Same-name institutions are told apart by their source region labels.
  assert.deepEqual(links.filter(m => m[2] === '가나치과병원').map(m => m[3]), ['서울 강남구', '대구 대구중구']);
  // 초성 headings in list order; ㄲ sits under ㄱ and non-Hangul initials share one heading.
  assert.deepEqual([...list.matchAll(/<h3 [^>]*>([^<]+) <small>(\d+)곳<\/small><\/h3>/g)].map(m => [m[1], Number(m[2])]), [['숫자·영문', 2], ['ㄱ', 3], ['ㅎ', 1]]);
  for (const forbidden of ['다라치과의원', '가가치과의원', 'c-000000000007', 'c-000000000008']) assert.ok(!page.body.includes(forbidden), forbidden);
  const empty = render(fixture().filter(c => c.typeCode !== '41')).page;
  assert.match(empty.description, /^치과병원 0곳이 /);
  assert.match(empty.body, /치과병원\(종별코드 41\)이 없습니다/);
  assert.equal(count(empty.body, ' id="sample"'), 0);
  assert.equal(count(empty.body, '<h1'), 1);
});

test('instructions page escapes a hostile name in the list, the sample and the sample code', () => {
  const { page } = render();
  const all = page.title + page.description + page.body;
  assert.ok(!all.includes(hostileName));
  assert.ok(!all.includes('<img src=x'));
  assert.ok(!hasEventAttribute(all));
  assert.ok(!all.includes('&amp;amp;'));
  assert.ok(all.includes(`<strong>${esc(hostileName)}</strong>`));
  assert.equal(codeOf(page.body, 'info-card-sample-code'), infoCardSnippet(hostile, { domain: DOMAIN }));
});

test('the disclaimer is one explicit “~이 아닙니다” sentence and appears where the card is explained', () => {
  assert.match(INFO_CARD_DISCLAIMER, /^이 카드는 건강보험심사평가원 등록 정보를 확인하는 링크이며, .+ 표시가 아닙니다\.$/);
  assert.equal(count(INFO_CARD_DISCLAIMER, '.'), 1, 'a single sentence');
  for (const denied of ['인증', '추천', '평가', '제휴', '순위']) assert.ok(INFO_CARD_DISCLAIMER.includes(denied), denied);
  assert.ok(INFO_CARD_DISCLAIMER.includes('인증·추천·평가·제휴·순위 표시가 아닙니다'));
  assert.equal(count(infoCardPanel(hospital, { domain: DOMAIN }), INFO_CARD_DISCLAIMER), 1);
  const { page } = render();
  assert.equal(count(page.body, INFO_CARD_DISCLAIMER), 2, 'under “what it is” and again in the wording rules');
  assert.ok(page.body.includes(`<strong>${INFO_CARD_DISCLAIMER}</strong>`));
  assert.match(INFO_CARD_USAGE_RULE, /그대로 사용하며, 사용은 무료이고 .+ 영향을 주지 않습니다\.$/);
});

test('no certification, endorsement, ranking or partnership wording outside that disclaimer', () => {
  // Card text in every form a visitor or crawler can read it.
  const cards = {
    card: infoCardSnippet(hospital, { domain: DOMAIN }), text: infoCardTextLink(hospital, { domain: DOMAIN }),
    image: infoCardImageSnippet(hospital, { domain: DOMAIN }), imageDark: infoCardImageSnippet(hospital, { domain: DOMAIN, dark: true }),
    badge: infoCardBadgeSvg(), badgeDark: infoCardBadgeSvg({ dark: true }), label: INFO_CARD_LABEL, action: INFO_CARD_ACTION, usageRule: INFO_CARD_USAGE_RULE,
  };
  for (const [where, text] of Object.entries(cards)) {
    assertNoBanned(text, where);
    assert.ok(!text.includes(INFO_CARD_DISCLAIMER), `${where}: the pasted card carries no disclaimer wording either`);
  }
  // Page and panel copy once the disclaimer sentence is taken out; the sentence itself is checked in the test above.
  const { page } = render();
  const withoutDisclaimer = text => text.split(INFO_CARD_DISCLAIMER).join('');
  assertNoBanned(withoutDisclaimer(page.title + '\n' + page.description + '\n' + page.body), 'instructions page');
  assertNoBanned(page.title + page.description, 'title and description');
  assertNoBanned(withoutDisclaimer(infoCardPanel(hospital, { domain: DOMAIN })), 'panel');
  // The guard itself: the disclaimer does contain guarded words, so leaving it in must trip.
  assert.throws(() => assertNoBanned(page.body, 'guard check'));
});

test('invalid page inputs fail loudly', () => {
  assert.throws(() => registerInfoCardPages({ page: null, put: () => {}, clinics: [] }), TypeError);
  assert.throws(() => registerInfoCardPages({ page: () => {}, put: null, clinics: [] }), TypeError);
  assert.throws(() => registerInfoCardPages({ page: () => {}, put: () => {}, clinics: 'nope' }), TypeError);
  assert.throws(() => registerInfoCardPages({ page: () => {}, put: () => {}, clinics: [], domain: 'http://insecure.test' }));
});
