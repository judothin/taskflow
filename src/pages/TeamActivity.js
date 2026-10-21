import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addDays, addWeeks, format, isSameDay, startOfDay, startOfWeek } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { REVIEWS_CHANGED } from '../lib/reviews';
import { openTask, TASKS_CHANGED } from '../lib/events';
import { taskTitle, pageLabel } from '../lib/taskText';
import Collapse from '../components/Collapse';
import { Icon, Segmented, Avatar, Empty, fullName } from '../ui';
import './TeamActivity.css';

// ══════════════════════════════════════════════════════════════
// Team activity — owners and admins only. What each person did in a day or
// a week: tasks completed and added, review posts sent, verdicts given,
// review comments, posts that went live and Context entries, each with
// its time.
//
// Everything is read from the tables the app already writes; nothing new is
// stored. Completions are credited by name (tasks.completed_by is the list of
// names picked when it was marked done), matched to the team's members.
// "Went live" comes from Review (review_events kind 'went_live', backed up by
// review_posts.went_live_at) — the old Go Live list is gone.
// ══════════════════════════════════════════════════════════════

const KINDS = {
  completed:   { label: 'Completed',          tone: 'done' },
  added:       { label: 'Added',              tone: 'add' },
  submitted:   { label: 'Sent for review',    tone: 'review' },
  resubmitted: { label: 'Re-sent for review', tone: 'review' },
  approved:    { label: 'Approved',           tone: 'ok' },
  needs_work:  { label: 'Asked for changes',  tone: 'warn' },
  reopened:    { label: 'Reopened a review',  tone: 'review' },
  went_live:   { label: 'Went live',          tone: 'live' },
  comment:     { label: 'Commented',          tone: 'comment' },
  context:     { label: 'Added context',      tone: 'context' },
};

// The summary columns, each counting one or more kinds.
const COLUMNS = [
  { id: 'completed', label: 'Completed',  kinds: ['completed'] },
  { id: 'added',     label: 'Added',      kinds: ['added'] },
  { id: 'review',    label: 'For review', kinds: ['submitted', 'resubmitted'] },
  { id: 'verdicts',  label: 'Reviewed',   kinds: ['approved', 'needs_work', 'reopened'] },
  { id: 'comments',  label: 'Comments',   kinds: ['comment'] },
  { id: 'live',      label: 'Went live',  kinds: ['went_live'] },
  { id: 'context',   label: 'Context',    kinds: ['context'] },
];
const TONE_ORDER = ['done', 'add', 'review', 'ok', 'warn', 'live', 'comment', 'context'];

