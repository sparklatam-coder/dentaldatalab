import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadAssetInventory,assetUrl,KINDS} from './clinic-assets.mjs';
import {currentNaverPlaceObservations,naverPlaceSourceUrl} from './clinic-hours.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const INPUT='data/research/yangju-owner-captures';
const OUTPUT='data/assets/naver-yangju-owner-01.json';
export const OWNER_FIELDS=['description','representativeKeywords','reservationNotice','businessNotices','noticeBody','notices','directions','visitorPreparation'];
const FIELDS=new Set([...OWNER_FIELDS,'name','phone','address','website','hours','hoursAdditional','amenities','parking','paymentMethods','accessibility','hygieneInformation','additionalInformation','naverCategory','displayedChannelButtons','booking','naverBlog','blog','instagram','facebook','youtube','kakaoChannel']);
const METHODS=new Set(['browser_ui','browser_ui_accessibility','browser_ui_screenshot','browser_ui_accessibility_and_screenshot','browser_ui_saved_html']);
const STATUSES=new Set(['read','not_displayed','incomplete']);
const own=(object,key)=>Object.hasOwn(object,key);
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=message=>{throw new Error(message);};
const text=value=>typeof value==='string'&&value.trim().length>0;
const hasValue=value=>text(value)||Array.isArray(value)&&value.length>0&&value.every(text);
const pid=value=>naverPlaceSourceUrl(value)?new URL(value).pathname.match(/\/(?:place|hospital)\/([1-9]\d*)(?:\/|$)/)[1]:null;
function timestamp(value,label){
  if(!text(value)||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))fail(`${label}: explicit ISO timestamp with timezone required`);
  const [year,month,day,hour,minute,second]=value.slice(0,19).split(/[-T:]/).map(Number);
  if(month<1||month>12||day<1||day>new Date(Date.UTC(year,month,0)).getUTCDate()||hour>23||minute>59||second>59)fail(`${label}: invalid calendar date or time`);
  return value;
}
function source(value,label,placeId){
  const valid=naverPlaceSourceUrl(value);
  if(!valid||pid(value)!==placeId)fail(`${label}: actual Naver URL for the same numeric Place ID required`);
  return value;
}

