import {esc} from '../src/shared.mjs';
export function validateSearchStatus(status) {
 if(status?.schemaVersion!==1||status.origin!=='https://dentaldatalab.com'||!/^\d{4}-\d{2}-\d{2}$/.test(status.checkedOn))throw new Error('Invalid search status snapshot');
 if(!Array.isArray(status.engines)||status.engines.length!==3)throw new Error('Expected three search engines');
 for(const e of status.engines){
  if(!['Google','네이버','Bing'].includes(e.name))throw new Error('Unknown search engine');
  for(const key of ['indexedPages','impressions','clicks'])if(e[key]!==null&&(!Number.isSafeInteger(e[key])||e[key]<0))throw new Error('Unknown metrics must remain null');
  const u=new URL(e.sourceUrl);if(u.protocol!=='https:'||!['search.google.com','searchadvisor.naver.com','www.bing.com'].includes(u.hostname))throw new Error('Invalid search console source');
 }
 return status;
}
export const metricLabel=value=>value===null?'집계 대기':Number(value).toLocaleString('ko-KR');
export function registerSearchStatusPage({page,put,status}) {
 validateSearchStatus(status);put('data/search-status.json',JSON.stringify(status,null,2));
 page('/data/search-status/',{title:'검색 등록·색인·성과 확인 현황',description:'Google·네이버·Bing의 소유확인, 사이트맵 처리와 아직 집계되지 않은 검색 성과를 확인 시점과 함께 공개합니다.',current:'data',breadcrumb:[{label:'출처와 데이터',url:'/data/'},{label:'검색 등록·측정 현황'}],body:`<article class="wrap narrow"><header class="page-intro"><p class="eyebrow">SEARCH MEASUREMENT</p><h1>검색엔진에는 어디까지 전달됐나요?</h1><p>콘솔 직접 확인일: ${esc(status.checkedOn)}</p><p>${esc(status.method)}</p></header><div class="notice">사이트맵의 발견 URL 수는 색인된 페이지 수가 아닙니다. 아직 제공되지 않은 성과는 0으로 표시하지 않습니다.</div>${status.engines.map(e=>`<section class="fact-panel"><h2>${esc(e.name)}</h2><p>${esc(e.ownership)}</p><p>사이트맵: ${esc(e.sitemap)}</p><p>${esc(e.performance)}</p><dl><dt>색인 페이지 수</dt><dd>${metricLabel(e.indexedPages)}</dd><dt>검색 노출 수</dt><dd>${metricLabel(e.impressions)}</dd><dt>검색 클릭 수</dt><dd>${metricLabel(e.clicks)}</dd></dl><p><a href="${esc(e.sourceUrl)}" target="_blank" rel="noopener noreferrer">공식 콘솔 ↗</a> · 계정 소유자만 상세 보고서를 볼 수 있습니다.</p></section>`).join('')}<section class="fact-panel"><h2>자동 점검과 계정 보고서의 차이</h2><p>${esc(status.technicalMonitoring)}</p><p>${esc(status.indexNow)}</p><p>이 페이지는 확인 시점의 기록입니다. 검색엔진 보고서가 갱신되면 결과를 다시 대조해 반영합니다.</p></section><section class="fact-panel"><h2>성과가 집계되면 무엇을 바꾸나요?</h2><ol><li>색인 제외 사유를 페이지 유형별로 확인하고 대표 주소·오류·본문 품질을 점검합니다.</li><li>검색어와 해당 페이지가 실제 질문에 답하는지 대조합니다.</li><li>노출되지만 클릭이 적은 문서는 검색 의도와 제목·설명을 검토합니다. 모든 검색어에 같은 클릭률 기준을 적용하지 않습니다.</li><li>방문 후 필요한 출처·확인일·지역 자료로 이동할 수 있는지 점검합니다.</li></ol><p>현재는 성과가 집계되지 않아 특정 검색어 순위나 클릭률 개선 효과를 계산하지 않았습니다.</p><p><a href="/reports/">직접 집계한 지역 분석</a> · <a href="/data/quality/">데이터 품질 점검</a> · <a href="/data/search-status.json" download>확인 기록 JSON</a></p></section><section class="fact-panel"><h2>공식 안내</h2><ul><li><a href="https://developers.google.com/search/docs/monitor-debug/search-console-start" target="_blank" rel="noopener noreferrer">Google Search Console 활용</a></li><li><a href="https://searchadvisor.naver.com/guide/report-diagnosis" target="_blank" rel="noopener noreferrer">네이버 사이트 진단과 리포트 생성 조건</a></li></ul></section></article>`});
}
