import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { SCAN_EVENT, scanTopic, TAB_ID } from '../lib/scanBroadcast';
import { tasksChanged } from '../lib/events';
import { toast } from '../ui';
import './NoteScan.css';

// ══════════════════════════════════════════════════════════════
// "Scan added N tasks" — shown in every other TaskFlow tab you have open
// when a notebook scan is logged on your phone (lib/scanBroadcast.js).
// The lists refresh behind it; View goes to Completed. Renders nothing
// itself: the notice is an app toast.
// ══════════════════════════════════════════════════════════════

const SHOW_MS = 9000;

export default function ScanNotifier() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // A ref, so a navigation doesn't tear down and rejoin the channel.
  const nav = useRef(navigate);
  nav.current = navigate;

  useEffect(() => {
    if (!user?.id) return undefined;
    const ch = supabase
      .channel(scanTopic(user.id), { config: { broadcast: { self: false } } })
      .on('broadcast', { event: SCAN_EVENT }, ({ payload }) => {
        if (!payload || payload.from === TAB_ID || !(payload.count > 0)) return;
        tasksChanged();
        const n = payload.count;
        const sample = payload.sample || [];
        const more = n - sample.length;
        const title = `Scan added ${n} task${n === 1 ? '' : 's'}`;
        toast(
          <span className="ns-toast">
            <span>{title}</span>
            {sample.length > 0 && (
              <span className="ns-toast-sample">{sample.join(' · ')}{more > 0 ? ` · +${more} more` : ''}</span>
            )}
          </span>,
          { icon: 'camera', duration: SHOW_MS, action: { label: 'View', onClick: () => nav.current('/completed') } },
        );
        // In a background tab, a system notification if they've allowed them.
        if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification(title, { body: sample.join(' · '), tag: `scan-${payload.at || ''}` });
          } catch { /* some browsers only allow these from a service worker */ }
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id]);

  return null;
}
