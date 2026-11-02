#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {safeWebsite, singlePhone} from '../src/shared.mjs';
import {hasValidHours} from './report-data.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DAYS=['mon','tue','wed','thu','fri','sat','sun'];
const TYPES={'41':'치과병원','51':'치과의원'};
const present=v=>typeof v==='string'&&v.trim().length>0;
const key=v=>present(v)?v.normalize('NFC').trim().replace(/\s+/gu,'').toLowerCase():null;
const sha=value=>createHash('sha256').update(value).digest('hex');
const count=v=>Number.isSafeInteger(v)&&v>=0;
const pct=(n,d)=>d?Math.round(n/d*1000)/10:null;
const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const DATA_QUALITY_VERSION=1;
export const QUALITY_RULES=Object.freeze({
  id_missing_or_malformed:{label:'내부 ID 형식 검토',level:'error',definition:'c-와 12자리 소문자 16진수로 된 내부 ID 형식이 아님.'},
  duplicate_id:{label:'내부 ID 중복',level:'error',definition:'같은 내부 ID가 두 행 이상에 사용됨. 행을 자동 삭제하거나 병합하지 않음.'},
  type_mismatch:{label:'종별 코드·명칭 불일치',level:'error',definition:'수록 범위인 41 치과병원 또는 51 치과의원 코드·명칭과 다름.'},
  name_missing:{label:'기관명 미수록',level:'missing',definition:'기관명 원문이 비어 있음.'},
  address_missing:{label:'주소 미수록',level:'missing',definition:'주소 원문이 비어 있음. 실제 주소 부재를 뜻하지 않음.'},
  address_review:{label:'주소 문자 검토',level:'review',definition:'주소에 한글이 없거나 제어 문자가 있음. 우편·도로명 주소의 실재 여부를 검증하는 규칙이 아님.'},
  phone_missing:{label:'전화 미수록',level:'missing',definition:'신고 전화 원문이 비어 있음. 연락처가 없다는 뜻이 아님.'},
  phone_format_review:{label:'전화 단일 번호 형식 검토',level:'review',definition:'기존 전화 링크 형식 검사에서 단일 번호로 해석되지 않음. 지역번호 생략·복수 번호·메모 등을 포함하며 번호 오류나 연결 불가로 단정하지 않음.'},
  postal_missing:{label:'우편번호 미수록',level:'missing',definition:'우편번호 원문이 비어 있음.'},
  postal_format_review:{label:'우편번호 형식 검토',level:'review',definition:'5자리 숫자 형식이 아님. 주소와 우편번호의 실제 대응은 확인하지 않음.'},
  coordinate_missing:{label:'좌표 미수록·일부 수록',level:'missing',definition:'위도 또는 경도 값이 null/undefined임. 0은 누락으로 보지 않음.'},
  coordinate_range_review:{label:'좌표 숫자·범위 검토',level:'review',definition:'두 값이 유한 숫자가 아니거나 위도 ±90·경도 ±180 범위를 벗어남. 실제 주소의 지오코딩 대조가 아님.'},
  region_code_review:{label:'지역 코드 형식 검토',level:'review',definition:'시도·시군구 코드 중 하나가 6자리 숫자 문자열이 아님. 현행 행정구역 재분류를 하지 않음.'},
  website_missing:{label:'신고 홈페이지 미수록',level:'missing',definition:'신고 홈페이지 원문이 비어 있음. 실제 홈페이지 부재를 뜻하지 않음.'},
  website_format_review:{label:'신고 홈페이지 URL 형식 검토',level:'review',definition:'기존 사이트의 HTTP(S) 주소 구문 검사를 통과하지 않음. 접속·소유·공식성 검사가 아님.'},
  hours_missing:{label:'유효 등록시간 미수록',level:'missing',definition:'월~일 중 유효한 같은 날 시작·종료 쌍이 하루도 없음. 휴진이나 미운영으로 추정하지 않음.'},
  hours_value_review:{label:'등록시간 값 검토',level:'review',definition:'하나 이상의 요일에 비어 있지 않은 시각 값이 있으나 유효한 같은 날 시작·종료 쌍이 아님.'},
  source_reference_review:{label:'출처 연결 검토',level:'error',definition:'hira-base가 없거나, 중복·알 수 없는 sourceIds 또는 필요한 상세 출처 연결이 없음.'},
  doctor_count_review:{label:'의료진 인원 값 검토',level:'review',definition:'등록 총의사수·전문의 수가 알려진 0 이상의 정수가 아님. null과 명시된 0을 구분함.'},
  same_name_address:{label:'동일 기관명·주소',level:'candidate',definition:'공백과 대소문자만 정리한 기관명과 전체 주소가 같은 서로 다른 ID. 숫자·하이픈·층·호수·괄호는 삭제하지 않음. 중복 확정이 아님.'},
  same_name_phone:{label:'동일 기관명·단일 전화',level:'candidate',definition:'공백과 대소문자만 정리한 기관명과 형식 검사를 통과한 전화 숫자가 같은 서로 다른 ID. 공동 연락처일 수 있어 중복 확정이 아님.'},
});

