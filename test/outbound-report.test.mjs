import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { monthRange, outboundSql, parseSqlRows, buildReport, reportCsv, querySql } from '../scripts/outbound-report.mjs';
import { OUTBOUND_DATASET, OUTBOUND_KINDS } from '../scripts/outbound-events.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = 'c-0123456789ab', B = 'c-abcdef012345';
const hospitals = [
  { clinicId: A, name: '가나치과병원', sido: '서울', city: '강남구' },
  { clinicId: B, name: '다라치과병원', sido: '경기', city: '양주시' },
];

test('month ranges are whole Asia/Seoul calendar months, three by default', () => {
  // 2026-11-30 15:30 UTC is already 1 December in Seoul.
  assert.deepEqual(monthRange({ now: new Date('2026-11-30T15:30:00Z') }), {
    from: '2026-10', to: '2026-12', months: ['2026-10', '2026-11', '2026-12'], timeZone: 'Asia/Seoul',
    start: '2026-10-01 00:00:00', end: '2027-01-01 00:00:00',
  });
  assert.deepEqual(monthRange({ from: '2026-11', to: '2026-11' }).months, ['2026-11']);
  assert.equal(monthRange({ from: '2026-11', to: '2026-11' }).end, '2026-12-01 00:00:00');
  assert.deepEqual(monthRange({ to: '2026-01' }).months, ['2025-11', '2025-12', '2026-01']);
  for (const bad of [{ from: '2026-13', to: '2026-12' }, { from: '2026-1', to: '2026-02' }, { from: "2026-01' OR 1=1", to: '2026-02' }, { from: '2026-05', to: '2026-04' }, { from: '2020-01', to: '2026-01' }])
    assert.throws(() => monthRange(bad), JSON.stringify(bad));
});

