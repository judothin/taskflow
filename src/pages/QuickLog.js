import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { awardTaskCreatedXp, awardTaskCompletedXp } from '../lib/xp';
import { tasksChanged } from '../lib/events';
import FeedbackEditor from '../components/FeedbackEditor';
import {
  Sheet, Icon, Avatar, Segmented, SheetLabel, CheckRow, toast, fullName, ROIS, COMPLEXITIES,
} from '../ui';
import './QuickLog.css';

// ══════════════════════════════════════════════════════════════
// Log a completed task — something already done that was never tracked.
// Opened by the 'open-quick-log' event / the "q" shortcut; GlobalShortcuts
// mounts <QuickLogModal onClose />. QuickLogForm is the same form without
// the sheet around it, for embedding.
// ══════════════════════════════════════════════════════════════

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (html) => (html || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
// The `title` column is newer than some databases: an insert naming it
// fails there, and we retry with the title folded into the description.
const missingTitleColumn = (err) => /title/i.test(err?.message || '') && /column|schema/i.test(err?.message || '');

function useQuickLog({ onLogged }) {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const myName = fullName(profile);
  const [members, setMembers] = useState(null);
  const [title, setTitle] = useState('');
  const [page, setPage] = useState('');
  const [feedback, setFeedback] = useState('');
  const [completedBy, setCompletedBy] = useState(myName ? [myName] : []);
  const [roi, setRoi] = useState('medium');
  const [complexity, setComplexity] = useState('medium');
  const [another, setAnother] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [editorKey, setEditorKey] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!activeTeamId) return;
    fetchTeamMembers(activeTeamId).then(m => setMembers(m || []));
  }, [activeTeamId]);
  // The profile can arrive after the sheet opens.
  useEffect(() => { if (myName) setCompletedBy(prev => (prev.length ? prev : [myName])); }, [myName]);

  const togglePerson = (name) =>
    setCompletedBy(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));

  const fail = (msg) => { setError(msg); setErrorKey(k => k + 1); };

  const submit = async () => {
    if (saving) return false;
    if (!title.trim()) { fail('Say what you finished.'); return false; }
    if (!page.trim()) { fail('Add the page or area it was on.'); return false; }
    if (!completedBy.length) { fail('Pick at least one person who completed it.'); return false; }

    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    const who = completedBy.join(', ');
    const body = plain(feedback) ? feedback : '';
    const row = {
      team_id: activeTeamId,
      title: title.trim(),
      page: page.trim(),
      feedback: body,
      noticed_by: who,
      completed_by: who,
      status: 'completed',
      roi,
      complexity,
      date_received: now,
      date_completed: now,
      updated_at: now,
      created_by: user?.id || null,
    };
    let { error: err } = await supabase.from('tasks').insert(row);
    if (err && missingTitleColumn(err)) {
      const { title: t, ...rest } = row;
      ({ error: err } = await supabase.from('tasks').insert({ ...rest, feedback: `<p>${escapeHtml(t)}</p>${body}` }));
    }
    setSaving(false);
    if (err) { fail(err.message); return false; }

    // One after the other: each award reads XP and writes it back.
    (async () => {
      await awardTaskCreatedXp(user?.id);
      await awardTaskCompletedXp(user?.id, complexity, { roi });
    })().catch(() => {});
    tasksChanged();
    setCount(c => c + 1);

    // Keep the page and people (often several logs for one area); clear
    // what was done.
    setTitle('');
    setFeedback('');
    setEditorKey(k => k + 1);
    onLogged?.(row);
    return true;
  };

  return {
    members, myName, title, setTitle, page, setPage, feedback, setFeedback, completedBy, togglePerson,
    roi, setRoi, complexity, setComplexity, another, setAnother, saving, error, errorKey, editorKey, count, submit,
  };
}

// ── Pieces shared by the sheet and the bare form ─────────────
function MainFields({ f, titleRef }) {
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  return (
    <>
      <textarea
        ref={(el) => { if (titleRef) titleRef.current = el; grow(el); }}
        className="title-input ql-title"
        rows={1}
        placeholder="What did you finish?"
        value={f.title}
        onChange={(e) => { f.setTitle(e.target.value); grow(e.target); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) e.preventDefault(); }}
        aria-label="What did you finish?"
      />
      <label className="link-field ql-page">
        <Icon name="link" size={15} />
        <input
          value={f.page}
          onChange={(e) => f.setPage(e.target.value)}
          placeholder="Page name or URL, e.g. Checkout or https://example.com/page"
          aria-label="Page or area"
        />
      </label>
      <div className="ql-body">
        <FeedbackEditor
          key={f.editorKey}
          value={f.feedback}
          onChange={f.setFeedback}
          placeholder="Any detail worth keeping — what changed, where, anything to remember… (optional)"
        />
      </div>
    </>
  );
}

