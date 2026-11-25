import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  OUTBOUND_ROUTE, OUTBOUND_KINDS, OUTBOUND_MAX_BYTES, OUTBOUND_CLINIC, OUTBOUND_PAGE,
  outboundDataPoint, sameOriginRequest, smallBody,
} from '../scripts/outbound-events.mjs';
import { buildAssetInventory, KINDS } from '../scripts/clinic-assets.mjs';
import { assetItem, clinicAssetsPanel, observedWebsiteRow, OUTBOUND_KIND_BY_ASSET } from '../scripts/clinic-assets-pages.mjs';

const ID = 'c-0123456789ab';
const body = (overrides = {}) => JSON.stringify({ kind: 'tel', clinic: ID, page: `/clinics/${ID}/`, ...overrides });

test('a valid event becomes one data point: kind, clinic id and site section only', () => {
  for (const kind of OUTBOUND_KINDS) {
    assert.deepEqual(outboundDataPoint(body({ kind })), { blobs: [kind, ID, 'clinics'], doubles: [1], indexes: [ID] });
  }
  // Only the first path segment is kept; the rest of the page path is not stored.
  for (const [page, section] of [['/', 'home'], ['/find/', 'find'], ['/regions/110000/110001/page/5/', 'regions'], ['/guides/dental-hospital-30-beds/', 'guides']]) {
    assert.deepEqual(outboundDataPoint(body({ page })).blobs, ['tel', ID, section], page);
  }
  // Analytics Engine limits: at most 20 blobs, 20 doubles, exactly one index of at most 96 bytes.
  const point = outboundDataPoint(body());
  assert.equal(point.indexes.length, 1);
  assert(Buffer.byteLength(point.indexes[0]) <= 96 && point.blobs.every(blob => typeof blob === 'string' && blob.length <= 40));
});

test('anything but exactly {kind, clinic, page} with allowed values is dropped', () => {
  const rejected = {
    'not JSON': '{kind:tel}',
    'empty body': '',
    'JSON null': 'null',
    'array': JSON.stringify(['tel', ID, '/']),
    'string': JSON.stringify('tel'),
    'extra field': body({ visitor: 'abc' }),
    'missing page': JSON.stringify({ kind: 'tel', clinic: ID }),
    'unknown kind': body({ kind: 'sms' }),
    'kind in another case': body({ kind: 'TEL' }),
    'kind that is an Object.prototype key': body({ kind: 'constructor' }),
    'numeric kind': body({ kind: 1 }),
    'short clinic id': body({ clinic: 'c-0123' }),
    'upper-case clinic id': body({ clinic: 'c-0123456789AB' }),
    'clinic id with a trailing line break': body({ clinic: ID + '\n' }),
    'clinic id as array': body({ clinic: [ID] }),
    'page with a query string': body({ page: '/find/?q=secret' }),
    'page with a fragment': body({ page: `/clinics/${ID}/#hours` }),
    'absolute URL as page': body({ page: 'https://evil.example/' }),
    'protocol-relative page': body({ page: '//evil.example/' }),
    'page without trailing slash': body({ page: `/clinics/${ID}` }),
    'page naming a file': body({ page: '/find/index.html' }),
    'parent traversal': body({ page: '/clinics/../find/' }),
    'percent-encoded page': body({ page: '/%ED%95%9C/' }),
    'upper-case page': body({ page: '/Find/' }),
    'page deeper than any generated route': body({ page: '/a/b/c/d/e/f/g/h/i/' }),
    'page with a segment longer than 40 characters': body({ page: `/${'a'.repeat(41)}/` }),
    'numeric page': body({ page: 1 }),
  };
  for (const [label, text] of Object.entries(rejected)) assert.equal(outboundDataPoint(text), null, label);
  assert(OUTBOUND_CLINIC.test(ID) && OUTBOUND_PAGE.test('/') && !OUTBOUND_CLINIC.global && !OUTBOUND_PAGE.global, 'stateless patterns');
});

