import test from 'node:test';
import assert from 'node:assert/strict';
import {buildAssetInventory,naverObservationTab} from '../scripts/clinic-assets.mjs';
import {yangjuOwnerCoverage,registerClinicAssetsPages} from '../scripts/clinic-assets-pages.mjs';

const date='2026-11-01T01:00:00Z',sourceType='naver_business_owner_browser_capture';
const clinic=(id,more={})=>({id,name:'대조'+id+'치과의원',typeCode:'51',sido:'경기',city:'양주시',address:'경기 양주시 검증로 1',phone:'0311234567',...more});
const observation=(id,tab,more={})=>({sourceUrl:`https://pcmap.place.naver.com/hospital/123/${tab}`,checkedAt:date,bodyStatus:'read',fields:{name:'대조'+id+'치과의원',phone:'0311234567'},metadata:{tab},...more});
const row=(id,observations)=>({clinicId:id,name:'대조'+id+'치과의원',naverPlaceObservations:observations});

test('current Yangju coverage counts actual source-batch tabs and distinguishes descriptions without treating a booking link as a booking read',()=>{
  const clinics=['read','absent','partial','home-only','legacy','uncollected'].map(id=>clinic(id));clinics.push(clinic('outside',{city:'의정부시'}));
  const batches=[{records:[row('legacy',[observation('legacy','information',{fields:{name:'대조legacy치과의원',phone:'0311234567',description:'과거 소개'}})])]},
    {sourceType,records:[row('read',[observation('read','home',{fields:{name:'대조read치과의원',phone:'0311234567',booking:'https://booking.naver.com/booking/13/bizes/123'}}),observation('read','information',{fields:{name:'대조read치과의원',phone:'0311234567',description:'실제 소개'}})]),row('absent',[observation('absent','information',{fieldStatus:{description:'not_displayed'}})]),row('partial',[observation('partial','information',{fieldStatus:{description:'incomplete'},incompleteFields:{description:'앞부분만'}})]),row('home-only',[observation('home-only','home')]),row('outside',[observation('outside','information',{fields:{name:'대조outside치과의원',phone:'0311234567',description:'다른시'}})])]}];
  const inventory=buildAssetInventory(clinics,{batches}),before=JSON.stringify(inventory),coverage=yangjuOwnerCoverage(inventory);
  assert.equal(coverage.total,6);assert.equal(coverage.captured,4);
  assert.deepEqual(coverage.byDescription,{read:1,not_displayed:1,incomplete:1,pending:3});
  assert.deepEqual(coverage.tabs,{home:{read:2,observations:2},information:{read:3,observations:3},booking:{read:0,observations:0}});
  assert.equal(coverage.records.find(r=>r.clinicId==='legacy').captured,false,'Earlier generic Naver observations do not count in the current owner collection');
  assert.equal(JSON.stringify(inventory),before);
  const files=new Map(),pages=new Map();
  registerClinicAssetsPages({inventory,assetVersion:'test',put:(path,value)=>files.set(path,value),page:(route,options)=>pages.set(route,options)});
  assert.deepEqual(JSON.parse(files.get('data/clinic-assets/yangju-owner-coverage.json')),coverage);
  const index=JSON.parse(files.get('data/clinic-assets/index.json'));
  assert.equal(index.find(r=>r.clinicId==='outside').ownerCapture,null);
  assert.equal(index.find(r=>r.clinicId==='read').ownerCapture.descriptionStatus,'read');
  const html=pages.get('/clinic-assets/').body;
  assert.match(html,/양주 업체 작성 안내 수집현황/);
  assert(html.includes('이번 수집 관찰 4 / 6곳'));
  for(const key of ['all','uncollected','read','not_displayed','incomplete','pending'])assert(html.includes(`?owner=${key}#asset-search`));
  assert.match(html,/예약 버튼·URL 확보를 예약 탭 열람으로 세지 않습니다/);
  assert.match(html,/모든 탭·항목이나 전국 기관의 수집 완료를 뜻하지 않습니다/);
});

test('tab identification uses actual explicit paths, supports observed placePath, and leaves legacy root URLs unknown',()=>{
  assert.equal(naverObservationTab('https://map.naver.com/p/entry/place/123?placePath=%2Finformation%3Ffrom%3Dmap'),'information');
  assert.equal(naverObservationTab('https://m.place.naver.com/hospital/123/booking'),'booking');
  assert.equal(naverObservationTab('https://map.naver.com/p/entry/place/123'),null);
  assert.equal(naverObservationTab('https://evil.example/hospital/123/information'),null);
});
