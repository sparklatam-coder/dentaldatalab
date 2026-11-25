// Reuse terms for 치과데이터랩's own aggregate tables: one definition of the licence, the required attribution and the
// fields that every report download, Dataset node and page shows, so the wording cannot drift between outputs.
// Scope: the aggregate datasets derived from REPORTS only. The HIRA file keeps its own terms, and third-party
// observations (Naver, clinic homepages), institution-level downloads and logos are not licensed here.
import { esc, icon, SOURCE_URL } from '../src/shared.mjs';
import { externalLink } from './html.mjs';

export const OPEN_DATA_ROUTE = '/data/open/';
export const PRESS_ROUTE = '/press/';
export const CATALOG_NAME = '치과데이터랩 공개 집계 데이터';
export const SOURCE_TITLE = '건강보험심사평가원 「전국 병의원 및 약국 현황」';

// `url` is the canonical licence URI that machines match on; `deedUrl` is the Korean summary shown to readers.
export const LICENSE = Object.freeze({
  spdx: 'CC-BY-4.0', name: 'CC BY 4.0', title: '크리에이티브 커먼즈 저작자표시 4.0 국제',
  url: 'https://creativecommons.org/licenses/by/4.0/',
  deedUrl: 'https://creativecommons.org/licenses/by/4.0/deed.ko',
  legalCodeUrl: 'https://creativecommons.org/licenses/by/4.0/legalcode.ko',
});
export const SOURCE_LICENSE = Object.freeze({
  name: '공공누리 제1유형(출처표시)', url: 'https://www.kogl.or.kr/info/licenseType1.do', appliesTo: `${SOURCE_TITLE} 원자료`,
});
export const LICENSE_SCOPE = '치과데이터랩이 만든 집계 데이터(공개 집계 데이터 목록에 실린 /data/reports/의 CSV·JSON)와 해당 리포트의 표·그래프';
// What the licence does not reach. `what` is the short name; `note` says why or what applies instead.
export const NOT_COVERED = Object.freeze([
  { id: 'source', what: `${SOURCE_TITLE} 원자료 자체`, note: `${SOURCE_LICENSE.name} 조건을 그대로 따릅니다` },
  { id: 'third-party', what: '기관 상세 페이지의 제3자 관찰 자료', note: '네이버 플레이스나 기관 홈페이지에서 옮긴 소개·진료시간·안내 문구와 그 링크' },
  { id: 'other-files', what: '공개 집계 데이터 목록에 없는 파일', note: '기관별 자료 내려받기, 검색 색인, 양주 시간 분석의 네이버 관찰 근거 파일 등' },
  { id: 'brand', what: '치과데이터랩의 이름·로고·사이트 디자인과 이미지', note: null },
  { id: 'quoted', what: '리포트에 인용한 법령·공단 안내 등 외부 원문', note: '각 출처의 조건을 따릅니다' },
].map(Object.freeze));
export const notCoveredText = entry => entry.note ? `${entry.what}: ${entry.note}` : entry.what;

// The same paths report-pages.mjs writes; test/open-data.test.mjs checks them against the files it actually produces.
export const reportRoute = item => `/reports/${item.slug}/`;
export const reportDataPath = (item, ext) => `/data/reports/${item.slug}.${ext}`;
const resolved = (value, group) => typeof value === 'function' ? value(group) : value;
export const reportTitleOf = (item, reports) => resolved(item.title, reports[item.group]);
export const reportDescriptionOf = (item, reports) => resolved(item.description, reports[item.group]);

/** The attribution a reuser must show. pageUrl is the page whose numbers were used. */
export const attributionText = ({ pageUrl, snapshotDate }) => `출처: 치과데이터랩(${pageUrl}) · 원자료: ${SOURCE_TITLE}(${snapshotDate} 기준)`;
/** The same attribution as one line of HTML with links to the page and the source file. */
export const attributionHtml = ({ pageUrl, snapshotDate }) => `출처: <a href="${esc(pageUrl)}">치과데이터랩</a> · 원자료: <a href="${esc(SOURCE_URL)}">${esc(SOURCE_TITLE)}</a>(${esc(snapshotDate)} 기준)`;

// What each kind of report tabulates, for Dataset.variableMeasured and the hub. Coverage reports use the metric labels.
const VARIABLES = Object.freeze({
  dentalHospitals: ['치과전문의 등록 인원', '콘빔CT 등록 기관 수와 대수', '원자료 시도 표기별 치과병원 수', '개설 연도 구간별 치과병원 수', '과목별 전문의 등록 기관 수', '홈페이지 URL 형식 유효 기관 수', '진료시간 확인 기관 수'],
  hospitalVsClinic: ['치과전문의 등록 인원', '콘빔CT 등록 기관 수와 대수', '홈페이지 URL 형식 유효 기관 수', '진료시간 확인 기관 수', '외래 본인부담률', '요양기관 종별가산율'],
  hospitalDistricts: ['시·군·구별 치과병원 수', '시·군·구별 치과의원 수', '치과병원이 1곳 이상 등록된 시·군·구 수'],
});
export const reportVariables = (item, reports) => item.kind ? VARIABLES[item.kind] ?? [] : Object.values(reports.definitions ?? {}).map(definition => definition.label);
const KEYWORDS = Object.freeze(['치과', '치과병원', '치과의원', '건강보험심사평가원', '전국 병의원 및 약국 현황', '공공데이터', '집계 통계']);