export function validateOwnerCapture(capture,{clinicsById,referenceRecords,inputFile='',inputSha256='',national=false}={}){
  if(!plain(capture)||capture.schemaVersion!==1)fail('schemaVersion 1 object required');
  const clinic=clinicsById.get(capture.clinicId);
  if(!clinic||(!national&&(clinic.sidoCode!=='310000'||clinic.cityCode!=='312700')))fail('Capture must identify an institution in the permitted source snapshot');
  if(capture.name!==clinic.name)fail('Outer record name must match the source institution; displayed name belongs in fields.name');
  const placeId=pid(capture.sourceUrl);
  if(!placeId)fail('Actual Naver numeric Place sourceUrl required');
  timestamp(capture.checkedAt,'checkedAt');
  if(!METHODS.has(capture.captureMethod))fail('Unsupported captureMethod; browser UI evidence only');
  if(!['read','blocked','not_read'].includes(capture.bodyStatus))fail('Invalid bodyStatus');
  if(!plain(capture.fields??{})||!plain(capture.incompleteFields??{})||!plain(capture.fieldStatus??{}))fail('Fields and statuses must be objects');
  const values=capture.fields??{},partial=capture.incompleteFields??{},statuses=capture.fieldStatus??{};
  const scope=capture.captureScope??[];
  if(!Array.isArray(scope)||!scope.length||new Set(scope).size!==scope.length||scope.some(field=>!FIELDS.has(field)))fail('captureScope must explicitly list distinct known fields');
  const fields={},incompleteFields={},fieldSources={},fieldCheckedAt={},fieldCaptureMethod={};
  for(const key of new Set([...Object.keys(values),...Object.keys(partial),...Object.keys(statuses)])){
    if(!FIELDS.has(key)||!STATUSES.has(statuses[key]))fail(`${key}: explicit valid fieldStatus required`);
    const status=statuses[key];
    if(capture.bodyStatus!=='read'&&status!=='incomplete')fail(`${key}: unread page cannot supply read or not_displayed status`);
    fieldSources[key]=source(capture.fieldSources?.[key],`fieldSources.${key}`,placeId);
    fieldCheckedAt[key]=timestamp(capture.fieldCheckedAt?.[key]??capture.checkedAt,`fieldCheckedAt.${key}`);
    const method=capture.fieldCaptureMethod?.[key]??capture.captureMethod;
    if(!METHODS.has(method))fail(`${key}: invalid fieldCaptureMethod`);
    fieldCaptureMethod[key]=method;
    if(status==='not_displayed'){
      if(own(values,key)||own(partial,key))fail(`${key}: not_displayed must have no value; it is not proof of absence`);
    }else if(status==='read'){
      if(!hasValue(values[key])||own(partial,key))fail(`${key}: complete read requires a nonempty value only in fields`);
      if(key==='representativeKeywords'&&!Array.isArray(values[key]))fail('representativeKeywords must preserve the observed list');
      fields[key]=structuredClone(values[key]);
    }else{
      if(own(values,key)&&own(partial,key))fail(`${key}: partial value supplied twice`);
      const value=own(partial,key)?partial[key]:values[key];
      if(value!==undefined){
        if(capture.bodyStatus!=='read'||!hasValue(value))fail(`${key}: incomplete text requires an actually read partial value`);
        incompleteFields[key]=structuredClone(value);
      }
    }
  }
  const observation={sourceUrl:capture.sourceUrl,checkedAt:capture.checkedAt,bodyStatus:capture.bodyStatus,
    fields,fieldStatus:{...statuses},fieldSources,fieldCheckedAt,fieldCaptureMethod,
    captureMethod:capture.captureMethod,captureScope:[...scope],
    declaredScopeComplete:capture.bodyStatus==='read'&&scope.every(key=>['read','not_displayed'].includes(statuses[key])),
    provenance:[{type:'local_browser_capture_import',inputFile,inputSha256}]};
  if(Object.keys(incompleteFields).length)observation.incompleteFields=incompleteFields;
  if(capture.observedChannelLinks!==undefined){
    if(!Array.isArray(capture.observedChannelLinks))fail('observedChannelLinks must be an array');
    observation.observedChannelLinks=capture.observedChannelLinks.map(link=>{
      if(!plain(link)||!Object.hasOwn(KINDS,link.kind)||!assetUrl(link.url))fail('Invalid observed channel href');
      source(link.sourceUrl,'observedChannelLinks.sourceUrl',placeId);
      timestamp(link.checkedAt,'observedChannelLinks.checkedAt');
      return structuredClone(link);
    });
  }
  for(const key of ['captureNotes','notes','metadata'])if(capture[key]!==undefined)observation[key]=structuredClone(capture[key]);
  if(capture.identityReview!==undefined){
    const review=capture.identityReview;
    if(!plain(review)||review.confirmed!==true||!text(review.reason))fail('Explicit identityReview requires confirmed:true and the current observation review reason');
    if(review.sourceUrl!==undefined)source(review.sourceUrl,'identityReview.sourceUrl',placeId);
    if(review.checkedAt!==undefined)timestamp(review.checkedAt,'identityReview.checkedAt');
    observation.identityReview=structuredClone(review);
  }
  if(capture.identityReference){
    const reference=capture.identityReference;
    source(reference.sourceUrl,'identityReference.sourceUrl',placeId);
    timestamp(reference.checkedAt,'identityReference.checkedAt');
    if(Date.parse(reference.checkedAt)>=Date.parse(capture.checkedAt))fail('Identity reference must precede the new capture');
    const eligible=currentNaverPlaceObservations(referenceRecords.get(clinic.id)??{}).some(o=>o.bodyStatus==='read'&&o.identityMatch===true&&pid(o.sourceUrl)===placeId&&naverPlaceSourceUrl(o.sourceUrl)===naverPlaceSourceUrl(reference.sourceUrl)&&Date.parse(o.checkedAt)===Date.parse(reference.checkedAt));
    if(!eligible)fail('Identity reference does not identify a current, previously matched body observation');
    observation.identityReference={sourceUrl:reference.sourceUrl,checkedAt:reference.checkedAt};
  }
  // An importer must never create identity fields by copying an earlier page.
  if(capture.bodyStatus==='read'&&!(fields.name&&(fields.address||fields.phone))&&!observation.identityReference)fail('Owner-only capture needs an explicit previously verified identityReference');
  return {clinicId:clinic.id,name:clinic.name,observation};
}

