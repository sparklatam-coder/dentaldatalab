import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadAssetInventory} from './clinic-assets.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const INPUT='data/research/yangju-booking-captures';
const OUTPUT='data/assets/naver-yangju-booking-01.json';
const METHODS=new Set(['browser_ui','browser_ui_accessibility','browser_ui_screenshot','browser_ui_accessibility_and_screenshot','browser_ui_saved_html']);
const hasText=value=>typeof value==='string'&&value.trim().length>0;
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
function stamp(value,label){
  if(!hasText(value)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(`${label}: explicit ISO timestamp required`);
  const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
  if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)fail(`${label}: invalid calendar date`);
}
export function bookingId(value){
  if(!hasText(value))return null;
  try{const url=new URL(value);if(!['https:','http:'].includes(url.protocol)||!['booking.naver.com','m.booking.naver.com'].includes(url.hostname)||url.username||url.password||url.port)return null;return url.pathname.match(/\/bizes\/([1-9]\d*)(?:\/|$)/)?.[1]??null;}catch{return null;}
}

export function validateBookingCapture(capture,{clinicsById,inventoryById,inputFile='',inputSha256=''}={}){
  if(!plain(capture)||capture.schemaVersion!==1)fail('schemaVersion 1 capture required');
  const clinic=clinicsById.get(capture.clinicId);
  if(!clinic||clinic.sidoCode!=='310000'||clinic.cityCode!=='312700'||capture.name!==clinic.name)fail('Yangju source institution identity required');
  const id=bookingId(capture.url),sourceId=bookingId(capture.sourceUrl);
  if(!id||sourceId!==id)fail('Existing booking URL and observed source must have the same bizes ID');
  stamp(capture.checkedAt,'checkedAt');
  if(!METHODS.has(capture.captureMethod)||!['read','blocked'].includes(capture.bodyStatus))fail('Public browser UI capture method and read/blocked status required');
  const reference=capture.ownershipReference;
  if(!plain(reference)||bookingId(reference.url)!==id||!['official','linked'].includes(reference.ownership))fail('Explicit previously verified booking ownershipReference required');
  stamp(reference.checkedAt,'ownershipReference.checkedAt');
  if(Date.parse(reference.checkedAt)>Date.parse(capture.checkedAt))fail('Ownership reference cannot follow the captured page');
  const assets=inventoryById.get(clinic.id)?.assets??[];
  const current=assets.find(asset=>asset.kind==='booking'&&bookingId(asset.url)===id);
  if(!current||!['official','linked'].includes(current.ownership))fail('Current inventory has no verified/linked booking asset for this bizes ID');
  const knownTimes=[current.checkedAt,current.ownershipEvidenceAt,current.ownershipReference?.checkedAt,...(current.provenance??[]).map(item=>item.checkedAt)].filter(Boolean).map(Date.parse);
  if(!knownTimes.includes(Date.parse(reference.checkedAt)))fail('Ownership reference timestamp is not present in the current asset evidence');
  const contentStatus=capture.publisherContentStatus??(capture.publisherContent?'read':'incomplete');
  if(!['read','not_displayed','incomplete'].includes(contentStatus))fail('Invalid publisherContentStatus');
  const contentKind=capture.contentKind??capture.publisherContent?.contentKind??'home';
  if(!['home','service_detail','service_notice'].includes(contentKind))fail('Invalid booking contentKind');
  const asset={kind:'booking',url:capture.url,bodyStatus:capture.bodyStatus,checkedAt:capture.checkedAt,
    ownershipReference:structuredClone(reference),publisherContentStatus:contentStatus,contentKind,
    bodyChecks:[{sourceUrl:capture.sourceUrl,checkedAt:capture.checkedAt,bodyStatus:capture.bodyStatus,captureMethod:capture.captureMethod,
      publisherContentStatus:contentStatus,contentKind,notes:capture.notes??'',inputFile,inputSha256}]};
  if(capture.bodyStatus!=='read'&&(capture.publisherContent||contentStatus!=='incomplete'))fail('Blocked capture cannot contain publisher text or claim no text is displayed');
  if(capture.publisherContent){
    const content=capture.publisherContent;
    if(!plain(content)||contentStatus!=='read'||!hasText(content.text)||bookingId(content.sourceUrl)!==id)fail('Complete publisher content must contain actual text and same-bizes source');
    stamp(content.checkedAt,'publisherContent.checkedAt');
    if(new URL(content.sourceUrl).href!==new URL(capture.sourceUrl).href||Date.parse(content.checkedAt)!==Date.parse(capture.checkedAt))fail('Publisher content must use the actual captured page URL and capture timestamp');
    if(content.title!==undefined&&!hasText(content.title))fail('Publisher title must be actual nonempty displayed text');
    if(content.contentKind!==undefined&&content.contentKind!==contentKind)fail('Publisher contentKind must match captured tab scope');
    asset.publisherContent=structuredClone(content);
  }else if(contentStatus==='read')fail('Read publisherContentStatus requires actual publisherContent text');
  if(capture.metadata!==undefined)asset.captureMetadata=structuredClone(capture.metadata);
  return {clinicId:clinic.id,name:clinic.name,asset};
}

