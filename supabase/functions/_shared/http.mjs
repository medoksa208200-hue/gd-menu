// Shared response policy for the public Edge Functions. ALLOWED_ORIGINS (comma-separated, e.g.
// "https://gd-menu.pages.dev,https://www.example.com") restricts browser callers; when it is unset
// every origin is accepted so a fresh project keeps working until the secret is configured.
const MAX_BODY_BYTES = 16 * 1024;
export function responseHeaders(req) {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': !allowed.length ? '*' : allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
}
export function originAllowed(req) {
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map((o) => o.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  return !allowed.length || !origin || allowed.includes(origin);
}
// Rejects oversized or non-JSON bodies before parsing them.
export async function readJson(req) {
  if (!(req.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw new Error('Unsupported content type');
  if (Number(req.headers.get('content-length') || 0) > MAX_BODY_BYTES) throw new Error('Request too large');
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error('Request too large');
  const body = JSON.parse(text);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body');
  return body;
}
// Cloudflare sets cf-connecting-ip itself; the left-most x-forwarded-for entry can be supplied by the client.
export function clientAddress(req) {
  const forwarded = (req.headers.get('x-forwarded-for') || '').split(',').map((v) => v.trim()).filter(Boolean);
  return req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || forwarded[forwarded.length - 1] || 'unknown';
}
