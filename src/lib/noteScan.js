// ============================================================
// Notebook page scanning
// ------------------------------------------------------------
// Turns a photo of a handwritten checklist into quick-log candidates. The
// reading is done by a vision model behind /api/scan-notes (Gemini's free
// tier — see that file); on-device OCR couldn't read handwriting at all.
//
// The photo is drawn upright (EXIF) and shrunk to a JPEG first: plenty of
// detail for handwriting, small enough to upload quickly on mobile data and
// to stay under the server's body limit.
// ============================================================
import { supabase } from './supabase';

const MAX_SIDE = 1600;

async function toJpegBase64(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Couldn't open that photo."));
      img.src = URL.createObjectURL(file);
    });
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
}

let nextId = 0;
// Every checkbox line comes through approved; the review screen is where
// anything is denied or fixed.
export const newScanItem = ({ text = '', area = '', checked = null, unclear = false } = {}) =>
  ({ id: `scan-${Date.now()}-${nextId++}`, text, area, checked, unclear, approved: true });

// Photo → { items: [{ id, text, area, checked, unclear, approved }] }, in
// the order they're written on the page.
export async function scanNotebookPage(file, onProgress) {
  onProgress?.({ stage: 'Preparing the photo…', progress: 0.15 });
  const image = await toJpegBase64(file);

  onProgress?.({ stage: 'Reading your handwriting…', progress: 0.45 });
  const { data: { session } } = await supabase.auth.getSession();
  let res;
  try {
    res = await fetch('/api/scan-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
      body: JSON.stringify({ image, mimeType: 'image/jpeg' }),
    });
  } catch {
    throw new Error("Couldn't reach the scanner. Check your connection and try again.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    // The dev server (npm start) doesn't run /api functions; `vercel dev` does.
    if (res.status === 404 || !body) throw new Error('The scanner isn\'t available here — it runs on the deployed site (or `vercel dev`).');
    throw new Error(body.error || 'The scan failed. Try again.');
  }
  onProgress?.({ stage: 'Done', progress: 1 });
  return { items: (body.items || []).map(newScanItem) };
}
