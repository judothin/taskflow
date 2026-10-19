import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addDays, addWeeks, format, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { fullName, initialsOf, REVIEWS_CHANGED } from '../lib/reviews';
import Avatar from '../components/Avatar';
import './TeamActivity.css';

// ══════════════════════════════════════════════════════════════
// Team Activity — owners and admins only. What each person did in a day or
// a week: tasks completed and added, review posts sent, verdicts given,
// review comments, Go Live items and Context entries, each with its time.
//
// Everything is read from the tables the app already writes; nothing new is
// stored. Completions are credited by name (tasks.completed_by is the list of
// names picked when it was marked done), matched to the team's members.
// ══════════════════════════════════════════════════════════════

const KINDS = {
  completed:  { label: 'Completed',       short: 'Done',       tone: 'done' },
  added:      { label: 'Added a task',     short: 'Added',      tone: 'add' },
  submitted:  { label: 'Sent for review',  short: 'For review', tone: 'review' },
  resubmitted:{ label: 'Re-sent for review', short: 'For review', tone: 'review' },
  approved:   { label: 'Approved',         short: 'Reviewed',   tone: 'ok' },
  needs_work: { label: 'Asked for changes', short: 'Reviewed',  tone: 'warn' },
  went_live:  { label: 'Marked live',      short: 'Live',       tone: 'live' },
  reopened:   { label: 'Reopened a review', short: 'Reviewed',  tone: 'review' },
  comment:    { label: 'Commented on',     short: 'Comment',    tone: 'comment' },
  golive:     { label: 'Added to Go Live', short: 'Go Live',    tone: 'live' },
  context:    { label: 'Added context',    short: 'Context',    tone: 'context' },
};

// The summary columns, each counting one or more kinds.
const COLUMNS = [
  { id: 'completed', label: 'Completed',    kinds: ['completed'] },
  { id: 'added',     label: 'Added',        kinds: ['added'] },
  { id: 'review',    label: 'For review',   kinds: ['submitted', 'resubmitted'] },
  { id: 'verdicts',  label: 'Reviewed',     kinds: ['approved', 'needs_work', 'reopened'] },
  { id: 'comments',  label: 'Comments',     kinds: ['comment'] },
  { id: 'live',      label: 'Go Live',      kinds: ['golive', 'went_live'] },
  { id: 'context',   label: 'Context',      kinds: ['context'] },
];

const ICON = {
  left: <path d="M15 18l-6-6 6-6" />,
  right: <path d="M9 18l6-6-6-6" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0110 0v4" /></>,
};
const Svg = ({ name, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON[name]}</svg>
);

const plain = (html) => {
  const s = String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  return s.replace(/\s+/g, ' ').trim();
};
const clip = (s, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const dayKey = (d) => format(d, 'yyyy-MM-dd');
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
};

// A completed_by name ("Sam Lee", or just "Sam") → member id, when it's
// clearly one person. Anything else stays a bare name.
function nameMatcher(members) {
  const byFull = new Map();
  const byFirst = new Map();
  for (const m of members) {
    const full = fullName(m).toLowerCase();
    if (full) byFull.set(full, m.id);
    const first = (m.first_name || '').trim().toLowerCase();
    if (first) byFirst.set(first, byFirst.has(first) ? null : m.id);
  }
  return (name) => {
    const k = name.trim().toLowerCase();
    return byFull.get(k) || byFirst.get(k) || null;
  };
}

