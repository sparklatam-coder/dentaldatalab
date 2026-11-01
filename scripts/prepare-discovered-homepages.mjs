import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadAssetInventory} from './clinic-assets.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const canonical=value=>{try{const u=new URL(value);return u.hostname.replace(/^www\./,'').toLowerCase()+(u.pathname.replace(/\/$/,'')||'/')+u.search;}catch{return null;}};
const data=read('data/clinics.json'),inventory=loadAssetInventory(root,data),attempted=new Set();
for(const file of ['data/assets/national-homepages.json','data/assets/discovered-homepages.json']){
  if(!fs.existsSync(path.join(root,file)))continue;
  for(const r of read(file).results??[])for(const url of [r.url,r.finalUrl])if(canonical(url))attempted.add(canonical(url));
}
for(const r of inventory.records)for(const a of r.assets)if(a.kind==='website'&&['read','blocked'].includes(a.bodyStatus))attempted.add(canonical(a.url));
const seeds=new Map();
for(const r of inventory.records)for(const a of r.assets){
  if(a.kind!=='website'||a.ownership!=='linked'||a.bodyStatus!=='not_read'||attempted.has(canonical(a.url)))continue;
  const key=canonical(a.url);if(!key)continue;
  if(!seeds.has(key))seeds.set(key,{url:a.url,clinics:[],evidenceUrls:[]});
  const seed=seeds.get(key);
  if(!seed.clinics.some(c=>c.id===r.clinicId))seed.clinics.push({id:r.clinicId,name:r.name,address:r.address,phone:r.phone});
  seed.evidenceUrls=[...new Set([...seed.evidenceUrls,...a.evidenceUrls])];
}
const output={schemaVersion:1,createdAt:new Date().toISOString(),scope:'기관 페이지의 실제 연결로 발굴했지만 아직 읽지 않은 홈페이지. 기존 모든 요청 및 수동 본문 확인·접근 실패 주소 제외.',seeds:[...seeds.values()]};
const file=path.join(root,'data/research/discovered-homepage-seeds.json');
if(!process.argv.includes('--dry-run')&&(output.seeds.length||!fs.existsSync(file))){
  // Preserve the input behind every prior scan's seedSha256.
  if(fs.existsSync(file)){
    const previous=fs.readFileSync(file);const {createHash}=await import('node:crypto');
    const archive=path.join(root,'data/research/homepage-seed-history',createHash('sha256').update(previous).digest('hex')+'.json');
    fs.mkdirSync(path.dirname(archive),{recursive:true});if(!fs.existsSync(archive))fs.writeFileSync(archive,previous);
  }
  fs.writeFileSync(file,JSON.stringify(output,null,2)+'\n');
}
console.log(JSON.stringify({newUrls:output.seeds.length,clinics:output.seeds.reduce((n,s)=>n+s.clinics.length,0),dryRun:process.argv.includes('--dry-run'),seedFile:'data/research/discovered-homepage-seeds.json'}));
