import { esc, localDate } from '../src/shared.mjs';
import { publicSourceUrl } from './content-review-data.mjs';

const sourceLink = (url, title) => publicSourceUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)}</a>` : esc(title);
const date = value => value ? esc(localDate(value)) : '기록 없음';

export function registerContentReviewPage({ page, put, content, review }) {
  if (!content || !review) return;
  put('data/content/review-audit.json', JSON.stringify(review, null, 2));
  const s = review.summary;
  const rows = review.questions.map(q => `<tr id="review-${q.id}"><th scope="row"><a href="/questions/#${q.id}">${q.id}</a><br>${esc(q.question)}</th><td>${q.reviewer ? `${esc(q.reviewer.name)}<br><small>${esc(q.reviewer.qualification)}</small>` : '검토 기록 대기'}</td><td>${date(q.reviewedAt)}${q.nextReviewAt ? `<br><small>다음 검토 ${date(q.nextReviewAt)}</small>` : ''}</td><td>${q.publicationEligible ? '기록 조건 충족 · 별도 게시 결정 필요' : `<ul>${q.blockers.map(b => `<li>${esc(b.label)}</li>`).join('')}</ul>`}</td><td>${q.sourceIds.map(id => `<a href="#${id}">${id}</a>`).join(' · ')}</td></tr>`).join('');
  const sources = review.sources.map(source => `<article class="fact-panel" id="${source.id}"><h3>${source.id} · ${sourceLink(source.url, source.title)}</h3><p>${esc(source.publisher ?? '발행기관 미기록')} · 기존 원문 확인 ${date(source.catalogCheckedAt)}</p><p>${source.latestAccessCheck ? `이번 재열람: ${source.latestAccessCheck.status === 'read' ? '본문 확인' : '본문 확보 미완료'} · ${date(source.latestAccessCheck.checkedAt)}` : '이번 작업에서 재열람하지 않음 · 기존 기록만 유지'}</p>${source.latestAccessCheck?.sourcePageReviewedAt ? `<p class="subtle-note">원문 기관이 표시한 자체 검토일: ${esc(source.latestAccessCheck.sourcePageReviewedAt)}. 우리 답변의 의료진 검토일이 아닙니다.</p>` : ''}${source.latestAccessCheck?.note ? `<p class="subtle-note">${esc(source.latestAccessCheck.note)}</p>` : ''}<p>이 출처를 인용한 질문: ${source.questionIds.map(id => `<a href="#review-${id}">${id}</a>`).join(' · ')}</p></article>`).join('');
  page('/questions/review/', {
    title: '치료 질문의 검토 현황과 답변 근거', current: 'questions',
    description: '치료 질문 100개의 출처 기록, 의료진 검토 여부와 공개 전 남은 검토 항목을 확인하는 편집용 초안 화면입니다.',
    breadcrumb: [{ label: '치료 질문 100', url: '/questions/' }, { label: '검토 현황과 근거' }],
    body: `<div class="wrap content-studio"><header class="page-intro"><span class="pill neutral">편집 검토용 · 검색 노출 제외</span><h1>어디까지 확인한 답변인가요?</h1><p>질문마다 출처가 연결되어 있어도 의료진 검토가 끝난 것은 아닙니다.<br>원문 확인, 문안 검토, 공개 결정을 나누어 보여드립니다.</p><div class="hero-actions"><a class="btn" href="/questions/">질문과 답변으로 돌아가기</a><a class="btn" href="/data/content/review-audit.json" download>검토 현황 JSON</a></div></header>
    <div class="content-stats"><div><strong>${s.total}</strong><span>검토 대상 질문</span></div><div><strong>${s.clinicalApproved}</strong><span>의료진 승인 기록 충족</span></div><div><strong>${s.publicationEligible}</strong><span>공개 전 기록 조건 충족</span></div><div><strong>${s.sourcesReopened} / ${s.sources}</strong><span>이번에 재열람한 원문</span></div></div>
    <div class="source-banner"><div><strong>현재 ${s.pending}개 질문은 공개 전 검토가 남아 있습니다.</strong><p>이 화면과 치료 질문은 편집 초안으로 noindex를 유지합니다. 실제 검토자·자격 확인·검토일이 없으면 의료진 검토 완료로 표시하지 않습니다. 검색량이나 검색 순위도 이 검토로 확인되는 것은 아닙니다.</p><p class="subtle-note">기록 감사 기준일 ${date(review.auditedAt)}. 재열람 날짜는 링크된 원문을 확인한 때이며 답변의 의료 검토일이 아닙니다.</p></div></div>
    <section class="report-section prose"><h2>공개 전에 남겨야 할 기록</h2><ol><li>치과의사가 현재 질문·제목·답변을 검토하고, 검토자·자격 확인 근거·실제 검토일을 기록합니다.</li><li>각 인용의 해당 절과 답변을 뒷받침하는 범위를 대조합니다. 한국 보험·응급 연락체계·환자 안전 문구를 별도로 확인합니다.</li><li>의료 검토 뒤 편집 승인을 남깁니다. 문안이 바뀌거나 다음 검토일이 지나면 다시 검토합니다.</li></ol><p>기록 조건을 충족하더라도 자동으로 게시하거나 검색 노출을 허용하지 않습니다. 편집용 목록은 계속 검색 노출에서 제외하고, 최종 공개 문서는 별도로 결정합니다.</p></section>
    <section class="section" aria-labelledby="review-category-title"><h2 id="review-category-title">치료별 검토 현황</h2><div class="table-scroll" tabindex="0"><table class="simple-table"><thead><tr><th>분류</th><th>질문</th><th>의료진 승인 기록</th><th>공개 전 검토 필요</th></tr></thead><tbody>${review.categories.map(c => `<tr><th scope="row">${esc(c.label)}</th><td>${c.count}</td><td>${c.clinicalApproved}</td><td>${c.pending}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="section" aria-labelledby="review-questions-title"><h2 id="review-questions-title">질문별 검토 기록</h2><p>번호를 누르면 현재 초안을, 출처 번호를 누르면 원문과 확인 기록을 볼 수 있습니다.</p><div class="table-scroll" tabindex="0"><table class="simple-table"><thead><tr><th>질문</th><th>의료진 검토자</th><th>의료진 검토일</th><th>공개 전 남은 일</th><th>답변 근거</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="section" aria-labelledby="review-sources-title"><h2 id="review-sources-title">원문과 인용 질문 연결</h2><p>${s.sourceMetadataComplete} / ${s.sources}개 출처에 발행기관·제목·기존 확인일이 기록되어 있습니다. 이번에 재열람하지 않은 ${s.sourcesNotReopened}개는 현재 접근 가능 여부와 변경 여부를 확인한 것으로 표시하지 않습니다.</p>${sources}</section></div>`,
  });
}
