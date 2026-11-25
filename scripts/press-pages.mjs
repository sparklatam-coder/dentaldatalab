// /press/: 보도·인용 안내 for journalists, bloggers and researchers. Headline numbers are computed from the report
// data at build time and each links to its report and CSV. No institution names and no rankings appear here.
// Press releases are listed from data/content/press-releases.json, and only entries a person marked as released.
import fs from 'node:fs';
import path from 'node:path';
import { esc, fmt, icon, localDate, SOURCE_URL } from '../src/shared.mjs';
import { externalLink } from './html.mjs';
import { isIsoDate } from './common.mjs';
import { mailtoLink } from './site-operations.mjs';
import { REPORTS } from './report-pages.mjs';
import { OPEN_DATA_ROUTE, PRESS_ROUTE, SOURCE_TITLE, LICENSE, SOURCE_LICENSE, attributionText, attributionHtml, reportRoute, reportDataPath, reportTitleOf, copyLine, licenseLink } from './open-data.mjs';
import { headlineFacts, dataLimits, COMMENT_PLACEHOLDER, INTERNAL_HEADING } from './press-release.mjs';

export const PRESS_RELEASES_FILE = 'data/content/press-releases.json';
const RELEASE_ID = /^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const releasePath = id => `press/releases/${id}.txt`;

/**
 * Validates the press-release list. A `released` entry is read with readText and must be a finished document:
 * the comment placeholder and the internal checklist are gone. `draft` entries are never read or published.
 * Titles come from the document's first heading, so no number is typed into the data file.
 */
export function validatePressReleases(config, readText) {
  if (config?.schemaVersion !== 1 || !Array.isArray(config.releases)) throw new Error('press-releases.json needs schemaVersion 1 and a releases array');
  const seen = new Set();
  return config.releases.map(entry => {
    const { id, snapshotDate, file, status, releasedOn = null } = entry ?? {};
    if (typeof id !== 'string' || !RELEASE_ID.test(id) || seen.has(id)) throw new Error(`Invalid or duplicate press release id: ${id}`);
    seen.add(id);
    if (file !== `docs/press/${id}.md`) throw new Error(`${id}: file must be docs/press/${id}.md`);
    if (!isIsoDate(snapshotDate)) throw new Error(`${id}: snapshotDate must be YYYY-MM-DD`);
    if (status === 'draft') {
      if (releasedOn !== null) throw new Error(`${id}: a draft has no releasedOn`);
      return { id, snapshotDate, status, releasedOn: null };
    }
    if (status !== 'released') throw new Error(`${id}: status must be draft or released`);
    if (!isIsoDate(releasedOn)) throw new Error(`${id}: a released entry needs releasedOn (YYYY-MM-DD)`);
    const text = readText(file), title = /^# (.+)$/m.exec(text)?.[1].trim();
    if (!title) throw new Error(`${id}: ${file} has no "# " title line`);
    if (text.includes(COMMENT_PLACEHOLDER) || text.includes(INTERNAL_HEADING)) throw new Error(`${id}: ${file} still has the comment placeholder or the internal checklist. Finish the document before marking it released.`);
    return { id, snapshotDate, status, releasedOn, title, text };
  }).sort((a, b) => String(b.releasedOn ?? '').localeCompare(String(a.releasedOn ?? '')) || a.id.localeCompare(b.id));
}

export function loadPressReleases(root) {
  return validatePressReleases(JSON.parse(fs.readFileSync(path.join(root, PRESS_RELEASES_FILE), 'utf8')), file => fs.readFileSync(path.join(root, file), 'utf8'));
}

