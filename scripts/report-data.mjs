import { safeWebsite, SOURCE_URL, hoursMinutes, closesAtOrAfter, ctCount } from '../src/shared.mjs';
import { DAYS, WEEKDAYS, percentage } from './common.mjs';

/**
 * Facts about the legal and payment differences between 치과병원 and 치과의원, each with the
 * source read on checkedAt. Nothing here is computed from the HIRA file; the page and the
 * JSON export show the source next to every row. sourceKind 'secondary' rows were not yet
 * compared with the primary 고시 text and are labelled so wherever they are displayed.
 */
/** The quarter-end date after a snapshot date (HIRA files are 03-31, 06-30, 09-30, 12-31 snapshots). */
export function nextQuarterEnd(date) {
  const [y, m] = String(date).split('-').map(Number);
  const q = Math.floor((m - 1) / 3) + 1, ny = q === 4 ? y + 1 : y, nq = q === 4 ? 1 : q + 1;
  return `${ny}-${['03-31', '06-30', '09-30', '12-31'][nq - 1]}`;
}

export const EXTERNAL_FACTS = Object.freeze([
  {
    id: 'medical-service-act-3-2', topic: '법적 구분', title: '의료법 제3조 제2항 (의료기관의 구분)',
    sourceKind: 'primary', sourceTitle: '국가법령정보센터 · 의료법 (법률 제21111호, 시행 2026-11-12)',
    sourceUrl: 'https://www.law.go.kr/lsLinkCommonInfo.do?chrClsCd=010202&lsJoLnkSeq=1032767225', checkedAt: '2026-11-26',
    quote: '의원급 의료기관: 의사, 치과의사 또는 한의사가 주로 외래환자를 대상으로 각각 그 의료행위를 하는 의료기관(의원·치과의원·한의원). 병원급 의료기관: 의사, 치과의사 또는 한의사가 주로 입원환자를 대상으로 의료행위를 하는 의료기관(병원·치과병원·한방병원·요양병원·정신병원·종합병원).',
    dentalHospital: '병원급 의료기관 · 주로 입원환자 대상', dentalClinic: '의원급 의료기관 · 주로 외래환자 대상',
    note: '법령의 분류 기준이며 각 기관의 실제 입원·외래 비중을 뜻하지 않습니다.',
  },
  {
    id: 'medical-service-act-3-2bis', topic: '병상 요건', title: '의료법 제3조의2 (병원등)',
    sourceKind: 'primary', sourceTitle: '국가법령정보센터 · 의료법 제3조의2',
    sourceUrl: 'https://www.law.go.kr/LSW/lsLawLinkInfo.do?chrClsCd=010202&lsJoLnkSeq=1000258963', checkedAt: '2026-11-26',
    quote: '병원ㆍ치과병원ㆍ한방병원 및 요양병원(이하 "병원등"이라 한다)은 30개 이상의 병상(병원ㆍ한방병원만 해당한다) 또는 요양병상(요양병원만 해당하며, 장기입원이 필요한 환자를 대상으로 의료행위를 하기 위하여 설치한 병상을 말한다)을 갖추어야 한다.',
    dentalHospital: '병상 수 요건 없음 (30병상 요건은 병원·한방병원만 해당)', dentalClinic: '해당 없음',
    note: '“30병상 이상이면 치과병원”이라는 설명은 법령 문언과 다릅니다.',
  },
  {
    id: 'nhis-outpatient-copay', topic: '외래 본인부담률 (일반 환자)', title: '요양급여비용 총액 대비 외래 본인일부부담금',
    sourceKind: 'primary', sourceTitle: '국민건강보험공단 · 본인일부부담금 안내 (근거: 국민건강보험법 시행령 제19조 제1항·별표 2)',
    sourceUrl: 'https://www.nhis.or.kr/static/html/wbma/c/wbmac0103.html', checkedAt: '2026-11-26',
    quote: '치과병원: 동지역 요양급여비용 총액의 40%, 읍·면지역 35%. 치과의원: 요양급여비용 총액의 30%.',
    dentalHospital: '동지역 40% · 읍·면지역 35%', dentalClinic: '30%',
    headline: { dentalHospital: '40%', dentalClinic: '30%', note: '치과병원 동지역 기준. 읍·면 35%. 예외 별도' },
    note: '일반 환자 기준입니다. 65세 이상 정액제, 임산부·1세 미만 아동, 의약분업 예외환자 등은 별도 기준이 적용됩니다.',
  },
  {
    id: 'type-surcharge-2024', topic: '요양기관 종별가산율 (건강보험)', title: '2024-01-01 시행 종별가산율 축소',
    sourceKind: 'secondary', sourceTitle: '덴탑정보기술 보험 안내 「2024년 변경된 보험」(2024-01-04) · 보건복지부 고시 제2023-187호 요약',
    sourceUrl: 'https://www.dentop.co.kr/board_Insurance/10050', checkedAt: '2026-11-26',
    quote: '요양기관 종별가산율 15% 축소 (시행일 2024.01.01~): 치과의원 15% → 0%, 치과병원 20% → 5%.',
    dentalHospital: '5% (2023년까지 20%)', dentalClinic: '0% (2023년까지 15%)',
    note: '2차 자료이며 고시 원문과 대조하기 전입니다. 2023년 이전 자료의 “치과병원 20%·치과의원 15%”는 현행 수치가 아닙니다.',
  },
]);

