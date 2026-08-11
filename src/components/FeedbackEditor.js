import React, { useRef, useEffect } from 'react';

// Strip pasted/foreign formatting (Word, light-mode colors, fonts) so content
// always renders in the app's own theme.
function normalizeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  // Legacy tasks may still carry the old inline checkbox rows — those are now
  // handled by real subtasks, so flatten any leftover checkbox markup to text.
  doc.body.querySelectorAll('input').forEach(el => el.remove());
  // Unwrap tags that only exist to carry styling.
  doc.body.querySelectorAll('font, o\\:p, span[style], style').forEach(el => {
    if (el.tagName.toLowerCase() === 'style') { el.remove(); return; }
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  });
  // Drop presentational attributes and foreign classes from everything left.
  doc.body.querySelectorAll('*').forEach(el => {
    ['style', 'color', 'bgcolor', 'face', 'align', 'width', 'height'].forEach(a => el.removeAttribute(a));
    if (el.className) el.removeAttribute('class');
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

  // Reflect external value changes into the DOM — e.g. batch-add clears
  // `feedback` for the next entry. Skip while the editor is focused so typing
  // never fights the caret (onInput already keeps state in sync then).
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !initialized.current) return;
    if (el === document.activeElement) return;
    const incoming = normalizeHtml(value || '');
    if (el.innerHTML !== incoming) el.innerHTML = incoming;
  }, [value]);

  const sync = () => onChange(editorRef.current.innerHTML);

  // Paste as plain text — never let external styling into the document.
  const handlePaste = (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    sync();
  };

  const bold = () => {
    document.execCommand('bold', false, null);
    editorRef.current.focus();
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
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onPaste={handlePaste}
        className="rich-editor-body"
        data-placeholder="Describe the issue or what needs to be fixed..."
      />
    </div>
  );
}
