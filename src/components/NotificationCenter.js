import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow, format } from 'date-fns';
import { useNotifications, NOTIF_TYPES } from '../context/NotificationContext';
import './NotificationCenter.css';

const BellIcon = (props) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

export default function NotificationCenter() {
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();
  const [detail, setDetail]     = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState('unread'); // 'unread' (main) | 'all'

  const open = (n) => { markRead(n.id); setDetail(n); };

  const shown = tab === 'unread' ? notifications.filter(n => !n.read) : notifications;

  return (
    <div className="widget nc">
      <div className="widget-head">
        <span className="widget-head-title">
          <span className="nc-bell-wrap">
            <BellIcon />
            {unreadCount > 0 && (
              <span className="nc-badge" aria-label={`${unreadCount} unread`}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </span>
          Notifications
        </span>
        <div className="widget-head-actions">
          {unreadCount > 0 && (
            <button className="nc-action" onClick={markAllRead} title="Mark all as read">
              Mark all read
            </button>
          )}
          <button className="nc-icon-btn" onClick={() => setShowSettings(true)} title="Notification settings" aria-label="Notification settings">
            <GearIcon />
          </button>
        </div>
      </div>

      <div className="nc-tabs">
        <button
          className={`nc-tab ${tab === 'unread' ? 'nc-tab-active' : ''}`}
          onClick={() => setTab('unread')}
        >
          Unread
          {unreadCount > 0 && <span className="nc-tab-count">{unreadCount}</span>}
        </button>
        <button
          className={`nc-tab ${tab === 'all' ? 'nc-tab-active' : ''}`}
          onClick={() => setTab('all')}
        >
          All
          {notifications.length > 0 && <span className="nc-tab-count nc-tab-count-muted">{notifications.length}</span>}
        </button>
      </div>

      <div className="nc-list">
        {shown.length === 0 ? (
          <div className="nc-empty">
            <BellIcon width="22" height="22" />
            <span>{tab === 'unread' ? "You're all caught up." : 'No notifications yet.'}</span>
          </div>
        ) : (
          shown.map(n => {
            const meta = NOTIF_TYPES[n.type] || {};
            return (
              <button
                key={n.id}
                className={`nc-item ${n.read ? 'nc-item-read' : ''}`}
                style={{ '--nc-color': meta.color }}
                onClick={() => open(n)}
              >
                <span className="nc-dot" />
                <span className="nc-item-body">
                  <span className="nc-item-top">
                    <span className="nc-item-title">{n.title}</span>
                    <span className="nc-item-time">{timeAgo(n.createdAt)}</span>
                  </span>
                  <span className="nc-item-sub">
                    <span className="nc-tag" style={{ color: meta.color, borderColor: meta.color }}>{meta.label}</span>
                    {n.subtitle}
                  </span>
                </span>
                {!n.read && <span className="nc-unread-pip" />}
              </button>
            );
          })
        )}
      </div>

      {detail && <NotificationDetail notif={detail} onClose={() => setDetail(null)} />}
      {showSettings && <NotificationSettings onClose={() => setShowSettings(false)} />}
    </div>
  );
}

function timeAgo(iso) {
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }).replace('about ', ''); }
  catch { return ''; }
}

