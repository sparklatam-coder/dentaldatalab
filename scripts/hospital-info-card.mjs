// Embeddable “심평원 등록 정보 확인” card for dental hospitals (종별코드 41): the code a hospital pastes into its own homepage,
// the hosted badge images, the institution-page panel (#info-card) and the instructions page /hospitals/info-card/.
// The card states one thing only: the institution's HIRA-registered information can be read on 치과데이터랩.
// It is a link, never a mark of certification, endorsement, ranking or partnership, so every string keeps to “등록 정보 확인”.
import {esc,fmt,icon,clinicUrl} from '../src/shared.mjs';
import {siteOrigin} from './seo.mjs';

export const INFO_CARD_ROUTE='/hospitals/info-card/';
export const INFO_CARD_BADGES=Object.freeze({light:'/badge/hira-registered-info.svg',dark:'/badge/hira-registered-info-dark.svg'});
export const INFO_CARD_BADGE_SIZE=Object.freeze({width:288,height:64});
export const INFO_CARD_LABEL='건강보험심사평가원 등록 정보 확인';
export const INFO_CARD_ACTION='치과데이터랩에서 등록 정보 보기';
// The one sentence that names what the card is not. Tests take it out before the banned-word guard and check it on its own.
export const INFO_CARD_DISCLAIMER='이 카드는 건강보험심사평가원 등록 정보를 확인하는 링크이며, 건강보험심사평가원이나 치과데이터랩의 인증·추천·평가·제휴·순위 표시가 아닙니다.';
export const INFO_CARD_USAGE_RULE='문구와 링크 주소는 바꾸지 않고 그대로 사용하며, 사용은 무료이고 사용 여부는 치과데이터랩의 목록 순서나 표시 내용에 영향을 주지 않습니다.';

const HOSPITAL_TYPE='41';
const isHospital=c=>c?.typeCode===HOSPITAL_TYPE;
const byName=(a,b)=>a.name.localeCompare(b.name,'ko')||String(a.id).localeCompare(String(b.id));
const linkText=c=>`${esc(c.name)} ${INFO_CARD_LABEL} · 치과데이터랩`;
// base is the canonical origin in pasted code and '' in previews on this site (CSP img-src 'self', review builds on other hosts).
function target(c,base){
  if(!/^c-[a-f0-9]{12}$/.test(c?.id??''))throw new TypeError(`Unexpected institution id: ${c?.id}`);
  if(typeof c.name!=='string'||!c.name.trim())throw new TypeError(`Institution ${c.id} has no name`);
  return esc(base+clinicUrl(c));
}

// Pasted into third-party CMSs: one line (editors turn line breaks into <br>), <div> blocks (no <p> margins from the host theme),
// unquoted font names (no nested quotes to mangle). Each element sets its own text and background colour with !important, the
// only !important here, so a host rule or dark-mode plugin cannot leave the text unreadable.
const FONT='-apple-system,BlinkMacSystemFont,Apple SD Gothic Neo,Malgun Gothic,Noto Sans KR,sans-serif';
const CARD_STYLE=`display:inline-block;box-sizing:border-box;width:340px;max-width:100%;margin:0;padding:12px 16px;border:1px solid #8e8e93;border-radius:10px;background-color:#ffffff !important;color:#1d1d1f !important;font-family:${FONT};font-size:14px;font-style:normal;font-weight:400;line-height:1.5;letter-spacing:normal;text-align:left;word-break:keep-all;overflow-wrap:anywhere`;
const cardMarkup=(c,base)=>`<div style="${CARD_STYLE}"><div style="margin:0;padding:0;background-color:#ffffff !important;color:#1d1d1f !important;font-size:14px;font-weight:700">${INFO_CARD_LABEL}</div><a href="${target(c,base)}" target="_blank" rel="noopener" style="display:block;margin:2px 0 0;padding:0;background-color:#ffffff !important;color:#0a4fb3 !important;font-size:13px;font-weight:400;text-decoration:underline">${esc(c.name)} · ${INFO_CARD_ACTION}</a></div>`;
const textMarkup=(c,base)=>`<a href="${target(c,base)}" target="_blank" rel="noopener">${linkText(c)}</a>`;
const imageMarkup=(c,base,dark)=>`<a href="${target(c,base)}" target="_blank" rel="noopener"><img src="${esc(base+INFO_CARD_BADGES[dark?'dark':'light'])}" alt="${linkText(c)}" width="${INFO_CARD_BADGE_SIZE.width}" height="${INFO_CARD_BADGE_SIZE.height}"></a>`;

