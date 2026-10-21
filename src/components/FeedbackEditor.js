import React, { useRef, useEffect } from 'react';
import './FeedbackEditor.css';

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

// Rich-text description field. Bare by default (the borderless body of a
// sheet); `boxed` gives it a field border. ⌘/Ctrl+B bolds, paste is plain text.
export default function FeedbackEditor({ value, onChange, placeholder = 'Describe the issue, where it happens, and what done looks like…', boxed = false, autoFocus = false }) {
  const editorRef = useRef();
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && editorRef.current) {
      editorRef.current.innerHTML = normalizeHtml(value || '');
      initialized.current = true;
      if (autoFocus) editorRef.current.focus();
    }
  }, []);

  // Reflect outside changes (batch add clears the field) unless focused.
  useEffect(() => {
    const el = editorRef.current;
    if (!el || !initialized.current) return;
    if (el === document.activeElement) return;
    const incoming = normalizeHtml(value || '');
    if (el.innerHTML !== incoming) el.innerHTML = incoming;
  }, [value]);

  const sync = () => onChange(editorRef.current.innerHTML);

  const handlePaste = (e) => {
    // Images are the sheet's business (attachments) — let them bubble.
    const hasImage = Array.from(e.clipboardData?.items || []).some(it => it.kind === 'file');
    if (hasImage) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
    sync();
  };

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={sync}
      onPaste={handlePaste}
      className={`fb-editor ${boxed ? 'fb-editor-boxed' : ''}`}
      data-placeholder={placeholder}
      role="textbox"
      aria-multiline="true"
    />
  );
}
