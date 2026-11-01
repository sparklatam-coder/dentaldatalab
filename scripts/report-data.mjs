import { safeWebsite, SOURCE_URL } from '../src/shared.mjs';

/** Explicit HIRA source-code scope, not a guess from institution names/addresses. */
export const NORTHERN_GYEONGGI_CITIES = Object.freeze([
  { id: 'gapyeong', name: '가평군', cityCodes: ['310001'] },
  { id: 'goyang', name: '고양시', cityCodes: ['311901', '311902', '311903'] },
  { id: 'guri', name: '구리시', cityCodes: ['311000'] },
  { id: 'namyangju', name: '남양주시', cityCodes: ['311500'] },
  { id: 'dongducheon', name: '동두천시', cityCodes: ['310200'] },
  { id: 'yangju', name: '양주시', cityCodes: ['312700'] },
  { id: 'yeoncheon', name: '연천군', cityCodes: ['310011'] },
  { id: 'uijeongbu', name: '의정부시', cityCodes: ['310800'] },
  { id: 'paju', name: '파주시', cityCodes: ['312200'] },
  { id: 'pocheon', name: '포천시', cityCodes: ['312800'] },
].map(city => Object.freeze({ ...city, cityCodes: Object.freeze(city.cityCodes) })));

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DAYS = [...WEEKDAYS, 'sat', 'sun'];

function minutes(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  // The importer treats 00:00 as an unprovided source value, not an opening time.
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0) || (hour === 0 && minute === 0)) return null;
  return hour * 60 + minute;
}

export function hasValidHours(hours) {
  const open = minutes(hours?.open), close = minutes(hours?.close);
  return open !== null && close !== null && close > open;
}

const isCount = value => Number.isSafeInteger(value) && value >= 0;
const percentage = (count, denominator) => denominator ? Math.round(count / denominator * 1000) / 10 : null;

function metric(total, count, known) {
  return {
    count, known, unknown: total - known, total,
    percentOfTotal: percentage(count, total),
    percentOfKnown: percentage(count, known),
  };
}

export const REPORT_DEFINITIONS = Object.freeze({
  specialist: {
    label: '전문의 1명 이상 등록',
    countDefinition: '병원정보 파일의 치과전문의 인원수가 1명 이상인 기관 수',
    knownDefinition: '치과전문의 인원수가 0 이상의 정수로 확인되는 기관 수. 명시된 0명 포함',
    limitation: '과목별 전문의 합계를 사용하지 않으며 현재 근무 인원이나 진료 실력을 뜻하지 않습니다.',
  },
  hours: {
    label: '진료시간 자료 수록',
    countDefinition: '월~일 중 하루 이상 유효한 같은 날 시작·종료 시각이 있는 기관 수',
    knownDefinition: 'count와 같음. 유효 시간 수록 여부를 세는 지표',
    limitation: '시간이 없는 기관을 휴진 또는 미운영으로 분류하지 않습니다.',
  },
  night: {
    label: '평일 19시 이후 종료 등록',
    countDefinition: '월~금 중 유효한 시작·종료 시각이 있고 종료가 19:00 이상인 날이 한 번 이상 있는 기관 수',
    knownDefinition: '월~금 중 하루 이상 유효한 시작·종료 시각이 있는 기관 수',
    limitation: '일부 요일만 수록될 수 있습니다. 조건 미일치는 야간 진료가 없음을 뜻하지 않으며 실제 운영 비율이 아닙니다.',
  },
  saturday: {
    label: '토요일 시간 등록',
    countDefinition: '유효한 토요일 시작·종료 시각이 있는 기관 수',
    knownDefinition: 'count와 같음. 토요일 시간 수록 여부를 세는 지표',
    limitation: '미수록 기관을 토요일 휴진으로 보지 않으며 현재 토요일 진료 여부는 확인하지 않았습니다.',
  },
  sunday: {
    label: '일요일 시간 등록',
    countDefinition: '유효한 일요일 시작·종료 시각이 있는 기관 수',
    knownDefinition: 'count와 같음. 일요일 시간 수록 여부를 세는 지표',
    limitation: '미수록 기관을 일요일 휴진으로 보지 않으며 현재 일요일 진료 여부는 확인하지 않았습니다.',
  },
  website: {
    label: '홈페이지 URL 형식 유효',
    countDefinition: '신고 홈페이지 값 중 HTTP(S) 주소 형식 검사를 통과한 기관 수',
    knownDefinition: '신고 홈페이지 원문이 비어 있지 않은 기관 수. 형식 불완전 값 포함',
    limitation: '실제 홈페이지 운영·공식성·최신성이나 디지털 대응 수준을 확인한 수가 아닙니다.',
  },
});

