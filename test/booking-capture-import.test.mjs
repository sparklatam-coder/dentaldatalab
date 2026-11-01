import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingId,validateBookingCapture} from '../scripts/import-yangju-booking-captures.mjs';

const url='https://m.booking.naver.com/booking/13/bizes/12345';
const linkedAt='2026-10-31T20:00:00Z',checkedAt='2026-10-31T21:00:00Z';
const clinic={id:'c-fixture',name:'예약치과의원',sidoCode:'310000',cityCode:'312700'};
const options=ownership=>({clinicsById:new Map([[clinic.id,clinic]]),inventoryById:new Map([[clinic.id,{assets:[{kind:'booking',url,ownership:ownership??'linked',checkedAt:linkedAt}]}]])});
const capture=()=>({schemaVersion:1,clinicId:clinic.id,name:clinic.name,url,sourceUrl:url+'/items/456',checkedAt,
  bodyStatus:'read',captureMethod:'browser_ui_saved_html',ownershipReference:{url,checkedAt:linkedAt,ownership:'linked'},
  publisherContentStatus:'read',publisherContent:{text:'업체의 실제 예약 안내\n마지막 문장',title:'예약 안내',sourceUrl:url+'/items/456',checkedAt}});

test('booking capture preserves the original text and only references existing verified ownership',()=>{
  const input=capture(),before=structuredClone(input),asset=validateBookingCapture(input,options()).asset;
  assert.deepEqual(asset.publisherContent,input.publisherContent);assert.deepEqual(asset.ownershipReference,input.ownershipReference);
  assert.equal(asset.ownership,undefined);assert.equal(asset.bodyChecks[0].sourceUrl,input.sourceUrl);
  assert.deepEqual(input,before);assert.equal(bookingId(url),bookingId(url.replace('m.booking','booking')));
  const reimportOptions=options();
  Object.assign(reimportOptions.inventoryById.get(clinic.id).assets[0],{checkedAt,ownershipEvidenceAt:linkedAt,ownershipReference:input.ownershipReference});
  assert.equal(validateBookingCapture(input,reimportOptions).asset.publisherContent.text,input.publisherContent.text);
});

test('another bizes ID, unverified ownership and non-public or bad source references are rejected',()=>{
  assert.throws(()=>validateBookingCapture(capture(),options('third_party')),/no verified\/linked/);
  assert.throws(()=>validateBookingCapture(capture(),options('candidate')),/no verified\/linked/);
  for(const mutate of [c=>c.sourceUrl=url.replace('12345','99999'),c=>c.publisherContent.sourceUrl='https://example.org/bizes/12345',
    c=>c.url='https://booking.naver.com.evil.test/bizes/12345',c=>c.checkedAt='2026-02-31T21:00:00Z',c=>delete c.ownershipReference,
    c=>c.publisherContent.sourceUrl=url+'/items/789',c=>c.publisherContent.checkedAt='2026-10-31T21:00:01Z']){
    const input=capture();mutate(input);assert.throws(()=>validateBookingCapture(input,options()));
  }
});

test('failed access preserves a separate status without fabricated publisher text',()=>{
  const input=capture();input.bodyStatus='blocked';
  assert.throws(()=>validateBookingCapture(input,options()),/Blocked capture/);
  delete input.publisherContent;input.publisherContentStatus='incomplete';
  const asset=validateBookingCapture(input,options()).asset;
  assert.equal(asset.bodyStatus,'blocked');assert.equal(asset.publisherContent,undefined);assert.equal(asset.bodyChecks.length,1);
  input.publisherContentStatus='not_displayed';
  assert.throws(()=>validateBookingCapture(input,options()),/Blocked capture/);
});