export const DENTAL_HOSPITAL_DEFINITIONS = Object.freeze({
  population: '심평원 종별코드 41(치과병원)과 51(치과의원). 종합병원·상급종합병원의 치과 진료과목은 포함하지 않음',
  specialist: '기본 정보의 치과전문의 인원수. 0 이상의 정수로 기록된 기관만 평균·중앙값·비율의 분모(known)에 포함. 과목별 인원 합계가 아니며 현재 근무 인원이나 진료 실력이 아님',
  cbct: '장비 정보의 콘빔CT 항목 대수 합계. 콘빔CT 항목이 있고 대수가 기록된 기관만 분모에 포함하며, 항목이 없는 기관은 보유하지 않은 것으로 간주하지 않음',
  university: '기관명에 “대학”이 포함된 기관. 명칭 기준 분류이며 대학 부속 여부나 교육·수련 기능을 확인한 것이 아님',
  regions: '원자료의 시도 표기를 그대로 집계. “전남광주” 등 혼재 표기를 현재 행정구역으로 재분류하지 않음',
  opening: '원자료 개설일의 연도. 형식이 다른 값은 미확인으로 둠. 개설일은 현재 운영 여부가 아님',
  specialties: '진료과목 정보에서 해당 과목의 전문의 인원이 1명 이상으로 기록된 기관 수. 과목 표시만 있고 전문의가 0명인 기관은 제외',
  website: '신고 홈페이지 값 중 HTTP(S) 주소 형식 검사를 통과한 기관 수. 실제 운영·공식성은 확인하지 않음',
  hours: '월~일 중 하루 이상 유효한 같은 날 시작·종료 시각이 있는 기관 수. 시간이 없는 기관을 휴진으로 보지 않음',
  comparison: '치과병원과 치과의원의 등록 항목을 같은 정의로 나란히 집계한 것이며 종별 간 우열이나 진료의 질을 평가하지 않음',
});

function distribution(values) {
  const sorted = values.filter(isCount).sort((a, b) => a - b);
  if (!sorted.length) return { known: 0, mean: null, median: null, min: null, max: null };
  const mid = sorted.length / 2;
  return {
    known: sorted.length,
    mean: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length * 100) / 100,
    median: sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2,
    min: sorted[0], max: sorted[sorted.length - 1],
  };
}

// One institution type (41 or 51): registered counts with their own denominators.
function typeProfile(clinics) {
  const total = clinics.length;
  const specialists = clinics.map(clinic => clinic.doctors?.specialist);
  const cbcts = clinics.map(ctCount);
  const specialist = distribution(specialists);
  const cbct = distribution(cbcts);
  return {
    total,
    specialist: {
      ...specialist,
      atLeastOne: metric(total, specialists.filter(value => isCount(value) && value >= 1).length, specialist.known),
      atLeastThree: metric(total, specialists.filter(value => isCount(value) && value >= 3).length, specialist.known),
    },
    cbct: { ...cbct, registered: metric(total, cbcts.filter(value => isCount(value) && value >= 1).length, cbct.known) },
    website: metric(total, clinics.filter(clinic => typeof clinic.website === 'string' && safeWebsite(clinic.website)).length, clinics.filter(clinic => typeof clinic.website === 'string' && clinic.website.trim()).length),
    hours: (() => { const count = clinics.filter(clinic => DAYS.some(day => hasValidHours(clinic.hours?.[day]))).length; return metric(total, count, count); })(),
  };
}