export function qualityHttpUrl(value){
  if(!present(value))return null;
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}

function grouped(clinics,getKey,kind,{distinctIds=true}={}){
  const map=new Map();
  clinics.forEach((c,index)=>{const value=getKey(c);if(value){if(!map.has(value))map.set(value,[]);map.get(value).push({row:index+1,id:c.id??null,name:c.name??null,address:c.address??null,phone:c.phone??null});}});
  return [...map.values()].filter(rows=>rows.length>1&&(!distinctIds||new Set(rows.map(r=>r.id)).size>1))
    .map(rows=>({kind,records:rows.sort((a,b)=>String(a.id).localeCompare(String(b.id))||a.row-b.row)}))
    .sort((a,b)=>String(a.records[0].id).localeCompare(String(b.records[0].id))||a.records[0].row-b.records[0].row);
}
function codeLabels(clinics,codeField,labelField){
  const map=new Map();
  for(const c of clinics){if(!present(c[codeField])||!present(c[labelField]))continue;if(!map.has(c[codeField]))map.set(c[codeField],new Map());const labels=map.get(c[codeField]);labels.set(c[labelField],(labels.get(c[labelField])??0)+1);}
  return [...map].filter(([,labels])=>labels.size>1).sort(([a],[b])=>a.localeCompare(b)).map(([code,labels])=>({code,labels:[...labels].sort(([a],[b])=>a.localeCompare(b,'ko')).map(([name,rows])=>({name,rows}))}));
}

