// Dental-hospital (종별코드 41) institution profile: the answer-first summary, the registered-specialty sentence,
// regional counts, the update ledger, the hospital-confirmed panel and the JSON-LD extras.
// 치과의원 (51) pages get nothing from this module: every entry point returns an empty value for them.
// Pure functions: no file, clock or network access. The build passes the parsed data files in.
// Every statement is the public record, a dated inventory check or a dated hospital confirmation. Nothing here
// ranks, recommends or compares institutions, and an unknown value is '자료 미확인', never 0.
import {esc, fmt, icon, localDate, singlePhone, hoursMinutes, DAY_LABELS} from '../src/shared.mjs';
import {externalLink, externalUrl} from './html.mjs';
import {DAYS, hasText, isIsoDate} from './common.mjs';
import {isDentalHospital, topicParticle, specialtyGroups} from './hospital-content.mjs';
import {mailtoLink} from './site-operations.mjs';
import {assetUrl, detectKind, channelFromHref} from './clinic-assets.mjs';

const UNKNOWN = '자료 미확인';
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const EMPTY = Object.freeze({lead: '', tail: '', schema: Object.freeze({})});

// ---------- 1. answer-first summary ----------
/** One or two sentences built only from the record, plus the registered-count caveat. null for non-41. */
export function hospitalSummary(c, {snapshot, ctCount = null} = {}) {
  if (!isDentalHospital(c)) return null;
  const location = [...new Set([c.sido, c.city, c.dong].filter(hasText))].join(' ');
  const specialist = c.doctors?.specialist, sp = isCount(specialist), ct = isCount(ctCount);
  const counts = sp && ct
    ? (specialist > 0 && ctCount > 0 ? `치과전문의 ${fmt(specialist)}명과 콘빔CT ${fmt(ctCount)}대가 등록돼 있고` : `치과전문의 ${fmt(specialist)}명, 콘빔CT ${fmt(ctCount)}대로 등록돼 있고`)
    : sp ? `치과전문의 ${fmt(specialist)}명으로 등록돼 있고 콘빔CT 등록 수는 ${UNKNOWN}이며`
    : ct ? `콘빔CT ${fmt(ctCount)}대로 등록돼 있고 치과전문의 등록 수는 ${UNKNOWN}이며`
    : `치과전문의와 콘빔CT 등록 수는 ${UNKNOWN}이며`;
  const sentences = [
    `${c.name}${topicParticle(c.name)} ${location ? location + '에 있는 ' : ''}치과병원(종별코드 41)입니다.`,
    `건강보험심사평가원 ${snapshot} 자료 기준 ${counts}, 신고 개설일은 ${hasText(c.openedOn) ? c.openedOn : UNKNOWN}입니다.`,
  ];
  return {
    sentences, text: sentences.join(' '),
    caveat: '등록 수는 신고된 값이며 현재 근무 인력이나 진료 실력을 뜻하지 않습니다. 신고 개설일은 법인·종별 변경 때 바뀔 수 있어 실제 첫 개원일과 다를 수 있습니다.',
  };
}

