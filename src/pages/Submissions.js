import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { TopBarPortal } from '../context/HeaderActionsContext';
import { fetchTeamMembers } from '../lib/teams';
import { awardTaskCreatedXp } from '../lib/xp';
import { openTask, tasksChanged } from '../lib/events';
import { searchRank } from '../lib/fuzzySearch';
import { taskTitle, taskPreview, pageLabel } from '../lib/taskText';
import AssigneeSelect from '../components/AssigneeSelect';
import DatePicker from '../components/DatePicker';
import {
  Icon, Sheet, ConfirmDialog, Tabs, Segmented, toast, PageHeader, Empty, SearchInput,
  Dropzone, Lightbox, SheetLabel, SkeletonRows, ROIS, COMPLEXITIES, shortDate, longDate, fullName,
} from '../ui';
import './Submissions.css';

// Inbox for the guest portal (/submit/:slug). Each submission is reviewed in
// a sheet, then approved (which creates a task) or declined.

const TABS = [
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];
const DOT = { pending: 'dot-on_hold', approved: 'dot-completed', declined: '' };
const STATUS_TEXT = { pending: 'Pending', approved: 'Approved', declined: 'Declined' };

// Databases without the newer `title` column reject it; retry without it,
// folding the title into the description so nothing is lost.
const missingTitle = (err) => !!err && /title/i.test(`${err.message || ''} ${err.details || ''}`)
  && /column|schema cache/i.test(`${err.message || ''} ${err.details || ''}`);
async function withTitleFallback(run, row) {
  let res = await run(row);
  if (missingTitle(res.error)) {
    const { title, ...rest } = row;
    res = await run(title ? { ...rest, feedback: `${title}\n\n${rest.feedback || ''}` } : rest);
  }
  return res;
}

const imagesOf = (s) => (s.images?.length ? s.images : s.png_url ? [s.png_url] : []);

