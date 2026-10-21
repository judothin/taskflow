import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { TopBarPortal } from '../context/HeaderActionsContext';
import { fetchTeamMembers } from '../lib/teams';
import { searchRank } from '../lib/fuzzySearch';
import useFlipRows from '../lib/useFlipRows';
import {
  Icon, Sheet, Dialog, ConfirmDialog, Tabs, toast,
  Avatar, AvatarStack, PageHeader, Empty, SearchInput, Dropzone, Lightbox, SheetLabel, SkeletonRows,
  ago, longDate, fullName,
} from '../ui';
import {
  REVIEW_STATUS, REVIEWS_CHANGED, useReviewPosts, fetchReviewThread, isWaitingOn, reviewStatusFor, parseFiles,
  createReview, updateReview, deleteReview, decideReview, reopenReview, resubmitReview,
  setReviewers, addReviewComment, deleteReviewComment, uploadReviewScreenshot,
  fetchDefaultReviewers, saveDefaultReviewers, isUrl, shortUrl, normalizeUrl,
  reorderReviews, markReviewLive, unmarkReviewLive,
} from '../lib/reviews';
import './Review.css';

// ══════════════════════════════════════════════════════════════
// Ready for review (with Go Live folded in)
// --------------------------------------------------------------
// Someone posts a link to work that's ready to look at, optionally the
// files that will have to be pushed with it, and picks who may sign it off.
// Any one of those reviewers marks it "Reviewed — ready for live" or "Needs
// work" (which has to say what). The author fixes it and resubmits, starting
// the next round. Once it's reviewed, anyone involved marks it live and it
// moves to the Live tab — what the separate Go Live page used to be.
//
// The rules live in the database (supabase-review-migration.sql) — the
// buttons here only mirror them.
// ══════════════════════════════════════════════════════════════

const TABS = [
  { id: 'mine',       label: 'Waiting on me' },
  { id: 'open',       label: 'Open' },
  { id: 'needs_work', label: 'Needs work' },
  { id: 'approved',   label: 'Ready for live' },
  { id: 'live',       label: 'Live' },
  { id: 'all',        label: 'All' },
];

const EMPTY_TEXT = {
  mine:       ["Nothing's waiting on you", 'When someone picks you as a reviewer, it shows up here.'],
  open:       ['Nothing is waiting for review', "Post a link when something's ready and pick who should look at it."],
  needs_work: ['Nothing needs work', 'Posts sent back with notes land here.'],
  approved:   ['Nothing is ready for live', 'Reviewed posts wait here until someone marks them live.'],
  live:       ['Nothing has gone live yet', 'Mark a reviewed post live and it moves here.'],
  all:        ['Nothing posted yet', "Post a link when something's ready and pick who should look at it."],
};

const EVENT_TEXT = {
  submitted:   () => 'posted this for review',
  resubmitted: (e) => `resubmitted it · round ${e.round}`,
  approved:    () => 'marked it reviewed — ready for live',
  needs_work:  () => 'sent it back — needs work',
  reopened:    () => 'undid the decision',
  went_live:   () => 'marked it live',
  live_undone: () => 'undid going live',
};

const linkText = (u) => (isUrl(u) ? shortUrl(u) : u);
const nameOr = (p, fallback = 'Someone') => fullName(p) || fallback;
const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Grows a textarea with its content (borderless title / body inputs).
function useAutoGrow(ref, value) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, value]);
}

