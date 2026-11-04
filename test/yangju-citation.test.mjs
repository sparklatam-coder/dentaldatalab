import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {citationPack,citationChart,citationSection,registerCitationFiles,loadYangjuArchives,DEFAULT_OPERATOR_NAME} from '../scripts/yangju-citation.mjs';
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
test('the configured operator name flows into citation text, chart and files, with the current name as fallback',()=>{
 const a=read();
 assert.equal(DEFAULT_OPERATOR_NAME,'노크AI');
 for(const name of [null,undefined,'',' '])assert(citationPack(a,origin,name).text.includes('치과데이터랩(운영: 노크AI)'),String(name));
 const c=citationPack(a,origin,'새 운영자 <b>');
 assert(c.text.includes('치과데이터랩(운영: 새 운영자 <b>)'));assert.equal(c.operator,'새 운영자 <b>');
 assert.equal(c.version,citationPack(a,origin).version,'the operator name is not part of the analysis version');
 const svg=citationChart(a,origin,'새 운영자 <b>');assert(svg.includes('운영: 새 운영자 &lt;b&gt;'));assert(!svg.includes('노크AI'));
 const html=citationSection(a,origin,'새 운영자 <b>');assert(html.includes('운영: 새 운영자 &lt;b&gt;'));
 const files=new Map();registerCitationFiles({put:(p,v)=>files.set(p,v),analysis:a,domain:origin,archives:[a],operatorName:'새 운영자'});
 assert(files.get(c.base.slice(1)+'.txt').includes('운영: 새 운영자'));assert(files.get(c.base.slice(1)+'.svg').includes('운영: 새 운영자'));
 assert(JSON.parse(files.get(c.base.slice(1)+'.json')).citation.includes('운영: 새 운영자'));
});
test('archives load from an explicit project root and default to this repository',()=>{
 const fromRepo=loadYangjuArchives(),fromRoot=loadYangjuArchives({root:path.resolve(path.dirname(new URL(import.meta.url).pathname),'..')});
 assert(fromRepo.length>=1);assert.deepEqual(fromRoot,fromRepo);
 const empty=fs.mkdtempSync(path.join(os.tmpdir(),'ddl-archives-'));
 try{
  assert.throws(()=>loadYangjuArchives({root:empty}),/npm run archive:yangju/);
  assert.deepEqual(loadYangjuArchives({root:empty,allowEmpty:true}),[]);
  fs.mkdirSync(path.join(empty,'data/content/report-archives'),{recursive:true});
  fs.writeFileSync(path.join(empty,'data/content/report-archives/yangju-hours-evidence-v1.json'),JSON.stringify(read()));
  fs.writeFileSync(path.join(empty,'data/content/report-archives/other.json'),'{}');
  assert.deepEqual(loadYangjuArchives({root:empty}),[read()]);
 }finally{fs.rmSync(empty,{recursive:true,force:true});}
});
test('old version evidence stays available, while an unarchived release is rejected',()=>{
 const a=read(),b=read();b.observedAt='2026-11-03T01:00:00Z';assert.notEqual(citationPack(a,origin).version,citationPack(b,origin).version);
 const files=new Map(),put=(p,v)=>files.set(p,v);assert.throws(()=>registerCitationFiles({put,analysis:b,domain:origin,archives:[a]}),/not archived\. Run `npm run archive:yangju`/);
 registerCitationFiles({put,analysis:b,domain:origin,archives:[a,b]});
 for(const record of [a,b]){const c=citationPack(record,origin);assert.deepEqual(JSON.parse(files.get(c.base.slice(1)+'.json')).analysis,record);assert(files.get(c.base.slice(1)+'.svg').includes(c.version));}
 const versions=JSON.parse(files.get('data/reports/yangju-hours-evidence-versions.json'));assert.equal(versions.versions.length,2);
});
