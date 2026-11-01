import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {buildAssetInventory,loadAssetInventory,bookingPublisherContent,bookingPublisherContents,bookingContentScope,naverBookingSourceUrl} from '../scripts/clinic-assets.mjs';
import {clinicAssetsPanel,yangjuOwnerCoverage} from '../scripts/clinic-assets-pages.mjs';
import {esc} from '../src/shared.mjs';

const prior='2026-11-01T01:00:00Z',readAt='2026-11-01T02:00:00Z',failedAt='2026-11-01T03:00:00Z';
const url='https://m.booking.naver.com/booking/13/bizes/123?area=map',sourceUrl='https://booking.naver.com/booking/13/bizes/123';
const clinic={id:'clinic-a',name:'대조치과의원',typeCode:'51',sido:'경기',city:'양주시',address:'경기 양주시 검증로 1',phone:'0311234567'};
const linked={kind:'booking',url,ownership:'linked',bodyStatus:'not_read',checkedAt:prior,evidenceUrls:['https://map.naver.com/p/entry/place/456'],identityEvidence:[{field:'officialLink',value:url,sourceUrl:'https://map.naver.com/p/entry/place/456'}]};
const batch=(assets,sourceType)=>({sourceType,records:[{clinicId:clinic.id,name:clinic.name,assets}]});
const capture=(more={})=>({kind:'booking',url,bodyStatus:'read',checkedAt:readAt,ownershipReference:{url,checkedAt:prior,ownership:'linked'},publisherContent:{title:'예약 안내 <script>',text:'원문 첫 줄\n\n5/5 휴진 <img src=x>\n예약은 확인 연락 후 확정',sourceUrl,checkedAt:readAt},bodyChecks:[{sourceUrl,checkedAt:readAt,bodyStatus:'read',captureMethod:'browser_ui_saved_html'}],...more});
const result=batches=>buildAssetInventory([clinic],{batches});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};

test('booking publisher text supplements a linked asset with its actual URL and time without creating a Place observation',()=>{
  const original=capture();
  for(const batches of [[batch([linked]),batch([original],'naver_booking_browser_capture')],[batch([original],'naver_booking_browser_capture'),batch([linked])]]){
    freeze(batches);const before=JSON.stringify(batches),inventory=result(batches),record=inventory.records[0],asset=record.assets[0];
    assert.equal(asset.ownership,'linked');assert.equal(asset.bodyStatus,'read');assert.equal(asset.checkedAt,readAt);
    assert.deepEqual(asset.ownershipReference,original.ownershipReference);assert.equal(asset.ownershipEvidenceAt,prior);
    assert.deepEqual(bookingPublisherContent(asset),original.publisherContent);
    assert.deepEqual(record.naverPlaceObservations,[]);
    assert.equal(asset.bodyChecks[0].sourceType,'naver_booking_browser_capture');
    const html=clinicAssetsPanel(record),section=html.match(/<details class="asset-method business-authored"[^>]*>[\s\S]*?<\/details>/)?.[0];
    assert(section.includes(`href="${sourceUrl}"`)&&section.includes(`datetime="${readAt}"`));
    assert(section.includes(esc(original.publisherContent.text))&&!section.includes('<img src=x>'));
    assert(section.includes(esc(original.publisherContent.title))&&!section.includes('<script>'));
    assert.match(section,/업체가 작성한 공개 예약 목록·안내/);
    assert.doesNotMatch(section,/2026-05-05|2026년 5월/);
    assert.equal(JSON.stringify(batches),before);
    const coverage=yangjuOwnerCoverage(inventory);
    assert.equal(coverage.tabs.booking.read,0);assert.equal(coverage.bookingPages.read,1);assert.equal(coverage.bookingPages.attempted,1);
  }
});

test('a failed booking visit records empty content and later failure never deletes an earlier read publisher text',()=>{
  const failure=capture({bodyStatus:'blocked',checkedAt:failedAt,publisherContent:undefined,bodyChecks:[{sourceUrl,checkedAt:failedAt,bodyStatus:'blocked',notes:'공개 페이지 접근 실패'}]});
  const only=result([batch([linked]),batch([failure],'naver_booking_browser_capture')]);
  assert.equal(only.records[0].assets[0].bodyStatus,'blocked');assert.equal(bookingPublisherContent(only.records[0].assets[0]),null);
  assert.equal(yangjuOwnerCoverage(only).bookingPages.read,0);
  for(const captures of [[capture(),failure],[failure,capture()]]){
    const inventory=result([batch([linked]),batch(captures,'naver_booking_browser_capture')]),asset=inventory.records[0].assets[0];
    assert.equal(asset.bodyStatus,'read');assert.equal(asset.checkedAt,readAt);assert.equal(asset.publisherContent.checkedAt,readAt);
    assert.deepEqual(asset.bodyChecks.map(check=>check.bodyStatus),['read','blocked']);
    assert.match(clinicAssetsPanel(inventory.records[0]),/최근 예약 페이지 접근 실패/);
    assert.equal(yangjuOwnerCoverage(inventory).bookingPages.latestFailed,1);
  }
  const newerListing=result([batch([{...linked,checkedAt:failedAt}]),batch([capture()],'naver_booking_browser_capture')]).records[0].assets[0];
  assert.equal(newerListing.bodyStatus,'read','A later listing link is not a destination-body observation');
  assert.equal(newerListing.checkedAt,readAt);
});

