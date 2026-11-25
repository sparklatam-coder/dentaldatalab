// /data/open/: the hub for 치과데이터랩's own aggregate datasets, with the licence in plain Korean, copy-ready
// attribution and a DataCatalog node, plus /data/open/catalog.json for machines. The list is derived from REPORTS.
// Aggregates only: no institution names, ids or detail links belong on this page or in the catalog.
import { esc, fmt, icon, localDate, SOURCE_URL } from '../src/shared.mjs';
import { externalLink, reportTable } from './html.mjs';
import { mailtoLink } from './site-operations.mjs';
import { REPORTS } from './report-pages.mjs';
import {
  OPEN_DATA_ROUTE, PRESS_ROUTE, CATALOG_NAME, SOURCE_TITLE, LICENSE, SOURCE_LICENSE, LICENSE_SCOPE, NOT_COVERED, notCoveredText,
  attributionText, attributionHtml, reportRoute, reportDataPath, reportTitleOf, reportDescriptionOf, reportVariables, copyLine, licenseLink,
} from './open-data.mjs';

export const CATALOG_FILE = 'data/open/catalog.json';

/** One entry per aggregate dataset, in REPORTS order. All URLs are absolute so the catalog is usable off-site. */
export function openDatasets(reports, domain) {
  return REPORTS.map(item => {
    const pageUrl = domain + reportRoute(item), terms = { pageUrl, snapshotDate: reports.snapshotDate };
    return {
      id: item.slug, tag: item.tag, title: reportTitleOf(item, reports), description: reportDescriptionOf(item, reports),
      variables: reportVariables(item, reports), snapshotDate: reports.snapshotDate, route: reportRoute(item), landingPage: pageUrl,
      downloads: { csv: domain + reportDataPath(item, 'csv'), json: domain + reportDataPath(item, 'json') },
      paths: { csv: reportDataPath(item, 'csv'), json: reportDataPath(item, 'json') },
      requiredAttribution: attributionText(terms), attributionHtml: attributionHtml(terms),
    };
  });
}

/** Machine-readable catalog written to /data/open/catalog.json. It has no build timestamp, so equal inputs give equal bytes. */
export function openDataCatalog({ reports, domain }) {
  return {
    schemaVersion: 1, name: CATALOG_NAME, url: domain + OPEN_DATA_ROUTE, publisher: { name: '치과데이터랩', url: domain },
    snapshotDate: reports.snapshotDate, observedAt: reports.observedAt,
    source: { title: SOURCE_TITLE, url: reports.sourceUrl ?? SOURCE_URL, sha256: reports.sourceSha256, license: SOURCE_LICENSE },
    license: { name: LICENSE.name, spdx: LICENSE.spdx, url: LICENSE.url, deedUrl: LICENSE.deedUrl, scope: LICENSE_SCOPE, notCovered: NOT_COVERED.map(notCoveredText) },
    attributionTemplate: attributionText({ pageUrl: '<인용한 리포트 주소>', snapshotDate: '<자료 기준일>' }),
    correctionsUrl: domain + '/corrections/', pressUrl: domain + PRESS_ROUTE,
    datasets: openDatasets(reports, domain).map(({ id, title, description, variables, snapshotDate, landingPage, downloads, requiredAttribution, attributionHtml: html }) => (
      { id, title, description, variables, snapshotDate, landingPage, downloads, license: LICENSE.url, requiredAttribution, attributionHtml: html })),
  };
}

// Google reads a nested Dataset as a full one: name plus a 50–5000 character description.
const catalogDescription = dataset => `${dataset.description} ${SOURCE_TITLE} ${dataset.snapshotDate} 기준 자료를 집계한 표이며 CSV와 JSON으로 내려받을 수 있습니다.`;

