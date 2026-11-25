// Dental-hospital (종별코드 41) group pages: /hospitals/, /hospitals/<sidoCode>/, /hospitals/university/, /hospitals/disability/.
// Listings only: every institution is shown as the same card in 가나다순, counts come from the data, no ranking or quality words.
import {esc,fmt,icon,card,clinicUrl} from '../src/shared.mjs';
import {externalLink} from './html.mjs';
import {answerLinks,DISABILITY_CENTERS} from './answer-pages.mjs';
import {regionLabelSentence} from './region-notes.mjs';
import {externalFact} from './report-data.mjs';

export const HOSPITAL_TYPE='41';
// Citation (title, URL, edition, 확인일) comes from the single EXTERNAL_FACTS record that also drives the reports,
// institution panels and answer pages; only the plain-language summary for listings lives here.
const fact=externalFact;
const cite=(id,summary)=>{const f=fact(id);return {title:f.title,url:f.sourceUrl,edition:f.sourceTitle,checkedAt:f.checkedAt,summary};};
const CENTER_LEVELS=[...DISABILITY_CENTERS.centers.reduce((m,c)=>m.set(c.level,(m.get(c.level)??0)+1),new Map())].map(([level,n])=>`${level} ${n}곳`).join('·');
export const LEGAL_SOURCES=Object.freeze({
  classification:cite('medical-service-act-3-2','의원급 의료기관(의원·치과의원·한의원)은 주로 외래환자를, 병원급 의료기관(병원·치과병원·한방병원·요양병원·정신병원·종합병원)은 주로 입원환자를 대상으로 의료행위를 하는 기관으로 구분합니다.'),
  beds:cite('medical-service-act-3-2bis','30개 이상의 병상 요건은 병원·한방병원만 해당합니다(요양병원은 요양병상). 치과병원에는 병상 수 요건이 없습니다.'),
  // 보건복지부 장애인구강진료센터 page (data/content/disability-dental-centers.json): counts come from its table.
  disabilityCenters:{title:DISABILITY_CENTERS.source.title,url:DISABILITY_CENTERS.source.url,edition:`${DISABILITY_CENTERS.source.department} · 최종수정일 ${DISABILITY_CENTERS.source.pageModifiedAt}`,checkedAt:DISABILITY_CENTERS.source.checkedAt,
    summary:`구강보건법 제15조의2에 따라 보건복지부장관은 중앙장애인구강진료센터를, 시·도지사는 권역·지역장애인구강진료센터를 설치·운영합니다. 보건복지부 안내 표에는 ${CENTER_LEVELS}, 모두 ${DISABILITY_CENTERS.centers.length}곳이 있습니다.`},
});
const byName=(a,b)=>a.name.localeCompare(b.name,'ko')||String(a.id).localeCompare(String(b.id));
const labelOf=items=>{const counts=new Map();for(const c of items)counts.set(c,(counts.get(c)??0)+1);return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko')).map(x=>x[0]).join('·');};

/** Pure grouping: hospitals only, sorted; per-시도 (source sidoCode) with per-시군구 groups; name-based 대학/장애인 selections. */
export function groupHospitals(clinics){
  const hospitals=clinics.filter(c=>c?.typeCode===HOSPITAL_TYPE).sort(byName);
  const sido=new Map(),unplaced=[];
  for(const c of hospitals){
    if(!c.sidoCode){unplaced.push(c);continue;}
    if(!sido.has(c.sidoCode))sido.set(c.sidoCode,{sidoCode:c.sidoCode,labels:[],cities:new Map(),hospitals:[]});
    const r=sido.get(c.sidoCode);r.labels.push(c.sido??'');r.hospitals.push(c);
    const cityCode=c.cityCode??'';if(!r.cities.has(cityCode))r.cities.set(cityCode,{code:cityCode,labels:[],hospitals:[]});
    const city=r.cities.get(cityCode);city.labels.push(c.city??'');city.hospitals.push(c);
  }
  const bySido=[...sido.values()].sort((a,b)=>a.sidoCode.localeCompare(b.sidoCode)).map(r=>({sidoCode:r.sidoCode,name:labelOf(r.labels),count:r.hospitals.length,hospitals:r.hospitals,
    cities:[...r.cities.values()].map(c=>({code:c.code,name:labelOf(c.labels),count:c.hospitals.length,hospitals:c.hospitals})).sort((a,b)=>a.name.localeCompare(b.name,'ko')||a.code.localeCompare(b.code))}));
  return {hospitals,bySido,university:hospitals.filter(c=>c.name.includes('대학')),disability:hospitals.filter(c=>c.name.includes('장애인')),unplaced};
}

const note=snapshot=>`<div class="source-banner">${icon('source')}<div><strong>심평원 ${esc(snapshot)} 기준 등록 정보이며 현재 운영·진료 수준을 보증하지 않습니다.</strong><p>전문의 수와 장비는 신고된 등록 수이고, 미등록은 실제 미보유·휴진을 뜻하지 않습니다. 기관 간 우열이나 순위를 매기지 않으며 목록은 가나다순입니다. 방문 전 기관에 확인해 주세요.</p></div></div>`;
const intro=(title,desc,pills='')=>`<div class="page-intro"><div class="pill-row">${pills}</div><h1>${title}</h1><p>${desc}</p></div>`;
const source=s=>`${externalLink(s.url,s.title,{withIcon:true})} · ${esc(s.edition)} · 확인 ${esc(s.checkedAt)}`;
const legalParagraph=()=>`<section class="section prose" id="definition"><h2>치과병원은 법적으로 어떤 기관인가요?</h2><p>${esc(LEGAL_SOURCES.classification.summary)} 치과병원은 병원급 의료기관의 한 종류입니다.</p><p>${esc(LEGAL_SOURCES.beds.summary)} 종별은 법적 분류이며 진료의 질이나 범위를 뜻하지 않습니다.</p><p class="subtle-note">출처: ${source(LEGAL_SOURCES.classification)}<br>출처: ${source(LEGAL_SOURCES.beds)}</p></section>`;
// Summary-page lists carry only position and URL; each clinic page holds its own details (keeps the 248-item hub light).
const itemList=(domain,route,name,items)=>({'@context':'https://schema.org','@type':'ItemList','@id':domain+route+'#list',name,numberOfItems:items.length,itemListElement:items.map((c,i)=>({'@type':'ListItem',position:i+1,url:domain+clinicUrl(c)}))});
const grid=items=>`<div class="card-grid">${items.map(c=>card(c)).join('')}</div>`;
const crumbs=(...rest)=>[{label:'치과병원',url:'/hospitals/'},...rest];

export function registerHospitalPages({page,clinics,domain,snapshotDate,indexingEnabled=false}){
  if(typeof page!=='function'||!Array.isArray(clinics))throw new TypeError('registerHospitalPages needs page() and a clinics array');
  const g=groupHospitals(clinics),n=g.hospitals.length,snapshot=snapshotDate;
  const hub='/hospitals/';
  page(hub,{
    title:`전국 치과병원 ${fmt(n)}곳 | 시도별 목록과 법적 구분`,
    description:`심평원 ${snapshot} 자료의 치과병원(종별코드 41) ${fmt(n)}곳을 시도별로 찾고, 의료법상 치과의원과의 구분을 출처와 함께 확인합니다. 등록 정보이며 순위나 추천이 아닙니다.`,
    current:'hospitals',breadcrumb:[{label:'치과병원'}],
    schema:[itemList(domain,hub,`전국 치과병원 ${fmt(n)}곳`,g.hospitals)],
    body:`<div class="wrap">${intro(`전국 치과병원 ${fmt(n)}곳`,`치과의원 ${fmt(clinics.length-n)}곳과 구분되는 병원급 치과 ${fmt(n)}곳입니다. ${esc(snapshot)} 원자료 기준 · 시도코드별 목록.`,`<span class="pill">종별코드 41</span><span class="pill neutral">가나다순 · 순위 없음</span>`)}
    ${legalParagraph()}
    <section class="section" aria-labelledby="hospital-regions"><h2 id="hospital-regions">시도별 치과병원</h2><p class="subtle-note" style="margin:14px 0">원자료 시도코드 기준입니다. ${regionLabelSentence(clinics.filter(c=>c.typeCode===HOSPITAL_TYPE))}</p><div class="region-grid">${g.bySido.map(r=>`<a class="region-item" href="${hub}${esc(r.sidoCode)}/"><strong>${esc(r.name)}</strong><span>${fmt(r.count)}곳</span></a>`).join('')}</div></section>
    ${g.unplaced.length?`<section class="section" aria-labelledby="hospital-unplaced"><h2 id="hospital-unplaced">시도코드가 비어 있는 치과병원 ${fmt(g.unplaced.length)}곳</h2><p class="subtle-note" style="margin:14px 0">원자료에 시도코드가 없어 시도별 목록에 넣지 못한 기관입니다. 전국 합계에는 포함됩니다.</p>${grid(g.unplaced)}</section>`:''}
    <section class="section" aria-labelledby="hospital-groups"><h2 id="hospital-groups">이름으로 묶어 보기</h2><div class="region-grid"><a class="region-item" href="${hub}university/"><strong>기관명에 ‘대학’이 있는 치과병원</strong><span>${fmt(g.university.length)}곳</span></a><a class="region-item" href="${hub}disability/"><strong>기관명에 ‘장애인’이 있는 치과병원</strong><span>${fmt(g.disability.length)}곳</span></a></div><p class="subtle-note">두 묶음 모두 등록된 기관명 문자열로 고른 목록이며 대학 부속 여부나 장애인 진료 지정 여부를 확인한 목록이 아닙니다.</p></section>
    <section class="section" aria-labelledby="hospital-reports"><h2 id="hospital-reports">숫자로 읽기</h2><div class="condition-links"><a href="/reports/dental-hospitals/">치과병원 전수 리포트 ${icon('arrow')}</a><a href="/reports/dental-hospital-vs-clinic/">치과병원과 치과의원, 무엇이 다른가 ${icon('arrow')}</a><a href="/reports/dental-hospital-districts/">시·군·구별 치과병원 분포 ${icon('arrow')}</a><a href="/find/?type=41">조건으로 치과병원 찾기 ${icon('arrow')}</a><a href="/data/open/">집계 데이터 내려받기 ${icon('arrow')}</a><a href="/hospitals/info-card/">치과병원용 등록 정보 확인 카드 ${icon('arrow')}</a></div></section>
    <section class="section" aria-labelledby="hospital-answers"><h2 id="hospital-answers">짧게 묻고 답하기</h2>${answerLinks()}<p class="subtle-note">법령과 국민건강보험공단 안내 원문을 근거로 한 행정·제도 질문입니다. 치료 방법을 다루지 않습니다.</p></section>
    ${note(snapshot)}</div>`,
  });
  for(const r of g.bySido){
    const route=`${hub}${r.sidoCode}/`;
    page(route,{
      title:`${r.name} 치과병원 ${fmt(r.count)}곳 | 시군구별 목록`,
      description:`${r.name} 치과병원(종별코드 41) ${fmt(r.count)}곳의 주소·전문의 등록·콘빔CT 등록 자료를 시군구별 가나다순으로 확인합니다. 심평원 ${snapshot} 기준이며 현재 운영 여부는 별도 확인이 필요합니다.`,
      current:'hospitals',breadcrumb:crumbs({label:r.name}),
      schema:[itemList(domain,route,`${r.name} 치과병원 ${fmt(r.count)}곳`,r.hospitals)],
      body:`<div class="wrap">${intro(`${esc(r.name)} 치과병원 ${fmt(r.count)}곳`,`${r.cities.length}개 시군구코드 · 가나다순 · ${esc(snapshot)} 원자료 기준. 기관명을 누르면 주소·종별·항목별 근거를 확인할 수 있습니다.`,`<span class="pill">종별코드 41</span>`)}
      ${r.cities.map(c=>`<section class="section" aria-labelledby="city-${esc(c.code)}"><h2 id="city-${esc(c.code)}">${esc(c.name)} <small>${fmt(c.count)}곳</small></h2>${grid(c.hospitals)}</section>`).join('')}
      ${note(snapshot)}<p><a class="text-link" href="${hub}">다른 시도의 치과병원 ${icon('arrow')}</a> · <a class="text-link" href="/regions/${esc(r.sidoCode)}/">${esc(r.name)} 치과의원 포함 전체 목록 ${icon('arrow')}</a></p></div>`,
    });
  }
  page(`${hub}university/`,{
    title:`기관명에 ‘대학’이 있는 치과병원 ${fmt(g.university.length)}곳`,
    description:`심평원 ${snapshot} 자료의 치과병원 ${fmt(n)}곳 중 등록 기관명에 ‘대학’이 포함된 ${fmt(g.university.length)}곳의 가나다순 목록입니다. 기관명 문자열 기준이며 대학 부속·협력 여부를 확인한 목록이 아닙니다.`,
    current:'hospitals',breadcrumb:crumbs({label:'대학 치과병원'}),
    schema:[itemList(domain,`${hub}university/`,`기관명에 ‘대학’이 있는 치과병원 ${fmt(g.university.length)}곳`,g.university)],
    body:`<div class="wrap">${intro(`기관명에 ‘대학’이 있는 치과병원 ${fmt(g.university.length)}곳`,`치과병원 ${fmt(n)}곳 중 등록 기관명에 ‘대학’이 들어간 기관 · 가나다순 · ${esc(snapshot)} 기준.`,`<span class="pill">종별코드 41</span><span class="pill neutral">기관명 기준 선별</span>`)}
    <div class="source-banner warning">${icon('info')}<div><strong>등록 기관명 문자열로 고른 목록입니다.</strong><p>대학 부속·협력 여부, 수련 기관 여부를 별도로 확인하지 않았습니다. 이름에 ‘대학’이 없는 대학 관련 치과병원은 빠질 수 있고, 반대로 이름만으로 포함된 기관이 있을 수 있습니다. 전문의 수는 등록 수이며 순위가 아닙니다.</p></div></div>
    <section class="section" aria-labelledby="university-list"><h2 id="university-list">가나다순 목록</h2>${grid(g.university)}</section>${note(snapshot)}<p><a class="text-link" href="${hub}">전국 치과병원 ${icon('arrow')}</a></p></div>`,
  });
  const d=LEGAL_SOURCES.disabilityCenters;
  page(`${hub}disability/`,{
    title:`기관명에 ‘장애인’이 있는 치과병원 ${fmt(g.disability.length)}곳`,
    description:`심평원 ${snapshot} 자료의 치과병원 중 등록 기관명에 ‘장애인’이 포함된 ${fmt(g.disability.length)}곳입니다. 공공자료에는 장애인 진료 지정 항목이 없어 기관명 기준으로만 골랐으며, 장애인구강진료센터 지정 명단은 별도 출처입니다.`,
    current:'hospitals',breadcrumb:crumbs({label:'장애인 치과병원'}),
    schema:[itemList(domain,`${hub}disability/`,`기관명에 ‘장애인’이 있는 치과병원 ${fmt(g.disability.length)}곳`,g.disability)],
    body:`<div class="wrap">${intro(`기관명에 ‘장애인’이 있는 치과병원 ${fmt(g.disability.length)}곳`,`치과병원 ${fmt(n)}곳 중 등록 기관명에 ‘장애인’이 들어간 기관 · ${esc(snapshot)} 기준.`,`<span class="pill">종별코드 41</span><span class="pill neutral">기관명 기준 선별</span>`)}
    <div class="source-banner warning">${icon('info')}<div><strong>공공 원자료에는 장애인 진료 지정 여부 항목이 없습니다.</strong><p>이 목록은 등록 기관명 문자열로만 고른 것입니다. 장애인구강진료센터 명단은 심평원 자료에 없는 별도 출처이며, 보건복지부 안내의 중앙·권역센터 목록은 <a href="/guides/disability-dental-centers/">장애인 치과병원은 어디에 있나요?</a>에 정리했습니다. 이름에 ‘장애인’이 없는 센터 운영기관은 여기에 나오지 않습니다.</p></div></div>
    <section class="section" aria-labelledby="disability-list"><h2 id="disability-list">가나다순 목록</h2>${g.disability.length?grid(g.disability):'<p class="empty">해당 기관명이 없습니다.</p>'}</section>
    <section class="section prose" id="disability-centers"><h2>장애인구강진료센터 제도</h2><p>${esc(d.summary)}</p><p class="subtle-note">별도 공식 안내: ${source(d)}. 보건복지부가 안내하는 중앙·권역센터 운영기관 목록과 진료비 지원 기준은 <a href="/guides/disability-dental-centers/">장애인 치과병원은 어디에 있나요?</a>에 출처·확인일과 함께 정리했습니다.</p></section>
    ${note(snapshot)}<p><a class="text-link" href="${hub}">전국 치과병원 ${icon('arrow')}</a></p></div>`,
  });
  return {total:n,sido:g.bySido.length,university:g.university.length,disability:g.disability.length,indexingEnabled};
}
