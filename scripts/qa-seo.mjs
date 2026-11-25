// SEO checks for scripts/qa.mjs that need every generated page: one pass collects, the checks then assert.
// Pure functions over HTML strings so they can be unit-tested without a build.
const attr = (html, re) => html.match(re)?.[1] ?? null;
const decode = s => s.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');

export function pageSeo(html) {
  return {
    title: decode(attr(html, /<title>([^<]*)<\/title>/) ?? ''),
    description: decode(attr(html, /<meta name="description" content="([^"]*)"/) ?? ''),
    canonical: attr(html, /<link rel="canonical" href="([^"]*)"/),
    ogUrl: attr(html, /<meta property="og:url" content="([^"]*)"/),
    headings: [...html.matchAll(/<h([1-6])[\s>]/g)].map(m => Number(m[1])),
    ids: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap(m => {
      const out = [];
      const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === '@id' && typeof x === 'string') out.push(x); else walk(x); } };
      try { walk(JSON.parse(m[1])); } catch { /* invalid JSON-LD is reported by qa.mjs itself */ }
      return out;
    }),
  };
}

/** Problems on one page. A heading may go up any number of levels but down only one (h2→h4 is a skip). */
export function pageSeoErrors(route, html, domain) {
  const p = pageSeo(html), errors = [];
  if (p.ogUrl && p.ogUrl !== p.canonical) errors.push(`${route}: og:url differs from canonical`);
  for (const id of p.ids) if (!id.startsWith(domain + '/')) errors.push(`${route}: relative or foreign JSON-LD @id ${id}`);
  for (let i = 1; i < p.headings.length; i++) if (p.headings[i] > p.headings[i - 1] + 1) { errors.push(`${route}: heading skips from h${p.headings[i - 1]} to h${p.headings[i]}`); break; }
  if (!p.title.trim()) errors.push(`${route}: empty title`);
  return errors;
}

/** Duplicate titles or descriptions among the given pages ({route, title, description}). */
export function duplicateMeta(pages, field) {
  const seen = new Map();
  for (const p of pages) { const v = p[field]; if (!seen.has(v)) seen.set(v, []); seen.get(v).push(p.route); }
  return [...seen.entries()].filter(([, routes]) => routes.length > 1).map(([value, routes]) => ({ value, routes }));
}
