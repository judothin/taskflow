import React from 'react';
import ModalPortal from '../components/ModalPortal';
import { useEscapeStack } from './Sheet';

/**
 * Centred dialog (bottom sheet on a phone).
 *   <Dialog title="Delete task?" text="…" onClose={…} footer={<>…</>}>…</Dialog>
 */
export default function Dialog({ title, text, children, footer, onClose, size }) {
  useEscapeStack(onClose);
  return (
    <ModalPortal onDismiss={onClose}>
      <div className="dialog-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
        <div className={`dialog ${size === 'lg' ? 'dialog-lg' : ''}`} role="dialog" aria-modal="true">
          <div className="dialog-body">
            {title && <h2 className="dialog-title">{title}</h2>}
            {text && <p className="dialog-text">{text}</p>}
            {children}
          </div>
          {footer && <div className="dialog-foot">{footer}</div>}
        </div>
      </div>
    </ModalPortal>
  );
}

/** Yes/no confirm. `danger` makes the confirm button red. */
export function ConfirmDialog({ title, text, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, busy, onConfirm, onClose }) {
  return (
    <Dialog
      title={title}
      text={text}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{cancelLabel}</button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? <span className="spinner" /> : confirmLabel}
          </button>
        </>
      )}
    />
  );
}
