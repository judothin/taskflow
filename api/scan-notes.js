// ============================================================
// Notebook page → checklist items, via Gemini (free tier).
//
// The phone's Quick Log "Scan a notebook page" posts a photo here:
//     POST /api/scan-notes   { image: <base64 JPEG>, mimeType }
//     Authorization: Bearer <Supabase access token>
// and gets back { items: [{ text, area, checked, unclear }] }.
//
// On-device OCR (Tesseract) couldn't read handwriting at all, so this uses a
// vision model instead. Gemini's free tier needs only an API key from Google
// AI Studio (no card). Set in Vercel → Settings → Environment Variables:
//     GEMINI_API_KEY   required
//     GEMINI_MODEL     optional — pin a model; otherwise the rolling
//                      flash alias is tried, then flash-lite, since free
//                      quotas per model change often.
// Free-tier requests may be used by Google to improve its products.
//
// Only signed-in TaskFlow users can call it (the token is checked against
// Supabase), so nobody else can spend the quota.
// ============================================================

const MAX_BASE64 = 4 * 1024 * 1024; // ~3 MB image; Vercel caps bodies at 4.5 MB
const TIMEOUT_MS = 25000;
const DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];

const PROMPT = `You are reading a photo of a handwritten notebook page that is used as a to-do checklist.

Return every checklist item on the page. Rules:
- A checklist item is a task that has a checkbox next to it. The box may be at the START or the END of the item.
- An item's text often wraps onto the next ruled line. Join wrapped lines into one item.
- "checked" is true if the box is ticked, crossed or filled in; false if it is empty.
- The page may define abbreviations, e.g. "Sg = Style gallery". When an item ends or starts with such an abbreviation (often after a dash, e.g. "... - Sg"), remove it from the text and put the expanded name in "area" ("Style gallery"). Otherwise "area" is an empty string.
- Ignore dates, headings, the abbreviation legend itself, doodles and anything without a checkbox.
- Keep the writer's wording. Fix only obvious misspellings caused by handwriting; do not add words.
- "unclear" is true if you are not confident you read the item's words correctly.
- Items in top-to-bottom order. If there are no checklist items, return an empty list.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          area: { type: 'STRING' },
          checked: { type: 'BOOLEAN' },
          unclear: { type: 'BOOLEAN' },
        },
        required: ['text', 'area', 'checked', 'unclear'],
      },
    },
  },
  required: ['items'],
};

async function isSignedIn(token) {
  const url = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;
  if (!url || !anon || !token) return false;
  try {
    const res = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
    return res.ok;
  } catch { return false; }
}

async function askGemini(model, key, image, mimeType) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: PROMPT }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { status: res.status, error: body?.error?.message || `Gemini error ${res.status}` };
    const text = (body?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const parsed = JSON.parse(text || '{}');
    return { items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (e) {
    return { status: 504, error: e.name === 'AbortError' ? 'The scan timed out.' : 'Could not read the scan result.' };
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    res.status(503).json({ error: 'Scanning isn\'t set up yet: add a GEMINI_API_KEY in Vercel (free from Google AI Studio).' });
    return;
  }

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!(await isSignedIn(token))) { res.status(401).json({ error: 'Sign in to scan.' }); return; }

  const { image, mimeType } = req.body || {};
  if (typeof image !== 'string' || !image || image.length > MAX_BASE64) {
    res.status(400).json({ error: 'Missing or oversized image.' });
    return;
  }
  const type = ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) ? mimeType : 'image/jpeg';

  // Free-tier quota is per model, so a quota or availability error on one
  // falls through to the next.
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : DEFAULT_MODELS;
  let last = null;
  for (const model of models) {
    const result = await askGemini(model, key, image, type);
    if (result.items) {
      const items = result.items
        .filter(it => it && typeof it.text === 'string' && it.text.trim())
        .map(it => ({
          text: it.text.trim(),
          area: typeof it.area === 'string' ? it.area.trim() : '',
          checked: !!it.checked,
          unclear: !!it.unclear,
        }));
      res.status(200).json({ items });
      return;
    }
    last = result;
    if (![404, 429, 500, 503, 504].includes(result.status)) break;
  }
  const busy = last?.status === 429;
  res.status(busy ? 429 : 502).json({
    error: busy ? "Today's free scanning limit is used up — try again later." : (last?.error || 'The scan failed.'),
  });
}