// ── Reviewer pick list (round checks) ─────────────────────────
function ReviewerPick({ members, value, onChange, uid, readOnly }) {
  if (!members.length) return <SkeletonRows rows={3} widths={['8%', '50%']} />;
  return (
    <div className="rv-pick" role="group" aria-label="Reviewers">
      {members.map((m, i) => {
        const on = value.includes(m.id);
        return (
          <button
            key={m.id}
            type="button"
            className={`rv-pick-row ${on ? 'is-on' : ''}`}
            style={{ '--i': Math.min(i, 10) }}
            aria-pressed={on}
            disabled={readOnly}
            onClick={() => onChange(on ? value.filter(v => v !== m.id) : [...value, m.id])}
          >
            <Avatar person={m} size={28} />
            <span className="rv-pick-name truncate">
              {nameOr(m, 'Unknown')}{m.id === uid && <span className="t-3"> (you)</span>}
            </span>
            <span className={`check-round ${on ? 'is-on' : ''}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

// ── New / edit post sheet ─────────────────────────────────────
function ComposerSheet({ post, teamId, members, defaults, uid, onClose, onSaved }) {
  const editing = !!post;
  const [title, setTitle] = useState(post?.title || '');
  const [url, setUrl] = useState(post?.url || '');
  const [description, setDescription] = useState(post?.description || '');
  const [files, setFiles] = useState(post?.files || '');
  const [shots, setShots] = useState(post?.screenshots || []);
  const [reviewers, setReviewerIds] = useState(post?.reviewers || defaults);
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nudge, setNudge] = useState(0);
  const [zoom, setZoom] = useState(null);
  const titleRef = useRef(null);
  const linkRef = useRef(null);
  useAutoGrow(titleRef, title);

  // Defaults load async; fill them in if nobody has been picked by hand yet.
  const touched = useRef(false);
  useEffect(() => {
    if (!editing && !touched.current && defaults.length) setReviewerIds(defaults);
  }, [defaults, editing]);

  const addShots = useCallback(async (list) => {
    const images = list.filter(f => f.type?.startsWith('image/'));
    if (!images.length) return;
    if (images.some(f => f.size > 8 * 1024 * 1024)) { setError('Each image must be 8 MB or smaller.'); return; }
    setError('');
    setUploading(n => n + images.length);
    try {
      const urls = await Promise.all(images.map(f => uploadReviewScreenshot(teamId, f)));
      setShots(prev => [...prev, ...urls]);
    } catch (e) {
      setError(e.message || 'Upload failed.');
    } finally {
      setUploading(n => Math.max(0, n - images.length));
    }
  }, [teamId]);

  // Paste a screenshot from the clipboard anywhere while the sheet is open.
  useEffect(() => {
    const onPaste = (e) => {
      const list = Array.from(e.clipboardData?.files || []);
      if (list.some(f => f.type.startsWith('image/'))) { e.preventDefault(); addShots(list); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addShots]);

  const ready = !!title.trim() && reviewers.length > 0 && !uploading && !saving;

  const save = async () => {
    if (!ready) { if (!saving) setNudge(n => n + 1); return; }
    setSaving(true); setError('');
    try {
      if (editing) {
        const patch = { title: title.trim(), url, description, screenshots: shots };
        // Only send `files` when the column exists (or there's something to
        // save), so editing still works before the Go Live merge SQL has run.
        if ('files' in post || files.trim()) patch.files = files.trim();
        await updateReview(post.id, patch);
        if (!sameSet(reviewers, post.reviewers)) await setReviewers(post.id, reviewers);
        toast('Post updated');
        onSaved(post.id);
      } else {
        const id = await createReview({ teamId, title: title.trim(), url, description, screenshots: shots, reviewers, files });
        toast('Posted for review');
        onSaved(id);
      }
    } catch (e) {
      setError(e.message || 'Could not save.');
      setSaving(false);
    }
  };

  const n = reviewers.length;
  const note = error
    ? <span className="t-bad rv-note-err" key={error}>{error}</span>
    : uploading ? `Uploading ${uploading} screenshot${uploading === 1 ? '' : 's'}…`
      : !n ? 'Pick at least one reviewer'
        : !title.trim() ? 'Give it a title to post'
          : `${n} reviewer${n === 1 ? '' : 's'} · any one can sign it off`;

  return (
    <Sheet
      className="rv-compose"
      eyebrow={editing
        ? <>Edit post <span className="t-4">· Round {post.round}</span></>
        : <>New review post <span className="t-4">· Draft</span></>}
      onClose={() => { if (!saving) onClose(); }}
      onSubmit={save}
      aside={(
        <div>
          <SheetLabel sub="Any one of them can mark it reviewed">Reviewers</SheetLabel>
          <ReviewerPick
            members={members}
            value={reviewers}
            uid={uid}
            onChange={(v) => { touched.current = true; setReviewerIds(v); }}
          />
        </div>
      )}
      footer={(
        <>
          <span className="sheet-foot-note">{note}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button
            key={nudge}
            type="button"
            className={`btn btn-primary ${nudge ? 'wiggle' : ''}`}
            onClick={save}
            disabled={!ready}
          >
            {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Post for review')}
            {!saving && <span className="kbd">⌘↵</span>}
          </button>
        </>
      )}
    >
      <textarea
        ref={titleRef}
        className="title-input rv-title-input"
        rows={1}
        autoFocus
        maxLength={160}
        placeholder="What's ready for review?"
        value={title}
        onChange={e => setTitle(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={e => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); linkRef.current?.focus(); } }}
        aria-label="Title"
      />

      <label className="link-field rv-link-input">
        <Icon name="link" size={15} />
        <input
          ref={linkRef}
          value={url}
          onChange={e => setUrl(e.target.value)}
          onBlur={() => setUrl(normalizeUrl(url))}
          placeholder="https://staging.example.com/pricing"
          inputMode="url"
          spellCheck={false}
          aria-label="Link"
        />
        {isUrl(normalizeUrl(url)) && (
          <a className="link-open rv-pop" href={normalizeUrl(url)} target="_blank" rel="noreferrer">
            Open <Icon name="arrowUpRight" size={12} />
          </a>
        )}
      </label>

      <textarea
        className="body-input rv-body-input"
        placeholder="What changed, what to check, anything you're unsure about…"
        value={description}
        onChange={e => setDescription(e.target.value)}
        aria-label="Description"
      />

      <div className="rv-compose-sec">
        {(shots.length > 0 || uploading > 0) && (
          <div className="attach-grid rv-shots">
            {shots.map(u => (
              <div key={u} className="attach">
                <img className="attach-thumb" src={u} alt="" onClick={() => setZoom(u)} />
                <button type="button" className="attach-x" onClick={() => setShots(p => p.filter(x => x !== u))} aria-label="Remove screenshot">
                  <Icon name="x" size={11} />
                </button>
              </div>
            ))}
            {Array.from({ length: uploading }).map((_, i) => (
              <div key={`up-${i}`} className="attach"><div className="attach-thumb skel" /></div>
            ))}
          </div>
        )}
        <Dropzone
          onFiles={addShots}
          accept="image/*"
          title={<>Drop screenshots or paste <span className="kbd-box">⌘V</span></>}
          sub="Optional"
        />
      </div>

      <div className="rv-compose-sec">
        <SheetLabel sub="One per line. Add a note after a dash. Optional.">Files to push</SheetLabel>
        <textarea
          className="textarea input-mono rv-files-input"
          rows={3}
          spellCheck={false}
          placeholder={'header.php — new nav markup\nassets/css/nav.css'}
          value={files}
          onChange={e => setFiles(e.target.value)}
          aria-label="Files to push"
        />
      </div>

      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </Sheet>
  );
}

// ── Team default reviewers ────────────────────────────────────
function DefaultsDialog({ teamId, members, value, canEdit, uid, onClose, onSaved }) {
  const [ids, setIds] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setSaving(true); setError('');
    try { await saveDefaultReviewers(teamId, ids); toast('Default reviewers saved'); onSaved(ids); }
    catch (e) { setError(e.message || 'Could not save.'); setSaving(false); }
  };
  return (
    <Dialog
      title="Default reviewers"
      text="Pre-selected on every new post for this team. People can still change them per post."
      onClose={onClose}
      footer={canEdit ? (
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? <span className="spinner" /> : 'Save'}
          </button>
        </>
      ) : <button type="button" className="btn" onClick={onClose}>Close</button>}
    >
      <div className="rv-defaults">
        {!canEdit && <div className="notice"><Icon name="lock" size={15} />Only team owners and admins can change this list.</div>}
        <ReviewerPick members={members} value={ids} onChange={setIds} uid={uid} readOnly={!canEdit} />
        {error && <div className="notice notice-error wiggle"><Icon name="alert" size={15} />{error}</div>}
      </div>
    </Dialog>
  );
}

// ── Activity: events and comments, interleaved ────────────────
function Timeline({ loaded, events, comments, members, uid, onDeleteComment }) {
  const [armed, setArmed] = useState(null);
  const items = useMemo(() => [
    ...events.map(e => ({ kind: 'event', at: e.created_at, key: `e-${e.id}`, e })),
    ...comments.map(c => ({ kind: 'comment', at: c.created_at, key: `c-${c.id}`, c })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at)), [events, comments]);

  if (!loaded) {
    return (
      <div className="rv-tl-skel">
        {[0, 1].map(i => (
          <div key={i} className="rv-tl-skel-row">
            <span className="skel rv-tl-skel-av" />
            <span className="skel skel-line" style={{ width: i ? '52%' : '74%' }} />
          </div>
        ))}
      </div>
    );
  }
  if (!items.length) return <p className="t-3 rv-tl-empty">No activity yet.</p>;

  return (
    <ol className="rv-tl">
      {items.map((it, i) => {
        if (it.kind === 'event') {
          const { e } = it;
          const who = members[e.actor];
          return (
            <li key={it.key} className={`rv-tl-item rv-tl-${e.kind}`} style={{ '--i': Math.min(i, 8) }}>
              <Avatar person={who} name={nameOr(who)} size={24} />
              <div className="rv-tl-body">
                <div className="rv-tl-line"><strong>{nameOr(who)}</strong> {EVENT_TEXT[e.kind]?.(e) || e.kind}</div>
                {e.note && <div className="rv-tl-note">{e.note}</div>}
                <div className="rv-tl-time" title={longDate(e.created_at)}>{ago(e.created_at)}</div>
              </div>
            </li>
          );
        }
        const { c } = it;
        const who = members[c.user_id];
        const mine = c.user_id === uid;
        return (
          <li key={it.key} className="rv-tl-item rv-tl-comment" style={{ '--i': Math.min(i, 8) }}>
            <Avatar person={who} name={nameOr(who)} size={24} />
            <div className="rv-tl-body">
              <div className="rv-tl-line"><strong>{nameOr(who)}</strong> <span className="t-3">commented</span></div>
              <div className="rv-tl-text">{c.content}</div>
              <div className="rv-tl-time">
                <span title={longDate(c.created_at)}>{ago(c.created_at)}</span>
                {mine && (
                  <button
                    type="button"
                    className={`rv-tl-del ${armed === c.id ? 'is-armed' : ''}`}
                    onClick={() => {
                      if (armed === c.id) { setArmed(null); onDeleteComment(c.id); }
                      else { setArmed(c.id); setTimeout(() => setArmed(a => (a === c.id ? null : a)), 3000); }
                    }}
                  >
                    {armed === c.id ? 'Delete?' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── Post detail sheet ─────────────────────────────────────────
function DetailSheet({ post, members, uid, isAdmin, teamId, onClose, onEdit, onMarkLive, onUndoLive }) {
  const [thread, setThread] = useState({ events: [], comments: [], loaded: false });
  const [mode, setMode] = useState(null); // 'needs_work' | 'resubmit'
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const [posting, setPosting] = useState(false);
  const [sent, setSent] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [zoom, setZoom] = useState(null);
  const [copied, setCopied] = useState(false);
  const endRef = useRef(null);

  const isReviewer = post.reviewers.includes(uid);
  const canManage = post.created_by === uid || isAdmin;
  const canGoLive = isReviewer || canManage;

  const loadThread = useCallback(async () => {
    const t = await fetchReviewThread(post.id);
    setThread({ ...t, loaded: true });
  }, [post.id]);

  useEffect(() => {
    loadThread();
    const filter = `post_id=eq.${post.id}`;
    const channel = supabase
      .channel(`review-thread-${post.id}-${Math.random().toString(36).slice(2, 7)}`)
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
  useEffect(() => { setMode(null); setNote(''); setError(''); }, [post.status]);

  const act = async (fn, done) => {
    setBusy(true); setError('');
    try { await fn(); setMode(null); setNote(''); if (done) toast(done); }
    catch (e) { setError(e.message || 'Something went wrong.'); }
    finally { setBusy(false); }
  };

  const postComment = async () => {
    const text = comment.trim();
    if (!text || posting) return;
    setPosting(true);
    setSent(s => s + 1);
    try {
      await addReviewComment({ postId: post.id, teamId, userId: uid, content: text });
      setComment('');
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 80);
    } catch (e) { setError(e.message || 'Could not post comment.'); }
    finally { setPosting(false); }
  };

  const author = members[post.created_by] || post.author;
  const decider = members[post.decided_by];
  const st = REVIEW_STATUS[post.status] || REVIEW_STATUS.pending;
  const files = parseFiles(post.files);
  const lastNeedsWork = [...thread.events].reverse().find(e => e.kind === 'needs_work');
  const waitingOn = post.reviewers.filter(id => id !== uid).map(id => fullName(members[id])).filter(Boolean);
  const fromGoLive = !!post.golive_id && !post.decided_by;

  const copyFiles = async () => {
    if (await copyText(files.map(f => f.path).join('\n'))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }
  };

  // The verdict box: what this person can do with the post right now.
  let verdict = null;
  if (post.status === 'pending' && isReviewer && mode !== 'needs_work') {
    verdict = (
      <>
        <p className="rv-verdict-q">You're a reviewer on this. How does it look?</p>
        <div className="rv-verdict-actions">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy}
            onClick={() => act(() => decideReview(post.id, 'approved'), 'Marked ready for live')}>
            <Icon name="check" /> Reviewed — ready for live
          </button>
          <button type="button" className="btn btn-lg" disabled={busy} onClick={() => setMode('needs_work')}>
            <Icon name="alert" /> Needs work
          </button>
        </div>
      </>
    );
  } else if (post.status === 'pending' && isReviewer) {
    verdict = (
      <>
        <label className="rv-verdict-q" htmlFor="rv-nw-note">What needs work?</label>
        <textarea id="rv-nw-note" className="textarea" rows={3} autoFocus value={note}
          onChange={e => setNote(e.target.value)} placeholder="Be specific so it can be fixed in one go…"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.stopPropagation(); }} />
        <div className="rv-verdict-actions">
          <button type="button" className="btn btn-primary btn-lg" disabled={busy || !note.trim()}
            onClick={() => act(() => decideReview(post.id, 'needs_work', note), 'Sent back — needs work')}>
            {busy ? <span className="spinner" /> : 'Send back — needs work'}
          </button>
          <button type="button" className="btn btn-ghost btn-lg" onClick={() => { setMode(null); setNote(''); }} disabled={busy}>Cancel</button>
        </div>
      </>
    );
  } else if (post.status === 'pending') {
    verdict = (
      <p className="rv-verdict-line">
        <Icon name="clock" size={15} />
        <span>Waiting on {waitingOn.length ? waitingOn.join(', ') : 'a reviewer'}.</span>
      </p>
    );
  } else if (post.status === 'approved') {
    verdict = (
      <>
        <p className="rv-verdict-line">
          <span className="dot dot-completed" />
          <span>
            {fromGoLive ? 'Carried over from Go Live — ready for live'
              : <><strong>{nameOr(decider, 'A reviewer')}</strong> reviewed this — ready for live</>}
            {post.decided_at && !fromGoLive && <span className="t-3"> · {ago(post.decided_at)}</span>}
          </span>
        </p>
        {canGoLive && (
          <div className="rv-verdict-actions">
            <button type="button" className="btn btn-primary btn-lg rv-live-btn" disabled={busy}
              onClick={() => onMarkLive(post)}>
              <Icon name="rocket" /> Mark live
            </button>
            {post.reviewers.length > 0 && (
              <button type="button" className="btn btn-ghost btn-lg" disabled={busy}
                onClick={() => act(() => reopenReview(post.id), 'Decision undone')}>
                <Icon name="undo" /> Undo decision
              </button>
            )}
          </div>
        )}
      </>
    );
  } else if (post.status === 'needs_work') {
    verdict = (
      <>
        <p className="rv-verdict-line">
          <span className="dot dot-in_progress" />
          <span>
            <strong>{nameOr(decider, 'A reviewer')}</strong> sent it back — needs work
            {post.decided_at && <span className="t-3"> · {ago(post.decided_at)}</span>}
          </span>
        </p>
        {lastNeedsWork?.note && <blockquote className="rv-verdict-note">{lastNeedsWork.note}</blockquote>}
        {mode === 'resubmit' ? (
          <>
            <label className="rv-verdict-q" htmlFor="rv-rs-note">What did you change? <span className="t-3">Optional</span></label>
            <textarea id="rv-rs-note" className="textarea" rows={3} autoFocus value={note}
              onChange={e => setNote(e.target.value)} placeholder="Fixed the spacing on mobile, swapped the hero image…"
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.stopPropagation(); }} />
            <div className="rv-verdict-actions">
              <button type="button" className="btn btn-primary btn-lg" disabled={busy}
                onClick={() => act(() => resubmitReview(post.id, note), `Resubmitted — round ${post.round + 1}`)}>
                {busy ? <span className="spinner" /> : <><Icon name="refresh" /> Resubmit — round {post.round + 1}</>}
              </button>
              <button type="button" className="btn btn-ghost btn-lg" onClick={() => { setMode(null); setNote(''); }} disabled={busy}>Cancel</button>
            </div>
          </>
        ) : (canManage || isReviewer) && (
          <div className="rv-verdict-actions">
            {canManage && (
              <button type="button" className="btn btn-primary btn-lg" onClick={() => setMode('resubmit')} disabled={busy}>
                <Icon name="refresh" /> Resubmit for review
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-lg" disabled={busy}
              onClick={() => act(() => reopenReview(post.id), 'Decision undone')}>
              <Icon name="undo" /> Undo decision
            </button>
          </div>
        )}
      </>
    );
  } else if (post.status === 'live') {
    verdict = (
      <>
        <p className="rv-verdict-line">
          <Icon name="rocket" size={15} className="rv-live-ico" />
          <span>
            <strong>{nameOr(members[post.went_live_by])}</strong> marked it live
            {post.went_live_at && <span className="t-3"> · {ago(post.went_live_at)}</span>}
          </span>
        </p>
        {canGoLive && (
          <div className="rv-verdict-actions">
            <button type="button" className="btn btn-lg" disabled={busy} onClick={() => onUndoLive(post)}>
              <Icon name="undo" /> Undo — not live yet
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <Sheet
      className="rv-detail"
      asideClassName="rv-aside"
      onClose={onClose}
      eyebrow={(
        <div className="rv-dhead">
          <div className="rv-dhead-status">
            <span key={post.status} className={`dot dot-${post.status === 'pending' && isReviewer ? 'needs' : st.dot} rv-dot-pop`} />
            <span key={`s-${post.status}`} className="rv-bump">{st.short}</span>
            <span key={`r-${post.round}`} className="t-3 rv-bump">Round {post.round}</span>
          </div>
          <h2 className="rv-dhead-title">{post.title}</h2>
          <div className="rv-dhead-by">
            {nameOr(author)} · <span title={longDate(post.created_at)}>{ago(post.created_at)}</span>
          </div>
        </div>
      )}
      aside={(
        <>
          <div className="rv-feed">
            <SheetLabel>Activity</SheetLabel>
            <Timeline
              loaded={thread.loaded}
              events={thread.events}
              comments={thread.comments}
              members={members}
              uid={uid}
              onDeleteComment={(id) => deleteReviewComment(id).catch(e => setError(e.message))}
            />
            <div ref={endRef} />
          </div>
          <form className="rv-comment" onSubmit={(e) => { e.preventDefault(); postComment(); }}>
            <input
              className="input"
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="Write a comment…"
              aria-label="Write a comment"
            />
            <button
              key={sent}
              type="submit"
              className={`btn btn-primary btn-icon rv-send ${sent ? 'is-sent' : ''}`}
              disabled={!comment.trim() || posting}
              aria-label="Send comment"
            >
              <Icon name="send" size={15} />
            </button>
          </form>
        </>
      )}
    >
      {post.url && (
        <div className="link-field rv-link">
          <Icon name="link" size={15} />
          <span className="link-field-text" title={post.url}>{linkText(post.url)}</span>
          {isUrl(post.url) && (
            <a className="link-open" href={post.url} target="_blank" rel="noreferrer">
              Open <Icon name="arrowUpRight" size={12} />
            </a>
          )}
        </div>
      )}

      <section className="rv-sec">
        <SheetLabel>Description</SheetLabel>
        {post.description?.trim() ? (
          <div className="prose rv-desc">{post.description}</div>
        ) : (
          <p className="t-3">
            No description.
            {canManage && <button type="button" className="btn-link rv-inline-btn" onClick={() => onEdit(post)}>Add one</button>}
          </p>
        )}
      </section>

      {post.screenshots?.length > 0 && (
        <section className="rv-sec">
          <SheetLabel>Screenshots <span className="count">{post.screenshots.length}</span></SheetLabel>
          <div className="attach-grid rv-shots">
            {post.screenshots.map(u => (
              <div key={u} className="attach">
                <img className="attach-thumb" src={u} alt="" onClick={() => setZoom(u)} />
              </div>
            ))}
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section className="rv-sec">
          <div className="rv-sec-head">
            <SheetLabel>Files to push <span className="count">{files.length}</span></SheetLabel>
            <button type="button" className="btn btn-ghost btn-sm" onClick={copyFiles}>
              <Icon key={copied ? 'ok' : 'copy'} name={copied ? 'check' : 'copy'} className="rv-pop" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <ul className="rv-files">
            {files.map((f, i) => (
              <li key={`${f.path}-${i}`}>
                <Icon name="file" size={13} />
                <span className="rv-file-path">{f.path}</span>
                {f.note && <span className="rv-file-note">— {f.note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rv-sec">
        <SheetLabel>Reviewers</SheetLabel>
        {post.reviewers.length ? (
          <div className="rv-chips">
            {post.reviewers.map(id => {
              const m = members[id];
              return (
                <span key={id} className={`rv-chip ${id === post.decided_by ? 'is-decider' : ''}`}>
                  <Avatar person={m} name={nameOr(m, 'Unknown')} size={22} />
                  {nameOr(m, 'Unknown')}{id === uid && <span className="t-3">&nbsp;(you)</span>}
                  {id === post.decided_by && <Icon name="check" size={12} />}
                </span>
              );
            })}
          </div>
        ) : <p className="t-3">No reviewers.</p>}
      </section>

      {verdict && (
        <div key={`${post.status}-${mode || ''}`} className={`rv-verdict rv-verdict-${post.status === 'pending' && !isReviewer ? 'waiting' : post.status}`}>
          {verdict}
          {error && <div className="notice notice-error wiggle" key={error}><Icon name="alert" size={15} />{error}</div>}
        </div>
      )}

      {canManage && (
        <div className="rv-manage">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEdit(post)}>
            <Icon name="edit" /> Edit post
          </button>
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" /> Delete
          </button>
        </div>
      )}

      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this post?"
          text="Its comments and history go with it. This can't be undone."
          confirmLabel="Delete"
          danger
          busy={busy}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => act(async () => { await deleteReview(post.id); setConfirmDelete(false); onClose(); }, 'Post deleted')}
        />
      )}
    </Sheet>
  );
}

// ── List row ──────────────────────────────────────────────────
// Owners and admins get a handle: drag it (or Alt+↑/↓ on it) on desktop,
// or tap the arrows on a phone, where drag-and-drop doesn't exist.
function PostRow({ post, index, members, uid, tab, drag, rowRef, isFirst, isLast, onOpen, onMarkLive, canGoLive }) {
  const st = reviewStatusFor(post, uid);
  const author = members[post.created_by] || post.author;
  const people = post.reviewers.map(id => members[id]).filter(Boolean);
  const live = tab === 'live';
  const stop = (e) => e.stopPropagation();

  return (
    <div
      ref={rowRef}
      className={`table-row rv-row ${drag?.dragging ? 'is-dragging' : ''}`}
      style={{ '--i': Math.min(index, 10) }}
      role="button"
      tabIndex={0}
      onClick={() => onOpen(post.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(post.id); }}
      draggable={!!drag && drag.armed}
      onDragStart={drag?.onDragStart}
      onDragOver={drag?.onDragOver}
      onDragEnd={drag?.onDragEnd}
    >
      <div className="table-cell rv-c-post">
        {drag && (
          <button
            type="button"
            className="grip hide-phone"
            title={drag.enabled ? 'Drag to reorder (or Alt + ↑/↓)' : 'Clear the search to reorder'}
            aria-label="Reorder: drag, or Alt + arrow keys"
            disabled={!drag.enabled}
            onClick={stop}
            onPointerDown={drag.arm}
            onPointerUp={drag.disarm}
            onKeyDown={drag.onKey}
          >
            <Icon name="grip" size={14} stroke={2.6} />
          </button>
        )}
        <div className="rv-post-text">
          <div className="table-title truncate">{post.title}</div>
          {post.url && <div className="table-sub">{linkText(post.url)}</div>}
        </div>
        {drag && (
          <span className="rv-move show-phone" onClick={stop}>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Move up"
              disabled={!drag.enabled || isFirst} onClick={() => drag.move(-1)}>
              <Icon name="chevronUp" />
            </button>
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Move down"
              disabled={!drag.enabled || isLast} onClick={() => drag.move(1)}>
              <Icon name="chevronDown" />
            </button>
          </span>
        )}
      </div>
      <div className="table-cell">
        <span className="status rv-status">
          <span key={st.dot} className={`dot dot-${st.dot} rv-dot-pop`} />
          <span key={st.label} className="truncate rv-bump">{st.label}</span>
        </span>
      </div>
      <div className="table-cell mono hide-phone">R{post.round}</div>
      <div className="table-cell rv-c-posted">
        <span className="truncate">
          {live
            ? <>{nameOr(members[post.went_live_by])} · {ago(post.went_live_at)}</>
            : <>{nameOr(author)} · {ago(post.created_at)}</>}
        </span>
      </div>
      <div className="table-cell hide-phone">
        {people.length ? <AvatarStack people={people} size={22} /> : <span className="t-4">—</span>}
      </div>
      <div className={`table-cell rv-c-notes ${post.commentCount ? '' : 'is-zero'}`} title={`${post.commentCount} comment${post.commentCount === 1 ? '' : 's'}`}>
        <Icon name="message" size={14} />
        <span key={post.commentCount} className="rv-bump">{post.commentCount}</span>
      </div>
      {tab === 'approved' && (
        <div className="table-cell rv-c-act">
          {canGoLive && (
            <button type="button" className="btn btn-sm rv-live-btn" onClick={(e) => { stop(e); onMarkLive(post); }}>
              <Icon name="rocket" /> Mark live
            </button>
          )}
        </div>
      )}
    </div>
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

  const [params, setParams] = useSearchParams();
  const openId = params.get('post');
  const tabParam = params.get('tab');
  const wantsNew = params.get('new');

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

  // /review?new=1 (the phone's create menu) opens the composer once.
  useEffect(() => {
    if (!wantsNew) return;
    setComposer({});
    const next = new URLSearchParams(params);
    next.delete('new');
    setParams(next, { replace: true });
  }, [wantsNew, params, setParams]);

  // "N" starts a new post from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.sheet, .dialog')) return;
      e.preventDefault();
      setComposer({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Shared order (owners/admins) ──
  // The list follows the team's saved order. While a new order is saving,
  // `localOrder` (every post id, top first) holds it so the list doesn't jump
  // back; it's dropped once the saved order arrives from the server.
  const [localOrder, setLocalOrder] = useState(null);
  const savingOrder = useRef(false);
  useEffect(() => { if (!savingOrder.current) setLocalOrder(null); }, [posts]);
  const ordered = useMemo(() => {
    if (!localOrder) return posts;
    const byId = new Map(posts.map(p => [p.id, p]));
    const placed = localOrder.map(id => byId.get(id)).filter(Boolean);
    const placedIds = new Set(localOrder);
    return [...placed, ...posts.filter(p => !placedIds.has(p.id))];
  }, [posts, localOrder]);

  const counts = useMemo(() => ({
    mine: posts.filter(p => isWaitingOn(p, uid)).length,
    open: posts.filter(p => p.status === 'pending').length,
    needs_work: posts.filter(p => p.status === 'needs_work').length,
    approved: posts.filter(p => p.status === 'approved').length,
    live: posts.filter(p => p.status === 'live').length,
    all: posts.filter(p => p.status !== 'live').length,
  }), [posts, uid]);

  // Land on "Waiting on me" when there's something there, otherwise "Open".
  const tab = TABS.some(t => t.id === tabParam) ? tabParam : (counts.mine ? 'mine' : 'open');
  const setTab = (id) => { const next = new URLSearchParams(params); next.set('tab', id); setParams(next, { replace: true }); };

  const shown = useMemo(() => {
    let list;
    if (tab === 'live') {
      list = posts.filter(p => p.status === 'live')
        .sort((a, b) => new Date(b.went_live_at || 0) - new Date(a.went_live_at || 0));
    } else {
      list = ordered.filter(p => p.status !== 'live');
      if (tab === 'mine') list = list.filter(p => isWaitingOn(p, uid));
      else if (tab === 'open') list = list.filter(p => p.status === 'pending');
      else if (tab !== 'all') list = list.filter(p => p.status === tab);
    }
    return searchRank(list, search, p => [
      { text: p.title, weight: 3 },
      { text: p.url, weight: 1.5 },
      { text: p.files, weight: 1.5 },
      { text: p.description },
      { text: fullName(p.author) },
    ]);
  }, [posts, ordered, tab, search, uid]);

  const canGoLive = (p) => isAdmin || p.created_by === uid || p.reviewers.includes(uid);
  const undoLive = async (p) => {
    try { await unmarkReviewLive(p.id); toast(`"${p.title}" is back in Ready for live`, { icon: 'undo' }); }
    catch (e) { toast(e.message || "Couldn't undo.", { icon: 'alert' }); }
  };
  const markLive = async (p) => {
    try {
      await markReviewLive(p.id);
      toast(`"${p.title}" is live`, { icon: 'rocket', action: { label: 'Undo', onClick: () => undoLive(p) } });
    } catch (e) { toast(e.message || "Couldn't mark it live.", { icon: 'alert' }); }
  };

  // A tab shows some of the posts. Reordering them puts the visible posts in
  // their new order into the slots they already held in the full list, so
  // the posts in other tabs keep their places.
  const saveOrder = async (visibleIds) => {
    const visible = new Set(visibleIds);
    const queue = [...visibleIds];
    const full = ordered.map(p => (visible.has(p.id) ? queue.shift() : p.id));
    if (full.join() === ordered.map(p => p.id).join()) return;
    setLocalOrder(full);
    savingOrder.current = true;
    try {
      await reorderReviews(activeTeamId, full);
    } catch (e) {
      setLocalOrder(null);
      toast(e.message || "Couldn't save the new order.", { icon: 'alert' });
    } finally {
      savingOrder.current = false;
    }
  };

  const { rowRef, capture } = useFlipRows();
  const [dragOrder, setDragOrder] = useState(null);
  const dragOrderRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [armedId, setArmedId] = useState(null);
  // A search hides posts in between, so "move above this one" would be
  // ambiguous — reordering waits until the search is cleared.
  const canReorder = !search.trim();
  const reorderable = isAdmin && tab !== 'live';
  useEffect(() => {
    const disarm = () => setArmedId(null);
    window.addEventListener('pointerup', disarm);
    return () => window.removeEventListener('pointerup', disarm);
  }, []);
  const setDragIds = (ids) => { capture(); dragOrderRef.current = ids; setDragOrder(ids); };

  const dragFor = (post) => (!reorderable ? null : {
    enabled: canReorder,
    armed: armedId === post.id,
    dragging: dragId === post.id,
    arm: () => setArmedId(post.id),
    disarm: () => setArmedId(null),
    onDragStart: (e) => {
      setDragId(post.id);
      const ids = shown.map(p => p.id);
      dragOrderRef.current = ids;
      setDragOrder(ids);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', post.id);
    },
    onDragOver: (e) => {
      if (!dragId) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dragId === post.id) return;
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      const current = dragOrderRef.current || [];
      const ids = current.filter(id => id !== dragId);
      ids.splice(ids.indexOf(post.id) + (after ? 1 : 0), 0, dragId);
      if (ids.join() !== current.join()) setDragIds(ids);
    },
    onDragEnd: () => {
      const ids = dragOrderRef.current;
      dragOrderRef.current = null;
      setDragId(null);
      setArmedId(null);
      setDragOrder(null);
      if (ids) saveOrder(ids);
    },
    // One place up or down: the phone's arrows, and Alt+↑/↓ on the handle.
    move: (delta) => {
      if (!canReorder) return;
      const ids = shown.map(p => p.id);
      const from = ids.indexOf(post.id);
      const to = from + delta;
      if (to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      capture();
      saveOrder(ids);
    },
    onKey: (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      e.stopPropagation();
      dragFor(post).move(e.key === 'ArrowUp' ? -1 : 1);
    },
  });

  const listed = dragOrder
    ? dragOrder.map(id => shown.find(p => p.id === id)).filter(Boolean)
    : shown;

  const openPost = (id) => { const next = new URLSearchParams(params); next.set('post', id); setParams(next); };
  const closePost = () => { const next = new URLSearchParams(params); next.delete('post'); setParams(next, { replace: true }); };
  const openedPost = openId ? posts.find(p => p.id === openId) : null;

  const cols = [
    'minmax(0, 1fr)', '190px', '56px', 'minmax(150px, 210px)', '96px', '52px',
    ...(tab === 'approved' ? ['110px'] : []),
  ].join(' ');

  const sub = counts.mine
    ? <>{counts.mine} waiting on you<span className="sep">·</span>{counts.open} open</>
    : <>{counts.open} open<span className="sep">·</span>{counts.approved} ready for live</>;

  const [emptyTitle, emptyText] = EMPTY_TEXT[tab];

  return (
    <div className="page rv-page">
      <TopBarPortal>
        <button type="button" className="btn" onClick={() => setShowDefaults(true)} aria-label="Default reviewers" title="Team default reviewers">
          <Icon name="users" /> <span className="hide-phone">Default reviewers</span>
        </button>
        <button type="button" className="btn btn-primary" onClick={() => setComposer({})} title="New post (N)">
          <Icon name="plus" /> New post
        </button>
      </TopBarPortal>

      <PageHeader eyebrow="Review" title="Ready for review" sub={loading ? ' ' : sub} />

      <div className="rv-bar anim-rise">
        <Tabs
          className="rv-tabs"
          value={tab}
          onChange={setTab}
          items={TABS.map(t => ({ value: t.id, label: t.label, count: loading ? null : counts[t.id] }))}
        />
        <SearchInput className="rv-search" value={search} onChange={setSearch} placeholder="Search posts" />
      </div>

      {error && (
        <div className="notice notice-error rv-error">
          <Icon name="alert" size={15} />
          <span>{error} — if this is a new install, run supabase-review-migration.sql in the Supabase SQL editor.</span>
        </div>
      )}

      <div className={`table rv-table ${reorderable ? 'has-grip' : ''}`} style={{ '--cols': cols }}>
        <div className="table-head">
          <span className="rv-h-post">Post</span>
          <span>Status</span>
          <span className="hide-phone">Round</span>
          <span>{tab === 'live' ? 'Went live' : 'Posted'}</span>
          <span className="hide-phone">Reviewers</span>
          <span className="rv-h-notes">Notes</span>
          {tab === 'approved' && <span />}
        </div>

        {loading ? (
          <SkeletonRows rows={5} widths={['40%', '14%', '4%', '14%', '8%', '4%']} />
        ) : listed.length === 0 ? (
          search
            ? <Empty icon="search" title="No matches">Nothing in this tab matches “{search}”.</Empty>
            : (
              <Empty
                icon={tab === 'live' ? 'rocket' : 'eye'}
                title={emptyTitle}
                action={(tab === 'open' || tab === 'all' || tab === 'mine') ? (
                  <button type="button" className="btn btn-primary" onClick={() => setComposer({})}>
                    <Icon name="plus" /> New post
                  </button>
                ) : null}
              >
                {emptyText}
              </Empty>
            )
        ) : (
          <div key={tab} className="rv-rows">
            {listed.map((p, i) => (
              <PostRow
                key={p.id}
                post={p}
                index={i}
                members={members}
                uid={uid}
                tab={tab}
                rowRef={rowRef(p.id)}
                drag={dragFor(p)}
                isFirst={i === 0}
                isLast={i === listed.length - 1}
                onOpen={openPost}
                onMarkLive={markLive}
                canGoLive={canGoLive(p)}
              />
            ))}
          </div>
        )}
      </div>

      {reorderable && !loading && listed.length > 1 && (
        <p className="table-foot rv-foot">
          {canReorder
            ? 'Drag the handle to reorder. Everyone on the team sees the same order.'
            : 'Clear the search to reorder.'}
        </p>
      )}

      {openedPost && (
        <DetailSheet
          post={openedPost}
          members={members}
          uid={uid}
          isAdmin={isAdmin}
          teamId={activeTeamId}
          onClose={closePost}
          onEdit={(p) => setComposer({ post: p })}
          onMarkLive={markLive}
          onUndoLive={undoLive}
        />
      )}

      {composer && (
        <ComposerSheet
          post={composer.post}
          teamId={activeTeamId}
          members={memberList}
          defaults={defaults}
          uid={uid}
          onClose={() => setComposer(null)}
          onSaved={(id) => { const wasNew = !composer.post; setComposer(null); if (wasNew) openPost(id); }}
        />
      )}

      {showDefaults && (
        <DefaultsDialog
          teamId={activeTeamId}
          members={memberList}
          value={defaults}
          canEdit={isAdmin}
          uid={uid}
          onClose={() => setShowDefaults(false)}
          onSaved={(ids) => { setDefaults(ids); setShowDefaults(false); }}
        />
      )}
    </div>
  );
}