test('only requests a browser marks as same-origin are counted', () => {
  const origin = 'https://dentaldatalab.com';
  const check = headers => sameOriginRequest(new Headers(headers), origin);
  assert.equal(check({ Origin: origin, 'Sec-Fetch-Site': 'same-origin' }), true);
  assert.equal(check({ Origin: origin }), true, 'older browsers send Origin only');
  assert.equal(check({ 'Sec-Fetch-Site': 'same-origin' }), true);
  assert.equal(check({}), false, 'curl and most crawlers send neither header');
  assert.equal(check({ Origin: 'https://evil.example' }), false);
  assert.equal(check({ Origin: 'https://evil.example', 'Sec-Fetch-Site': 'same-origin' }), false);
  assert.equal(check({ Origin: origin, 'Sec-Fetch-Site': 'cross-site' }), false);
  assert.equal(check({ Origin: origin, 'Sec-Fetch-Site': 'same-site' }), false, 'a sibling subdomain is not this site');
  assert.equal(check({ 'Sec-Fetch-Site': 'none' }), false);
  assert.equal(check({ Origin: 'null' }), false);
  assert.equal(check({ Origin: 'http://dentaldatalab.com' }), false);
});

test('the body reader stops at the byte limit whether or not the length was declared', async () => {
  const post = (text, headers = {}) => new Request('https://example.test' + OUTBOUND_ROUTE, { method: 'POST', body: text, headers });
  assert.equal(await smallBody(post(body()), OUTBOUND_MAX_BYTES), body());
  assert.equal(await smallBody(post('x'.repeat(OUTBOUND_MAX_BYTES)), OUTBOUND_MAX_BYTES), 'x'.repeat(OUTBOUND_MAX_BYTES));
  assert.equal(await smallBody(post('x'.repeat(OUTBOUND_MAX_BYTES + 1)), OUTBOUND_MAX_BYTES), null);
  assert.equal(await smallBody(post('한'.repeat(200)), OUTBOUND_MAX_BYTES), null, 'the limit is bytes, not characters');
  assert.equal(await smallBody(new Request('https://example.test' + OUTBOUND_ROUTE, { method: 'POST' }), OUTBOUND_MAX_BYTES), null);
  // A declared length over the limit is refused without touching the stream.
  let touched = false;
  const declared = { headers: new Headers({ 'Content-Length': '100000' }), body: { getReader() { touched = true; throw new Error('must not read'); } } };
  assert.equal(await smallBody(declared, OUTBOUND_MAX_BYTES), null);
  assert.equal(touched, false);
  // An undeclared endless stream is cancelled as soon as it passes the limit.
  let pulls = 0, cancelled = false;
  const endless = { headers: new Headers(), body: new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(300)); }, cancel() { cancelled = true; } }) };
  assert.equal(await smallBody(endless, OUTBOUND_MAX_BYTES), null);
  assert(cancelled && pulls < 10, `stream cancelled after ${pulls} chunks`);
});

// The client is the one line appended to src/app.mjs. It is evaluated here as shipped, against a minimal DOM boundary.
const appLines = fs.readFileSync(new URL('../src/app.mjs', import.meta.url), 'utf8').trimEnd().split('\n');
const clientLine = appLines.at(-1);
function bootClient({ navigator = {}, pathname = `/clinics/${ID}/` } = {}) {
  const listeners = [];
  const document = { addEventListener(type, fn) { listeners.push([type, fn]); } };
  const outboundEvent = new Function('document', 'navigator', 'location', clientLine.replace('export const outboundEvent', 'const outboundEvent') + ';return outboundEvent;')(document, navigator, { pathname, href: 'https://dentaldatalab.com' + pathname + '?q=private#x', search: '?q=private' });
  assert.deepEqual(listeners.map(([type]) => type), ['click']);
  return { outboundEvent, click: target => listeners[0][1]({ target, preventDefault() { throw new Error('navigation must not be blocked'); }, stopPropagation() { throw new Error('other handlers must still run'); } }) };
}
const anchor = dataset => ({ dataset });
const within = link => ({ closest: selector => selector === 'a[data-outbound]' ? link : null });