// ---------- 2. registered 진료과목 ----------
/** Which registered 진료과목 have a registered specialist and which are registered with 0. The table itself stays in #staff. */
export function hospitalSpecialtySentence(c) {
  if (!isDentalHospital(c)) return null;
  const g = specialtyGroups(c);
  if (!g.total) return {text: '진료과목 자료 미확인. 해당 진료를 하지 않는다는 뜻은 아닙니다.', caveat: '', groups: g};
  const withList = g.withSpecialists.map(s => `${s.name}(${fmt(s.specialists)}명)`).join('·');
  const zeroList = g.zero.length ? `${g.zero.join('·')}${topicParticle(g.zero.at(-1))} 전문의 0명으로 등록돼 있습니다.` : '';
  const parts = [`등록 진료과목은 ${fmt(g.total)}개입니다.`];
  if (g.withSpecialists.length) parts.push(`전문의가 1명 이상 등록된 과목은 ${withList}${zeroList ? '이고, ' + zeroList : '입니다.'}`);
  else parts.push(`전문의가 1명 이상 등록된 과목은 없습니다.${zeroList ? ' ' + zeroList : ''}`);
  if (g.unknown.length) parts.push(`${g.unknown.join('·')}의 전문의 수는 ${UNKNOWN}입니다.`);
  const caveat = [
    g.zero.length ? '0명은 이 자료의 해당 항목에 0으로 등록된 상태입니다. 현재의 전문의 부재를 별도로 검증한 결과가 아닙니다.' : '',
    '인력 수는 치료 성과·경력·현재 담당 의료진을 보증하지 않습니다.',
    c.quality?.specialtyCountDiscrepancy ? '전체 치과전문의 수와 과목별 합계는 중복 자격·등록 기준 차이로 다를 수 있어 합산하지 않습니다.' : '',
  ].filter(Boolean).join(' ');
  return {text: parts.join(' '), caveat, groups: g};
}

// ---------- 3. regional context ----------
/** One pass over the clinics array: 치과병원 counts per source 시도코드 and per 시도코드/시군구코드. */
export function hospitalRegionCounts(clinics) {
  const sido = new Map(), city = new Map();
  let total = 0;
  for (const c of clinics) {
    if (!isDentalHospital(c)) continue;
    total++;
    sido.set(c.sidoCode, (sido.get(c.sidoCode) ?? 0) + 1);
    const key = `${c.sidoCode}/${c.cityCode}`;
    city.set(key, (city.get(key) ?? 0) + 1);
  }
  return {total, sido, city};
}

/** Counts only: how many 치과병원 share this institution's 시군구 and 시도 code. No order, share or comparison. */
export function hospitalRegionContext(c, counts) {
  if (!isDentalHospital(c)) return null;
  const sidoCount = counts?.sido.get(c.sidoCode), cityCount = counts?.city.get(`${c.sidoCode}/${c.cityCode}`);
  if (!isCount(sidoCount) || !isCount(cityCount)) return null;
  const text = c.city === c.sido
    ? `원자료 지역 코드 기준으로 이 기관을 포함해 ${c.sido}에 치과병원 ${fmt(sidoCount)}곳이 등록돼 있습니다.`
    : `원자료 지역 코드 기준으로 이 기관을 포함해 ${c.city}에 치과병원 ${fmt(cityCount)}곳, ${c.sido}에 ${fmt(sidoCount)}곳이 등록돼 있습니다.`;
  return {sidoCount, cityCount, text, hospitalsHref: `/hospitals/${c.sidoCode}/`, districtHref: `/regions/${c.sidoCode}/${c.cityCode}/`};
}

