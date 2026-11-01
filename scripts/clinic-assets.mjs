import fs from 'node:fs';
import path from 'node:path';
import {safeWebsite, SOURCE_URL} from '../src/shared.mjs';
import {currentNaverPlaceObservations,naverPlaceSourceUrl} from './clinic-hours.mjs';

export const KINDS={website:'홈페이지',naverMap:'네이버지도',naverBlog:'네이버 블로그',blog:'기타 블로그',youtube:'유튜브',instagram:'인스타그램',facebook:'페이스북',kakaoChannel:'카카오 채널',kakaoMap:'카카오맵',googleMap:'구글지도',booking:'예약',linkHub:'링크 모음',other:'기타 채널'};
export const OWNERSHIP={official:'본문·기관 대조',linked:'기관 페이지에서 연결',registered:'원자료 등록 URL',candidate:'귀속 확인 필요',third_party:'제3자 언급'};
export const BODY={read:'본문 읽음',blocked:'본문 접근 실패',not_read:'대상 본문 미확인'};
export function institutionType(code){return {'41':'치과병원','51':'치과의원'}[code]??'종별 미확인';}
export function assetUrl(raw){
  const url=safeWebsite(raw);if(!url)return null;
  const u=new URL(url);if(/\s|[%\\]/.test(u.hostname)||u.hostname.endsWith('.local')||u.hostname==='localhost'||/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(u.hostname))return null;
  u.hash='';return u.href;
}
export function naverBookingSourceUrl(raw){
  if(typeof raw!=='string'||!/^https?:\/\//i.test(raw))return null;
  const url=assetUrl(raw);if(!url)return null;
  const parsed=new URL(url);
  return ['booking.naver.com','m.booking.naver.com'].includes(parsed.hostname)&&!parsed.port&&/^\/booking\/\d+\/bizes\/[1-9]\d*(?:\/|$)/.test(parsed.pathname)?url:null;
}
const bookingId=raw=>{const url=naverBookingSourceUrl(raw);return url?new URL(url).pathname.match(/\/bizes\/([1-9]\d*)(?:\/|$)/)?.[1]:null;};
export function bookingContentScope(content){
  const url=naverBookingSourceUrl(content?.sourceUrl);if(!url)return null;
  const item=new URL(url).pathname.match(/\/items\/([1-9]\d*)(?:\/|$)/)?.[1]??'';
  const kind=content.contentKind??(item?'service_detail':'home');
  if(!['home','service_detail','service_notice'].includes(kind)||kind==='home'&&item||kind!=='home'&&!item)return null;
  return `${bookingId(url)}:${item}:${kind}`;
}
export function bookingBodyChecks(asset){
  if(asset?.kind!=='booking'||!['official','linked'].includes(asset.ownership)||!bookingId(asset.url))return [];
  return (asset.bodyChecks??[]).filter(check=>naverBookingSourceUrl(check.sourceUrl)&&bookingId(check.sourceUrl)===bookingId(asset.url)&&dated(check.checkedAt)&&['read','blocked','not_read'].includes(check.bodyStatus)).toSorted((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt));
}
function validBookingPublisherContent(asset,content){
  if(asset?.kind!=='booking'||!['official','linked'].includes(asset.ownership)||!content||typeof content.text!=='string'||!content.text.trim()||!dated(content.checkedAt))return null;
  const sourceUrl=naverBookingSourceUrl(content.sourceUrl);
  if(!sourceUrl||!bookingContentScope(content)||!bookingId(asset.url)||bookingId(sourceUrl)!==bookingId(asset.url))return null;
  const read=asset.bodyStatus==='read'||bookingBodyChecks(asset).some(c=>c.bodyStatus==='read'&&bookingContentScope(c)===bookingContentScope(content)&&c.sourceUrl===sourceUrl&&Date.parse(c.checkedAt)===Date.parse(content.checkedAt));
  return read?{...content,sourceUrl,title:typeof content.title==='string'?content.title:'공개 예약 목록·안내'}:null;
}
export function bookingPublisherContents(asset){
  const byScope=new Map();
  for(const raw of [...(asset?.publisherContents??[]),...(asset?.publisherContent?[asset.publisherContent]:[])]){
    const content=validBookingPublisherContent(asset,raw);if(!content)continue;
    const scope=bookingContentScope(content),previous=byScope.get(scope);
    if(!previous||Date.parse(content.checkedAt)>Date.parse(previous.checkedAt))byScope.set(scope,content);
  }
  return [...byScope.values()].sort((a,b)=>bookingContentScope(a).localeCompare(bookingContentScope(b)));
}
// Compatibility: consumers needing one document receive the latest successful one.
export function bookingPublisherContent(asset){return bookingPublisherContents(asset).toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]??null;}
export function detectKind(url){
  const u=new URL(url),h=u.hostname.replace(/^www\./,''),p=u.pathname;
  if(/^(m\.)?blog\.naver\.com$/.test(h))return 'naverBlog';
  if(['map.naver.com','m.place.naver.com','pcmap.place.naver.com'].includes(h))return 'naverMap';
  if(h==='instagram.com')return 'instagram';
  if(['youtube.com','m.youtube.com','youtu.be'].includes(h))return 'youtube';
  if(['facebook.com','m.facebook.com'].includes(h))return 'facebook';
  if(h==='pf.kakao.com')return 'kakaoChannel';
  if(['map.kakao.com','place.map.kakao.com','kko.to'].includes(h))return 'kakaoMap';
  if(['booking.naver.com','m.booking.naver.com'].includes(h))return 'booking';
  if(h.endsWith('.tistory.com')||h.endsWith('.wordpress.com')||h==='brunch.co.kr')return 'blog';
  if(['linktr.ee','litt.ly','instabio.cc'].includes(h))return 'linkHub';
  return 'website';
}
function key(asset){const u=new URL(asset.url);if(asset.kind==='naverMap'){const m=u.pathname.match(/\/(?:place|hospital)\/(\d+)/);if(m)return 'naverMap:'+m[1];}if(asset.kind==='booking'){const b=u.pathname.match(/\/bizes\/(\d+)/);if(b)return 'booking:'+b[1];}return asset.kind+':'+u.hostname.replace(/^www\./,'')+u.pathname.replace(/\/$/,'')+u.search;}
const rank={third_party:0,registered:1,candidate:2,linked:3,official:4};
const digits=value=>String(value??'').replace(/\D/g,'');
const roadKey=value=>String(value??'').match(/([가-힣A-Za-z0-9·]+(?:대로|로|길))\s*(\d+(?:-\d+)?)/)?.slice(1).join(' ');
const jurisdiction=value=>{const parts=String(value??'').trim().split(/\s+/);const aliases={'서울특별시':'서울','부산광역시':'부산','대구광역시':'대구','인천광역시':'인천','광주광역시':'광주','대전광역시':'대전','울산광역시':'울산','경기도':'경기','강원특별자치도':'강원','강원도':'강원','충청북도':'충북','충청남도':'충남','전북특별자치도':'전북','전라북도':'전북','전라남도':'전남','전남광주통합특별시':'전남광주','경상북도':'경북','경상남도':'경남','제주특별자치도':'제주','세종특별자치시':'세종'};const province=aliases[parts[0]]??parts[0];return province==='세종'?province:parts.length>=2?province+' '+parts[1]:null;};
function normalizeAsset(a,checkedAt){
  const url=assetUrl(a.url);if(!url)return null;
  const evidenceUrls=[...new Set((a.evidenceUrls??[]).map(assetUrl).filter(Boolean))];
  const identityEvidence=Array.isArray(a.identityEvidence)?a.identityEvidence.filter(x=>x&&['name','phone','address','officialLink'].includes(x.field)&&assetUrl(x.sourceUrl)).map(x=>({...x,sourceUrl:assetUrl(x.sourceUrl)})):[];
  let ownership=Object.hasOwn(OWNERSHIP,a.ownership)?a.ownership:'candidate';
  const bodyStatus=Object.hasOwn(BODY,a.bodyStatus)?a.bodyStatus:'not_read';
  if(ownership==='official'&&(bodyStatus!=='read'||!evidenceUrls.length||!identityEvidence.some(x=>['phone','address'].includes(x.field))))ownership='candidate';
  if(ownership==='linked'&&(!evidenceUrls.length||!identityEvidence.some(x=>x.field==='officialLink')))ownership='candidate';
  return {...a,url,kind:Object.hasOwn(KINDS,a.kind)?a.kind:detectKind(url),ownership,bodyStatus,evidenceUrls,identityEvidence,checkedAt:a.checkedAt??checkedAt??null};
}
const naverPlaceId=value=>{const url=naverPlaceSourceUrl(value);return url?new URL(url).pathname.match(/\/(?:place|hospital)\/([1-9]\d*)(?:\/|$)/)?.[1]:null;};
const fieldPresent=value=>typeof value==='string'?value.trim().length>0:Array.isArray(value)?value.length>0:value!=null&&typeof value==='object'?Object.keys(value).length>0:value!=null;
const dated=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function naverObservationTab(sourceUrl){
  const url=naverPlaceSourceUrl(sourceUrl);if(!url)return null;
  const parsed=new URL(url),tab=parsed.pathname.match(/\/(?:place|hospital)\/[1-9]\d*\/(home|information|booking)(?:\/|$)/)?.[1]
    ??parsed.searchParams.get('placePath')?.match(/^\/(home|information|booking)(?:\/|\?|$)/)?.[1];
  return tab??null;
}
const fieldSourceScope=entry=>naverObservationTab(entry.sourceUrl)??new URL(entry.sourceUrl).origin+new URL(entry.sourceUrl).pathname;

