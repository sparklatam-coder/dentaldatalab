import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {collectDataQuality,loadDataQuality,qualityHttpUrl} from '../scripts/data-quality.mjs';
import {dataQualityHomePanel,registerDataQualityPage} from '../scripts/data-quality-pages.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const checkedAt='2026-11-02T04:00:00Z';
const clinic=(i,patch={})=>({id:'c-'+i.toString(16).padStart(12,'0'),name:'기관'+i,typeCode:'51',type:'치과의원',sidoCode:'310000',sido:'경기',cityCode:'312700',city:'양주시',address:`경기도 양주시 옥정로 ${i}, 2층`,phone:'031-123-4567',postalCode:'11473',lat:37.8,lon:127.1,doctors:{total:0,specialist:0},hours:{},website:null,specialties:[],equipment:[],sourceIds:['hira-base'],...patch});
const data=clinics=>({snapshotDate:'2026-09-30',observedAt:'2026-10-31T10:27:09.045Z',clinics});
const manifest={snapshotDate:'2026-09-30',archive:{sha256:'archive-hash'},sources:['hira-base','hira-detail','hira-specialties','hira-equipment'].map(id=>({id,url:'https://www.data.go.kr/data/15051059/fileData.do',snapshotDate:'2026-09-30'}))};
const audit=(rows,options={})=>collectDataQuality(data(rows),{checkedAt,manifest,...options});
function freeze(o){if(o&&typeof o==='object'){Object.freeze(o);Object.values(o).forEach(freeze);}return o;}

test('missing, unsupported formats and explicit zero have separate meanings without changing input',()=>{
  const rows=freeze([clinic(1,{phone:null,lat:null,lon:127,doctors:{total:0,specialist:0}}),clinic(2,{phone:'577-2870',website:'http://',hours:{mon:{open:'20:00',close:'02:00'}}}),clinic(3,{phone:'031-123-4567',website:'example.org',doctors:{total:null,specialist:0},hours:{mon:{open:'09:00',close:'18:00'}},sourceIds:['hira-base','hira-detail']})]);
  const original=JSON.stringify(rows),r=audit(rows);
  assert.equal(JSON.stringify(rows),original);
  assert.equal(r.metrics.phone.recorded,2);assert.equal(r.metrics.phone.missing,1);assert.equal(r.metrics.phone.formatPass,1);assert.equal(r.metrics.phone.formatReview,1);
  assert.equal(r.rules.doctor_count_review.rows,1);assert.equal(r.metrics.coordinates.missing,1);assert.equal(r.metrics.website.missing,1);assert.equal(r.metrics.website.formatReview,1);
  assert.equal(r.metrics.hours.recorded,1);assert.equal(r.rules.hours_value_review.rows,1);assert.equal(r.summary.currentOperatingStatusVerified,0);
});

test('duplicate candidates combine repeated rules, preserve room/hyphen distinctions, and ignore names alone',()=>{
  const rows=[clinic(1,{name:'같은 치과',address:'경기도 양주시 길 1-23, 2층'}),clinic(2,{name:'같은치과',address:'경기도 양주시 길 1-23, 2층',phone:'031 123 4567'}),clinic(3,{name:'같은치과',address:'경기도 양주시 길 12-3, 2층',phone:'031-987-6543'}),clinic(4,{name:'다른치과',phone:'031-123-4567'}),clinic(5,{name:'지역번호생략',phone:'577-2870'}),clinic(6,{name:'지역번호생략',address:'경기도 양주시 길 99',phone:'577-2870'})];
  const r=audit(rows);assert.equal(r.summary.candidateGroups,1);assert.equal(r.summary.candidateInstitutions,2);assert.equal(r.summary.candidateRuleGroups,2);
  assert.deepEqual(r.duplicates.candidateGroups[0].kinds,['same_name_address','same_name_phone']);assert.equal(r.summary.sharedPhoneGroups,1);
  assert.equal(r.reviewQueue.find(row=>row.id===rows[3].id)?.rules.some(rule=>rule.startsWith('same_name')),false);
  assert.equal(r.reviewQueue.find(row=>row.id===rows[5].id)?.rules.includes('same_name_phone'),false);
});

test('structural/source problems are visible and source-matching counts cannot hide duplicate IDs',()=>{
  const rows=[clinic(1),clinic(1,{name:'또다른기관',sourceIds:['hira-base','unknown']}),clinic(3,{typeCode:'01',type:'종합병원',sourceIds:[],postalCode:'123456',lat:91})];
  const r=audit(rows);assert.equal(r.summary.duplicateIdGroups,1);assert.equal(r.rules.duplicate_id.rows,2);assert.equal(r.rules.type_mismatch.rows,1);assert.equal(r.rules.source_reference_review.rows,2);assert.equal(r.metrics.postalCode.formatReview,1);assert.equal(r.metrics.coordinates.formatReview,1);
  const foreign=audit([],{manifest:{...manifest,sources:[{id:'hira-base',url:'https://example.org/source',snapshotDate:'2026-09-30'}]}});assert.equal(foreign.summary.sourceCatalogIssues,1);
});