test('publisher captures cannot promote candidates or exclusions, or borrow another business or an unsafe source',()=>{
  for(const ownership of ['candidate','third_party']){
    const asset=result([batch([{...linked,ownership}]),batch([capture()],'naver_booking_browser_capture')]).records[0].assets[0];
    assert.equal(asset.ownership,ownership);assert.equal(bookingPublisherContent(asset),null);assert.equal(asset.bodyChecks,undefined);
  }
  for(const other of ['https://booking.naver.com/booking/13/bizes/999','https://booking.naver.com.evil.example/booking/13/bizes/123','javascript:alert(1)','https://booking.naver.com/booking/13/bizes/123fake']){
    const raw=capture({publisherContent:{...capture().publisherContent,sourceUrl:other},bodyChecks:[{sourceUrl:other,checkedAt:readAt,bodyStatus:'read'}]});
    const asset=result([batch([linked]),batch([raw],'naver_booking_browser_capture')]).records[0].assets[0];
    assert.equal(bookingPublisherContent(asset),null);assert.equal(asset.bodyStatus,'not_read');
  }
  assert.equal(naverBookingSourceUrl('https://booking.naver.com/booking/13/bizes/123fake'),null);
  const invalidExisting=result([batch([{...linked,url:'https://booking.naver.com/booking/13/bizes/123fake'}]),batch([capture()],'naver_booking_browser_capture')]).records[0].assets[0];
  assert.equal(invalidExisting.bodyStatus,'not_read');assert.equal(invalidExisting.bodyChecks,undefined);
  const official={...linked,ownership:'official',bodyStatus:'read',identityEvidence:[{field:'phone',value:clinic.phone,sourceUrl:url}]};
  assert.equal(result([batch([official]),batch([capture()],'naver_booking_browser_capture')]).records[0].assets[0].ownership,'official');
});

test('a read booking page with missing or incomplete publisher text is not counted as collected publisher content',()=>{
  for(const publisherContentStatus of ['not_displayed','incomplete']){
    const raw=capture({publisherContent:undefined,publisherContentStatus,bodyChecks:[{sourceUrl,checkedAt:readAt,bodyStatus:'read',publisherContentStatus}]});
    const inventory=result([batch([linked]),batch([raw],'naver_booking_browser_capture')]),record=inventory.records[0];
    assert.equal(record.assets[0].bodyStatus,'read');assert.equal(bookingPublisherContent(record.assets[0]),null);
    assert.equal(record.assets[0].publisherContentStatus,publisherContentStatus);
    const coverage=yangjuOwnerCoverage(inventory);assert.equal(coverage.bookingPages.read,1);assert.equal(coverage.bookingPages.contentRead,0);
    const html=clinicAssetsPanel(record);
    assert(html.includes(publisherContentStatus==='not_displayed'?'별도 안내 원문이 표시되지 않았습니다':'예약 안내 원문 수집이 완료되지 않았습니다'));
    assert(html.includes(`href="${sourceUrl}"`)&&html.includes(`datetime="${readAt}"`));
  }
});