async function fetchActivity(teamId, from, to) {
  const a = from.toISOString();
  const b = to.toISOString();
  const [done, added, events, comments, golive, context] = await Promise.all([
    supabase.from('tasks').select('id, page, feedback, completed_by, date_completed')
      .eq('team_id', teamId).eq('status', 'completed')
      .gte('date_completed', a).lt('date_completed', b).limit(2000),
    supabase.from('tasks').select('id, page, feedback, status, created_by, date_received, date_completed')
      .eq('team_id', teamId).not('created_by', 'is', null)
      .gte('date_received', a).lt('date_received', b).limit(2000),
    supabase.from('review_events').select('id, post_id, kind, actor, note, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
    supabase.from('review_comments').select('id, post_id, user_id, content, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
    supabase.from('golive_items').select('id, page, description, created_by, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
    supabase.from('context_entries').select('id, subject, created_by, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
  ]);
  const err = [done, added].find(r => r.error);
  if (err) throw new Error(err.error.message);

  // Titles for the review posts the events and comments point at.
  const postIds = [...new Set([...(events.data || []), ...(comments.data || [])].map(r => r.post_id))];
  let posts = {};
  if (postIds.length) {
    const { data } = await supabase.from('review_posts').select('id, title').in('id', postIds);
    posts = Object.fromEntries((data || []).map(p => [p.id, p]));
  }
  return {
    done: done.data || [], added: added.data || [],
    events: events.data || [], comments: comments.data || [],
    golive: golive.data || [], context: context.data || [], posts,
  };
}

// Raw rows → one flat list of { who, kind, at, text, page, note, to }.
function toEntries(raw, members) {
  const match = nameMatcher(members);
  const out = [];
  for (const t of raw.done) {
    const names = String(t.completed_by || '').split(',').map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    for (const n of names) {
      const who = match(n) || `name:${n}`;
      if (seen.has(who)) continue;
      seen.add(who);
      out.push({ id: `c-${t.id}-${who}`, who, kind: 'completed', at: t.date_completed,
        text: clip(plain(t.feedback)), page: t.page, to: `/tasks/${t.id}` });
    }
  }
  for (const t of raw.added) {
    // A task logged straight in as done (Quick Log, a notebook scan) is one
    // thing, already counted as a completion.
    if (t.status === 'completed' && t.date_completed && t.date_completed === t.date_received) continue;
    out.push({ id: `a-${t.id}`, who: t.created_by, kind: 'added', at: t.date_received,
      text: clip(plain(t.feedback)), page: t.page, to: `/tasks/${t.id}` });
  }
  for (const e of raw.events) {
    if (!e.actor || !KINDS[e.kind]) continue;   // live_undone isn't worth a line
    out.push({ id: `e-${e.id}`, who: e.actor, kind: e.kind, at: e.created_at,
      text: raw.posts[e.post_id]?.title || 'A review post', note: clip(e.note || '', 200),
      to: `/review?post=${e.post_id}` });
  }
  for (const c of raw.comments) {
    if (!c.user_id) continue;
    out.push({ id: `m-${c.id}`, who: c.user_id, kind: 'comment', at: c.created_at,
      text: raw.posts[c.post_id]?.title || 'A review post', note: clip(c.content || '', 200),
      to: `/review?post=${c.post_id}` });
  }
  for (const g of raw.golive) {
    if (!g.created_by) continue;
    out.push({ id: `g-${g.id}`, who: g.created_by, kind: 'golive', at: g.created_at,
      text: clip(plain(g.description) || g.page), page: g.page, to: '/go-live' });
  }
  for (const c of raw.context) {
    if (!c.created_by) continue;
    out.push({ id: `x-${c.id}`, who: c.created_by, kind: 'context', at: c.created_at,
      text: clip(c.subject || ''), to: '/context' });
  }
  return out.filter(e => e.at).sort((x, y) => new Date(y.at) - new Date(x.at));
}

const countCols = (entries) => Object.fromEntries(COLUMNS.map(c => [c.id, entries.filter(e => c.kinds.includes(e.kind)).length]));

export default function TeamActivity() {
  const { activeTeamId, activeTeam, isAdmin } = useTeam();
  const [params, setParams] = useSearchParams();
  const mode = params.get('view') === 'week' ? 'week' : 'day';
  const anchor = parseDay(params.get('date')) || startOfDay(new Date());

  const from = mode === 'week' ? startOfWeek(anchor, { weekStartsOn: 1 }) : startOfDay(anchor);
  const to = mode === 'week' ? addWeeks(from, 1) : addDays(from, 1);
  const fromKey = dayKey(from);
  const isCurrent = from <= new Date() && new Date() < to;

  const [members, setMembers] = useState([]);
  const [raw, setRaw] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(() => new Set());

  const setPeriod = (nextMode, date) => {
    const p = new URLSearchParams(params);
    p.set('view', nextMode);
    if (date && !isSameDay(date, new Date())) p.set('date', dayKey(date)); else p.delete('date');
    setParams(p, { replace: true });
  };
  const step = (dir) => setPeriod(mode, mode === 'week' ? addWeeks(from, dir) : addDays(from, dir));

  useEffect(() => {
    let live = true;
    fetchTeamMembers(activeTeamId).then(m => { if (live) setMembers(m || []); });
    return () => { live = false; };
  }, [activeTeamId]);

  const load = useCallback(async (quiet) => {
    if (!activeTeamId || !isAdmin) { setLoading(false); return; }
    if (!quiet) setLoading(true);
    try {
      const start = parseDay(fromKey);
      const end = mode === 'week' ? addWeeks(start, 1) : addDays(start, 1);
      setRaw(await fetchActivity(activeTeamId, start, end));
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load activity.');
    }
    setLoading(false);
  }, [activeTeamId, isAdmin, fromKey, mode]);

  useEffect(() => { load(false); }, [load]);
  useEffect(() => {
    const h = () => load(true);
    window.addEventListener('tasks-changed', h);
    window.addEventListener(REVIEWS_CHANGED, h);
    const onVis = () => { if (!document.hidden) load(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('tasks-changed', h);
      window.removeEventListener(REVIEWS_CHANGED, h);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  const entries = useMemo(() => (raw ? toEntries(raw, members) : []), [raw, members]);

  // One row per member (everyone, even with nothing to show), then any
  // completer named on a task who isn't on the team.
  const people = useMemo(() => {
    const byWho = new Map();
    for (const e of entries) {
      if (!byWho.has(e.who)) byWho.set(e.who, []);
      byWho.get(e.who).push(e);
    }
    const rows = members.map(m => ({ id: m.id, person: m, name: fullName(m) || 'Unnamed', role: m.role, entries: byWho.get(m.id) || [] }));
    for (const [who, list] of byWho) {
      if (members.some(m => m.id === who)) continue;
      const name = who.startsWith('name:') ? who.slice(5) : 'Former member';
      rows.push({ id: who, person: null, name, role: 'outside', entries: list });
    }
    return rows
      .map(r => ({ ...r, counts: countCols(r.entries) }))
      .sort((x, y) => (y.entries.length - x.entries.length) || x.name.localeCompare(y.name));
  }, [entries, members]);

  const totals = useMemo(() => countCols(entries), [entries]);
  const days = useMemo(() => {
    const start = parseDay(fromKey);
    return mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [start];
  }, [mode, fromKey]);

  const toggle = (id) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allOpen = people.some(p => p.entries.length) && people.filter(p => p.entries.length).every(p => open.has(p.id));

  if (!isAdmin) {
    return (
      <div className="ta-page">
        <div className="empty-state ta-locked">
          <Svg name="lock" size={34} />
          <h3>Owners and admins only</h3>
          <p>Team Activity shows what everyone on {activeTeam?.name || 'the team'} has been doing. Ask an owner to make you an admin to see it.</p>
        </div>
      </div>
    );
  }

  const periodLabel = mode === 'week'
    ? `${format(from, 'MMM d')} – ${format(addDays(to, -1), from.getMonth() === addDays(to, -1).getMonth() ? 'd, yyyy' : 'MMM d, yyyy')}`
    : format(from, 'EEEE, MMM d, yyyy');
  const active = people.filter(p => p.entries.length).length;

  return (
    <div className="ta-page">
      <header className="ta-head">
        <div className="ta-head-icon"><Svg name="activity" size={20} /></div>
        <div className="ta-head-text">
          <h1 className="ta-head-title">Team Activity</h1>
          <div className="ta-head-sub">
            {loading && !raw ? 'Loading…'
              : `${entries.length} action${entries.length === 1 ? '' : 's'} · ${active} of ${members.length} ${members.length === 1 ? 'person' : 'people'} active`}
          </div>
        </div>
      </header>

      <div className="ta-toolbar">
        <div className="ta-seg" role="tablist" aria-label="Period">
          {['day', 'week'].map(m => (
            <button key={m} type="button" role="tab" aria-selected={mode === m}
              className={`ta-seg-btn ${mode === m ? 'ta-seg-on' : ''}`}
              onClick={() => setPeriod(m, anchor)}>
              {m === 'day' ? 'Day' : 'Week'}
            </button>
          ))}
        </div>
        <div className="ta-nav">
          <button type="button" className="ta-icon-btn" onClick={() => step(-1)} aria-label={`Previous ${mode}`}><Svg name="left" /></button>
          <label className="ta-period">
            <span>{periodLabel}</span>
            <input type="date" value={dayKey(anchor)} max={dayKey(new Date())}
              onChange={e => { const d = parseDay(e.target.value); if (d) setPeriod(mode, d); }}
              aria-label="Pick a date" />
          </label>
          <button type="button" className="ta-icon-btn" onClick={() => step(1)} disabled={isCurrent || from > new Date()} aria-label={`Next ${mode}`}><Svg name="right" /></button>
          {!isCurrent && (
            <button type="button" className="btn btn-secondary ta-today" onClick={() => setPeriod(mode, new Date())}>
              {mode === 'week' ? 'This week' : 'Today'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="card error-msg">⚠ {error}</div>}

      <div className="ta-totals">
        {COLUMNS.map(c => (
          <div key={c.id} className={`ta-total ${totals[c.id] ? '' : 'ta-total-zero'}`}>
            <span className="ta-total-n">{totals[c.id]}</span>
            <span className="ta-total-l">{c.label}</span>
          </div>
        ))}
      </div>

      {loading && !raw ? (
        <div className="ta-list">{[0, 1, 2].map(i => <div key={i} className="ta-skeleton loading-pulse" />)}</div>
      ) : (
        <div className="ta-list">
          <div className="ta-list-head">
            <span>People</span>
            {active > 0 && (
              <button type="button" className="ta-link" onClick={() => setOpen(allOpen ? new Set() : new Set(people.filter(p => p.entries.length).map(p => p.id)))}>
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>
          {people.map(p => (
            <PersonRow key={p.id} row={p} mode={mode} days={days} open={open.has(p.id)} onToggle={() => toggle(p.id)} />
          ))}
          {!people.length && <div className="empty-state"><h3>No one on this team yet</h3></div>}
        </div>
      )}
    </div>
  );
}

function PersonRow({ row, mode, days, open, onToggle }) {
  const { person, name, role, entries, counts } = row;
  const n = entries.length;
  const first = n ? new Date(entries[n - 1].at) : null;
  const last = n ? new Date(entries[0].at) : null;
  const perDay = days.map(d => entries.filter(e => isSameDay(new Date(e.at), d)).length);
  const peak = Math.max(1, ...perDay);

  return (
    <section className={`ta-person ${n ? '' : 'ta-person-idle'} ${open ? 'ta-person-open' : ''}`}>
      <button type="button" className="ta-person-head" onClick={onToggle} disabled={!n} aria-expanded={open}>
        <span className="ta-who">
          {person
            ? <Avatar src={person.avatar_url} color={person.color || '#6366f1'} initials={initialsOf(person)} size={32} />
            : <span className="ta-who-blank">{name.slice(0, 1).toUpperCase()}</span>}
          <span className="ta-who-text">
            <b>{name}</b>
            <span className="ta-who-sub">
              {role === 'owner' ? 'Owner' : role === 'admin' ? 'Admin' : role === 'outside' ? 'Named on tasks · not on the team' : 'Member'}
              {n > 0 && mode === 'day' && ` · ${format(first, 'h:mm a')}${n > 1 ? ` – ${format(last, 'h:mm a')}` : ''}`}
              {n > 0 && mode === 'week' && ` · active ${perDay.filter(Boolean).length} of 7 days`}
            </span>
          </span>
        </span>

        {mode === 'week' && (
          <span className="ta-spark" aria-label={`Actions per day: ${perDay.join(', ')}`}>
            {perDay.map((v, i) => (
              <span key={i} className="ta-spark-col" title={`${format(days[i], 'EEE d')}: ${v}`}>
                <span className="ta-spark-bar" style={{ height: `${v ? Math.max(12, (v / peak) * 100) : 0}%` }} />
                <span className="ta-spark-day">{format(days[i], 'EEEEE')}</span>
              </span>
            ))}
          </span>
        )}

        <span className="ta-counts">
          {COLUMNS.map(c => (
            <span key={c.id} className={`ta-count ${counts[c.id] ? '' : 'ta-count-zero'}`} title={c.label}>
              <b>{counts[c.id]}</b><span>{c.label}</span>
            </span>
          ))}
        </span>
        <span className="ta-chevron">{n ? <Svg name="chevron" size={16} /> : <span className="ta-none">No activity</span>}</span>
      </button>

      {open && n > 0 && <Timeline entries={entries} mode={mode} days={days} />}
    </section>
  );
}

function Timeline({ entries, mode, days }) {
  // Everything the person did, in the order they did it, whatever it was.
  // A week is split by day (Monday first); a day is one list.
  const inOrder = [...entries].reverse();
  const groups = mode === 'week'
    ? days.map(d => ({ d, list: inOrder.filter(e => isSameDay(new Date(e.at), d)) })).filter(g => g.list.length)
    : [{ d: null, list: inOrder }];
  return (
    <div className="ta-timeline">
      {groups.map(({ d, list }) => (
        <div key={d ? dayKey(d) : 'day'} className="ta-tl-group">
          {d && (
            <div className="ta-tl-day">
              {format(d, 'EEEE, MMM d')}
              <span>{list.length} action{list.length === 1 ? '' : 's'}</span>
            </div>
          )}
          <ol className="ta-tl">
            {list.map(e => {
              const k = KINDS[e.kind];
              return (
                <li key={e.id} className={`ta-tl-item ta-tone-${k.tone}`}>
                  <time className="ta-tl-time" dateTime={e.at}>{format(new Date(e.at), 'h:mm a')}</time>
                  <span className="ta-tl-dot" />
                  <div className="ta-tl-body">
                    <div className="ta-tl-line">
                      <span className="ta-tl-kind">{k.label}</span>
                      {e.page && <span className="ta-tl-page">{e.page}</span>}
                    </div>
                    <Link to={e.to} className="ta-tl-text">{e.text || '(no description)'}</Link>
                    {e.note && <div className="ta-tl-note">“{e.note}”</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