test('old official-source evidence is linked only with matching bytes, population, archive and past timestamps',()=>{
  const priorImportAudit={checkedAt:'2026-10-31T14:00:00Z',checks:[{name:'Reimported clinics byte equality',status:'passed',actualSha256:'data-hash',expectedSha256:'data-hash'}]};
  const officialVerification={completedAt:'2026-10-31T15:00:00Z',status:'official_snapshot_matched',expectedSnapshotDate:'2026-09-30',download:{archiveMatchesManifest:true,sha256:'archive-hash'},comparison:{mismatchCount:0,localRows:1,dentalRows:1}};
  const options={priorImportAudit,officialVerification,sourceDataSha256:'data-hash'};
  assert.equal(audit([clinic(1)],options).provenance.linkedHistoricalSourceCheck,true);
  assert.equal(audit([clinic(1)],{...options,sourceDataSha256:'changed'}).provenance.linkedHistoricalSourceCheck,false);
  assert.equal(audit([clinic(1),clinic(2)],options).provenance.linkedHistoricalSourceCheck,false);
  assert.equal(audit([clinic(1)],{...options,officialVerification:{...officialVerification,completedAt:'2027-01-01T00:00:00Z'}}).provenance.linkedHistoricalSourceCheck,false);
  assert.equal(audit([clinic(1)]).provenance.linkedHistoricalSourceCheck,false);
});

test('empty denominator and mixed source labels remain explicit; malformed timestamps fail',()=>{
  const empty=audit([]);assert.equal(empty.metrics.phone.recordedPercent,null);assert.equal(empty.summary.total,0);
  const r=audit([clinic(1,{sidoCode:'360000',sido:'전남광주'}),clinic(2,{sidoCode:'360000',sido:'전남'})]);assert.equal(r.regions.mixedSidoLabels.length,1);assert.equal(r.scope.total,2);
  assert.throws(()=>audit([],{checkedAt:'2026-11-02'}),/timestamp/);
  assert.equal(qualityHttpUrl('javascript:alert(1)'),null);assert.equal(qualityHttpUrl('https://user:pass@example.org'),null);
});

test('quality page escapes fields, exposes IDs/evidence, and downloads detailed rows without rendering them all',()=>{
  const rows=[clinic(1,{name:'<script>alert(1)</script>'}),clinic(2,{name:'<script>alert(1)</script>'}),...Array.from({length:500},(_,i)=>clinic(i+3,{phone:null}))];
  const r=audit(rows),pages=[],files=new Map();registerDataQualityPage({page:(...args)=>pages.push(args),put:(file,body)=>files.set(file,body),report:r});
  assert.equal(pages[0][0],'/data/quality/');const html=pages[0][1].body;
  assert(!html.includes('<script>alert(1)</script>'));assert(html.includes('&lt;script&gt;'));assert(html.includes(rows[0].id));assert(html.includes('https://www.data.go.kr/data/15051059/fileData.do'));
  assert(!html.includes(rows.at(-1).id));assert.equal(JSON.parse(files.get('data/quality/review-queue.json')).records.length,r.reviewQueue.length);
  assert(!Object.hasOwn(JSON.parse(files.get('data/quality/report.json')),'reviewQueue'));assert(dataQualityHomePanel(r).includes('/data/quality/'));assert(html.includes('현재 영업·연결 확인은 전수 검증하지 않았습니다.'));
});

test('national audit reconciles the complete snapshot, leaves bytes unchanged and finds four conservative candidate pairs',()=>{
  const input=new URL('../data/clinics.json',import.meta.url),before=fs.readFileSync(input),digest=b=>createHash('sha256').update(b).digest('hex');
  const r=loadDataQuality(root,{checkedAt});
  assert.equal(r.summary.total,19681);assert.equal(r.summary.byLevel.error,0);assert.equal(r.summary.manifestMismatches,0);assert.equal(r.summary.sourceCatalogIssues,0);
  assert.equal(r.metrics.phone.missing,72);assert.equal(r.metrics.phone.formatReview,833);assert.equal(r.metrics.website.missing,17963);assert.equal(r.metrics.hours.missing,14855);
  assert.equal(r.summary.candidateGroups,4);assert.equal(r.summary.candidateInstitutions,8);assert.equal(r.summary.candidateRuleGroups,5);assert.equal(r.provenance.linkedHistoricalSourceCheck,true);
  assert.equal(digest(fs.readFileSync(input)),digest(before));assert.equal(r.scope.sourceDataSha256,digest(before));
  for(const m of Object.values(r.metrics)){assert.equal(m.recorded+m.missing,m.total);assert.equal(m.formatPass+m.formatReview,m.recorded);}
  for(const group of r.duplicates.candidateGroups){assert.equal(group.records.length,2);assert.notEqual(group.records[0].id,group.records[1].id);}
});