test('SQL counts with SUM(_sample_interval), bounds the window in Seoul time and indexes by clinic', () => {
  const range = monthRange({ from: '2026-09', to: '2026-11' });
  const sql = outboundSql({ range, clinicIds: [A, B] });
  assert.equal(sql.byKind, [
    "SELECT formatDateTime(timestamp, '%Y-%m', 'Asia/Seoul') AS ym, blob1 AS kind, SUM(_sample_interval) AS clicks",
    `FROM ${OUTBOUND_DATASET}`,
    "WHERE timestamp >= toDateTime('2026-09-01 00:00:00', 'Asia/Seoul') AND timestamp < toDateTime('2026-12-01 00:00:00', 'Asia/Seoul')",
    'GROUP BY ym, kind',
    'ORDER BY ym, kind',
    'FORMAT JSON',
  ].join('\n'));
  assert.equal(sql.byClinic, [
    "SELECT formatDateTime(timestamp, '%Y-%m', 'Asia/Seoul') AS ym, index1 AS clinic, blob1 AS kind, SUM(_sample_interval) AS clicks",
    `FROM ${OUTBOUND_DATASET}`,
    "WHERE timestamp >= toDateTime('2026-09-01 00:00:00', 'Asia/Seoul') AND timestamp < toDateTime('2026-12-01 00:00:00', 'Asia/Seoul')",
    `  AND index1 IN ('${A}', '${B}')`,
    'GROUP BY ym, clinic, kind',
    'ORDER BY ym, clinic, kind',
    'FORMAT JSON',
  ].join('\n'));
  for (const statement of Object.values(sql)) assert(!/count\s*\(/i.test(statement), 'a plain COUNT would undercount sampled data');
  assert.match(outboundSql({ dataset: 'other_set', range, clinicIds: [A] }).byKind, /\nFROM other_set\n/);
  assert.throws(() => outboundSql({ dataset: 'x; DROP', range, clinicIds: [A] }), /identifier/);
  assert.throws(() => outboundSql({ dataset: 'my-dataset', range, clinicIds: [A] }), /identifier/);
  assert.throws(() => outboundSql({ range, clinicIds: [] }), /No institution/);
  assert.throws(() => outboundSql({ range, clinicIds: [A, "c-0123456789ab') OR ('1'='1"] }), /Unexpected institution id/);
  assert.throws(() => outboundSql({ range: { ...range, start: "2026-09-01 00:00:00') --" }, clinicIds: [A] }), /range bound/);
});

// The documented FORMAT JSON answer: {"meta":[{"name","type"}…],"data":[{column: value}…],"rows":n}.
const answer = (columns, data) => ({ meta: columns.map(([name, type]) => ({ name, type })), data, rows: data.length });
const kindAnswer = answer([['ym', 'String'], ['kind', 'String'], ['clicks', 'UInt64']], [
  { ym: '2026-10', kind: 'tel', clicks: '12' },
  { ym: '2026-11', kind: 'homepage', clicks: 3 },
  { ym: '2026-11', kind: 'tel', clicks: '40' },
  { ym: '2026-11', kind: 'unknown-kind', clicks: '5' },
]);
const clinicAnswer = answer([['ym', 'String'], ['clinic', 'String'], ['kind', 'String'], ['clicks', 'UInt64']], [
  { ym: '2026-10', clinic: B, kind: 'tel', clicks: '2' },
  { ym: '2026-11', clinic: B, kind: 'map', clicks: '7' },
  { ym: '2026-11', clinic: B, kind: 'tel', clicks: '1' },
  { ym: '2026-11', clinic: 'c-ffffffffffff', kind: 'tel', clicks: '99' },
  { ym: '2026-08', clinic: B, kind: 'tel', clicks: '50' },
]);

test('the documented JSON answer is parsed into numeric rows, and anything else is an error', () => {
  assert.deepEqual(parseSqlRows(kindAnswer, ['ym', 'kind', 'clicks']).slice(0, 2), [{ ym: '2026-10', kind: 'tel', clicks: 12 }, { ym: '2026-11', kind: 'homepage', clicks: 3 }]);
  assert.deepEqual(parseSqlRows(answer([['ym', 'String'], ['kind', 'String'], ['clicks', 'UInt64']], []), ['ym', 'kind', 'clicks']), []);
  assert.deepEqual(parseSqlRows({ data: [{ ym: '2026-11', kind: 'tel', clicks: '4', extra: 'ignored' }] }, ['ym', 'kind', 'clicks']), [{ ym: '2026-11', kind: 'tel', clicks: 4 }], 'meta is optional');
  for (const bad of [null, 'text', {}, { data: 'rows' }, { errors: [{ message: 'unable to find table' }] }])
    assert.throws(() => parseSqlRows(bad, ['ym', 'kind', 'clicks']), /no data array/);
  assert.throws(() => parseSqlRows(answer([['ym', 'String'], ['clicks', 'UInt64']], [{ ym: '2026-11', kind: 'tel', clicks: '1' }]), ['ym', 'kind', 'clicks']), /missing column kind/);
  assert.throws(() => parseSqlRows({ data: [{ ym: '2026-11', clicks: '1' }] }, ['ym', 'kind', 'clicks']), /missing column kind/);
  for (const clicks of ['many', '-1', 'NaN', 'Infinity'])
    assert.throws(() => parseSqlRows({ data: [{ ym: '2026-11', kind: 'tel', clicks }] }, ['ym', 'kind', 'clicks']), /not a count/, clicks);
});

test('the report totals months by kind for the site and lists every hospital, zero rows included', () => {
  const range = monthRange({ from: '2026-10', to: '2026-11' });
  const report = buildReport({ range, kindRows: parseSqlRows(kindAnswer, ['ym', 'kind', 'clicks']), clinicRows: parseSqlRows(clinicAnswer, ['ym', 'clinic', 'kind', 'clicks']), hospitals });
  const zero = Object.fromEntries(OUTBOUND_KINDS.map(kind => [kind, 0]));
  assert.deepEqual(report.range, { from: '2026-10', to: '2026-11', timeZone: 'Asia/Seoul', start: '2026-10-01 00:00:00', end: '2026-12-01 00:00:00' });
  assert.equal(report.dataset, OUTBOUND_DATASET);
  assert.match(report.counting, /_sample_interval/);
  assert.deepEqual(report.site, { scope: 'all institutions', total: 55, months: [
    { month: '2026-10', total: 12, byKind: { ...zero, tel: 12 } },
    { month: '2026-11', total: 43, byKind: { ...zero, tel: 40, homepage: 3 } },
  ] }, 'kinds the Worker never writes are not counted');
  assert.deepEqual({ ...report.hospitals, rows: undefined }, { scope: 'typeCode 41', count: 2, withClicks: 1, rows: undefined });
  assert.deepEqual(report.hospitals.rows, [
    { ...hospitals[1], total: 10, byKind: { ...zero, tel: 3, map: 7 }, byMonth: { '2026-10': { total: 2, byKind: { ...zero, tel: 2 } }, '2026-11': { total: 8, byKind: { ...zero, tel: 1, map: 7 } } } },
    { ...hospitals[0], total: 0, byKind: zero, byMonth: { '2026-10': { total: 0, byKind: zero }, '2026-11': { total: 0, byKind: zero } } },
  ], 'most clicks first; rows outside the range or for other institutions are ignored');
  const lines = reportCsv(report).split('\r\n');
  assert(lines[0].startsWith('﻿"month","scope","clinicId","name","sido","city","tel","map","homepage","booking","share","channel","total"'));
  assert.deepEqual(lines.slice(1, 7), [
    '"2026-10","site","","","","","12","0","0","0","0","0","12"',
    '"2026-11","site","","","","","40","0","3","0","0","0","43"',
    `"2026-10","hospital","${B}","다라치과병원","경기","양주시","2","0","0","0","0","0","2"`,
    `"2026-10","hospital","${A}","가나치과병원","서울","강남구","0","0","0","0","0","0","0"`,
    `"2026-11","hospital","${B}","다라치과병원","경기","양주시","1","7","0","0","0","0","8"`,
    `"2026-11","hospital","${A}","가나치과병원","서울","강남구","0","0","0","0","0","0","0"`,
  ]);
  assert.equal(lines.length, 8, 'header, two site rows, four hospital rows and the final line break');
});

test('the SQL API call is one authenticated POST and its errors never reveal the credentials', async () => {
  const accountId = '0123456789abcdef0123456789abcdef', token = 'secret-token-value_123';
  const calls = [];
  const ok = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(kindAnswer), { status: 200 }); };
  assert.deepEqual(await querySql({ accountId, token, sql: 'SELECT 1', fetchImpl: ok }), kindAnswer);
  assert.deepEqual(calls, [{ url: `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, init: { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'SELECT 1' } }]);
  const failures = [
    async () => new Response(`{"errors":[{"message":"account ${accountId} token ${token} not allowed"}]}`, { status: 403 }),
    async () => { throw Object.assign(new TypeError(`fetch failed for ${accountId} with Bearer ${token}`), { cause: { code: 'ENOTFOUND' } }); },
    async () => { throw new Error(`Bearer ${token} is an invalid header value`); },
    async () => new Response(`<html>${token}</html>`, { status: 200 }),
  ];
  const messages = [];
  for (const fetchImpl of failures) {
    await assert.rejects(querySql({ accountId, token, sql: 'SELECT 1', fetchImpl }), error => { messages.push(error.message); return true; });
  }
  assert.match(messages[0], /^SQL API answered HTTP 403: .*\[account\].*\[token\]/);
  assert.equal(messages[1], 'SQL API request failed (ENOTFOUND).');
  assert.equal(messages[2], 'SQL API request failed.');
  assert.match(messages[3], /not JSON/);
  for (const message of messages) assert(!message.includes(accountId) && !message.includes(token), message);
  let called = false;
  const never = async () => { called = true; return new Response('{}'); };
  for (const [badAccount, badToken] of [['short', token], [undefined, token], [accountId, ''], [accountId, 'two words'], [accountId, token + '\n'], [accountId, undefined]]) {
    await assert.rejects(querySql({ accountId: badAccount, token: badToken, sql: 'SELECT 1', fetchImpl: never }), error => /^CF_(ACCOUNT_ID|API_TOKEN) must be /.test(error.message) && !error.message.includes(token));
  }
  assert.equal(called, false, 'malformed credentials are refused before any request');
});

test('the CLI prints only SQL on a dry run and never echoes credentials', () => {
  const script = path.join(root, 'scripts/outbound-report.mjs');
  const run = (args, env = {}) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  // An unroutable account ID proves --dry-run stops before the network: a real request would fail and exit 1.
  const secret = { CF_ACCOUNT_ID: 'f'.repeat(32), CF_API_TOKEN: 'cli-secret-token' };
  const dry = run(['--dry-run', '--from', '2026-10', '--to', '2026-11'], secret);
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(dry.stderr, '');
  assert.match(dry.stdout, /^-- byKind[^\n]*\nSELECT formatDateTime\(timestamp, '%Y-%m', 'Asia\/Seoul'\) AS ym, blob1 AS kind, SUM\(_sample_interval\) AS clicks\nFROM dentaldatalab_outbound\n/);
  const hospitalIds = JSON.parse(fs.readFileSync(path.join(root, 'data/clinics.json'), 'utf8')).clinics.filter(clinic => clinic.typeCode === '41').map(clinic => clinic.id);
  assert(hospitalIds.length > 0 && dry.stdout.includes(`-- byClinic: monthly totals by link kind, ${hospitalIds.length} institutions with typeCode 41\n`));
  assert.deepEqual((dry.stdout.match(/'c-[a-f0-9]{12}'/g) ?? []).map(quoted => quoted.slice(1, -1)), hospitalIds, 'every 치과병원 id, and no 치과의원 id, is in the per-clinic statement');
  assert(dry.stdout.includes("toDateTime('2026-10-01 00:00:00', 'Asia/Seoul')") && dry.stdout.includes("toDateTime('2026-12-01 00:00:00', 'Asia/Seoul')"));
  assert(!dry.stdout.includes(secret.CF_ACCOUNT_ID) && !dry.stdout.includes(secret.CF_API_TOKEN));
  // Without credentials the SQL is still shown, but the exit status says no report was produced.
  const bare = run(['--from', '2026-11', '--to', '2026-11']);
  assert.equal(bare.status, 1);
  assert.match(bare.stdout, /^-- byKind/);
  assert.match(bare.stderr, /CF_ACCOUNT_ID and CF_API_TOKEN are not both set/);
  const invalid = run(['--from', '2026-11', '--to', '2026-11'], { CF_ACCOUNT_ID: 'not-an-account-id', CF_API_TOKEN: 'cli-secret-token' });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.equal(invalid.stderr.trim(), 'CF_ACCOUNT_ID must be the 32-character account ID.');
  for (const args of [['--format', 'xml', '--dry-run'], ['--month'], ['--from', '2026-13', '--dry-run'], ['--dataset', 'a b', '--dry-run']]) {
    const failed = run(args, secret);
    assert.equal(failed.status, 1, args.join(' '));
    assert(!failed.stderr.includes(secret.CF_API_TOKEN) && !failed.stderr.includes(secret.CF_ACCOUNT_ID));
  }
  assert.match(run(['--help']).stdout, /--dry-run/);
});
