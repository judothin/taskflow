import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { awardTaskCreatedXp, awardTaskCompletedXp } from '../lib/xp';
import { bumpTeamStreak } from '../lib/streak';
import Avatar from './Avatar';
import AssigneeSelect from './AssigneeSelect';
import DatePicker from './DatePicker';
import FeedbackEditor from './FeedbackEditor';
import SubtaskEditor from './SubtaskEditor';
import { asSubtasks } from '../lib/subtasks';
import ModalPortal from './ModalPortal';

// Run once in Supabase:
// alter table tasks add column if not exists attachments jsonb default '[]'::jsonb;

const STATUSES = ['open', 'in_progress', 'on_hold', 'completed'];
const ROIS = ['critical', 'high', 'medium', 'low'];
const COMPLEXITIES = ['high', 'medium', 'low'];

const MAX_TOTAL_BYTES = 6 * 1024 * 1024; // 6 MB

const ACCEPT = 'image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.csv,.zip';
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'csv', 'zip'];

// Type allowlist shared by picker / paste / drop.
function isAllowedFile(file) {
  if ((file.type || '').startsWith('image/')) return true;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return ALLOWED_EXT.includes(ext);
}

let _pidSeq = 0;
const nextPendingId = () => `pf_${Date.now().toString(36)}_${_pidSeq++}`;

function filenameFromUrl(u) {
  try {
    const last = decodeURIComponent(new URL(u).pathname.split('/').pop() || '');
    return last || '';
  } catch { return ''; }
}

