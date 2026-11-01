import test from 'node:test';
import assert from 'node:assert/strict';
import {nationalOwnerIdentity} from '../scripts/national-owner-identity.mjs';

test('only a current matched observation of the exact Place can establish a reference',()=>{
  const earlier={sourceUrl:'https://pcmap.place.naver.com/hospital/123/home',checkedAt:'2026-11-01T00:00:00Z',bodyStatus:'read',identityMatch:true,fields:{name:'관찰치과'}};
  const other={...earlier,sourceUrl:'https://pcmap.place.naver.com/hospital/456/home',checkedAt:'2026-11-02T00:00:00Z'};
  const record={assets:[],naverPlaceObservations:[earlier,other]};
  assert.equal(nationalOwnerIdentity(record,'123').naverRecord.sourceUrl,earlier.sourceUrl);
  assert.equal(nationalOwnerIdentity(record,'123').primarySource.checkedAt,earlier.checkedAt);
  assert.equal(nationalOwnerIdentity(record,'999'),null);
  record.assets.push({kind:'naverMap',ownership:'third_party',url:earlier.sourceUrl,checkedAt:'2026-11-03T00:00:00Z'});
  assert.equal(nationalOwnerIdentity(record,'123'),null);
});
