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

    // The native click already flipped the checkbox's `checked` *property*.
    // Mirror it onto the *attribute* on the very element that was clicked, then
    // serialize the live container. This avoids matching checkboxes by index
    // between the DOM and the stored string, which drifts (and toggles the
    // wrong box) whenever the browser normalizes the rendered HTML.
    if (el.checked) el.setAttribute('checked', '');
    else el.removeAttribute('checked');

    const nextHtml = ref.current.innerHTML;
    setLocalHtml(nextHtml);   // instant local feedback
    persist(nextHtml);        // share + save
  };

  return (
    <div
      ref={ref}
      className={className}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: localHtml }}
    />
  );
}
