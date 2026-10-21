import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications, NOTIF_TYPES } from '../context/NotificationContext';
import { openTask } from '../lib/events';
import { taskPreview, pageLabel, htmlToText } from '../lib/taskText';
import {
  Sheet, Icon, Avatar, Tabs, Segmented, Empty, SheetLabel, useEscapeStack,
  shortDate, longDate, STATUS_LABEL, cap,
} from '../ui';
import './NotificationCenter.css';

// ══════════════════════════════════════════════════════════════
// Notifications — a right-hand panel opened from the top-bar bell (or the
// phone "More" sheet). Layout mounts it only while open.
//   list     → Unread / All, Mark all read
//   detail   → one notification, with a jump to the thing it's about
//   settings → which kinds, whose completions, which review posts
// Esc steps back from a sub-view; ✕ closes the panel.
// ══════════════════════════════════════════════════════════════

const REVIEW_VERB = {
  submitted: 'posted for review',
  resubmitted: 'resubmitted',
  approved: 'approved',
  needs_work: 'asked for changes on',
  went_live: 'marked live',
};

// What the actor did, in a few words: "Morgan completed …".
function verbFor(n) {
  const d = n.data || {};
  switch (n.type) {
    case 'task_created': return 'added';
    case 'task_completed': return 'completed';
    case 'submission': return 'submitted';
    case 'file_added': return 'New file';
    case 'review_comment': return 'commented on';
    case 'review_request':
    case 'review_decision': return REVIEW_VERB[d.event?.kind] || 'updated';
    default: return '';
  }
}

// "now", "4m", "3h", "2d", then a short date.
function rel(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return shortDate(iso);
}

export default function NotificationCenter({ onClose }) {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [tab, setTab] = useState(unreadCount > 0 ? 'unread' : 'all');
  const [view, setView] = useState({ name: 'list' }); // { name: 'list' | 'detail' | 'settings', notif? }
  const back = () => setView({ name: 'list' });
  // Esc in a sub-view goes back to the list rather than closing everything.
  useEscapeStack(back, view.name !== 'list');

  const open = (n) => { markRead(n.id); setView({ name: 'detail', notif: n }); };
  const shown = tab === 'unread' ? notifications.filter(n => !n.read) : notifications;

  const eyebrow = (
    <>
      {view.name !== 'list' && (
        <button type="button" className="nc-back" onClick={back} aria-label="Back to notifications">
          <Icon name="chevronLeft" size={16} />
        </button>
      )}
      Notifications
      {view.name === 'settings' && <span className="t-4">· Settings</span>}
      {view.name === 'detail' && <span className="t-4">· {NOTIF_TYPES[view.notif.type]?.label}</span>}
      {view.name === 'list' && unreadCount > 0 && <span key={unreadCount} className="t-4 bump">· {unreadCount} unread</span>}
    </>
  );

  let body;
  let footer;
  if (view.name === 'detail') {
    const d = detailFor(view.notif);
    body = <Detail notif={view.notif} rows={d.rows} />;
    footer = (
      <>
        <span className="sheet-foot-note mono nc-foot-note">{longDate(view.notif.createdAt)}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={back}>Back</button>
        {d.action && <DetailAction action={d.action} onClose={onClose} />}
      </>
    );
  } else if (view.name === 'settings') {
    body = <Settings />;
    footer = (
      <>
        <span className="sheet-foot-note">Saved as you go, on every device.</span>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={back}>Done</button>
      </>
    );
  } else {
    body = (
      <>
        <div className="nc-bar">
          <Tabs
            value={tab}
            onChange={setTab}
            className="nc-tabs"
            items={[
              { value: 'unread', label: 'Unread', count: unreadCount },
              { value: 'all', label: 'All', count: notifications.length },
            ]}
          />
          <div className="nc-bar-actions">
            {unreadCount > 0 && (
              <button type="button" className="btn btn-ghost btn-sm nc-markall" onClick={markAllRead}>
                <Icon name="check" size={13} />Mark all read
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-sm btn-icon nc-gear" onClick={() => setView({ name: 'settings' })}
              aria-label="Notification settings" title="Notification settings">
              <Icon name="settings" size={15} />
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <Empty icon="bell" title={tab === 'unread' ? "You're all caught up" : 'No notifications yet'}>
            {tab === 'unread' ? 'New activity on your team shows up here.' : 'Activity from the last 30 days shows up here.'}
          </Empty>
        ) : (
          <ul key={tab} className="nc-list stagger">
            {shown.map(n => <Row key={n.id} n={n} onOpen={open} />)}
          </ul>
        )}
      </>
    );
    footer = (
      <>
        <span className="sheet-foot-note">Last 30 days</span>
        <span className="spacer" />
        <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
      </>
    );
  }

  return (
    <Sheet
      eyebrow={eyebrow}
      onClose={onClose}
      footer={footer}
      className="nc-sheet"
      mainClassName="nc-main"
    >
      <div key={view.name} className={`nc-view nc-view-${view.name}`}>{body}</div>
    </Sheet>
  );
}

