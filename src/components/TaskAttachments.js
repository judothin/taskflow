import React from 'react';

const KIND = {
  pdf:   { color: '#f87171', label: 'PDF' },
  word:  { color: '#60a5fa', label: 'DOC' },
  pptx:  { color: '#fb923c', label: 'PPT' },
  excel: { color: '#4ade80', label: 'XLS' },
  image: { color: '#a78bfa', label: 'IMG' },
  file:  { color: '#9898b4', label: 'FILE' },
};

function kindOf(a) {
  if (a.kind) return a.kind === 'ppt' ? 'pptx' : a.kind;
  const ext = (a.name || a.url || '').split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['ppt', 'pptx'].includes(ext)) return 'pptx';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
  return 'file';
}

// Fetch as a blob and trigger a real download — the plain `download` attribute
// is ignored for cross-origin (Supabase storage) URLs, so we do it manually.
async function downloadFile(url, name) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objUrl;
    a.download = name || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
  } catch {
    window.open(url, '_blank', 'noopener'); // fallback: let the browser handle it
  }
}

export default function TaskAttachments({ attachments = [] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="task-attach-list">
      {attachments.map((a, i) => {
        const kind = kindOf(a);
        const meta = KIND[kind] || KIND.file;
        return (
          <div key={i} className="task-attach-item">
            {kind === 'image'
              ? <img src={a.url} alt={a.name || ''} className="task-attach-thumb" />
              : <span className="task-attach-badge" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>}
            <a className="task-attach-name" href={a.url} target="_blank" rel="noreferrer" title={a.name}>
              {a.name || 'Attachment'}
            </a>
            <a className="task-attach-act" href={a.url} target="_blank" rel="noreferrer" title="Open in a new tab">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6 M15 3h6v6 M10 14L21 3" />
              </svg>
              Open
            </a>
            <button type="button" className="task-attach-act" onClick={() => downloadFile(a.url, a.name)} title="Download">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M7 10l5 5 5-5 M12 15V3" />
              </svg>
              Download
            </button>
          </div>
        );
      })}
    </div>
  );
}
