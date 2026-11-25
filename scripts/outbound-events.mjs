// Hand-off click counting: the one definition of the event that src/app.mjs sends, the Pages Worker accepts
// and scripts/outbound-report.mjs reads. docs/outbound-measurement.md says what is recorded and what is not.
//
// sameOriginRequest, smallBody and outboundDataPoint are copied verbatim (Function#toString) into the generated
// Worker by scripts/build-cloudflare.mjs. They may therefore only use the OUTBOUND_* constants below, which the
// Worker source defines under the same names, and Web-standard APIs.

export const OUTBOUND_ROUTE = '/e/outbound';
/** Analytics Engine binding (variable) name on the Pages project: env.OUTBOUND. Absent until the owner adds it. */
export const OUTBOUND_BINDING = 'OUTBOUND';
/** Dataset typed next to the binding in the dashboard; it is the table name in the SQL API. */
export const OUTBOUND_DATASET = 'dentaldatalab_outbound';
/** data-outbound values. tel/map/homepage/booking/share come from page markup; channel is every other own channel (blog, SNS…). */
export const OUTBOUND_KINDS = Object.freeze(['tel', 'map', 'homepage', 'booking', 'share', 'channel']);
export const OUTBOUND_MAX_BYTES = 512;
export const OUTBOUND_CLINIC = /^c-[a-f0-9]{12}$/;
/** location.pathname of a generated page: lower-case directory segments, no query, no file name. */
export const OUTBOUND_PAGE = /^\/(?:[a-z0-9][a-z0-9-]{0,39}\/){0,8}$/;

/**
 * True only when the browser itself marks the request as coming from this origin. A request that carries
 * neither header (curl, most crawlers and scripts) is not counted.
 */
export function sameOriginRequest(headers, origin) {
  const site = headers.get('Sec-Fetch-Site'), from = headers.get('Origin');
  if (site === null && from === null) return false;
  return (site === null || site === 'same-origin') && (from === null || from === origin);
}

/** Request body as text, or null when it is missing or longer than limit bytes. Stops reading at the limit. */
export async function smallBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit || !request.body) return null;
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

/**
 * The Analytics Engine data point for one event body, or null when the body is not exactly
 * {kind, clinic, page} with allowed values. blob3 keeps only the site section (first path segment):
 * the clinic id already says which institution, and nothing else about the visit is kept.
 */
export function outboundDataPoint(text) {
  let event;
  try { event = JSON.parse(text); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event) || Object.keys(event).length !== 3) return null;
  const { kind, clinic, page } = event;
  if (!OUTBOUND_KINDS.includes(kind)) return null;
  if (typeof clinic !== 'string' || !OUTBOUND_CLINIC.test(clinic)) return null;
  if (typeof page !== 'string' || !OUTBOUND_PAGE.test(page)) return null;
  return { blobs: [kind, clinic, page.split('/')[1] || 'home'], doubles: [1], indexes: [clinic] };
}