function Row({ n, onOpen }) {
  const { senderMeta } = useNotifications();
  const meta = NOTIF_TYPES[n.type] || {};
  const sender = n.from ? senderMeta(n.from) : null;
  const verb = verbFor(n);
  return (
    <li>
      <button type="button" className={`nc-row ${n.read ? '' : 'is-unread'}`} onClick={() => onOpen(n)}>
        <span className="nc-avatar">
          {n.from
            ? <Avatar src={sender?.avatar_url} name={n.from} size={32} />
            : <span className="nc-type-icon"><Icon name={meta.icon || 'bell'} size={15} /></span>}
          {n.from && (
            <span className={`nc-badge nc-badge-${meta.tone || 'open'}`} aria-hidden="true">
              <Icon name={meta.icon || 'bell'} size={9} stroke={2.6} />
            </span>
          )}
        </span>
        <span className="nc-row-body">
          <span className="nc-row-text">
            {n.from && <b>{n.from}</b>} {verb} <span className="nc-obj">{n.title}</span>
          </span>
          <span className="nc-row-meta">
            <span className="mono">{rel(n.createdAt)}</span>
            <span className="nc-sep">·</span>
            {meta.label}
          </span>
        </span>
        {!n.read && <span className="nc-unread" aria-label="Unread" />}
      </button>
    </li>
  );
}

// ── Detail ──────────────────────────────────────────────────
function detailFor(notif) {
  const d = notif.data || {};
  let rows = [];
  let action = null;
  if (d.kind === 'task') {
    const t = d.task || {};
    rows = [
      ['Page', pageLabel(t.page) || '—', 'mono'],
      ['Status', t.status ? <><span className={`dot dot-${t.status}`} />{STATUS_LABEL[t.status] || cap(t.status)}</> : '—'],
      ['ROI', cap(t.roi) || '—', ['high', 'critical'].includes(t.roi) ? 'prio-high' : ''],
      ['Noticed by', t.noticed_by || '—'],
      notif.type === 'task_completed' && ['Completed by', t.completed_by || '—'],
      notif.type === 'task_completed' && t.date_completed && ['Completed', longDate(t.date_completed), 'mono'],
      ['Description', taskPreview(t, 600) || '—', 'nc-prose'],
    ].filter(Boolean);
    if (t.id) action = { label: 'Open task', task: t.id };
  } else if (d.kind === 'submission') {
    const s = d.submission || {};
    rows = [
      ['Page', pageLabel(s.page) || '—', 'mono'],
      ['Noticed by', s.noticed_by || '—'],
      ['Details', htmlToText(s.feedback) || '—', 'nc-prose'],
    ];
    action = { label: 'Review submissions', to: '/submissions' };
  } else if (d.kind === 'review') {
    rows = [
      ['Post', d.postTitle || notif.title],
      ['What', notif.subtitle],
      d.event?.note && ['Note', d.event.note, 'nc-prose'],
      d.comment && ['Comment', htmlToText(d.comment.content) || '(attachment)', 'nc-prose'],
      ['From', notif.from || '—'],
    ].filter(Boolean);
    action = { label: 'Open review', to: `/review?post=${d.postId}` };
  } else if (d.kind === 'file') {
    rows = [
      ['File', d.file?.name || d.file?.title || '—', 'mono'],
      d.file?.path && ['Path', d.file.path, 'mono'],
      d.file?.section && ['Section', d.file.section],
    ].filter(Boolean);
    action = { label: 'Open Files', to: d.file?.id ? `/files?id=${d.file.id}` : '/files' };
  }
  return { rows, action };
}