// ---------- 5. hospital-confirmed information ----------
export const CONFIRMATION_CHANNELS = Object.freeze({email: '이메일', phone: '전화', document: '서면'});
export const CONFIRMABLE_FIELDS = Object.freeze({phone: '전화번호', website: '홈페이지', bookingUrl: '예약 주소', hours: '진료시간', closedNote: '휴진 안내'});
// A department or desk, never a person: a single Hangul word that ends in a unit suffix. Titles (원장·실장·팀장) name one person and fail.
const ROLE = /^[가-힣]{0,10}(?:과|팀|실|부|센터|데스크|담당|담당자)$/;
// closedNote is the only free text a hospital can add, so advertising vocabulary is refused outright (의료법 제56조).
const PROMOTIONAL = /최고|최초|유일|1위|일등|명의|추천|할인|이벤트|특가|무료|보장|완치|만족|첨단|최신|저렴|전문(?!의)/;
const plainLine = (value, max) => typeof value === 'string' && value === value.trim() && value.length >= 1 && value.length <= max && !/[\r\n\t<>]/.test(value) && !/@|:\/\//.test(value);
const hasPhoneNumber = value => /\d{2,4}[- .]\d{3,4}[- .]\d{4}/.test(value);
const onlyKeys = (value, allowed, where) => { for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${where}: unexpected key "${key}"`); };
const confirmedUrl = value => typeof value === 'string' && /^https?:\/\//i.test(value) && value === value.trim() && Boolean(assetUrl(value));

function validateConfirmedFields(fields, where) {
  if (!isPlainObject(fields)) throw new Error(`${where}: fields must be an object`);
  onlyKeys(fields, Object.keys(CONFIRMABLE_FIELDS), where + '.fields');
  if (!Object.keys(fields).length) throw new Error(`${where}: fields must confirm at least one item`);
  if ('phone' in fields && (typeof fields.phone !== 'string' || !singlePhone(fields.phone))) throw new Error(`${where}: phone must be one dialable number`);
  for (const key of ['website', 'bookingUrl']) if (key in fields && !confirmedUrl(fields[key])) throw new Error(`${where}: ${key} must be an absolute public http(s) URL`);
  if ('hours' in fields) {
    if (!isPlainObject(fields.hours) || !Object.keys(fields.hours).length) throw new Error(`${where}: hours must list at least one day`);
    onlyKeys(fields.hours, DAYS, where + '.fields.hours');
    for (const [day, h] of Object.entries(fields.hours)) {
      if (!isPlainObject(h)) throw new Error(`${where}: hours.${day} must be {open, close}`);
      onlyKeys(h, ['open', 'close'], `${where}.fields.hours.${day}`);
      const open = hoursMinutes(h.open), close = hoursMinutes(h.close);
      if (open === null || close === null || close <= open) throw new Error(`${where}: hours.${day} needs HH:MM open before close`);
    }
  }
  if ('closedNote' in fields && (!plainLine(fields.closedNote, 120) || PROMOTIONAL.test(fields.closedNote))) throw new Error(`${where}: closedNote must be one factual line of at most 120 characters`);
}

/**
 * Strict reader for data/content/hospital-confirmed.json. Anything unexpected throws, so a typo cannot publish.
 * Returns Map<clinicId, records[]> with the newest confirmation first. Records are never merged with each other
 * or with the HIRA values: the page shows the newest one as a separate, dated panel.
 */
export function validateHospitalConfirmations(value, clinics) {
  if (!isPlainObject(value)) throw new Error('hospital-confirmed: the file must be an object');
  onlyKeys(value, ['schemaVersion', 'records'], 'hospital-confirmed');
  if (value.schemaVersion !== 1) throw new Error('hospital-confirmed: schemaVersion must be 1');
  if (!Array.isArray(value.records)) throw new Error('hospital-confirmed: records must be an array');
  const byId = new Map(clinics.map(c => [c.id, c])), byClinic = new Map(), seen = new Set();
  value.records.forEach((record, index) => {
    const where = `hospital-confirmed.records[${index}]`;
    if (!isPlainObject(record)) throw new Error(`${where}: must be an object`);
    onlyKeys(record, ['clinicId', 'confirmedOn', 'channel', 'confirmedByRole', 'evidence', 'fields'], where);
    if (typeof record.clinicId !== 'string' || !isDentalHospital(byId.get(record.clinicId))) throw new Error(`${where}: clinicId must be an existing 종별코드 41 institution`);
    if (!isIsoDate(record.confirmedOn)) throw new Error(`${where}: confirmedOn must be a real YYYY-MM-DD date`);
    if (typeof record.channel !== 'string' || !Object.hasOwn(CONFIRMATION_CHANNELS, record.channel)) throw new Error(`${where}: channel must be one of ${Object.keys(CONFIRMATION_CHANNELS).join('|')}`);
    if (typeof record.confirmedByRole !== 'string' || record.confirmedByRole.length < 2 || !ROLE.test(record.confirmedByRole)) throw new Error(`${where}: confirmedByRole must be a department such as 원무과, never a person`);
    if (!plainLine(record.evidence, 120) || hasPhoneNumber(record.evidence)) throw new Error(`${where}: evidence must be one short line without contact details`);
    validateConfirmedFields(record.fields, where);
    const key = record.clinicId + ' ' + record.confirmedOn;
    if (seen.has(key)) throw new Error(`${where}: duplicate confirmation for the same institution and date`);
    seen.add(key);
    if (!byClinic.has(record.clinicId)) byClinic.set(record.clinicId, []);
    byClinic.get(record.clinicId).push(record);
  });
  for (const list of byClinic.values()) list.sort((a, b) => b.confirmedOn.localeCompare(a.confirmedOn));
  return byClinic;
}

const correctionHref = c => `/corrections/?clinic=${encodeURIComponent(c.name)}`;
const NEUTRAL_LISTING = '확인은 무료이며, 확인 여부는 목록 순서나 표시 방식에 영향을 주지 않습니다. 목록은 가나다순이고 유료 노출 상품은 없습니다.';

/** A separate, dated panel for what the hospital itself confirmed; without a record, a compact invitation to confirm. */
export function hospitalConfirmationPanel(c, confirmation = null, {correctionEmail = null} = {}) {
  if (!isDentalHospital(c)) return '';
  // The mailto anchor is exactly mailtoLink(): IndexNow reverses Cloudflare's e-mail obfuscation of that one form only.
  const contact = `<div class="condition-links"><a href="${esc(correctionHref(c))}" rel="nofollow">정정·확인 메모 만들기 ${icon('arrow')}</a>${correctionEmail ? mailtoLink(correctionEmail) : ''}</div>`;
  const how = correctionEmail ? '아래 메모 양식이나 이메일로 알려 주세요.' : '아래 메모 양식으로 알려 주세요.';
  if (!confirmation) {
    return `<section class="fact-panel" id="hospital-confirmed"><h2>병원이 직접 확인한 정보</h2><p>아직 이 병원이 직접 확인한 정보는 없습니다. 이 병원의 담당 부서라면 전화번호·홈페이지·예약 주소·진료시간·휴진 안내를 확인하거나 바로잡을 수 있습니다. ${how}</p>${contact}<p class="subtle-note">${NEUTRAL_LISTING} 확인한 내용은 확인일을 붙여 심평원 등록값과 따로 표시하며, 등록값을 고치지 않습니다. 환자 정보는 보내지 마세요.</p></section>`;
  }
  const f = confirmation.fields, rows = [];
  if (f.phone) rows.push(['확인한 전화번호', `<a href="tel:${esc(singlePhone(f.phone))}">${esc(f.phone)}</a>`]);
  if (f.website) rows.push(['확인한 홈페이지', externalLink(f.website, f.website)]);
  if (f.bookingUrl) rows.push(['확인한 예약 주소', externalLink(f.bookingUrl, f.bookingUrl)]);
  if (f.hours) {
    const days = DAYS.filter(day => f.hours[day]);
    rows.push(['확인한 진료시간', days.map(day => `${esc(DAY_LABELS[day])} ${esc(f.hours[day].open)} ~ ${esc(f.hours[day].close)}`).join('<br>') + (days.length < DAYS.length ? '<small>확인받지 않은 요일은 적지 않았습니다. 휴진을 뜻하지 않습니다.</small>' : '')]);
  }
  if (f.closedNote) rows.push(['확인한 휴진 안내', esc(f.closedNote)]);
  return `<section class="fact-panel" id="hospital-confirmed"><div class="pill-row" style="margin-bottom:14px"><span class="pill">병원 직접 확인</span><span class="pill neutral">${esc(CONFIRMATION_CHANNELS[confirmation.channel])} · ${esc(confirmation.confirmedByRole)}</span></div><h2>병원이 직접 확인한 정보 · 확인일 ${esc(confirmation.confirmedOn)}</h2><p class="subtle-note" style="margin-bottom:16px">이 병원이 직접 확인해 준 항목만 적었습니다. 심평원 등록값을 고치거나 대신하지 않으며, 두 값이 다르면 둘 다 그대로 둡니다. 확인일 이후 바뀌었을 수 있습니다.</p><table class="fact-table"><tbody>${rows.map(([label, html]) => `<tr><th scope="row">${esc(label)}</th><td>${html}</td></tr>`).join('')}</tbody></table><p class="subtle-note" style="margin-top:14px">확인 근거: ${esc(confirmation.evidence)}. ${NEUTRAL_LISTING} 내용이 바뀌었다면 ${how}</p>${contact}</section>`;
}

// ---------- 4. update ledger ----------
/** The quarters listed in data/content/hira-snapshots.json, reduced to the dates the ledger prints. */
export function snapshotLedgerSource(registry) {
  if (registry == null) return [];
  if (!isPlainObject(registry) || !Array.isArray(registry.snapshots)) throw new Error('hira-snapshots: snapshots must be an array');
  const seen = new Set();
  return registry.snapshots.map((s, index) => {
    if (!isIsoDate(s?.snapshotDate) || seen.has(s.snapshotDate)) throw new Error(`hira-snapshots.snapshots[${index}]: snapshotDate must be a unique YYYY-MM-DD date`);
    if (s.registeredOn != null && !isIsoDate(s.registeredOn)) throw new Error(`hira-snapshots.snapshots[${index}]: registeredOn must be a YYYY-MM-DD date`);
    seen.add(s.snapshotDate);
    return {snapshotDate: s.snapshotDate, registeredOn: s.registeredOn ?? null};
  }).sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));
}

const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const newest = list => list.filter(x => instant(x?.checkedAt) !== null).toSorted((a, b) => instant(b.checkedAt) - instant(a.checkedAt))[0] ?? null;
const LEDGER_ORDER = ['hospital-confirmation', 'homepage-check', 'naver-observation', 'hira-collected', 'hira-registered', 'hira-reference', 'hira-earlier'];

/**
 * Dated events this page's data rests on, newest first. Only things that happened are listed: the quarter(s) in the
 * snapshot registry up to the imported one, the inventory's own checkedAt values and hospital confirmations.
 * `missing` names the checks that have no record yet, so their absence is stated instead of implied.
 */
export function hospitalLedger(c, ctx, assetRecord = null) {
  if (!isDentalHospital(c)) return null;
  const {snapshot, observedOn = null, snapshots = [], confirmations = new Map()} = ctx ?? {}, entries = [], missing = [];
  const fields = '주소·전화·인력·진료과목·장비·등록 진료시간';
  if (isIsoDate(snapshot)) {
    entries.push({date: snapshot, kind: 'hira-reference', title: '심평원 자료 기준일', detail: `건강보험심사평가원 「전국 병의원 및 약국 현황」 ${snapshot} 기준 파일입니다. 이 페이지의 ${fields}은 이 날짜의 등록 값이며, 이후 변경은 반영돼 있지 않습니다.`});
    const listed = snapshots.find(s => s.snapshotDate === snapshot);
    if (listed?.registeredOn) entries.push({date: listed.registeredOn, kind: 'hira-registered', title: '공공데이터포털 파일 등록일', detail: `${snapshot} 기준 파일이 공공데이터포털에 등록된 날짜입니다.`});
    if (isIsoDate(observedOn)) entries.push({date: observedOn, kind: 'hira-collected', title: '치과데이터랩 수집일', detail: `${snapshot} 기준 파일을 내려받아 이 페이지에 반영한 날짜입니다. 기관의 현재 상태를 다시 확인한 날짜가 아닙니다.`});
    for (const s of snapshots) if (s.snapshotDate < snapshot) entries.push({date: s.snapshotDate, kind: 'hira-earlier', title: '이전 분기 자료 기준일', detail: `치과데이터랩이 원본을 보관한 ${s.snapshotDate} 기준 분기 파일입니다${s.registeredOn ? ` (공공데이터포털 등록일 ${s.registeredOn})` : ''}. 지금 이 페이지의 값은 ${snapshot} 기준 파일의 값입니다.`});
  }
  const checks = assetRecord?.homepageChecks ?? [], readChecks = checks.filter(x => x?.status === 'read');
  const check = newest(readChecks) ?? newest(checks);
  if (check) {
    const urls = new Set(checks.map(x => x.url)).size, readUrls = new Set(readChecks.map(x => x.url)).size;
    // 'read' is the inventory's "HTML 수신": the page answered with HTML. It is not a statement about what the page says.
    entries.push({date: localDate(check.checkedAt), kind: 'homepage-check', title: '홈페이지 점검', href: '#marketing-assets', linkLabel: '점검 기록 보기',
      detail: `등록·발굴 홈페이지 주소 ${fmt(urls)}개를 점검했고 HTML을 받은 주소는 ${fmt(readUrls)}개입니다. ${readUrls ? '날짜는 마지막으로 HTML을 받은 점검일입니다.' : '날짜는 마지막 점검 시도일입니다.'}`});
  } else missing.push('홈페이지 점검');
  const observations = assetRecord?.naverPlaceObservations ?? [], readObservation = newest(observations.filter(o => o?.bodyStatus === 'read'));
  const observation = readObservation ?? newest(observations);
  if (observation) {
    entries.push({date: localDate(observation.checkedAt), kind: 'naver-observation', title: '네이버지도 관찰', href: '#naver-observed', linkLabel: '관찰 내용 보기',
      detail: readObservation
        ? `네이버지도 공개 화면을 마지막으로 읽은 날짜입니다.${observation.identityMatch === true ? ' 이름·지역·전화 대조 조건을 충족했습니다.' : observation.identityMatch === false ? ' 이름·지역·전화 대조 조건을 충족하지 못해 이 기관의 확정 정보로 보지 않습니다.' : ''}`
        : '네이버지도 열람을 시도했으나 화면을 읽지 못한 마지막 시도일입니다.'});
  } else missing.push('네이버지도 관찰');
  const confirmed = confirmations.get(c.id) ?? [];
  for (const r of confirmed) entries.push({date: r.confirmedOn, kind: 'hospital-confirmation', title: '병원 직접 확인', href: '#hospital-confirmed', linkLabel: '확인 내용 보기',
    detail: `확인 경로 ${CONFIRMATION_CHANNELS[r.channel]} · 확인 부서 ${r.confirmedByRole} · 확인 항목 ${Object.keys(CONFIRMABLE_FIELDS).filter(key => key in r.fields).map(key => CONFIRMABLE_FIELDS[key]).join('·')}`});
  if (!confirmed.length) missing.push('병원 직접 확인');
  const dated = entries.filter(e => isIsoDate(e.date));
  dated.sort((a, b) => b.date.localeCompare(a.date) || LEDGER_ORDER.indexOf(a.kind) - LEDGER_ORDER.indexOf(b.kind));
  return {entries: dated, missing};
}

export function hospitalLedgerPanel(c, ctx, assetRecord = null) {
  const ledger = hospitalLedger(c, ctx, assetRecord);
  if (!ledger) return '';
  const rows = ledger.entries.map(e => `<tr data-ledger="${esc(e.kind)}"><th scope="row"><time datetime="${esc(e.date)}">${esc(e.date)}</time></th><td>${esc(e.title)}<small>${esc(e.detail)}</small>${e.href ? `<a href="${esc(e.href)}">${esc(e.linkLabel)} ↓</a>` : ''}</td></tr>`).join('');
  return `<section class="fact-panel" id="update-ledger"><h2>갱신 기록</h2><p class="subtle-note" style="margin-bottom:16px">이 페이지의 값이 어느 날짜의 어떤 자료와 확인에 근거하는지 최근 날짜부터 적었습니다. 실제로 있었던 수집과 확인만 싣습니다.</p><table class="fact-table"><caption class="skip">날짜별 자료 수집·확인 기록</caption><tbody>${rows}</tbody></table>${ledger.missing.length ? `<p class="subtle-note" style="margin-top:14px">아직 기록이 없는 확인: ${esc(ledger.missing.join(' · '))}. 아직 확인하지 않았다는 뜻이며, 홈페이지·채널이나 정보가 없다는 뜻이 아닙니다.</p>` : ''}</section>`;
}

// ---------- 7. JSON-LD ----------
// Pages that identify the institution itself. A booking flow, chat link or link hub is not an identity reference.
const SAME_AS_KINDS = new Set(['website', 'naverMap', 'kakaoMap', 'googleMap', 'naverBlog', 'blog', 'youtube', 'instagram', 'facebook', 'kakaoChannel']);
const attributed = asset => ['official', 'linked'].includes(asset?.ownership) && asset.linkable !== false && Boolean(externalUrl(asset.url));
// The profile, channel or place an asset names (the inventory's own reduction), so tracking parameters and trailing
// slashes neither reach the JSON-LD nor hide that two institutions point at the same page.
const identityUrl = asset => { const channel = channelFromHref(asset.url); return channel?.kind === asset.kind ? channel.url : externalUrl(asset.url); };

/** Pages that the inventory attributes to more than one institution: they cannot identify a single one. */
export function sharedChannelUrls(inventory) {
  const owners = new Map();
  for (const record of inventory?.records ?? []) for (const asset of record.assets ?? []) {
    if (!attributed(asset)) continue;
    const url = identityUrl(asset);
    if (!owners.has(url)) owners.set(url, new Set());
    owners.get(url).add(record.clinicId);
  }
  return new Set([...owners].filter(([, ids]) => ids.size > 1).map(([url]) => url));
}

/**
 * Properties merged into the existing Dentist node, for 종별코드 41 only. schema.org (checked 2026-11-26): Dentist is a
 * LocalBusiness and so a Place, which carries additionalProperty (PropertyValue: name, value, unitText, description);
 * it is also a MedicalOrganization, which carries medicalSpecialty, and https://schema.org/Dentistry is a
 * MedicalSpecialty member; url and sameAs come from Thing.
 * Unknown counts are left out instead of written as 0. `url` is set only when exactly one body-matched homepage
 * exists; with several, none is singled out. No hours, founding date, price, rating or review is ever emitted.
 */
export function hospitalSchemaExtras(c, {snapshot, ctCount = null, assetRecord = null, sharedUrls = null} = {}) {
  if (!isDentalHospital(c)) return {};
  const specialist = c.doctors?.specialist, registered = `건강보험심사평가원 ${snapshot} 자료의 등록 수이며 현재 현황이 아닙니다.`;
  const property = (name, value, rest) => ({'@type': 'PropertyValue', name, value, ...rest});
  const additionalProperty = [
    property('종별', '치과병원', {description: '건강보험심사평가원 종별코드 41'}),
    ...(isCount(specialist) ? [property('치과전문의 등록 수', specialist, {unitText: '명', description: registered})] : []),
    ...(isCount(ctCount) ? [property('콘빔CT 등록 수', ctCount, {unitText: '대', description: registered})] : []),
    property('자료 기준일', snapshot, {description: '건강보험심사평가원 전국 병의원 및 약국 현황'}),
  ];
  const usable = (assetRecord?.assets ?? []).filter(a => attributed(a) && !sharedUrls?.has(identityUrl(a)));
  const homepages = usable.filter(a => a.kind === 'website' && a.ownership === 'official' && detectKind(externalUrl(a.url)) === 'website');
  const url = homepages.length === 1 ? externalUrl(homepages[0].url) : null;
  const sameAs = [...new Set(usable.filter(a => SAME_AS_KINDS.has(a.kind)).map(identityUrl))].filter(value => value !== url);
  return {additionalProperty, medicalSpecialty: 'https://schema.org/Dentistry', ...(url ? {url} : {}), ...(sameAs.length ? {sameAs} : {})};
}

// ---------- page wiring ----------
/** Everything computed once per build: regional counts, the snapshot ledger source, validated confirmations, shared URLs. */
export function hospitalProfileContext({clinics, snapshot, observedOn = null, snapshotRegistry = null, confirmed = null, inventory = null, operator = null} = {}) {
  if (!Array.isArray(clinics)) throw new TypeError('hospitalProfileContext needs the clinics array');
  if (!isIsoDate(snapshot)) throw new TypeError('hospitalProfileContext needs the snapshot date');
  return {
    snapshot, observedOn: isIsoDate(observedOn) ? observedOn : null,
    regionCounts: hospitalRegionCounts(clinics),
    snapshots: snapshotLedgerSource(snapshotRegistry),
    confirmations: validateHospitalConfirmations(confirmed ?? {schemaVersion: 1, records: []}, clinics),
    sharedUrls: sharedChannelUrls(inventory),
    correctionEmail: operator?.correctionEmail ?? null,
  };
}

/** The first block of a 치과병원 page: summary, registered 진료과목 and the regional counts. */
export function hospitalLeadPanel(c, ctx, {ctCount = null} = {}) {
  const summary = hospitalSummary(c, {snapshot: ctx?.snapshot, ctCount});
  if (!summary) return '';
  const subjects = hospitalSpecialtySentence(c), region = hospitalRegionContext(c, ctx.regionCounts), confirmation = ctx.confirmations?.get(c.id)?.[0];
  return `<section class="fact-panel" id="hospital-summary" aria-labelledby="hospital-summary-title"><h2 id="hospital-summary-title">한눈에 보기</h2><p id="hospital-summary-text" style="font-size:16px;line-height:1.8">${esc(summary.text)}</p><p class="subtle-note" style="margin-top:8px">${esc(summary.caveat)}</p>${confirmation ? `<p style="margin-top:12px"><a class="text-link" href="#hospital-confirmed">병원이 직접 확인한 정보 · 확인일 ${esc(confirmation.confirmedOn)} ↓</a></p>` : ''}<h3 id="registered-specialties">등록 진료과목</h3><p>${esc(subjects.text)}</p><p class="subtle-note" style="margin-top:8px">${subjects.caveat ? esc(subjects.caveat) + ' ' : ''}<a href="#staff" style="color:var(--teal)">과목별 등록 수 표 보기 ↓</a></p>${region ? `<h3 id="region-context">같은 지역의 치과병원</h3><p>${esc(region.text)}</p><div class="condition-links"><a href="${esc(region.hospitalsHref)}">${esc(c.sido)} 치과병원 목록 ${icon('arrow')}</a><a href="${esc(region.districtHref)}">${esc(c.city)} 치과 전체 목록 ${icon('arrow')}</a></div>` : ''}</section>`;
}

/** Page blocks and JSON-LD extras for one institution. 치과의원 (51) gets empty strings and an empty object. */
export function hospitalProfileBlocks(c, ctx, {assetRecord = null, ctCount = null} = {}) {
  if (!isDentalHospital(c)) return EMPTY;
  const confirmation = ctx.confirmations?.get(c.id)?.[0] ?? null;
  return {
    lead: hospitalLeadPanel(c, ctx, {ctCount}),
    tail: hospitalConfirmationPanel(c, confirmation, {correctionEmail: ctx.correctionEmail}) + hospitalLedgerPanel(c, ctx, assetRecord),
    schema: hospitalSchemaExtras(c, {snapshot: ctx.snapshot, ctCount, assetRecord, sharedUrls: ctx.sharedUrls}),
  };
}