function catalogSchema({ reports, domain, datasets }) {
  return {
    '@context': 'https://schema.org', '@type': 'DataCatalog', '@id': domain + OPEN_DATA_ROUTE + '#catalog', name: CATALOG_NAME, url: domain + OPEN_DATA_ROUTE, inLanguage: 'ko-KR',
    description: `${SOURCE_TITLE} ${reports.snapshotDate} 기준 자료를 치과데이터랩이 집계한 표 ${datasets.length}종. 기관명 없이 집계값만 담았으며 ${LICENSE.name}으로 공개합니다.`,
    license: LICENSE.url, isAccessibleForFree: true, publisher: { '@id': domain + '/#publisher' },
    dataset: datasets.map(dataset => ({
      '@type': 'Dataset', '@id': dataset.landingPage + '#dataset', name: dataset.title, description: catalogDescription(dataset), url: dataset.landingPage,
      license: LICENSE.url, isAccessibleForFree: true, temporalCoverage: dataset.snapshotDate, creator: { '@id': domain + '/#publisher' },
      distribution: ['csv', 'json'].map(ext => ({ '@type': 'DataDownload', encodingFormat: ext === 'csv' ? 'text/csv' : 'application/json', contentUrl: dataset.downloads[ext] })),
    })),
  };
}

