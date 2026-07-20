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
      // The native toggle has already flipped `checked`; reflect the property
      // onto the attribute so innerHTML (and therefore the saved value) keeps it.
      const cb = e.target;
      if (cb.checked) cb.setAttribute('checked', '');
      else cb.removeAttribute('checked');
      sync();
    }
  };

  const bold = () => {
    document.execCommand('bold', false, null);
    editorRef.current.focus();
  };

  const makeBox = () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'editor-cb';
    return cb;
  };

  // The top-level line (direct child of the editor) that a node sits in. Wraps a
  // bare inline node — e.g. the first line, typed before any <div> exists.
  const lineBlockOf = (node) => {
    while (node && node.parentNode !== editorRef.current) node = node.parentNode;
    if (!node || node === editorRef.current) return null;
    if (node.nodeType !== 1) {
      const wrap = document.createElement('div');
      node.parentNode.insertBefore(wrap, node);
      wrap.appendChild(node);
      return wrap;
    }
    return node;
  };

  const placeCaret = (target, offset) => {
    const r = document.createRange();
    r.setStart(target, offset);
    r.collapse(true);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  };

  const addCheckbox = () => {
    editorRef.current.focus();
    const sel = window.getSelection();
    const block = sel.rangeCount ? lineBlockOf(sel.getRangeAt(0).startContainer) : null;

    // Turn the current text line into a checkbox row — the box goes at the front
    // and the existing text stays on the same line. Skip if the line already has
    // a box (then fall through to adding a fresh row below).
    if (block && !block.querySelector('input.editor-cb')) {
      block.classList.add('editor-cb-row');
      // Drop a lone <br> filler so the empty row doesn't force a wrap.
      if (block.childNodes.length === 1 && block.firstChild.nodeName === 'BR') {
        block.firstChild.remove();
      }
      const first = block.firstChild;
      block.insertBefore(makeBox(), first);
      if (first && first.nodeType === 3) {
        placeCaret(first, 0);            // caret just before the line's text
      } else {
        const spacer = document.createTextNode(' ');
        block.insertBefore(spacer, first);
        placeCaret(spacer, 1);
      }
      sync();
      return;
    }

    // No usable line (empty editor) or the line already has a box → new row below.
    const row = document.createElement('div');
    row.className = 'editor-cb-row';
    const spacer = document.createTextNode(' ');
    row.appendChild(makeBox());
    row.appendChild(spacer);
    if (block) block.after(row);
    else editorRef.current.appendChild(row);
    placeCaret(spacer, 1);
    sync();
  };

  // Backspace at the very start of a plain line, when a checkbox row sits above,
  // pulls that line's text up onto the checkbox's line instead of leaving it
  // stranded below. Returns true if it handled the key.
  const mergeIntoCheckboxAbove = (e, sel) => {
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;

    let block = range.startContainer;
    while (block && block.parentNode !== editorRef.current) block = block.parentNode;
    if (!block || block.nodeType !== 1) return false;
    // Don't merge one checkbox line into another — only plain text lines.
    if (block.querySelector('input.editor-cb')) return false;

    const prev = block.previousElementSibling;
    if (!prev || !prev.classList.contains('editor-cb-row')) return false;

    // Caret must be at the very start of this line (no text before it).
    const probe = range.cloneRange();
    probe.selectNodeContents(block);
    probe.setEnd(range.startContainer, range.startOffset);
    if (probe.toString().length !== 0) return false;

    e.preventDefault();

    const junction = prev.textContent.length;   // where the merged text begins
    let child;
    while ((child = block.firstChild)) {
      if (child.nodeName === 'BR') child.remove();  // drop line-break fillers
      else prev.appendChild(child);
    }
    block.remove();
    prev.normalize();                            // fuse adjacent text runs

    // Put the caret at the seam between the row's text and the merged text.
    const walker = document.createTreeWalker(prev, NodeFilter.SHOW_TEXT);
    let remaining = junction, target = null, offset = 0, n;
    while ((n = walker.nextNode())) {
      if (remaining <= n.length) { target = n; offset = remaining; break; }
      remaining -= n.length;
    }
    if (target) {
      placeCaret(target, offset);
    } else {
      const r = document.createRange();
      r.selectNodeContents(prev);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }

    sync();
    return true;
  };

  const handleKeyDown = (e) => {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;

    if (e.key === 'Backspace') { mergeIntoCheckboxAbove(e, sel); return; }
    if (e.key !== 'Enter') return;

    // Walk up from cursor to see if we're inside a checkbox row
    let node = sel.anchorNode;
    let cbRow = null;
    while (node && node !== editorRef.current) {
      if (node.classList?.contains('editor-cb-row')) { cbRow = node; break; }
      node = node.parentNode;
    }
    if (!cbRow) return;

    e.preventDefault();

    // Empty checkbox row + Enter → exit the checklist onto a normal line,
    // so the list doesn't trap the cursor into adding endless empty boxes.
    const isEmpty = !/[^\s ]/.test(cbRow.textContent);
    if (isEmpty) {
      const line = document.createElement('div');
      line.appendChild(document.createElement('br'));
      cbRow.replaceWith(line);
      placeCaret(line, 0);
      sync();
      return;
    }

    const newRow = document.createElement('div');
    newRow.className = 'editor-cb-row';
    const spacer = document.createTextNode(' ');
    newRow.appendChild(makeBox());
    newRow.appendChild(spacer);
    cbRow.after(newRow);
    placeCaret(spacer, 1);   // cursor after the checkbox in the new row

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
