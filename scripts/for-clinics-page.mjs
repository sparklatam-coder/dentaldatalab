// /for-clinics/: what a clinic's own staff need — where each displayed value comes from, how to get it corrected,
// and what this site will never do (rank, advertise, sell placement). No paid product is offered or implied.
import {esc, icon, SOURCE_URL} from '../src/shared.mjs';
import {externalLink} from './html.mjs';
import {mailtoHref, ISSUE_URL} from './site-operations.mjs';

export const NHI_ACT_ARTICLE_43 = Object.freeze({
  title: '국민건강보험법 제43조 (요양기관 현황에 대한 신고)',
  url: 'https://www.law.go.kr/법령/국민건강보험법/제43조',
});
export const HIRA_BIZ_PORTAL = Object.freeze({title: '건강보험심사평가원 요양기관업무포털', url: 'https://biz.hira.or.kr/'});
export const CORRECTION_SUBJECT = '[정정 요청] 기관명 / 페이지 주소';

const SOURCES = [
  {
    fields: '기관명·주소·신고 전화·종별·개설일·전문의 수·장비·심평원 등록 진료시간',
    source: `${externalLink(SOURCE_URL, '심평원 「전국 병의원 및 약국 현황」')} 분기 공개 파일`,
    change: '요양기관이 심평원에 신고한 현황을 바탕으로 공개되는 자료입니다. 원자료 값이 다르면 기관이 심평원 현황 신고를 먼저 바로잡아야 하며, 다음 분기 공개 파일을 반영할 때 이 사이트도 바뀝니다. 그 전에는 원자료 값을 임의로 고치지 않습니다.',
  },
  {
    fields: '네이버지도 진료시간·휴게·접수마감, 업체 작성 안내',
    source: '네이버지도 공개 화면을 직접 관찰한 기록 (항목마다 확인일 표시)',
    change: '네이버 스마트플레이스에서 기관이 직접 수정할 수 있습니다. 수정 후 정정 요청을 보내 주시면 다시 확인해 반영합니다.',
  },
  {
    fields: '홈페이지·블로그·SNS·예약 링크',
    source: '심평원에 등록된 홈페이지 주소와 공개 웹에서 찾은 주소. 웹에서 찾은 주소는 기관명과 전화·주소가 본문에서 대조되거나 기관 페이지가 직접 연결한 경우에만 링크를 엽니다.',
    change: '공식 주소가 빠졌거나 다른 기관의 주소가 연결되어 있으면 알려 주세요. 기관이 운영하는 페이지임을 확인할 수 있는 공개 근거를 함께 보내 주시면 됩니다.',
  },
];

export function forClinicsBody({correctionEmail = null, snapshot}) {
  const mail = correctionEmail ? `<a class="btn primary" href="${mailtoHref(correctionEmail, CORRECTION_SUBJECT)}">이메일로 정정 요청 ${icon('arrow')}</a>` : '';
  return `<div class="wrap narrow"><div class="page-intro"><div class="pill-row"><span class="pill">치과 관계자 안내</span><span class="pill neutral">비용 없음</span></div><h1>우리 치과 정보 확인·정정</h1><p>치과데이터랩에 표시되는 정보가 어디서 왔는지, 다르게 나오면 어떻게 바로잡는지 안내합니다.</p></div>
  <div class="answer-box"><p class="answer-lead">기관 정보는 심평원 공공데이터(${esc(snapshot)} 기준)와 공개 웹 관찰을 출처별로 나누어 보여 줍니다. 다른 점을 근거와 함께 알려 주시면 검토해 반영하며, 비용은 받지 않습니다.</p><p>광고·순위·추천·유료 노출이 없으므로, 비용을 내고 노출 위치나 표시 내용을 바꿀 수 있는 방법도 없습니다.</p><div class="answer-actions">${mail}<a class="text-link" href="/find/">우리 치과 페이지 찾기 ${icon('arrow')}</a></div></div>
  <section class="section prose" aria-labelledby="sources-title"><h2 id="sources-title">어떤 정보가 어디서 오나요?</h2><div class="table-scroll"><table class="simple-table"><caption class="sr-only">표시 항목별 출처와 바꾸는 방법</caption><thead><tr><th scope="col">표시 항목</th><th scope="col">출처</th><th scope="col">바뀌는 방법</th></tr></thead><tbody>${SOURCES.map(s => `<tr><th scope="row">${esc(s.fields)}</th><td>${s.source}</td><td>${esc(s.change)}</td></tr>`).join('')}</tbody></table></div><p class="subtle-note">현황 신고의 근거: ${externalLink(NHI_ACT_ARTICLE_43.url, NHI_ACT_ARTICLE_43.title, {withIcon: true})}. 신고 범위·방법·기한은 법령 원문과 ${externalLink(HIRA_BIZ_PORTAL.url, HIRA_BIZ_PORTAL.title, {withIcon: true})} 안내를 확인해 주세요.</p></section>
  <section class="section prose" aria-labelledby="request-title"><h2 id="request-title">정정 요청 보내는 법</h2><ol><li><strong>기관명과 이 사이트의 페이지 주소</strong> (치과 상세 페이지 주소 창의 URL)</li><li><strong>다르게 표시된 항목과 올바른 값</strong> (예: 토요일 진료시간, 홈페이지 주소)</li><li><strong>확인할 수 있는 공개 근거</strong> (기관 홈페이지·네이버지도 화면 주소 등)</li></ol><p>${correctionEmail ? `이메일 <a href="${mailtoHref(correctionEmail, CORRECTION_SUBJECT)}">${esc(correctionEmail)}</a> 또는 ` : ''}${externalLink(ISSUE_URL, '공개 정정 제보 양식(GitHub)', {withIcon: true})}으로 보내 주세요. 공개 양식에 올린 글은 누구나 볼 수 있습니다. 환자 정보나 개인 연락처는 적지 마세요.</p><p>보내 주신 근거로 기관을 식별하고 값을 대조한 뒤 반영하며, 반영한 내용은 해당 항목의 출처와 확인일로 표시합니다. 처리 기한을 약속하지는 않습니다. 자세한 절차는 <a href="/corrections/">정정 제보 안내</a>에 있습니다.</p></section>
  <section class="section prose" aria-labelledby="card-title"><h2 id="card-title">치과병원 홈페이지에 등록 정보 링크 넣기</h2><p>치과병원(종별코드 41)은 자기 기관의 등록 정보 페이지로 연결되는 ‘등록 정보 확인 카드’를 홈페이지에 넣을 수 있습니다. 카드는 건강보험심사평가원 등록 정보를 확인하는 링크일 뿐이며 인증·추천·평가·제휴 표시가 아닙니다. 사용은 무료이고, 사용 여부는 목록 순서나 표시 내용에 영향을 주지 않습니다.</p><p><a href="/hospitals/info-card/">등록 정보 확인 카드 안내와 코드 보기</a></p></section>
  <section class="section prose" aria-labelledby="never-title"><h2 id="never-title">치과데이터랩이 하지 않는 것</h2><ul><li>치과 순위·점수·추천, “잘하는 치과” 같은 평가</li><li>광고 게재, 유료 상단 노출, 노출 위치 판매</li><li>예약·상담 중개, 링크 클릭이나 예약 건당 수수료</li><li>후기·전후 사진·치료 경험담 게시</li></ul><p>목록은 모두 가나다순이며 모든 기관에 같은 처리 기준을 적용합니다. 운영 주체와 이해관계는 <a href="/about/">서비스 소개</a>에 공개합니다.</p></section></div>`;
}
