import {esc,localDate,safeWebsite} from '../src/shared.mjs';
import {hoursStatusNotice} from './naver-hours-pages.mjs';

const weekdays=['월','화','수','목','금','토','일'];
const hasText=value=>typeof value==='string'&&value.trim().length>0;
export function naverPlaceSourceUrl(value){
  if(typeof value!=='string'||!/^https?:\/\//i.test(value))return null;
  const url=safeWebsite(value);if(!url)return null;
  const u=new URL(url);
  if(!['map.naver.com','m.place.naver.com','pcmap.place.naver.com'].includes(u.hostname)||u.port||/\/search(?:\/|$)/i.test(u.pathname)||!/\/(?:place|hospital)\/[1-9]\d*(?:\/|$)/.test(u.pathname))return null;
  u.hash='';return u.href;
}
const observationTime=value=>typeof value==='string'&&value.trim()?Date.parse(value):NaN;
const placeId=url=>new URL(url).pathname.match(/\/(?:place|hospital)\/([1-9]\d*)(?:\/|$)/)?.[1];

// The merged current asset winner carries manual corrections. Old observations
// remain in the source inventory, but cannot keep lending a corrected place's
// identity or hours to this clinic. Newer observations may establish a new match.
export function currentNaverPlaceObservations(record){
  const corrections=new Map();
  for(const asset of record?.assets??[]){
    if(asset.kind!=='naverMap'||asset.ownership!=='third_party')continue;
    const url=naverPlaceSourceUrl(asset.url),time=observationTime(asset.checkedAt);
    if(!url||!Number.isFinite(time))continue;
    const id=placeId(url);corrections.set(id,Math.max(corrections.get(id)??-Infinity,time));
  }
  return (record?.naverPlaceObservations??[]).flatMap(observation=>{
    const url=naverPlaceSourceUrl(observation.sourceUrl);if(!url)return [];
    const correction=corrections.get(placeId(url)),time=observationTime(observation.checkedAt);
    // An undated observation cannot demonstrate that it follows a dated correction.
    if(correction!==undefined&&(!Number.isFinite(time)||correction>=time))return [];
    return [{...observation,sourceUrl:url}];
  });
}

// Prefer the actual observation time, never the file/array order or a stale summary.
export function latestNaverHours(record){
  const observations=currentNaverPlaceObservations(record).filter(o=>o.bodyStatus==='read'&&o.identityMatch===true&&hasText(o.fields?.hours)&&Number.isFinite(observationTime(o.checkedAt)));
  const o=observations.toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0];
  return o?{raw:o.fields.hours,additional:o.fields.hoursAdditional??null,checkedAt:o.checkedAt,url:o.sourceUrl}:null;
}

// This only groups observed text for display. It does not infer recurring hours,
// copy a weekday group to missing days, or turn dated closures into regular ones.
export function splitObservedHours(raw){
  const text=String(raw).trim();
  const matches=[...text.matchAll(/(?:^|\s)([월화수목금토일])(\(\d{1,2}\/\d{1,2}\))?\s+(?=\d{1,2}:\d{2}|정기휴무|휴무)/g)];
  if(matches.length!==7||new Set(matches.map(m=>m[1])).size!==7)return {raw:text,rows:[],status:null,notes:[]};
  const notes=[];
  const rows=matches.map((m,i)=>{
    let detail=text.slice(m.index+m[0].length,matches[i+1]?.index??text.length).trim();
    const notice=detail.search(/(?:\d{1,2}\/\d{1,2}|매달\s|\d(?:\s*,\s*\d)+\s*주)/);
    if(notice>=0){notes.push(detail.slice(notice).trim());detail=detail.slice(0,notice).trim();}
    return {day:m[1],label:m[1]+'요일'+(m[2]?' '+m[2]:''),detail};
  }).sort((a,b)=>weekdays.indexOf(a.day)-weekdays.indexOf(b.day));
  if(rows.some(r=>!r.detail))return {raw:text,rows:[],status:null,notes:[]};
  return {raw:text,rows,status:text.slice(0,matches[0].index).trim()||null,notes};
}
function displayDetail(value){return esc(value.replace(/ (?=\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\s*휴게시간)/g,'\n').replace(/ (?=\d{1,2}:\d{2}(?:,\s*\d{1,2}:\d{2})*\s*접수마감)/g,'\n'));}
function additionalText(value){return typeof value==='string'?value:Array.isArray(value)?value.join(' · '):value==null?'':JSON.stringify(value);}

export function clinicHoursPanel(record,{registeredHtml,snapshot}){
  const hours=latestNaverHours(record);
  const intro='<h2>진료시간</h2>';
  const caution='<p class="subtle-note">확인일에 표시된 안내입니다. 공휴일·임시휴진·접수 마감은 방문 전 원문에서 다시 확인해 주세요.</p>';
  if(!hours)return `<section class="fact-panel clinic-hours" id="hours">${intro}<div class="pill-row"><span class="pill neutral">심평원 등록 자료</span><span class="mini-label">${esc(snapshot)} 기준</span></div><p class="subtle-note">기관 식별과 본문 확인을 마친 네이버 진료시간 자료가 아직 없습니다. 아래는 심평원 등록값입니다.</p>${hoursStatusNotice(record?.naverHoursStatus)}${registeredHtml}</section>`;
  const schedule=splitObservedHours(hours.raw);
  const table=schedule.rows.length?`<table class="fact-table observed-hours"><caption class="skip">네이버지도에 표시된 진료시간과 휴게·접수 안내</caption><tbody>${schedule.rows.map(r=>`<tr><th scope="row">${esc(r.label)}</th><td>${displayDetail(r.detail)}</td></tr>`).join('')}</tbody></table>`:`<div class="observed-hours-text">${esc(schedule.raw)}</div>`;
  const extra=[...schedule.notes,additionalText(hours.additional)].filter(Boolean);
  return `<section class="fact-panel clinic-hours" id="hours">${intro}<div class="pill-row"><span class="pill">네이버지도 안내</span><span class="mini-label">${localDate(hours.checkedAt)} 확인</span><a class="text-link" href="${esc(hours.url)}" target="_blank" rel="noopener noreferrer">네이버지도 원문 ↗</a></div>${table}${extra.length?`<div class="hours-notes"><strong>추가 시간·휴무 안내</strong>${extra.map(s=>`<p>${esc(s)}</p>`).join('')}</div>`:''}${caution}<details class="hours-original"><summary>수집한 시간 안내 원문</summary>${schedule.status?`<p class="subtle-note">관찰 당시 상태: ${esc(schedule.status.replace(/휴무매주/g,'휴무 · 매주'))}</p>`:''}<p>${esc(schedule.raw)}</p></details><details class="hours-registered"><summary>심평원 등록 진료시간 · ${esc(snapshot)} 기준</summary><p class="subtle-note">심평원 원자료와 네이버지도 안내는 출처·확인 시점이 다릅니다. 아래 등록값은 원자료 그대로 보존했습니다.</p>${registeredHtml}</details></section>`;
}
