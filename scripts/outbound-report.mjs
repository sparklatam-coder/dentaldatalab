#!/usr/bin/env node
// Monthly hand-off click report: how many times visitors followed a phone / map / homepage / booking / channel
// link to an institution. Reads the Workers Analytics Engine dataset the Pages Worker writes to
// (docs/outbound-measurement.md) through the Analytics Engine SQL API.
//
// Usage: node scripts/outbound-report.mjs [--from YYYY-MM] [--to YYYY-MM] [--format json|csv] [--dataset NAME] [--dry-run]
//   --from/--to   inclusive calendar months in Asia/Seoul time. Default: the current month and the two before it
//                 (Analytics Engine keeps data for three months, so save each month's output).
//   --format      json (default) or csv (UTF-8 BOM, one row per month for the whole site and per hospital).
//   --dry-run     print the two SQL statements and stop: no network request, no credentials needed.
//
// Credentials come from the environment only and are never written to disk or printed:
//   CF_ACCOUNT_ID  32-character Cloudflare account ID
//   CF_API_TOKEN   API token with Account · Account Analytics · Read
// Without both, the script prints the SQL like --dry-run and exits 1 because no report was fetched.
//
// Two read queries per run:
//   byKind    monthly totals by link kind over every institution
//   byClinic  monthly totals by link kind for each 치과병원 (typeCode 41 in data/clinics.json)
// Counts are SUM(_sample_interval), the documented way to count rows Analytics Engine may have sampled.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { csv } from './html.mjs';
import { OUTBOUND_CLINIC, OUTBOUND_DATASET, OUTBOUND_KINDS } from './outbound-events.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIME_ZONE = 'Asia/Seoul';
const MONTH = /^20\d{2}-(?:0[1-9]|1[0-2])$/;
const MAX_MONTHS = 24;
const shift = (month, by) => {
  const [year, index] = month.split('-').map(Number);
  return new Date(Date.UTC(year, index - 1 + by, 1)).toISOString().slice(0, 7);
};

/** Inclusive month range in Asia/Seoul. Defaults to the current month and the two before it. */
export function monthRange({ from, to, now = new Date() } = {}) {
  const current = new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7);
  const last = to ?? current, first = from ?? shift(last, -2);
  for (const month of [first, last]) if (!MONTH.test(month)) throw new Error('Months must be written as YYYY-MM.');
  if (first > last) throw new Error('--from must not be later than --to.');
  const months = [];
  for (let month = first; month <= last; month = shift(month, 1)) {
    if (months.push(month) > MAX_MONTHS) throw new Error(`A report covers at most ${MAX_MONTHS} months.`);
  }
  return { from: first, to: last, months, timeZone: TIME_ZONE, start: `${first}-01 00:00:00`, end: `${shift(last, 1)}-01 00:00:00` };
}

/** The two SQL statements. Every interpolated value is validated first; nothing here comes from a visitor. */
export function outboundSql({ dataset = OUTBOUND_DATASET, range, clinicIds }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(dataset)) throw new Error('The dataset name must be a plain SQL identifier.');
  if (!clinicIds?.length) throw new Error('No institution ids to report on.');
  for (const id of clinicIds) if (!OUTBOUND_CLINIC.test(id)) throw new Error('Unexpected institution id: ' + id);
  for (const value of [range.start, range.end]) if (!/^\d{4}-\d{2}-01 00:00:00$/.test(value)) throw new Error('Unexpected range bound.');
  const month = `formatDateTime(timestamp, '%Y-%m', '${TIME_ZONE}')`;
  const within = `timestamp >= toDateTime('${range.start}', '${TIME_ZONE}') AND timestamp < toDateTime('${range.end}', '${TIME_ZONE}')`;
  return {
    byKind: [
      `SELECT ${month} AS ym, blob1 AS kind, SUM(_sample_interval) AS clicks`,
      `FROM ${dataset}`,
      `WHERE ${within}`,
      'GROUP BY ym, kind',
      'ORDER BY ym, kind',
      'FORMAT JSON',
    ].join('\n'),
    byClinic: [
      `SELECT ${month} AS ym, index1 AS clinic, blob1 AS kind, SUM(_sample_interval) AS clicks`,
      `FROM ${dataset}`,
      `WHERE ${within}`,
      `  AND index1 IN (${clinicIds.map(id => `'${id}'`).join(', ')})`,
      'GROUP BY ym, clinic, kind',
      'ORDER BY ym, clinic, kind',
      'FORMAT JSON',
    ].join('\n'),
  };
}

/**
 * Rows of a FORMAT JSON answer: {"meta":[{"name","type"}…],"data":[{…}…],"rows":n}.
 * 64-bit sums can arrive as strings, so clicks is converted and checked.
 */
export function parseSqlRows(response, columns) {
  if (!response || typeof response !== 'object' || !Array.isArray(response.data)) throw new Error('Unexpected SQL API answer: no data array.');
  const names = Array.isArray(response.meta) ? response.meta.map(column => column?.name) : null;
  return response.data.map(row => {
    const out = {};
    for (const column of columns) {
      if ((names && !names.includes(column)) || row?.[column] == null) throw new Error('Unexpected SQL API answer: missing column ' + column + '.');
      out[column] = column === 'clicks' ? Number(row[column]) : String(row[column]);
    }
    if (!Number.isFinite(out.clicks) || out.clicks < 0) throw new Error('Unexpected SQL API answer: clicks is not a count.');
    return out;
  });
}

const emptyKinds = () => Object.fromEntries(OUTBOUND_KINDS.map(kind => [kind, 0]));
function tally(rows) {
  const byKind = emptyKinds();
  // The Worker only writes the kinds in OUTBOUND_KINDS; anything else in the dataset is not a hand-off.
  for (const row of rows) if (Object.hasOwn(byKind, row.kind)) byKind[row.kind] += row.clicks;
  return { total: Object.values(byKind).reduce((sum, value) => sum + value, 0), byKind };
}