// A display entry retains the time and URL of this field, never the newest file's time.
export function naverObservationFields(observation){
  if(observation?.bodyStatus!=='read')return [];
  const fields=observation.fields??{},statuses=observation.fieldStatus??{},partial=observation.incompleteFields??{};
  const keys=new Set([...Object.keys(fields),...Object.keys(statuses),...Object.keys(partial)]);
  return [...keys].flatMap(key=>{
    const status=statuses[key]??(fieldPresent(fields[key])?'read':fieldPresent(partial[key])?'incomplete':null);
    if(!['read','not_displayed','incomplete'].includes(status)||status==='read'&&!fieldPresent(fields[key]))return [];
    const sourceUrl=naverPlaceSourceUrl(observation.fieldSources?.[key]??observation.sourceUrl);
    const checkedAt=observation.fieldCheckedAt?.[key]??observation.checkedAt;
    if(!sourceUrl||naverPlaceId(sourceUrl)!==naverPlaceId(observation.sourceUrl)||!dated(checkedAt))return [];
    const note=observation.captureNotes?.[key];
    return [{key,status,value:status==='read'?fields[key]:null,partialValue:status==='incomplete'?partial[key]??null:null,sourceUrl,checkedAt,...(typeof note==='string'&&note.trim()?{note}:{})}];
  });
}