// Server-fetch a CORS-less remote image (deep link) via our own endpoint,
// returning a File for the normal upload pipeline.
async function fetchRemoteImage(url) {
  const res = await fetch(`/api/fetch-attachment?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`fetch failed (${res.status})`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error('not an image');
  const name = filenameFromUrl(url) || `attachment-${Date.now()}.png`;
  return new File([blob], name, { type: blob.type });
}

function getFileKind(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (['png','jpg','jpeg','webp','gif','svg','avif'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (['doc','docx'].includes(ext)) return 'word';
  if (['ppt','pptx'].includes(ext)) return 'pptx';
  if (['xls','xlsx','csv'].includes(ext)) return 'excel';
  return 'file';
}

function FileIcon({ kind, size = 13 }) {
  const icons = {
    pdf:   { color: '#f87171', label: 'PDF' },
    word:  { color: '#60a5fa', label: 'DOC' },
    pptx:  { color: '#fb923c', label: 'PPT' },
    excel: { color: '#4ade80', label: 'XLS' },
    file:  { color: 'var(--text-dim)', label: 'FILE' },
  };
  const meta = icons[kind] || icons.file;
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, fontFamily: 'var(--mono)',
      background: `${meta.color}22`, color: meta.color,
      border: `1px solid ${meta.color}44`, borderRadius: 3,
      padding: '2px 5px', flexShrink: 0, lineHeight: 1.4,
    }}>
      {meta.label}
    </span>
  );
}

function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

function initExisting(task) {
  if (task?.attachments?.length) return task.attachments;
  if (task?.png_url) return [{ url: task.png_url, name: 'screenshot.png', kind: 'image' }];
  return [];
}

// Convert plain text (e.g. a deep-linked comment body, which may have newlines
// and image URLs on their own lines) into safe HTML for the rich feedback
// editor: escape all markup so nothing injects, keep line breaks.
function plainToHtml(text) {
  const esc = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return esc.split(/\r?\n/).join('<br>');
}

export default function TaskForm({ task, onClose, onSaved, isGuest = false, users = [], projects = [], defaultProjectId = '', prefill = null }) {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const isEdit = !!task;
  const fileRef = useRef();

  // New tasks default "Noticed By" to the signed-in user's full name (editable).
  const defaultNoticedBy = (!isGuest && profile)
    ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
    : '';

  // Deep-link prefill only applies to a brand-new task (never when editing).
  const seed = (!isEdit && prefill) ? prefill : null;

  const [form, setForm] = useState({
    status:     task?.status     || 'open',
    page:       task?.page       || seed?.page || '',
    feedback:   task?.feedback   || (seed?.feedback ? plainToHtml(seed.feedback) : ''),
    noticed_by: task?.noticed_by || (seed?.noticed || defaultNoticedBy),
    roi:        task?.roi        || 'medium',
    complexity: task?.complexity || 'medium',
    project_id: task?.project_id || defaultProjectId || '',
    assignee_id: task?.assignee_id || '',
    due_date:   task?.due_date    || '',
    subtasks:   asSubtasks(task?.subtasks),
  });

  // existing = already-uploaded attachments from DB
  // pending  = new files chosen by the user, not yet uploaded
  const [existing, setExisting]   = useState(() => initExisting(task));
  const [pending,  setPending]    = useState([]);
  const [dragOver, setDragOver]   = useState(false);
  const [fetchFailCount, setFetchFailCount] = useState(0);
  const dragDepth = useRef(0);
  const [addToQueue, setAddToQueue] = useState(false);
  const [batchAdd,   setBatchAdd]   = useState(false);
  const [batchCount, setBatchCount] = useState(0);
  const [error,        setError]        = useState('');
  const [saving,       setSaving]       = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completedBy, setCompletedBy]   = useState([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Closing after a batch: make the parent refetch once. List views already got
  // the live `tasks-changed` event on each save, but callers that only refresh
  // via onSaved need this single call so the tasks added this session show up.
  const handleClose = () => {
    if (batchCount > 0) onSaved?.();
    onClose();
  };

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // Total bytes across all pending files
  const pendingBytes = pending.reduce((s, p) => s + p.file.size, 0);

  // Single entry point for the file picker, paste, and drag-drop. Enforces the
  // type allowlist + 6 MB total cap and dedupes by name+size.
  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []).filter(Boolean);
    if (!incoming.length) return;

    let bytes = pending.reduce((s, p) => s + (p.size || 0), 0);
    const accepted = [];
    let over = false, badType = false;

    for (const file of incoming) {
      if (!isAllowedFile(file)) { badType = true; continue; }
      const dup = (arr) => arr.some(p => p.name === file.name && p.size === file.size);
      if (dup(pending) || dup(accepted)) continue;            // dedupe silently
      if (bytes + file.size > MAX_TOTAL_BYTES) { over = true; continue; }
      bytes += file.size;
      const kind = getFileKind(file.name);
      accepted.push({
        id: nextPendingId(), file, kind,
        preview: kind === 'image' ? URL.createObjectURL(file) : null,
        name: file.name, size: file.size,
      });
    }

    if (accepted.length) setPending(prev => [...prev, ...accepted]);
    if (over) setError('Total attachment size would exceed 6 MB — some files were skipped.');
    else if (badType && !accepted.length) setError('That file type isn’t supported.');
    else if (accepted.length) setError('');
  };

  const handleFiles = (e) => {
    addFiles(e.target.files);
    if (fileRef.current) fileRef.current.value = '';
  };

  // Ctrl/Cmd+V of an image anywhere in the modal → attach it. Screenshot tools
  // give a nameless image blob, so we generate one. If the paste also carries
  // text, we take only the image (and stop it landing in the feedback field).
  const handlePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const imgs = items.filter(it => it.kind === 'file' && (it.type || '').startsWith('image/'));
    if (!imgs.length) return; // plain text paste — let it flow to the field
    e.preventDefault();
    const files = imgs.map(it => {
      const f = it.getAsFile();
      if (!f) return null;
      if (f.name && f.name !== 'image.png') return f;
      const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
      return new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type });
    }).filter(Boolean);
    addFiles(files);
  };

  // Drag-drop anywhere over the modal. A depth counter avoids the highlight
  // flickering as the pointer crosses child elements.
  const handleDragEnter = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragOver(true);
  };
  const handleDragOver = (e) => {
    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragOver(false);
  };
  const handleDrop = (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const removePending = (id) => {
    setPending(prev => {
      const target = prev.find(p => p.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter(p => p.id !== id);
    });
  };

  // Deep-link attachments (?attachments=url1|url2). Show a fetching chip per
  // URL immediately, download each server-side (bypasses the dev site's
  // missing CORS), then swap in the real file — or drop the chip and count a
  // failure. Runs once for a brand-new task.
  useEffect(() => {
    const urls = (seed?.attachments || []).slice(0, 10);
    if (!urls.length) return undefined;
    let alive = true;

    const placeholders = urls.map(url => ({
      id: nextPendingId(), file: null, kind: 'image', preview: null,
      name: filenameFromUrl(url) || 'image', size: 0, fetching: true,
    }));
    setPending(prev => [...prev, ...placeholders]);

    urls.forEach((url, i) => {
      const phId = placeholders[i].id;
      fetchRemoteImage(url).then(file => {
        if (!alive) return;
        setPending(prev => {
          const bytes = prev.reduce((s, p) => s + (p.size || 0), 0);
          if (bytes + file.size > MAX_TOTAL_BYTES) {           // over the 6 MB cap
            setFetchFailCount(c => c + 1);
            return prev.filter(p => p.id !== phId);
          }
          return prev.map(p => (p.id === phId
            ? { id: phId, file, kind: 'image', preview: URL.createObjectURL(file), name: file.name, size: file.size, fetching: false }
            : p));
        });
      }).catch(() => {
        if (!alive) return;
        setPending(prev => prev.filter(p => p.id !== phId));
        setFetchFailCount(c => c + 1);
      });
    });

    return () => { alive = false; };
  }, []);

  const removeExisting = (i) => setExisting(prev => prev.filter((_, idx) => idx !== i));

  const uploadAll = async () => {
    const uploaded = [...existing];
    for (const p of pending) {
      if (!p.file) continue; // still-fetching deep-link placeholder
      const ext = p.file.name.split('.').pop();
      const path = `tasks/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('task-images').upload(path, p.file, {
        contentType: p.file.type || 'application/octet-stream',
        upsert: false,
      });
      if (upErr) throw new Error(`Couldn't upload "${p.file.name}": ${upErr.message}`);
      const { data } = supabase.storage.from('task-images').getPublicUrl(path);
      uploaded.push({ url: data.publicUrl, name: p.file.name, kind: p.kind });
    }
    return uploaded;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.feedback || !form.feedback.replace(/<[^>]*>/g, '').trim()) {
      setError('Feedback / Issue is required.');
      return;
    }
    if (!isGuest && form.status === 'completed' && (!task || task.status !== 'completed')) {
      setShowCompleteModal(true);
      return;
    }
    await save();
  };

  // Batch add: prime the form for the next task, carrying Page + Project (and
  // the rest of the meta) forward and clearing only the per-task content.
  const resetForNextBatch = () => {
    setForm(f => ({ ...f, feedback: '', subtasks: [] }));
    setExisting([]);
    setPending(prev => { prev.forEach(p => p.preview && URL.revokeObjectURL(p.preview)); return []; });
    setCompletedBy([]);
    setError('');
  };

  const save = async (overrides = {}) => {
    setSaving(true);
    try {
      const attachments = await uploadAll();
      const firstImage = attachments.find(a => a.kind === 'image');

      const payload = {
        ...form,
        ...overrides,
        attachments,
        png_url: firstImage?.url || null,
        project_id: form.project_id || null,
        assignee_id: form.assignee_id || null,
        due_date: form.due_date || null,
        updated_at: new Date().toISOString(),
      };

      if (!isEdit) {
        payload.date_received = new Date().toISOString();
        payload.team_id = activeTeamId;
        if (!isGuest) payload.created_by = user?.id;
      }
      if (payload.status === 'completed' && (!task || task.status !== 'completed')) {
        payload.date_completed = new Date().toISOString();
      }

      let result;
      if (isEdit) {
        result = await supabase.from('tasks').update(payload).eq('id', task.id).select().single();
      } else {
        result = await supabase.from('tasks').insert(payload).select().single();
      }
      if (result.error) throw result.error;

      const isBeingCompleted    = payload.status === 'completed' && (!task || task.status !== 'completed');
      const isLeavingInProgress = task?.status === 'in_progress' && (payload.status === 'on_hold' || payload.status === 'open');

      if (!isEdit && !isGuest) awardTaskCreatedXp(user?.id);
      if (isBeingCompleted && !isGuest) awardTaskCompletedXp(user?.id, payload.complexity, { roi: payload.roi, status: task?.status });
      if ((!isEdit || isBeingCompleted) && !isGuest) bumpTeamStreak(activeTeamId);

      if (!isEdit && !isGuest && addToQueue && payload.status !== 'completed') {
        const { data: positions } = await supabase
          .from('queue').select('position').eq('team_id', activeTeamId).order('position', { ascending: false }).limit(1);
        const maxPos = positions && positions.length > 0 ? positions[0].position : 0;
        await supabase.from('queue').insert({ task_id: result.data.id, team_id: activeTeamId, position: maxPos + 1 });
        window.dispatchEvent(new CustomEvent('queue-changed'));
      }

      if (isBeingCompleted || isLeavingInProgress) {
        if (isBeingCompleted) await supabase.from('queue').delete().eq('task_id', result.data.id);
        const { data: nextItems } = await supabase.from('queue').select('id, task_id')
          .eq('team_id', activeTeamId).order('position').limit(1);
        if (nextItems?.length) {
          const next = nextItems[0];
          await Promise.all([
            supabase.from('tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', next.task_id),
            supabase.from('queue').delete().eq('id', next.id),
          ]);
        }
        window.dispatchEvent(new CustomEvent('queue-changed'));
      }

      window.dispatchEvent(new CustomEvent('tasks-changed'));

      if (!isEdit && batchAdd) {
        // Keep the modal open and set up the next entry. The list refreshes via
        // the `tasks-changed` event above; we deliberately skip onSaved here
        // because some callers close the modal from it (it fires on close).
        setBatchCount(c => c + 1);
        resetForNextBatch();
      } else {
        onSaved?.(result.data);
        onClose();
      }
    } catch (err) {
      setError(err.message || 'Failed to save task');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
      onSaved?.(null);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to delete task');
      setSaving(false);
    }
  };

  const handleCompleteConfirm = async () => {
    setShowCompleteModal(false);
    await save({ completed_by: completedBy.join(', ') });
  };

  const totalBytes = pendingBytes;
  const pct = Math.min((totalBytes / MAX_TOTAL_BYTES) * 100, 100);
  const hasFiles = existing.length > 0 || pending.length > 0;

  return (
    <>
      <ModalPortal>
      <div className="modal-overlay">
        <div
          className="modal"
          onPaste={handlePaste}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {dragOver && (
            <div className="attach-dropzone">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12"/>
              </svg>
              <span>Drop to attach</span>
            </div>
          )}
          <div className="modal-header">
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>
              {isEdit ? 'Edit Task' : 'Create Task'}
            </h2>
            <button onClick={handleClose} className="btn btn-ghost btn-sm">✕</button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'contents' }}>
            <div className="modal-body">
              <div className="form-grid" style={{ gap: 12 }}>

                {!isGuest && (
                  <div className="form-group">
                    <label className="label">Status</label>
                    <select className="input" value={form.status} onChange={set('status')}>
                      <option value="critical">Critical</option>
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="on_hold">On Hold</option>
                      <option value="completed">Completed</option>
                    </select>
                  </div>
                )}

                {!isGuest && !isEdit && form.status !== 'completed' && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={addToQueue}
                      onChange={(e) => setAddToQueue(e.target.checked)}
                      className="editor-cb"
                    />
                    Add to queue
                  </label>
                )}

                {!isGuest && !isEdit && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 500, color: 'var(--text)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={batchAdd}
                      onChange={(e) => setBatchAdd(e.target.checked)}
                      className="editor-cb"
                    />
                    Batch add
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>
                      — keep open &amp; reuse Page + Project for the next
                    </span>
                    {batchCount > 0 && (
                      <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-glow)', padding: '1px 8px', borderRadius: 999 }}>
                        {batchCount} added
                      </span>
                    )}
                  </label>
                )}

                <div className="form-group">
                  <label className="label">Page <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>— name or URL (auto-detected)</span></label>
                  <input className="input" placeholder="e.g. Checkout, or https://example.com/page" value={form.page} onChange={set('page')} required />
                </div>

                <div className="form-group">
                  <label className="label">Feedback / Issue</label>
                  <FeedbackEditor
                    value={form.feedback}
                    onChange={(v) => setForm(f => ({ ...f, feedback: v }))}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Subtasks <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>— checklist, progress shows on the card</span></label>
                  <SubtaskEditor
                    value={form.subtasks}
                    onChange={(v) => setForm(f => ({ ...f, subtasks: v }))}
                  />
                </div>

                <div className="form-group">
                  <label className="label">Noticed By</label>
                  <input className="input" placeholder="Who noticed or requested this?" value={form.noticed_by} onChange={set('noticed_by')} required />
                </div>

                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="label">ROI</label>
                    <select className="input" value={form.roi} onChange={set('roi')}>
                      <option value="critical">Critical</option>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Complexity</label>
                    <select className="input" value={form.complexity} onChange={set('complexity')}>
                      <option value="high">High</option>
                      <option value="medium">Medium</option>
                      <option value="low">Low</option>
                    </select>
                  </div>
                </div>

                {!isGuest && (
                  <div className="form-grid form-grid-2">
                    {projects.length > 0 && (
                      <div className="form-group">
                        <label className="label">Project <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>optional</span></label>
                        <select className="input" value={form.project_id} onChange={set('project_id')}>
                          <option value="">No project</option>
                          {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.title}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {users.length > 0 && (
                      <div className="form-group">
                        <label className="label">Assignee <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>optional</span></label>
                        <AssigneeSelect
                          users={users}
                          value={form.assignee_id}
                          onChange={(id) => setForm(f => ({ ...f, assignee_id: id }))}
                        />
                      </div>
                    )}

                    <div className="form-group">
                      <label className="label">Due Date <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>optional</span></label>
                      <DatePicker
                        value={form.due_date}
                        onChange={(d) => setForm(f => ({ ...f, due_date: d }))}
                      />
                    </div>
                  </div>
                )}

                {/* ── Attachments ── */}
                <div className="form-group">
                  <label className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span>Attachments</span>
                    {pending.length > 0 && (
                      <span style={{ fontSize: 11, fontWeight: 500, color: pct > 85 ? '#f87171' : 'var(--text-dim)', fontFamily: 'var(--mono)', textTransform: 'none', letterSpacing: 0 }}>
                        {fmtBytes(totalBytes)} / 6 MB
                      </span>
                    )}
                  </label>

                  {hasFiles && (
                    <div className="attach-list">
                      {existing.map((a, i) => (
                        <div key={`ex-${i}`} className="attach-item">
                          {a.kind === 'image'
                            ? <img src={a.url} alt={a.name} className="attach-thumb" />
                            : <FileIcon kind={a.kind} />
                          }
                          <span className="attach-name">{a.name}</span>
                          <button type="button" className="attach-remove" onClick={() => removeExisting(i)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                      {pending.map((p) => (
                        <div key={p.id} className="attach-item attach-item-new">
                          {p.fetching
                            ? <span className="attach-spinner" aria-label="Fetching" />
                            : p.kind === 'image'
                              ? <img src={p.preview} alt={p.name} className="attach-thumb" />
                              : <FileIcon kind={p.kind} />
                          }
                          <span className="attach-name">{p.name}</span>
                          <span className="attach-size">{p.fetching ? 'Fetching…' : fmtBytes(p.size)}</span>
                          <button type="button" className="attach-remove" onClick={() => removePending(p.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    className="attach-add-btn"
                    onClick={() => fileRef.current?.click()}
                    disabled={totalBytes >= MAX_TOTAL_BYTES}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41A2 2 0 016.59 14.59L15.78 5.4"/>
                    </svg>
                    {hasFiles ? 'Add more files' : 'Attach files'}
                    <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>· or paste / drop them here</span>
                  </button>
                  {fetchFailCount > 0 && (
                    <div style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>
                      {fetchFailCount} attachment{fetchFailCount !== 1 ? "s couldn't" : " couldn't"} be fetched.
                    </div>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept={ACCEPT}
                    multiple
                    onChange={handleFiles}
                    style={{ display: 'none' }}
                  />
                </div>

                {error && <div className="error-msg">⚠ {error}</div>}
              </div>
            </div>

            <div className="modal-footer">
              {isEdit && !confirmDelete && (
                <button type="button" onClick={() => setConfirmDelete(true)} className="btn btn-danger btn-sm" style={{ marginRight: 'auto' }}>
                  Delete
                </button>
              )}
              {isEdit && confirmDelete && (
                <div style={{ marginRight: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Delete this task?</span>
                  <button type="button" onClick={handleDelete} className="btn btn-danger btn-sm" disabled={saving}>Yes, delete</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} className="btn btn-ghost btn-sm">Cancel</button>
                </div>
              )}
              {!confirmDelete && <button type="button" onClick={handleClose} className="btn btn-ghost">{batchCount > 0 ? 'Done' : 'Cancel'}</button>}
              {!confirmDelete && (
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : isEdit ? 'Save Changes' : (batchAdd ? 'Create & add another' : 'Create Task')}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
      </ModalPortal>

      {showCompleteModal && (
        <ModalPortal>
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal" style={{ maxWidth: 400 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 18, fontWeight: 700 }}>Mark as Complete</h2>
            </div>
            <div className="modal-body">
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
                Who completed this task?
              </p>
              <div className="form-group">
                <label className="label">
                  Completed By
                  {completedBy.length > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent)', background: 'var(--accent-glow)', padding: '1px 7px', borderRadius: 3 }}>
                      {completedBy.length} selected
                    </span>
                  )}
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '6px 4px' }}>
                  {users.map(u => {
                    const name = `${u.first_name} ${u.last_name}`;
                    const checked = completedBy.includes(name);
                    return (
                      <label key={u.id} className={`complete-person-row ${checked ? 'complete-person-row-checked' : ''}`} style={{ margin: '0 2px' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setCompletedBy(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name])}
                          className="complete-person-checkbox"
                        />
                        <Avatar src={u.avatar_url} color={u.color || '#6366f1'} initials={`${u.first_name[0]}${u.last_name[0]}`} size={28} style={{ flexShrink: 0 }} />
                        <span className="complete-person-name">{u.first_name} {u.last_name}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCompleteModal(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleCompleteConfirm} className="btn btn-primary" disabled={!completedBy.length}>
                Confirm Complete
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}