function People({ f }) {
  if (f.members === null) {
    return (
      <div className="ql-people">
        {[0, 1, 2].map(i => <div key={i} className="skel ql-person-skel" />)}
      </div>
    );
  }
  if (!f.members.length) return <p className="ql-hint">No team members found.</p>;
  return (
    <div className="ql-people stagger">
      {f.members.map(m => {
        const name = fullName(m);
        const on = f.completedBy.includes(name);
        return (
          <button key={m.id} type="button" className={`ql-person ${on ? 'is-on' : ''}`} onClick={() => f.togglePerson(name)} aria-pressed={on}>
            <Avatar person={m} size={26} />
            <span className="truncate ql-person-name">{name}{name === f.myName && <span className="t-3"> · you</span>}</span>
            <span className={`check-round ${on ? 'is-on' : ''}`} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function Choices({ f }) {
  return (
    <>
      <div>
        <SheetLabel>ROI</SheetLabel>
        <Segmented value={f.roi} onChange={f.setRoi} options={ROIS} ariaLabel="ROI" />
      </div>
      <div>
        <SheetLabel>Complexity</SheetLabel>
        <Segmented value={f.complexity} onChange={f.setComplexity} options={COMPLEXITIES} ariaLabel="Complexity" />
      </div>
    </>
  );
}

function ErrorLine({ f }) {
  if (!f.error) return null;
  return (
    <div key={f.errorKey} className="notice notice-error wiggle ql-error" role="alert">
      <Icon name="alert" size={15} />{f.error}
    </div>
  );
}

/** The form with no sheet around it. */
export function QuickLogForm({ onLogged }) {
  const f = useQuickLog({ onLogged });
  return (
    <form className="ql-form" onSubmit={(e) => { e.preventDefault(); f.submit(); }}>
      {f.count > 0 && (
        <div key={f.count} className="notice notice-ok ql-ok">
          <Icon name="check" size={15} />
          {f.count === 1 ? 'Logged as completed.' : `${f.count} tasks logged as completed.`}
        </div>
      )}
      <MainFields f={f} />
      <div>
        <SheetLabel>Completed by</SheetLabel>
        <People f={f} />
      </div>
      <Choices f={f} />
      <ErrorLine f={f} />
      <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={f.saving}>
        {f.saving ? <span className="spinner" /> : 'Log as completed'}
      </button>
    </form>
  );
}

export default function QuickLogModal({ onClose }) {
  const navigate = useNavigate();
  const titleRef = useRef(null);
  const anotherRef = useRef(false);
  const onLogged = useCallback((row) => {
    toast(anotherRef.current ? `Logged “${row.title.slice(0, 40)}”` : 'Logged as completed', {
      action: { label: 'View', onClick: () => navigate('/completed') },
    });
  }, [navigate]);
  const f = useQuickLog({ onLogged });
  anotherRef.current = f.another;

  useEffect(() => { setTimeout(() => titleRef.current?.focus(), 60); }, []);

  const submit = async () => {
    const ok = await f.submit();
    if (!ok) return;
    if (f.another) titleRef.current?.focus();
    else onClose();
  };

  return (
    <Sheet
      eyebrow={<>Log completed{f.count > 0 && <span key={f.count} className="t-4 bump">· {f.count} logged</span>}</>}
      onClose={onClose}
      onSubmit={submit}
      mainClassName="ql-main"
      aside={(
        <>
          <div>
            <SheetLabel sub="Everyone picked shares the credit">Completed by</SheetLabel>
            <People f={f} />
          </div>
          <Choices f={f} />
          <div className="sheet-aside-sep" />
          <CheckRow
            checked={f.another}
            onChange={f.setAnother}
            title="Log another"
            desc="Keep this open and reuse the page + people"
          />
        </>
      )}
      footer={(
        <>
          <span className="sheet-foot-note hide-phone">Lands in Completed, stamped now</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={f.saving}>
            {f.saving ? <span className="spinner" /> : <>Log as completed <span className="kbd">⌘↵</span></>}
          </button>
        </>
      )}
    >
      <MainFields f={f} titleRef={titleRef} />
      <ErrorLine f={f} />
    </Sheet>
  );
}
