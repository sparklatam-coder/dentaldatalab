import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {buildAssetInventory,buildNaverFieldView,loadAssetInventory,naverObservationFields} from '../scripts/clinic-assets.mjs';
import {clinicAssetsPanel} from '../scripts/clinic-assets-pages.mjs';
import {latestNaverHours} from '../scripts/clinic-hours.mjs';

const before='2026-10-31T10:00:00Z',after='2026-11-01T10:00:00Z',later='2026-11-01T11:00:00Z';
const home='https://map.naver.com/p/entry/place/123',info='https://pcmap.place.naver.com/hospital/123/information';
const clinic={id:'clinic-a',name:'대조치과의원',typeCode:'51',sido:'경기',city:'양주시',address:'경기도 양주시 검증로 1',phone:'031-123-4567'};
const original=()=>({sourceUrl:home,checkedAt:before,bodyStatus:'read',fields:{name:clinic.name,phone:clinic.phone,address:clinic.address,hours:'월 09:00 - 18:00',reservationNotice:'홈 탭에서 읽은 예약 안내'}});
const owner=(more={})=>({sourceUrl:info,checkedAt:after,bodyStatus:'read',fields:{description:'새 소개\n\n3/7 휴진'},fieldStatus:{description:'read'},fieldSources:{description:info},fieldCheckedAt:{description:after},captureScope:['description'],declaredScopeComplete:true,identityReference:{sourceUrl:home,checkedAt:before},...more});
const batch=(observations,assets=[])=>({records:[{clinicId:clinic.id,name:clinic.name,checkedAt:later,naverPlaceObservations:observations,assets}]});
const inventory=batches=>buildAssetInventory([clinic],{batches});
const freeze=value=>{if(value&&typeof value==='object'){Object.freeze(value);Object.values(value).forEach(freeze);}return value;};

test('owner-only captures retain field-specific basic evidence and require an explicit previous same-Place identity reference',()=>{
  const prior=original(),next=owner(),input=freeze([batch([next]),batch([prior])]),snapshot=JSON.stringify(input);
  const result=inventory(input),record=result.records[0],view=buildNaverFieldView(freeze(record));
  const stored=record.naverPlaceObservations.find(o=>o.checkedAt===after);
  assert.equal(stored.identityMatch,true);
  assert.equal(stored.identityComparison.referenceMatch,true);
  assert.deepEqual(stored.fields,next.fields,'An older phone or hours must never be copied into the new capture');
  assert.deepEqual(view.fields.find(f=>f.key==='phone'),{key:'phone',status:'read',value:clinic.phone,partialValue:null,sourceUrl:home,checkedAt:before});
  assert.equal(view.fields.find(f=>f.key==='description').sourceUrl,info);
  assert.equal(view.fields.find(f=>f.key==='description').checkedAt,after);
  assert.equal(view.fields.find(f=>f.key==='reservationNotice').value,prior.fields.reservationNotice,'An information-only scope must not infer absence of a home-tab notice');
  assert.equal(latestNaverHours(record).checkedAt,before);
  assert.equal(latestNaverHours(record).url,home);
  const html=clinicAssetsPanel(record),main=html.split('<details class="asset-method observation-history">')[0];
  assert(main.includes(clinic.phone)&&main.includes(prior.fields.hours));
  assert(main.includes(`datetime="${before}"`)&&main.includes(`datetime="${after}"`));
  assert.match(main,/이전 기본정보를 이번에 다시 읽었다는 뜻은 아닙니다/);
  assert.match(main,/이번 수집 범위 1개 항목 확인 완료/);
  assert.match(main,/모든 탭·항목의 수집 완료를 뜻하지 않습니다/);
  assert.equal(JSON.stringify(input),snapshot);
  assert.equal(result.summary.naverFieldCoverage.phone,1);
  assert.equal(result.summary.naverFieldCoverage.description,1);
});

