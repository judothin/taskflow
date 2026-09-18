// ============================================================
// Server-side image proxy for deep-linked task attachments.
//
// The dev WordPress site sends no CORS headers, so the browser can't fetch its
// upload images directly. TaskForm calls:
//     /api/fetch-attachment?url=<absolute image url>
// and this function downloads it (with strict SSRF guards) and streams the
// bytes back same-origin, where the client wraps them in a File and runs them
// through the normal Supabase upload pipeline.
//
// Guards: only https://dev.palmerindustries.com/wp-content/uploads/… , no
// redirects (redirect:'error'), a fetch timeout, an image content-type, and a
// ~6 MB size cap.
// ============================================================

const ALLOWED_HOST = 'dev.palmerindustries.com';
const ALLOWED_PATH_PREFIX = '/wp-content/uploads/';
const MAX_BYTES = 6 * 1024 * 1024;         // 6 MB per file
const TIMEOUT_MS = 10000;
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }

  const raw = req.query?.url;
  const urlStr = Array.isArray(raw) ? raw[0] : raw;
  if (!urlStr || typeof urlStr !== 'string') {
    res.status(400).json({ error: 'missing url' });
    return;
  }

  let url;
  try { url = new URL(urlStr); } catch {
    res.status(400).json({ error: 'invalid url' });
    return;
  }

  // SSRF allowlist: exact host + uploads path only, https only.
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || !url.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
    res.status(400).json({ error: 'url not allowed' });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'error',              // a redirect could escape the allowlist → refuse
      headers: { Accept: 'image/*' },
    });
  } catch {
    clearTimeout(timer);
    res.status(502).json({ error: 'fetch failed or timed out' });
    return;
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    res.status(502).json({ error: `upstream ${upstream.status}` });
    return;
  }

  const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.includes(type)) {
    res.status(415).json({ error: 'not an allowed image type' });
    return;
  }

  const declared = Number(upstream.headers.get('content-length') || 0);
  if (declared && declared > MAX_BYTES) {
    res.status(413).json({ error: 'file too large' });
    return;
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.length > MAX_BYTES) {          // guard when content-length was absent/lying
    res.status(413).json({ error: 'file too large' });
    return;
  }

  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(buf);
}