/** Self-contained card: inline styles only, no external resource, exactly one visible link to the institution page. */
export const infoCardSnippet=(c,{domain}={})=>cardMarkup(c,siteOrigin(domain));
/** One-line text link for footers and link lists. */
export const infoCardTextLink=(c,{domain}={})=>textMarkup(c,siteOrigin(domain));
/** <a><img></a> with the hosted badge, for editors that strip style attributes. */
export const infoCardImageSnippet=(c,{domain,dark=false}={})=>imageMarkup(c,siteOrigin(domain),dark);

/** Hosted badge. Presentation attributes only (no <style>, script or external reference), so it renders the same inside <img>. */
export function infoCardBadgeSvg({dark=false}={}){
  const p=dark?{bg:'#1d1d1f',line:'#8e8e93',title:'#f5f5f7',sub:'#d1d1d6'}:{bg:'#ffffff',line:'#8e8e93',title:'#1d1d1f',sub:'#515154'};
  const {width,height}=INFO_CARD_BADGE_SIZE,font=`font-family="'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR','Noto Sans CJK KR',sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" lang="ko" aria-labelledby="hira-info-title hira-info-desc"><title id="hira-info-title">${INFO_CARD_LABEL}</title><desc id="hira-info-desc">치과데이터랩의 기관 페이지로 이동하는 링크 이미지입니다. 그 페이지에서 건강보험심사평가원에 등록된 기관 정보를 볼 수 있습니다.</desc><rect x=".5" y=".5" width="${width-1}" height="${height-1}" rx="12" fill="${p.bg}" stroke="${p.line}"/><g transform="translate(14 18) scale(.4375)"><rect width="64" height="64" rx="15" fill="#087969"/><g fill="#ffffff"><rect x="16" y="16" width="13" height="13" rx="3"/><rect x="35" y="16" width="13" height="13" rx="3" opacity=".5"/><rect x="16" y="35" width="13" height="13" rx="3"/><rect x="35" y="35" width="13" height="13" rx="3"/></g></g><text x="54" y="28" ${font} font-size="13" font-weight="700" fill="${p.title}">${INFO_CARD_LABEL}</text><text x="54" y="46" ${font} font-size="11" fill="${p.sub}">${INFO_CARD_ACTION}</text></svg>\n`;
}

// Sample code is escaped twice on purpose: the name inside the snippet, then the snippet for display. '&#38;' keeps that from
// reading as an accidental '&amp;amp;' to the static QA; a browser still shows and copies '&amp;'.
const codeText=html=>esc(html).replaceAll('&amp;','&#38;');
const codeBlock=(id,html)=>`<pre id="${id}" style="white-space:pre-wrap;word-break:break-all;margin:12px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;color:var(--text);font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"><code style="font:inherit;background:none;padding:0">${codeText(html)}</code></pre>`;
// Reuses the existing data-copy-citation handler in src/app.mjs, which copies the target element's textContent.
const copyButton=(id,label,primary=false)=>`<button type="button" class="btn ${primary?'primary':'small'}" data-copy-citation data-citation-target="${id}">${label}</button>`;
// The preview box borrows .prose so the unstyled text link shows as a link here, as it would on a typical host page.
const preview=(html,{dark=false}={})=>`<figure style="margin:14px 0 12px"><figcaption class="subtle-note">미리보기${dark?' · 어두운 배경':''}</figcaption><div class="prose" style="margin-top:6px;padding:16px;border:1px dashed #c7c7cc;border-radius:14px;background:${dark?'#1d1d1f':'#fff'}">${html}</div></figure>`;
const imageNote=origin=>`style 속성을 지우는 편집기용입니다. 이미지 배지는 방문자의 브라우저가 ${esc(new URL(origin).host)}에서 이미지 파일을 받아 오며, 카드와 텍스트 링크는 외부 파일을 불러오지 않습니다.`;
function variants(c,origin,prefix){
  const block=(key,title,make,options)=>({id:`${prefix}-code${key}`,title,preview:preview(make(c,''),options),code:make(c,origin)});
  return {
    card:block('','카드',cardMarkup),
    text:block('-text','텍스트 링크',textMarkup),
    image:block('-image','이미지 배지 · 밝은 배경용',(x,base)=>imageMarkup(x,base,false)),
    imageDark:block('-image-dark','이미지 배지 · 어두운 배경용',(x,base)=>imageMarkup(x,base,true),{dark:true}),
  };
}
const variantBlock=v=>`${v.preview}${copyButton(v.id,`${v.title} 코드 복사`)}${codeBlock(v.id,v.code)}`;

