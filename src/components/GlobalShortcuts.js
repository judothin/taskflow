import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { consumeNewTaskDeepLink, clearDeepLinkFromUrl } from '../lib/deepLink';
import { OPEN_NEW_TASK, OPEN_TASK, OPEN_QUICK_LOG, OPEN_SEARCH, openSearch } from '../lib/events';
import { toast } from '../ui';
import TaskSheet from './TaskSheet';
import QuickLogModal from '../pages/QuickLog';

export { OPEN_NEW_TASK, OPEN_QUICK_LOG };

const isTyping = (el) => !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
const overlayOpen = () => [...document.querySelectorAll('.sheet, .dialog, .gs-overlay, .more-sheet')]
  .some(el => !el.closest('.modal-portal-exit'));

// Owns the app-wide task sheet and quick log, and the single-key shortcuts:
//   /  search      n  new task      q  log a completed task
// Anything that wants one of these fires the event in lib/events.js.
export default function GlobalShortcuts() {
  const { activeTeamId } = useTeam();
  const [sheet, setSheet] = useState(null); // { task?, prefill?, key }
  const [quickLog, setQuickLog] = useState(false);
  const [users, setUsers] = useState([]);
  const usersFor = useRef(null);

  const loadUsers = useCallback(async () => {
    if (!activeTeamId || usersFor.current === activeTeamId) return;
    usersFor.current = activeTeamId;
    const members = await fetchTeamMembers(activeTeamId);
    setUsers((members || []).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')));
  }, [activeTeamId]);

  useEffect(() => { usersFor.current = null; loadUsers(); }, [activeTeamId, loadUsers]);

  // A deep link (?new=1&page=…) opens a pre-filled new task once signed in.
  useEffect(() => {
    let dl = null;
    try { dl = consumeNewTaskDeepLink(); } catch { dl = null; }
    if (!dl) return;
    setSheet({ prefill: dl, key: Date.now() });
    clearDeepLinkFromUrl();
  }, []);

  useEffect(() => {
    const openNew = (e) => { loadUsers(); setSheet({ prefill: e.detail || null, key: Date.now() }); };
    const openOne = async (e) => {
      loadUsers();
      const d = e.detail || {};
      if (d.task) { setSheet({ task: d.task, key: Date.now() }); return; }
      if (!d.id) return;
      const { data, error } = await supabase.from('tasks').select('*').eq('id', d.id).maybeSingle();
      if (error || !data) { toast('That task couldn’t be found', { icon: 'alert' }); return; }
      setSheet({ task: data, key: Date.now() });
    };
    const openLog = () => setQuickLog(true);
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || overlayOpen()) return;
      if (e.key === '/') { e.preventDefault(); openSearch(); }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNew({ detail: null }); }
      else if (e.key === 'q' || e.key === 'Q') { e.preventDefault(); openLog(); }
    };
    window.addEventListener(OPEN_NEW_TASK, openNew);
    window.addEventListener(OPEN_TASK, openOne);
    window.addEventListener(OPEN_QUICK_LOG, openLog);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_NEW_TASK, openNew);
      window.removeEventListener(OPEN_TASK, openOne);
      window.removeEventListener(OPEN_QUICK_LOG, openLog);
      window.removeEventListener('keydown', onKey);
    };
  }, [loadUsers]);

  return (
    <>
      {sheet && (
        <TaskSheet
          key={sheet.key}
          task={sheet.task}
          prefill={sheet.prefill}
          users={users}
          onClose={() => setSheet(null)}
        />
      )}
      {quickLog && <QuickLogModal onClose={() => setQuickLog(false)} />}
    </>
  );
}

// Kept for older imports of the search event name.
export { OPEN_SEARCH };