function Detail({ notif, rows }) {
  const { senderMeta } = useNotifications();
  const meta = NOTIF_TYPES[notif.type] || {};
  const sender = notif.from ? senderMeta(notif.from) : null;
  return (
    <div className="nc-detail">
      <div className="nc-detail-head">
        <span className="nc-detail-kind"><span className={`dot dot-${meta.tone || 'open'}`} />{meta.label}</span>
        <h2 className="nc-detail-title">{notif.title}</h2>
        {notif.from && (
          <div className="nc-detail-from">
            <Avatar src={sender?.avatar_url} name={notif.from} size={22} />
            <span><b>{notif.from}</b> {verbFor(notif)}</span>
            <span className="mono t-3">· {rel(notif.createdAt)}</span>
          </div>
        )}
      </div>
      <div className="meta nc-meta stagger">
        {rows.map(([k, v, cls]) => (
          <React.Fragment key={k}>
            <span className="meta-k">{k}</span>
            <span className={`meta-v ${cls || ''} ${v === '—' ? 'is-empty' : ''}`}>{v}</span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function DetailAction({ action, onClose }) {
  const navigate = useNavigate();
  const go = () => {
    onClose();
    if (action.task) openTask(action.task);
    else navigate(action.to);
  };
  return (
    <button type="button" className="btn btn-primary" onClick={go} autoFocus>
      {action.label}<Icon name="arrowRight" size={14} />
    </button>
  );
}

// ── Settings ────────────────────────────────────────────────
function Settings() {
  const { settings, updateSettings, people } = useNotifications();
  const [peopleOpen, setPeopleOpen] = useState(settings.completedScope === 'selected');
  useEffect(() => { setPeopleOpen(settings.completedScope === 'selected'); }, [settings.completedScope]);

  const toggleType = (key) =>
    updateSettings(prev => ({ ...prev, types: { ...prev.types, [key]: !prev.types[key] } }));

  const togglePerson = (name) =>
    updateSettings(prev => {
      const has = prev.completedPeople.includes(name);
      return { ...prev, completedPeople: has ? prev.completedPeople.filter(x => x !== name) : [...prev.completedPeople, name] };
    });

  const reviewOn = settings.types.review_request || settings.types.review_decision || settings.types.review_comment;

  return (
    <div className="nc-settings">
      <section className="nc-set-section">
        <SheetLabel>Notify me about</SheetLabel>
        <div className="nc-set-list">
          {Object.entries(NOTIF_TYPES).map(([key, meta]) => (
            <label key={key} className="nc-set-row">
              <span className="nc-set-icon"><Icon name={meta.icon} size={14} /></span>
              <span className="nc-set-label">{meta.label}</span>
              <input type="checkbox" className="switch" checked={!!settings.types[key]} onChange={() => toggleType(key)} />
            </label>
          ))}
        </div>
      </section>

      <section className="nc-set-section">
        <SheetLabel>Your own activity</SheetLabel>
        <div className="nc-set-list">
          <label className="nc-set-row">
            <span className="nc-set-icon"><Icon name="user" size={14} /></span>
            <span className="nc-set-label">
              Things I do
              <span className="nc-set-hint">Tasks you add or complete, review posts and comments</span>
            </span>
            <input
              type="checkbox" className="switch" checked={!!settings.includeSelf}
              onChange={() => updateSettings(prev => ({ ...prev, includeSelf: !prev.includeSelf }))}
            />
          </label>
        </div>
      </section>

      {reviewOn && (
        <section className="nc-set-section anim-rise">
          <SheetLabel sub="“Ones I'm on” means posts you wrote or were picked to review.">Ready for review — which posts?</SheetLabel>
          <Segmented
            value={settings.reviewScope === 'all' ? 'all' : 'involved'}
            onChange={(v) => updateSettings({ reviewScope: v })}
            options={[{ value: 'involved', label: "Ones I'm on" }, { value: 'all', label: 'Every post' }]}
          />
        </section>
      )}

      {settings.types.task_completed && (
        <section className="nc-set-section anim-rise">
          <SheetLabel>Completed tasks — whose?</SheetLabel>
          <Segmented
            value={settings.completedScope === 'selected' ? 'selected' : 'all'}
            onChange={(v) => updateSettings({ completedScope: v })}
            options={[{ value: 'all', label: 'Everyone' }, { value: 'selected', label: 'Specific people' }]}
          />
          {peopleOpen && (
            <div className="chip-row nc-people stagger">
              {people.length === 0 && <span className="t-3 nc-set-hint">No teammates found.</span>}
              {people.map(name => {
                const on = settings.completedPeople.includes(name);
                return (
                  <button key={name} type="button" className={`chip-toggle ${on ? 'is-on' : ''}`} onClick={() => togglePerson(name)} aria-pressed={on}>
                    {on && <Icon name="check" size={13} stroke={2.6} />}{name}
                  </button>
                );
              })}
            </div>
          )}
          {peopleOpen && settings.completedPeople.length === 0 && people.length > 0 && (
            <p className="nc-set-hint nc-warn">Pick at least one person, or you won't hear about any completions.</p>
          )}
        </section>
      )}
    </div>
  );
}
