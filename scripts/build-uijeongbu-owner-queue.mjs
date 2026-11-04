// Prepare the next regional work queue from local snapshot and locally discovered candidates only.
// Scope is the HIRA source codes declared in report-data.mjs, never the '경기'/'의정부시' label strings.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {NORTHERN_GYEONGGI_CITIES} from './report-data.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const GYEONGGI_SIDO_CODE='310000';
export const UIJEONGBU=NORTHERN_GYEONGGI_CITIES.find(city=>city.id==='uijeongbu');
export const inUijeongbu=record=>record?.sidoCode===GYEONGGI_SIDO_CODE&&UIJEONGBU.cityCodes.includes(record.cityCode);

export function buildUijeongbuOwnerQueue(data,candidates){
  const clinics=data.clinics.filter(inUijeongbu);
  const scoped=new Set(clinics.map(clinic=>clinic.id));
  const byClinic=new Map();
  // Candidates are selected through the code-scoped institution set, so a candidate's own labels cannot pull it in or out.
  for(const candidate of (candidates.records??[]).filter(record=>scoped.has(record.clinicId))){
    if(byClinic.has(candidate.clinicId))throw new Error(`복수 지도 후보 수동 검토 필요: ${candidate.clinicId}`);
    byClinic.set(candidate.clinicId,candidate);
  }
  const normalized=name=>String(name??'').replace(/\s/g,'');
  const names=new Map();for(const clinic of data.clinics){const key=normalized(clinic.name);names.set(key,(names.get(key)??0)+1);}
  const records=clinics.map(clinic=>{
    const candidate=byClinic.get(clinic.id);
    return {clinicId:clinic.id,name:clinic.name,placeId:candidate?.placeId??null,sidoCode:clinic.sidoCode,cityCode:clinic.cityCode,sido:clinic.sido,city:clinic.city,
      address:clinic.address,phone:clinic.phone,sourceUrl:candidate?.sourceUrl??null,identity:candidate?.identity??{confirmed:false},
      status:candidate?.status??'place_candidate_not_found',candidateEvidence:candidate?.candidateEvidence??null,
      identityCautions:{sameNameNationalCount:names.get(normalized(clinic.name)),
        note:'기관명만으로 확정하지 말고 네이버 본문의 주소·전화와 지점 및 실제 Place ID를 대조합니다.'}};
  }).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.clinicId.localeCompare(b.clinicId));
  return records;
}

function main(){
  const snapshotBytes=fs.readFileSync(path.join(ROOT,'data/clinics.json'));
  const candidateBytes=fs.readFileSync(path.join(ROOT,'data/research/national-owner-candidates.json'));
  const data=JSON.parse(snapshotBytes),candidates=JSON.parse(candidateBytes);
  const records=buildUijeongbuOwnerQueue(data,candidates);
  const output={schemaVersion:1,scope:`의정부시 심평원 스냅샷 전체(시도코드 ${GYEONGGI_SIDO_CODE}, 시군구코드 ${UIJEONGBU.cityCodes.join('·')}). 디렉토리 후보는 지도 본문 미확인 상태이며, 후보 미발굴은 실제 부재를 뜻하지 않습니다.`,
    sources:[{file:'data/clinics.json',sha256:createHash('sha256').update(snapshotBytes).digest('hex')},
      {file:'data/research/national-owner-candidates.json',sha256:createHash('sha256').update(candidateBytes).digest('hex')}],records};
  const target=path.join(ROOT,'data/research/uijeongbu-owner-queue.json');fs.writeFileSync(target+'.tmp',JSON.stringify(output,null,2)+'\n');fs.renameSync(target+'.tmp',target);
  const counts={};for(const r of records)counts[r.status]=(counts[r.status]??0)+1;
  console.log(JSON.stringify({file:'data/research/uijeongbu-owner-queue.json',total:records.length,statuses:counts,sameNameNational:records.filter(r=>r.identityCautions.sameNameNationalCount>1).length}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main();
