import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { esc, fmt, clinicUrl } from '../src/shared.mjs';

// Run the actual client against a small DOM boundary without taking over the
// research browser. Fixtures are independent of the growing national inventory.
const client = fs.readFileSync(new URL('../src/clinic-assets.mjs', import.meta.url), 'utf8')
  .replace(/^import\s+[^\n]+\n/, '');

function element(value = '') {
  const listeners = new Map();
  return {
    value, innerHTML: '', textContent: '', focused: false,
    addEventListener(type, fn) { listeners.set(type, fn); },
    dispatch(type, event = {}) { return listeners.get(type)?.(event); },
    focus() { this.focused = true; },
  };
}

function clinic(id, overrides = {}) {
  return {
    clinicId: id, name: `Clinic ${id}`, address: '경기 양주시 옥정로',
    typeCode: '51', type: '치과의원', sido: '경기', city: '양주시',
    assetCount: 1, confirmedCount: 0, kinds: ['website'],
    researched: true, naverRead: false, naverAttempted: false,
    ...overrides,
  };
}

async function boot(rows, search = '', { ok = true } = {}) {
  const form = element();
  form.elements = Object.fromEntries(['q', 'type', 'sido', 'kind', 'status', 'hours', 'owner']
    .map(key => [key, element('')]));
  const results = element(), status = element(), pagination = element();
  results.innerHTML = '<article>Static clinic fallback</article>';
  let currentUrl = '/clinic-assets/' + search;
  const nodes = { '#asset-search': form, '#asset-results': results, '#asset-status': status, '#asset-pagination': pagination };
  await vm.runInNewContext(client, {
    document: { querySelector: selector => nodes[selector] },
    fetch: async url => {
      assert.equal(url, '/data/clinic-assets/index.json');
      return { ok, json: async () => structuredClone(rows) };
    },
    FormData: class {
      constructor(target) { this.values = Object.entries(target.elements).map(([key, input]) => [key, input.value]); }
      get(key) { return this.values.find(([name]) => name === key)?.[1] ?? null; }
      entries() { return this.values.values(); }
    },
    location: { search },
    history: { replaceState(_state, _title, url) { currentUrl = url; } },
    URLSearchParams, esc, fmt, clinicUrl, setTimeout, clearTimeout,
  });
  return {
    form, results, status, pagination,
    ids: () => [...new Set([...results.innerHTML.matchAll(/href="\/clinics\/([^/]+)\//g)].map(match => match[1]))],
    url: () => new URL(currentUrl, 'http://localhost'),
    change(values) {
      for (const [key, value] of Object.entries(values)) form.elements[key].value = value;
      form.dispatch('change');
    },
    go(page) {
      pagination.dispatch('click', { target: { closest: () => ({ dataset: { page: String(page) } }) } });
    },
  };
}

test('query tokens, institution type, region, channel and research status intersect', async () => {
  const target = { typeCode: '41', type: '치과병원', kinds: ['instagram'] };
  const rows = [
    clinic('match', target),
    clinic('wrong-query', { ...target, address: '경기 양주시 백석읍' }),
    clinic('wrong-type', { kinds: ['instagram'] }),
    clinic('wrong-region', { ...target, sido: '서울' }),
    clinic('wrong-kind', { ...target, kinds: ['website'] }),
    clinic('not-researched', { ...target, researched: false }),
  ];
  const query = new URLSearchParams({ q: '양주  옥정', type: '41', sido: '경기', kind: 'instagram', status: 'researched' });
  const ui = await boot(rows, '?' + query);
  assert.deepEqual(ui.ids(), ['match']);
  assert.match(ui.status.textContent, /^1곳 · 1\/1 페이지/);
  for (const [key, value] of query) assert.equal(ui.url().searchParams.get(key), value);
});

test('institution coverage filters distinguish attempted, read, confirmed and missing data', async () => {
  const rows = [
    clinic('read', { naverRead: true, naverAttempted: true, confirmedCount: 1 }),
    clinic('blocked', { naverAttempted: true }),
    clinic('registered', { researched: false }),
    clinic('missing', { assetCount: 0, kinds: [], researched: false }),
  ];
  const cases = {
    researched: ['blocked', 'read'],
    naver: ['read'],
    confirmed: ['read'],
    has: ['blocked', 'read', 'registered'],
    missing: ['missing'],
    '': ['blocked', 'missing', 'read', 'registered'],
  };
  for (const [status, expected] of Object.entries(cases)) {
    const ui = await boot(rows, '?status=' + status);
    assert.deepEqual(ui.ids(), expected, `status=${status}`);
  }
});

test('hours coverage deep links select every stage without restricting results to manually researched clinics', async () => {
  const stages = ['hours_available', 'hours_missing', 'identity_review', 'access_failed', 'place_ready', 'place_discovery'];
  const rows = stages.map(stage => clinic(stage, {
    naverHoursStage: stage, naverHoursLabel: `상태 ${stage}`, researched: stage === 'hours_available',
  }));
  for (const stage of stages) {
    const ui = await boot(rows, '?status=&hours=' + stage);
    assert.deepEqual(ui.ids(), [stage]);
    assert.equal(ui.form.elements.hours.value, stage);
    assert.equal(ui.url().searchParams.get('hours'), stage);
    assert.equal(ui.url().searchParams.get('status'), '');
    assert(ui.results.innerHTML.includes(`상태 ${stage}`));
    assert(ui.results.innerHTML.includes(`href="${clinicUrl(stage)}#hours"`));
    assert(ui.results.innerHTML.includes(`href="${clinicUrl(stage)}#marketing-assets"`));
  }
});

test('hours stage intersects other filters and changing it resets pagination without losing the selected state', async () => {
  const rows = Array.from({ length: 25 }, (_, index) => clinic(String(index).padStart(2, '0'), {
    naverHoursStage: 'place_ready', naverHoursLabel: '지도 후보 확보 · 본문 확인 전', researched: false, kinds: ['naverMap'],
  }));
  rows.push(clinic('observed', { naverHoursStage: 'hours_available', naverHoursLabel: '시간표 확보', kinds: ['naverMap'] }));
  rows.push(clinic('wrong-region', { naverHoursStage: 'place_ready', sido: '서울', kinds: ['naverMap'] }));
  rows.push(clinic('wrong-kind', { naverHoursStage: 'place_ready' }));
  const ui = await boot(rows, '?status=&hours=place_ready&sido=경기&kind=naverMap');
  assert.match(ui.status.textContent, /^25곳 · 1\/2 페이지/);
  assert.match(ui.results.innerHTML, /지도 후보 확보 · 본문 확인 전/);
  assert.doesNotMatch(ui.results.innerHTML, /시간표 확보/);
  ui.go(2);
  assert.equal(ui.ids().length, 5);
  assert.equal(ui.url().searchParams.get('hours'), 'place_ready');
  ui.change({ hours: 'hours_available' });
  assert.deepEqual(ui.ids(), ['observed']);
  assert.match(ui.status.textContent, /^1곳 · 1\/1 페이지/);
  assert.equal(ui.url().searchParams.get('p'), null);
  assert.equal(ui.url().searchParams.get('hours'), 'hours_available');
  assert.equal(ui.url().searchParams.get('sido'), '경기');
  ui.change({ hours: 'place_discovery' });
  assert.deepEqual(ui.ids(), []);
  assert.match(ui.status.textContent, /^0곳 · 1\/1 페이지/);
  assert.doesNotMatch(ui.pagination.innerHTML, /data-page=/);
});

test('hours status labels are escaped before being rendered in cards', async () => {
  const label = '<img src=x onerror="alert(1)">';
  const ui = await boot([clinic('a', { naverHoursStage: 'identity_review', naverHoursLabel: label })]);
  assert(!ui.results.innerHTML.includes('<img src=x'));
  assert(ui.results.innerHTML.includes(esc(label)));
});

test('Yangju owner deep links filter current collection states and retain combined filters', async () => {
  const owner=(descriptionStatus,captured=true)=>({descriptionStatus,descriptionLabel:'소개 상태',captured,identityPending:false,tabs:{home:{status:captured?'read':'pending'},information:{status:captured?'read':'pending'},booking:{status:'pending'}}});
  const rows=[clinic('read',{ownerCapture:owner('read')}),clinic('absent',{ownerCapture:owner('not_displayed')}),clinic('uncollected',{ownerCapture:owner('pending',false)}),clinic('other-city',{city:'의정부시',ownerCapture:null}),clinic('wrong-kind',{kinds:['naverBlog'],ownerCapture:owner('read')})];
  const ui=await boot(rows,'?owner=read&kind=website');
  assert.deepEqual(ui.ids(),['read']);
  assert.equal(ui.url().searchParams.get('owner'),'read');
  assert.match(ui.results.innerHTML,/이번 양주 조사 · 소개 상태/);
  assert.match(ui.results.innerHTML,/예약 조사 전/);
  ui.change({owner:'all'});
  assert.deepEqual(ui.ids(),['absent','read','uncollected']);
  ui.change({owner:'uncollected'});
  assert.deepEqual(ui.ids(),['uncollected']);
  ui.change({owner:'not_displayed'});
  assert.deepEqual(ui.ids(),['absent']);
  ui.change({owner:'incomplete'});
  assert.deepEqual(ui.ids(),[]);
  assert.match(ui.status.textContent,/^0곳 · 1\/1 페이지/);
  const booking=await boot([clinic('book-read',{ownerCapture:{...owner('read'),bookingPage:{status:'read',latestFailed:false}}}),clinic('book-failed',{ownerCapture:{...owner('pending'),bookingPage:{status:'attempted',latestFailed:true}}}),clinic('book-pending',{ownerCapture:{...owner('pending'),bookingPage:{status:'pending',latestFailed:false}}})],'?owner=booking_read');
  assert.deepEqual(booking.ids(),['book-read']);
  booking.change({owner:'booking_failed'});assert.deepEqual(booking.ids(),['book-failed']);
  assert.match(booking.results.innerHTML,/최근 접근 실패/);
  booking.change({owner:'booking_pending'});assert.deepEqual(booking.ids(),['book-pending']);
});

test('a zero-result filter has one empty page and no navigation controls', async () => {
  const ui = await boot([clinic('a')], '?q=없는기관&p=9');
  assert.deepEqual(ui.ids(), []);
  assert.match(ui.status.textContent, /^0곳 · 1\/1 페이지/);
  assert.match(ui.results.innerHTML, /조건에 맞는 기관이 없습니다/);
  assert.doesNotMatch(ui.pagination.innerHTML, /data-page=/);
  assert.equal(ui.url().searchParams.get('p'), null);
});

const pagedRows = Array.from({ length: 45 }, (_, index) => clinic(String(index).padStart(2, '0')));

test('fractional, nonpositive and unsafe page parameters fall back to the first page', async () => {
  for (const page of ['1.5', '0', '-1', 'abc', 'Infinity', '9007199254740992']) {
    const ui = await boot(pagedRows, '?p=' + encodeURIComponent(page));
    assert.deepEqual(ui.ids(), pagedRows.slice(0, 20).map(row => row.clinicId), `p=${page}`);
    assert.match(ui.status.textContent, /^45곳 · 1\/3 페이지/);
    assert.doesNotMatch(ui.pagination.innerHTML, /data-page="(?:0|\d+\.\d+)"/);
    assert.equal(ui.url().searchParams.get('p'), null);
  }
});

test('a page beyond the result count clamps to the actual final page', async () => {
  const ui = await boot(pagedRows, '?p=999');
  assert.deepEqual(ui.ids(), pagedRows.slice(40).map(row => row.clinicId));
  assert.match(ui.status.textContent, /^45곳 · 3\/3 페이지/);
  assert.match(ui.pagination.innerHTML, /data-page="2"/);
  assert.doesNotMatch(ui.pagination.innerHTML, /다음/);
  assert.equal(ui.url().searchParams.get('p'), '3');
});

test('page navigation focuses the result status and changing a filter resets pagination', async () => {
  const ui = await boot(pagedRows);
  ui.go(2);
  assert.deepEqual(ui.ids(), pagedRows.slice(20, 40).map(row => row.clinicId));
  assert.equal(ui.status.focused, true);
  assert.equal(ui.url().searchParams.get('p'), '2');
  ui.change({ q: 'Clinic 44' });
  assert.deepEqual(ui.ids(), ['44']);
  assert.match(ui.status.textContent, /^1곳 · 1\/1 페이지/);
  assert.equal(ui.url().searchParams.get('p'), null);
});

test('index fetch failure leaves the static fallback intact and reports the problem', async () => {
  const ui = await boot([], '', { ok: false });
  assert.match(ui.status.textContent, /검색 자료를 읽지 못했습니다/);
  assert.equal(ui.results.innerHTML, '<article>Static clinic fallback</article>');
  assert.equal(ui.pagination.innerHTML, '');
});