export function registerOpenDataPages({ page, put, reports, domain, operator = {} }) {
  if (typeof page !== 'function' || typeof put !== 'function') throw new TypeError('registerOpenDataPages needs page() and put()');
  const datasets = openDatasets(reports, domain), snapshot = reports.snapshotDate;
  const hubTerms = { pageUrl: domain + OPEN_DATA_ROUTE, snapshotDate: snapshot };
  put(CATALOG_FILE, JSON.stringify(openDataCatalog({ reports, domain }), null, 2) + '\n');

  const rows = datasets.map(dataset => [
    `<a href="${esc(dataset.route)}">${esc(dataset.title)}</a><small>${esc(dataset.tag)}</small>`,
    `<span style="display:block;text-align:left;min-width:240px">${esc(dataset.description)}${dataset.variables.length ? `<small>항목: ${esc(dataset.variables.join(', '))}</small>` : ''}</span>`,
    esc(dataset.snapshotDate),
    `<a href="${esc(dataset.paths.csv)}" download>CSV</a> · <a href="${esc(dataset.paths.json)}" download>JSON</a>`,
  ]);
  const list = `<section class="section" aria-labelledby="open-datasets"><h2 id="open-datasets">내려받을 수 있는 집계 데이터 ${fmt(datasets.length)}종</h2><p class="subtle-note" style="margin:14px 0">모두 같은 분기 자료(${esc(snapshot)} 기준)에서 계산했습니다. 제목을 누르면 표·그래프와 집계 방법이 있는 리포트로 이동합니다.</p>${reportTable(['데이터', '담긴 내용', '자료 기준일', '내려받기'], rows, '치과데이터랩 공개 집계 데이터 목록')}<p class="subtle-note">모든 파일은 집계값만 담고 기관명이나 기관 식별자를 싣지 않습니다. CSV는 UTF-8(BOM) 인코딩이며 행마다 정의·해석 제한·원본 출처·이용 조건·출처 표기를 함께 적었습니다. JSON에는 분모와 정의, 원본 SHA-256, 라이선스와 출처 표기가 들어 있습니다. 프로그램으로 읽을 목록은 <a href="/${CATALOG_FILE}">catalog.json</a>입니다.</p></section>`;

  const terms = `<section class="fact-panel" id="license"><h2>이용 조건을 쉽게 말하면</h2><p>위 목록의 집계 데이터와 해당 리포트의 표·그래프에는 ${licenseLink(`${LICENSE.name} (${LICENSE.title})`)} 라이선스를 적용합니다. 허락을 따로 구하거나 비용을 낼 필요가 없습니다.</p><h3>할 수 있는 일</h3><ul class="prose"><li>기사·블로그·보고서·논문·발표 자료에 숫자와 표를 옮겨 싣기</li><li>표나 그래프를 다시 만들거나 다른 자료와 합쳐 가공하기</li><li>영리 목적의 매체·서비스에서 쓰기</li></ul><h3>지켜야 할 일</h3><ul class="prose"><li>아래 출처 표기 한 줄을 붙입니다. 이 한 줄을 표시하면 출처 표시 조건을 지킨 것으로 봅니다.</li><li>수치를 다시 계산했거나 표를 고쳤다면 가공했다는 사실을 밝힙니다.</li><li>치과데이터랩이나 건강보험심사평가원이 이용자나 그 글을 보증·후원하는 것처럼 표시하지 않습니다.</li></ul><p class="subtle-note">집계의 바탕인 심평원 파일은 ${externalLink(SOURCE_LICENSE.url, SOURCE_LICENSE.name)} 조건 그대로이므로, 출처 표기에 원자료 이름과 기준일이 함께 들어갑니다. 이 설명은 요약이며 조건은 ${externalLink(LICENSE.legalCodeUrl, '라이선스 전문')}을 따릅니다.</p></section>`;

  const perDataset = datasets.map(dataset => `<h3>${esc(dataset.title)}</h3>${copyLine(`cite-text-${dataset.id}`, dataset.requiredAttribution, '문구 복사')}${copyLine(`cite-html-${dataset.id}`, dataset.attributionHtml, 'HTML 복사')}`).join('');
  const cite = `<section class="fact-panel" id="attribution"><h2>출처 표기 문구</h2><p>인용한 숫자가 나온 리포트의 주소를 넣은 한 줄입니다. 여러 리포트의 숫자를 함께 쓸 때는 이 페이지 주소를 넣은 아래 문구를 쓰면 됩니다.</p><h3>글·기사에 붙일 문구</h3>${copyLine('cite-text-open-data', attributionText(hubTerms), '문구 복사')}<h3>웹페이지에 넣을 HTML 한 줄</h3>${copyLine('cite-html-open-data', attributionHtml(hubTerms), 'HTML 복사')}<details style="margin-top:20px"><summary>데이터별 출처 표기 (리포트 주소 포함)</summary>${perDataset}</details></section>`;

  const excluded = `<section class="fact-panel" id="not-covered"><h2>이 조건이 적용되지 않는 것</h2><ul class="prose">${NOT_COVERED.map(entry => `<li><strong>${esc(entry.what)}</strong>${entry.note ? ` — ${esc(entry.note)}` : ''}</li>`).join('')}</ul><p class="subtle-note">위 목록에 없는 자료를 쓰려면 각 자료의 출처와 조건을 따로 확인해 주세요.</p></section>`;

  // mailtoLink() is the one anchor form indexnow.mjs can restore after Cloudflare rewrites e-mail links on the live page.
  const corrections = `<section class="fact-panel" id="corrections"><h2>숫자가 틀려 보인다면</h2><p>집계값이나 정의에 오류가 있어 보이면 근거와 함께 알려 주세요. 근거를 대조한 뒤 수정 여부를 검토하며, 확인 전에는 원자료를 덮어쓰지 않습니다.</p><div class="condition-links"><a href="/corrections/">정정 요청 방법 ${icon('arrow')}</a>${operator.correctionEmail ? mailtoLink(operator.correctionEmail) : ''}<a href="${PRESS_ROUTE}">보도·인용 안내 ${icon('arrow')}</a></div></section>`;

  const source = `<div class="source-banner">${icon('source')}<div><strong>원자료: ${esc(SOURCE_TITLE)} · ${esc(snapshot)} 기준 · ${esc(localDate(reports.observedAt))} 수집</strong><p>${externalLink(reports.sourceUrl ?? SOURCE_URL, '공공데이터포털에서 원자료 확인', { withIcon: true })} · 등록 자료의 집계이며 기관 간 우열이나 진료의 질을 평가한 결과가 아닙니다. 자료 미확인을 0이나 미보유로 바꾸지 않았습니다.</p></div></div>`;

  page(OPEN_DATA_ROUTE, {
    title: '치과 집계 데이터 내려받기와 이용 조건',
    description: `치과데이터랩이 건강보험심사평가원 ${snapshot} 기준 자료로 만든 집계표 ${fmt(datasets.length)}종을 CSV·JSON으로 내려받을 수 있습니다. 출처를 표시하면 ${LICENSE.name} 조건으로 인용·가공·재배포할 수 있습니다.`,
    current: 'data', breadcrumb: [{ label: '출처와 데이터', url: '/data/' }, { label: '공개 집계 데이터' }],
    schema: [catalogSchema({ reports, domain, datasets })],
    body: `<div class="wrap"><div class="page-intro"><div class="pill-row"><span class="pill">${esc(LICENSE.name)}</span><span class="pill neutral">자료 기준일 ${esc(snapshot)}</span><span class="pill outline">집계값만 · 기관명 없음</span></div><h1>집계 데이터 내려받기와 이용 조건</h1><p>치과데이터랩이 만든 집계표를 기사·블로그·연구에 그대로 쓸 수 있습니다. 출처 한 줄만 표시하면 됩니다.</p></div>${list}${terms}${cite}${excluded}${corrections}${source}</div>`,
  });
  return { datasets: datasets.length, catalog: CATALOG_FILE };
}
