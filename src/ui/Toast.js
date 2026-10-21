import React, { useEffect, useState } from 'react';
import Icon from './Icon';

// App-wide toasts, by event, so any module can raise one without a context:
//   toast('Task created')
//   toast('Task deleted', { action: { label: 'Undo', onClick: restore } })
const EVENT = 'tf-toast';
let seq = 0;

export function toast(message, opts = {}) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: ++seq, message, ...opts } }));
}

export function ToastHost() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    const timers = new Map();
    const dismiss = (id) => {
      setItems(list => list.map(t => (t.id === id ? { ...t, leaving: true } : t)));
      setTimeout(() => setItems(list => list.filter(t => t.id !== id)), 230);
    };
    const onToast = (e) => {
      const t = e.detail;
      setItems(list => [...list.slice(-2), t]);
      timers.set(t.id, setTimeout(() => dismiss(t.id), t.duration || (t.action ? 6000 : 3200)));
    };
    window.addEventListener(EVENT, onToast);
    ToastHost.dismiss = dismiss;
    return () => {
      window.removeEventListener(EVENT, onToast);
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map(t => (
        <div key={t.id} className={`toast ${t.leaving ? 'is-leaving' : ''}`}>
          {t.icon !== false && <Icon name={t.icon || 'check'} size={16} className={t.icon ? '' : 'toast-icon-ok'} />}
          <span>{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => { t.action.onClick?.(); ToastHost.dismiss?.(t.id); }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