/** Institution-page panel (#info-card). Dental hospitals only; any other institution gets ''. */
export function infoCardPanel(c,{domain}={}){
  if(!isHospital(c))return '';
  const origin=siteOrigin(domain),v=variants(c,origin,'info-card');
  return `<section class="fact-panel" id="info-card"><div class="pill-row" style="margin-bottom:14px"><span class="pill outline">기관 담당자용</span><span class="pill neutral">무료</span></div><h2>홈페이지에 넣는 등록 정보 확인 카드</h2><p class="subtle-note">${esc(c.name)} 홈페이지에 아래 카드를 넣으면 방문자가 카드를 눌러 이 페이지의 건강보험심사평가원 등록 정보를 볼 수 있습니다.</p>${v.card.preview}<div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">${copyButton(v.card.id,'카드 코드 복사',true)}<a class="text-link" href="${INFO_CARD_ROUTE}">카드 사용 안내 ${icon('arrow')}</a></div>${codeBlock(v.card.id,v.card.code)}<details style="margin-top:16px"><summary style="cursor:pointer">다른 형식: 텍스트 링크 · 이미지 배지</summary><h3>텍스트 링크</h3>${variantBlock(v.text)}<h3>이미지 배지</h3><p class="subtle-note">${imageNote(origin)}</p>${variantBlock(v.image)}${variantBlock(v.imageDark)}</details><p class="subtle-note" style="margin-top:16px">${INFO_CARD_DISCLAIMER} ${INFO_CARD_USAGE_RULE}</p></section>`;
}

// 가나다순 list headings: 초성 of the first syllable, 쌍자음 under its plain consonant so groups stay contiguous in the sorted list.
const CHOSEONG='ㄱㄱㄴㄷㄷㄹㅁㅂㅂㅅㅅㅇㅈㅈㅊㅋㅌㅍㅎ';
const initialOf=name=>{const code=name.trim().charCodeAt(0);return code>=0xac00&&code<=0xd7a3?CHOSEONG[Math.floor((code-0xac00)/588)]:'숫자·영문';};
const intro=(title,desc,pills='')=>`<div class="page-intro"><div class="pill-row">${pills}</div><h1>${title}</h1><p>${desc}</p></div>`;

