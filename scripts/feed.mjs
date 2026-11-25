// RSS 2.0 feed of reports, guides and hubs (/feed.xml). Naver Search Advisor and feed readers use it to pick up
// new pages; dates are the first publication dates kept in data/content/feed.json, never the build time.
const xml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[ch]));
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** RFC 822 date at 00:00 KST for a YYYY-MM-DD publication date. */
export function rfc822(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Invalid feed date: ' + date);
  const [y, m, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (day.getUTCMonth() !== m - 1 || day.getUTCDate() !== d) throw new Error('Invalid feed date: ' + date);
  return `${DAYS[day.getUTCDay()]}, ${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y} 00:00:00 +0900`;
}

/**
 * items: [{route, publishedOn}] from feed.json; meta: Map route → {title, description} from the pages actually built.
 * Routes that were not built are returned in `missing` and left out, so a renamed page cannot break the build.
 */
export function rssFeed({items, meta, domain, siteTitle = '치과데이터랩'}) {
  const seen = new Set(), missing = [], entries = [];
  for (const item of items) {
    if (!/^\/[a-z0-9/-]*\/$/.test(item.route ?? '')) throw new Error('Invalid feed route: ' + item.route);
    if (seen.has(item.route)) throw new Error('Duplicate feed route: ' + item.route);
    seen.add(item.route);
    const page = meta.get(item.route);
    if (!page) { missing.push(item.route); continue; }
    entries.push({...item, ...page, pubDate: rfc822(item.publishedOn)});
  }
  entries.sort((a, b) => b.publishedOn.localeCompare(a.publishedOn));
  const body = entries.map(e => `<item><title>${xml(e.title)}</title><link>${xml(domain + e.route)}</link><guid isPermaLink="true">${xml(domain + e.route)}</guid><pubDate>${e.pubDate}</pubDate><description>${xml(e.description)}</description></item>`).join('');
  const latest = entries[0]?.pubDate;
  return {
    missing,
    xml: `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${xml(siteTitle)} · 새 리포트와 가이드</title><link>${xml(domain)}/</link><atom:link href="${xml(domain)}/feed.xml" rel="self" type="application/rss+xml"/><description>치과 공공데이터 리포트, 조건별 치과 목록, 제도 안내를 새로 공개할 때 알려 드립니다.</description><language>ko</language>${latest ? `<lastBuildDate>${latest}</lastBuildDate>` : ''}${body}</channel></rss>`,
  };
}