function ReviewSheet({ submission, users, onClose, onDone }) {
  const { user } = useAuth();
  const pending = submission.status === 'pending';
  const [title, setTitle] = useState(submission.title || '');
  const [page, setPage] = useState(submission.page || '');
  const [feedback, setFeedback] = useState(submission.feedback || '');
  const [noticedBy, setNoticedBy] = useState(submission.noticed_by || '');
  const [roi, setRoi] = useState('medium');
  const [complexity, setComplexity] = useState('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState(submission.notes || '');
  const [imgs, setImgs] = useState(() => imagesOf(submission).map(url => ({ url })));
  const [zoom, setZoom] = useState(null);
  const [saving, setSaving] = useState(null); // 'approve' | 'decline'
  const [error, setError] = useState('');
  const [errTick, setErrTick] = useState(0);
  const [confirmDecline, setConfirmDecline] = useState(false);

  useEffect(() => () => imgs.forEach(i => i.preview && URL.revokeObjectURL(i.preview)), []);

  const fail = (msg) => { setError(msg); setErrTick(t => t + 1); };
  const addFiles = (files) => setImgs(prev => [
    ...prev,
    ...files.filter(f => f.type.startsWith('image/')).map(f => ({ file: f, preview: URL.createObjectURL(f) })),
  ]);
  const removeImg = (i) => setImgs(prev => {
    const next = [...prev];
    if (next[i].preview) URL.revokeObjectURL(next[i].preview);
    next.splice(i, 1);
    return next;
  });

  const resolveImgs = async () => {
    const urls = [];
    for (const img of imgs) {
      if (img.file) {
        const ext = img.file.name.split('.').pop();
        const path = `submissions/reviewed-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-images').upload(path, img.file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        urls.push(data.publicUrl);
      } else if (img.url) urls.push(img.url);
    }
    return urls;
  };

  const effectiveTitle = title.trim();

  const approve = async () => {
    if (!pending || saving) return;
    if (!effectiveTitle && !feedback.trim()) { fail('Give it a title or a description.'); return; }
    setSaving('approve'); setError('');
    try {
      const now = new Date().toISOString();
      const finalImgs = await resolveImgs();
      const taskRow = {
        team_id: submission.team_id,
        title: effectiveTitle || null,
        page: page.trim(), feedback: feedback.trim(), noticed_by: noticedBy.trim(),
        png_url: finalImgs[0] || null, roi, complexity,
        status: 'open', date_received: submission.created_at, updated_at: now,
        created_by: user?.id || null, is_guest: true,
        assignee_id: assigneeId || null,
        due_date: dueDate || null,
      };
      const { data: task, error: taskErr } = await withTitleFallback(
        (row) => supabase.from('tasks').insert(row).select('*').single(), taskRow,
      );
      if (taskErr) throw taskErr;
      awardTaskCreatedXp(user?.id);
      const subRow = {
        title: effectiveTitle || null,
        page: page.trim(), feedback: feedback.trim(), noticed_by: noticedBy.trim(),
        png_url: finalImgs[0] || null, images: finalImgs,
        status: 'approved', reviewed_at: now, reviewed_by: user?.id,
        notes: notes.trim() || null,
      };
      const { error: subErr } = await withTitleFallback(
        (row) => supabase.from('submissions').update(row).eq('id', submission.id), subRow,
      );
      if (subErr) throw subErr;
      tasksChanged();
      toast('Task created', task ? { action: { label: 'Open', onClick: () => openTask(task) } } : {});
      onDone();
    } catch (err) {
      fail(err.message || 'Failed to approve');
    } finally {
      setSaving(null);
    }
  };

  const decline = async () => {
    setSaving('decline'); setError('');
    try {
      const row = {
        title: effectiveTitle || null,
        page: page.trim(), feedback: feedback.trim(), noticed_by: noticedBy.trim(),
        status: 'declined', reviewed_at: new Date().toISOString(), reviewed_by: user?.id,
        notes: notes.trim() || null,
      };
      const { error: subErr } = await withTitleFallback(
        (r) => supabase.from('submissions').update(r).eq('id', submission.id), row,
      );
      if (subErr) throw subErr;
      setConfirmDecline(false);
      toast('Submission declined');
      onDone();
    } catch (err) {
      setConfirmDecline(false);
      fail(err.message || 'Failed to decline');
    } finally {
      setSaving(null);
    }
  };

  const reviewer = users.find(u => u.id === submission.reviewed_by);

  const aside = (
    <>
      <div>
        <SheetLabel>Noticed by</SheetLabel>
        <input className="input" value={noticedBy} onChange={e => setNoticedBy(e.target.value)} readOnly={!pending} placeholder="Name" />
      </div>
      {pending && (
        <>
          <div>
            <SheetLabel>ROI</SheetLabel>
            <Segmented value={roi} onChange={setRoi} options={ROIS} ariaLabel="ROI" />
          </div>
          <div>
            <SheetLabel>Complexity</SheetLabel>
            <Segmented value={complexity} onChange={setComplexity} options={COMPLEXITIES} ariaLabel="Complexity" />
          </div>
          <div className="meta">
            <span className="meta-k">Assignee</span>
            <span className="meta-v"><AssigneeSelect users={users} value={assigneeId} onChange={setAssigneeId} variant="inline" /></span>
            <span className="meta-k">Due date</span>
            <span className="meta-v"><DatePicker value={dueDate} onChange={setDueDate} variant="inline" /></span>
            <span className="meta-k">Received</span>
            <span className="meta-v mono">{longDate(submission.created_at)}</span>
          </div>
        </>
      )}
      {!pending && (
        <div className="meta">
          <span className="meta-k">Status</span>
          <span className="meta-v"><span className={`dot ${DOT[submission.status]}`} />{STATUS_TEXT[submission.status]}</span>
          <span className="meta-k">Received</span>
          <span className="meta-v mono">{longDate(submission.created_at)}</span>
          {submission.reviewed_at && (
            <>
              <span className="meta-k">Reviewed</span>
              <span className="meta-v mono">{longDate(submission.reviewed_at)}</span>
            </>
          )}
          {reviewer && (
            <>
              <span className="meta-k">By</span>
              <span className="meta-v">{fullName(reviewer)}</span>
            </>
          )}
        </div>
      )}
      <div className="sheet-aside-sep" />
      <div>
        <SheetLabel sub="Only your team sees these.">Notes</SheetLabel>
        <textarea className="textarea" rows={3} value={notes} onChange={e => setNotes(e.target.value)} readOnly={!pending} placeholder={pending ? 'Internal notes…' : 'No notes'} />
      </div>
    </>
  );

  const footer = pending ? (
    <>
      <button type="button" className="btn btn-danger" onClick={() => setConfirmDecline(true)} disabled={!!saving}>Decline</button>
      <span className="sheet-foot-note hide-phone">From the guest portal · {shortDate(submission.created_at)}</span>
      <span className="spacer" />
      <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button type="button" className="btn btn-primary" onClick={approve} disabled={!!saving}>
        {saving === 'approve' ? <span className="spinner" /> : <Icon name="check" size={14} />}
        Approve &amp; create task <span className="kbd">⌘↵</span>
      </button>
    </>
  ) : (
    <>
      <span className="sheet-foot-note">{STATUS_TEXT[submission.status]}{submission.reviewed_at ? ` · ${shortDate(submission.reviewed_at)}` : ''}</span>
      <span className="spacer" />
      <button type="button" className="btn" onClick={onClose}>Close</button>
    </>
  );

  return (
    <Sheet
      eyebrow={<>Submission <span className={`dot ${DOT[submission.status]}`} /> {STATUS_TEXT[submission.status]}</>}
      onClose={onClose}
      onSubmit={pending ? approve : undefined}
      aside={aside}
      footer={footer}
    >
      <textarea
        className="title-input"
        rows={1}
        value={title}
        onChange={e => setTitle(e.target.value)}
        readOnly={!pending}
        placeholder={taskTitle({ feedback }) || 'Title'}
        onInput={e => { e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }}
      />
      <div className="link-field sb-link">
        <Icon name="link" size={15} />
        <input value={page} onChange={e => setPage(e.target.value)} readOnly={!pending} placeholder="Page or URL" />
        {/^https?:\/\//i.test(page.trim()) && (
          <a className="link-open" href={page.trim()} target="_blank" rel="noopener noreferrer">Open <Icon name="arrowUpRight" size={12} /></a>
        )}
      </div>
      <textarea
        className="body-input sb-body"
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        readOnly={!pending}
        placeholder="Describe the issue…"
        rows={6}
      />

      {error && (
        <div key={errTick} className="notice notice-error wiggle sb-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>
      )}

      <div className="sb-shots">
        <SheetLabel>Screenshots</SheetLabel>
        {imgs.length > 0 && (
          <div className="attach-grid">
            {imgs.map((img, i) => (
              <div key={img.url || img.preview} className="attach">
                <img className="attach-thumb" src={img.url || img.preview} alt="" onClick={() => setZoom(img.url || img.preview)} />
                {pending && (
                  <button type="button" className="attach-x" onClick={() => removeImg(i)} aria-label="Remove screenshot">
                    <Icon name="x" size={11} stroke={2.4} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {pending ? (
          <Dropzone onFiles={addFiles} accept="image/*" title="Upload or drop a screenshot" sub="PNG, JPG, WebP" row={imgs.length > 0} />
        ) : imgs.length === 0 && <span className="t-3" style={{ fontSize: 13.5 }}>No screenshots</span>}
      </div>

      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
      {confirmDecline && (
        <ConfirmDialog
          title="Decline this submission?"
          text="It moves to Declined and no task is created. Your edits and notes are kept."
          confirmLabel="Decline"
          danger
          busy={saving === 'decline'}
          onConfirm={decline}
          onClose={() => saving !== 'decline' && setConfirmDecline(false)}
        />
      )}
    </Sheet>
  );
}

export default function Submissions() {
  const { activeTeam, activeTeamId } = useTeam();
  const [all, setAll] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState(null);
  const [settled, setSettled] = useState(false);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setAll([]); setUsers([]); setLoading(false); return; }
    const [{ data }, members] = await Promise.all([
      supabase.from('submissions').select('*').eq('team_id', activeTeamId).order('created_at', { ascending: false }),
      fetchTeamMembers(activeTeamId),
    ]);
    setAll(data || []);
    setUsers(members || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { setLoading(true); setSettled(false); fetchData(); }, [fetchData]);
  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [loading, tab]);
  useEffect(() => { setSettled(false); }, [tab]);

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, declined: 0 };
    all.forEach(s => { if (c[s.status] !== undefined) c[s.status] += 1; });
    return c;
  }, [all]);

  const visible = useMemo(() => {
    const list = all.filter(s => s.status === tab);
    return query.trim()
      ? searchRank(list, query, s => [
        { text: taskTitle(s), weight: 3 },
        { text: s.page || '', weight: 2 },
        { text: s.noticed_by || '', weight: 2 },
        { text: s.feedback || '', weight: 1 },
      ])
      : list;
  }, [all, tab, query]);

  const open = all.find(s => s.id === openId) || null;
  const guestLink = activeTeam?.slug ? `${window.location.origin}/submit/${activeTeam.slug}` : '';

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(guestLink); toast('Guest link copied'); } catch { toast('Couldn’t reach the clipboard', { icon: 'alert' }); }
  };

  const sub = loading ? ' ' : (
    <>
      {counts.pending} pending<span className="sep">·</span>{counts.approved} approved<span className="sep">·</span>{counts.declined} declined
    </>
  );

  return (
    <div className="page">
      {guestLink && (
        <TopBarPortal>
          <button type="button" className="btn" onClick={copyLink} title="Copy the guest portal link">
            <Icon name="link" /> <span className="hide-phone">Copy guest link</span>
          </button>
          <a className="btn" href={guestLink} target="_blank" rel="noopener noreferrer" title="Open the guest portal">
            <Icon name="external" /> <span className="hide-phone">Guest portal</span>
          </a>
        </TopBarPortal>
      )}

      <PageHeader eyebrow="Inbox" title="Submissions" sub={sub} />

      <div className="sb-bar anim-rise">
        <Tabs value={tab} onChange={setTab} items={TABS.map(t => ({ ...t, count: loading ? undefined : counts[t.value] }))} />
        <SearchInput value={query} onChange={setQuery} placeholder="Search submissions" className="sb-search" />
      </div>

      <div className="table sb-table" style={{ '--cols': 'minmax(0, 1fr) 160px 110px 70px 120px' }}>
        <div className="table-head">
          <span>Submission</span>
          <span>Noticed by</span>
          <span>Received</span>
          <span className="hide-phone">Shots</span>
          <span>Status</span>
        </div>

        {loading ? (
          <SkeletonRows rows={5} widths={['46%', '14%', '9%', '4%', '10%']} />
        ) : visible.length === 0 ? (
          query.trim() ? (
            <Empty icon="search" title="No matches">Nothing in {STATUS_TEXT[tab].toLowerCase()} matches “{query}”.</Empty>
          ) : (
            <Empty
              icon="inbox"
              title={tab === 'pending' ? 'Inbox zero' : `Nothing ${STATUS_TEXT[tab].toLowerCase()} yet`}
              action={tab === 'pending' && guestLink ? <button type="button" className="btn" onClick={copyLink}><Icon name="copy" size={14} />Copy guest link</button> : null}
            >
              {tab === 'pending' ? 'New feedback from your guest portal shows up here for review.' : 'Reviewed submissions are kept here.'}
            </Empty>
          )
        ) : (
          <div key={tab} className={`stagger ${settled ? 'settled' : ''}`}>
            {visible.map(s => {
              const shots = imagesOf(s).length;
              return (
                <div
                  key={s.id}
                  className={`table-row ${openId === s.id ? 'is-selected' : ''}`}
                  onClick={() => setOpenId(s.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') setOpenId(s.id); }}
                >
                  <div className="table-cell" style={{ display: 'block' }}>
                    <div className="table-title truncate">{taskTitle(s)}</div>
                    <div className="table-sub">
                      {s.page ? pageLabel(s.page) : taskPreview(s, 90)}
                    </div>
                  </div>
                  <div className="table-cell truncate">{s.noticed_by || <span className="t-4">—</span>}</div>
                  <div className="table-cell mono">{shortDate(s.created_at)}</div>
                  <div className="table-cell mono hide-phone">
                    {shots ? <><Icon name="image" size={13} />{shots}</> : <span className="t-4">—</span>}
                  </div>
                  <div className="table-cell">
                    <span className="status"><span className={`dot ${DOT[s.status]}`} />{STATUS_TEXT[s.status]}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {open && (
        <ReviewSheet
          key={open.id}
          submission={open}
          users={users}
          onClose={() => setOpenId(null)}
          onDone={() => { setOpenId(null); fetchData(); }}
        />
      )}
    </div>
  );
}
