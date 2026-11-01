import fs from 'node:fs';
import path from 'node:path';
import { esc, icon, localDate } from '../src/shared.mjs';

const SOURCE_KINDS = new Set(['google', 'google_proxy', 'model', 'relative', 'own_site', 'discovery', 'naver']);
const safeUrl = value => {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }
  catch { return false; }
};
const external = (url, title) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)} ${icon('link')}</a>`;

export function validateSearchGuide(guide) {
  if (guide.schemaVersion !== 1 || !guide.checkedAt || !Array.isArray(guide.sources) || !guide.sources.length) throw new Error('Missing search source guide');
  const refs = new Map();
  for (const r of guide.references ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(r.id) || refs.has(r.id) || !safeUrl(r.url) || !r.title || !r.publisher || !r.checkedAt || !r.foundVia) throw new Error(`Invalid search reference: ${r.id}`);
    refs.set(r.id, r);
  }
  const ids = new Set();
  for (const s of guide.sources) {
    if (!/^[a-z][a-z0-9-]*$/.test(s.id) || ids.has(s.id) || !SOURCE_KINDS.has(s.kind) || !safeUrl(s.entryUrl)) throw new Error(`Invalid search source: ${s.id}`);
    ids.add(s.id);
    if (!s.references?.length || s.references.some(id => !refs.has(id))) throw new Error(`Missing source reference: ${s.id}`);
    if (s.volumeAcquired !== false) throw new Error('This guide records source discovery, not acquired search volumes');
    for (const field of ['name', 'metric', 'scope', 'access', 'finding', 'use']) if (!s[field]) throw new Error(`Missing ${field}: ${s.id}`);
  }
  if (guide.rankingStatus !== 'not_measured' || guide.monthlyVolumes !== null) throw new Error('Source guide must not claim a measured ranking');
  if (!guide.recommendation?.title || !guide.recommendation.text || !guide.recommendation.references?.length || guide.recommendation.references.some(id => !refs.has(id))) throw new Error('Missing recommendation evidence');
  for (const group of [guide.workflow, guide.rankingRules, guide.investigation]) {
    if (!Array.isArray(group) || !group.length) throw new Error('Missing reproducible search method');
    for (const item of group) {
      if (!item.title || !item.text || item.references?.some(id => !refs.has(id))) throw new Error('Invalid method reference');
    }
  }
  return guide;
}

export function loadSearchGuide(root) {
  const file = path.join(root, 'data/content/search-source-guide.json');
  return fs.existsSync(file) ? validateSearchGuide(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
}

export function searchSourceSummary(evidence, content) {
  const observed = (evidence.autocomplete?.observations ?? []).filter(o => o.status === 'observed' && o.source === 'google_autocomplete');
  const keywords = new Set(observed.flatMap(o => o.suggestions ?? []).map(s => s.normalize('NFC').trim().replace(/\s+/g, ' ')));
  return {
    observedSeedCount: observed.length, autocompleteKeywordCount: keywords.size,
    contentQuestionCount: content.questions.length,
    measuredMonthlyKeywordCount: content.questions.filter(q => q.avgMonthlySearches !== null).length,
    rankingStatus: content.rankingStatus,
  };
}

export function registerSearchSourcePage({ page, put, guide, bundle }) {
  if (!guide || !bundle) return;
  validateSearchGuide(guide);
  const { content, evidence } = bundle;
  const summary = searchSourceSummary(evidence, content);
  // Keep this source-finding report separate from any future measured series.
  if (summary.measuredMonthlyKeywordCount || summary.rankingStatus !== 'not_measured' || content.questions.some(q => q.searchRank !== null)) throw new Error('Update the source report for a measured ranking before publishing');
  const references = new Map(guide.references.map(r => [r.id, r]));
  const citations = ids => (ids ?? []).map(id => {
    const r = references.get(id);
    return `<a href="#ref-${r.id}">${esc(r.title)}</a>`;
  }).join(' · ');
  const rows = guide.sources.map(s => `<tr><th scope="row"><a href="#source-${s.id}">${esc(s.name)}</a><small>${esc(s.scope)}</small></th><td>${esc(s.metric)}</td><td>${esc(s.access)}</td><td>${esc(s.use)}</td></tr>`).join('');
  const cards = guide.sources.map(s => `<article class="search-source-card" id="source-${s.id}"><div class="pill-row"><span class="pill outline">${esc(s.label)}</span><span class="pill neutral">원문 확인 · 검색량 미수집</span></div><h3>${esc(s.name)}</h3><p>${esc(s.finding)}</p><dl><div><dt>얻는 값</dt><dd>${esc(s.metric)}</dd></div><div><dt>접근 조건</dt><dd>${esc(s.access)}</dd></div><div><dt>추천 용도</dt><dd>${esc(s.use)}</dd></div></dl><p class="source-citations">${citations(s.references)}</p><p class="source-entry">${external(s.entryUrl, s.entryLabel ?? '공식 서비스·문서 열기')}</p></article>`).join('');
  const methodItems = (items, type) => `<${type} class="source-steps">${items.map((item, i) => `<li><span class="source-step-index">${String(i + 1).padStart(2, '0')}</span><div><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p>${item.references?.length ? `<p class="source-citations">${citations(item.references)}</p>` : ''}</div></li>`).join('')}</${type}>`;
  const refList = guide.references.map(r => `<details class="search-reference" id="ref-${r.id}"><summary><span>${esc(r.title)}</span><small>${esc(r.publisher)} · 확인 ${esc(localDate(r.checkedAt))}</small></summary><p>${esc(r.finding)}</p><p><strong>찾은 경로</strong> ${esc(r.foundVia)}</p>${r.query ? `<p><strong>실제로 사용한 검색어</strong> <code>${esc(r.query)}</code></p>` : ''}<p>${external(r.url, '확인한 공식 원문')}</p></details>`).join('');
  put('data/content/search-source-guide.json', JSON.stringify({ ...guide, currentProject: summary }, null, 2));
  page('/search-sources/', {
    title: '검색량 순위의 출처와 만드는 법', current: 'questions',
    description: 'Google 월간 검색량을 어디서 얻고 어떻게 비교할지, 직접 찾은 공식 출처와 조사 경로를 공개합니다.',
    breadcrumb: [{ label: '치료 질문 100', url: '/questions/' }, { label: '검색량 출처와 조사 방법' }],
    body: `<div class="wrap search-source-page"><header class="page-intro"><div class="pill-row"><span class="pill outline">검색 근거 연구</span><span class="pill neutral">${esc(localDate(guide.checkedAt))} 확인</span></div><p class="eyebrow">SEARCH VOLUME / SOURCES & METHOD</p><h1>검색량 순위는<br>어디서 올까요?</h1><p>Google이 제공하는 월평균 검색량부터 제3자의 추정치까지.<br>데이터를 얻는 곳, 찾은 경로, 순위를 만드는 기준을 함께 공개합니다.</p><div class="hero-actions"><a class="btn primary" href="#ranking-workflow">순위 만드는 절차 ${icon('arrow')}</a><a class="btn" href="#source-comparison">소스 비교하기</a><a class="text-link" href="#discovery-log">실제로 찾은 과정</a></div></header>
    <section class="source-recommendation"><p class="eyebrow">RECOMMENDED PATH</p><h2>${esc(guide.recommendation.title)}</h2><p>${esc(guide.recommendation.text)}</p><div class="source-path" aria-label="추천 수집 과정"><span>관련 검색어 넓게 발굴</span>${icon('arrow')}<span>동일 조건의 과거 검색량</span>${icon('arrow')}<span>중복·누락 확인 후 순위</span></div><p class="source-citations">${citations(guide.recommendation.references)}</p></section>
    <div class="content-stats"><div><strong>${summary.autocompleteKeywordCount}</strong><span>자동완성에서 관찰한 검색어</span></div><div><strong>${summary.contentQuestionCount}</strong><span>현재 편집한 질문</span></div><div><strong>${summary.measuredMonthlyKeywordCount}</strong><span>월간 검색량 확보 키워드</span></div><div><strong>${guide.sources.length}</strong><span>역할을 비교한 데이터 소스</span></div></div><div class="source-banner">${icon('source')}<div><strong>출처와 이용 방법을 확인했습니다. 검색량 순위는 아직 산출하지 않았습니다.</strong><p>공식 문서를 읽은 것과 계정 안의 수치를 확보한 것은 구분합니다. 자동완성의 노출 순서, 광고 경쟁도, 검색결과 수로 월간 검색량을 대신하지 않습니다.</p></div></div>
    <section class="section" id="source-comparison"><div class="section-head"><div><p class="eyebrow">CHOOSE THE RIGHT MEASURE</p><h2>무엇을 측정하는 소스인가요?</h2><p>Google·네이버, 검색 건수·상대 지수·내 사이트 노출은 서로 다른 자료입니다.</p></div></div><div class="report-table-scroll" tabindex="0" role="region" aria-label="검색 데이터 소스 비교"><table class="report-table source-comparison"><caption>데이터 소스별 측정값과 접근 조건 · 추천 순위표가 아닙니다</caption><thead><tr><th scope="col">소스와 범위</th><th scope="col">측정값</th><th scope="col">접근 조건</th><th scope="col">활용</th></tr></thead><tbody>${rows}</tbody></table></div><div class="search-source-grid">${cards}</div></section>
    <section class="section" id="ranking-workflow"><div class="section-head"><div><p class="eyebrow">REPRODUCIBLE WORKFLOW</p><h2>치과 검색량 순위를 만드는 절차</h2><p>이 사이트에 적용할 수집 설계입니다. 아직 실행하지 않은 데이터 확보 단계가 포함됩니다.</p></div></div>${methodItems(guide.workflow, 'ol')}<p><a class="btn" href="/data/content/keyword-planner-seeds.txt" download>현재 100개 후보 검색어 TXT</a></p><p class="subtle-note">100개는 시작 목록입니다. 각 분야를 10개씩 채우는 편집 방식은 실제 검색량 순위와 다르므로, 순위용 목록은 발굴 범위를 넓힌 뒤 정합니다.</p></section>
    <section class="section" id="ranking-rules"><div class="section-head"><div><p class="eyebrow">HOW WE WOULD RANK</p><h2>같은 조건의 값만 비교합니다</h2><p>순위를 만들 때 적용할 편집·통계 규칙입니다.</p></div></div>${methodItems(guide.rankingRules, 'ul')}<div class="source-report-label"><strong>향후 순위 표제 예시 · 현재 순위가 아닙니다</strong><p>대한민국 Google 검색 · [실제 집계 시작월–종료월] · 수집·검토한 치과치료 후보 내 월평균 검색량 순위</p><p>함께 표시할 항목: 원천·제공사 / 지역·검색망 / 입력 키워드와 언어 설정 / 기간·실제 포함 월수 / 유사어 묶음 / 추정값·범위 / 수집일 / 누락과 제외 사유</p></div></section>
    <section class="section" id="discovery-log"><div class="section-head"><div><p class="eyebrow">WHAT WE ACTUALLY CHECKED</p><h2>이번에 실제로 찾은 과정</h2><p>문서에서 확인한 기능, 접속에서 확인한 제한, 확보한 데이터를 나눠 기록했습니다.</p></div></div>${methodItems(guide.investigation, 'ol')}<div class="hero-actions"><a class="btn" href="/data/content/search-source-guide.json" download>출처·조사 기록 JSON</a><a class="text-link" href="/data/content/search-evidence.json" download>기존 자동완성 원응답 JSON ${icon('arrow')}</a></div></section>
    <section class="section" id="source-references"><div class="section-head"><div><p class="eyebrow">FOLLOW THE EVIDENCE</p><h2>공식 원문과 찾은 경로</h2><p>각 항목을 펼치면 확인 내용과 검색어·이동 경로를 볼 수 있습니다. 본문의 근거 링크는 해당 원문 기록으로 이어집니다.</p></div></div>${refList}</section><div class="report-reading"><h2>출처를 확인하고 질문으로 돌아가기</h2><p>현재 질문 목록에는 검색어가 자동완성에 직접 나타났는지와 편집해 만든 질문인지를 표시합니다.</p><a class="text-link" href="/questions/">치료 질문 100 보기 ${icon('arrow')}</a></div></div>`,
  });
}
