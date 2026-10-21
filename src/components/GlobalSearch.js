import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { SETTINGS_SECTIONS, sectionPath } from '../lib/settingsSections';
import { searchRank } from '../lib/fuzzySearch';
import { taskTitle, taskPreview, pageLabel, htmlToText } from '../lib/taskText';
import {
  openTask, openTaskMenu, openNewTask, openQuickLog, openQuickContext, openNotifications, openNoteScan,
} from '../lib/events';
import { Icon, STATUS_LABEL, cap } from '../ui';
import ModalPortal from './ModalPortal';
import { tagsOf } from './ContextSheet';
import './GlobalSearch.css';

// ══════════════════════════════════════════════════════════════
// Command palette — "/" anywhere (GlobalShortcuts fires the event), the
// top-bar search button, or the phone "More" sheet.
//   window.dispatchEvent(new CustomEvent('open-global-search'))
// Searches the team's tasks, review posts, context, files and guest
// submissions, plus pages, settings sections and quick actions.
// ══════════════════════════════════════════════════════════════
export const OPEN_EVENT = 'open-global-search';

// Context first, deliberately: an entry there is something a person wrote
// down BECAUSE it was hard to find, so when it matches it's almost always the
// answer. Everything else is raw records that happen to contain the words.
const GROUP_ORDER = ['action', 'context', 'page', 'task', 'review', 'file', 'submission'];
const GROUP_LABEL = {
  action: 'Actions', context: 'Context', page: 'Go to', task: 'Tasks',
  review: 'Review', file: 'Files', submission: 'Submissions',
};
const TYPE_ICON = {
  context: 'book', task: 'tasks', review: 'eye', file: 'fileCode', submission: 'inbox',
};
const PER_GROUP = 6;

const PAGES = [
  { id: 'dashboard', title: 'Dashboard', to: '/dashboard', icon: 'home' },
  { id: 'tasks', title: 'Tasks', to: '/tasks', icon: 'tasks' },
  { id: 'completed', title: 'Completed', to: '/completed', icon: 'done' },
  { id: 'review', title: 'Ready for review', to: '/review', icon: 'eye' },
  { id: 'context', title: 'Context', to: '/context', icon: 'book' },
  { id: 'files', title: 'Files', to: '/files', icon: 'fileCode' },
  { id: 'submissions', title: 'Submissions', to: '/submissions', icon: 'inbox' },
  { id: 'team-activity', title: 'Team activity', to: '/team-activity', icon: 'activity', adminOnly: true },
  { id: 'settings', title: 'Settings', to: '/settings', icon: 'settings' },
];

const ACTIONS = [
  { id: 'new-task', title: 'New task', icon: 'plus', kbd: 'N', run: () => openNewTask(), words: 'create add task' },
  { id: 'quick-log', title: 'Log a completed task', icon: 'done', kbd: 'Q', run: openQuickLog, words: 'quick log done finished' },
  { id: 'scan', title: 'Scan notebook notes', icon: 'camera', run: openNoteScan, words: 'photo camera notebook scan' },
  { id: 'context', title: 'Save context', icon: 'book', run: openQuickContext, words: 'note remember context' },
  { id: 'notifications', title: 'Notifications', icon: 'bell', run: openNotifications, words: 'inbox alerts' },
];

const REVIEW_LABEL = { pending: 'Waiting', approved: 'Approved', needs_work: 'Needs work', live: 'Live' };
const REVIEW_DOT = { pending: 'open', approved: 'completed', needs_work: 'critical', live: 'completed' };

const norm = (s) => (s || '').toString().toLowerCase();
const clip = (s, n = 90) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Keep in step with the exit animations in GlobalSearch.css.
const CLOSE_MS = 170;

