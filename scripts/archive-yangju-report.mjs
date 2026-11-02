#!/usr/bin/env node
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {loadAssetInventory} from './clinic-assets.mjs';
import {buildYangjuAnalysis} from './yangju-analysis.mjs';
import {citationPack,loadYangjuArchives} from './yangju-citation.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const data=JSON.parse(fs.readFileSync(new URL('../data/clinics.json',import.meta.url),'utf8'));
const manifest=JSON.parse(fs.readFileSync(new URL('../data/source-manifest.json',import.meta.url),'utf8'));
const a=buildYangjuAnalysis(data.clinics,loadAssetInventory(root,data),{snapshotDate:data.snapshotDate,observedAt:data.observedAt,sourceSha256:manifest.archive.sha256});
const c=citationPack(a,'https://dentaldatalab.com');
if(loadYangjuArchives().some(old=>citationPack(old,'https://dentaldatalab.com').version===c.version)){console.log('Already archived: '+c.version);process.exit(0);}
const target=new URL('../data/content/report-archives/yangju-hours-evidence-'+c.version+'.json',import.meta.url);
fs.writeFileSync(target,JSON.stringify(a,null,2)+'\n',{flag:'wx'});console.log('Created '+target.pathname+' — review and commit with the corresponding source release.');
