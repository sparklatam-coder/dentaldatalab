import fs from 'node:fs';
import path from 'node:path';
import { esc, fmt, icon, safeWebsite, clinicUrl, localDate, SOURCE_URL } from '../src/shared.mjs';

const CHANNELS = { website: '홈페이지', naverPlace: '네이버 지도', naverBlog: '네이버 블로그' };
const STATUS = {
  verified: '본문·기관 대조', linked: '링크 확인 · 본문 미확인', candidate: '후보 · 추가 대조 필요',
  blocked: '본문 접근 실패 · 미확인', not_found: '검색 범위 내 미발굴', pending: '조사 대기',
};
const external = value => typeof value === 'string' && /^https?:\/\//i.test(value) ? safeWebsite(value) : null;
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const dateLabel = value => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value ? localDate(value) : '확인 기록 없음';
const sourceLink = (url, label) => url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ${icon('link')}</a>` : '';

function normalizeChannel(channel) {
  if (!channel) return { status: 'pending', url: null, evidenceUrls: [], notes: '', bodyVerified: false, identityVerified: false };
  const url = external(channel.url);
  const evidenceUrls = [...new Set((Array.isArray(channel.evidenceUrls) ? channel.evidenceUrls : []).map(external).filter(Boolean))];
  let status = Object.hasOwn(STATUS, channel.status) ? channel.status : 'candidate';
  if (status === 'verified' && (!url || !evidenceUrls.length)) status = 'candidate';
  if (status === 'verified' && (channel.identityVerified !== true || channel.identityStatus === 'candidate' || channel.officiality === 'unconfirmed')) status = 'candidate';
  if (status === 'verified' && channel.bodyVerified !== true) status = 'linked';
  if (status === 'not_found' && url) status = 'candidate';
  return {
    status, url, evidenceUrls, notes: text(channel.notes),
    bodyVerified: status === 'verified',
    identityVerified: status === 'verified' || channel.identityVerified === true,
  };
}

function normalizeFact(fact, recordDate) {
  const sourceUrl = external(fact?.sourceUrl);
  if (!sourceUrl || !['verified', 'observed'].includes(fact?.status) || !text(fact.field) || !text(fact.value)) return null;
  return {
    field: text(fact.field), value: text(fact.value), sourceUrl,
    checkedAt: text(fact.checkedAt || recordDate), status: fact.status,
    notes: text(fact.notes), comparison: text(fact.comparison),
    sourceEvidenceMode: text(fact.sourceEvidenceMode), sourceType: text(fact.sourceType),
  };
}

function sourceSummary(source, clinicCount) {
  const check = source?.sourceVerification;
  const download = check?.download;
  const comparison = check?.comparison;
  const matches = check?.status === 'official_snapshot_matched'
    && download?.archiveMatchesManifest === true
    && comparison?.mismatchCount === 0
    && comparison?.dentalRows === clinicCount;
  const status = matches ? 'matched' : check?.status === 'official_snapshot_differs_review_required' ? 'mismatch' : source ? 'incomplete' : 'pending';
  const notice = source?.evidence?.find(item => item.id === 'hira-region-notice' && item.status === 'directly_confirmed');
  return {
    status, checkedAt: text(check?.completedAt || source?.checkedAt),
    snapshotDate: text(check?.expectedSnapshotDate), sourceUrl: SOURCE_URL,
    sha256: /^[a-f0-9]{64}$/.test(download?.sha256 ?? '') ? download.sha256 : null,
    bytes: Number.isSafeInteger(download?.size) ? download.size : null,
    dentalCount: Number.isSafeInteger(comparison?.dentalRows) ? comparison.dentalRows : null,
    typeCounts: comparison?.byType ?? {},
    mismatches: Number.isSafeInteger(comparison?.mismatchCount) ? comparison.mismatchCount : null,
    regionNoticeUrl: external(notice?.url),
    meaning: '공식 분기 원본과 로컬 가공값의 일치 검증입니다. 현재 영업·진료시간·전화 연결·홈페이지 운영의 전수 확인이 아닙니다.',
  };
}

/** Build a public-safe, complete Yangju roster without modifying the snapshot. */
export function prepareVerification(clinics, batches = [], source = null) {
  const selected = clinics.filter(clinic => clinic.sidoCode === '310000' && clinic.cityCode === '312700')
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id));
  const byId = new Map(selected.map(clinic => [clinic.id, clinic]));
  const raw = new Map();
  for (const batch of batches) for (const record of batch?.records ?? []) {
    if (!byId.has(record.clinicId)) throw new Error(`Channel record outside Yangju scope: ${record.clinicId}`);
    if (record.name !== byId.get(record.clinicId).name) throw new Error(`Channel institution name mismatch: ${record.clinicId}`);
    if (raw.has(record.clinicId)) throw new Error(`Duplicate channel record: ${record.clinicId}`);
    raw.set(record.clinicId, record);
  }
  const records = selected.map(clinic => {
    const record = raw.get(clinic.id);
    return {
      clinicId: clinic.id, name: clinic.name, address: clinic.address, type: ({'41':'치과병원','51':'치과의원'})[clinic.typeCode]??'종별 미확인',
      checkedAt: text(record?.checkedAt), researched: Boolean(record),
      channels: Object.fromEntries(Object.keys(CHANNELS).map(key => [key, normalizeChannel(record?.channels?.[key])])),
      facts: (Array.isArray(record?.facts) ? record.facts : []).map(fact => normalizeFact(fact, record.checkedAt)).filter(Boolean),
    };
  });
  const channelCounts = Object.fromEntries(Object.keys(CHANNELS).map(key => [key, Object.fromEntries(Object.keys(STATUS).map(status => [status, records.filter(record => record.channels[key].status === status).length]))]));
  const researched = records.filter(record => record.researched).length;
  return {
    schemaVersion: 1,
    scope: { name: '양주시', sidoCode: '310000', cityCode: '312700', total: selected.length, nationwideTotal: clinics.length },
    source: sourceSummary(source, clinics.length),
    statusDefinitions: { ...STATUS },
    policy: '기관명·주소·전화 등 식별 근거를 대조한 관찰 기록입니다. 신고 스냅샷·검색·비교 값을 덮어쓰지 않으며 추천 순위가 아닙니다. 미발굴은 채널 부재가 아닙니다.',
    summary: { researched, pending: selected.length - researched, nationwidePending: clinics.length - researched, channelCounts, verifiedChannelCount: Object.values(channelCounts).reduce((sum, counts) => sum + counts.verified, 0), observedFactCount: records.reduce((sum, record) => sum + record.facts.length, 0) },
    records,
  };
}

export function loadVerification(root, clinics) {
  const batches = ['01', '02', '03'].map(part => path.join(root, 'data/research', `yangju-${part}.json`))
    .filter(file => fs.existsSync(file)).map(file => JSON.parse(fs.readFileSync(file, 'utf8')));
  const sourceFile = path.join(root, 'docs/source-verification.json');
  return prepareVerification(clinics, batches, fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : null);
}

function channelCell(channel, key) {
  const linkLabel = channel.status === 'verified' ? `${CHANNELS[key]} 보기` : channel.status === 'linked' ? '확인한 링크 보기' : '발견한 링크 보기';
  const evidence = channel.evidenceUrls.map((url, i) => sourceLink(url, `근거 ${i + 1}`)).join(' · ');
  return `<span class="verification-status status-${channel.status}">${STATUS[channel.status]}</span>${channel.url ? `<p class="channel-link">${sourceLink(channel.url, linkLabel)}</p>` : ''}${channel.notes || evidence ? `<details class="channel-evidence"><summary>확인 근거</summary>${channel.notes ? `<p>${esc(channel.notes)}</p>` : ''}${evidence ? `<p>${evidence}</p>` : ''}</details>` : ''}`;
}

const COMPARISON_LABELS = { matched: '공공 신고값과 대조한 기록', supplement: '신고값을 대체하지 않는 별도 관찰', different: '신고값과 차이가 있어 추가 확인 필요', differs: '신고값과 차이가 있어 추가 확인 필요' };
const FIELD_LABELS = { reservationPhone: '예약·상담 전화 안내', phone: '전화번호', address: '주소', website: '홈페이지', hours: '진료시간 안내', hoursSummary: '진료시간 안내', name: '기관명' };
function factList(facts) {
  if (!facts.length) return '<p class="subtle-note">별도로 확인해 기록한 사실이 아직 없습니다.</p>';
  const mode = fact => fact.sourceEvidenceMode === 'search_index' ? '검색 색인에서 관찰 · 대상 본문 미확인' : fact.sourceEvidenceMode === 'direct_page' ? '페이지 자체 안내 · 본문 열람' : '출처 관찰 기록 · 열람 방식 미기재';
  return `<ul class="verified-facts">${facts.map(fact => `<li><strong>${esc(FIELD_LABELS[fact.field] || fact.field)}</strong><p>${esc(fact.value)}</p><small>${mode(fact)} · ${esc(dateLabel(fact.checkedAt))}</small>${fact.comparison ? `<p>${esc(COMPARISON_LABELS[fact.comparison] || fact.comparison)}</p>` : ''}${fact.notes ? `<p>${esc(fact.notes)}</p>` : ''}<p>${sourceLink(fact.sourceUrl, '관찰 출처')}</p></li>`).join('')}</ul>`;
}

export function clinicChannelPanel(clinic, verification) {
  const record = verification.records.find(record => record.clinicId === clinic.id);
  if (!record) return '';
  return `<section class="fact-panel online-channels" id="online-channels"><h2>이전 채널 조사 기록</h2><p class="subtle-note"><a href="#marketing-assets">이후 갱신된 채널·네이버 정보는 위의 기관 에셋에서 확인하세요.</a></p><p class="subtle-note">양주시 채널 조사 · ${record.researched ? `${esc(dateLabel(record.checkedAt))} 확인` : '조사 대기'}. 아래는 원자료 신고값과 구분한 관찰 기록입니다.</p><div class="clinic-channel-grid">${Object.entries(CHANNELS).map(([key, label]) => `<div><h3>${label}</h3>${channelCell(record.channels[key], key)}</div>`).join('')}</div><h3>온라인에서 관찰한 정보</h3>${factList(record.facts)}<p class="subtle-note">본문·기관 대조는 해당 페이지의 기관 식별과 표시 내용 확인을 뜻합니다. 전화 연결이나 현재 진료 여부를 직접 확인한 것은 아닙니다.</p><a class="text-link" href="/verification/">전체 조사 범위와 확인 기준 ${icon('arrow')}</a></section>`;
}

function sourceSection(source) {
  const checked = source.status === 'matched';
  return `<section class="report-section verification-source"><h2>공공데이터 원본 대조</h2><div class="source-banner ${checked ? '' : 'warning'}">${icon('source')}<div><strong>${checked ? '공식 원본과 동봉 자료의 일치를 확인했습니다.' : source.status === 'mismatch' ? '원본 대조 결과 차이가 있어 검토가 필요합니다.' : '공식 원본 대조 결과를 확인 중입니다.'}</strong><p>${esc(source.meaning)}</p></div></div>${checked ? `<dl class="verification-source-facts"><div><dt>데이터 기준일</dt><dd>${esc(source.snapshotDate)}</dd></div><div><dt>외부 원본 대조일</dt><dd>${esc(dateLabel(source.checkedAt))}</dd></div><div><dt>공식 자료에서 선별한 치과</dt><dd>${fmt(source.dentalCount)}곳</dd></div><div><dt>대조한 필드의 불일치</dt><dd>${fmt(source.mismatches)}건</dd></div></dl><p class="subtle-note">공식 ZIP을 새로 내려받아 파일 크기·SHA-256을 비교하고, 기본·인력 정보와 시간·장비·진료과목·좌표·출처 연결을 독립적으로 대조했습니다.</p>${source.sha256 ? `<details><summary>원본 파일 해시와 크기</summary><code class="verification-hash">${esc(source.sha256)}</code><p>${fmt(source.bytes)} bytes</p></details>` : ''}` : '<p class="subtle-note">확인되지 않은 상태를 검증 완료로 표시하지 않습니다.</p>'}<p>${sourceLink(source.sourceUrl, '건강보험심사평가원 원자료')}</p>${source.regionNoticeUrl ? `<p class="subtle-note">‘전남광주통합특별시’는 공식 행정개편 공지에서 확인되는 명칭입니다. 원자료에 잔존한 다른 표기의 원인까지 확정한 것은 아닙니다. ${sourceLink(source.regionNoticeUrl, 'HIRA 행정개편 공지')}</p>` : ''}</section>`;
}

export function registerVerificationPage({ page, put, verification }) {
  const v = verification;
  put('data/verification.json', JSON.stringify(v, null, 2));
  const rows = v.records.map(record => `<tr><th scope="row"><a href="${clinicUrl(record.clinicId)}">${esc(record.name)}</a><small>${esc(record.type)}</small><small>${esc(record.address)}</small></th>${Object.keys(CHANNELS).map(key => `<td>${channelCell(record.channels[key], key)}</td>`).join('')}<td>${esc(dateLabel(record.checkedAt))}</td><td>${record.facts.length ? `<details class="channel-facts"><summary>${record.facts.length}개 사실 보기</summary>${factList(record.facts)}<a href="${clinicUrl(record.clinicId)}#online-channels">상세 페이지</a></details>` : '별도 기록 없음'}</td></tr>`).join('');
  page('/verification/', {
    title: '원본 대조와 온라인 채널 확인',
    description: `공식 원본 대조 범위와 양주시 ${v.scope.total}곳의 홈페이지·네이버 지도·블로그 조사 상태를 확인하세요.`,
    current: 'data', breadcrumb: [{ label: '출처와 데이터', url: '/data/' }, { label: '원본·채널 확인' }],
    body: `<div class="wrap"><header class="page-intro"><p class="eyebrow">SOURCE & CHANNEL VERIFICATION</p><h1>어디까지 확인했나요?</h1><p>공식 원본의 일치와 현재 웹페이지의 관찰을 구분합니다.<br>확인한 범위와 남은 빈칸을 함께 공개합니다.</p><div class="hero-actions"><a class="btn small" href="/data/verification.json" download>확인 기록 JSON</a><a class="text-link" href="#yangju-channels">양주시 채널 목록 ${icon('arrow')}</a></div></header>${sourceSection(v.source)}<div class="source-banner"><div><strong>아래 채널 표는 초기 조사 기록입니다.</strong><p>이후 확보한 홈페이지·SNS와 네이버지도 기본정보는 <a href="/clinic-assets/">치과별 에셋 목록</a>에서 확인하세요. 초기 확인 기록은 출처 추적을 위해 보존합니다.</p></div></div><section class="report-section" id="yangju-channels"><h2>양주시 ${fmt(v.scope.total)}곳의 온라인 채널</h2><p class="report-section-copy">심평원 원자료의 경기 310000 · 양주 312700 전체 기관을 가나다순으로 살펴봅니다. 특정 고객이나 채널이 많은 기관을 우선 노출하지 않습니다.</p><p class="subtle-note">채널 조사는 현재 양주시에 한정됩니다. 전국 ${fmt(v.scope.nationwideTotal)}곳 중 양주 외 ${fmt(v.scope.nationwideTotal - v.scope.total)}곳은 조사 대기입니다.</p><div class="report-metrics"><div><span>조사 기록이 있는 기관</span><strong>${fmt(v.summary.researched)}<small> / ${fmt(v.scope.total)}곳</small></strong><p>일부 채널은 후보 또는 접근 제한 상태</p></div><div><span>본문·기관 대조한 채널</span><strong>${fmt(v.summary.verifiedChannelCount)}<small>개</small></strong><p>기관 수가 아닌 채널 수</p></div><div><span>양주 내 조사 대기</span><strong>${fmt(v.summary.pending)}<small>곳</small></strong><p>발견하지 못한 기관과 구분</p></div></div><div class="verification-key"><p><strong>본문·기관 대조:</strong> 페이지 본문과 기관명·주소·전화 등의 식별 근거를 대조했습니다. 현재 운영 전체를 보증하지 않습니다.</p><p><strong>링크 확인:</strong> 기관 페이지에 연결된 URL을 확인했지만 대상 본문은 미확인입니다. <strong>후보:</strong> 기관 연결 근거를 더 확인해야 합니다.</p><p><strong>본문 접근 실패:</strong> 발견한 주소의 본문을 열람하지 못했습니다. <strong>미발굴:</strong> 이번 검색 범위에서 찾지 못했으며 실제 채널이 없다는 뜻은 아닙니다.</p></div><div class="report-table-scroll" tabindex="0" role="region" aria-label="양주시 기관별 채널 조사 목록"><table class="report-table channel-table"><caption>양주시 전체 ${fmt(v.scope.total)}곳 · 홈페이지와 네이버 채널의 확인 상태</caption><thead><tr><th scope="col">기관</th><th scope="col">홈페이지</th><th scope="col">네이버 지도</th><th scope="col">네이버 블로그</th><th scope="col">관찰일</th><th scope="col">확인한 사실</th></tr></thead><tbody>${rows}</tbody></table></div><p class="subtle-note">표는 좌우로 넘겨 볼 수 있습니다. 상세 페이지에서 원문 근거와 페이지 자체 안내를 확인하세요. 신고 스냅샷 및 검색·비교 값은 이 조사 결과로 바꾸지 않습니다.</p></section><section class="report-section prose"><h2>기록과 갱신 원칙</h2><p>같은 이름의 다른 기관과 혼동하지 않도록 주소·전화 등 식별 근거를 함께 확인합니다. 발견 URL과 본문 확인 여부를 분리하며, 차이가 있어도 원자료 값을 조용히 수정하지 않습니다. 온라인에서 확인한 안내는 전화 연결이나 실제 방문 확인과 다릅니다.</p><p>검색에서 찾지 못한 결과는 조사 범위의 한계입니다. 홈페이지·지도·블로그의 부재나 기관의 품질로 해석하지 않습니다. 리뷰·환자 경험·치료 효과 주장을 이 목록에 전재하지 않습니다.</p><a class="text-link" href="/corrections/?clinic=${encodeURIComponent('원본·채널 확인 기록')}">근거가 다른 경우 정정 메모 ${icon('arrow')}</a></section></div>`,
  });
}
