import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { SCAN_EVENT, scanTopic, TAB_ID } from '../lib/scanBroadcast';
import './NoteScan.css';

// ══════════════════════════════════════════════════════════════
// "Scan added N tasks" — shown in every other TaskFlow tab you have open
// when a notebook scan is logged on your phone (lib/scanBroadcast.js).
// The lists refresh behind it; View goes to Completed.
// ══════════════════════════════════════════════════════════════

const SHOW_MS = 9000;

export default function ScanNotifier() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [note, setNote] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef(null);
  const paused = useRef(false);

  const hide = () => {
    clearTimeout(timer.current);
    setLeaving(true);
    timer.current = setTimeout(() => { setNote(null); setLeaving(false); }, 180);
  };
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (!paused.current) hide(); }, SHOW_MS);
  };

  useEffect(() => {
    if (!user?.id) return undefined;
    const ch = supabase
      .channel(scanTopic(user.id), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: SCAN_EVENT }, ({ payload }) => {
        if (!payload || payload.from === TAB_ID || !(payload.count > 0)) return;
        window.dispatchEvent(new CustomEvent('tasks-changed'));
        setLeaving(false);
        setNote(payload);
        arm();
        // In a background tab, a system notification if they've allowed them.
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(`Scan added ${payload.count} task${payload.count === 1 ? '' : 's'}`, {
              body: (payload.sample || []).join(' · '), tag: `scan-${payload.at || ''}`,
            });
          } catch { /* some browsers only allow these from a service worker */ }
        }
      })
      .subscribe();
    return () => { clearTimeout(timer.current); supabase.removeChannel(ch); };
  }, [user?.id]);

  if (!note) return null;
  const n = note.count;
  const sample = note.sample || [];
  const more = n - sample.length;
  return (
    <div className={`scan-note ${leaving ? 'scan-note-out' : ''}`} role="status" aria-live="polite"
      onMouseEnter={() => { paused.current = true; clearTimeout(timer.current); }}
      onMouseLeave={() => { paused.current = false; arm(); }}>
      <span className="scan-note-icon" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" /><circle cx="12" cy="13" r="4" />
        </svg>
      </span>
      <div className="scan-note-body">
        <b>Scan added {n} task{n === 1 ? '' : 's'}</b>
        {sample.length > 0 && (
          <span className="scan-note-sample">{sample.join(' · ')}{more > 0 ? ` · +${more} more` : ''}</span>
        )}
      </div>
      <button type="button" className="scan-note-view" onClick={() => { hide(); navigate('/completed'); }}>View</button>
      <button type="button" className="scan-note-x" onClick={hide} aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
      </button>
    </div>
  );
}
