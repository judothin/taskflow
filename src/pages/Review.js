import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatDistanceToNowStrict, format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { searchRank } from '../lib/fuzzySearch';
import Avatar from '../components/Avatar';
import ModalPortal from '../components/ModalPortal';
import {
  REVIEW_STATUS, REVIEWS_CHANGED, useReviewPosts, fetchReviewThread, isWaitingOn,
  createReview, updateReview, deleteReview, decideReview, reopenReview, resubmitReview,
  setReviewers, addReviewComment, deleteReviewComment, uploadReviewScreenshot,
  fetchDefaultReviewers, saveDefaultReviewers, fullName, initialsOf, isUrl, shortUrl, normalizeUrl,
  REVIEW_PRECHECK,
} from '../lib/reviews';
import './Review.css';

// ══════════════════════════════════════════════════════════════
// Ready for Review
// --------------------------------------------------------------
// Someone posts a link to work that's ready to look at and picks who may
// sign it off. Any one of those reviewers marks it "Reviewed — ready for
// live" or "Reviewed — needs work" (which has to say what). The author
// fixes it and resubmits, starting the next round; every verdict and note
// stays in the post's history alongside its comments.
//
// The rules live in the database (supabase-review-migration.sql) — the
// buttons here only mirror them.
// ══════════════════════════════════════════════════════════════

const ago = (iso) => (iso ? formatDistanceToNowStrict(new Date(iso), { addSuffix: true }) : '');
const fmt = (iso) => { try { return format(new Date(iso), 'MMM d, yyyy · h:mm a'); } catch { return ''; } };

const TABS = [
  { id: 'mine',       label: 'Waiting on me' },
  { id: 'open',       label: 'Open' },
  { id: 'needs_work', label: 'Needs work' },
  { id: 'approved',   label: 'Ready for live' },
  { id: 'all',        label: 'All' },
];

const ICONS = {
  review: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>,
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  search: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>,
  x: <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>,
  link: <><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" /></>,
  external: <><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  alert: <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></>,
  comment: <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></>,
  undo: <><path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" /></>,
  send: <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>,
  edit: <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></>,
  trash: <><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6 M10 11v6 M14 11v6 M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" /></>,
  users: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75" /></>,
  upload: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></>,
  refresh: <><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></>,
  list: <><path d="M9 11l3 3L22 4" /><line x1="3" y1="6" x2="5" y2="6" /><line x1="3" y1="12" x2="5" y2="12" /><line x1="3" y1="18" x2="5" y2="18" /><line x1="9" y1="18" x2="17" y2="18" /></>,
};
const Svg = ({ name, size = 15, width = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[name]}
  </svg>
);

function StatusPill({ status }) {
  const s = REVIEW_STATUS[status] || REVIEW_STATUS.pending;
  return <span className={`rv-pill rv-pill-${s.tone}`}><span className="rv-pill-dot" />{s.short}</span>;
}

function PersonAvatar({ person, size = 22 }) {
  return (
    <span className="rv-avatar" title={fullName(person) || 'Unknown'}>
      <Avatar src={person?.avatar_url} color={person?.color || '#6366f1'} initials={initialsOf(person)} size={size} />
    </span>
  );
}

function AvatarStack({ ids, members, max = 4, size = 22 }) {
  const people = ids.map(id => members[id]).filter(Boolean);
  return (
    <span className="rv-stack">
      {people.slice(0, max).map(p => <PersonAvatar key={p.id} person={p} size={size} />)}
      {people.length > max && <span className="rv-stack-more" style={{ width: size, height: size }}>+{people.length - max}</span>}
    </span>
  );
}

// ── Reviewer picker (chips) ───────────────────────────────────
function ReviewerPicker({ members, value, onChange }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
  if (!members.length) return <p className="rv-hint">Loading teammates…</p>;
  return (
    <div className="rv-people" role="group" aria-label="Reviewers">
      {members.map(m => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            className={`rv-person ${on ? 'rv-person-on' : ''}`}
            onClick={() => toggle(m.id)}
            aria-pressed={on}
          >
            <Avatar src={m.avatar_url} color={m.color || '#6366f1'} initials={initialsOf(m)} size={20} />
            <span>{fullName(m) || m.email}</span>
            {on && <Svg name="check" size={13} width={3} />}
          </button>
        );
      })}
    </div>
  );
}

