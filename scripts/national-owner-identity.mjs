import {currentNaverPlaceObservations,naverPlaceSourceUrl} from './clinic-hours.mjs';

// Only a current, directly identified observation of this exact Place may be
// offered as a reference for later owner-only captures.
export function nationalOwnerIdentity(record,placeId){
  const matches=currentNaverPlaceObservations(record).filter(o=>{
    const url=naverPlaceSourceUrl(o.sourceUrl);
    return o.bodyStatus==='read' && o.identityMatch===true && typeof o.fields?.name==='string' && o.fields.name.trim() &&
      Number.isFinite(Date.parse(o.checkedAt)) && url && new URL(url).pathname.match(/\/(?:hospital|place)\/(\d+)(?:\/|$)/)?.[1]===String(placeId);
  }).toSorted((a,b)=>Date.parse(b.checkedAt)-Date.parse(a.checkedAt));
  const match=matches[0];
  return match?{confirmed:true,naverRecord:{name:match.fields.name,sourceUrl:match.sourceUrl},primarySource:{checkedAt:match.checkedAt,bodyStatus:'read'}}:null;
}
