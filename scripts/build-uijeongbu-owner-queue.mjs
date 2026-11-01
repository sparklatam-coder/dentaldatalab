// Prepare the next regional work queue from local snapshot and locally discovered candidates only.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const snapshotBytes=fs.readFileSync('data/clinics.json');
const candidateBytes=fs.readFileSync('data/research/national-owner-candidates.json');
const data=JSON.parse(snapshotBytes),candidates=JSON.parse(candidateBytes);
const clinics=data.clinics.filter(c=>c.sido==='경기'&&c.city==='의정부시');
const byClinic=new Map();
for(const candidate of candidates.records.filter(r=>r.sido==='경기'&&r.city==='의정부시')){
  if(byClinic.has(candidate.clinicId))throw new Error(`복수 지도 후보 수동 검토 필요: ${candidate.clinicId}`);
  byClinic.set(candidate.clinicId,candidate);
}
const normalized=name=>name.replace(/\s/g,'');
const names=new Map();for(const clinic of data.clinics){const key=normalized(clinic.name);names.set(key,(names.get(key)??0)+1);}
const records=clinics.map(clinic=>{
  const candidate=byClinic.get(clinic.id);
  return {clinicId:clinic.id,name:clinic.name,placeId:candidate?.placeId??null,sido:clinic.sido,city:clinic.city,
    address:clinic.address,phone:clinic.phone,sourceUrl:candidate?.sourceUrl??null,identity:candidate?.identity??{confirmed:false},
    status:candidate?.status??'place_candidate_not_found',candidateEvidence:candidate?.candidateEvidence??null,
    identityCautions:{sameNameNationalCount:names.get(normalized(clinic.name)),
      note:'기관명만으로 확정하지 말고 네이버 본문의 주소·전화와 지점 및 실제 Place ID를 대조합니다.'}};
}).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.clinicId.localeCompare(b.clinicId));
const output={schemaVersion:1,scope:'의정부시 심평원 스냅샷 전체. 디렉토리 후보는 지도 본문 미확인 상태이며, 후보 미발굴은 실제 부재를 뜻하지 않습니다.',
  sources:[{file:'data/clinics.json',sha256:createHash('sha256').update(snapshotBytes).digest('hex')},
    {file:'data/research/national-owner-candidates.json',sha256:createHash('sha256').update(candidateBytes).digest('hex')}],records};
const target='data/research/uijeongbu-owner-queue.json';fs.writeFileSync(target+'.tmp',JSON.stringify(output,null,2)+'\n');fs.renameSync(target+'.tmp',target);
const counts={};for(const r of records)counts[r.status]=(counts[r.status]??0)+1;
console.log(JSON.stringify({file:target,total:records.length,statuses:counts,sameNameNational:records.filter(r=>r.identityCautions.sameNameNationalCount>1).length}));
