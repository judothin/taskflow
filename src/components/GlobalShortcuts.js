import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import TaskForm from './TaskForm';
import QuickLogModal from '../pages/QuickLog';
import { OPEN_EVENT as OPEN_SEARCH } from './GlobalSearch';

// True when the keystroke is meant for a text field (or rich-text editor),
// where our single-key shortcuts must not hijack the input.
function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

// App-wide single-key shortcuts:
//   /  → focus/open global search
//   n  → new task
//   q  → quick log
// Owns global instances of the New Task and Quick Log modals so the shortcuts
// work on every page, not just the ones with their own toolbar buttons.
export default function GlobalShortcuts() {
  const { activeTeamId } = useTeam();
  const [showNewTask, setShowNewTask] = useState(false);
  const [showQuickLog, setShowQuickLog] = useState(false);
  const [users, setUsers] = useState([]);
  const [projects, setProjects] = useState([]);

  const loadFormData = useCallback(async () => {
    if (!activeTeamId) return;
    const [members, { data: projs }] = await Promise.all([
      fetchTeamMembers(activeTeamId),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId).order('title'),
    ]);
    setUsers((members || []).sort((a, b) => (a.first_name || '').localeCompare(b.first_name || '')));
    setProjects(projs || []);
  }, [activeTeamId]);

  useEffect(() => {
    const onKey = (e) => {
      // Let browser/OS chords and modifier combos through untouched.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      // Don't fire while any modal (ours or a page's) or the search palette is open.
      if (showNewTask || showQuickLog) return;
      if (document.querySelector('.modal-overlay, .gs-overlay')) return;

      if (e.key === '/') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(OPEN_SEARCH));
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        loadFormData();
        setShowNewTask(true);
      } else if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        setShowQuickLog(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNewTask, showQuickLog, loadFormData]);

  return (
    <>
      {showNewTask && (
        <TaskForm
          onClose={() => setShowNewTask(false)}
          onSaved={() => { setShowNewTask(false); window.dispatchEvent(new CustomEvent('tasks-changed')); }}
          users={users}
          projects={projects}
        />
      )}
      {showQuickLog && <QuickLogModal onClose={() => setShowQuickLog(false)} />}
    </>
  );
}
