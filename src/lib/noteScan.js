// ============================================================
// Notebook page scanning (on-device)
// ------------------------------------------------------------
// Reads a photo of a handwritten checklist into quick-log candidates, all in
// the browser — no server, no AI service. Tesseract (OCR) reads the text;
// checkboxes are found two ways, because OCR usually drops a hand-drawn box
// or reads it as junk:
//
//   1. text — the line's first "word" looks like a box: [ ], ☐, O, 0, D…
//   2. image — just left of the first word there's a small square outline:
//      two dark vertical edges about the line's height. Horizontal ruled
//      lines can't satisfy that, so notebook paper doesn't fool it.
//
// Handwriting OCR is approximate; the review screen is where it's fixed.
// Tesseract downloads its English model (~10 MB) on first use and caches it.
// ============================================================

const MAX_SIDE = 2000; // px — enough detail for handwriting, fast enough on a phone

// Draw the photo upright (EXIF), scaled down, then binarise it with Otsu's
// threshold: crisp black ink on white helps OCR far more than colour does,
// and the same pixels feed the checkbox detector.
async function loadAndBinarise(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't read that image."));
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = bitmap.width, h0 = bitmap.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const gray = new Uint8Array(w * h);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000 | 0;
    gray[j] = g; hist[g]++;
  }
  const threshold = otsu(hist, w * h);
  const dark = new Uint8Array(w * h);
  for (let j = 0, i = 0; j < gray.length; j++, i += 4) {
    const on = gray[j] < threshold;
    dark[j] = on ? 1 : 0;
    const v = on ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, dark, w, h };
}

function otsu(hist, total) {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; threshold = t; }
  }
  // Bias slightly toward paper so faint pencil still counts as ink.
  return Math.min(255, threshold + 8);
}

// A first word that's really a drawn box. OCR reads one as things like "[J",
// "[0", "[]", "LJ", "O" or "☐": any short token that opens or closes with a
// bracket, or a lone box-ish letter or symbol.
const BOX_TOKEN = /^([[({]\S{0,2}|\S{0,2}[\])}]|[☐☑☒□■▢▣◻◼○●◯]|[oO0QDUC][.,]?|LJ|\|_?\||\|)$/;
// Bullets and leftovers to strip from the start of the text.
const LEADING_JUNK = /^[\s\-–—•*·.,:;|_~=+>]+/;

// Is there a square outline in the strip just left of `x0`, spanning the
// line's height? Looks for at least two dark vertical edges far enough apart.
function boxLeftOf(dark, w, h, x0, y0, y1) {
  const lineH = y1 - y0;
  if (lineH < 8) return false;
  const top = Math.max(0, y0 - Math.round(lineH * 0.15));
  const bottom = Math.min(h - 1, y1 + Math.round(lineH * 0.15));
  const left = Math.max(0, Math.round(x0 - lineH * 2.2));
  const right = Math.max(left, x0 - 2);
  const span = bottom - top;
  const edges = [];
  for (let x = left; x <= right; x++) {
    let run = 0, bestRun = 0;
    for (let y = top; y <= bottom; y++) {
      if (dark[y * w + x]) { run++; if (run > bestRun) bestRun = run; } else run = 0;
    }
    if (bestRun >= span * 0.45) edges.push(x);
  }
  if (edges.length < 2) return false;
  const width = edges[edges.length - 1] - edges[0];
  return width >= lineH * 0.4 && width <= lineH * 2;
}

let workerPromise = null;
async function getWorker(onProgress) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') onProgress?.({ stage: 'Reading the page…', progress: m.progress });
          else if (/load|initializ/i.test(m.status)) onProgress?.({ stage: 'Getting the text reader ready…', progress: m.progress || 0 });
        },
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

let nextId = 0;
export const newScanItem = (text = '', hasBox = true, confidence = 100) =>
  ({ id: `scan-${Date.now()}-${nextId++}`, text, hasBox, confidence, approved: hasBox, area: '' });

// Photo → { items: [{ id, text, hasBox, confidence, approved, area }] }, one
// per line of writing, top to bottom.
export async function scanNotebookPage(file, onProgress) {
  onProgress?.({ stage: 'Preparing the photo…', progress: 0 });
  const { canvas, dark, w, h } = await loadAndBinarise(file);
  const worker = await getWorker(onProgress);
  onProgress?.({ stage: 'Reading the page…', progress: 0 });
  const { data } = await worker.recognize(canvas);

  // Tesseract 5 nests its result: blocks → paragraphs → lines → words.
  const lines = (data.blocks || []).flatMap(b => (b.paragraphs || []).flatMap(p => p.lines || []));

  const items = [];
  lines.forEach(line => {
    const words = (line.words || []).filter(wd => wd.text && wd.text.trim());
    if (!words.length) return;
    let start = 0;
    let hasBox = false;
    if (words.length > 1 && BOX_TOKEN.test(words[0].text.trim())) { hasBox = true; start = 1; }
    const first = words[start];
    if (!hasBox && first?.bbox) {
      hasBox = boxLeftOf(dark, w, h, first.bbox.x0, line.bbox.y0, line.bbox.y1);
    }
    const text = words.slice(start).map(wd => wd.text).join(' ').replace(LEADING_JUNK, '').trim();
    if ((text.match(/[a-z0-9]/gi) || []).length < 2) return; // smudges, stray marks
    items.push(newScanItem(text, hasBox, Math.round(line.confidence ?? 0)));
  });

  return { items };
}
