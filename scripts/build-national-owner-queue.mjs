// Build a local work queue from existing candidate evidence. This performs no network requests.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadAssetInventory,assetUrl} from './clinic-assets.mjs';
import {nationalOwnerIdentity} from './national-owner-identity.mjs';
import {currentNaverPlaceObservations,naverPlaceSourceUrl} from './clinic-hours.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const placeIdOf=url=>new URL(url).pathname.match(/\/(?:place|hospital)\/([1-9]\d*)(?:\/|$)/)?.[1]??null;

/**
 * Pure: discovery assets become queue candidates only after their URLs pass the same validators the
 * inventory uses. The Place ID is derived from the validated URL; a declared placeId that disagrees
 * is kept for review and flagged, never trusted. Assets with an unusable URL are counted, not emitted.
 */
export function buildNationalOwnerCandidates(data,discovery,inventory){
  const clinics=new Map(data.clinics.map(c=>[c.id,c]));
  const existing=new Map(inventory.records.map(r=>[r.clinicId,r]));
  const candidates=[],skipped={invalidPlaceUrl:0,invalidDiscoveryUrl:0};
  for(const record of discovery.records??[]){
    const clinic=clinics.get(record.clinicId);
    if(!clinic)throw new Error(`Unknown institution ${record.clinicId}`);
    for(const asset of record.assets??[]){
      if(asset.kind!=='naverMap'||asset.ownership!=='candidate')continue;
      const sourceUrl=naverPlaceSourceUrl(asset.url);
      if(!sourceUrl){skipped.invalidPlaceUrl++;continue;}
      const discoveryUrl=assetUrl(asset.discoveryUrl);
      if(!discoveryUrl){skipped.invalidDiscoveryUrl++;continue;}
      const placeId=placeIdOf(sourceUrl);
      const declaredPlaceId=asset.placeId==null?null:String(asset.placeId);
      const placeIdMismatch=declaredPlaceId!==null&&declaredPlaceId!==placeId;
      const matched=currentNaverPlaceObservations(existing.get(clinic.id)).filter(o=>o.bodyStatus==='read'&&o.identityMatch===true);
      const verified=nationalOwnerIdentity(existing.get(clinic.id),placeId);
      candidates.push({clinicId:clinic.id,name:clinic.name,placeId,sidoCode:clinic.sidoCode,cityCode:clinic.cityCode,sido:clinic.sido,city:clinic.city,address:clinic.address,phone:clinic.phone,
        sourceUrl,identity:verified?{confirmed:true,naverRecord:verified.naverRecord}:{confirmed:false},
        ...(verified?{primarySource:verified.primarySource}:{}),status:verified?'already_identity_matched':matched.length?'different_verified_place_review':'candidate_unverified',
        ...(placeIdMismatch?{declaredPlaceId,placeIdMismatch:true}:{}),
        candidateEvidence:{sourceUrl:discoveryUrl,checkedAt:asset.checkedAt,identityEvidence:asset.identityEvidence??[]}});
    }
  }
  const placeCounts=new Map();for(const r of candidates)placeCounts.set(r.placeId,(placeCounts.get(r.placeId)??0)+1);
  for(const r of candidates)if(placeCounts.get(r.placeId)>1)r.status='duplicate_place_review';
  // A disagreement between the listed ID and the linked URL must be resolved by a person before any other status applies.
  for(const r of candidates)if(r.placeIdMismatch)r.status='place_id_mismatch_review';
  candidates.sort((a,b)=>a.sido.localeCompare(b.sido,'ko')||a.city.localeCompare(b.city,'ko')||a.name.localeCompare(b.name,'ko')||a.clinicId.localeCompare(b.clinicId));
  return {candidates,skipped};
}

function main(){
  const data=JSON.parse(fs.readFileSync(path.join(ROOT,'data/clinics.json')));
  const discoveryBytes=fs.readFileSync(path.join(ROOT,'data/assets/naver-national-discovery.json'));
  const discovery=JSON.parse(discoveryBytes);
  const inventory=loadAssetInventory(ROOT,data);
  const {candidates,skipped}=buildNationalOwnerCandidates(data,discovery,inventory);
  const output={schemaVersion:1,scope:'제3자 디렉토리에서 발견된 지도 후보. 실제 지도 본문 확인 및 기관 대조 전까지 후보이며, 미수집은 부재를 뜻하지 않음.',
    source:{file:'data/assets/naver-national-discovery.json',sha256:createHash('sha256').update(discoveryBytes).digest('hex')},skipped,records:candidates};
  const target=path.join(ROOT,'data/research/national-owner-candidates.json');fs.writeFileSync(target+'.tmp',JSON.stringify(output,null,2)+'\n');fs.renameSync(target+'.tmp',target);
  console.log(JSON.stringify({file:'data/research/national-owner-candidates.json',candidates:candidates.length,skipped,statuses:Object.fromEntries([...new Set(candidates.map(r=>r.status))].map(s=>[s,candidates.filter(r=>r.status===s).length]))}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