/** Site-wide months and one entry per hospital (zero rows included, so a missing hospital is never ambiguous). */
export function buildReport({ range, dataset = OUTBOUND_DATASET, kindRows, clinicRows, hospitals }) {
  const inRange = row => range.months.includes(row.ym);
  const site = range.months.map(month => ({ month, ...tally(kindRows.filter(row => row.ym === month)) }));
  const rows = hospitals.map(hospital => {
    const own = clinicRows.filter(row => row.clinic === hospital.clinicId && inRange(row));
    return { ...hospital, ...tally(own), byMonth: Object.fromEntries(range.months.map(month => [month, tally(own.filter(row => row.ym === month))])) };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ko') || a.clinicId.localeCompare(b.clinicId));
  return {
    generatedBy: 'scripts/outbound-report.mjs',
    dataset,
    range: { from: range.from, to: range.to, timeZone: range.timeZone, start: range.start, end: range.end },
    counting: 'SUM(_sample_interval). Analytics Engine may sample busy indexes; a sampled count is an estimate.',
    site: { scope: 'all institutions', total: site.reduce((sum, month) => sum + month.total, 0), months: site },
    hospitals: { scope: 'typeCode 41', count: rows.length, withClicks: rows.filter(row => row.total > 0).length, rows },
  };
}

/** One spreadsheet table: a "site" row per month, then a "hospital" row per institution and month. */
export function reportCsv(report) {
  const kinds = cells => OUTBOUND_KINDS.map(kind => cells.byKind[kind]);
  const table = [['month', 'scope', 'clinicId', 'name', 'sido', 'city', ...OUTBOUND_KINDS, 'total']];
  for (const month of report.site.months) table.push([month.month, 'site', '', '', '', '', ...kinds(month), month.total]);
  for (const month of report.site.months.map(entry => entry.month)) {
    for (const row of report.hospitals.rows) table.push([month, 'hospital', row.clinicId, row.name, row.sido, row.city, ...kinds(row.byMonth[month]), row.byMonth[month].total]);
  }
  return csv(table);
}

/**
 * POST one statement to the SQL API. Errors never contain the account ID or the token: transport errors are
 * reduced to their error code and the API's own error text is redacted before it is shown.
 */
export async function querySql({ accountId, token, sql, fetchImpl = fetch }) {
  if (typeof accountId !== 'string' || !/^[a-f0-9]{32}$/i.test(accountId)) throw new Error('CF_ACCOUNT_ID must be the 32-character account ID.');
  if (typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token)) throw new Error('CF_API_TOKEN must be a token string without spaces or line breaks.');
  const redact = text => String(text).replaceAll(accountId, '[account]').replaceAll(token, '[token]');
  let response, text;
  try {
    response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: sql,
    });
    text = await response.text();
  } catch (error) {
    const code = error?.cause?.code ?? error?.code;
    throw new Error('SQL API request failed' + (typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : '') + '.');
  }
  if (response.status !== 200) throw new Error(`SQL API answered HTTP ${response.status}: ${redact(text).slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error('SQL API answered 200 with a body that is not JSON.'); }
}

const HELP = 'node scripts/outbound-report.mjs [--from YYYY-MM] [--to YYYY-MM] [--format json|csv] [--dataset NAME] [--dry-run]\n'
  + 'Environment: CF_ACCOUNT_ID, CF_API_TOKEN (Account Analytics: Read). --dry-run prints the SQL only.';

export async function main(argv, env = process.env) {
  const options = { format: 'json', dataset: OUTBOUND_DATASET, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help') { console.log(HELP); return; }
    else if (['--from', '--to', '--format', '--dataset'].includes(arg) && argv[i + 1]) options[arg.slice(2)] = argv[++i];
    else throw new Error('Unknown or incomplete option: ' + arg + '\n' + HELP);
  }
  if (!['json', 'csv'].includes(options.format)) throw new Error('--format must be json or csv.');
  const hospitals = JSON.parse(fs.readFileSync(path.join(root, 'data/clinics.json'), 'utf8')).clinics
    .filter(clinic => clinic.typeCode === '41')
    .map(clinic => ({ clinicId: clinic.id, name: clinic.name, sido: clinic.sido, city: clinic.city }));
  const range = monthRange({ from: options.from, to: options.to });
  const sql = outboundSql({ dataset: options.dataset, range, clinicIds: hospitals.map(hospital => hospital.clinicId) });
  const accountId = env.CF_ACCOUNT_ID, token = env.CF_API_TOKEN;
  if (options.dryRun || !accountId || !token) {
    console.log(`-- byKind: monthly totals by link kind, every institution\n${sql.byKind}\n\n-- byClinic: monthly totals by link kind, ${hospitals.length} institutions with typeCode 41\n${sql.byClinic}`);
    if (!options.dryRun) {
      console.error('CF_ACCOUNT_ID and CF_API_TOKEN are not both set: printed the SQL only, no report was fetched.');
      process.exitCode = 1;
    }
    return;
  }
  const kindRows = parseSqlRows(await querySql({ accountId, token, sql: sql.byKind }), ['ym', 'kind', 'clicks']);
  const clinicRows = parseSqlRows(await querySql({ accountId, token, sql: sql.byClinic }), ['ym', 'clinic', 'kind', 'clicks']);
  const report = buildReport({ range, dataset: options.dataset, kindRows, clinicRows, hospitals });
  process.stdout.write(options.format === 'csv' ? reportCsv(report) : JSON.stringify(report, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
