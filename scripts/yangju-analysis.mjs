import { hasValidHours } from './report-data.mjs';
import { latestNaverHours } from './clinic-hours.mjs';
import { SOURCE_URL } from '../src/shared.mjs';

export const YANGJU_REPORT_ROUTE = '/reports/yangju-hours-evidence/';
const days = [['mon', '월요일'], ['tue', '화요일'], ['wed', '수요일'], ['thu', '목요일'], ['fri', '금요일'], ['sat', '토요일'], ['sun', '일요일']];
const weekday = day => !['sat', 'sun'].includes(day);
const percentage = (count, total) => total ? Math.round(count / total * 1000) / 10 : null;

export function buildYangjuAnalysis(clinics, inventory, { snapshotDate, observedAt, sourceSha256 }) {
  const selected = clinics.filter(c => c.sidoCode === '310000' && c.cityCode === '312700' && ['41', '51'].includes(c.typeCode));
  if (new Set(selected.map(c => c.id)).size !== selected.length) throw new Error('Duplicate HIRA identity in Yangju population.');
  const records = new Map((inventory?.records ?? []).map(record => [record.clinicId, record]));
  const total = selected.length, byDong = new Map();
  const coverage = { both: 0, registeredOnly: 0, naverOnly: 0, neither: 0 };
  const evidence = [];
  let registered = 0, registeredNight = 0;
  for (const clinic of selected) {
    const dong = typeof clinic.dong === 'string' && clinic.dong.trim() ? clinic.dong : '읍면동 미표기';
    if (!byDong.has(dong)) byDong.set(dong, { name: dong, total: 0, registeredHours: 0, registeredNight: 0, naverHours: 0 });
    const row = byDong.get(dong);
    row.total++;
    const hasRegistered = days.some(([day]) => hasValidHours(clinic.hours?.[day]));
    const night = days.some(([day]) => weekday(day) && hasValidHours(clinic.hours?.[day]) && clinic.hours[day].close >= '19:00');
    const naver = latestNaverHours(records.get(clinic.id));
    if (hasRegistered) { registered++; row.registeredHours++; }
    if (night) { registeredNight++; row.registeredNight++; }
    if (naver) {
      row.naverHours++;
      evidence.push({ clinicId: clinic.id, checkedAt: naver.checkedAt, sourceUrl: naver.url });
    }
    coverage[hasRegistered ? (naver ? 'both' : 'registeredOnly') : (naver ? 'naverOnly' : 'neither')]++;
  }
  const weekdays = days.map(([day, label]) => {
    const valid = selected.filter(clinic => hasValidHours(clinic.hours?.[day]));
    return { day, label, total, registered: valid.length, missing: total - valid.length,
      weekdayNineteenOrLater: weekday(day) ? valid.filter(clinic => clinic.hours[day].close >= '19:00').length : null };
  });
  const checked = evidence.map(row => row.checkedAt).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    schemaVersion: 1, snapshotDate, observedAt, sourceSha256, sourceUrl: SOURCE_URL,
    scope: { name: '양주시', sidoCode: '310000', cityCode: '312700', total,
      clinic: selected.filter(c => c.typeCode === '51').length, hospital: selected.filter(c => c.typeCode === '41').length },
    registered: { hours: registered, missing: total - registered, night: registeredNight,
      hoursPercentOfTotal: percentage(registered, total), nightPercentOfTotal: percentage(registeredNight, total) },
    byDong: [...byDong.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    weekdays,
    naver: { available: inventory != null, hours: evidence.length, percentOfTotal: percentage(evidence.length, total),
      earliestCheckedAt: checked[0] ?? null, latestCheckedAt: checked.at(-1) ?? null,
      policy: 'latestNaverHours: 현재 정정 이력을 통과한 동일 Place의 본문 읽음·기관 식별 일치·시간 원문·유효한 관찰시각을 모두 충족한 최신 관찰만 사용. 시간 원문을 주간 일정이나 야간 운영으로 재해석하지 않음.' },
    coverage, evidence: evidence.sort((a, b) => a.clinicId.localeCompare(b.clinicId)),
    interpretation: '두 출처의 시간 정보 수록 여부 비교이며 시간표 일치율·정확도·현재 운영 확인 비율이 아님. 네이버 미확인은 안내 부재를 뜻하지 않음. 읍면동은 원자료 표기로 묶고 주소에서 추정하지 않음.',
  };
}
