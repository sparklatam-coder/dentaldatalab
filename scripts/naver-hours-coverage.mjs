import { latestNaverHours, currentNaverPlaceObservations, naverPlaceSourceUrl as actualPlaceUrl } from './clinic-hours.mjs';

export const NAVER_HOURS_STAGES = Object.freeze({
  hours_available: '네이버 시간 확보',
  hours_missing: '기관 대조 완료 · 시간 확인 필요',
  identity_review: '기관 식별 검토 필요',
  access_failed: '본문 접근 실패',
  place_ready: '네이버 장소 URL 확보',
  place_discovery: '네이버 장소 URL 탐색 필요',
});

const nextActions = Object.freeze({
  hours_available: 'periodic_recheck',
  hours_missing: 'check_hours_in_place',
  identity_review: 'verify_place_identity',
  access_failed: 'retry_public_place_access',
  place_ready: 'read_place_and_verify_identity',
  place_discovery: 'find_place_and_verify_identity',
});
const failedStatuses = new Set(['blocked', 'failed', 'error']);
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const validDate = value => hasText(value) && Number.isFinite(Date.parse(value));

function newestDate(items) {
  return items.map(item => item.checkedAt).filter(validDate)
    .toSorted((a, b) => Date.parse(b) - Date.parse(a) || a.localeCompare(b))[0] ?? null;
}

/** Convenience search only: never a discovered asset, observation, or source. */
export function safeGeneratedSearchUrl(clinic) {
  if (!hasText(clinic?.name)) return null;
  const address = typeof clinic.address === 'string' ? clinic.address : '';
  const road = address.match(/([가-힣A-Za-z0-9·]+(?:대로|로|길))\s*(\d+(?:-\d+)?)/)?.slice(1).join(' ')
    ?? address.split(',')[0].trim();
  const query = [clinic.city, clinic.name, road].filter(hasText).join(' ').replace(/\s+/g, ' ').trim();
  try { return 'https://map.naver.com/p/search/' + encodeURIComponent(query); }
  catch { return null; }
}

function emptySummary() {
  return { total: 0, byStage: Object.fromEntries(Object.keys(NAVER_HOURS_STAGES).map(stage => [stage, 0])), naverHoursAvailable: 0, pending: 0 };
}

function addToSummary(summary, stage) {
  summary.total++;
  summary.byStage[stage]++;
  if (stage === 'hours_available') summary.naverHoursAvailable++;
  else summary.pending++;
}

/**
 * Pure nationwide coverage view. The public clinic list supplies all identities;
 * only inventory observations supply Naver hours. No I/O, clock, URL discovery,
 * inferred schedule, or mutation takes place here.
 *
 * An older valid successful observation survives later failed access. "Available"
 * means observed text exists, not that all seven days or current hours are known.
 * checkedAt dates the evidence for the selected stage, not the queue generation.
 */
export function buildNaverHoursCoverage(clinics, inventory = {}) {
  if (!Array.isArray(clinics)) throw new TypeError('clinics must be an array');
  const byId = new Map();
  for (const record of inventory?.records ?? []) {
    if (byId.has(record.clinicId)) throw new Error('Duplicate inventory clinicId: ' + record.clinicId);
    byId.set(record.clinicId, record);
  }
  const ids = new Set();
  const records = clinics.map(clinic => {
    if (!hasText(clinic.id) || ids.has(clinic.id)) throw new Error('Missing or duplicate clinic id: ' + clinic.id);
    ids.add(clinic.id);
    const record = byId.get(clinic.id);
    const observations = currentNaverPlaceObservations(record);
    const places = (record?.assets ?? []).flatMap(asset => {
      const url = asset.kind === 'naverMap' && asset.ownership !== 'third_party' ? actualPlaceUrl(asset.url) : null;
      return url ? [{ ...asset, url }] : [];
    });
    const readObservations = observations.filter(observation => observation.bodyStatus === 'read');
    const read = [...readObservations, ...places.filter(asset => asset.bodyStatus === 'read')];
    const matched = readObservations.filter(observation => observation.identityMatch === true);
    const failed = [...observations, ...places].filter(item => failedStatuses.has(item.bodyStatus));
    const hours = latestNaverHours(record);
    const stage = hours ? 'hours_available'
      : matched.length ? 'hours_missing'
      : read.length ? 'identity_review'
      : failed.length ? 'access_failed'
      : places.length || observations.length ? 'place_ready'
      : 'place_discovery';
    const checkedAt = hours?.checkedAt ?? newestDate(
      stage === 'hours_missing' ? matched : stage === 'identity_review' ? read
        : stage === 'access_failed' ? failed : [...places, ...observations],
    );
    const searchUrl = safeGeneratedSearchUrl(clinic);
    return {
      clinicId: clinic.id, name: clinic.name, typeCode: clinic.typeCode,
      sidoCode: clinic.sidoCode ?? null, sido: clinic.sido ?? null,
      cityCode: clinic.cityCode ?? null, city: clinic.city ?? null,
      address: clinic.address ?? null, phone: clinic.phone ?? null,
      stage, nextAction: nextActions[stage], checkedAt,
      sourceUrls: [...new Set([...observations.map(observation => observation.sourceUrl), ...places.map(asset => asset.url)])].sort(),
      hours,
      searchUrl, searchUrlLabel: searchUrl ? '네이버지도 검색 · 자동 생성, 기관 미확인' : null,
    };
  });
  const summary = emptySummary(), regionsByKey = new Map();
  for (const record of records) {
    addToSummary(summary, record.stage);
    const key = JSON.stringify([record.sidoCode ?? record.sido, record.cityCode ?? record.city]);
    if (!regionsByKey.has(key)) regionsByKey.set(key, {
      sidoCode: record.sidoCode, sido: record.sido, cityCode: record.cityCode, city: record.city, ...emptySummary(),
    });
    addToSummary(regionsByKey.get(key), record.stage);
  }
  const regions = [...regionsByKey.values()].sort((a, b) =>
    String(a.sidoCode ?? a.sido ?? '').localeCompare(String(b.sidoCode ?? b.sido ?? ''), 'ko')
    || String(a.cityCode ?? a.city ?? '').localeCompare(String(b.cityCode ?? b.city ?? ''), 'ko'));
  return { schemaVersion: 1, snapshotDate: inventory?.snapshotDate ?? null, checkedAt: newestDate(records), summary, regions, records };
}
