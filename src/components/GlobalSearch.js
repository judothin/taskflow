import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { NAV_ITEMS } from '../lib/navLayout';
import ModalPortal from './ModalPortal';
import './GlobalSearch.css';

// Fire this from anywhere (sidebar button, mobile header) to open the palette:
//   window.dispatchEvent(new CustomEvent('open-global-search'))
export const OPEN_EVENT = 'open-global-search';

const ICONS = {
  task:       'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 12h6 M9 16h4',
  project:    'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  file:       'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z',
  submission: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M12 12v4 M10 14h4',
  page:       'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
};

const GROUP_ORDER = ['page', 'task', 'project', 'file', 'submission'];
const GROUP_LABEL = { page: 'Go to', task: 'Tasks', project: 'Projects', file: 'Files', submission: 'Submissions' };
const PER_GROUP = 6;

const norm = (s) => (s || '').toString().toLowerCase();
const strip = (html) => (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function Icon({ type }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ICONS[type] || ICONS.page} />
    </svg>
  );
}

export default function GlobalSearch() {
  const navigate = useNavigate();
  const { activeTeamId } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ tasks: [], projects: [], files: [], submissions: [] });
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const close = useCallback(() => { setOpen(false); setQuery(''); setActiveIdx(0); }, []);

  // ── Open trigger: the custom open event (fired by the "/" shortcut and the
  //    sidebar search button). ──
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  // Fetch the searchable corpus for the active team each time we open. The
  // datasets are team-scoped and small enough to filter on the client.
  useEffect(() => {
    if (!open || !activeTeamId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [tasks, projects, files, submissions] = await Promise.all([
        supabase.from('tasks').select('id, page, feedback, noticed_by, status, roi').eq('team_id', activeTeamId).order('date_received', { ascending: false }).limit(500),
        supabase.from('projects').select('id, title, description, status').eq('team_id', activeTeamId).order('updated_at', { ascending: false }).limit(300),
        supabase.from('file_entries').select('id, name, path, section, description').eq('team_id', activeTeamId).limit(500),
        supabase.from('submissions').select('id, page, feedback, noticed_by, status').eq('team_id', activeTeamId).order('created_at', { ascending: false }).limit(300),
      ]);
      if (cancelled) return;
      setData({
        tasks: tasks.data || [],
        projects: projects.data || [],
        files: files.data || [],
        submissions: submissions.data || [],
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, activeTeamId]);

  // ── Build the (grouped) result set for the current query ──
  const groups = useMemo(() => {
    const q = norm(query).trim();
    const pages = Object.entries(NAV_ITEMS)
      .map(([id, item]) => ({ type: 'page', id, title: item.label, subtitle: item.to, to: item.to }))
      .filter(p => !q || norm(p.title).includes(q));

    const matchTask = (t) => {
      const hay = `${norm(t.page)} ${norm(strip(t.feedback))} ${norm(t.noticed_by)} ${norm(t.status)} ${norm(t.roi)}`;
      return !q || hay.includes(q);
    };
    const tasks = data.tasks.filter(matchTask).map(t => ({
      type: 'task', id: t.id, title: t.page || '(no page)',
      subtitle: strip(t.feedback).slice(0, 80) || t.noticed_by || t.status,
      to: `/tasks/${t.id}`,
    }));

    const projects = data.projects
      .filter(p => !q || norm(p.title).includes(q) || norm(p.description).includes(q))
      .map(p => ({ type: 'project', id: p.id, title: p.title || '(untitled project)', subtitle: strip(p.description).slice(0, 80) || p.status, to: `/projects/${p.id}` }));

    const files = data.files
      .filter(f => !q || norm(f.name).includes(q) || norm(f.path).includes(q) || norm(f.section).includes(q) || norm(f.description).includes(q))
      .map(f => ({ type: 'file', id: f.id, title: f.name || f.path || '(file)', subtitle: [f.section, f.path].filter(Boolean).join(' · ').slice(0, 80), to: '/files' }));

    const submissions = data.submissions
      .filter(s => {
        const hay = `${norm(s.page)} ${norm(strip(s.feedback))} ${norm(s.noticed_by)}`;
        return !q || hay.includes(q);
      })
      .map(s => ({ type: 'submission', id: s.id, title: s.page || '(submission)', subtitle: strip(s.feedback).slice(0, 80) || s.noticed_by || s.status, to: '/submissions' }));

    const byType = { page: pages, task: tasks, project: projects, file: files, submission: submissions };
    // When there's no query, don't dump every task/file — just show page jumps.
    if (!q) return [{ type: 'page', items: pages }];

    return GROUP_ORDER
      .map(type => ({ type, items: (byType[type] || []).slice(0, PER_GROUP) }))
      .filter(g => g.items.length > 0);
  }, [query, data]);

  // Flatten for keyboard navigation.
  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const activate = useCallback((item) => {
    if (!item) return;
    close();
    navigate(item.to);
  }, [close, navigate]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(flat[activeIdx]); }
  };

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  if (!open) return null;

  let runningIdx = -1;

  return (
    <ModalPortal>
      <div className="gs-overlay" onMouseDown={close}>
        <div className="gs-panel" onMouseDown={e => e.stopPropagation()} role="dialog" aria-label="Search">
          <div className="gs-input-row">
            <svg className="gs-input-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              className="gs-input"
              placeholder="Search tasks, projects, files, submissions…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <kbd className="gs-esc">Esc</kbd>
          </div>

          <div className="gs-results" ref={listRef}>
            {loading && flat.length === 0 ? (
              <div className="gs-empty">Loading…</div>
            ) : flat.length === 0 ? (
              <div className="gs-empty">
                {query.trim() ? <>No results for “{query.trim()}”</> : 'Type to search'}
              </div>
            ) : (
              groups.map(group => (
                <div key={group.type} className="gs-group">
                  <div className="gs-group-label">{GROUP_LABEL[group.type]}</div>
                  {group.items.map(item => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        data-idx={idx}
                        className={`gs-row ${idx === activeIdx ? 'gs-row-active' : ''}`}
                        onMouseMove={() => setActiveIdx(idx)}
                        onClick={() => activate(item)}
                      >
                        <span className="gs-row-icon"><Icon type={item.type} /></span>
                        <span className="gs-row-text">
                          <span className="gs-row-title">{item.title}</span>
                          {item.subtitle && <span className="gs-row-sub">{item.subtitle}</span>}
                        </span>
                        <span className="gs-row-type">{GROUP_LABEL[item.type]}</span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="gs-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>↵</kbd> open</span>
            <span><kbd>esc</kbd> close</span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
