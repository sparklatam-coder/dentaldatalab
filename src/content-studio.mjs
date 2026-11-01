export function matchesQuestion(record, filters) {
  const terms = String(filters.q ?? '').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return terms.every(term => record.text.normalize('NFKC').toLowerCase().includes(term))
    && ['category', 'intent', 'evidence', 'priority'].every(key => !filters[key] || record[key] === filters[key]);
}

if (typeof document !== 'undefined') {
  const form = document.querySelector('#content-filter');
  if (form) {
    const cards = [...document.querySelectorAll('[data-question-card]')];
    const indexed = cards.map(card => ({ card, text: card.textContent, ...card.dataset }));
    const count = document.querySelector('#content-count');
    const expand = document.querySelector('#content-expand');
    function syncExpand() {
      const details = cards.filter(card => !card.hidden).map(card => card.querySelector('.question-answer'));
      expand.disabled = details.length === 0;
      expand.textContent = details.length && details.every(detail => detail.open) ? '보이는 답변 모두 접기' : '보이는 답변 모두 펼치기';
    }
    function filter() {
      const values = Object.fromEntries(new FormData(form));
      for (const row of indexed) row.card.hidden = !matchesQuestion(row, values);
      const visible = cards.filter(card => !card.hidden).length;
      count.textContent = `${visible} / ${cards.length}개 질문`;
      document.querySelector('#content-empty').hidden = visible > 0;
      syncExpand();
    }
    function revealHash() {
      const id = location.hash.slice(1);
      if (!/^A\d{3}$/.test(id)) return;
      const card = cards.find(card => card.id === id);
      if (!card) return;
      if (card.hidden) { form.reset(); filter(); }
      card.querySelector('.question-answer').open = true;
      syncExpand();
      card.scrollIntoView({ block: 'start' });
    }
    form.addEventListener('submit', event => { event.preventDefault(); filter(); });
    form.addEventListener('input', filter);
    form.addEventListener('change', filter);
    form.addEventListener('reset', () => queueMicrotask(filter));
    expand.addEventListener('click', () => {
      const details = cards.filter(card => !card.hidden).map(card => card.querySelector('.question-answer'));
      const open = details.some(detail => !detail.open);
      for (const detail of details) detail.open = open;
      syncExpand();
    });
    for (const card of cards) card.querySelector('.question-answer').addEventListener('toggle', syncExpand);
    for (const link of document.querySelectorAll('[data-open-question]')) link.addEventListener('click', event => {
      event.preventDefault();
      const hash = `#${link.dataset.openQuestion}`;
      if (location.hash === hash) revealHash();
      else location.hash = hash;
    });
    window.addEventListener('hashchange', revealHash);
    revealHash();
  }
}