// This is a view only: source observations stay separate and are never backfilled.
export function buildNaverFieldView(record){
  if(!record?.naverPlaceObservations?.length)return null;
  const current=currentNaverPlaceObservations(record).filter(o=>dated(o.checkedAt)).toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
  const latest=current[0];if(!latest)return null;
  const placeId=naverPlaceId(latest.sourceUrl),samePlace=current.filter(o=>naverPlaceId(o.sourceUrl)===placeId);
  const byField=new Map();
  for(const observation of samePlace)for(const entry of naverObservationFields(observation)){
    if(!byField.has(entry.key))byField.set(entry.key,[]);
    byField.get(entry.key).push(entry);
  }
  const fields=[...byField.values()].map(entries=>{
    const sorted=entries.toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
    const scopes=new Map();
    for(const entry of sorted){const scope=fieldSourceScope(entry);if(!scopes.has(scope))scopes.set(scope,[]);scopes.get(scope).push(entry);}
    // Not displayed describes its tab, not the removal of a value read on another tab.
    const currentByScope=[...scopes.values()].map(items=>items.find(entry=>entry.status!=='incomplete')??items[0]);
    const selected=currentByScope.filter(entry=>entry.status==='read').toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]
      ??currentByScope.filter(entry=>entry.status==='not_displayed').toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]??sorted[0];
    return {...selected,...(['incomplete','not_displayed'].includes(sorted[0].status)&&Date.parse(sorted[0].checkedAt)>Date.parse(selected.checkedAt)?{latestAttempt:{...sorted[0]}}:{})};
  });
  const reviewed=samePlace.find(o=>o.bodyStatus==='read'&&Array.isArray(o.captureScope)&&o.captureScope.length>0);
  let review=null;
  if(reviewed){
    const entries=new Map(naverObservationFields(reviewed).map(entry=>[entry.key,entry]));
    const scope=[...new Set(reviewed.captureScope)];
    review={scope,checkedAt:reviewed.checkedAt,sourceUrl:reviewed.sourceUrl,complete:reviewed.declaredScopeComplete===true&&scope.every(key=>['read','not_displayed'].includes(entries.get(key)?.status))};
  }
  return {latest,placeId,fields,review};
}
export function buildAssetInventory(clinics,{snapshotDate,observedAt,batches=[],legacy=[],crawl=null}={}){
  const byId=new Map(clinics.map(c=>[c.id,{clinicId:c.id,name:c.name,typeCode:c.typeCode,type:institutionType(c.typeCode),sido:c.sido,city:c.city,address:c.address,phone:c.phone,registeredWebsite:c.website??null,assets:[],searches:[],naverPlaceObservations:[],homepageChecks:[],checkedAt:null,researched:false}]));
  const maps=new Map(clinics.map(c=>[c.id,new Map()]));
  const bookingCaptures=[];
  function add(id,raw,checkedAt,priority=0){const a=normalizeAsset(raw,checkedAt);if(!a)return;a.sourcePriority=priority;const m=maps.get(id),k=key(a),previous=m.get(k);if(!previous)m.set(k,a);else{
    const aBody=['read','blocked'].includes(a.bodyStatus),previousBody=['read','blocked'].includes(previous.bodyStatus);
    // A newer listing link is not a newer visit to its destination, regardless of batch order.
    const preferBody=a.ownership==='linked'&&previous.ownership==='linked'&&aBody!==previousBody;
    const newer=(a.checkedAt??'')>(previous.checkedAt??'')||(a.checkedAt??'')===(previous.checkedAt??'')&&rank[a.ownership]>=rank[previous.ownership];
    const winner=a.sourcePriority>previous.sourcePriority||a.sourcePriority===previous.sourcePriority&&(preferBody?aBody:newer)?a:previous;
    const loser=winner===a?previous:a;m.set(k,{...winner,evidenceUrls:[...new Set([...winner.evidenceUrls,...loser.evidenceUrls])],identityEvidence:[...winner.identityEvidence,...loser.identityEvidence],provenance:[...(previous.provenance??[]),...(a.provenance??[])]});
  }}
  for(const c of clinics){const url=assetUrl(c.website);if(url)add(c.id,{url,kind:detectKind(url),ownership:'registered',bodyStatus:'not_read',label:'공공데이터 신고 주소',evidenceUrls:[SOURCE_URL],identityEvidence:[],notes:'원자료에 등록된 주소입니다. 현재 운영·기관 귀속은 별도 확인이 필요합니다.',provenance:[{type:'hira_registration',snapshotDate,sourceUrl:SOURCE_URL}]},observedAt);}
  // Legacy research retains strict source verification; blocked targets stay unverified.
  for(const batch of legacy)for(const r of batch.records??[]){
    const record=byId.get(r.clinicId);if(!record||record.name!==r.name)throw new Error('Legacy asset institution mismatch: '+r.clinicId);
    record.researched=true;record.checkedAt=r.checkedAt??batch.checkedAt;
    record.searches.push(...(r.searchQueries??[]).map(query=>({query,outcome:r.searchSummary??'기존 채널 조사'})));
    for(const [kind,ch]of Object.entries(r.channels??{})){
      if(!ch.url)continue;
      const verified=ch.status==='verified'&&ch.bodyVerified===true&&ch.identityVerified===true;
      const identity=verified?(r.facts??[]).filter(f=>['phone','address'].includes(f.field)).map(f=>({field:f.field,value:f.value,sourceUrl:f.sourceUrl??f.evidenceUrls?.[0]??ch.url})):[];
      // Recorded legacy verification sometimes supplies identity in prose only.
      if(verified&&!identity.length)identity.push({field:'address',value:'기존 조사에서 기관명·주소/전화 대조 기록: '+(ch.notes??''),sourceUrl:ch.evidenceUrls?.[0]??ch.url});
      add(r.clinicId,{kind:({naverPlace:'naverMap',naverBooking:'booking'})[kind]??kind,url:ch.url,ownership:verified?'official':'candidate',bodyStatus:ch.bodyVerified===true?'read':ch.status==='blocked'?'blocked':'not_read',evidenceUrls:ch.evidenceUrls??[],identityEvidence:identity,notes:ch.notes??'',provenance:[{type:'legacy_research',checkedAt:ch.checkedAt??record.checkedAt}]},ch.checkedAt??record.checkedAt,2);
    }
  }
  for(const check of crawl?.results??[]){for(const id of check.clinicIds??[]){const r=byId.get(id);if(!r)throw new Error('Unknown crawler clinic '+id);const match=check.matches?.[id]??{},sourceType=check.sourceType??'registered_homepage';r.homepageChecks.push({url:check.url,finalUrl:check.finalUrl??null,status:check.status,httpStatus:check.httpStatus??null,checkedAt:check.checkedAt,bodySha256:check.bodySha256??null,sourceType,matches:{...match}});if(check.status!=='read')continue;
    const matched=match.name&&match.phone,proof=[];
    if(match.name)proof.push({field:'name',value:r.name,sourceUrl:check.finalUrl});if(match.phone)proof.push({field:'phone',value:r.phone,sourceUrl:check.finalUrl});
    add(id,{url:check.url,kind:detectKind(check.url),ownership:'candidate',bodyStatus:'read',evidenceUrls:[check.finalUrl],identityEvidence:proof,notes:matched?'본문에서 이름·전화 문자열을 자동 대조했습니다. 수동 귀속 검토 전입니다.':'홈페이지 HTML은 수신했으나 기관 귀속은 미확인입니다.',provenance:[{type:'homepage_scan',sourceType,bodySha256:check.bodySha256}]},check.checkedAt,1);
    // A parked or unrelated old domain must not donate its social accounts to the clinic.
    if(match.name||match.phone)for(const a of check.links??[])add(id,{...a,ownership:'candidate',bodyStatus:'not_read',evidenceUrls:[check.finalUrl],identityEvidence:[...proof,{field:'officialLink',value:'기관명 또는 전화 문자열이 있는 홈페이지 HTML의 href. 운영 주체 수동 확인 전.',sourceUrl:check.finalUrl}],notes:'홈페이지의 실제 외부 링크입니다. 자동 수집 후보이며 기관 귀속과 대상 본문은 수동 확인 전입니다.',provenance:[{type:'homepage_href',sourceType,bodySha256:check.bodySha256}]},check.checkedAt,1);
  }}
  for(const batch of batches)for(const r of batch.records??[]){
    const record=byId.get(r.clinicId);if(!record||record.name!==r.name)throw new Error('Asset institution mismatch: '+r.clinicId);
    record.researched=record.researched||r.researched!==false;
    const checkedAt=r.checkedAt??batch.checkedAt??null;
    if(checkedAt&&(!record.checkedAt||Date.parse(checkedAt)>Date.parse(record.checkedAt)))record.checkedAt=checkedAt;
    record.searches.push(...(r.searches??[]));
    // Directory discovery provides candidates, never a replacement for a body check.
    for(const a of r.assets??[]){if(batch.sourceType==='naver_booking_browser_capture')bookingCaptures.push({clinicId:r.clinicId,asset:a,checkedAt});else add(r.clinicId,a,checkedAt,r.researched===false?1:3);}
    for(const o of r.naverPlaceObservations??[]){const url=assetUrl(o.sourceUrl);if(!url||!['map.naver.com','m.place.naver.com','pcmap.place.naver.com'].includes(new URL(url).hostname))throw new Error('Naver observation must use actual Naver Place URL');if(o.bodyStatus!=='read'&&Object.keys(o.fields??{}).length)throw new Error('Unread Naver page cannot supply observed fields');record.naverPlaceObservations.push({...o,...(batch.sourceType?{sourceType:batch.sourceType}:{}),sourceUrl:url,fields:o.fields??{}});
      if(o.bodyStatus!=='read')continue;
      const f=o.fields??{},nameMatch=String(f.name??'').replace(/\s/g,'')===record.name.replace(/\s/g,''),sameJurisdiction=Boolean(jurisdiction(f.address)&&jurisdiction(f.address)===jurisdiction(record.address)),phoneMatch=Boolean(digits(f.phone)&&digits(f.phone)===digits(record.phone)),addressMatch=Boolean(sameJurisdiction&&roadKey(f.address)&&roadKey(f.address)===roadKey(record.address));
      const nameVariantReviewed=o.identityReview?.confirmed===true&&typeof o.identityReview.reason==='string'&&o.identityReview.reason.trim().length>0;
      const matched=(nameMatch&&((phoneMatch&&(!f.address||sameJurisdiction))||addressMatch))||(nameVariantReviewed&&sameJurisdiction&&(phoneMatch||addressMatch)),proof=[];
      const stored=record.naverPlaceObservations.at(-1);stored.identityMatch=matched;stored.identityComparison={nameMatch,nameVariantReviewed,phoneMatch,addressMatch,sameJurisdiction};
      if(nameMatch||nameVariantReviewed)proof.push({field:'name',value:f.name,sourceUrl:url});if(phoneMatch)proof.push({field:'phone',value:f.phone,sourceUrl:url});if(addressMatch)proof.push({field:'address',value:f.address,sourceUrl:url});
      add(r.clinicId,{kind:'naverMap',url,ownership:matched?'official':'candidate',bodyStatus:'read',evidenceUrls:[url],identityEvidence:proof,notes:matched?'네이버지도 공개 본문의 기관명과 전화 또는 같은 지역의 도로명·건물번호를 공공 원자료와 대조했습니다.'+(nameVariantReviewed?' 명칭 표기 차이 검토: '+o.identityReview.reason:''):'네이버지도 본문 관찰. 기관명·주소/전화 자동 일치 조건은 충족하지 않아 귀속 후보를 유지합니다.'},o.checkedAt??record.checkedAt,matched?3:2);

    }
  }
  // Owner-only captures may explicitly refer to an already identified observation.
  // A reference links the same Place; it does not claim that its old facts were read again.
  for(const record of byId.values()){
    const active=currentNaverPlaceObservations({...record,assets:[...maps.get(record.clinicId).values()]});
    const observations=record.naverPlaceObservations.filter(o=>active.some(a=>a.sourceUrl===o.sourceUrl&&a.checkedAt===o.checkedAt)).toSorted((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt));
    for(const observation of observations){
      const reference=observation.identityReference;if(observation.bodyStatus!=='read'||observation.identityMatch===true||!reference||!dated(observation.checkedAt)||!dated(reference.checkedAt))continue;
      if(naverPlaceId(observation.sourceUrl)!==naverPlaceId(reference.sourceUrl)||Date.parse(reference.checkedAt)>=Date.parse(observation.checkedAt))continue;
      const fields=observation.fields??{},comparison=observation.identityComparison??{};
      if(fieldPresent(fields.name)&&!comparison.nameMatch&&!comparison.nameVariantReviewed||fieldPresent(fields.address)&&!comparison.addressMatch||fieldPresent(fields.phone)&&!comparison.phoneMatch)continue;
      const proof=observations.find(o=>o!==observation&&o.bodyStatus==='read'&&o.identityMatch===true&&o.sourceUrl===naverPlaceSourceUrl(reference.sourceUrl)&&Date.parse(o.checkedAt)===Date.parse(reference.checkedAt));
      if(!proof)continue;
      observation.identityMatch=true;observation.identityComparison={...comparison,referenceMatch:true};
    }
  }
  // Materialize displayed links after explicit same-Place references are resolved.
  for(const record of byId.values())for(const observation of record.naverPlaceObservations){
    if(observation.bodyStatus!=='read')continue;
    const fields=observation.fields??{},comparison=observation.identityComparison??{},proof=[];
    if(comparison.nameMatch||comparison.nameVariantReviewed)proof.push({field:'name',value:fields.name,sourceUrl:observation.sourceUrl});
    if(comparison.phoneMatch)proof.push({field:'phone',value:fields.phone,sourceUrl:observation.sourceUrl});
    if(comparison.addressMatch)proof.push({field:'address',value:fields.address,sourceUrl:observation.sourceUrl});
    const displayed=[...(observation.observedChannelLinks??[]),...['website','naverBlog','blog','youtube','instagram','facebook','booking','kakaoChannel'].map(field=>({kind:field,url:fields[field],sourceUrl:observation.fieldSources?.[field]??observation.sourceUrl,checkedAt:observation.fieldCheckedAt?.[field]??observation.checkedAt}))],seen=new Set();
    for(const link of displayed){
      if(typeof link.url!=='string'||!/^https?:\/\//i.test(link.url))continue;
      const url=assetUrl(link.url),sourceUrl=naverPlaceSourceUrl(link.sourceUrl??observation.sourceUrl),checkedAt=link.checkedAt??observation.checkedAt;
      if(!url||!sourceUrl||!dated(checkedAt)||naverPlaceId(sourceUrl)!==naverPlaceId(observation.sourceUrl))continue;
      const kind=link.kind==='website'||!Object.hasOwn(KINDS,link.kind)?detectKind(url):link.kind;
      if(kind==='naverMap'&&naverPlaceId(url)!==naverPlaceId(observation.sourceUrl))continue;
      const assetKey=key({kind,url});if(seen.has(assetKey))continue;seen.add(assetKey);
      const previous=maps.get(record.clinicId).get(assetKey);
      const priority=previous&&(['official','third_party'].includes(previous.ownership)||previous.ownership==='linked'&&(['read','blocked'].includes(previous.bodyStatus)||observation.identityMatch!==true))?1:3;
      add(record.clinicId,{kind,url,label:link.label,ownership:observation.identityMatch===true?'linked':'candidate',bodyStatus:'not_read',evidenceUrls:[sourceUrl],identityEvidence:[...proof,{field:'officialLink',value:'네이버지도 공개 화면에 실제 표시된 URL',sourceUrl}],notes:'네이버지도 표시 URL을 수록했습니다. 대상 사이트 본문 확인은 별도 상태로 기록합니다.',provenance:[{type:'naver_displayed_link',sourceUrl,checkedAt}]},checkedAt,priority);
    }
  }
  // Booking body captures supplement a current verified link, never its ownership.
  for(const {clinicId,asset:raw,checkedAt} of bookingCaptures){
    const url=naverBookingSourceUrl(raw.url),reference=raw.ownershipReference;
    if(raw.kind!=='booking'||!url||!reference||!['official','linked'].includes(reference.ownership)||!dated(reference.checkedAt)||bookingId(reference.url)!==bookingId(url))continue;
    const map=maps.get(clinicId),assetKey=key({kind:'booking',url}),current=map.get(assetKey);
    if(!current||!['official','linked'].includes(current.ownership)||bookingId(current.url)!==bookingId(url))continue;
    const captureTime=raw.checkedAt??checkedAt;
    if(!dated(captureTime)||Date.parse(reference.checkedAt)>Date.parse(captureTime))continue;
    const content=raw.bodyStatus==='read'&&(!raw.publisherContentStatus||raw.publisherContentStatus==='read')?bookingPublisherContent({...raw,ownership:current.ownership}):null;
    const checks=(raw.bodyChecks??[{sourceUrl:raw.publisherContent?.sourceUrl??url,checkedAt:captureTime,bodyStatus:raw.bodyStatus}]).flatMap(check=>{
      const sourceUrl=naverBookingSourceUrl(check.sourceUrl);
      if(!sourceUrl||bookingId(sourceUrl)!==bookingId(url)||!dated(check.checkedAt)||!['read','blocked','not_read'].includes(check.bodyStatus)||Date.parse(check.checkedAt)<Date.parse(reference.checkedAt)||Date.parse(check.checkedAt)>Date.parse(captureTime))return [];
      const publisherContentStatus=check.publisherContentStatus??raw.publisherContentStatus??(content?'read':'incomplete');
      const contentKind=check.contentKind??raw.contentKind??content?.contentKind;
      if(!bookingContentScope({sourceUrl,contentKind}))return [];
      if(!['read','not_displayed','incomplete'].includes(publisherContentStatus))return [];
      if(check.bodyStatus==='read'&&publisherContentStatus==='read'&&(!content||bookingContentScope({sourceUrl,contentKind})!==bookingContentScope(content)||content.sourceUrl!==sourceUrl||Date.parse(content.checkedAt)!==Date.parse(check.checkedAt)))return [];
      if(check.bodyStatus==='read'&&raw.bodyStatus!=='read')return [];
      if(check.bodyStatus!=='read'&&publisherContentStatus!=='incomplete')return [];
      return [{...check,...(contentKind?{contentKind}:{}),...(raw.captureMetadata?{captureMetadata:raw.captureMetadata}:{}),publisherContentStatus,sourceUrl,sourceType:'naver_booking_browser_capture'}];
    });
    if(!checks.length)continue;
    const bodyChecks=[...new Map([...bookingBodyChecks(current),...checks].map(check=>[JSON.stringify([bookingContentScope(check),check.sourceUrl,check.checkedAt,check.bodyStatus]),check])).values()].sort((a,b)=>Date.parse(a.checkedAt)-Date.parse(b.checkedAt));
    const publisherContents=bookingPublisherContents({...current,bodyStatus:'read',publisherContent:null,publisherContents:[...bookingPublisherContents(current),...(content&&checks.some(check=>check.bodyStatus==='read')?[content]:[])]});
    const publisherContent=publisherContents.toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt))[0]??null;
    const newest=bodyChecks.at(-1),readDates=[...(current.bodyStatus==='read'&&dated(current.checkedAt)?[current.checkedAt]:[]),...bodyChecks.filter(check=>check.bodyStatus==='read').map(check=>check.checkedAt)].sort((a,b)=>Date.parse(a)-Date.parse(b));
    const updateFailure=current.bodyStatus==='not_read'||!dated(current.checkedAt)||Date.parse(newest.checkedAt)>=Date.parse(current.checkedAt);
    const bodyStatus=readDates.length?'read':updateFailure?newest.bodyStatus:current.bodyStatus,bodyCheckedAt=readDates.at(-1)??(updateFailure?newest.checkedAt:current.checkedAt);
    map.set(assetKey,{...current,bodyStatus,checkedAt:bodyCheckedAt,bodyChecks,publisherContents,publisherContentStatus:newest.publisherContentStatus,ownershipReference:{...reference},ownershipEvidenceAt:current.ownershipEvidenceAt??reference.checkedAt,...(publisherContent?{publisherContent}:{}),provenance:[...(current.provenance??[]),{type:'booking_browser_body_capture',sourceUrl:checks.at(-1).sourceUrl,checkedAt:captureTime}]});
  }
  // Apply body-read evidence only after all curated ownership decisions have won.
  // Newest successful checks go first so file order cannot choose an older body.
  const bodyChecks=(crawl?.results??[]).filter(c=>c.status==='read'&&Number.isFinite(Date.parse(c.checkedAt))).toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
  for(const check of bodyChecks){
    const url=assetUrl(check.url),finalUrl=assetUrl(check.finalUrl??check.url);
    if(!url||!finalUrl||detectKind(url)!=='website')continue;
    for(const id of check.clinicIds??[]){
      const match=check.matches?.[id]??{};if(match.name!==true&&match.phone!==true)continue;
      const assets=maps.get(id),assetKey=key({kind:'website',url}),asset=assets?.get(assetKey);
      if(!asset||asset.ownership!=='linked'||asset.bodyStatus==='read')continue;
      const previousTime=Date.parse(asset.checkedAt);
      if(Number.isFinite(previousTime)&&Date.parse(check.checkedAt)<=previousTime)continue;
      assets.set(assetKey,{...asset,bodyStatus:'read',checkedAt:check.checkedAt,provenance:[...(asset.provenance??[]),{type:'homepage_body_check',sourceType:check.sourceType??'registered_homepage',sourceUrl:finalUrl,checkedAt:check.checkedAt,bodySha256:check.bodySha256??null,matches:{...match}}]});
    }
  }
  const records=[...byId.values()];for(const r of records){r.assets=[...maps.get(r.clinicId).values()].sort((a,b)=>Object.keys(KINDS).indexOf(a.kind)-Object.keys(KINDS).indexOf(b.kind)||({official:0,linked:1,registered:2,candidate:3,third_party:4}[a.ownership]-{official:0,linked:1,registered:2,candidate:3,third_party:4}[b.ownership])||a.url.localeCompare(b.url));r.assetCount=r.assets.filter(a=>a.ownership!=='third_party').length;r.confirmedCount=r.assets.filter(a=>['official','linked'].includes(a.ownership)).length;}
  const assets=records.flatMap(r=>r.assets),naverViews=new Map(records.map(r=>[r.clinicId,buildNaverFieldView(r)]));
  const summary={total:records.length,byType:Object.fromEntries(['41','51'].map(t=>[institutionType(t),records.filter(r=>r.typeCode===t).length])),registeredWebsiteFields:records.filter(r=>r.registeredWebsite).length,validRegisteredUrls:clinics.filter(c=>assetUrl(c.website)).length,withAssets:records.filter(r=>r.assetCount>0).length,withoutAssets:records.filter(r=>!r.assetCount).length,manuallyResearched:records.filter(r=>r.researched).length,assetCount:assets.length,byKind:Object.fromEntries(Object.keys(KINDS).map(k=>[k,assets.filter(a=>a.kind===k).length])),byOwnership:Object.fromEntries(Object.keys(OWNERSHIP).map(k=>[k,assets.filter(a=>a.ownership===k).length])),naverInspected:records.filter(r=>r.naverPlaceObservations.length).length,naverRead:records.filter(r=>r.naverPlaceObservations.some(o=>o.bodyStatus==='read')).length,naverMatched:records.filter(r=>r.naverPlaceObservations.some(o=>o.identityMatch===true)).length,naverWithFields:records.filter(r=>r.naverPlaceObservations.some(o=>o.bodyStatus==='read'&&Object.keys(o.fields).length)).length,naverFieldCoverage:Object.fromEntries(['address','phone','hours','website','amenities','parking','description','representativeKeywords','directions'].map(field=>[field,records.filter(r=>naverViews.get(r.clinicId)?.fields.some(entry=>entry.key===field&&entry.status==='read')).length])),homepageUrlsChecked:crawl?.results?.length??0,homepageHtmlRead:crawl?.results?.filter(r=>r.status==='read').length??0};
  return {schemaVersion:1,snapshotDate,observedAt,generatedAt:new Date().toISOString(),summary,records};
}
export function loadAssetInventory(root,data){
  const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
  const dir=path.join(root,'data/assets');const batches=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>/^yangju-\d+\.json$/.test(f)||/^uijeongbu-web-[a-z]+\d*\.json$/.test(f)||/^national-web-[a-z]+\d*\.json$/.test(f)||/^naver-national-(?:\d+|discovery|owner-\d+)\.json$/.test(f)||/^naver-yangju-(?:owner|booking)-\d+\.json$/.test(f)||f==='naver-browser.json').sort().map(f=>read('data/assets/'+f)):[];
  const legacy=fs.readdirSync(path.join(root,'data/research')).filter(f=>/^yangju-\d+\.json$/.test(f)).sort().map(f=>read('data/research/'+f));
  const results=['national-homepages.json','discovered-homepages.json','continuous-homepages.json'].flatMap(file=>fs.existsSync(path.join(dir,file))?(read('data/assets/'+file).results??[]).map(check=>({...check,sourceType:check.sourceType??(file==='national-homepages.json'?'registered_homepage':'discovered_homepage')})):[]);
  return buildAssetInventory(data.clinics,{...data,batches,legacy,crawl:{results}});
}