// ── Detail popup ────────────────────────────────────────────
function NotificationDetail({ notif, onClose }) {
  const navigate = useNavigate();
  const meta = NOTIF_TYPES[notif.type] || {};
  const d = notif.data || {};

  let rows = [];
  let action = null;
  if (d.kind === 'task') {
    const t = d.task;
    rows = [
      ['Page', t.page || '—'],
      ['Status', (t.status || '').replace('_', ' ')],
      ['ROI', t.roi || '—'],
      ['Noticed by', t.noticed_by || '—'],
      notif.type === 'task_completed' && ['Completed by', t.completed_by || '—'],
      notif.type === 'task_completed' && t.date_completed && ['Completed', fmt(t.date_completed)],
      ['Feedback', stripHtml(t.feedback) || '—'],
    ].filter(Boolean);
    action = { label: 'Open task', go: () => navigate(`/tasks/${t.id}`) };
  } else if (d.kind === 'comment') {
    rows = [
      ['Project', d.projectTitle || '—'],
      ['Comment', stripHtml(d.comment?.content) || '(image / attachment)'],
      ['Posted', fmt(notif.createdAt)],
    ];
    if (d.projectId) action = { label: 'Open project', go: () => navigate(`/projects/${d.projectId}`) };
  } else if (d.kind === 'submission') {
    const s = d.submission;
    rows = [
      ['Page', s.page || '—'],
      ['Noticed by', s.noticed_by || '—'],
      ['Details', stripHtml(s.feedback) || '—'],
      ['Submitted', fmt(notif.createdAt)],
    ];
    action = { label: 'Review submissions', go: () => navigate('/submissions') };
  } else if (d.kind === 'file') {
    rows = [
      ['File', d.file?.name || d.file?.title || '—'],
      ['Added', fmt(notif.createdAt)],
    ];
    action = { label: 'Open Files', go: () => navigate('/files') };
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal nc-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span className="nc-detail-dot" style={{ background: meta.color }} />
            <div style={{ minWidth: 0 }}>
              <div className="nc-detail-type" style={{ color: meta.color }}>{meta.label}</div>
              <div className="nc-detail-title">{notif.title}</div>
            </div>
          </div>
          <button className="nc-icon-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="nc-detail-rows">
            {rows.map(([k, v]) => (
              <div key={k} className="nc-detail-row">
                <span className="nc-detail-key">{k}</span>
                <span className="nc-detail-val">{v}</span>
              </div>
            ))}
          </div>
        </div>
        {action && (
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={() => { onClose(); action.go(); }}>{action.label}</button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ── Settings modal ──────────────────────────────────────────
function NotificationSettings({ onClose }) {
  const { settings, updateSettings, people } = useNotifications();

  const toggleType = (key) =>
    updateSettings(prev => ({ ...prev, types: { ...prev.types, [key]: !prev.types[key] } }));

  const togglePerson = (name) =>
    updateSettings(prev => {
      const has = prev.completedPeople.includes(name);
      return {
        ...prev,
        completedPeople: has ? prev.completedPeople.filter(n => n !== name) : [...prev.completedPeople, name],
      };
    });

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal nc-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16, fontWeight: 700 }}>Notification settings</h2>
          <button className="nc-icon-btn" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="label" style={{ marginBottom: 10 }}>Notify me about</p>
          <div className="nc-set-list">
            {Object.entries(NOTIF_TYPES).map(([key, meta]) => (
              <label key={key} className="nc-set-row">
                <span className="nc-set-label">
                  <span className="nc-dot" style={{ '--nc-color': meta.color }} />
                  {meta.label}
                </span>
                <Toggle on={!!settings.types[key]} onClick={() => toggleType(key)} />
              </label>
            ))}
          </div>

          {settings.types.task_completed && (
            <>
              <p className="label" style={{ margin: '20px 0 10px' }}>Completed tasks — whose?</p>
              <div className="nc-scope-row">
                <button
                  className={`nc-scope-btn ${settings.completedScope === 'all' ? 'nc-scope-active' : ''}`}
                  onClick={() => updateSettings({ completedScope: 'all' })}
                >Everyone</button>
                <button
                  className={`nc-scope-btn ${settings.completedScope === 'selected' ? 'nc-scope-active' : ''}`}
                  onClick={() => updateSettings({ completedScope: 'selected' })}
                >Specific people</button>
              </div>
              {settings.completedScope === 'selected' && (
                <div className="nc-people">
                  {people.length === 0 && <p className="nc-people-empty">No teammates found.</p>}
                  {people.map(name => {
                    const on = settings.completedPeople.includes(name);
                    return (
                      <button key={name} className={`nc-person ${on ? 'nc-person-on' : ''}`} onClick={() => togglePerson(name)}>
                        {on && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                        {name}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Toggle({ on, onClick }) {
  return (
    <button className={`nc-toggle ${on ? 'nc-toggle-on' : ''}`} onClick={onClick} role="switch" aria-checked={on}>
      <span className="nc-toggle-thumb" />
    </button>
  );
}

function stripHtml(s) {
  if (!s) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = s;
  return (tmp.textContent || tmp.innerText || '').trim();
}

function fmt(iso) {
  try { return format(new Date(iso), 'MMM d, yyyy · h:mm a'); } catch { return ''; }
}