test('explicit not-displayed and incomplete statuses differ, preserve history, and never fabricate all-tab completion',()=>{
  const prior=original();prior.fields.description='이전에 읽은 전체 소개';prior.fields.representativeKeywords=['기존키워드'];
  prior.fieldSources={description:info,representativeKeywords:info};
  const next=owner({fields:{},incompleteFields:{description:'새 일부 <script>bad</script>\n...'},fieldStatus:{description:'incomplete',representativeKeywords:'not_displayed'},fieldSources:{description:info,representativeKeywords:info},fieldCheckedAt:{description:after,representativeKeywords:after},captureScope:['description','representativeKeywords'],declaredScopeComplete:true});
  const result=inventory([batch([prior,next])]),record=freeze(result.records[0]),view=buildNaverFieldView(record);
  assert.equal(view.fields.find(f=>f.key==='description').value,prior.fields.description);
  assert.equal(view.fields.find(f=>f.key==='description').latestAttempt.partialValue,next.incompleteFields.description);
  assert.equal(view.fields.find(f=>f.key==='representativeKeywords').status,'not_displayed');
  assert.equal(view.review.complete,false,'A declared flag does not overrule an incomplete field');
  assert.equal(result.summary.naverFieldCoverage.description,1,'Historical complete text still has evidence, alongside the incomplete update');
  assert.equal(result.summary.naverFieldCoverage.representativeKeywords,0);
  const html=clinicAssetsPanel(record),main=html.split('<details class="asset-method observation-history">')[0];
  assert.match(main,/이전 확인값을 표시합니다/);
  assert.match(main,/확인 당시 원문에 표시되지 않음/);
  assert.match(main,/일부 미완료/);
  assert(main.includes('&lt;script&gt;bad&lt;/script&gt;')&&!main.includes('<script>bad'));
  assert(!main.includes('기존키워드')&&html.includes('기존키워드'),'Superseded values remain only in the historical observation');
  const partialOnly=inventory([batch([original(),owner({fields:{},incompleteFields:{description:'일부만'},fieldStatus:{description:'incomplete'}})])]);
  assert.equal(partialOnly.summary.naverFieldCoverage.description,0);
});

test('identity references cannot rescue another place, a future reference, conflicting identity or a revoked observation',()=>{
  const variants=[owner({sourceUrl:'https://m.place.naver.com/hospital/456/information'}),owner({identityReference:{sourceUrl:home,checkedAt:after}}),owner({fields:{description:'새 소개',name:'타기관치과의원'}}),owner({identityReference:{sourceUrl:home,checkedAt:'invalid'}}),owner({identityReference:undefined})];
  for(const next of variants){const record=inventory([batch([original(),next])]).records[0];assert.equal(record.naverPlaceObservations[1].identityMatch,false);}
  const correction={kind:'naverMap',url:home,ownership:'third_party',bodyStatus:'read',checkedAt:later,evidenceUrls:[home],identityEvidence:[],notes:'다른 기관으로 정정'};
  const record=inventory([batch([original(),owner()],[correction])]).records[0];
  assert.equal(record.naverPlaceObservations[1].identityMatch,false);
  assert.equal(buildNaverFieldView(record),null);
  assert.equal(record.assets.find(a=>a.kind==='naverMap').ownership,'third_party');
});

test('multiple displayed channels resolve after identity references without clearing destination reads or manual exclusions',()=>{
  const links=[{kind:'naverBlog',url:'https://blog.naver.com/clinic-a'},{kind:'naverBlog',url:'https://blog.naver.com/clinic-b'},{kind:'instagram',url:'https://www.instagram.com/clinic-a/'},{kind:'facebook',url:'https://www.facebook.com/clinic-a/'},{kind:'naverMap',url:'https://map.naver.com/p/entry/place/999'}].map(link=>({...link,label:'표시 링크',sourceUrl:info,checkedAt:after}));
  const next=owner({fields:{description:'소개',naverBlog:links[0].url},observedChannelLinks:links});
  const curated=[{...links[2],ownership:'linked',bodyStatus:'blocked',checkedAt:before,evidenceUrls:[home],identityEvidence:[{field:'officialLink',value:links[2].url,sourceUrl:home}]},{...links[3],ownership:'third_party',bodyStatus:'read',checkedAt:before,evidenceUrls:[home],identityEvidence:[]}];
  for(const batches of [[batch([original()],curated),batch([next])],[batch([next]),batch([original()],curated)]]){
    const record=inventory(batches).records[0],blogs=record.assets.filter(a=>a.kind==='naverBlog');
    assert.equal(blogs.length,2);
    assert(blogs.every(a=>a.ownership==='linked'&&a.bodyStatus==='not_read'&&a.checkedAt===after&&a.evidenceUrls.includes(info)));
    assert.equal(record.assets.find(a=>a.kind==='instagram').bodyStatus,'blocked');
    assert.equal(record.assets.find(a=>a.kind==='instagram').checkedAt,before);
    assert.equal(record.assets.find(a=>a.kind==='facebook').ownership,'third_party');
    assert(!record.assets.some(a=>a.url.includes('/place/999')),'Another clinic map must not become an institution channel');
  }
  const unmatched=inventory([batch([owner({identityReference:undefined,observedChannelLinks:links})])]).records[0];
  assert(unmatched.assets.filter(a=>a.kind==='naverBlog').every(a=>a.ownership==='candidate'));
});

