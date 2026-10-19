// ============================================================
// Notebook page → checklist items, via Gemini (free tier).
//
// The phone's Quick Log "Scan a notebook page" posts a photo here:
//     POST /api/scan-notes   { image: <base64 JPEG>, mimeType }
//     Authorization: Bearer <Supabase access token>
//     (optional: today: "YYYY-MM-DD" — the phone's own date, so a page date
//      written without a year lands in the right one;
//      pages: ["Homepage", ...] — page names the team already uses, so a page
//      written on the paper is matched to the existing spelling)
// and gets back { date, items: [{ text, area, checked, unclear, time }] }:
// date is the page's written date (YYYY-MM-DD) or "", time is a time written
// beside an item as 24-hour HH:MM, or "".
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

const promptFor = (today, pages) => `You are reading a photo of a handwritten notebook page that is used as a to-do checklist for website work.

Return every checklist item on the page. Rules:
- A checklist item is a task that has a checkbox next to it. The box may be at the START or the END of the item.
- An item's text often wraps onto the next ruled line. Join wrapped lines into one item.
- "checked" is true if the box is ticked, crossed or filled in; false if it is empty.
- "area" is the page (or part of the site) the item is about, when the notes say so. Find it in any of these ways:
  * An abbreviation the page defines, e.g. "Sg = Style gallery": an item ending or starting with "Sg" (often after a dash, "... - Sg") is about "Style gallery".
  * A page name written beside the item after a dash, colon or arrow: "Fix hero - Homepage", "About: swap photo", "Contact -> new form".
  * A section label the item sits under, typically a word or two followed by a dash or colon, underlined, or boxed (e.g. "Pricing -" with items listed below it). It applies to every item below it until the next such label.
  Put the page name in "area" and remove it (and its dash/colon) from the item's text. Only do this when the words name a page or section of a site; if a dash just continues the sentence ("call Sam - urgent"), leave the text as is. If you are not sure, leave "area" empty.${pages.length ? `
  * Pages this team already uses: ${JSON.stringify(pages)}. When the notes refer to one of these (same page, even if abbreviated, misspelled or differently cased), use that exact string as "area".` : ''}
  Otherwise "area" is an empty string.
- "time": if a time is written next to the item (e.g. "9:30", "2pm", "14:05", "@ 3"), give it as 24-hour HH:MM ("2pm" -> "14:00"). When am/pm is not written, pick the reading that makes sense for a work day (8:00-18:59). Otherwise an empty string.
- "date": if the page has a date written on it (usually at the top), give it as YYYY-MM-DD. Today is ${today}; if the year is not written, use the year that puts the date closest to today without being in the future. If there is no date, an empty string.
- Ignore headings (other than using them for "area"), the abbreviation legend itself, doodles and anything without a checkbox (a written date or time is only used for "date"/"time", never as an item).
- Keep the writer's wording. Fix only obvious misspellings caused by handwriting; do not add words.
- "unclear" is true if you are not confident you read the item's words correctly.
- Items in top-to-bottom order. If there are no checklist items, return an empty list.`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    date: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          area: { type: 'STRING' },
          checked: { type: 'BOOLEAN' },
          unclear: { type: 'BOOLEAN' },
          time: { type: 'STRING' },
        },
        required: ['text', 'area', 'checked', 'unclear', 'time'],
      },
    },
  },
  required: ['date', 'items'],
};

// The model's date and times are only trusted in the exact shapes asked for.
const cleanTime = (v) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
};
const cleanDate = (v) => {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? '' : s;
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

async function askGemini(model, key, image, mimeType, today, pages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mimeType, data: image } }, { text: promptFor(today, pages) }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { status: res.status, error: body?.error?.message || `Gemini error ${res.status}` };
    const text = (body?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    const parsed = JSON.parse(text || '{}');
    return { date: parsed.date, items: Array.isArray(parsed.items) ? parsed.items : [] };
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

  const { image, mimeType, today: clientToday, pages: clientPages } = req.body || {};
  // The team's known page names, so a scrawled "hp" can come back as "Homepage".
  const pages = [...new Set((Array.isArray(clientPages) ? clientPages : [])
    .filter(p => typeof p === 'string').map(p => p.trim().replace(/\s+/g, ' '))
    .filter(p => p && p.length <= 120))].slice(0, 80);
  const today = cleanDate(clientToday) || new Date().toISOString().slice(0, 10);
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
    const result = await askGemini(model, key, image, type, today, pages);
    if (result.items) {
      const items = result.items
        .filter(it => it && typeof it.text === 'string' && it.text.trim())
        .map(it => ({
          text: it.text.trim(),
          area: typeof it.area === 'string' ? it.area.trim() : '',
          checked: !!it.checked,
          unclear: !!it.unclear,
          time: cleanTime(it.time),
        }));
      const date = cleanDate(result.date);
      res.status(200).json({ date: date && date <= today ? date : '', items });
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
