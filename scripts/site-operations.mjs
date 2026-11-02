import {esc} from '../src/shared.mjs';
export const ISSUE_URL='https://github.com/sparklatam-coder/dentaldatalab/issues/new?template=data-correction.yml';
export function validateOperator(value={}) {
 const name=value.operatorName??null,email=value.correctionEmail??null;
 if(name!==null&&(typeof name!=='string'||!name.trim()||name.length>100||/[\r\n<>]/.test(name)))throw new Error('Invalid public operator name');
 if(email!==null&&(typeof email!=='string'||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)||email.length>254))throw new Error('Invalid correction email');
 return {operatorName:name?.trim()??null,correctionEmail:email};
}
export function operatorPanel(config) {
 const c=validateOperator(config);
 return `<section class="fact-panel" id="operator-contact"><h2>운영과 오류 제보</h2><p>서비스 이름: 치과데이터랩</p><p>${c.operatorName?'공개 운영자명: '+esc(c.operatorName):'공개 운영자명은 확인 중입니다.'}</p>${c.correctionEmail?`<p>정정 문의: <a href="mailto:${esc(encodeURIComponent(c.correctionEmail).replace('%40','@'))}">${esc(c.correctionEmail)}</a></p>`:''}<p><a href="/corrections/">기관 정보 오류를 제보하는 방법</a> · <a href="/data/quality/">데이터 품질 점검 결과</a> · <a href="/data/search-status/">검색 등록·측정 현황</a></p></section>`;
}
export function correctionContact(config) {
 const c=validateOperator(config);
 return `<section class="fact-panel" id="submit-correction"><h2>공개된 기관 정보 오류 제보</h2><p>기관명, 잘못 표시된 항목, 공개된 근거 URL을 준비해 주세요. 접수된 내용은 근거 대조 → 기관 식별 → 수정 여부 검토 → 변경 기록 순서로 처리하며, 확인 전 원자료를 덮어쓰지 않습니다. 처리 기한은 아직 정하지 않았습니다.</p>${c.correctionEmail?`<p><a class="btn primary" href="mailto:${esc(encodeURIComponent(c.correctionEmail).replace('%40','@'))}?subject=${encodeURIComponent('[치과데이터랩] 공개정보 정정 요청')}">이메일로 정정 요청</a></p><p>환자 이름·증상·진료기록을 보내지 마세요. 메일 작성과 발송은 사용자의 메일 앱에서 진행됩니다.</p>`:''}<p><a class="btn" href="${ISSUE_URL}" target="_blank" rel="noopener noreferrer">GitHub 공개 제보 작성 ↗</a></p><p class="subtle-note">GitHub 계정이 필요하고 제출한 글은 누구나 볼 수 있습니다. 환자 이름·연락처·증상·진료기록·예약 내용은 적지 마세요. 아래 메모는 브라우저에서 작성·복사되며 자동으로 제출되지 않습니다. 외부 제보 화면에서 내용을 확인하고 직접 제출해 주세요.</p><p>의료상담·예약·긴급 연락을 받는 창구가 아닙니다.</p></section>`;
}