function summarize(clinics) {
  const total = clinics.length;
  const counts = { specialist: 0, specialistKnown: 0, hours: 0, weekdaysKnown: 0, night: 0, saturday: 0, sunday: 0, website: 0, websiteKnown: 0 };
  const types = { clinic: 0, hospital: 0 };
  for (const clinic of clinics) {
    if (clinic.typeCode === '51') types.clinic++;
    if (clinic.typeCode === '41') types.hospital++;
    const specialist = clinic.doctors?.specialist;
    if (isCount(specialist)) {
      counts.specialistKnown++;
      if (specialist > 0) counts.specialist++;
    }
    if (DAYS.some(day => hasValidHours(clinic.hours?.[day]))) counts.hours++;
    if (WEEKDAYS.some(day => hasValidHours(clinic.hours?.[day]))) counts.weekdaysKnown++;
    if (WEEKDAYS.some(day => hasValidHours(clinic.hours?.[day]) && minutes(clinic.hours[day].close) >= 19 * 60)) counts.night++;
    if (hasValidHours(clinic.hours?.sat)) counts.saturday++;
    if (hasValidHours(clinic.hours?.sun)) counts.sunday++;
    if (typeof clinic.website === 'string' && clinic.website.trim()) counts.websiteKnown++;
    if (typeof clinic.website === 'string' && safeWebsite(clinic.website)) counts.website++;
  }
  return {
    total, types,
    metrics: {
      specialist: metric(total, counts.specialist, counts.specialistKnown),
      hours: metric(total, counts.hours, counts.hours),
      night: metric(total, counts.night, counts.weekdaysKnown),
      saturday: metric(total, counts.saturday, counts.saturday),
      sunday: metric(total, counts.sunday, counts.sunday),
      website: metric(total, counts.website, counts.websiteKnown),
    },
  };
}

function regionIssues(clinics) {
  const groups = new Map();
  for (const clinic of clinics) {
    if (!clinic.sidoCode || !clinic.sido) continue;
    if (!groups.has(clinic.sidoCode)) groups.set(clinic.sidoCode, new Map());
    const labels = groups.get(clinic.sidoCode);
    labels.set(clinic.sido, (labels.get(clinic.sido) ?? 0) + 1);
  }
  return [...groups].filter(([, labels]) => labels.size > 1).sort(([a], [b]) => a.localeCompare(b)).map(([code, labels]) => ({
    level: 'sido', code,
    labels: [...labels].sort(([a], [b]) => a.localeCompare(b, 'ko')).map(([name, count]) => ({ name, count })),
    total: [...labels.values()].reduce((sum, count) => sum + count, 0),
    note: '동일 원자료 시도코드에 여러 명칭이 있습니다. 원문을 보존하며 현재 행정구역으로 임의 재분류하지 않습니다.',
  }));
}

/**
 * Pure aggregate export, containing no institution names or individual records.
 * @param {Array<object>} clinics normalized HIRA institutions, types 41/51 only
 * @param {{snapshotDate:string, observedAt:string, sourceSha256:string}} metadata
 * @returns {object} schemaVersion, source metadata, definitions, national,
 * northernGyeonggi (with 10 cities), and source-code regionIssues.
 * Each metric: count, known, unknown, total, percentOfTotal, percentOfKnown.
 * known means the metric-specific recorded-data denominator (see definitions),
 * never independently verified current operating status. Empty denominators yield null.
 * For hours/saturday/sunday, count === known; only percentOfTotal is useful to display.
 */
export function collectReports(clinics, { snapshotDate, observedAt, sourceSha256 }) {
  if (!Array.isArray(clinics)) throw new TypeError('clinics must be an array');
  if (clinics.some(clinic => !clinic || !['41', '51'].includes(clinic.typeCode))) {
    throw new TypeError('Reports accept only HIRA dental types 41 and 51');
  }
  const cities = NORTHERN_GYEONGGI_CITIES.map(city => ({
    ...city,
    ...summarize(clinics.filter(clinic => clinic.sidoCode === '310000' && city.cityCodes.includes(clinic.cityCode))),
  }));
  const northernCodes = new Set(NORTHERN_GYEONGGI_CITIES.flatMap(city => city.cityCodes));
  const northern = clinics.filter(clinic => clinic.sidoCode === '310000' && northernCodes.has(clinic.cityCode));
  return {
    schemaVersion: 1,
    snapshotDate, observedAt, sourceSha256,
    sourceUrl: SOURCE_URL,
    attribution: '출처: 건강보험심사평가원, 공공데이터포털 「전국 병의원 및 약국 현황」',
    population: '종별코드 41 치과병원·51 치과의원. 종합병원 등의 치과 진료과목은 제외',
    percentageNote: '소수 첫째 자리 반올림. 모든 비율은 등록 자료 집계이며 실제 진료·운영 비율이 아님. 분모가 0이면 null',
    definitions: REPORT_DEFINITIONS,
    national: { id: 'national', name: '전국', ...summarize(clinics) },
    northernGyeonggi: {
      id: 'northern-gyeonggi', name: '경기북부 10개 시·군', sidoCode: '310000',
      groupingNote: '원자료 경기 시도코드와 명시한 시군구코드를 함께 적용. 고양시는 덕양구·일산서구·일산동구를 합산. 그 밖의 지역은 추정해 포함하지 않음',
      ...summarize(northern), cities,
    },
    regionIssues: regionIssues(clinics),
  };
}
