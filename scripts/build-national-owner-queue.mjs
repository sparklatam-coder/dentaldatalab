// Build a local work queue from existing candidate evidence. This performs no network requests.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadAssetInventory} from './clinic-assets.mjs';
import {nationalOwnerIdentity} from './national-owner-identity.mjs';
import {currentNaverPlaceObservations} from './clinic-hours.mjs';

const root=process.cwd();
const data=JSON.parse(fs.readFileSync('data/clinics.json'));
const discoveryBytes=fs.readFileSync('data/assets/naver-national-discovery.json');
const discovery=JSON.parse(discoveryBytes);
const inventory=loadAssetInventory(root,data);
const clinics=new Map(data.clinics.map(c=>[c.id,c]));
const existing=new Map(inventory.records.map(r=>[r.clinicId,r]));
const candidates=[];
for(const record of discovery.records){
  const clinic=clinics.get(record.clinicId);
  if(!clinic)throw new Error(`Unknown institution ${record.clinicId}`);
  for(const asset of record.assets??[]){
    if(asset.kind!=='naverMap'||asset.ownership!=='candidate'||!/^\d+$/.test(String(asset.placeId)))continue;
    const matched=currentNaverPlaceObservations(existing.get(clinic.id)).filter(o=>o.bodyStatus==='read'&&o.identityMatch===true);
    const verified=nationalOwnerIdentity(existing.get(clinic.id),asset.placeId);
    candidates.push({clinicId:clinic.id,name:clinic.name,placeId:String(asset.placeId),sido:clinic.sido,city:clinic.city,address:clinic.address,phone:clinic.phone,
      sourceUrl:asset.url,identity:verified?{confirmed:true,naverRecord:verified.naverRecord}:{confirmed:false},
      ...(verified?{primarySource:verified.primarySource}:{}),status:verified?'already_identity_matched':matched.length?'different_verified_place_review':'candidate_unverified',
      candidateEvidence:{sourceUrl:asset.discoveryUrl,checkedAt:asset.checkedAt,identityEvidence:asset.identityEvidence??[]}});
  }
}
const placeCounts=new Map();for(const r of candidates)placeCounts.set(r.placeId,(placeCounts.get(r.placeId)??0)+1);
for(const r of candidates)if(placeCounts.get(r.placeId)>1)r.status='duplicate_place_review';
candidates.sort((a,b)=>a.sido.localeCompare(b.sido,'ko')||a.city.localeCompare(b.city,'ko')||a.name.localeCompare(b.name,'ko')||a.clinicId.localeCompare(b.clinicId));
const output={schemaVersion:1,scope:'제3자 디렉토리에서 발견된 지도 후보. 실제 지도 본문 확인 및 기관 대조 전까지 후보이며, 미수집은 부재를 뜻하지 않음.',
  source:{file:'data/assets/naver-national-discovery.json',sha256:createHash('sha256').update(discoveryBytes).digest('hex')},records:candidates};
const target='data/research/national-owner-candidates.json';fs.writeFileSync(target+'.tmp',JSON.stringify(output,null,2)+'\n');fs.renameSync(target+'.tmp',target);
console.log(JSON.stringify({file:target,candidates:candidates.length,statuses:Object.fromEntries([...new Set(candidates.map(r=>r.status))].map(s=>[s,candidates.filter(r=>r.status===s).length]))}));
