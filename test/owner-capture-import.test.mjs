import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOwnerCapture} from '../scripts/import-yangju-owner-captures.mjs';

const oldUrl='https://map.naver.com/p/entry/place/12345';
const newUrl='https://pcmap.place.naver.com/hospital/12345/information';
const oldTime='2026-10-31T20:00:00Z',newTime='2026-10-31T21:00:00Z';
const clinic={id:'c-fixture',name:'관찰치과의원',sidoCode:'310000',cityCode:'312700'};
const options=()=>({clinicsById:new Map([[clinic.id,clinic]]),referenceRecords:new Map([[clinic.id,{assets:[],naverPlaceObservations:[{sourceUrl:oldUrl,checkedAt:oldTime,bodyStatus:'read',identityMatch:true}]}]])});
const capture=()=>({schemaVersion:1,clinicId:clinic.id,name:clinic.name,sourceUrl:newUrl,checkedAt:newTime,bodyStatus:'read',captureMethod:'browser_ui_saved_html',
  captureScope:['description'],fields:{description:'예약 문구\n\n마지막 문장.'},fieldStatus:{description:'read'},fieldSources:{description:newUrl},
  identityReference:{sourceUrl:oldUrl,checkedAt:oldTime},metadata:{savedHtmlSha256:'a'.repeat(64)}});

test('owner-only imports preserve the observed text and explicit evidence without copying identity fields',()=>{
  const input=capture(),before=structuredClone(input),o=validateOwnerCapture(input,options()).observation;
  assert.equal(o.fields.description,input.fields.description);
  assert.equal(o.fieldSources.description,newUrl);
  assert.equal(o.fieldCheckedAt.description,newTime);
  assert.equal(o.fieldCaptureMethod.description,'browser_ui_saved_html');
  assert.deepEqual(o.identityReference,input.identityReference);
  assert.equal(o.fields.name,undefined);assert.equal(o.fields.address,undefined);assert.equal(o.fields.phone,undefined);
  assert.equal(o.declaredScopeComplete,true);assert.deepEqual(input,before);
});

test('partial text stays outside completed fields and not_displayed never carries a fabricated value',()=>{
  const input=capture();input.fieldStatus.description='incomplete';
  const o=validateOwnerCapture(input,options()).observation;
  assert.equal(o.fields.description,undefined);assert.equal(o.incompleteFields.description,input.fields.description);
  assert.equal(o.declaredScopeComplete,false);
  input.fieldStatus.description='not_displayed';
  assert.throws(()=>validateOwnerCapture(input,options()),/must have no value/);
  delete input.fields.description;
  const absent=validateOwnerCapture(input,options()).observation;
  assert.equal(absent.fieldStatus.description,'not_displayed');assert.equal(absent.fields.description,undefined);
});

test('wrong Place sources, unread values, bad dates and missing or unverified references are rejected',()=>{
  for(const mutate of [
    c=>c.fieldSources.description='https://pcmap.place.naver.com/hospital/67890/information',
    c=>c.sourceUrl='https://example.org/hospital/12345/information',
    c=>c.checkedAt='2026-02-31T21:00:00Z',
    c=>c.checkedAt='2026-10-31',
    c=>c.bodyStatus='blocked',
    c=>delete c.identityReference,
    c=>c.identityReference.checkedAt=newTime,
    c=>delete c.fieldStatus.description,
  ]){const input=capture();mutate(input);assert.throws(()=>validateOwnerCapture(input,options()));}
  const opts=options();opts.referenceRecords.get(clinic.id).naverPlaceObservations[0].identityMatch=false;
  assert.throws(()=>validateOwnerCapture(capture(),opts),/previously matched/);
});

test('current explicit manual review and multiple actual channel URLs retain their separate evidence',()=>{
  const input=capture();input.identityReview={confirmed:true,reason:'이번 화면의 표시명과 주소를 직접 대조.',sourceUrl:newUrl,checkedAt:newTime};
  input.observedChannelLinks=[{kind:'naverBlog',url:'https://blog.naver.com/observed',label:'블로그',sourceUrl:newUrl,checkedAt:newTime}];
  const o=validateOwnerCapture(input,options()).observation;
  assert.deepEqual(o.identityReview,input.identityReview);assert.deepEqual(o.observedChannelLinks,input.observedChannelLinks);
  input.observedChannelLinks[0].url='javascript:alert(1)';
  assert.throws(()=>validateOwnerCapture(input,options()),/Invalid observed channel/);
  delete input.observedChannelLinks;input.identityReview.reason='';
  assert.throws(()=>validateOwnerCapture(input,options()),/review reason/);
});

test('national scope permits another region while retaining identity and source checks',()=>{
  const opts=options();opts.clinicsById.set(clinic.id,{...clinic,sidoCode:'380000',cityCode:'381100'});
  assert.throws(()=>validateOwnerCapture(capture(),opts),/permitted source snapshot/);
  opts.national=true;
  assert.equal(validateOwnerCapture(capture(),opts).observation.fields.description,'예약 문구\n\n마지막 문장.');
  const invalid=capture();invalid.identityReference.sourceUrl='https://map.naver.com/p/entry/place/99999';
  assert.throws(()=>validateOwnerCapture(invalid,opts),/same numeric Place ID/);
});