test('the dedicated booking batch loads without relaxing Place host checks or rewriting capture data',()=>{
  const root=fs.mkdtempSync(path.join(tmpdir(),'ddl-booking-loader-'));
  try{
    fs.mkdirSync(path.join(root,'data/assets'),{recursive:true});fs.mkdirSync(path.join(root,'data/research'),{recursive:true});
    fs.writeFileSync(path.join(root,'data/assets/yangju-01.json'),JSON.stringify(batch([linked])));
    const file=path.join(root,'data/assets/naver-yangju-booking-01.json'),bytes=JSON.stringify(batch([capture()],'naver_booking_browser_capture'));fs.writeFileSync(file,bytes);
    const inventory=loadAssetInventory(root,{clinics:[clinic]});assert.equal(inventory.records[0].assets[0].bodyStatus,'read');assert.equal(fs.readFileSync(file,'utf8'),bytes);
    assert.throws(()=>result([{records:[{clinicId:clinic.id,name:clinic.name,assets:[],naverPlaceObservations:[{sourceUrl,checkedAt:readAt,bodyStatus:'read',fields:{description:'예약 원문'}}]}]}]),/actual Naver Place URL/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('booking home and each service tab retain independent latest texts despite query changes and a later failure',()=>{
  const detailUrl='https://m.booking.naver.com/booking/13/bizes/123/items/99?lang=ko';
  const document=(contentKind,source,text,checkedAt)=>capture({checkedAt,contentKind,publisherContent:{contentKind,title:contentKind,text,sourceUrl:source,checkedAt},bodyChecks:[{sourceUrl:source,checkedAt,bodyStatus:'read',contentKind}]});
  const oldHome=document('home',sourceUrl,'초기 홈 원문',readAt);
  const newHome=document('home',sourceUrl+'?area=new','확장해서 읽은 홈 원문','2026-11-01T04:00:00Z');
  newHome.captureMetadata={sections:[{kind:'serviceDescriptions',label:'예약 목록 카드 설명',status:'incomplete'}],declaredScopeComplete:false};
  const detail=document('service_detail',detailUrl,'서비스 상세 원문',failedAt);
  const notice=document('service_notice',detailUrl,'같은 URL의 알립니다 원문','2026-11-01T03:30:00Z');
  const another=document('service_detail',detailUrl.replace('/items/99','/items/100'),'다른 서비스 원문','2026-11-01T03:40:00Z');
  const failure=capture({checkedAt:'2026-11-01T05:00:00Z',bodyStatus:'blocked',contentKind:'service_detail',publisherContent:undefined,bodyChecks:[{sourceUrl:detailUrl,checkedAt:'2026-11-01T05:00:00Z',bodyStatus:'blocked',contentKind:'service_detail'}]});
  const captures=[oldHome,detail,notice,another,newHome,failure];
  for(const ordered of [captures,[...captures].reverse()]){
    const inventory=result([batch([linked]),batch(ordered,'naver_booking_browser_capture')]),record=inventory.records[0],asset=record.assets[0],contents=bookingPublisherContents(asset);
    assert.equal(contents.length,4);assert.equal(asset.publisherContents.length,4);
    assert(contents.some(c=>c.text===newHome.publisherContent.text)&&!contents.some(c=>c.text===oldHome.publisherContent.text));
    for(const captured of [newHome,detail,notice,another])assert.deepEqual(contents.find(c=>bookingContentScope(c)===bookingContentScope(captured.publisherContent)),captured.publisherContent);
    assert.equal(asset.publisherContent.text,newHome.publisherContent.text,'The legacy single field is only a compatibility view');
    const html=clinicAssetsPanel(record);
    assert.equal((html.match(/data-booking-publisher-text/g)||[]).length,4);
    for(const content of contents)assert(html.includes(esc(content.text))&&html.includes(esc(content.sourceUrl)));
    assert.match(html,/이 화면에서 전문 미확보: 예약 목록 카드 설명/);
    assert.match(html,/모든 예약 항목의 수집 완료를 뜻하지 않습니다/);
    const sections=[...html.matchAll(/<section data-booking-content-scope="([^"]+)">([\s\S]*?)<\/section>/g)];
    assert(sections.find(([,scope])=>scope==='123:99:service_detail')[2].includes('최근 예약 페이지 접근 실패'));
    assert(!sections.find(([,scope])=>scope==='123::home')[2].includes('최근 예약 페이지 접근 실패'));
  }
});

test('every latest original booking document in the actual capture batch is preserved and rendered exactly',()=>{
  const root=new URL('../',import.meta.url),sourceData=JSON.parse(fs.readFileSync(new URL('data/clinics.json',root)));
  const sourceBatch=JSON.parse(fs.readFileSync(new URL('data/assets/naver-yangju-booking-01.json',root)));
  const expected=new Map();
  for(const record of sourceBatch.records)for(const asset of record.assets){
    const content=asset.publisherContent;if(!content)continue;
    const key=record.clinicId+'|'+bookingContentScope(content),previous=expected.get(key);
    if(!previous||Date.parse(content.checkedAt)>Date.parse(previous.checkedAt))expected.set(key,content);
  }
  const inventory=loadAssetInventory(new URL('../',import.meta.url).pathname,sourceData),actual=new Map();
  for(const record of inventory.records){
    const contents=record.assets.flatMap(asset=>bookingPublisherContents(asset));if(!contents.length)continue;
    const html=clinicAssetsPanel(record);
    assert.equal((html.match(/data-booking-publisher-text/g)||[]).length,contents.length);
    for(const content of contents){actual.set(record.clinicId+'|'+bookingContentScope(content),content);assert(html.includes(esc(content.text)));}
  }
  assert(expected.size>0);
  assert.deepEqual(actual,expected,'Latest home/service-detail/service-notice text, URL and capture time must all match the original batch');
});
