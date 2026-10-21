import React, { useEffect, useRef } from 'react';
import ModalPortal from '../components/ModalPortal';
import Icon from './Icon';

// Escape closes the topmost overlay only: every open sheet/dialog pushes
// itself onto this stack, and only the last one listens.
const stack = [];
export function useEscapeStack(onEscape, enabled = true) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!enabled) return undefined;
    const token = {};
    stack.push(token);
    const onKey = (e) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== token) return;
      e.preventDefault();
      ref.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.indexOf(token);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled]);
}

/**
 * The side sheet every "open a thing" view uses (a task, a review post, a
 * context entry, a file). Slides in from the right; full screen on a phone.
 *
 *   <Sheet eyebrow={<>TASK · <span className="t-4">Draft</span></>}
 *          onClose={close} onSubmit={save}
 *          aside={<>…right column…</>}
 *          footer={<>…buttons…</>}>
 *     …main column…
 *   </Sheet>
 *
 * Mount it conditionally ({open && <Sheet/>}); ModalPortal plays the exit.
 * ⌘/Ctrl + Enter calls onSubmit.
 */
export default function Sheet({
  eyebrow, onClose, onSubmit, children, aside, footer, size, className = '',
  mainClassName = '', asideClassName = '', onPaste, onDragEnter, onDragOver, onDragLeave, onDrop,
}) {
  useEscapeStack(onClose);

  useEffect(() => {
    if (!onSubmit) return undefined;
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSubmit]);

  return (
    <ModalPortal onDismiss={onClose}>
      <div className="sheet-overlay" onMouseDown={onClose} />
      <div
        className={`sheet ${size === 'sm' ? 'sheet-sm' : ''} ${className}`}
        role="dialog" aria-modal="true"
        onPaste={onPaste} onDragEnter={onDragEnter} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
      >
        <div className="sheet-head">
          <div className="sheet-eyebrow">{eyebrow}</div>
          <button type="button" className="sheet-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size={17} />
          </button>
        </div>
        <div className="sheet-body">
          <div className={`sheet-main ${mainClassName}`}>{children}</div>
          {aside && <div className={`sheet-aside ${asideClassName}`}>{aside}</div>}
        </div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </ModalPortal>
  );
}
