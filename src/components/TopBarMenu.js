import React, { useEffect, useRef, useState } from 'react';
import AnimatedPopover from './AnimatedPopover';
import { useTopBarMenuItems } from '../context/HeaderActionsContext';
import { OPEN_QUICK_LOG } from './GlobalShortcuts';
import { OPEN_QUICK_CONTEXT } from './QuickContext';
import './TopBarMenu.css';

// The top bar's "⋯" menu. Secondary actions live here instead of as a row of
// buttons: whatever the current page offers (TopBarMenuItems — e.g. Edit
// Dashboard), then the app-wide ones that work from any page. Those open by
// event, so their forms stay owned in one place (GlobalShortcuts, Layout).
const GLOBAL_ITEMS = [
  {
    key: 'log',
    label: 'Quick Log',
    hint: 'Q',
    icon: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
    onClick: () => window.dispatchEvent(new CustomEvent(OPEN_QUICK_LOG)),
  },
  {
    key: 'context',
    label: 'Save context',
    icon: 'M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
    onClick: () => window.dispatchEvent(new CustomEvent(OPEN_QUICK_CONTEXT)),
  },
];

function Icon({ d }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
    </svg>
  );
}

export default function TopBarMenu() {
  const pageItems = useTopBarMenuItems() || [];
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const choose = (item) => {
    setOpen(false);
    // Let the menu start closing before a modal opens over it.
    setTimeout(item.onClick, 60);
  };

  // --i staggers each row's entrance (TopBarMenu.css).
  const row = (item, i) => (
    <button key={item.key} type="button" role="menuitem" className="tbm-item" style={{ '--i': i }} onClick={() => choose(item)}>
      <span className="tbm-item-icon"><Icon d={item.icon} /></span>
      <span className="tbm-item-label">{item.label}</span>
      {item.hint && <kbd className="tbm-kbd">{item.hint}</kbd>}
    </button>
  );

  return (
    <div className="tbm" ref={ref}>
      <button
        type="button"
        className={`tbm-trigger ${open ? 'tbm-trigger-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More actions"
        title="More"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.9" /><circle cx="12" cy="12" r="1.9" /><circle cx="19" cy="12" r="1.9" />
        </svg>
      </button>
      <AnimatedPopover open={open} duration={140} className="tbm-popover" role="menu">
        {pageItems.map((item, i) => row(item, i))}
        {pageItems.length > 0 && <div className="tbm-sep" role="separator" />}
        {GLOBAL_ITEMS.map((item, i) => row(item, pageItems.length + i))}
      </AnimatedPopover>
    </div>
  );
}
