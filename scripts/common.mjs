// Server-side helpers shared by the build, importers and audits.
// Node built-ins only; nothing here reads files, the clock or the network.
import {DAY_LABELS} from '../src/shared.mjs';

/** HIRA weekday keys in source order; the labels live in src/shared.mjs DAY_LABELS. */
export const DAYS=Object.freeze(['mon','tue','wed','thu','fri','sat','sun']);
export const WEEKDAYS=Object.freeze(DAYS.slice(0,5));
/** [key, Korean label] pairs for importers and per-day tables. */
export const DAY_PAIRS=Object.freeze(DAYS.map(day=>Object.freeze([day,DAY_LABELS[day]])));

/** The only HIRA institution types this project includes. Look up with Object.hasOwn, never a bare index. */
export const DENTAL_TYPES=Object.freeze({'41':'치과병원','51':'치과의원'});
export const dentalType=code=>Object.hasOwn(DENTAL_TYPES,code)?DENTAL_TYPES[code]:null;

/** Share of a denominator rounded to one decimal; an empty denominator is null, never 0%. */
export const percentage=(count,denominator)=>denominator?Math.round(count/denominator*1000)/10:null;

export const hasText=value=>typeof value==='string'&&value.trim().length>0;

const ISO_TIMESTAMP=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE=/^\d{4}-\d{2}-\d{2}$/;
const daysInMonth=(year,month)=>new Date(Date.UTC(year,month,0)).getUTCDate();

/** Explicit ISO-8601 timestamp with seconds and a timezone that Date.parse accepts. Calendar validity is checked separately. */
export const isIsoTimestampShape=value=>typeof value==='string'&&ISO_TIMESTAMP.test(value)&&Number.isFinite(Date.parse(value));
/** Date.parse rolls 2026-02-31 over to March, so the written fields are checked on their own. */
export function isCalendarValid(value){
  if(typeof value!=='string')return false;
  const [year,month,day,hour=0,minute=0,second=0]=value.slice(0,19).split(/[-T:]/).map(Number);
  return month>=1&&month<=12&&day>=1&&day<=daysInMonth(year,month)&&hour<24&&minute<60&&second<60;
}
/** Strict timestamp: shape, parseable and a real calendar date-time. */
export const isIsoTimestamp=value=>isIsoTimestampShape(value)&&isCalendarValid(value);
/** Strict YYYY-MM-DD that names a real calendar day. */
export const isIsoDate=value=>typeof value==='string'&&ISO_DATE.test(value)&&isCalendarValid(value)&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
