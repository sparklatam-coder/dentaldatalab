// Dental-hospital (종별코드 41) institution page blocks: the classification basis and a short FAQ.
// Every statement is either the public record (종별코드, 등록 수) or a cited law with its 확인일;
// nothing here evaluates the institution or compares it with others.
import {esc, fmt, icon} from '../src/shared.mjs';
import {EXTERNAL_FACTS} from './report-data.mjs';

const fact = id => EXTERNAL_FACTS.find(f => f.id === id);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
export const isDentalHospital = c => c?.typeCode === '41';

// 은/는 for the institution name; falls back to the combined form for non-Hangul endings.
export function topicParticle(text) {
  const last = String(text ?? '').trim().at(-1) ?? '';
  const code = last.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? '은' : '는';
  return '은(는)';
}

const law = id => {
  const f = fact(id);
  return f ? `<a href="${esc(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(f.title)} ${icon('link')}</a> · ${esc(f.sourceTitle)} · 확인 ${esc(f.checkedAt)}` : '';
};

export function hospitalClassificationPanel(c, {snapshot, ctCount = null} = {}) {
  if (!isDentalHospital(c)) return '';
  const specialist = c.doctors?.specialist;
  const classification = fact('medical-service-act-3-2'), beds = fact('medical-service-act-3-2bis');
  return `<section class="fact-panel" id="classification"><h2>치과병원으로 분류되는 근거</h2><table class="fact-table"><tbody><tr><th scope="row">원자료 종별</th><td>종별코드 41 · 치과병원<small>건강보험심사평가원 ${esc(snapshot)} 자료에 등록된 종별입니다. 치과데이터랩이 판단한 분류가 아닙니다.</small></td></tr><tr><th scope="row">법령상 구분</th><td>${esc(classification?.dentalHospital ?? '병원급 의료기관')}<small>${law('medical-service-act-3-2')}</small></td></tr><tr><th scope="row">병상 요건</th><td>${esc(beds?.dentalHospital ?? '병상 수 요건 없음')}<small>${law('medical-service-act-3-2bis')}</small></td></tr><tr><th scope="row">등록 자료 요약</th><td>치과전문의 ${isCount(specialist) ? fmt(specialist) + '명' : '자료 미확인'} · 콘빔CT ${isCount(ctCount) ? fmt(ctCount) + '대' : '자료 미확인'} 등록<small>등록 수이며 진료 실력·현재 인력이 아닙니다. 전국 치과병원의 분포는 아래 리포트에서 같은 기준으로 볼 수 있습니다.</small></td></tr></tbody></table><p class="subtle-note" style="margin-top:14px">종별은 법령의 분류이며 진료의 질이나 범위를 뜻하지 않습니다. ${esc(classification?.note ?? '')}</p><div class="pill-row" style="margin-top:14px"><a class="text-link" href="/hospitals/${esc(c.sidoCode)}/">${esc(c.sido)} 치과병원 목록 ${icon('arrow')}</a><a class="text-link" href="/reports/dental-hospitals/">치과병원 전수 리포트 ${icon('arrow')}</a><a class="text-link" href="/reports/dental-hospital-vs-clinic/">치과병원과 치과의원의 차이 ${icon('arrow')}</a></div></section>`;
}

export function hospitalFaq(c, {snapshot} = {}) {
  if (!isDentalHospital(c)) return null;
  const specialist = c.doctors?.specialist, particle = topicParticle(c.name);
  const classification = fact('medical-service-act-3-2'), beds = fact('medical-service-act-3-2bis');
  const items = [
    {q: `${c.name}${particle} 치과병원인가요?`, a: `네. 건강보험심사평가원 ${snapshot} 자료에 종별코드 41(치과병원)로 등록된 병원급 의료기관입니다. 현재 운영 상태는 별도로 확인해야 합니다.`},
    {q: `${c.name}의 치과전문의 등록 수는 몇 명인가요?`, a: isCount(specialist) ? `${snapshot} 자료 기준 치과전문의 ${fmt(specialist)}명이 등록돼 있습니다. 등록 인원이며 현재 근무 인원이나 진료 실력을 뜻하지 않습니다.` : `${snapshot} 자료에는 치과전문의 수가 기록돼 있지 않습니다. 전문의가 없다는 뜻은 아닙니다.`},
    {q: '치과병원은 치과의원과 무엇이 다른가요?', a: `의료법 제3조는 치과의원을 주로 외래환자를 대상으로 하는 의원급, 치과병원을 주로 입원환자를 대상으로 하는 병원급 의료기관으로 구분합니다. ${beds ? '30병상 요건은 병원·한방병원에만 해당하며 치과병원에는 병상 수 요건이 없습니다. ' : ''}종별은 법적 분류이며 진료의 질을 뜻하지 않습니다.`},
  ];
  const html = `<section class="fact-panel" id="faq"><h2>짧게 묻고 답하기</h2><dl class="faq-list">${items.map(x => `<div><dt>${esc(x.q)}</dt><dd>${esc(x.a)}</dd></div>`).join('')}</dl><p class="subtle-note" style="margin-top:14px">답변은 공공 등록 자료와 법령 문언(${esc(classification?.checkedAt ?? '')} 확인)만을 근거로 합니다. 치료 추천이나 기관 간 비교가 아닙니다.</p></section>`;
  const schema = {'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(x => ({'@type': 'Question', name: x.q, acceptedAnswer: {'@type': 'Answer', text: x.a}}))};
  return {html, schema, items};
}
