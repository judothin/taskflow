import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { awardTaskCreatedXp, awardTaskCompletedXp } from '../lib/xp';
import { asSubtasks, cleanSubtasks } from '../lib/subtasks';
import { taskTitle, taskBodyHtml, isUrl } from '../lib/taskText';
import { tasksChanged, queueChanged } from '../lib/events';
import {
  Sheet, Segmented, StatusPicker, SheetLabel, CheckRow, Dropzone, Lightbox, Avatar, Icon,
  ConfirmDialog, Dialog, ROIS, COMPLEXITIES, STATUSES, STATUS_LABEL, longDate, shortDate, ago, fullName, toast,
} from '../ui';
import FeedbackEditor from './FeedbackEditor';
import SubtaskEditor from './SubtaskEditor';
import AssigneeSelect from './AssigneeSelect';
import DatePicker from './DatePicker';
import './TaskSheet.css';

const MAX_TOTAL_BYTES = 6 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'zip'];
const ACCEPT = 'image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip';
const isAllowed = (f) => (f.type || '').startsWith('image/') || ALLOWED_EXT.includes((f.name.split('.').pop() || '').toLowerCase());

function kindOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc', 'docx'].includes(ext)) return 'word';
  if (['ppt', 'pptx'].includes(ext)) return 'pptx';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'excel';
  return 'file';
}
const KIND_LABEL = { pdf: 'PDF', word: 'DOC', pptx: 'PPT', excel: 'XLS', file: 'FILE' };
const fmtBytes = (b) => (b < 1024 ? `${b} B` : b < 1048576 ? `${Math.round(b / 1024)} KB` : `${(b / 1048576).toFixed(1)} MB`);
let pid = 0;
const nextId = () => `pf_${Date.now().toString(36)}_${pid++}`;
const fileNameFromUrl = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || ''); } catch { return ''; } };
const plainToHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').split(/\r?\n/).join('<br>');
const stripHtml = (h) => (h || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

async function fetchRemoteImage(url) {
  const res = await fetch(`/api/fetch-attachment?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('not an image');
  return new File([blob], fileNameFromUrl(url) || `attachment-${Date.now()}.png`, { type: blob.type });
}

// Saving tolerates a database that hasn't had the redesign migration yet:
// if `title` isn't a column, the title is folded into the description.
async function writeTask(isEdit, id, payload) {
  const run = (p) => (isEdit
    ? supabase.from('tasks').update(p).eq('id', id).select().single()
    : supabase.from('tasks').insert(p).select().single());
  let res = await run(payload);
  if (res.error && /title/.test(res.error.message || '') && /column|schema/i.test(res.error.message || '')) {
    const { title, ...rest } = payload;
    rest.feedback = title ? `<p><b>${plainToHtml(title)}</b></p>${rest.feedback || ''}` : rest.feedback;
    res = await run(rest);
  }
  return res;
}

/**
 * The task popout — creating a task and viewing/editing one are the same
 * sheet. Mounted app-wide by GlobalShortcuts; open it with openTask(id) or
 * openNewTask(prefill) from lib/events.
 */
export default function TaskSheet({ task, prefill, users = [], onClose, onSaved, isGuest = false }) {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const isEdit = !!task;
  const seed = !isEdit ? prefill : null;
  const myName = profile ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() : '';
  const titleRef = useRef(null);

  const [form, setForm] = useState(() => ({
    title: isEdit ? taskTitle(task) : (seed?.title || ''),
    page: task?.page || seed?.page || '',
    feedback: isEdit ? taskBodyHtml(task) : (seed?.feedback ? plainToHtml(seed.feedback) : ''),
    noticed_by: task?.noticed_by || seed?.noticed || myName,
    status: task?.status || seed?.status || 'open',
    roi: task?.roi || 'medium',
    complexity: task?.complexity || 'medium',
    assignee_id: task?.assignee_id || '',
    due_date: task?.due_date || '',
    subtasks: asSubtasks(task?.subtasks),
  }));
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const [existing, setExisting] = useState(() => (task?.attachments?.length
    ? task.attachments
    : task?.png_url ? [{ url: task.png_url, name: 'screenshot.png', kind: 'image' }] : []));
  const [pending, setPending] = useState([]);
  const [addToQueue, setAddToQueue] = useState(true);
  const [batch, setBatch] = useState(false);
  const [batchCount, setBatchCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errKey, setErrKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [completeAsk, setCompleteAsk] = useState(false);
  const [completedBy, setCompletedBy] = useState(() => (myName ? [myName] : []));
  const [preview, setPreview] = useState(null);
  const [queueRow, setQueueRow] = useState(undefined); // existing task: its queue row, null if not queued
  const [dragOver, setDragOver] = useState(false);
  const depth = useRef(0);

  const fail = (msg) => { setError(msg); setErrKey(k => k + 1); };

  // Autosize the title.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [form.title]);
  useEffect(() => { if (!isEdit) setTimeout(() => titleRef.current?.focus(), 80); }, [isEdit]);

  // Existing task: is it in the queue?
  useEffect(() => {
    if (!isEdit || isGuest) return;
    let live = true;
    supabase.from('queue').select('id').eq('task_id', task.id).maybeSingle()
      .then(({ data }) => { if (live) setQueueRow(data || null); });
    return () => { live = false; };
  }, [isEdit, isGuest, task?.id]);

  // ── Attachments ──
  const addFiles = (list) => {
    const incoming = Array.from(list || []).filter(Boolean);
    if (!incoming.length) return;
    let bytes = pending.reduce((s, p) => s + (p.size || 0), 0);
    const accepted = [];
    let over = false; let bad = false;
    incoming.forEach(file => {
      if (!isAllowed(file)) { bad = true; return; }
      const dup = (arr) => arr.some(p => p.name === file.name && p.size === file.size);
      if (dup(pending) || dup(accepted)) return;
      if (bytes + file.size > MAX_TOTAL_BYTES) { over = true; return; }
      bytes += file.size;
      const kind = kindOf(file.name);
      accepted.push({ id: nextId(), file, kind, name: file.name, size: file.size, preview: kind === 'image' ? URL.createObjectURL(file) : null });
    });
    if (accepted.length) setPending(p => [...p, ...accepted]);
    if (over) fail('Attachments are capped at 6 MB in total — some files were skipped.');
    else if (bad && !accepted.length) fail('That file type isn’t supported.');
  };
  const onPaste = (e) => {
    const imgs = Array.from(e.clipboardData?.items || []).filter(it => it.kind === 'file' && (it.type || '').startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    addFiles(imgs.map(it => {
      const f = it.getAsFile();
      if (!f) return null;
      if (f.name && f.name !== 'image.png') return f;
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type });
    }).filter(Boolean));
  };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dnd = {
    onDragEnter: (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setDragOver(true); },
    onDragOver: (e) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: () => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragOver(false); },
    onDrop: (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); depth.current = 0; setDragOver(false); addFiles(e.dataTransfer.files);
    },
  };
  const removePending = (id) => setPending(prev => {
    const t = prev.find(p => p.id === id);
    if (t?.preview) URL.revokeObjectURL(t.preview);
    return prev.filter(p => p.id !== id);
  });

  // Deep-link attachments (?attachments=url|url): fetch server-side, then attach.
  useEffect(() => {
    const urls = Array.isArray(seed?.attachments) ? seed.attachments.slice(0, 10) : [];
    if (!urls.length) return undefined;
    let alive = true;
    const holders = urls.map(url => ({ id: nextId(), file: null, kind: 'image', name: fileNameFromUrl(url) || 'image', size: 0, fetching: true }));
    setPending(p => [...p, ...holders]);
    urls.forEach((url, i) => {
      fetchRemoteImage(url).then(file => {
        if (!alive) return;
        setPending(prev => prev.map(p => (p.id === holders[i].id
          ? { ...p, file, name: file.name, size: file.size, fetching: false, preview: URL.createObjectURL(file) } : p)));
      }).catch(() => { if (alive) setPending(prev => prev.filter(p => p.id !== holders[i].id)); });
    });
    return () => { alive = false; };
  }, []);

  const uploadAll = async () => {
    const out = [...existing];
    for (const p of pending) {
      if (!p.file) continue;
      const ext = p.file.name.split('.').pop();
      const path = `tasks/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('task-images').upload(path, p.file, {
        contentType: p.file.type || 'application/octet-stream', upsert: false,
      });
      if (upErr) throw new Error(`Couldn't upload "${p.file.name}": ${upErr.message}`);
      const { data } = supabase.storage.from('task-images').getPublicUrl(path);
      out.push({ url: data.publicUrl, name: p.file.name, kind: p.kind });
    }
    return out;
  };

  // ── Save ──
  const becomingDone = form.status === 'completed' && (!task || task.status !== 'completed');

  const submit = async () => {
    if (saving) return;
    setError('');
    if (!form.title.trim() && !stripHtml(form.feedback)) { fail('Give the task a title.'); titleRef.current?.focus(); return; }
    if (becomingDone && !isGuest) { setCompleteAsk(true); return; }
    await save();
  };

  const save = async (overrides = {}) => {
    setSaving(true);
    try {
      const attachments = await uploadAll();
      const firstImage = attachments.find(a => a.kind === 'image');
      const now = new Date().toISOString();
      const payload = {
        title: form.title.trim() || null,
        page: form.page.trim(),
        feedback: form.feedback,
        noticed_by: form.noticed_by.trim(),
        status: form.status,
        roi: form.roi,
        complexity: form.complexity,
        assignee_id: form.assignee_id || null,
        due_date: form.due_date || null,
        subtasks: cleanSubtasks(form.subtasks),
        attachments,
        png_url: firstImage?.url || null,
        updated_at: now,
        ...overrides,
      };
      if (!isEdit) {
        payload.date_received = now;
        payload.team_id = activeTeamId;
        if (!isGuest) payload.created_by = user?.id;
      }
      if (becomingDone) payload.date_completed = now;

      const { data: saved, error: err } = await writeTask(isEdit, task?.id, payload);
      if (err) throw err;

      const leavingProgress = task?.status === 'in_progress' && ['open', 'on_hold'].includes(payload.status);
      if (!isEdit && !isGuest) awardTaskCreatedXp(user?.id);
      if (becomingDone && !isGuest) awardTaskCompletedXp(user?.id, payload.complexity, { roi: payload.roi, status: task?.status });

      if (!isEdit && !isGuest && addToQueue && payload.status !== 'completed') {
        const { data: pos } = await supabase.from('queue').select('position').eq('team_id', activeTeamId)
          .order('position', { ascending: false }).limit(1);
        await supabase.from('queue').insert({ task_id: saved.id, team_id: activeTeamId, position: (pos?.[0]?.position || 0) + 1 });
        queueChanged();
      }
      if (becomingDone || leavingProgress) {
        if (becomingDone) await supabase.from('queue').delete().eq('task_id', saved.id);
        if (task?.status === 'in_progress') {
          const { data: next } = await supabase.from('queue').select('id, task_id').eq('team_id', activeTeamId).order('position').limit(1);
          if (next?.length) {
            await Promise.all([
              supabase.from('tasks').update({ status: 'in_progress', updated_at: now }).eq('id', next[0].task_id),
              supabase.from('queue').delete().eq('id', next[0].id),
            ]);
          }
        }
        queueChanged();
      }
      tasksChanged();

      if (!isEdit && batch) {
        setBatchCount(c => c + 1);
        toast('Task added — ready for the next one');
        setForm(f => ({ ...f, title: '', feedback: '', subtasks: [] }));
        setExisting([]);
        setPending(prev => { prev.forEach(p => p.preview && URL.revokeObjectURL(p.preview)); return []; });
        setTimeout(() => titleRef.current?.focus(), 30);
      } else {
        toast(isEdit ? (becomingDone ? 'Task completed' : 'Changes saved') : 'Task created');
        onSaved?.(saved);
        onClose();
      }
    } catch (e) {
      fail(e.message || 'Couldn’t save the task.');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    setSaving(true);
    const { error: err } = await supabase.from('tasks').delete().eq('id', task.id);
    setSaving(false);
    if (err) { setConfirmDelete(false); fail(err.message); return; }
    await supabase.from('queue').delete().eq('task_id', task.id);
    tasksChanged(); queueChanged();
    toast('Task deleted');
    onSaved?.(null);
    onClose();
  };

  const toggleQueue = async (on) => {
    if (on) {
      const { data: pos } = await supabase.from('queue').select('position').eq('team_id', activeTeamId)
        .order('position', { ascending: false }).limit(1);
      const { data } = await supabase.from('queue')
        .insert({ task_id: task.id, team_id: activeTeamId, position: (pos?.[0]?.position || 0) + 1 }).select('id').single();
      setQueueRow(data || { id: 'x' });
      toast('Added to your queue');
    } else {
      await supabase.from('queue').delete().eq('task_id', task.id);
      setQueueRow(null);
      toast('Removed from your queue');
    }
    queueChanged();
  };

  const close = () => { if (batchCount) onSaved?.(); onClose(); };

  const statusOptions = useMemo(() => (form.status === 'critical'
    ? [{ value: 'critical', label: 'Critical' }, ...STATUSES] : STATUSES), [form.status]);

  const creator = isEdit && users.find(u => u.id === task.created_by);
  const noticedPerson = users.find(u => fullName(u) === form.noticed_by);

  const footNote = !isEdit
    ? (form.status === 'completed' ? 'Lands in Completed' : `Lands in ${STATUS_LABEL[form.status] || 'Open'}${addToQueue ? ' and joins your queue' : ''}`)
      + (batchCount ? ` · ${batchCount} added` : '')
    : (task.updated_at ? `Edited ${ago(task.updated_at)}` : '');

  const attachmentsBlock = (
    <>
      {(existing.length > 0 || pending.length > 0) && (
        <div className="attach-grid ts-attach">
          {existing.map((a, i) => (
            <div key={`e${i}`} className="attach">
              {a.kind === 'image'
                ? <img src={a.url} alt={a.name} className="attach-thumb" onClick={() => setPreview(a.url)} />
                : <a href={a.url} target="_blank" rel="noreferrer" className="attach-file"><span className="file-badge">{KIND_LABEL[a.kind] || 'FILE'}</span></a>}
              <span className="attach-name">{a.name}</span>
              <button type="button" className="attach-x" onClick={() => setExisting(x => x.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" size={11} /></button>
            </div>
          ))}
          {pending.map(p => (
            <div key={p.id} className="attach">
              {p.fetching
                ? <div className="attach-file"><span className="spinner spinner-sm" /></div>
                : p.kind === 'image'
                  ? <img src={p.preview} alt={p.name} className="attach-thumb" onClick={() => setPreview(p.preview)} />
                  : <div className="attach-file"><span className="file-badge">{KIND_LABEL[p.kind] || 'FILE'}</span>{fmtBytes(p.size)}</div>}
              <span className="attach-name">{p.fetching ? 'Fetching…' : p.name}</span>
              <button type="button" className="attach-x" onClick={() => removePending(p.id)} aria-label="Remove"><Icon name="x" size={11} /></button>
            </div>
          ))}
        </div>
      )}
      <Dropzone
        onFiles={addFiles}
        accept={ACCEPT}
        title={isEdit ? 'Upload or paste a screenshot' : 'Attach files or paste'}
        sub={isEdit ? 'PNG, JPG, WebP, PDF · 6 MB total' : 'Optional'}
      />
    </>
  );

  const eyebrow = isEdit ? (
    <>
      <span>Task</span>
      <span className={`dot dot-${task.status}`} />
      <span>{STATUS_LABEL[task.status] || task.status}</span>
      <span className="t-4 mono">#{String(task.id).slice(0, 8)}</span>
    </>
  ) : (
    <>
      <span>New task</span>
      <span className="t-4">·</span>
      <span className="t-4">{batchCount ? `Batch · ${batchCount} added` : 'Draft'}</span>
    </>
  );

  return (
    <>
      <Sheet
        eyebrow={eyebrow}
        onClose={close}
        onSubmit={submit}
        onPaste={onPaste}
        {...dnd}
        className={dragOver ? 'ts-dragging' : ''}
        aside={(
          <>
            <div>
              <SheetLabel>Status</SheetLabel>
              <StatusPicker value={form.status} onChange={v => set('status', v)} options={statusOptions} />
            </div>
            <div>
              <SheetLabel>ROI</SheetLabel>
              <Segmented value={form.roi} onChange={v => set('roi', v)} options={ROIS} ariaLabel="ROI" />
            </div>
            <div>
              <SheetLabel>Complexity</SheetLabel>
              <Segmented value={form.complexity} onChange={v => set('complexity', v)} options={COMPLEXITIES} ariaLabel="Complexity" />
            </div>
            {!isEdit && !isGuest && (
              <div className="ts-checks">
                {form.status !== 'completed' && (
                  <CheckRow checked={addToQueue} onChange={setAddToQueue} title="Add to queue" desc="Shows up in your focus suggestions" />
                )}
                <CheckRow checked={batch} onChange={setBatch} title="Batch add" desc="Keep this open and reuse page + settings" />
              </div>
            )}
            {isEdit && !isGuest && queueRow !== undefined && task.status !== 'completed' && (
              <div className="ts-checks">
                <CheckRow checked={!!queueRow} onChange={toggleQueue} title="In your queue" desc="Up next in Current focus" />
              </div>
            )}
            <div className="sheet-aside-sep" />
            <div className="meta ts-meta">
              <span className="meta-k">Noticed by</span>
              <span className="meta-v">
                {form.noticed_by && <Avatar person={noticedPerson} name={form.noticed_by} size={22} />}
                <input
                  className="ts-meta-input"
                  value={form.noticed_by}
                  onChange={e => set('noticed_by', e.target.value)}
                  placeholder="Who noticed it?"
                  list="ts-people"
                />
                <datalist id="ts-people">{users.map(u => <option key={u.id} value={fullName(u)} />)}</datalist>
              </span>
              {!isGuest && (
                <>
                  <span className="meta-k">Assignee</span>
                  <span className="meta-v"><AssigneeSelect variant="inline" users={users} value={form.assignee_id} onChange={id => set('assignee_id', id)} /></span>
                  <span className="meta-k">Due date</span>
                  <span className="meta-v"><DatePicker variant="inline" value={form.due_date} onChange={d => set('due_date', d || '')} completed={form.status === 'completed'} /></span>
                </>
              )}
              {isEdit && (
                <>
                  <span className="meta-k">Posted</span>
                  <span className="meta-v mono">{longDate(task.date_received || task.created_at)}</span>
                  {task.status === 'completed' && task.date_completed && (
                    <>
                      <span className="meta-k">Completed</span>
                      <span className="meta-v mono">{longDate(task.date_completed)}</span>
                    </>
                  )}
                </>
              )}
            </div>
            {!isEdit && attachmentsBlock}
            {isEdit && (
              <>
                <div className="sheet-aside-sep" />
                <div>
                  <SheetLabel>Activity</SheetLabel>
                  <div className="ts-activity stagger">
                    <div className="ts-act">
                      <Avatar person={creator || null} name={creator ? fullName(creator) : (task.noticed_by || 'Someone')} size={24} />
                      <div>
                        <div><b>{creator ? fullName(creator) : (task.noticed_by || 'Someone')}</b> created this task</div>
                        <div className="ts-act-when">{shortDate(task.date_received || task.created_at)}</div>
                      </div>
                    </div>
                    {task.status === 'completed' && task.completed_by && (
                      <div className="ts-act">
                        <span className="ts-act-ico is-ok"><Icon name="check" size={12} stroke={2.6} /></span>
                        <div>
                          <div><b>{task.completed_by}</b> completed it</div>
                          <div className="ts-act-when">{shortDate(task.date_completed)}</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        )}
        footer={(
          <>
            {isEdit && !isGuest && (
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>Delete</button>
            )}
            <span className="sheet-foot-note">{footNote}</span>
            <span className="spacer" />
            {error && <span key={errKey} className="field-error wiggle ts-err">{error}</span>}
            <button type="button" className="btn btn-ghost" onClick={close}>{batchCount ? 'Done' : 'Cancel'}</button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={saving}>
              {saving ? <span className="spinner" /> : null}
              {isEdit ? 'Save changes' : batch ? 'Create & add another' : 'Create task'}
              <span className="kbd">⌘↵</span>
            </button>
          </>
        )}
      >
        <textarea
          ref={titleRef}
          className="title-input"
          rows={1}
          placeholder="What needs to be fixed?"
          value={form.title}
          onChange={e => set('title', e.target.value.replace(/\n/g, ' '))}
        />
        <div className="link-field ts-page">
          <Icon name="link" size={15} />
          <input
            value={form.page}
            onChange={e => set('page', e.target.value)}
            placeholder="Page name or URL, e.g. Checkout or https://example.com/page"
          />
          {isUrl(form.page) && (
            <a className="link-open" href={form.page.trim()} target="_blank" rel="noreferrer">Open <Icon name="arrowUpRight" size={12} /></a>
          )}
        </div>
        <div className="ts-body">
          <FeedbackEditor value={form.feedback} onChange={v => set('feedback', v)} />
        </div>
        <div className="ts-bottom">
          <SubtaskEditor value={form.subtasks} onChange={v => set('subtasks', v)} />
          {isEdit && attachmentsBlock}
        </div>
        {dragOver && <div className="ts-drop"><Icon name="upload" size={22} /><span>Drop to attach</span></div>}
      </Sheet>

      {completeAsk && (
        <Dialog
          title="Who completed it?"
          text="Credit everyone who worked on this task."
          onClose={() => setCompleteAsk(false)}
          footer={(
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setCompleteAsk(false)}>Cancel</button>
              <button
                type="button" className="btn btn-primary" disabled={!completedBy.length || saving}
                onClick={() => { setCompleteAsk(false); save({ completed_by: completedBy.join(', ') }); }}
              >
                Mark complete
              </button>
            </>
          )}
        >
          <div className="ts-people stagger">
            {users.map(u => {
              const name = fullName(u);
              const on = completedBy.includes(name);
              return (
                <button key={u.id} type="button" className={`ts-person ${on ? 'is-on' : ''}`}
                  onClick={() => setCompletedBy(p => (p.includes(name) ? p.filter(n => n !== name) : [...p, name]))}>
                  <Avatar person={u} size={28} />
                  <span className="truncate" style={{ flex: 1 }}>{name}</span>
                  <span className={`check-round ${on ? 'is-on' : ''}`} />
                </button>
              );
            })}
          </div>
        </Dialog>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this task?"
          text="It’s removed for the whole team. This can’t be undone."
          confirmLabel="Delete task"
          danger busy={saving}
          onConfirm={doDelete}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {preview && <Lightbox src={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