const plain = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const dayKey = (d) => format(d, 'yyyy-MM-dd');
const parseDay = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(d.getTime()) ? null : d;
};
const hourOf = (d) => d.getHours() + d.getMinutes() / 60;
const fmtHour = (h) => format(new Date(2000, 0, 1, h % 24), 'h a');

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
  const [done, added, events, comments, live, context] = await Promise.all([
    supabase.from('tasks').select('*')
      .eq('team_id', teamId).eq('status', 'completed')
      .gte('date_completed', a).lt('date_completed', b).limit(2000),
    supabase.from('tasks').select('*')
      .eq('team_id', teamId).not('created_by', 'is', null)
      .gte('date_received', a).lt('date_received', b).limit(2000),
    supabase.from('review_events').select('id, post_id, kind, actor, note, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
    supabase.from('review_comments').select('id, post_id, user_id, content, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
    supabase.from('review_posts').select('id, title, went_live_at, went_live_by')
      .eq('team_id', teamId).gte('went_live_at', a).lt('went_live_at', b).limit(2000),
    supabase.from('context_entries').select('id, subject, created_by, created_at')
      .eq('team_id', teamId).gte('created_at', a).lt('created_at', b).limit(2000),
  ]);
  const err = [done, added].find(r => r.error);
  if (err) throw new Error(err.error.message);

  // Titles for the review posts the events and comments point at.
  const postIds = [...new Set([...(events.data || []), ...(comments.data || [])].map(r => r.post_id))];
  const posts = Object.fromEntries((live.data || []).map(p => [p.id, p]));
  const missing = postIds.filter(id => !posts[id]);
  if (missing.length) {
    const { data } = await supabase.from('review_posts').select('id, title').in('id', missing);
    for (const p of data || []) posts[p.id] = p;
  }
  return {
    done: done.data || [], added: added.data || [],
    events: events.data || [], comments: comments.data || [],
    live: live.data || [], context: context.data || [], posts,
  };
}

// Raw rows → one flat list of { id, who, kind, at, text, page, note, open }.
// `open` is { task } for tasks, or a route for everything else.
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
        text: taskTitle(t), page: pageLabel(t.page), task: t });
    }
  }
  for (const t of raw.added) {
    // A task logged straight in as done (Quick Log, a notebook scan) is one
    // thing, already counted as a completion.
    if (t.status === 'completed' && t.date_completed && t.date_completed === t.date_received) continue;
    out.push({ id: `a-${t.id}`, who: t.created_by, kind: 'added', at: t.date_received,
      text: taskTitle(t), page: pageLabel(t.page), task: t });
  }
  const liveSeen = new Set();
  for (const e of raw.events) {
    if (!e.actor || !KINDS[e.kind]) continue;   // live_undone isn't worth a line
    if (e.kind === 'went_live') liveSeen.add(`${e.post_id}:${e.actor}`);
    out.push({ id: `e-${e.id}`, who: e.actor, kind: e.kind, at: e.created_at,
      text: raw.posts[e.post_id]?.title || 'A review post', note: clip(e.note || '', 200),
      page: 'Review', to: `/review?post=${e.post_id}` });
  }
  // Posts marked live without an event row (older data) still count once.
  for (const p of raw.live) {
    if (!p.went_live_by || liveSeen.has(`${p.id}:${p.went_live_by}`)) continue;
    out.push({ id: `l-${p.id}`, who: p.went_live_by, kind: 'went_live', at: p.went_live_at,
      text: p.title || 'A review post', page: 'Review', to: `/review?post=${p.id}` });
  }
  for (const c of raw.comments) {
    if (!c.user_id) continue;
    out.push({ id: `m-${c.id}`, who: c.user_id, kind: 'comment', at: c.created_at,
      text: raw.posts[c.post_id]?.title || 'A review post', note: clip(plain(c.content), 200),
      page: 'Review', to: `/review?post=${c.post_id}` });
  }
  for (const c of raw.context) {
    if (!c.created_by) continue;
    out.push({ id: `x-${c.id}`, who: c.created_by, kind: 'context', at: c.created_at,
      text: clip(c.subject || 'Context entry'), page: 'Context', to: '/context' });
  }
  return out.filter(e => e.at).sort((x, y) => new Date(y.at) - new Date(x.at));
}

const countCols = (entries) => Object.fromEntries(COLUMNS.map(c => [c.id, entries.filter(e => c.kinds.includes(e.kind)).length]));
const roleLabel = (r) => (r === 'owner' ? 'Owner' : r === 'admin' ? 'Admin' : r === 'outside' ? 'Not on the team' : 'Member');