const countBy = (items, keyOf) => {
  const counts = new Map();
  for (const item of items) { const key = keyOf(item); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  return counts;
};
const byCountThenLabel = ([labelA, countA], [labelB, countB]) => countB - countA || labelA.localeCompare(labelB, 'ko');

const OPENING_BUCKETS = Object.freeze([
  { id: 'before2000', label: '1999년 이전', test: year => year <= 1999 },
  { id: '2000s', label: '2000~2009년', test: year => year >= 2000 && year <= 2009 },
  { id: '2010s', label: '2010~2019년', test: year => year >= 2010 && year <= 2019 },
  { id: 'since2020', label: '2020년 이후', test: year => year >= 2020 },
]);

/** Aggregates for every 치과병원 (type 41) with the same definitions applied to 치과의원 (51) for comparison. */
function dentalHospitals(clinics) {
  const hospitals = clinics.filter(clinic => clinic.typeCode === '41');
  const total = hospitals.length;
  const university = hospitals.filter(clinic => String(clinic.name ?? '').includes('대학'));
  const others = hospitals.filter(clinic => !String(clinic.name ?? '').includes('대학'));
  const openingYears = hospitals.map(clinic => { const match = /^(\d{4})-\d{2}-\d{2}$/.exec(String(clinic.openedOn ?? '')); return match ? Number(match[1]) : null; });
  const specialtyNames = new Map(), specialtyCounts = new Map();
  for (const clinic of hospitals) {
    const seen = new Set();
    for (const item of clinic.specialties ?? []) {
      if (!item?.code || seen.has(item.code) || !isCount(item.specialists) || item.specialists < 1) continue;
      seen.add(item.code);
      if (!specialtyNames.has(item.code)) specialtyNames.set(item.code, String(item.name ?? item.code));
      specialtyCounts.set(item.code, (specialtyCounts.get(item.code) ?? 0) + 1);
    }
  }
  return {
    id: 'dental-hospitals', name: '전국 치과병원', total,
    types: { hospital: total, clinic: clinics.length - total },
    hospitals: typeProfile(hospitals),
    clinics: typeProfile(clinics.filter(clinic => clinic.typeCode === '51')),
    university: {
      count: university.length, percentOfTotal: percentage(university.length, total),
      specialist: distribution(university.map(clinic => clinic.doctors?.specialist)),
      others: { count: others.length, specialist: distribution(others.map(clinic => clinic.doctors?.specialist)) },
    },
    regions: [...countBy(hospitals, clinic => clinic.sido)].sort(byCountThenLabel).map(([sido, count]) => ({ sido, count, percentOfTotal: percentage(count, total) })),
    topCities: hospitalDistricts(clinics).units.filter(unit => unit.hospitals > 0).map(unit => [`${unit.sido} ${unit.name}`, unit.hospitals]).sort(byCountThenLabel).slice(0, 5).map(([label, count]) => ({ label, count })),
    opening: [
      ...OPENING_BUCKETS.map(bucket => ({ id: bucket.id, label: bucket.label, count: openingYears.filter(year => year !== null && bucket.test(year)).length })),
      { id: 'unknown', label: '미확인', count: openingYears.filter(year => year === null).length },
    ].map(bucket => ({ ...bucket, percentOfTotal: percentage(bucket.count, total) })),
    specialties: [...specialtyCounts].map(([code, count]) => ({ code, name: specialtyNames.get(code), count, percentOfTotal: percentage(count, total) }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
    definitions: DENTAL_HOSPITAL_DEFINITIONS,
  };
}

/**
 * Cities with 일반구. The source gives every 일반구 its own 시군구코드; the district report counts the city once
 * and merges only the codes listed here. A source code that looks like another 일반구 of these cities is reported
 * in issues, never merged by guesswork.
 */
export const GENERAL_DISTRICT_CITIES = Object.freeze([
  { id: 'bucheon', name: '부천시', sidoCode: '310000', cityCodes: ['310301', '310302', '310303'] },
  { id: 'seongnam', name: '성남시', sidoCode: '310000', cityCodes: ['310401', '310402', '310403'] },
  { id: 'suwon', name: '수원시', sidoCode: '310000', cityCodes: ['310601', '310602', '310603', '310604'] },
  { id: 'anyang', name: '안양시', sidoCode: '310000', cityCodes: ['310701', '310702'] },
  { id: 'ansan', name: '안산시', sidoCode: '310000', cityCodes: ['311101', '311102'] },
  { id: 'goyang', name: '고양시', sidoCode: '310000', cityCodes: ['311901', '311902', '311903'] },
  { id: 'yongin', name: '용인시', sidoCode: '310000', cityCodes: ['312001', '312002', '312003'] },
  { id: 'hwaseong', name: '화성시', sidoCode: '310000', cityCodes: ['312501', '312502', '312503', '312504'] },
  { id: 'cheongju', name: '청주시', sidoCode: '330000', cityCodes: ['330101', '330102', '330103', '330104'] },
  { id: 'cheonan', name: '천안시', sidoCode: '340000', cityCodes: ['340201', '340202'] },
  { id: 'jeonju', name: '전주시', sidoCode: '350000', cityCodes: ['350401', '350402'] },
  { id: 'pohang', name: '포항시', sidoCode: '370000', cityCodes: ['370701', '370702'] },
  { id: 'changwon', name: '창원시', sidoCode: '380000', cityCodes: ['380701', '380702', '380703', '380704', '380705'] },
].map(city => Object.freeze({ ...city, cityCodes: Object.freeze(city.cityCodes) })));

/**
 * Source rows that place the same 구 under a second code pair. They are merged only while the row's 시군구 label
 * equals the stated label; any other row under these codes stays where the source put it.
 */
export const DISTRICT_CODE_ALIASES = Object.freeze([
  { sidoCode: '240000', cityCode: '240001', city: '광주동구', toSidoCode: '360000', toCityCode: '360801' },
  { sidoCode: '240000', cityCode: '240002', city: '광주북구', toSidoCode: '360000', toCityCode: '360802' },
].map(Object.freeze));

export const DISTRICT_DEFINITIONS = Object.freeze({
  population: '심평원 종별코드 41(치과병원)·51(치과의원)이 1곳 이상 등록된 시·군·구. 치과가 한 곳도 등록되지 않은 지역은 집계에 나타나지 않음',
  unit: `원자료 시군구코드마다 1곳으로 세되, 일반구를 둔 ${GENERAL_DISTRICT_CITIES.length}개 시는 명시한 일반구 코드를 시 하나로 합산. 제주시·서귀포시(행정시)와 세종시도 각각 1곳으로 셈`,
  aliases: '광주 동구·북구는 원자료에 시도코드 240000(시군구코드 240001·240002)과 360000(360801·360802) 두 가지로 나타남. 시군구 표기가 같은 행만 360000 쪽으로 합치고 그 밖의 표기는 원문대로 둠',
  kind: '지역명 끝 글자로 구분. 일반구를 합친 시, 세종시, 제주 행정시는 시이고 합치지 않은 구는 자치구',
  coverage: '종별코드 41 기관이 1곳 이상 등록되어 있는지 여부. 치과병원이 없다는 것은 원자료에 41 기관이 없다는 뜻이며 치과 진료를 받을 수 없다는 뜻이 아님',
  concentration: '치과병원이 많은 시·군·구부터 더해 전국 치과병원의 절반 이상이 될 때까지 필요한 최소 지역 수',
  sido: '원자료 시도코드별로 묶고 그 코드에서 가장 많이 쓰인 시도 표기를 이름으로 씀',
  noPopulation: '인구 자료를 결합하지 않았으므로 인구 대비 수치나 접근성 지표는 산출하지 않음',
});

const KIND_LABELS = Object.freeze({ 시: '시 (세종·제주 행정시 포함)', 군: '군', 구: '구 (자치구)' });
const topLabel = counts => [...counts].sort(byCountThenLabel)[0]?.[0] ?? null;
const bump = (counts, label) => { if (label) counts.set(label, (counts.get(label) ?? 0) + 1); };

/** Which 시·군·구 have at least one 치과병원 (type 41), with the 치과의원 (51) count beside every district. */
function hospitalDistricts(clinics) {
  const aliases = new Map(DISTRICT_CODE_ALIASES.map(alias => [`${alias.sidoCode}:${alias.cityCode}`, alias]));
  const generalCodes = new Map(GENERAL_DISTRICT_CITIES.flatMap(city => city.cityCodes.map(code => [`${city.sidoCode}:${code}`, city])));
  const generalPrefixes = new Set(GENERAL_DISTRICT_CITIES.map(city => `${city.sidoCode}:${city.cityCodes[0].slice(0, 4)}`));
  const units = new Map(), aliasRows = new Map(), unlisted = new Map(), codes = new Map(), sidoLabels = new Map();
  let unplaced = 0;
  for (const clinic of clinics) {
    if (!clinic.sidoCode || !clinic.cityCode) { unplaced++; continue; }
    let sidoCode = clinic.sidoCode, cityCode = clinic.cityCode;
    const alias = aliases.get(`${sidoCode}:${cityCode}`);
    if (alias && clinic.city === alias.city) {
      ({ toSidoCode: sidoCode, toCityCode: cityCode } = alias);
      aliasRows.set(alias, (aliasRows.get(alias) ?? 0) + 1);
    }
    const city = generalCodes.get(`${sidoCode}:${cityCode}`);
    if (!city && generalPrefixes.has(`${sidoCode}:${cityCode.slice(0, 4)}`) && String(clinic.city ?? '').endsWith('구')) {
      unlisted.set(`${sidoCode}:${cityCode}`, { sidoCode, cityCode, city: clinic.city });
    }
    const key = city ? `${sidoCode}:${city.id}` : `${sidoCode}:${cityCode}`;
    if (!units.has(key)) units.set(key, { sidoCode, merged: city ?? null, cityCodes: new Set(), sidoLabels: new Map(), cityLabels: new Map(), sources: new Map(), hospitals: 0, clinics: 0 });
    const unit = units.get(key);
    unit.cityCodes.add(cityCode);
    bump(unit.sidoLabels, clinic.sido);
    bump(unit.cityLabels, clinic.city);
    const sourceKey = `${clinic.sidoCode}:${clinic.cityCode}`;
    if (!unit.sources.has(sourceKey)) unit.sources.set(sourceKey, { sidoCode: clinic.sidoCode, cityCode: clinic.cityCode, labels: new Map(), count: 0 });
    const source = unit.sources.get(sourceKey);
    source.count++;
    bump(source.labels, clinic.city);
    if (!sidoLabels.has(sidoCode)) sidoLabels.set(sidoCode, new Map());
    bump(sidoLabels.get(sidoCode), clinic.sido);
    const codeKey = `${sidoCode}:${cityCode}`;
    codes.set(codeKey, (codes.get(codeKey) ?? false) || clinic.typeCode === '41');
    if (clinic.typeCode === '41') unit.hospitals++; else unit.clinics++;
  }

  const list = [...units.values()].map(unit => {
    const cityCodes = [...unit.cityCodes].sort();
    const name = unit.merged?.name ?? topLabel(unit.cityLabels) ?? cityCodes[0];
    return {
      sidoCode: unit.sidoCode, sido: topLabel(unit.sidoLabels) ?? unit.sidoCode, name,
      kind: unit.merged ? '시' : name.endsWith('군') ? '군' : name.endsWith('구') ? '구' : '시',
      cityCodes, merged: Boolean(unit.merged),
      sources: [...unit.sources.values()].sort((a, b) => a.sidoCode.localeCompare(b.sidoCode) || a.cityCode.localeCompare(b.cityCode))
        .map(source => ({ sidoCode: source.sidoCode, cityCode: source.cityCode, city: topLabel(source.labels) ?? source.cityCode, count: source.count })),
      hospitals: unit.hospitals, clinics: unit.clinics, total: unit.hospitals + unit.clinics,
    };
  }).sort((a, b) => a.sidoCode.localeCompare(b.sidoCode) || a.name.localeCompare(b.name, 'ko') || a.cityCodes[0].localeCompare(b.cityCodes[0]));

  const coverage = items => {
    const withHospital = items.filter(unit => unit.hospitals > 0).length;
    return { total: items.length, withHospital, withoutHospital: items.length - withHospital, percentWith: percentage(withHospital, items.length) };
  };
  const hospitals = list.reduce((sum, unit) => sum + unit.hospitals, 0);
  const byHospitals = [...list].sort((a, b) => b.hospitals - a.hospitals || a.sidoCode.localeCompare(b.sidoCode) || a.name.localeCompare(b.name, 'ko'));
  let half = 0, cumulative = 0;
  for (const unit of byHospitals) { if (cumulative * 2 >= hospitals) break; cumulative += unit.hospitals; half++; }
  const without = list.filter(unit => unit.hospitals === 0);
  const withoutClinics = without.map(unit => unit.clinics);
  const sidoCodes = [...new Set(list.map(unit => unit.sidoCode))].sort();
  const codeValues = [...codes.values()];

  return {
    id: 'hospital-districts', name: '전국 시·군·구',
    ...coverage(list), hospitals, clinics: list.reduce((sum, unit) => sum + unit.clinics, 0),
    kinds: ['시', '군', '구'].map(kind => ({ kind, label: KIND_LABELS[kind], ...coverage(list.filter(unit => unit.kind === kind)) })),
    bySido: sidoCodes.map(code => {
      const items = list.filter(unit => unit.sidoCode === code);
      return { sidoCode: code, sido: topLabel(sidoLabels.get(code) ?? new Map()) ?? code, ...coverage(items), hospitals: items.reduce((s, u) => s + u.hospitals, 0), clinics: items.reduce((s, u) => s + u.clinics, 0) };
    }),
    hospitalCountBuckets: [0, 1, 2, 3, 4].map(n => ({ label: n === 4 ? '4곳 이상' : `${n}곳`, min: n, max: n === 4 ? null : n, units: list.filter(unit => n === 4 ? unit.hospitals >= 4 : unit.hospitals === n).length })),
    concentration: { units: hospitals ? half : null, hospitals: hospitals ? cumulative : 0, percentOfHospitals: percentage(cumulative, hospitals) },
    withoutHospitalClinics: { units: without.length, clinics: withoutClinics.reduce((sum, n) => sum + n, 0), minClinics: withoutClinics.length ? Math.min(...withoutClinics) : null, maxClinics: withoutClinics.length ? Math.max(...withoutClinics) : null },
    gunWithHospital: list.filter(unit => unit.kind === '군' && unit.hospitals > 0).map(unit => ({ sido: unit.sido, name: unit.name, hospitals: unit.hospitals })),
    manyHospitals: byHospitals.filter(unit => unit.hospitals >= 4).map(unit => ({ sidoCode: unit.sidoCode, sido: unit.sido, name: unit.name, kind: unit.kind, hospitals: unit.hospitals, clinics: unit.clinics })),
    codeLevel: { total: codeValues.length, withHospital: codeValues.filter(Boolean).length, withoutHospital: codeValues.filter(value => !value).length, percentWith: percentage(codeValues.filter(Boolean).length, codeValues.length) },
    aliasesApplied: [...aliasRows].sort(([a], [b]) => a.cityCode.localeCompare(b.cityCode)).map(([alias, rows]) => ({ from: `${alias.sidoCode}/${alias.cityCode}`, to: `${alias.toSidoCode}/${alias.toCityCode}`, city: alias.city, rows })),
    issues: [
      ...[...unlisted.values()].map(item => ({ kind: 'unlisted-general-district', ...item, note: '일반구를 둔 시의 코드 체계와 같지만 합산 목록에 없는 코드입니다. 추정해 합치지 않고 별도 지역으로 셌습니다.' })),
      ...(unplaced ? [{ kind: 'unplaced', rows: unplaced, note: '시도·시군구코드가 없어 지역에 넣지 못한 행입니다.' }] : []),
    ],
    units: list,
    groupingNote: `원자료 시군구코드 단위. 일반구를 둔 ${GENERAL_DISTRICT_CITIES.length}개 시는 명시한 일반구 코드만 합산하고, 광주 동구·북구의 시도코드 240000 행(240001·240002)은 시군구 표기가 같아 360000의 360801·360802와 합침. 그 밖의 지역 표기는 원문대로 둠`,
    definitions: DISTRICT_DEFINITIONS,
  };
}

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

// hoursMinutes (src/shared.mjs) treats 00:00 as an unprovided source value, not an opening time.
export function hasValidHours(hours) {
  const open = hoursMinutes(hours?.open), close = hoursMinutes(hours?.close);
  return open !== null && close !== null && close > open;
}

const isCount = value => Number.isSafeInteger(value) && value >= 0;

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
    if (WEEKDAYS.some(day => closesAtOrAfter(clinic.hours?.[day], '19:00'))) counts.night++;
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
 * northernGyeonggi (with 10 cities), dentalHospitals, hospitalDistricts (per 시·군·구 41/51 counts;
 * district names are places, not institutions), and source-code regionIssues.
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
      id: 'northern-gyeonggi', name: `경기북부 ${cities.length}개 시·군`, sidoCode: '310000',
      groupingNote: '원자료 경기 시도코드와 명시한 시군구코드를 함께 적용. 고양시는 덕양구·일산서구·일산동구를 합산. 그 밖의 지역은 추정해 포함하지 않음',
      ...summarize(northern), cities,
    },
    dentalHospitals: dentalHospitals(clinics),
    hospitalDistricts: hospitalDistricts(clinics),
    externalFacts: EXTERNAL_FACTS,
    regionIssues: regionIssues(clinics),
  };
}