test('field display rejects invalid or different-Place sources and the loader picks up owner batches without touching input files',()=>{
  const next=owner({fields:{description:'유효 원문',directions:'다른 장소 원문',representativeKeywords:['위조']},fieldStatus:{description:'read',directions:'read',representativeKeywords:'read'},fieldSources:{description:info,directions:'https://map.naver.com/p/entry/place/999',representativeKeywords:'https://invalid.example/123'}});
  assert.deepEqual(naverObservationFields(next).map(f=>f.key),['description']);
  const root=fs.mkdtempSync(path.join(tmpdir(),'ddl-owner-loader-'));
  try{
    fs.mkdirSync(path.join(root,'data/assets'),{recursive:true});fs.mkdirSync(path.join(root,'data/research'),{recursive:true});
    fs.writeFileSync(path.join(root,'data/assets/naver-browser.json'),JSON.stringify(batch([original()])));
    const file=path.join(root,'data/assets/naver-yangju-owner-01.json'),bytes=JSON.stringify(batch([owner()]));fs.writeFileSync(file,bytes);
    const result=loadAssetInventory(root,{clinics:[clinic]});
    assert.equal(result.records[0].naverPlaceObservations.length,2);
    assert.equal(result.summary.naverFieldCoverage.description,1);
    assert.equal(fs.readFileSync(file,'utf8'),bytes);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('displayed hygiene and additional information retain capture limits outside the business-authored section',()=>{
  const note='최근 통합방제 점검월 라벨만 표시되고 값은 미표시. 위생 상태를 확정하지 않음.';
  const next=owner({fields:{description:'업체 소개',hygieneInformation:'최근 통합방제 점검월',additionalInformation:['표시 제목\n표시 원문 <b>그대로</b>'],accessibility:['휠체어 접근 가능']},fieldStatus:{description:'read',hygieneInformation:'read',additionalInformation:'read',accessibility:'read'},captureNotes:{hygieneInformation:note}});
  const record=inventory([batch([original(),next])]).records[0],html=clinicAssetsPanel(record);
  const table=html.match(/<table class="fact-table">[\s\S]*?<\/table>/)?.[0];
  const authored=html.match(/<details class="asset-method business-authored"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert(table.includes('네이버 표시 위생 정보')&&table.includes(note));
  assert(table.includes('네이버 표시 추가 정보')&&table.includes('&lt;b&gt;그대로&lt;/b&gt;'));
  assert(table.includes('접근성'));
  assert(!authored.includes('최근 통합방제 점검월')&&!authored.includes(note));
  assert.equal(record.naverPlaceObservations[1].captureNotes.hygieneInformation,note);
});

test('a field absent on the information tab does not erase its actual home-tab value',()=>{
  const homeUrl='https://m.place.naver.com/hospital/123/home';
  const prior={...original(),sourceUrl:homeUrl,fields:{...original().fields,amenities:['주차','예약']}};
  const next=owner({identityReference:{sourceUrl:homeUrl,checkedAt:before},fields:{description:'소개'},fieldStatus:{description:'read',amenities:'not_displayed'},fieldSources:{description:info,amenities:info},fieldCheckedAt:{description:after,amenities:after}});
  const record=inventory([batch([prior,next])]).records[0];
  const value=buildNaverFieldView(record).fields.find(f=>f.key==='amenities');
  assert.deepEqual(value.value,['주차','예약']);
  assert.equal(value.sourceUrl,homeUrl);
  assert.equal(value.checkedAt,before);
  assert.equal(value.latestAttempt.status,'not_displayed');
  assert.equal(value.latestAttempt.sourceUrl,info);
  assert.match(clinicAssetsPanel(record),/최근 확인한 다른 탭에는 이 항목이 표시되지 않았습니다/);
  const sameTab={...next,sourceUrl:homeUrl,fieldSources:{description:homeUrl,amenities:homeUrl}};
  assert.equal(buildNaverFieldView(inventory([batch([prior,sameTab])]).records[0]).fields.find(f=>f.key==='amenities').status,'not_displayed');
});
