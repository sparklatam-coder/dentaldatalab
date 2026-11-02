import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {validateSearchStatus,metricLabel,registerSearchStatusPage} from '../scripts/search-status.mjs';
const sample=()=>JSON.parse(fs.readFileSync(new URL('../data/content/search-status.json',import.meta.url)));
test('missing search metrics remain distinct from genuine zero',()=>{assert.equal(metricLabel(null),'집계 대기');assert.equal(metricLabel(0),'0');const s=sample();s.engines[0].clicks=-1;assert.throws(()=>validateSearchStatus(s));});
test('status page does not turn discovered URLs into indexed-page metrics',()=>{const s=sample();let route,payload;registerSearchStatusPage({page:(r,p)=>{route=r;payload=p},put:()=>{},status:s});assert.equal(route,'/data/search-status/');assert.match(payload.body,/발견 URL 수는 색인된 페이지 수가 아닙니다/);assert.equal((payload.body.match(/<dd>집계 대기<\/dd>/g)||[]).length,9);assert.match(payload.body,/직접 확인일/);});