export function importBookingCaptures({root=ROOT,dryRun=false}={}){
  const dir=path.join(root,INPUT);
  if(!fs.existsSync(dir))return {inputFiles:0,records:0,written:false,reason:'capture_directory_not_created'};
  const names=fs.readdirSync(dir).filter(name=>name.endsWith('.json')).sort();
  if(!names.length)return {inputFiles:0,records:0,written:false,reason:'no_captures'};
  const sourceBytes=fs.readFileSync(path.join(root,'data/clinics.json')),data=JSON.parse(sourceBytes);
  const clinicsById=new Map(data.clinics.map(clinic=>[clinic.id,clinic]));
  const inventoryById=new Map(loadAssetInventory(root,data).records.map(record=>[record.clinicId,record]));
  const records=new Map(),inputFiles=[];
  for(const name of names){
    const file=INPUT+'/'+name,bytes=fs.readFileSync(path.join(root,file)),sha256=createHash('sha256').update(bytes).digest('hex');
    let parsed;try{parsed=validateBookingCapture(JSON.parse(bytes),{clinicsById,inventoryById,inputFile:file,inputSha256:sha256});}catch(error){throw new Error(`${file}: ${error.message}`,{cause:error});}
    inputFiles.push({path:file,sha256,clinicId:parsed.clinicId,checkedAt:parsed.asset.checkedAt});
    if(!records.has(parsed.clinicId))records.set(parsed.clinicId,{clinicId:parsed.clinicId,name:parsed.name,checkedAt:parsed.asset.checkedAt,assets:[]});
    const record=records.get(parsed.clinicId);record.assets.push(parsed.asset);
    if(Date.parse(parsed.asset.checkedAt)>Date.parse(record.checkedAt))record.checkedAt=parsed.asset.checkedAt;
  }
  const output={schemaVersion:1,sourceType:'naver_booking_browser_capture',checkedAt:new Date().toISOString(),
    scope:'기존에 기관 페이지에서 연결을 확인한 네이버 예약의 공개 업체 안내 DOM만 별도 관찰. 계정·예약내역·예약 제출 제외. 현재 소유권 판정을 변경하지 않는 본문 보강 자료.',
    sourceSnapshot:{file:'data/clinics.json',sha256:createHash('sha256').update(sourceBytes).digest('hex')},inputFiles,
    records:[...records.values()].sort((a,b)=>a.clinicId.localeCompare(b.clinicId))};
  for(const record of output.records)record.assets.sort((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt));
  let written=false;
  if(!dryRun){
    const target=path.join(root,OUTPUT);let unchanged=false;
    if(fs.existsSync(target)){const {checkedAt,...previous}=JSON.parse(fs.readFileSync(target));const {checkedAt:nextTime,...next}=output;unchanged=JSON.stringify(previous)===JSON.stringify(next);}
    if(!unchanged){fs.mkdirSync(path.dirname(target),{recursive:true});const temp=target+'.tmp';fs.writeFileSync(temp,JSON.stringify(output,null,2)+'\n');fs.renameSync(temp,target);written=true;}
  }
  return {inputFiles:names.length,records:records.size,written,output:OUTPUT};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.some(arg=>arg!=='--dry-run'))throw new Error('Usage: node scripts/import-yangju-booking-captures.mjs [--dry-run]');
  console.log(JSON.stringify(importBookingCaptures({dryRun:args.includes('--dry-run')})));
}