export default function GlobalSearch() {
  const navigate = useNavigate();
  const { activeTeamId, isAdmin } = useTeam();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState({ context: [], tasks: [], reviews: [], files: [], submissions: [] });
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [hl, setHl] = useState(null); // highlight box { y, h }

  // Closing plays the exit animation first and only then unmounts, so the
  // palette leaves the way it arrived. The query clears once it's gone.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef(null);
  const close = useCallback(() => {
    if (closeTimer.current) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setClosing(false);
      setQuery('');
      setActiveIdx(0);
      setHl(null);
    }, CLOSE_MS);
  }, []);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  // Opening mid-close cancels the close.
  useEffect(() => {
    const onOpen = () => {
      if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
      setClosing(false);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  // The searchable corpus for the active team, fetched on each open. The
  // datasets are team-scoped and small enough to filter on the client.
  useEffect(() => {
    if (!open || !activeTeamId) return undefined;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [context, tasks, reviews, files, submissions] = await Promise.all([
        supabase.from('context_entries').select('*').eq('team_id', activeTeamId).order('updated_at', { ascending: false }).limit(500),
        // select('*') so the newer nullable `title` column comes along when it exists.
        supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('date_received', { ascending: false }).limit(500),
        supabase.from('review_posts').select('id, title, url, description, status').eq('team_id', activeTeamId).order('updated_at', { ascending: false }).limit(300),
        supabase.from('file_entries').select('id, name, path, section, description').eq('team_id', activeTeamId).limit(500),
        supabase.from('submissions').select('id, page, feedback, noticed_by, status').eq('team_id', activeTeamId).order('created_at', { ascending: false }).limit(300),
      ]);
      if (cancelled) return;
      setData({
        context: context.data || [],
        tasks: tasks.data || [],
        reviews: reviews.data || [],
        files: files.data || [],
        submissions: submissions.data || [],
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, activeTeamId]);

  // ── The grouped result set for the current query ──
  // Each list is filtered AND ranked by the same scorer (lib/fuzzySearch.js).
  // Names weigh more than body text.
  const groups = useMemo(() => {
    const q = norm(query).trim();

    const actions = searchRank(ACTIONS, q, a => [{ text: a.title, weight: 2 }, { text: a.words, weight: 1 }])
      .map(a => ({ type: 'action', id: a.id, title: a.title, icon: a.icon, kbd: a.kbd, run: a.run }));

    const pages = searchRank([
      ...PAGES.filter(p => !p.adminOnly || isAdmin)
        .map(p => ({ type: 'page', id: p.id, title: p.title, subtitle: p.to, to: p.to, icon: p.icon })),
      ...SETTINGS_SECTIONS.map(sec => ({
        type: 'page', id: `settings-${sec.id}`, title: sec.label,
        subtitle: `Settings · ${sec.blurb}`, to: sectionPath(sec.id), icon: 'settings',
      })),
    ], q, p => [{ text: p.title, weight: 2 }]);

    if (!q) {
      return [
        { type: 'action', items: actions },
        { type: 'page', items: pages.filter(p => !p.id.startsWith('settings-')) },
      ];
    }

    const context = searchRank(data.context, q, c => [
      { text: c.subject, weight: 3 },
      { text: tagsOf(c).map(t => t.name).join(' '), weight: 2 },
      { text: c.description, weight: 1 },
    ]).map(c => ({
      type: 'context', id: c.id, title: c.subject || 'Untitled',
      subtitle: [tagsOf(c).map(t => `#${t.name}`).join(' '), clip(c.description)].filter(Boolean).join(' · ') || 'No description',
      to: `/context?id=${c.id}`,
    }));

    const tasks = searchRank(data.tasks, q, t => [
      { text: t.title, weight: 3 },
      { text: t.page, weight: 2.5 },
      { text: taskPreview(t, 400), weight: 1 },
      { text: t.noticed_by, weight: 1 },
      { text: `${t.status} ${t.roi}`, weight: 1 },
    ]).map(t => ({
      type: 'task', id: t.id, title: taskTitle(t),
      subtitle: [pageLabel(t.page), t.noticed_by].filter(Boolean).join(' · '),
      status: t.status,
    }));

    const reviews = searchRank(data.reviews, q, r => [
      { text: r.title, weight: 3 },
      { text: r.url, weight: 2 },
      { text: htmlToText(r.description), weight: 1 },
    ]).map(r => ({
      type: 'review', id: r.id, title: r.title || 'Untitled post',
      subtitle: pageLabel(r.url) || clip(htmlToText(r.description)),
      reviewStatus: r.status,
      to: `/review?post=${r.id}`,
    }));

    const files = searchRank(data.files, q, f => [
      { text: f.name, weight: 3 },
      { text: f.path, weight: 2 },
      { text: f.section, weight: 1.5 },
      { text: f.description, weight: 1 },
    ]).map(f => ({
      type: 'file', id: f.id, title: f.name || f.path || 'File',
      subtitle: [f.section, f.path].filter(Boolean).join(' · '),
      ext: (f.name || '').split('.').pop()?.slice(0, 4),
      to: `/files?id=${f.id}`, mono: true,
    }));

    const submissions = searchRank(data.submissions, q, s => [
      { text: s.page, weight: 3 },
      { text: htmlToText(s.feedback), weight: 1 },
      { text: s.noticed_by, weight: 1 },
    ]).map(s => ({
      type: 'submission', id: s.id, title: pageLabel(s.page) || 'Submission',
      subtitle: clip(htmlToText(s.feedback)) || s.noticed_by || s.status,
      to: '/submissions',
    }));

    const byType = { action: actions, context, page: pages, task: tasks, review: reviews, file: files, submission: submissions };
    return GROUP_ORDER
      .map(type => ({ type, items: (byType[type] || []).slice(0, PER_GROUP) }))
      .filter(g => g.items.length > 0);
  }, [query, data, isAdmin]);

  const flat = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => { setActiveIdx(0); }, [query]);

  const activate = useCallback((item) => {
    if (!item) return;
    close();
    if (item.type === 'task') openTask(item.id);
    else if (item.type === 'action') setTimeout(item.run, 60);
    else navigate(item.to);
  }, [close, navigate]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (flat.length ? (i + 1) % flat.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (flat.length ? (i - 1 + flat.length) % flat.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); activate(flat[activeIdx]); }
  };

  // The highlight is one box that glides to the active row, not a
  // background that blinks from row to row.
  useLayoutEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    if (!el) { setHl(null); return; }
    setHl({ y: el.offsetTop, h: el.offsetHeight });
    el.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open, groups]);

  if (!open) return null;

  let runningIdx = -1;
  const q = query.trim();
  const searching = loading && q && flat.length === 0;

  return (
    <ModalPortal animateExit={false}>
      <div className={`gs-overlay ${closing ? 'gs-closing' : ''}`} onMouseDown={close}>
        <div className="gs-panel" onMouseDown={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Search">
          <div className="gs-input-row">
            <Icon name="search" size={18} className="gs-input-icon" />
            <input
              ref={inputRef}
              className="gs-input"
              placeholder="Search tasks, reviews, context, files…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls="gs-results"
              aria-activedescendant={flat[activeIdx] ? `gs-opt-${activeIdx}` : undefined}
            />
            {loading && <span className="spinner spinner-sm gs-spin" aria-label="Loading" />}
            <span className="kbd-box gs-esc">esc</span>
            <button type="button" className="btn btn-ghost btn-sm gs-cancel" onClick={close}>Cancel</button>
          </div>

          <div className="gs-results" id="gs-results" ref={listRef} role="listbox">
            {hl && flat.length > 0 && (
              <span className="gs-hl" style={{ transform: `translateY(${hl.y}px)`, height: hl.h }} aria-hidden="true" />
            )}
            {searching ? (
              <div className="gs-skel" aria-label="Searching">
                {[62, 48, 70, 40].map((w, i) => (
                  <div key={i} className="gs-skel-row">
                    <span className="skel gs-skel-icon" />
                    <span className="skel skel-line" style={{ width: `${w}%` }} />
                  </div>
                ))}
              </div>
            ) : flat.length === 0 ? (
              <div className="gs-empty">
                <span className="empty-icon"><Icon name="search" size={20} /></span>
                <div className="empty-title">No results</div>
                <div>Nothing matches “{q}”. Try fewer words.</div>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.type} className="gs-group">
                  <div className="gs-group-label">
                    {GROUP_LABEL[group.type]}
                    {q && <span className="gs-group-count">{group.items.length}</span>}
                  </div>
                  {group.items.map(item => {
                    runningIdx += 1;
                    const idx = runningIdx;
                    const on = idx === activeIdx;
                    return (
                      <button
                        key={`${item.type}-${item.id}`}
                        id={`gs-opt-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={on}
                        data-idx={idx}
                        className={`gs-row ${on ? 'is-active' : ''}`}
                        style={{ '--i': Math.min(idx, 12) }}
                        onMouseMove={() => { if (!on) setActiveIdx(idx); }}
                        onClick={() => activate(item)}
                        onContextMenu={item.type === 'task' ? (e) => openTaskMenu(e, item.id) : undefined}
                      >
                        <span className="gs-row-icon">
                          {item.type === 'file' && item.ext
                            ? <span className="gs-ext">{item.ext}</span>
                            : <Icon name={item.icon || TYPE_ICON[item.type] || 'arrowRight'} size={15} />}
                        </span>
                        <span className="gs-row-text">
                          <span className={`gs-row-title ${item.mono ? 'mono' : ''}`}>{item.title}</span>
                          {item.subtitle && <span className="gs-row-sub">{item.subtitle}</span>}
                        </span>
                        <RowMeta item={item} />
                        <span className="gs-enter" aria-hidden="true">↵</span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          <div className="gs-footer">
            <span><span className="kbd-box">↑</span><span className="kbd-box">↓</span> navigate</span>
            <span><span className="kbd-box">↵</span> open</span>
            <span><span className="kbd-box">esc</span> close</span>
            <span className="gs-footer-count">
              {q ? `${flat.length} result${flat.length === 1 ? '' : 's'}` : 'Type to search everything'}
            </span>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function RowMeta({ item }) {
  if (item.type === 'task' && item.status) {
    return (
      <span className="gs-row-meta">
        <span className={`dot dot-${item.status}`} />
        <span className="hide-phone">{STATUS_LABEL[item.status] || cap(item.status)}</span>
      </span>
    );
  }
  if (item.type === 'review' && item.reviewStatus) {
    return (
      <span className="gs-row-meta">
        <span className={`dot dot-${REVIEW_DOT[item.reviewStatus] || 'open'}`} />
        <span className="hide-phone">{REVIEW_LABEL[item.reviewStatus] || cap(item.reviewStatus)}</span>
      </span>
    );
  }
  if (item.kbd) return <span className="gs-row-meta"><span className="kbd-box hide-phone">{item.kbd}</span></span>;
  return null;
}
