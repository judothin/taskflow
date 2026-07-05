import React, { useRef, useEffect } from 'react';

// Strip pasted/foreign formatting (Word, light-mode colors, fonts) so content
// always renders in the app's own theme. Keeps our checkbox markup intact.
function normalizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // Unwrap tags that only exist to carry styling.
  doc.body.querySelectorAll('font, o\\:p, span[style], style').forEach(el => {
    if (el.tagName.toLowerCase() === 'style') { el.remove(); return; }
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  // Drop presentational attributes from everything that's left.
  doc.body.querySelectorAll('*').forEach(el => {
    ['style', 'color', 'bgcolor', 'face', 'align', 'width', 'height'].forEach(a => el.removeAttribute(a));
    // Keep only our own classes (editor-cb / editor-cb-row); drop Word's Mso* etc.
    if (el.className && !/editor-cb/.test(el.className)) el.removeAttribute('class');
  });
  return doc.body.innerHTML;
}

export default function FeedbackEditor({ value, onChange }) {
  const editorRef = useRef();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && editorRef.current) {
      editorRef.current.innerHTML = normalizeHtml(value || '');
      initialized.current = true;
    }
  }, []);

  const sync = () => onChange(editorRef.current.innerHTML);

  // Paste as plain text — never let external styling into the document.
  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    sync();
  };

  const handleClick = (e) => {
    if (e.target.type === 'checkbox') {
      // Reflect the live property onto the attribute so innerHTML persists it.
      const cb = e.target;
      if (cb.checked) cb.setAttribute('checked', '');
      else cb.removeAttribute('checked');
      setTimeout(sync, 0);
    }
  };

  const bold = () => {
    document.execCommand('bold', false, null);
    editorRef.current.focus();
  };

  const addCheckbox = () => {
    editorRef.current.focus();
    document.execCommand('insertHTML', false,
      '<div class="editor-cb-row"><input type="checkbox" class="editor-cb">&nbsp;</div>'
    );
    sync();
  };

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter') return;

    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    // Walk up from cursor to see if we're inside a checkbox row
    let node = sel.anchorNode;
    let cbRow = null;
    while (node && node !== editorRef.current) {
      if (node.classList?.contains('editor-cb-row')) { cbRow = node; break; }
      node = node.parentNode;
    }
    if (!cbRow) return;

    e.preventDefault();

    const newRow = document.createElement('div');
    newRow.className = 'editor-cb-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'editor-cb';
    const spacer = document.createTextNode(' ');
    newRow.appendChild(cb);
    newRow.appendChild(spacer);
    cbRow.after(newRow);

    // Place cursor after the &nbsp; in the new row
    const range = document.createRange();
    range.setStart(spacer, 1);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);

    sync();
  };

  return (
    <div className="rich-editor-wrap">
      <div className="rich-editor-toolbar">
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); bold(); }}
          className="rich-toolbar-btn rich-toolbar-bold"
          title="Bold selected text"
        >
          B
        </button>
        <div className="rich-toolbar-divider" />
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); addCheckbox(); }}
          className="rich-toolbar-btn"
          title="Insert checkbox"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
            <rect x="0.5" y="0.5" width="13" height="13" rx="2.5" stroke="currentColor" />
            <path d="M3 7l2.5 2.5L11 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Checkbox
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        className="rich-editor-body"
        data-placeholder="Describe the issue or what needs to be fixed..."
      />
    </div>
  );
}