export function importOwnerCaptures({root=ROOT,dryRun=false,national=false}={}){
  const input=national?'data/research/national-owner-captures':INPUT;
  const outputPath=national?'data/assets/naver-national-owner-01.json':OUTPUT;
  const dir=path.join(root,input);
  if(!fs.existsSync(dir))return {inputFiles:0,records:0,observations:0,written:false,reason:'capture_directory_not_created'};
  const names=fs.readdirSync(dir).filter(name=>name.endsWith('.json')).sort();
  if(!names.length)return {inputFiles:0,records:0,observations:0,written:false,reason:'no_captures'};
  const sourceBytes=fs.readFileSync(path.join(root,'data/clinics.json'));
  const data=JSON.parse(sourceBytes);
  const clinicsById=new Map(data.clinics.map(clinic=>[clinic.id,clinic]));
  const referenceRecords=new Map(loadAssetInventory(root,data).records.map(record=>[record.clinicId,record]));
  const records=new Map(),inputFiles=[],seen=new Set();
  for(const name of names){
    const relative=input+'/'+name,bytes=fs.readFileSync(path.join(root,relative));
    const sha256=createHash('sha256').update(bytes).digest('hex');
    let parsed;
    try{parsed=validateOwnerCapture(JSON.parse(bytes),{clinicsById,referenceRecords,inputFile:relative,inputSha256:sha256,national});}
    catch(error){throw new Error(`${relative}: ${error.message}`,{cause:error});}
    inputFiles.push({path:relative,sha256,clinicId:parsed.clinicId,checkedAt:parsed.observation.checkedAt});
    const {provenance,...content}=parsed.observation;
    const identity=JSON.stringify([parsed.clinicId,content]);
    if(seen.has(identity))continue;
    seen.add(identity);
    if(!records.has(parsed.clinicId))records.set(parsed.clinicId,{clinicId:parsed.clinicId,name:parsed.name,checkedAt:parsed.observation.checkedAt,researched:true,assets:[],searches:[],naverPlaceObservations:[]});
    const record=records.get(parsed.clinicId);
    record.naverPlaceObservations.push(parsed.observation);
    if(Date.parse(parsed.observation.checkedAt)>Date.parse(record.checkedAt))record.checkedAt=parsed.observation.checkedAt;
  }
  const output={schemaVersion:1,checkedAt:new Date().toISOString(),sourceType:'naver_business_owner_browser_capture',
    scope:(national?'전국':'양주시')+' 기관의 실제 브라우저 UI 관찰. 원문·항목별 출처·열람 상태 보존. 지정 수집범위 완료는 기관 전체 정보의 조사 완료나 사실 검증이 아님.',
    sourceSnapshot:{file:'data/clinics.json',sha256:createHash('sha256').update(sourceBytes).digest('hex')},
    inputFiles,records:[...records.values()].sort((a,b)=>a.clinicId.localeCompare(b.clinicId))};
  for(const record of output.records)record.naverPlaceObservations.sort((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt)||a.sourceUrl.localeCompare(b.sourceUrl));
  let written=false;
  if(!dryRun){
    const target=path.join(root,outputPath);let unchanged=false;
    if(fs.existsSync(target)){const previous=JSON.parse(fs.readFileSync(target));const {checkedAt:oldTime,...oldContent}=previous;const {checkedAt:newTime,...newContent}=output;unchanged=JSON.stringify(oldContent)===JSON.stringify(newContent);}
    if(!unchanged){fs.mkdirSync(path.dirname(target),{recursive:true});const temp=target+'.tmp';fs.writeFileSync(temp,JSON.stringify(output,null,2)+'\n');fs.renameSync(temp,target);written=true;}
  }
  return {inputFiles:names.length,records:records.size,observations:seen.size,written,output:outputPath};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.some(arg=>!['--dry-run','--national'].includes(arg)))throw new Error('Usage: node scripts/import-yangju-owner-captures.mjs [--dry-run] [--national]');
  console.log(JSON.stringify(importOwnerCaptures({dryRun:args.includes('--dry-run'),national:args.includes('--national')})));
}