/** Pure snapshot audit. Never changes rows, deduplicates records, or infers operation/relocation. */
export function collectDataQuality(data,{manifest={},checkedAt,sourceDataSha256=null,priorImportAudit=null,officialVerification=null,officialEvidence=null,inputFiles=[]}={}){
  if(!Array.isArray(data?.clinics)||data.clinics.some(c=>!c||typeof c!=='object'||Array.isArray(c)))throw new TypeError('clinics must be an array of records');
  if(typeof checkedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(checkedAt)||!Number.isFinite(Date.parse(checkedAt)))throw new TypeError('checkedAt must be an explicit valid timestamp');
  const clinics=data.clinics,total=clinics.length,sourceList=Array.isArray(manifest.sources)?manifest.sources:[];
  const knownSources=new Set(sourceList.map(s=>s.id));
  const sourceCatalogIssues=sourceList.flatMap((s,i)=>[
    ...(!present(s.id)||sourceList.findIndex(other=>other.id===s.id)!==i?[{index:i,issue:'missing_or_duplicate_source_id'}]:[]),
    ...(!qualityHttpUrl(s.url)?[{index:i,issue:'source_url_format'}]:[]),
    ...(qualityHttpUrl(s.url)&&!['data.go.kr','www.data.go.kr','hira.or.kr','www.hira.or.kr'].includes(new URL(s.url).hostname)?[{index:i,issue:'source_host_outside_declared_official_providers'}]:[]),
    ...(s.snapshotDate!==data.snapshotDate?[{index:i,issue:'source_snapshot_date_mismatch'}]:[]),
  ]);
  if(!sourceList.length)sourceCatalogIssues.push({issue:'source_catalog_missing'});
  const findings=[];
  const add=(row,rule)=>findings.push({row,rule});
  const validPhone=c=>present(c.phone)?singlePhone(c.phone):null;
  clinics.forEach((c,i)=>{
    const row=i+1;
    if(!/^c-[a-f0-9]{12}$/.test(c.id??''))add(row,'id_missing_or_malformed');
    if(!Object.hasOwn(TYPES,c.typeCode)||TYPES[c.typeCode]!==c.type)add(row,'type_mismatch');
    if(!present(c.name))add(row,'name_missing');
    if(!present(c.address))add(row,'address_missing');else if(!/[가-힣]/u.test(c.address)||/[\x00-\x1f\x7f]/u.test(c.address))add(row,'address_review');
    if(!present(c.phone))add(row,'phone_missing');else if(!validPhone(c))add(row,'phone_format_review');
    if(!present(c.postalCode))add(row,'postal_missing');else if(!/^\d{5}$/.test(c.postalCode))add(row,'postal_format_review');
    if(c.lat==null||c.lon==null)add(row,'coordinate_missing');else if(!Number.isFinite(c.lat)||!Number.isFinite(c.lon)||Math.abs(c.lat)>90||Math.abs(c.lon)>180)add(row,'coordinate_range_review');
    if(!/^\d{6}$/.test(c.sidoCode??'')||!/^\d{6}$/.test(c.cityCode??''))add(row,'region_code_review');
    if(!present(c.website))add(row,'website_missing');else if(!safeWebsite(c.website))add(row,'website_format_review');
    if(!DAYS.some(day=>hasValidHours(c.hours?.[day])))add(row,'hours_missing');
    if(DAYS.some(day=>{const h=c.hours?.[day];return ((h?.open!=null&&h.open!=='')||(h?.close!=null&&h.close!==''))&&!hasValidHours(h);}))add(row,'hours_value_review');
    const refs=c.sourceIds;
    if(!Array.isArray(refs)||!refs.includes('hira-base')||new Set(refs).size!==refs.length||refs.some(id=>!knownSources.has(id))||
      (c.specialties?.length&&!refs.includes('hira-specialties'))||(c.equipment?.length&&!refs.includes('hira-equipment'))||
      (DAYS.some(day=>hasValidHours(c.hours?.[day]))&&!refs.includes('hira-detail')))add(row,'source_reference_review');
    if(!count(c.doctors?.total)||!count(c.doctors?.specialist))add(row,'doctor_count_review');
  });
  const duplicateIds=grouped(clinics,c=>present(c.id)?c.id:null,'duplicate_id',{distinctIds:false});
  for(const group of duplicateIds)for(const r of group.records)add(r.row,'duplicate_id');
  const candidateRuleGroups=[...grouped(clinics,c=>key(c.name)&&key(c.address)?JSON.stringify([key(c.name),key(c.address)]):null,'same_name_address'),
    ...grouped(clinics,c=>key(c.name)&&validPhone(c)?JSON.stringify([key(c.name),validPhone(c)]):null,'same_name_phone')];
  const uniqueCandidates=new Map();
  for(const group of candidateRuleGroups){
    for(const r of group.records)add(r.row,group.kind);
    const signature=JSON.stringify(group.records.map(r=>r.id));
    if(!uniqueCandidates.has(signature))uniqueCandidates.set(signature,{kinds:[],records:group.records});
    uniqueCandidates.get(signature).kinds.push(group.kind);
  }
  const candidateGroups=[...uniqueCandidates.values()];
  const sharedPhoneGroups=grouped(clinics,c=>validPhone(c),'shared_phone');
  const sharedAddressGroups=grouped(clinics,c=>key(c.address),'shared_full_address');
  const rules=Object.fromEntries(Object.entries(QUALITY_RULES).map(([rule,definition])=>{const rows=new Set(findings.filter(f=>f.rule===rule).map(f=>f.row));return [rule,{...definition,rows:rows.size,total,percentOfTotal:pct(rows.size,total)}];}));
  const metric=(label,recorded,formatPass,definition)=>({label,total,recorded,missing:total-recorded,formatPass,formatReview:recorded-formatPass,recordedPercent:pct(recorded,total),definition});
  const metrics={
    name:metric('기관명',total-rules.name_missing.rows,total-rules.name_missing.rows,'비어 있지 않은 원문 수'),
    address:metric('주소',total-rules.address_missing.rows,total-rules.address_missing.rows-rules.address_review.rows,'한글·제어 문자 점검. 실제 주소 유효성이나 이전 여부는 확인하지 않음'),
    phone:metric('전화번호',total-rules.phone_missing.rows,total-rules.phone_missing.rows-rules.phone_format_review.rows,'단일 전화 링크 형식. 전화 연결·번호 할당 여부 미확인'),
    postalCode:metric('우편번호',total-rules.postal_missing.rows,total-rules.postal_missing.rows-rules.postal_format_review.rows,'5자리 숫자 형식. 주소와의 일치 여부 미확인'),
    coordinates:metric('위도·경도',total-rules.coordinate_missing.rows,total-rules.coordinate_missing.rows-rules.coordinate_range_review.rows,'두 좌표의 유한 숫자·지구 좌표 범위 점검. 주소 위치 대조 아님'),
    website:metric('신고 홈페이지',total-rules.website_missing.rows,total-rules.website_missing.rows-rules.website_format_review.rows,'HTTP(S) URL 구문. 접속·공식성 미확인'),
    hours:metric('하루 이상 유효 등록시간',total-rules.hours_missing.rows,total-rules.hours_missing.rows,'유효한 같은 날 시작·종료 쌍이 하루 이상 있는 기관. 미수록은 휴진 아님'),
  };
  const manifestChecks=[['totalClinics',manifest.stats?.totalClinics,total],['snapshotDate',manifest.snapshotDate,data.snapshotDate],['name',manifest.stats?.fieldCounts?.name,metrics.name.recorded],['address',manifest.stats?.fieldCounts?.address,metrics.address.recorded],['phone',manifest.stats?.fieldCounts?.phone,metrics.phone.recorded],['websiteRawNonempty',manifest.stats?.fieldCounts?.websiteRawNonempty,metrics.website.recorded],['website',manifest.stats?.fieldCounts?.website,metrics.website.formatPass],['hoursAvailable',manifest.stats?.fieldCounts?.hoursAvailable,metrics.hours.recorded],['coordinates',manifest.stats?.fieldCounts?.coordinates,metrics.coordinates.recorded]]
    .map(([field,expected,actual])=>({field,expected:expected??null,actual,status:expected==null?'not_recorded':expected===actual?'match':'mismatch'}));
  for(const [code,label] of Object.entries(TYPES)){const expected=manifest.stats?.byType?.[code+' '+label];const actual=clinics.filter(c=>c.typeCode===code).length;manifestChecks.push({field:'type.'+code,expected:expected??null,actual,status:expected==null?'not_recorded':expected===actual?'match':'mismatch'});}
  const importCheck=priorImportAudit?.checks?.find(c=>c.name==='Reimported clinics byte equality'&&c.status==='passed');
  const historical=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)<=Date.parse(checkedAt);
  const currentBytesMatchPriorImport=Boolean(sourceDataSha256&&historical(priorImportAudit?.checkedAt)&&importCheck?.actualSha256===sourceDataSha256&&importCheck.expectedSha256===sourceDataSha256);
  const official=officialVerification?.sourceVerification??officialVerification;
  const priorOfficialSnapshotMatched=Boolean(historical(official?.completedAt??official?.checkedAt)&&official?.status==='official_snapshot_matched'&&official.expectedSnapshotDate===data.snapshotDate&&official.download?.archiveMatchesManifest===true&&official.download.sha256===manifest.archive?.sha256&&official.comparison?.mismatchCount===0&&official.comparison.localRows===total&&official.comparison.dentalRows===total);
  const byRow=new Map();for(const finding of findings){if(!byRow.has(finding.row))byRow.set(finding.row,new Set());byRow.get(finding.row).add(finding.rule);}
  const queue=clinics.map((c,i)=>({row:i+1,id:c.id??null,name:c.name??null,address:c.address??null,phone:c.phone??null,rules:[...(byRow.get(i+1)??[])]})).filter(r=>r.rules.length);
  const candidateRows=new Set(candidateGroups.flatMap(g=>g.records.map(r=>r.row)));
  const byLevel=Object.fromEntries(['error','review','missing','candidate'].map(level=>[level,new Set(findings.filter(f=>QUALITY_RULES[f.rule].level===level).map(f=>f.row)).size]));
  return {schemaVersion:DATA_QUALITY_VERSION,checkedAt,scope:{total,snapshotDate:data.snapshotDate,observedAt:data.observedAt,types:TYPES,sourceFile:'data/clinics.json',sourceDataSha256,originalModified:false,externalAssetCollectionsIncluded:false},
    limitations:['점검 대상은 공공데이터의 치과병원·치과의원 스냅샷입니다. 종합병원 등의 치과는 이 모집단에 포함하지 않습니다.','누락·형식·중복 의심을 점검하며 현재 영업·폐업·이전·전화 연결·주소 실재 여부를 전수 확인하지 않습니다.','중복 후보는 자동 병합하지 않습니다. 동일 주소나 전화만으로 같은 기관이라고 판단하지 않습니다.','항목별 분모는 전체 수록 행입니다. 한 행에 여러 항목이 겹치므로 건수를 더해 기관 수로 해석하면 안 됩니다.','등록된 0은 값이며 null은 미확인입니다. 시간과 장비 자료의 부재를 미운영 또는 0대로 바꾸지 않습니다.'],
    summary:{total,byLevel,duplicateIdGroups:duplicateIds.length,candidateGroups:candidateGroups.length,candidateRuleGroups:candidateRuleGroups.length,candidateInstitutions:candidateRows.size,sharedPhoneGroups:sharedPhoneGroups.length,sharedAddressGroups:sharedAddressGroups.length,manifestMismatches:manifestChecks.filter(c=>c.status==='mismatch').length,sourceCatalogIssues:sourceCatalogIssues.length,currentOperatingStatusVerified:0},metrics,rules,
    duplicates:{candidateGroups,sharedPhoneGroups,sharedAddressGroups,duplicateIds,limitation:'공유 전화·주소는 참고 묶음이며 중복 후보 수에 직접 합산하지 않습니다. 동일 이름만으로는 후보를 생성하지 않습니다.'},
    regions:{mixedSidoLabels:codeLabels(clinics,'sidoCode','sido'),mixedCityLabels:codeLabels(clinics,'cityCode','city'),limitation:'원자료 코드에 여러 명칭이 연결된 상태만 기록합니다. 현행 행정구역 판정이나 재분류가 아닙니다.'},
    provenance:{inputFiles,manifestChecks,sourceCatalogIssues,snapshotDateValid:validDate(data.snapshotDate),currentBytesMatchPriorImport,priorImportCheckedAt:priorImportAudit?.checkedAt??null,priorOfficialSnapshotMatched,priorOfficialCheckedAt:official?.completedAt??official?.checkedAt??null,archiveSha256:manifest.archive?.sha256??null,linkedHistoricalSourceCheck:currentBytesMatchPriorImport&&priorOfficialSnapshotMatched,officialEvidence,meaning:'현재 가공 파일의 SHA-256을 이전 독립 재가공 기록에 연결하고, 그 원본 ZIP의 과거 공식 다운로드 대조 기록을 구분해 표시합니다. 이번 로컬 점검이 새 원본 다운로드나 기관별 현재 사실 검증을 뜻하지 않습니다.'},reviewQueue:queue};
}

