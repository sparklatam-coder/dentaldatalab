import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {loadAssetInventory,CRAWL_RESULT_FILES} from './clinic-assets.mjs';

// Seeds for the deterministic verification of homepages the automated web research found.
// Those assets are model-reported candidates: the collector re-reads every page itself and
// compares name, phone and address against the public record before any link is promoted.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
export const RESULT_FILES=Object.keys(CRAWL_RESULT_FILES).map(file=>'data/assets/'+file);
const PLATFORM_DOMAINS=['naver.com','naver.me','modoo.at','instagram.com','facebook.com','youtube.com','kakao.com','daum.net'];
export const canonical=value=>{try{const u=new URL(value);return u.hostname.replace(/^www\./,'').toLowerCase()+(u.pathname.replace(/\/$/,'')||'/')+u.search;}catch{return null;}};
export const hostKey=value=>{try{return new URL(value).hostname.replace(/^www\./,'').toLowerCase();}catch{return null;}};
export const isPlatform=value=>{const host=hostKey(value);return !!host&&PLATFORM_DOMAINS.some(d=>host===d||host.endsWith('.'+d));};
// Only research-found websites qualify; pages already read by a crawler or taken from a Naver screen have their own paths.
export const researchCandidate=a=>a.kind==='website'&&a.ownership==='candidate'&&(a.provenance??[]).some(p=>p?.type==='automated_web_research');
export function buildSeeds(records,attempted){
  const byHost=new Map();
  for(const r of records)for(const a of r.assets){if(!researchCandidate(a))continue;const host=hostKey(a.url);if(!host)continue;if(!byHost.has(host))byHost.set(host,new Set());byHost.get(host).add(r.clinicId);}
  const seeds=new Map();
  for(const r of records)for(const a of r.assets){
    if(!researchCandidate(a)||isPlatform(a.url))continue;
    const key=canonical(a.url);if(!key||attempted.has(key))continue;
    if(!seeds.has(key))seeds.set(key,{url:a.url,clinics:[],evidenceUrls:[],hostClinicCount:byHost.get(hostKey(a.url)).size});
    const seed=seeds.get(key);
    if(!seed.clinics.some(c=>c.id===r.clinicId))seed.clinics.push({id:r.clinicId,name:r.name,address:r.address,phone:r.phone});
    seed.evidenceUrls=[...new Set([...seed.evidenceUrls,...a.evidenceUrls])];
  }
  return [...seeds.values()];
}
export function attemptedUrls(files){
  const attempted=new Set();
  for(const file of files){
    if(!fs.existsSync(path.join(root,file)))continue;
    for(const r of read(file).results??[])for(const url of [r?.url,r?.finalUrl])if(canonical(url))attempted.add(canonical(url));
  }
  return attempted;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const data=read('data/clinics.json'),inventory=loadAssetInventory(root,data);
  const output={schemaVersion:1,createdAt:new Date().toISOString(),scope:'자동 웹 조사가 찾은 홈페이지 후보 중 아직 어떤 수집기도 읽지 않은 주소. 플랫폼 호스트와 이전 요청·접근 실패 주소 제외. 본문 대조 전까지 귀속 후보.',seeds:buildSeeds(inventory.records,attemptedUrls(RESULT_FILES))};
  const file=path.join(root,'data/research/candidate-homepage-seeds.json');
  const withoutClock=({createdAt,...rest})=>JSON.stringify(rest);
  let unchanged=false;
  if(fs.existsSync(file)){try{unchanged=withoutClock(JSON.parse(fs.readFileSync(file,'utf8')))===withoutClock(output);}catch{unchanged=false;}}
  const dryRun=process.argv.includes('--dry-run');
  let written=false;
  if(!dryRun&&!unchanged&&(output.seeds.length||!fs.existsSync(file))){
    if(fs.existsSync(file)){
      const previous=fs.readFileSync(file);
      const archive=path.join(root,'data/research/homepage-seed-history',createHash('sha256').update(previous).digest('hex')+'.json');
      fs.mkdirSync(path.dirname(archive),{recursive:true});if(!fs.existsSync(archive))fs.writeFileSync(archive,previous);
    }
    fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');written=true;
  }
  console.log(JSON.stringify({newUrls:output.seeds.length,clinics:output.seeds.reduce((n,s)=>n+s.clinics.length,0),dryRun,unchanged,written,seedFile:'data/research/candidate-homepage-seeds.json'}));
}