// ── Pre-check ─────────────────────────────────────────────────
// What the author confirms before posting or resubmitting. Every item must
// be ticked before the post button enables; `checked` is a Set of item ids.
function PrecheckList({ checked, onToggle }) {
  return (
    <ul className="rv-precheck">
      {REVIEW_PRECHECK.map(item => {
        const on = checked.has(item.id);
        return (
          <li key={item.id}>
            <label className={`rv-precheck-item ${on ? 'rv-precheck-on' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => onToggle(item.id)} />
              <span className="rv-precheck-box" aria-hidden="true"><Svg name="check" size={12} width={3} /></span>
              <span className="rv-precheck-text">
                <span className="rv-precheck-label">{item.label}</span>
                <span className="rv-precheck-hint">{item.hint}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

const usePrecheck = () => {
  const [checked, setChecked] = useState(() => new Set());
  const toggle = (id) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const reset = () => setChecked(new Set());
  return { checked, toggle, reset, done: REVIEW_PRECHECK.every(i => checked.has(i.id)) };
};

// The same list, read-only, from the page header — for checking your work
// before you've even opened the form.
function PrecheckModal({ onClose, onStart }) {
  return (
    <ModalPortal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal rv-precheck-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="rv-modal-title">Pre-check</h2>
            <button className="rv-icon-btn" onClick={onClose} aria-label="Close"><Svg name="x" size={18} /></button>
          </div>
          <div className="modal-body">
            <p className="rv-hint rv-hint-top">Run through these before posting something for review. You'll confirm each one when you post.</p>
            <ol className="rv-precheck rv-precheck-static">
              {REVIEW_PRECHECK.map((item, i) => (
                <li key={item.id} className="rv-precheck-item">
                  <span className="rv-precheck-num">{i + 1}</span>
                  <span className="rv-precheck-text">
                    <span className="rv-precheck-label">{item.label}</span>
                    <span className="rv-precheck-hint">{item.hint}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={onStart}><Svg name="plus" size={15} width={2.5} /> New post</button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── Screenshots: upload, paste, remove ───────────────────────
function ScreenshotField({ teamId, value, onChange, onBusy }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = useCallback(async (files) => {
    const images = [...files].filter(f => f.type.startsWith('image/'));
    if (!images.length) return;
    const tooBig = images.find(f => f.size > 8 * 1024 * 1024);
    if (tooBig) { setError('Each image must be 8 MB or smaller.'); return; }
    setError(''); setBusy(true); onBusy?.(true);
    try {
      const urls = await Promise.all(images.map(f => uploadReviewScreenshot(teamId, f)));
      onChange(prev => [...prev, ...urls]);
    } catch (e) {
      setError(e.message || 'Upload failed.');
    } finally {
      setBusy(false); onBusy?.(false);
    }
  }, [teamId, onChange, onBusy]);

  // Paste a screenshot straight from the clipboard while the form is open.
  useEffect(() => {
    const onPaste = (e) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); add(files); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [add]);

  return (
    <div className="rv-shots-field">
      {value.length > 0 && (
        <div className="rv-shots">
          {value.map(url => (
            <div key={url} className="rv-shot" style={{ backgroundImage: `url("${url}")` }}>
              <button type="button" className="rv-shot-remove" onClick={() => onChange(prev => prev.filter(u => u !== url))} aria-label="Remove screenshot">
                <Svg name="x" size={12} width={3} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="rv-upload" onClick={() => inputRef.current?.click()} disabled={busy}>
        {busy ? <span className="rv-spinner" /> : <Svg name="upload" size={15} />}
        {busy ? 'Uploading…' : 'Add screenshots'}
        <span className="rv-upload-hint">or paste</span>
      </button>
      <input ref={inputRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { add(e.target.files || []); e.target.value = ''; }} />
      {error && <div className="error-msg">⚠ {error}</div>}
    </div>
  );
}

// ── New / edit post ───────────────────────────────────────────
function ComposerModal({ post, teamId, members, defaults, onClose, onSaved }) {
  const editing = !!post;
  const [title, setTitle] = useState(post?.title || '');
  const [url, setUrl] = useState(post?.url || '');
  const [description, setDescription] = useState(post?.description || '');
  const [screenshots, setScreenshots] = useState(post?.screenshots || []);
  const [reviewers, setReviewerIds] = useState(post?.reviewers || defaults);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const precheck = usePrecheck();

  // Defaults load async; fill them in if the user hasn't picked anyone yet.
  const touched = useRef(false);
  useEffect(() => {
    if (!editing && !touched.current && defaults.length) setReviewerIds(defaults);
  }, [defaults, editing]);

  const canSave = title.trim() && reviewers.length && !uploading && !saving && (editing || precheck.done);
  const save = async () => {
    if (!canSave) return;
    setSaving(true); setError('');
    try {
      if (editing) {
        await updateReview(post.id, { title: title.trim(), url, description, screenshots });
        const before = [...post.reviewers].sort().join();
        if ([...reviewers].sort().join() !== before) await setReviewers(post.id, reviewers);
        onSaved(post.id);
      } else {
        const id = await createReview({ teamId, title, url, description, screenshots, reviewers });
        onSaved(id);
      }
    } catch (e) {
      setError(e.message || 'Could not save.');
      setSaving(false);
    }
  };

  const keys = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); save(); } };

  return (
    <ModalPortal>
      <div className="modal-overlay" onClick={() => !saving && onClose()}>
        <div className="modal rv-composer" onClick={e => e.stopPropagation()} onKeyDown={keys}>
          <div className="modal-header">
            <h2 className="rv-modal-title">{editing ? 'Edit post' : 'Ready for review'}</h2>
            <button className="rv-icon-btn" onClick={onClose} aria-label="Close"><Svg name="x" size={18} /></button>
          </div>
          <div className="modal-body">
            <div className="form-grid">
              <div className="form-group">
                <label className="label" htmlFor="rv-title">What's ready?</label>
                <input id="rv-title" className="input" autoFocus value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. New pricing page" maxLength={160} />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="rv-url">Link</label>
                <input id="rv-url" className="input" value={url} onChange={e => setUrl(e.target.value)}
                  onBlur={() => setUrl(normalizeUrl(url))}
                  placeholder="https://staging.example.com/pricing" inputMode="url" />
              </div>
              <div className="form-group">
                <label className="label" htmlFor="rv-desc">What to look at <span className="rv-optional">optional</span></label>
                <textarea id="rv-desc" className="input rv-textarea" rows={4} value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What changed, what to check, anything you're unsure about…" />
              </div>
              <div className="form-group">
                <span className="label">Screenshots <span className="rv-optional">optional</span></span>
                <ScreenshotField teamId={teamId} value={screenshots} onChange={setScreenshots} onBusy={setUploading} />
              </div>
              <div className="form-group">
                <span className="label">Reviewers</span>
                <p className="rv-hint">Only these people can mark it reviewed. Any one of them decides.</p>
                <ReviewerPicker members={members} value={reviewers}
                  onChange={(v) => { touched.current = true; setReviewerIds(v); }} />
              </div>
              {!editing && (
                <div className="form-group">
                  <span className="label">Before you post</span>
                  <PrecheckList checked={precheck.checked} onToggle={precheck.toggle} />
                </div>
              )}
              {error && <div className="error-msg">⚠ {error}</div>}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            {!editing && !precheck.done && (
              <span className="rv-footer-hint">
                {REVIEW_PRECHECK.length - precheck.checked.size} pre-check item{REVIEW_PRECHECK.length - precheck.checked.size === 1 ? '' : 's'} left
              </span>
            )}
            <button className="btn btn-primary" onClick={save} disabled={!canSave}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Post for review'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── Team default reviewers ────────────────────────────────────
function DefaultsModal({ teamId, members, value, canEdit, onClose, onSaved }) {
  const [ids, setIds] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true); setError('');
    try { await saveDefaultReviewers(teamId, ids); onSaved(ids); }
    catch (e) { setError(e.message || 'Could not save.'); setSaving(false); }
  };
  return (
    <ModalPortal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal rv-defaults" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h2 className="rv-modal-title">Default reviewers</h2>
            <button className="rv-icon-btn" onClick={onClose} aria-label="Close"><Svg name="x" size={18} /></button>
          </div>
          <div className="modal-body">
            <p className="rv-hint rv-hint-top">
              Pre-selected on every new post for this team. People can still change them per post.
              {!canEdit && ' Only team owners and admins can change this list.'}
            </p>
            {canEdit
              ? <ReviewerPicker members={members} value={ids} onChange={setIds} />
              : (
                <div className="rv-people">
                  {ids.length === 0 && <p className="rv-hint">None set.</p>}
                  {members.filter(m => ids.includes(m.id)).map(m => (
                    <span key={m.id} className="rv-person rv-person-on rv-person-static">
                      <Avatar src={m.avatar_url} color={m.color || '#6366f1'} initials={initialsOf(m)} size={20} />
                      <span>{fullName(m)}</span>
                    </span>
                  ))}
                </div>
              )}
            {error && <div className="error-msg" style={{ marginTop: 12 }}>⚠ {error}</div>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
            {canEdit && <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── History + comments timeline ───────────────────────────────
const EVENT_TEXT = {
  submitted:   () => 'posted this for review',
  resubmitted: (e) => `resubmitted it for review · round ${e.round}`,
  approved:    () => 'marked it reviewed — ready for live',
  needs_work:  () => 'marked it reviewed — needs work',
  reopened:    () => 'undid the decision',
};

function Timeline({ events, comments, members, uid, onDeleteComment }) {
  const [armed, setArmed] = useState(null);
  const items = useMemo(() => [
    ...events.map(e => ({ kind: 'event', at: e.created_at, e })),
    ...comments.map(c => ({ kind: 'comment', at: c.created_at, c })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at)), [events, comments]);

  if (!items.length) return <p className="rv-hint">No activity yet.</p>;

  return (
    <ol className="rv-timeline">
      {items.map(item => {
        if (item.kind === 'event') {
          const { e } = item;
          const who = members[e.actor];
          return (
            <li key={`e-${e.id}`} className={`rv-tl-event rv-tl-${e.kind}`}>
              <span className="rv-tl-marker" aria-hidden="true">
                <Svg name={e.kind === 'approved' ? 'check' : e.kind === 'needs_work' ? 'alert' : e.kind === 'reopened' ? 'undo' : e.kind === 'resubmitted' ? 'refresh' : 'send'} size={12} width={2.5} />
              </span>
              <div className="rv-tl-body">
                <div className="rv-tl-line">
                  <strong>{fullName(who) || 'Someone'}</strong> {EVENT_TEXT[e.kind]?.(e)}
                  <span className="rv-tl-time" title={fmt(e.created_at)}>{ago(e.created_at)}</span>
                </div>
                {e.note && <div className="rv-tl-note">{e.note}</div>}
              </div>
            </li>
          );
        }
        const { c } = item;
        const who = members[c.user_id];
        const mine = c.user_id === uid;
        return (
          <li key={`c-${c.id}`} className="rv-tl-comment">
            <PersonAvatar person={who} size={26} />
            <div className="rv-tl-bubble">
              <div className="rv-tl-head">
                <strong>{fullName(who) || 'Someone'}</strong>
                <span className="rv-tl-time" title={fmt(c.created_at)}>{ago(c.created_at)}</span>
                {mine && (
                  <button
                    type="button"
                    className={`rv-tl-del ${armed === c.id ? 'rv-tl-del-armed' : ''}`}
                    onClick={() => {
                      if (armed === c.id) { setArmed(null); onDeleteComment(c.id); }
                      else { setArmed(c.id); setTimeout(() => setArmed(a => (a === c.id ? null : a)), 3000); }
                    }}
                  >
                    {armed === c.id ? 'Delete?' : 'Delete'}
                  </button>
                )}
              </div>
              <div className="rv-tl-text">{c.content}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Post detail ───────────────────────────────────────────────
function DetailModal({ post, members, uid, isAdmin, teamId, onClose, onEdit }) {
  const [thread, setThread] = useState({ events: [], comments: [] });
  const [mode, setMode] = useState(null); // 'needs_work' | 'resubmit' | 'delete'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const endRef = useRef(null);
  const precheck = usePrecheck();

  const isReviewer = post.reviewers.includes(uid);
  const canManage = post.created_by === uid || isAdmin;

  const loadThread = useCallback(async () => {
    const t = await fetchReviewThread(post.id);
    setThread(t);
  }, [post.id]);

  useEffect(() => {
    loadThread();
    const filter = `post_id=eq.${post.id}`;
    const channel = supabase
      .channel(`review-thread-${post.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_events', filter }, loadThread)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_comments', filter }, loadThread)
      .subscribe();
    window.addEventListener(REVIEWS_CHANGED, loadThread);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(REVIEWS_CHANGED, loadThread);
    };
  }, [post.id, loadThread]);

  // Status changed under us (another reviewer decided) — drop a half-open form.
  useEffect(() => { setMode(null); setNote(''); setError(''); precheck.reset(); }, [post.status]);

  const act = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); setMode(null); setNote(''); }
    catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const postComment = async () => {
    if (!comment.trim() || posting) return;
    setPosting(true);
    try {
      await addReviewComment({ postId: post.id, teamId, userId: uid, content: comment });
      setComment('');
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } catch (e) { setError(e.message || 'Could not post comment.'); }
    finally { setPosting(false); }
  };

  const author = members[post.author?.id] || post.author;
  const decider = members[post.decided_by];
  const reviewerNames = post.reviewers.map(id => fullName(members[id])).filter(Boolean);

  return (
    <ModalPortal>
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal rv-detail" onClick={e => e.stopPropagation()}>
          <div className="modal-header rv-detail-head">
            <div className="rv-detail-head-main">
              <div className="rv-detail-meta">
                <StatusPill status={post.status} />
                {post.round > 1 && <span className="rv-round">Round {post.round}</span>}
              </div>
              <h2 className="rv-detail-title">{post.title}</h2>
              <div className="rv-detail-by">
                <PersonAvatar person={author} size={18} />
                {fullName(author) || 'Someone'} · <span title={fmt(post.created_at)}>{ago(post.created_at)}</span>
              </div>
            </div>
            <button className="rv-icon-btn" onClick={onClose} aria-label="Close"><Svg name="x" size={18} /></button>
          </div>

          <div className="rv-detail-cols">
          <div className="modal-body rv-detail-body">
            {post.url && (
              isUrl(post.url) ? (
                <a className="rv-link-card" href={post.url} target="_blank" rel="noreferrer">
                  <Svg name="link" size={16} />
                  <span className="rv-link-text">{shortUrl(post.url)}</span>
                  <span className="rv-link-open">Open <Svg name="external" size={13} /></span>
                </a>
              ) : <div className="rv-link-card rv-link-plain"><Svg name="link" size={16} /><span className="rv-link-text">{post.url}</span></div>
            )}

            {post.description && <p className="rv-desc">{post.description}</p>}

            {post.screenshots?.length > 0 && (
              <div className="rv-shots rv-shots-view">
                {post.screenshots.map(url => (
                  <a key={url} className="rv-shot" href={url} target="_blank" rel="noreferrer"
                    style={{ backgroundImage: `url("${url}")` }} aria-label="Open screenshot" />
                ))}
              </div>
            )}

            <div className="rv-reviewers-row">
              <span className="rv-section-label"><Svg name="users" size={14} /> Reviewers</span>
              <div className="rv-reviewer-chips">
                {post.reviewers.map(id => {
                  const m = members[id];
                  return (
                    <span key={id} className={`rv-chip ${id === post.decided_by ? 'rv-chip-decider' : ''}`}>
                      <Avatar src={m?.avatar_url} color={m?.color || '#6366f1'} initials={initialsOf(m)} size={18} />
                      {fullName(m) || 'Unknown'}{id === uid ? ' (you)' : ''}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* ── Decision area ── */}
            <div className={`rv-decision rv-decision-${REVIEW_STATUS[post.status]?.tone}`}>
              {post.status === 'pending' && isReviewer && mode !== 'needs_work' && (
                <>
                  <p className="rv-decision-text">You're a reviewer on this. How does it look?</p>
                  <div className="rv-decision-actions">
                    <button className="btn rv-btn-approve" disabled={busy}
                      onClick={() => act(() => decideReview(post.id, 'approved'))}>
                      <Svg name="check" size={15} width={2.5} /> Reviewed — ready for live
                    </button>
                    <button className="btn rv-btn-needs" disabled={busy} onClick={() => setMode('needs_work')}>
                      <Svg name="alert" size={15} /> Needs work
                    </button>
                  </div>
                </>
              )}
              {post.status === 'pending' && isReviewer && mode === 'needs_work' && (
                <>
                  <label className="rv-decision-text" htmlFor="rv-nw-note">What needs work?</label>
                  <textarea id="rv-nw-note" className="input rv-textarea" rows={3} autoFocus value={note}
                    onChange={e => setNote(e.target.value)} placeholder="Be specific so it can be fixed in one go…" />
                  <div className="rv-decision-actions">
                    <button className="btn btn-ghost" onClick={() => { setMode(null); setNote(''); }} disabled={busy}>Cancel</button>
                    <button className="btn rv-btn-needs" disabled={busy || !note.trim()}
                      onClick={() => act(() => decideReview(post.id, 'needs_work', note))}>
                      Send back — needs work
                    </button>
                  </div>
                </>
              )}
              {post.status === 'pending' && !isReviewer && (
                <p className="rv-decision-text">
                  Waiting on {reviewerNames.length ? reviewerNames.join(', ') : 'a reviewer'}.
                </p>
              )}

              {post.status !== 'pending' && (
                <p className="rv-decision-text">
                  <strong>{fullName(decider) || 'A reviewer'}</strong>{' '}
                  {post.status === 'approved' ? 'reviewed this — ready for live' : 'reviewed this — it needs work'}
                  {post.decided_at && <span className="rv-tl-time"> · {ago(post.decided_at)}</span>}
                </p>
              )}

              {post.status === 'needs_work' && canManage && mode !== 'resubmit' && (
                <div className="rv-decision-actions">
                  <button className="btn btn-primary" onClick={() => setMode('resubmit')} disabled={busy}>
                    <Svg name="refresh" size={15} /> Resubmit for review
                  </button>
                </div>
              )}
              {post.status === 'needs_work' && canManage && mode === 'resubmit' && (
                <>
                  <label className="rv-decision-text" htmlFor="rv-rs-note">What did you change? <span className="rv-optional">optional</span></label>
                  <textarea id="rv-rs-note" className="input rv-textarea" rows={3} autoFocus value={note}
                    onChange={e => setNote(e.target.value)} placeholder="Fixed the spacing on mobile, swapped the hero image…" />
                  <span className="rv-decision-text">Before you resubmit</span>
                  <PrecheckList checked={precheck.checked} onToggle={precheck.toggle} />
                  <div className="rv-decision-actions">
                    <button className="btn btn-ghost" onClick={() => { setMode(null); setNote(''); precheck.reset(); }} disabled={busy}>Cancel</button>
                    <button className="btn btn-primary" disabled={busy || !precheck.done}
                      onClick={() => act(() => resubmitReview(post.id, note))}>
                      Resubmit — round {post.round + 1}
                    </button>
                  </div>
                </>
              )}
              {post.status !== 'pending' && (isReviewer || canManage) && mode !== 'resubmit' && (
                <button className="rv-text-btn" disabled={busy} onClick={() => act(() => reopenReview(post.id))}>
                  <Svg name="undo" size={13} /> Undo decision
                </button>
              )}
              {error && <div className="error-msg">⚠ {error}</div>}
            </div>

            {canManage && (
              <div className="rv-manage">
                <button className="rv-text-btn" onClick={() => onEdit(post)}><Svg name="edit" size={13} /> Edit post</button>
                {mode === 'delete' ? (
                  <span className="rv-confirm">
                    Delete this post and its comments?
                    <button className="rv-text-btn rv-text-danger" disabled={busy}
                      onClick={() => act(async () => { await deleteReview(post.id); onClose(); })}>Delete</button>
                    <button className="rv-text-btn" onClick={() => setMode(null)}>Keep</button>
                  </span>
                ) : (
                  <button className="rv-text-btn rv-text-danger" onClick={() => setMode('delete')}><Svg name="trash" size={13} /> Delete</button>
                )}
              </div>
            )}
          </div>

          <div className="rv-detail-side">
          <div className="rv-detail-activity">
            {/* ── History + comments ── */}
            <div className="rv-section-label rv-section-label-gap"><Svg name="comment" size={14} /> Activity</div>
            <Timeline
              events={thread.events}
              comments={thread.comments}
              members={members}
              uid={uid}
              onDeleteComment={(id) => deleteReviewComment(id).catch(e => setError(e.message))}
            />
            <div ref={endRef} />
          </div>

          <div className="rv-comment-box">
            <textarea
              className="input rv-textarea rv-comment-input"
              rows={1}
              value={comment}
              onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); postComment(); } }}
              placeholder="Write a comment…"
            />
            <button className="btn btn-primary" onClick={postComment} disabled={!comment.trim() || posting} aria-label="Post comment">
              <Svg name="send" size={15} />
            </button>
          </div>
          </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

// ── List row ──────────────────────────────────────────────────
function PostRow({ post, members, uid, onOpen }) {
  const waiting = isWaitingOn(post, uid);
  const author = members[post.author?.id] || post.author;
  return (
    <button type="button" className={`rv-row ${waiting ? 'rv-row-waiting' : ''}`} onClick={() => onOpen(post.id)}>
      <div className="rv-row-main">
        <div className="rv-row-top">
          <StatusPill status={post.status} />
          {waiting && <span className="rv-you">Needs your review</span>}
          {post.round > 1 && <span className="rv-round">Round {post.round}</span>}
        </div>
        <div className="rv-row-title">{post.title}</div>
        <div className="rv-row-meta">
          {post.url && <span className="rv-row-url"><Svg name="link" size={12} />{isUrl(post.url) ? shortUrl(post.url) : post.url}</span>}
          <span className="rv-row-by">
            <PersonAvatar person={author} size={16} />
            {fullName(author) || 'Someone'} · {ago(post.updated_at || post.created_at)}
          </span>
        </div>
      </div>
      <div className="rv-row-side">
        <AvatarStack ids={post.reviewers} members={members} />
        <span className="rv-row-counts">
          {post.screenshots?.length > 0 && <span title="Screenshots"><Svg name="image" size={13} />{post.screenshots.length}</span>}
          {post.commentCount > 0 && <span title="Comments"><Svg name="comment" size={13} />{post.commentCount}</span>}
        </span>
      </div>
    </button>
  );
}

// ══════════════════════════════════════════════════════════════
export default function Review() {
  const { user } = useAuth();
  const uid = user?.id;
  const { activeTeamId, isAdmin } = useTeam();
  const { posts, loading, error } = useReviewPosts(activeTeamId);
  const [memberList, setMemberList] = useState([]);
  const [defaults, setDefaults] = useState([]);
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState(null); // null | { post?: post }
  const [showDefaults, setShowDefaults] = useState(false);
  const [showPrecheck, setShowPrecheck] = useState(false);

  const [params, setParams] = useSearchParams();
  const openId = params.get('post');
  const tabParam = params.get('tab');

  useEffect(() => {
    let live = true;
    Promise.all([fetchTeamMembers(activeTeamId), fetchDefaultReviewers(activeTeamId)]).then(([m, d]) => {
      if (!live) return;
      setMemberList((m || []).sort((a, b) => fullName(a).localeCompare(fullName(b))));
      setDefaults(d);
    });
    return () => { live = false; };
  }, [activeTeamId]);
  const members = useMemo(() => Object.fromEntries(memberList.map(m => [m.id, m])), [memberList]);

  const counts = useMemo(() => ({
    mine: posts.filter(p => isWaitingOn(p, uid)).length,
    open: posts.filter(p => p.status === 'pending').length,
    needs_work: posts.filter(p => p.status === 'needs_work').length,
    approved: posts.filter(p => p.status === 'approved').length,
    all: posts.length,
  }), [posts, uid]);

  // Land on "Waiting on me" when there's something there, otherwise "Open".
  const tab = TABS.some(t => t.id === tabParam) ? tabParam : (counts.mine ? 'mine' : 'open');
  const setTab = (id) => { const next = new URLSearchParams(params); next.set('tab', id); setParams(next, { replace: true }); };

  const shown = useMemo(() => {
    let list = posts;
    if (tab === 'mine') list = list.filter(p => isWaitingOn(p, uid));
    else if (tab === 'open') list = list.filter(p => p.status === 'pending');
    else if (tab !== 'all') list = list.filter(p => p.status === tab);
    return searchRank(list, search, p => [
      { text: p.title, weight: 3 },
      { text: p.url, weight: 1.5 },
      { text: p.description },
      { text: fullName(p.author) },
    ]);
  }, [posts, tab, search, uid]);

  const openPost = (id) => { const next = new URLSearchParams(params); next.set('post', id); setParams(next); };
  const closePost = () => { const next = new URLSearchParams(params); next.delete('post'); setParams(next, { replace: true }); };
  const openedPost = openId ? posts.find(p => p.id === openId) : null;

  const emptyText = {
    mine: "Nothing's waiting on you.",
    open: 'Nothing is waiting for review.',
    needs_work: 'Nothing needs work right now.',
    approved: 'Nothing is marked ready for live yet.',
    all: 'Nothing has been posted for review yet.',
  }[tab];

  return (
    <div className="rv-page fade-in">
      <header className="rv-head">
        <div className="rv-head-icon"><Svg name="review" size={20} /></div>
        <div className="rv-head-text">
          <h1 className="rv-head-title">Ready for Review</h1>
          <div className="rv-head-sub">
            {counts.mine
              ? `${counts.mine} waiting on you · ${counts.open} open`
              : `${counts.open} open · ${counts.approved} ready for live`}
          </div>
        </div>
        <div className="rv-head-actions">
          <button className="btn btn-secondary" onClick={() => setShowPrecheck(true)} title="What to check before posting">
            <Svg name="list" size={15} /> Pre-check
          </button>
          <button className="btn btn-secondary rv-defaults-btn" onClick={() => setShowDefaults(true)} title="Team default reviewers">
            <Svg name="users" size={15} /> <span className="rv-hide-sm">Default reviewers</span>
          </button>
          <button className="btn btn-primary" onClick={() => setComposer({})}>
            <Svg name="plus" size={15} width={2.5} /> New post
          </button>
        </div>
      </header>

      <div className="rv-toolbar">
        <div className="rv-tabs" role="tablist">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
              className={`rv-tab ${tab === t.id ? 'rv-tab-active' : ''} ${t.id === 'mine' && counts.mine ? 'rv-tab-alert' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
              <span className="rv-tab-count">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <div className="rv-search">
          <span className="rv-search-icon"><Svg name="search" size={14} /></span>
          <input className="rv-search-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search posts…" />
          {search && <button className="rv-search-clear" onClick={() => setSearch('')} aria-label="Clear search"><Svg name="x" size={12} width={2.5} /></button>}
        </div>
      </div>

      {error && (
        <div className="card error-msg">
          ⚠ {error} — if this is a new install, run supabase-review-migration.sql in the Supabase SQL editor.
        </div>
      )}

      {loading ? (
        <div className="rv-list">{[0, 1, 2].map(i => <div key={i} className="rv-skeleton loading-pulse" />)}</div>
      ) : shown.length === 0 ? (
        <div className="empty-state rv-empty">
          <Svg name="review" size={36} />
          <h3>{search ? 'No matches' : emptyText}</h3>
          {!search && tab !== 'needs_work' && tab !== 'approved' && (
            <p>Post a link when something's ready and pick who should review it.</p>
          )}
        </div>
      ) : (
        <div className="rv-list">
          {shown.map(p => <PostRow key={p.id} post={p} members={members} uid={uid} onOpen={openPost} />)}
        </div>
      )}

      {openedPost && (
        <DetailModal
          post={openedPost}
          members={members}
          uid={uid}
          isAdmin={isAdmin}
          teamId={activeTeamId}
          onClose={closePost}
          onEdit={(p) => setComposer({ post: p })}
        />
      )}

      {composer && (
        <ComposerModal
          post={composer.post}
          teamId={activeTeamId}
          members={memberList}
          defaults={defaults}
          onClose={() => setComposer(null)}
          onSaved={(id) => { setComposer(null); if (!composer.post) openPost(id); }}
        />
      )}

      {showPrecheck && (
        <PrecheckModal
          onClose={() => setShowPrecheck(false)}
          onStart={() => { setShowPrecheck(false); setComposer({}); }}
        />
      )}

      {showDefaults && (
        <DefaultsModal
          teamId={activeTeamId}
          members={memberList}
          value={defaults}
          canEdit={isAdmin}
          onClose={() => setShowDefaults(false)}
          onSaved={(ids) => { setDefaults(ids); setShowDefaults(false); }}
        />
      )}
    </div>
  );
}