export const catalogRef = domain => ({ '@type': 'DataCatalog', '@id': domain + OPEN_DATA_ROUTE + '#catalog', name: CATALOG_NAME, url: domain + OPEN_DATA_ROUTE });

/** Properties spread into every report Dataset node: licence, free access, the shared publisher node, credit and catalog. */
export function datasetReuse({ item, reports, domain }) {
  const variables = reportVariables(item, reports);
  return {
    license: LICENSE.url, isAccessibleForFree: true,
    creator: { '@type': 'Organization', '@id': domain + '/#publisher', name: '치과데이터랩', url: domain },
    publisher: { '@id': domain + '/#publisher' },
    creditText: attributionText({ pageUrl: domain + reportRoute(item), snapshotDate: reports.snapshotDate }),
    keywords: [...new Set([...KEYWORDS, ...String(item.tag ?? '').split(' · ').filter(Boolean)])],
    ...(variables.length ? { variableMeasured: variables } : {}),
    includedInDataCatalog: catalogRef(domain),
  };
}

/** Metadata fields added to every report JSON download. */
export function reuseFields({ item, reports, domain }) {
  const pageUrl = domain + reportRoute(item);
  return {
    license: { name: LICENSE.name, spdx: LICENSE.spdx, url: LICENSE.url, deedUrl: LICENSE.deedUrl, scope: LICENSE_SCOPE, notCovered: NOT_COVERED.map(notCoveredText) },
    sourceLicense: SOURCE_LICENSE,
    requiredAttribution: attributionText({ pageUrl, snapshotDate: reports.snapshotDate }),
    citationUrl: pageUrl, openDataUrl: domain + OPEN_DATA_ROUTE,
  };
}

// Report CSVs carry their metadata as columns on every row (원본출처, 원본SHA256); the reuse terms follow the same layout.
export const REUSE_CSV_COLUMNS = Object.freeze(['이용조건', '출처표기']);
export const CSV_LICENSE_NOTE = `${LICENSE.name} (${LICENSE.url}) · 치과데이터랩 집계값에 적용. 원자료와 인용한 외부 원문은 각 출처의 조건`;
export function withReuseColumns(rows, { item, reports, domain }) {
  const attribution = attributionText({ pageUrl: domain + reportRoute(item), snapshotDate: reports.snapshotDate });
  return rows.map((row, index) => [...row, ...(index === 0 ? REUSE_CSV_COLUMNS : [CSV_LICENSE_NOTE, attribution])]);
}

const codeStyle = 'display:block;overflow-wrap:anywhere;font-size:12px;line-height:1.7;padding:12px;margin:8px 0;background:#f5f5f7;border-radius:8px';
/** A copyable line. app.mjs copies the element's textContent, so escaped markup is copied as real HTML. */
export const copyLine = (id, text, label) => `<code id="${esc(id)}" style="${codeStyle}">${esc(text)}</code><button type="button" class="btn small" data-copy-citation data-citation-target="${esc(id)}">${esc(label)}</button>`;
export const licenseLink = (label = LICENSE.name) => externalLink(LICENSE.deedUrl, label, { rel: 'license noopener noreferrer' });

/** Licence and copy-ready attribution shown inside a report's “출처와 변경 기록” block. */
export function reuseNotice({ pageUrl, snapshotDate }) {
  return `<h3>이용 조건과 출처 표기</h3><p>이 리포트의 집계표·그래프와 CSV·JSON은 ${licenseLink()}으로 공개합니다. 아래 출처를 표시하면 허락을 따로 구하지 않고 인용·가공·재배포할 수 있으며 영리 목적도 가능합니다. 원자료는 ${externalLink(SOURCE_LICENSE.url, SOURCE_LICENSE.name)} 조건을 그대로 따르며, 리포트에 인용한 법령·안내문 등 외부 원문에는 이 조건이 적용되지 않습니다.</p>${copyLine('report-attribution', attributionText({ pageUrl, snapshotDate }), '출처 표기 복사')}<p><a href="${OPEN_DATA_ROUTE}">전체 집계 데이터와 이용 조건</a> · <a href="${PRESS_ROUTE}">보도·인용 안내</a></p>`;
}

/** Links to the open-data hub and the press page for hub-style pages. */
export const reuseLinks = () => `<div class="condition-links"><a href="${OPEN_DATA_ROUTE}">집계 데이터 내려받기와 이용 조건 ${icon('arrow')}</a><a href="${PRESS_ROUTE}">보도·인용 안내 ${icon('arrow')}</a></div>`;