export function registerPressPages({ page, put, reports, domain, operator = {}, releases = [] }) {
  if (typeof page !== 'function' || typeof put !== 'function') throw new TypeError('registerPressPages needs page() and put()');
  const snapshot = reports.snapshotDate, items = new Map(REPORTS.map(item => [item.slug, item]));
  const facts = headlineFacts(reports).filter(fact => items.has(fact.report));
  const published = releases.filter(release => release.status === 'released');
  for (const release of published) put(releasePath(release.id), release.text);

  const factCards = facts.map(fact => {
    const item = items.get(fact.report);
    return `<article class="fact-panel" id="fact-${esc(fact.id)}"><h3 style="margin-top:0">${esc(fact.headline)}</h3>${fact.detail ? `<p>${esc(fact.detail)}</p>` : ''}<p class="subtle-note">읽을 때 주의: ${esc(fact.caveat)}</p>${copyLine(`press-cite-${fact.id}`, attributionText({ pageUrl: domain + reportRoute(item), snapshotDate: snapshot }), '출처 표기 복사')}<div class="condition-links"><a href="${reportRoute(item)}">리포트: ${esc(reportTitleOf(item, reports))} ${icon('arrow')}</a><a href="${reportDataPath(item, 'csv')}" download>집계표 CSV</a><a href="${reportDataPath(item, 'json')}" download>근거 포함 JSON</a></div></article>`;
  }).join('');
  const numbers = `<section class="section" aria-labelledby="press-numbers"><h2 id="press-numbers">바로 인용할 수 있는 숫자</h2><p class="subtle-note" style="margin:14px 0">빌드할 때 리포트와 같은 집계에서 계산한 값입니다. 각 항목의 리포트에 분모와 정의, 표 전체가 있습니다.</p>${factCards}</section>`;

  const hubTerms = { pageUrl: domain + OPEN_DATA_ROUTE, snapshotDate: snapshot };
  const cite = `<section class="fact-panel" id="how-to-cite"><h2>인용하는 방법</h2><ol class="prose"><li>숫자와 함께 자료 기준일(${esc(snapshot)})을 적습니다. 분기 자료이므로 “현재”나 “올해”로 바꿔 쓰면 뜻이 달라집니다.</li><li>숫자가 나온 리포트의 출처 표기 한 줄을 붙입니다. 위 항목마다 복사할 수 있고, 온라인 글이라면 리포트 주소에 링크를 걸어 주세요.</li><li>표나 그래프를 다시 만들었거나 수치를 다시 계산했다면 가공했다는 사실을 밝힙니다.</li></ol><p>집계표·그래프와 CSV·JSON에는 ${licenseLink()} 라이선스를 적용하므로 허락을 따로 구하지 않고 영리 목적으로도 쓸 수 있습니다. 원자료는 ${externalLink(SOURCE_LICENSE.url, SOURCE_LICENSE.name)} 조건을 따릅니다.</p><h3>여러 리포트의 숫자를 함께 쓸 때</h3>${copyLine('press-cite-text', attributionText(hubTerms), '문구 복사')}${copyLine('press-cite-html', attributionHtml(hubTerms), 'HTML 복사')}<div class="condition-links"><a href="${OPEN_DATA_ROUTE}">전체 집계 데이터와 이용 조건 ${icon('arrow')}</a><a href="/reports/">데이터 리포트 ${icon('arrow')}</a><a href="/methodology/">처리 기준 ${icon('arrow')}</a></div></section>`;

  const limits = `<section class="fact-panel" id="limits"><h2>이 자료로 말할 수 없는 것</h2><p>기사 제목이나 요약에서 아래 뜻으로 읽히지 않도록 확인해 주세요. 리포트가 밝힌 정의와 한계를 그대로 옮겼습니다.</p><ul class="prose">${dataLimits(reports).map(limit => `<li><strong>${esc(limit.label)}:</strong> ${esc(limit.text)}</li>`).join('')}</ul></section>`;

  const releaseList = published.length
    ? `<ul class="source-list">${published.map(release => `<li><strong>${esc(release.title)}</strong><p>배포 ${esc(release.releasedOn)} · 자료 기준일 ${esc(release.snapshotDate)}</p><a href="/${releasePath(release.id)}">보도자료 전문 (텍스트) ${icon('arrow')}</a></li>`).join('')}</ul>`
    : '<p>배포한 보도자료는 아직 없습니다. 위의 숫자와 리포트는 지금 바로 인용할 수 있습니다.</p>';
  const press = `<section class="fact-panel" id="press-releases"><h2>보도자료</h2>${releaseList}</section>`;

  // mailtoLink() is the one anchor form indexnow.mjs can restore after Cloudflare rewrites e-mail links on the live page.
  const contact = `<section class="fact-panel" id="press-contact"><h2>보도 문의</h2><p>서비스 이름: 치과데이터랩${operator.operatorName ? ` · 운영: ${esc(operator.operatorName)}` : ''}</p>${operator.correctionEmail ? `<p>집계 방법, 추가 집계, 수치 확인에 관한 질문은 이메일로 받습니다.</p><div class="condition-links">${mailtoLink(operator.correctionEmail)}</div>` : '<p>문의 이메일은 확인 중입니다. 수치 오류는 정정 요청 페이지에서 알려 주세요.</p>'}<p class="subtle-note">의료 상담이나 예약, 특정 치과에 대한 평가 요청에는 답하지 않습니다. 운영 주체와 이해관계 고지는 <a href="/about/">서비스 소개</a>에, 수치 오류 제보 방법은 <a href="/corrections/">정정 요청</a>에 있습니다.</p></section>`;

  const source = `<div class="source-banner">${icon('source')}<div><strong>등록 자료의 집계이며, 기관 간 우열이나 진료의 질을 평가한 결과가 아닙니다.</strong><p>원자료: ${externalLink(reports.sourceUrl ?? SOURCE_URL, SOURCE_TITLE, { withIcon: true })} · ${esc(snapshot)} 기준 · ${esc(localDate(reports.observedAt))} 수집. 기관명과 기관별 순위는 싣지 않습니다.</p></div></div>`;

  page(PRESS_ROUTE, {
    title: '보도·인용 안내',
    description: `기자·블로거·연구자를 위한 치과데이터랩 인용 안내입니다. 건강보험심사평가원 ${snapshot} 기준 전국 치과병원 ${fmt(reports.dentalHospitals.total)}곳 등 주요 집계 수치와 출처 표기 방법, 해석 한계, 문의처를 정리했습니다.`,
    breadcrumb: [{ label: '보도·인용 안내' }],
    body: `<div class="wrap"><div class="page-intro"><div class="pill-row"><span class="pill">기자·블로거·연구자</span><span class="pill neutral">자료 기준일 ${esc(snapshot)}</span><span class="pill outline">${esc(LICENSE.name)}</span></div><h1>보도·인용 안내</h1><p>치과데이터랩의 집계 숫자를 기사와 글에 바로 옮길 수 있도록 주요 수치, 출처 표기, 해석 한계를 한곳에 모았습니다.</p></div>${source}${numbers}${cite}${limits}${press}${contact}</div>`,
  });
  return { facts: facts.length, releases: published.length };
}
