// A task reads as a title + description. Newer tasks store `title`; older
// ones (and those made by the WordPress panel before it knew about titles)
// only have `feedback` HTML, so the first line of it stands in as the title.

export function htmlToText(html) {
  if (!html) return '';
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d|blockquote)>/gi, '$&\n');
  const doc = new DOMParser().parseFromString(withBreaks, 'text/html');
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const firstLine = (text) => (text.split('\n').find(l => l.trim()) || '').trim();

/** The task's title: its own, else the first line of its description. */
export function taskTitle(task) {
  if (!task) return '';
  if (task.title && task.title.trim()) return task.title.trim();
  const line = firstLine(htmlToText(task.feedback));
  return line.length > 140 ? `${line.slice(0, 137)}…` : line || 'Untitled task';
}

/** The description to show under the title (without the borrowed first line). */
export function taskBodyHtml(task) {
  if (!task) return '';
  if (task.title && task.title.trim()) return task.feedback || '';
  // Legacy: drop the first block, which is already showing as the title.
  const html = task.feedback || '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const body = doc.body;
  const first = Array.from(body.childNodes).find(n => (n.textContent || '').trim());
  if (!first) return '';
  if (first.nodeType === 3) {
    // A bare text node up to the first <br>.
    let n = first;
    while (n && !(n.nodeType === 1 && n.tagName === 'BR')) { const next = n.nextSibling; n.remove(); n = next; }
    if (n) n.remove();
  } else if (first.nodeType === 1 && /^(P|DIV|H\d|LI)$/.test(first.tagName)) {
    first.remove();
  } else {
    return html;
  }
  return body.innerHTML.replace(/^(\s|<br\s*\/?>)+/i, '');
}

/** Plain-text one-liner for search and previews. */
export function taskPreview(task, max = 160) {
  const t = htmlToText(task?.feedback || '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** "TF", "Shelving product pages", or a short form of a URL. */
export function pageLabel(page) {
  const p = (page || '').trim();
  if (!p) return '';
  try {
    if (/^https?:\/\//i.test(p)) {
      const u = new URL(p);
      const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
      return (u.host.replace(/^www\./, '') + (path || '')).slice(0, 80);
    }
  } catch { /* not a URL */ }
  return p;
}

export const isUrl = (s) => /^https?:\/\/\S+$/i.test((s || '').trim());
