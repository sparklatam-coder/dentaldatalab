import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {citationPack,citationChart,citationSection,registerCitationFiles} from '../scripts/yangju-citation.mjs';
const read=()=>JSON.parse(fs.readFileSync(new URL('../data/content/report-archives/yangju-hours-evidence-v1.json',import.meta.url)));
const origin='https://dentaldatalab.com';
test('citation carries both sources, dates, population, limitations and a stable version',()=>{
 const a=read(),c=citationPack(a,origin);assert.match(c.text,/67곳/);assert.match(c.text,/4곳/);assert.match(c.text,/66곳/);assert(c.text.includes(a.snapshotDate));assert(c.text.includes(c.period));assert.match(c.text,/현재 진료·영업 여부를 검증한 수치가 아니다/);assert(c.text.includes(c.evidenceUrl));assert.equal(c.version,citationPack(JSON.parse(JSON.stringify(a)),origin).version);
 const bad=read();bad.coverage.both++;assert.throws(()=>citationPack(bad,origin),/population/);
});
test('SVG contains the actual two populations, source attribution and readable limitations without external dependencies',()=>{
 const a=read(),svg=citationChart(a,origin);assert.match(svg,/4 \/ 67곳/);assert.match(svg,/66 \/ 67곳/);assert(svg.includes('현재 진료 여부가 아닙니다'));assert(svg.includes(a.snapshotDate));assert(svg.includes('수집·가공·분석: 치과데이터랩'));assert(svg.includes('width="'+4/67*880+'"'));assert(!svg.includes('<script'));assert(!svg.includes('href='));
 const html=citationSection(a,origin);assert.match(html,/data-citation-target="yangju-citation"/);assert.match(html,/data-download-chart/);assert.match(html,/<noscript>/);
});
test('old version evidence stays available, while an unarchived release is rejected',()=>{
 const a=read(),b=read();b.observedAt='2026-11-03T01:00:00Z';assert.notEqual(citationPack(a,origin).version,citationPack(b,origin).version);
 const files=new Map(),put=(p,v)=>files.set(p,v);assert.throws(()=>registerCitationFiles({put,analysis:b,domain:origin,archives:[a]}),/Archive/);
 registerCitationFiles({put,analysis:b,domain:origin,archives:[a,b]});
 for(const record of [a,b]){const c=citationPack(record,origin);assert.deepEqual(JSON.parse(files.get(c.base.slice(1)+'.json')).analysis,record);assert(files.get(c.base.slice(1)+'.svg').includes(c.version));}
 const versions=JSON.parse(files.get('data/reports/yangju-hours-evidence-versions.json'));assert.equal(versions.versions.length,2);
});