export function loadDataQuality(root=ROOT,{checkedAt=new Date().toISOString()}={}){
  const files=['data/clinics.json','data/source-manifest.json','docs/input-audit.json','docs/source-verification-recheck.json','data/content/data-quality-source-evidence.json'];
  const inputs=new Map(files.map(file=>{const location=path.join(root,file);return [file,fs.existsSync(location)?fs.readFileSync(location):null];}));
  for(const file of files.slice(0,2))if(!inputs.get(file))throw new Error('Required quality input missing: '+file);
  const read=file=>inputs.get(file)?JSON.parse(inputs.get(file)):null;
  return collectDataQuality(read(files[0]),{manifest:read(files[1]),checkedAt,sourceDataSha256:sha(inputs.get(files[0])),priorImportAudit:read(files[2]),officialVerification:read(files[3]),officialEvidence:read(files[4]),inputFiles:files.map(file=>({file,sha256:inputs.get(file)?sha(inputs.get(file)):null,bytes:inputs.get(file)?.length??null,status:inputs.get(file)?'read':'not_available'}))});
}
export function dataQualitySummary(report){const {reviewQueue,duplicates,...summary}=report;return {...summary,duplicates:{candidateGroups:duplicates.candidateGroups,limitation:duplicates.limitation}};}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const args=process.argv.slice(2);if(args.some(a=>a!=='--check'))throw new Error('Usage: node scripts/data-quality.mjs [--check]');
  const target=path.join(ROOT,'data/content/data-quality-report.json');
  if(args.includes('--check')){const stored=JSON.parse(fs.readFileSync(target));const fresh=loadDataQuality(ROOT,{checkedAt:stored.checkedAt});if(JSON.stringify(stored)!==JSON.stringify(fresh))throw new Error('Data quality report is stale; regenerate it.');console.log(JSON.stringify({status:'current',...fresh.summary}));}
  else{const report=loadDataQuality();fs.writeFileSync(target,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));}
}
