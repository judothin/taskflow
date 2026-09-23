import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AnimatedPopover from './AnimatedPopover';
import ModalPortal from './ModalPortal';
import useIsPhone from '../lib/useIsPhone';
import { OPEN_NEW_TASK, OPEN_QUICK_LOG } from './GlobalShortcuts';
import { OPEN_QUICK_CONTEXT } from './QuickContext';
import './CreateMenu.css';

// One "+" for everything you can create, so making a thing never depends on
// first navigating to the page that owns it.
//
// Nothing here mounts its own modal. Task, Quick Log and Context are already
// owned app-wide and open by event; Project and File live on their own pages,
// so those navigate with a flag the page reads on arrival. That keeps a single
// implementation of each form.
const ITEMS = [
  {
    key: 'task',
    label: 'Task',
    hint: 'Something that needs doing',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 12h6 M9 16h4',
    run: ({ dispatch }) => dispatch(OPEN_NEW_TASK),
  },
  {
    key: 'log',
    label: 'Completed task',
    hint: 'Log something already finished',
    icon: 'M22 11.08V12a10 10 0 11-5.93-9.14 M22 4L12 14.01l-3-3',
    run: ({ dispatch, isPhone, navigate }) =>
      (isPhone ? navigate('/quicklog') : dispatch(OPEN_QUICK_LOG)),
  },
  {
    key: 'context',
    label: 'Context',
    hint: 'Something worth remembering',
    icon: 'M4 19.5A2.5 2.5 0 016.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
    run: ({ dispatch }) => dispatch(OPEN_QUICK_CONTEXT),
  },
  {
    key: 'project',
    label: 'Project',
    hint: 'Group related tasks',
    icon: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
    // Projects and Files are desktop pages, so creating one on a phone would
    // land you somewhere the companion deliberately doesn't go.
    desktopOnly: true,
    run: ({ navigate }) => navigate('/projects', { state: { create: true } }),
  },
  {
    key: 'file',
    label: 'File',
    hint: 'Record where code lives',
    icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6',
    desktopOnly: true,
    run: ({ navigate }) => navigate('/files', { state: { create: true } }),
  },
];

function Icon({ d }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
    </svg>
  );
}

export default function CreateMenu({ compact = false }) {
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Outside click closes it — only needed for the desktop popover; the phone
  // sheet has its own overlay.
  useEffect(() => {
    if (!open || isPhone) return undefined;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, isPhone]);

  useEffect(() => {
    if (!open) return undefined;
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open]);

  const items = ITEMS.filter(i => !(isPhone && i.desktopOnly));

  const choose = (item) => {
    setOpen(false);
    // Let the menu close before the modal opens, so they don't animate over
    // one another.
    setTimeout(() => {
      item.run({
        dispatch: (name) => window.dispatchEvent(new CustomEvent(name)),
        navigate,
        isPhone,
      });
    }, isPhone ? 180 : 60);
  };

  const trigger = (
    <button
      type="button"
      className={`create-trigger ${compact ? 'create-trigger-compact' : ''} ${open ? 'create-trigger-open' : ''}`}
      onClick={() => setOpen(v => !v)}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label="Create"
      title="Create"
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      {!compact && <span className="create-trigger-label">New</span>}
    </button>
  );

  const rows = items.map(item => (
    <button key={item.key} type="button" className="create-item" onClick={() => choose(item)} role="menuitem">
      <span className="create-item-icon"><Icon d={item.icon} /></span>
      <span className="create-item-text">
        <span className="create-item-label">{item.label}</span>
        <span className="create-item-hint">{item.hint}</span>
      </span>
    </button>
  ));

  // A phone gets the same bottom sheet as every other menu in the app; a
  // popover anchored to a 40px button is a desktop shape.
  if (isPhone) {
    return (
      <>
        {trigger}
        {open && (
          <ModalPortal onDismiss={() => setOpen(false)}>
            <div className="msheet-overlay" onClick={() => setOpen(false)}>
              <div className="msheet" onClick={e => e.stopPropagation()} role="menu" aria-label="Create">
                <span className="msheet-grabber" aria-hidden="true" />
                <h2 className="msheet-title">Create</h2>
                <div className="create-list">{rows}</div>
              </div>
            </div>
          </ModalPortal>
        )}
      </>
    );
  }

  return (
    <div className="create-menu" ref={ref}>
      {trigger}
      <AnimatedPopover open={open} className="create-popover" role="menu">
        {rows}
      </AnimatedPopover>
    </div>
  );
}