export default function TeamActivity() {
  const { activeTeamId, activeTeam, isAdmin } = useTeam();
  const navigate = useNavigate();
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
  const [dir, setDir] = useState(0);
  const dateInput = useRef(null);

  const setPeriod = (nextMode, date) => {
    const p = new URLSearchParams(params);
    p.set('view', nextMode);
    if (date && !isSameDay(date, new Date())) p.set('date', dayKey(date)); else p.delete('date');
    setDir(date < from ? -1 : date > from ? 1 : 0);
    setParams(p, { replace: true });
  };
  const step = (n) => setPeriod(mode, mode === 'week' ? addWeeks(from, n) : addDays(from, n));

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
    window.addEventListener(TASKS_CHANGED, h);
    window.addEventListener(REVIEWS_CHANGED, h);
    const onVis = () => { if (!document.hidden) load(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener(TASKS_CHANGED, h);
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

  // The day track runs 8 AM – 6 PM, stretched to fit anything earlier or later.
  const range = useMemo(() => {
    let lo = 8;
    let hi = 18;
    for (const e of entries) {
      const h = hourOf(new Date(e.at));
      lo = Math.min(lo, Math.floor(h));
      hi = Math.max(hi, Math.ceil(h + 0.01));
    }
    return { lo, hi: Math.min(24, hi) };
  }, [entries]);

  const toggle = (id) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const activeRows = people.filter(p => p.entries.length);
  const allOpen = activeRows.length > 0 && activeRows.every(p => open.has(p.id));

  const openEntry = (e) => {
    if (e.task) openTask(e.task);
    else if (e.to) navigate(e.to);
  };

  if (!isAdmin) {
    return (
      <div className="page ta-page">
        <Empty icon="lock" title="Owners and admins only">
          Team activity shows what everyone on {activeTeam?.name || 'the team'} has been doing.
          Ask an owner to make you an admin to see it.
        </Empty>
      </div>
    );
  }

  const last = addDays(to, -1);
  const eyebrow = mode === 'week'
    ? (isCurrent ? 'This week' : `Week of ${format(from, 'MMM d')}`)
    : format(from, 'EEEE');
  const periodLabel = mode === 'week'
    ? `${format(from, 'MMM d')} – ${format(last, from.getMonth() === last.getMonth() ? 'd, yyyy' : 'MMM d, yyyy')}`
    : format(from, 'EEE, MMM d, yyyy');
  const sub = loading && !raw
    ? 'Loading…'
    : `${entries.length} action${entries.length === 1 ? '' : 's'} · ${activeRows.length} of ${members.length} ${members.length === 1 ? 'person' : 'people'} active`;
  const slideKey = `${mode}-${fromKey}`;
  const slideClass = dir < 0 ? 'ta-slide-prev' : dir > 0 ? 'ta-slide-next' : 'ta-slide-none';

  return (
    <div className="page ta-page">
      <header className="page-head ta-head anim-rise">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow"><span key={eyebrow} className="ta-eyebrow">{eyebrow}</span></div>
          <h1 className="page-title">Team activity</h1>
          <p className="page-sub">{sub}</p>
        </div>
        <div className="toolbar ta-tools">
          <Segmented
            ariaLabel="Period"
            value={mode}
            onChange={(m) => setPeriod(m, anchor)}
            options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]}
            className="ta-seg"
          />
          <div className="ta-stepper">
            <button type="button" className="ta-step" onClick={() => step(-1)} aria-label={`Previous ${mode}`}>
              <Icon name="chevronLeft" size={15} />
            </button>
            <button
              type="button"
              className="ta-period"
              onClick={() => { try { dateInput.current?.showPicker(); } catch { dateInput.current?.focus(); } }}
            >
              <span key={periodLabel} className="ta-period-text">{periodLabel}</span>
              <input
                ref={dateInput}
                type="date"
                className="ta-date-input"
                tabIndex={-1}
                value={dayKey(anchor)}
                max={dayKey(new Date())}
                onChange={(e) => { const d = parseDay(e.target.value); if (d) setPeriod(mode, d); }}
                aria-label="Pick a date"
              />
            </button>
            <button type="button" className="ta-step" onClick={() => step(1)} disabled={isCurrent || from > new Date()} aria-label={`Next ${mode}`}>
              <Icon name="chevronRight" size={15} />
            </button>
          </div>
          <button type="button" className="btn" onClick={() => setPeriod(mode, new Date())} disabled={isCurrent}>
            {mode === 'week' ? 'This week' : 'Today'}
          </button>
        </div>
      </header>

      {error && <div className="notice notice-error ta-error"><Icon name="alert" size={15} />{error}</div>}

      <div key={slideKey} className={`ta-body ${slideClass}`}>
        <div className="ta-stats">
          {COLUMNS.map((c, i) => (
            <div key={c.id} className={`stat ta-stat ${totals[c.id] ? '' : 'is-zero'}`} style={{ '--i': i }}>
              {loading && !raw
                ? <span className="skel ta-stat-skel" />
                : <span key={totals[c.id]} className="stat-num bump">{totals[c.id]}</span>}
              <span className="stat-label">{c.label}</span>
            </div>
          ))}
        </div>

        <div className="ta-people-head">
          <span className="eyebrow">People</span>
          {activeRows.length > 0 && (
            <button
              type="button"
              className="btn btn-link ta-expand-all"
              onClick={() => setOpen(allOpen ? new Set() : new Set(activeRows.map(p => p.id)))}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </button>
          )}
        </div>

        <div className="table ta-table">
          <div className="table-head">
            <span>Person</span>
            <span className="ta-track-head">
              {mode === 'day'
                ? <>{fmtHour(range.lo)} <span className="ta-track-rule" /> {fmtHour(range.hi)}</>
                : <>Mon <span className="ta-track-rule" /> Sun</>}
            </span>
            {COLUMNS.map(c => <span key={c.id} className="ta-num-head">{c.label}</span>)}
            <span />
          </div>

          {loading && !raw ? (
            <div>
              {[0, 1, 2].map(i => (
                <div key={i} className="skel-row ta-skel-row">
                  <span className="skel" style={{ width: 30, height: 30, borderRadius: '50%' }} />
                  <span className="skel skel-line" style={{ width: '16%' }} />
                  <span className="skel skel-line" style={{ width: '30%', opacity: 0.6 }} />
                </div>
              ))}
            </div>
          ) : !people.length ? (
            <Empty icon="users" title="No one on this team yet" />
          ) : (
            <div className="ta-rows stagger">
              {people.map(p => (
                <PersonRow
                  key={p.id}
                  row={p}
                  mode={mode}
                  days={days}
                  range={range}
                  open={open.has(p.id)}
                  onToggle={() => toggle(p.id)}
                  onOpenEntry={openEntry}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PersonRow({ row, mode, days, range, open, onToggle, onOpenEntry }) {
  const { person, name, role, entries, counts } = row;
  const n = entries.length;
  const first = n ? new Date(entries[n - 1].at) : null;
  const last = n ? new Date(entries[0].at) : null;
  const perDay = days.map(d => entries.filter(e => isSameDay(new Date(e.at), d)));

  let meta = roleLabel(role);
  if (n && mode === 'day') meta += ` · ${format(first, 'h:mm a')}${n > 1 ? ` – ${format(last, 'h:mm a')}` : ''}`;
  if (n && mode === 'week') meta += ` · ${perDay.filter(l => l.length).length} of 7 days`;

  return (
    <section className={`ta-person ${n ? '' : 'is-idle'} ${open ? 'is-open' : ''}`}>
      <div
        className={`table-row ta-row ${n ? '' : 'is-static'}`}
        role={n ? 'button' : undefined}
        tabIndex={n ? 0 : undefined}
        aria-expanded={n ? open : undefined}
        onClick={n ? onToggle : undefined}
        onKeyDown={n ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } } : undefined}
      >
        <div className="table-cell ta-who">
          {person ? <Avatar person={person} size={30} /> : <Avatar name={name} size={30} className="ta-outside" />}
          <span className="ta-who-text">
            <span className="ta-who-name truncate">{name}</span>
            <span className="ta-who-sub truncate">{meta}</span>
          </span>
        </div>

        <div className="table-cell ta-track-cell">
          {mode === 'day'
            ? <DayTrack entries={entries} range={range} />
            : <WeekTrack perDay={perDay} days={days} />}
        </div>

        {COLUMNS.map(c => (
          <div key={c.id} className={`table-cell ta-num ${counts[c.id] ? '' : 'is-zero'}`}>
            <span key={counts[c.id]} className="bump">{counts[c.id]}</span>
            <span className="ta-num-label">{c.label}</span>
          </div>
        ))}

        <div className="table-cell ta-chev-cell">
          {n > 0 && <Icon name="chevronDown" size={15} className={`ta-chev ${open ? 'is-up' : ''}`} />}
        </div>
      </div>

      {n > 0 && (
        <Collapse open={open} duration={340} className="ta-collapse">
          <Timeline entries={entries} mode={mode} days={days} onOpenEntry={onOpenEntry} />
        </Collapse>
      )}
    </section>
  );
}

function DayTrack({ entries, range }) {
  const span = Math.max(1, range.hi - range.lo);
  const pos = (e) => Math.max(0, Math.min(100, ((hourOf(new Date(e.at)) - range.lo) / span) * 100));
  const inOrder = [...entries].reverse();
  const lo = inOrder.length ? pos(inOrder[0]) : 0;
  const hi = inOrder.length ? pos(inOrder[inOrder.length - 1]) : 0;
  return (
    <div className="ta-track" aria-label={`${entries.length} actions`}>
      <span className="ta-track-line" />
      {inOrder.length > 1 && <span className="ta-track-span" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />}
      {inOrder.map((e, i) => (
        <span
          key={e.id}
          className={`ta-tick ta-tone-${KINDS[e.kind].tone}`}
          style={{ left: `${pos(e)}%`, '--i': i }}
          title={`${format(new Date(e.at), 'h:mm a')} · ${KINDS[e.kind].label} · ${e.text}`}
        />
      ))}
    </div>
  );
}

function WeekTrack({ perDay, days }) {
  const peak = Math.max(1, ...perDay.map(l => l.length));
  return (
    <div className="ta-week">
      {perDay.map((list, i) => {
        const byTone = TONE_ORDER.map(t => [t, list.filter(e => KINDS[e.kind].tone === t).length]).filter(([, v]) => v);
        return (
          <div key={i} className="ta-week-col" title={`${format(days[i], 'EEE, MMM d')}: ${list.length}`}>
            <div className="ta-week-bar" style={{ height: `${list.length ? Math.max(14, (list.length / peak) * 100) : 0}%`, '--i': i }}>
              {byTone.map(([t, v]) => <span key={t} className={`ta-week-seg ta-tone-${t}`} style={{ flexGrow: v }} />)}
            </div>
            <span className={`ta-week-day ${list.length ? '' : 'is-zero'}`}>{format(days[i], 'EEEEE')}</span>
          </div>
        );
      })}
    </div>
  );
}

function Timeline({ entries, mode, days, onOpenEntry }) {
  // Everything the person did, in the order they did it. A week is split by
  // day (Monday first); a day is one list.
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
              <span>{format(d, 'EEEE, MMM d')}</span>
              <span className="count">{list.length}</span>
            </div>
          )}
          <ol className="ta-tl">
            {list.map((e, i) => {
              const k = KINDS[e.kind];
              return (
                <li key={e.id} style={{ '--i': Math.min(i, 14) }}>
                  <button type="button" className={`ta-tl-item ta-tone-${k.tone}`} onClick={() => onOpenEntry(e)}>
                    <time className="ta-tl-time" dateTime={e.at}>{format(new Date(e.at), 'h:mm a')}</time>
                    <span className="ta-tl-dot" />
                    <span className="ta-tl-body">
                      <span className="ta-tl-title">{e.text || '(untitled)'}</span>
                      <span className="ta-tl-meta">
                        <span className="ta-tl-kind">{k.label}</span>
                        {e.page && <> · <span>{e.page}</span></>}
                      </span>
                      {e.note && <span className="ta-tl-note">“{e.note}”</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}