test('the page sends one beacon per tracked link click with only kind, clinic and path', () => {
  assert(clientLine.includes(`sendBeacon?.('${OUTBOUND_ROUTE}'`), 'the appended line posts to the Worker route');
  assert.equal(appLines.filter(line => /sendBeacon|data-outbound/.test(line)).length, 1, 'all hand-off code is that one line');
  const code = clientLine.replace(/^\/\*.*?\*\//, '');
  assert(code.length < clientLine.length && code.startsWith('export const outboundEvent='), 'one explanatory comment, then code');
  for (const forbidden of ['cookie', 'localStorage', 'sessionStorage', 'indexedDB', 'referrer', 'userAgent', 'location.href', 'location.search', 'fetch(', 'await ', 'preventDefault'])
    assert(!code.includes(forbidden), `${forbidden} is not used`);
  const sent = [];
  const page = bootClient({ navigator: { sendBeacon: (url, data) => { sent.push([url, data]); return true; } } });
  assert.equal(page.click(within(anchor({ outbound: 'map', clinic: ID }))), undefined, 'the handler is synchronous');
  assert.deepEqual(sent.map(([url]) => url), [OUTBOUND_ROUTE]);
  assert.equal(typeof sent[0][1], 'string', 'a string body is sent as text/plain, which needs no preflight');
  assert.deepEqual(JSON.parse(sent[0][1]), { kind: 'map', clinic: ID, page: `/clinics/${ID}/` });
  assert(Buffer.byteLength(sent[0][1]) <= OUTBOUND_MAX_BYTES);
  assert.deepEqual(outboundDataPoint(sent[0][1]), { blobs: ['map', ID, 'clinics'], doubles: [1], indexes: [ID] }, 'what the page sends is what the Worker accepts');
  page.click(within(null));
  page.click({});
  assert.equal(sent.length, 1, 'clicks outside tracked links send nothing');
  assert.deepEqual(page.outboundEvent(anchor({ outbound: 'tel', clinic: ID, name: 'ignored' }), '/find/'), { kind: 'tel', clinic: ID, page: '/find/' });
  // A link without data-clinic produces a body the Worker drops.
  page.click(within(anchor({ outbound: 'tel' })));
  assert.equal(outboundDataPoint(sent[1][1]), null);
});

test('a missing or failing sendBeacon never throws into the click', () => {
  const link = within(anchor({ outbound: 'homepage', clinic: ID }));
  assert.doesNotThrow(() => bootClient().click(link));
  assert.doesNotThrow(() => bootClient({ navigator: { sendBeacon() { throw new Error('blocked'); } } }).click(link));
  assert.doesNotThrow(() => bootClient({ navigator: { sendBeacon: () => false } }).click(link));
  assert.doesNotThrow(() => bootClient().click({ closest() { throw new Error('detached'); } }));
});

const linkAsset = (kind, url, overrides = {}) => ({ kind, url, ownership: 'official', bodyStatus: 'read', linkable: true, checkedAt: '2026-11-01T12:00:00Z', notes: '', identityEvidence: [{ field: 'name', value: '대조치과병원', sourceUrl: 'https://evidence.example.com/' }], evidenceUrls: ['https://evidence.example.com/'], ...overrides });
const tagged = html => [...html.matchAll(/<a href="([^"]*)" data-outbound="([^"]*)" data-clinic="([^"]*)"/g)].map(match => match.slice(1));

test('an institution\'s own channel links carry the kind and clinic id the counter reads', () => {
  const urls = { website: 'https://clinic.example.com/', booking: 'https://booking.naver.com/booking/13/bizes/123', naverMap: 'https://map.naver.com/p/entry/place/123', kakaoMap: 'https://place.map.kakao.com/123', googleMap: 'https://maps.example.com/place/123', naverBlog: 'https://blog.naver.com/clinic', blog: 'https://clinic.tistory.com/', youtube: 'https://www.youtube.com/@clinic', instagram: 'https://www.instagram.com/clinic/', facebook: 'https://www.facebook.com/clinic', kakaoChannel: 'https://pf.kakao.com/_clinic', linkHub: 'https://linktr.ee/clinic', other: 'https://other.example.com/' };
  assert.deepEqual(Object.keys(urls).sort(), Object.keys(KINDS).sort(), 'every asset kind is covered');
  for (const [kind, url] of Object.entries(urls)) {
    const expected = { website: 'homepage', booking: 'booking', naverMap: 'map', kakaoMap: 'map', googleMap: 'map' }[kind] ?? 'channel';
    assert.equal(OUTBOUND_KIND_BY_ASSET[kind] ?? 'channel', expected);
    assert(OUTBOUND_KINDS.includes(expected));
    const html = assetItem(linkAsset(kind, url, { label: '공식 채널' }), ID);
    assert.deepEqual(tagged(html), [[url, expected, ID]], kind + ': only the channel link is tagged, not its evidence links');
    assert(html.includes(`<a href="${url}" data-outbound="${expected}" data-clinic="${ID}" target="_blank" rel="noopener noreferrer">`), 'href stays the first attribute');
    assert.equal((html.match(/<a /g) ?? []).length, 3, 'channel link, identity source and evidence link');
  }
});

test('links that are not a hand-off to the institution stay untagged', () => {
  const site = linkAsset('website', 'https://clinic.example.com/');
  assert(!assetItem(site).includes('data-outbound'), 'no clinic id, no tag');
  for (const id of ['clinic-a', 'c-0123', 0, 1, undefined, { toString: () => ID }]) assert(!assetItem(site, id).includes('data-outbound'), String(id));
  assert(!assetItem({ ...site, ownership: 'third_party' }, ID).includes('data-outbound'), 'third-party mention');
  const pending = assetItem({ ...site, ownership: 'candidate', linkable: false }, ID);
  assert(!pending.includes('data-outbound') && !pending.includes('<a '), 'a pending candidate is not even a link');
  assert.equal(assetItem({ ...site, url: 'javascript:alert(1)' }, ID).includes('data-outbound'), false, 'an unsafe URL never becomes a link');
});

test('institution pages tag own channels and the observed-homepage row, but not third-party or evidence links', () => {
  const source = 'https://clinic.example.com/';
  const proof = [{ field: 'name', value: '대조치과병원', sourceUrl: source }, { field: 'phone', value: '031-123-4567', sourceUrl: source }];
  const asset = overrides => ({ kind: 'website', url: source, ownership: 'official', bodyStatus: 'read', evidenceUrls: [source], identityEvidence: proof, checkedAt: '2026-10-31T12:00:00Z', notes: '본문 대조.', ...overrides });
  const inventory = id => buildAssetInventory([{ id, name: '대조치과병원', typeCode: '41', sido: '경기', city: '양주시', address: '경기도 양주시 검증로 1', phone: '031-123-4567', website: null }], {
    snapshotDate: '2026-09-30', observedAt: '2026-10-31T10:00:00Z',
    batches: [{ checkedAt: '2026-11-01T12:00:00Z', records: [{ clinicId: id, name: '대조치과병원', checkedAt: '2026-11-01T12:00:00Z', searches: [], assets: [
      asset(), asset({ url: 'https://blog.naver.com/clinic-example', kind: 'naverBlog' }),
      asset({ url: 'https://outside.example.com/', ownership: 'third_party' }), asset({ url: 'https://candidate.example.com/', ownership: 'candidate' }),
    ] }] }],
  }).records[0];
  const record = inventory(ID), panel = clinicAssetsPanel(record);
  assert.deepEqual(tagged(panel).sort(), [['https://blog.naver.com/clinic-example', 'channel', ID], [source, 'homepage', ID]]);
  assert(panel.includes('href="https://outside.example.com/"') && !/outside\.example\.com\/" data-outbound/.test(panel), 'the third-party link is rendered untagged');
  assert.deepEqual(tagged(observedWebsiteRow(record)), [[source, 'homepage', ID]]);
  for (const [, kind, clinic] of [...tagged(panel), ...tagged(observedWebsiteRow(record))]) {
    assert.notEqual(outboundDataPoint(JSON.stringify({ kind, clinic, page: `/clinics/${ID}/` })), null, 'every rendered tag is an event the Worker accepts');
  }
  // Fixture ids that are not real institution ids render exactly as before.
  const legacy = inventory('clinic-a');
  assert(!clinicAssetsPanel(legacy).includes('data-outbound') && !observedWebsiteRow(legacy).includes('data-outbound'));
});