export function registerInfoCardPages({page,put,clinics,domain,snapshotDate}){
  if(typeof page!=='function'||typeof put!=='function'||!Array.isArray(clinics))throw new TypeError('registerInfoCardPages needs page(), put() and a clinics array');
  const origin=siteOrigin(domain),snapshot=esc(snapshotDate),hospitals=clinics.filter(isHospital).sort(byName),n=hospitals.length,example=hospitals[0];
  put(INFO_CARD_BADGES.light.slice(1),infoCardBadgeSvg());
  put(INFO_CARD_BADGES.dark.slice(1),infoCardBadgeSvg({dark:true}));
  const groups=new Map();
  for(const c of hospitals){const key=initialOf(c.name);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  const v=example?variants(example,origin,'info-card-sample'):null;
  const sample=v?`<h2 id="sample">예시와 세 가지 형식</h2><p>아래는 가나다순 첫 기관인 ${esc(example.name)}의 코드로 만든 예시입니다. 특정 기관을 고른 것이 아니며, 실제로는 각 기관 페이지에 있는 그 기관의 코드를 사용합니다.</p><section class="fact-panel"><h3 style="margin-top:0">1. 카드</h3><p class="subtle-note">외부 파일 없이 style 속성만으로 그려지는 기본 형식입니다.</p>${variantBlock(v.card)}</section><section class="fact-panel"><h3 style="margin-top:0">2. 텍스트 링크</h3><p class="subtle-note">푸터나 링크 목록에 한 줄로 넣는 형식입니다.</p>${variantBlock(v.text)}</section><section class="fact-panel"><h3 style="margin-top:0">3. 이미지 배지</h3><p class="subtle-note">${imageNote(origin)}</p>${variantBlock(v.image)}${variantBlock(v.imageDark)}</section>`:'';
  const list=n?[...groups].map(([key,items])=>`<h3 style="margin:28px 0 10px;font-size:18px">${esc(key)} <small>${fmt(items.length)}곳</small></h3><div class="region-grid" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${items.map(c=>`<a class="region-item" style="flex-direction:column;justify-content:flex-start;align-items:flex-start;gap:3px" href="${esc(clinicUrl(c))}#info-card"><strong>${esc(c.name)}</strong><span>${esc(c.sido??'')} ${esc(c.city??'')}</span></a>`).join('')}</div>`).join(''):'<p class="empty">이 자료에는 치과병원(종별코드 41)이 없습니다.</p>';
  page(INFO_CARD_ROUTE,{
    title:'치과병원 홈페이지용 ‘등록 정보 확인’ 카드 사용 안내',
    description:`치과병원 ${fmt(n)}곳이 자기 홈페이지에 넣을 수 있는 건강보험심사평가원 등록 정보 확인 카드의 뜻과 사용 방법, 문구 규칙입니다. 무료이며 목록 순서와 표시 내용에 영향을 주지 않습니다.`,
    current:'hospitals',breadcrumb:[{label:'치과병원',url:'/hospitals/'},{label:'등록 정보 확인 카드'}],
    body:`<div class="wrap narrow">${intro('홈페이지에 넣는 ‘심평원 등록 정보 확인’ 카드',`건강보험심사평가원 ${snapshot} 자료에 치과병원(종별코드 41)으로 등록된 ${fmt(n)}곳이 자기 홈페이지에 넣을 수 있는 링크 카드입니다. 카드를 누르면 치과데이터랩의 그 기관 페이지로 이동합니다.`,`<span class="pill">치과병원 ${fmt(n)}곳</span><span class="pill neutral">무료 · 신청 절차 없음</span>`)}
    <article class="prose"><h2 id="what" style="margin-top:0">이 카드가 알리는 것</h2><p>카드는 한 가지만 알립니다. 그 기관이 건강보험심사평가원에 등록한 정보(종별·주소·등록 인력·장비 등 공개된 공공데이터)를 치과데이터랩에서 확인할 수 있다는 것입니다.</p><div class="source-banner warning">${icon('info')}<div><strong>${INFO_CARD_DISCLAIMER}</strong><p>치과데이터랩은 건강보험심사평가원이 공개한 「전국 병의원 및 약국 현황」을 가공해 보여 주는 별도의 사이트이며, 건강보험심사평가원이 운영하는 사이트가 아닙니다. 등록 정보는 ${snapshot} 기준 분기 자료이고 현재의 운영 상태·인력·진료 내용을 확인한 결과가 아닙니다.</p></div></div>
    <h2 id="terms">무료이며 표시 순서와 무관합니다</h2><p>카드 사용은 무료이고 신청 절차가 없습니다. 코드를 복사해 넣으면 됩니다. 카드를 넣었는지는 치과데이터랩의 목록 순서(가나다순), 조건 검색 결과, 기관 페이지의 표시 내용에 영향을 주지 않습니다. 넣지 않은 기관도 같은 기준으로 표시합니다.</p>
    <h2 id="how">사용 방법</h2><ol><li><a href="#institutions">아래 가나다순 목록</a>에서 기관명을 눌러 기관 페이지의 ‘홈페이지에 넣는 등록 정보 확인 카드’ 항목(<code>#info-card</code>)으로 이동합니다.</li><li>‘카드 코드 복사’를 누릅니다. 코드에는 그 기관 페이지의 주소가 들어 있습니다.</li><li>홈페이지 관리 화면의 HTML 편집 영역(푸터, 병원 소개 등)에 붙여 넣습니다. 카드에는 기준일을 넣지 않았습니다. 기준일은 기관 페이지에 표시됩니다.</li><li>기관 페이지의 등록 정보가 실제와 다르면 <a href="/corrections/">정정 메모</a>로 알려 주세요.</li></ol>
    <h2 id="rules">문구 규칙</h2><ul><li>카드의 문구와 링크 주소는 바꾸지 않고 그대로 사용합니다. 문구를 고치거나 꾸밈말을 덧붙여 ‘등록 정보 확인’보다 큰 뜻으로 읽히게 해서는 안 됩니다. ${INFO_CARD_DISCLAIMER}</li><li>그 기관의 홈페이지에 그 기관의 코드만 넣습니다. 다른 기관의 코드를 쓰지 않습니다.</li><li>카드를 보이지 않게 숨기거나 같은 페이지에 여러 번 넣지 않습니다. 위치와 정렬은 홈페이지에 맞게 정할 수 있습니다.</li><li>링크에 <code>rel=&quot;nofollow&quot;</code>를 추가해도 됩니다. 예: <code>rel=&quot;noopener nofollow&quot;</code>. 새 창으로 열지 않으려면 <code>target=&quot;_blank&quot;</code>를 지워도 됩니다.</li><li>사용을 그만두려면 코드를 지우면 됩니다.</li></ul>
    ${sample}</article>
    <section class="section" id="institutions"><h2>치과병원 ${fmt(n)}곳 · 가나다순</h2><p class="subtle-note" style="margin:14px 0 0">건강보험심사평가원 ${snapshot} 자료의 종별코드 41 기관 전체입니다. 가나다순이며 순위가 아닙니다. 기관명을 누르면 그 기관 페이지의 카드 코드로 이동합니다.</p>${list}</section>
    <p style="margin-bottom:48px"><a class="text-link" href="/hospitals/">전국 치과병원 ${icon('arrow')}</a></p></div>`,
  });
  return {route:INFO_CARD_ROUTE,total:n,badges:Object.values(INFO_CARD_BADGES)};
}
