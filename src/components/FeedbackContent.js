import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Renders a task's rich-text feedback (HTML) and makes its checkboxes
 * interactive everywhere — not just in the detail view.
 *
 * Toggling a checkbox flips the `checked` attribute in the stored HTML and
 * persists it to the task, so the state is shared for everyone and preserved
 * after completion.
 *
 *  - `taskId`    task whose `feedback` column we update
 *  - `html`      the feedback HTML
 *  - `className` wrapper class (defaults to the card style)
 *  - `onSaved`   optional callback fired after a successful save
 */
export default function FeedbackContent({ taskId, html, className = 'task-feedback', onSaved }) {
  const ref = useRef(null);
  const [localHtml, setLocalHtml] = useState(html || '');

  useEffect(() => { setLocalHtml(html || ''); }, [html]);

  const persist = async (nextHtml) => {
    if (!taskId) return;
    await supabase
      .from('tasks')
      .update({ feedback: nextHtml, updated_at: new Date().toISOString() })
      .eq('id', taskId);
    onSaved?.(nextHtml);
  };

  const handleClick = (e) => {
    const el = e.target;
    if (el.tagName !== 'INPUT' || !el.classList.contains('editor-cb')) return;

    // Don't let the click bubble to a parent (e.g. the card's navigate handler).
    e.stopPropagation();

    const boxes = Array.from(ref.current.querySelectorAll('input.editor-cb'));
    const idx = boxes.indexOf(el);
    if (idx === -1) return;

    // Edit the canonical HTML string so the saved state is reliable
    // (the live DOM `checked` *property* isn't reflected by innerHTML).
    const doc = new DOMParser().parseFromString(`<body>${localHtml || ''}</body>`, 'text/html');
    const parsed = doc.body.querySelectorAll('input.editor-cb');
    const target = parsed[idx];
    if (!target) return;

    if (target.hasAttribute('checked')) target.removeAttribute('checked');
    else target.setAttribute('checked', '');

    const nextHtml = doc.body.innerHTML;
    setLocalHtml(nextHtml);   // instant local feedback
    persist(nextHtml);        // share + save
  };

  return (
    <p
      ref={ref}
      className={className}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: localHtml }}
    />
  );
}
