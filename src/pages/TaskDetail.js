import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO, isBefore, startOfToday } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { awardTaskCompletedXp } from '../lib/xp';
import { bumpTeamStreak } from '../lib/streak';
import Avatar from '../components/Avatar';
import AssigneeSelect from '../components/AssigneeSelect';
import DatePicker from '../components/DatePicker';
import FeedbackEditor from '../components/FeedbackEditor';
import SubtaskEditor from '../components/SubtaskEditor';
import { asSubtasks } from '../lib/subtasks';
import TaskAttachments from '../components/TaskAttachments';
import ModalPortal from '../components/ModalPortal';
import '../components/TaskCard.css';
import './TaskDetail.css';

const STATUS_MAP = {
  critical:    { label: 'Critical',    cls: 'badge-critical' },
  open:        { label: 'Open',        cls: 'badge-open' },
  in_progress: { label: 'In Progress', cls: 'badge-inprogress' },
  on_hold:     { label: 'On Hold',     cls: 'badge-onhold' },
  completed:   { label: 'Completed',   cls: 'badge-completed' },
};

const ROI_MAP = {
  critical: 'badge-critical',
  high:     'badge-high',
  medium:   'badge-medium',
  low:      'badge-low',
};

export default function TaskDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const fileRef = useRef();

  const [task, setTask]             = useState(null);
  const [form, setForm]             = useState(null);
  const [users, setUsers]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [error, setError]           = useState('');
  const [saved, setSaved]           = useState(false);
  const [imageFile, setImageFile]   = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [imgZoom, setImgZoom]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const fetchTask = useCallback(async () => {
    const { data, error: err } = await supabase.from('tasks').select('*').eq('id', id).single();
    if (err || !data) { navigate('/tasks'); return; }
    setTask(data);
    setForm({
      status:     data.status     || 'open',
      page:       data.page       || '',
      feedback:   data.feedback   || '',
      noticed_by: data.noticed_by || '',
      roi:        data.roi        || 'medium',
      complexity: data.complexity || 'medium',
      png_url:    data.png_url    || null,
      assignee_id: data.assignee_id || '',
      due_date:   data.due_date    || '',
      subtasks:   asSubtasks(data.subtasks),
    });
    setImagePreview(data.png_url || null);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  useEffect(() => {
    if (!activeTeamId) return;
    fetchTeamMembers(activeTeamId).then(setUsers);
  }, [activeTeamId]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { setError('Image cannot exceed 1MB.'); fileRef.current.value = ''; return; }
    setError('');
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async () => {
    if (!imageFile) return form.png_url;
    const ext = imageFile.name.split('.').pop();
    const path = `tasks/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('task-images').upload(path, imageFile);
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('task-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSave = async () => {
    if (!form.feedback || !form.feedback.replace(/<[^>]*>/g, '').trim()) {
      setError('Feedback / Issue is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const png_url = await uploadImage();
      const payload = { ...form, png_url, assignee_id: form.assignee_id || null, due_date: form.due_date || null, updated_at: new Date().toISOString() };
      const isBeingCompleted = payload.status === 'completed' && task.status !== 'completed';
      if (isBeingCompleted) {
        payload.date_completed = new Date().toISOString();
      }
      const { error: saveError } = await supabase.from('tasks').update(payload).eq('id', id);
      if (saveError) throw saveError;
      if (isBeingCompleted) { awardTaskCompletedXp(user?.id, payload.complexity, { roi: payload.roi, status: task.status }); bumpTeamStreak(activeTeamId); }
      setTask(t => ({ ...t, ...payload }));
      setImageFile(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (err) {
      setError(err.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    const { error: delErr } = await supabase.from('tasks').delete().eq('id', id);
    if (delErr) { setError(delErr.message); setSaving(false); return; }
    navigate('/tasks');
  };

  if (loading || !form) {
    return <div className="detail-loading">Loading...</div>;
  }

  const status = STATUS_MAP[form.status] || STATUS_MAP.open;

  return (
    <div className="task-detail-page">

      {/* ── Header ── */}
      <div className="task-detail-header">
        <button onClick={() => navigate(-1)} className="btn btn-ghost btn-sm detail-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back
        </button>

        <div className="task-detail-header-center">
          <span className={`badge ${status.cls}`}>{status.label}</span>
          <span className="task-detail-title">{task.page || 'Untitled'}</span>
          <span className="task-detail-id">#{id.slice(0, 8)}</span>
        </div>

        <div className="task-detail-header-actions">
          {confirmDelete ? (
            <>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Delete this task?</span>
              <button onClick={handleDelete} className="btn btn-danger btn-sm" disabled={saving}>Yes, delete</button>
              <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost btn-sm">Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => setConfirmDelete(true)} className="btn btn-danger btn-sm">Delete</button>
              <button onClick={handleSave} className="btn btn-primary btn-sm" disabled={saving}>
                {saved ? '✓ Saved' : saving ? 'Saving…' : 'Save Changes'}
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="error-msg detail-error">⚠ {error}</div>
      )}

      {/* ── Body ── */}
      <div className="task-detail-body">

        {/* Left: editable fields */}
        <div className="task-detail-fields">

          <div className="form-grid form-grid-2">
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
            <div className="form-group">
              <label className="label">Page / URL</label>
              <input className="input" value={form.page} onChange={set('page')} placeholder="e.g. Checkout" />
            </div>
          </div>

          <div className="form-group">
            <label className="label">Feedback / Issue</label>
            <FeedbackEditor
              value={form.feedback}
              onChange={(v) => setForm(f => ({ ...f, feedback: v }))}
            />
          </div>

          <div className="form-group">
            <label className="label">Subtasks</label>
            <SubtaskEditor
              value={form.subtasks}
              onChange={(v) => setForm(f => ({ ...f, subtasks: v }))}
            />
          </div>

          <div className="form-group">
            <label className="label">Noticed By</label>
            <input className="input" value={form.noticed_by} onChange={set('noticed_by')} placeholder="Who noticed this?" />
          </div>

          <div className="form-grid form-grid-2">
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

          {/* Metadata */}
          <div className="task-detail-meta">
            <div className="task-detail-meta-row">
              <span className="task-detail-meta-label">ROI</span>
              <span className={`badge ${ROI_MAP[form.roi] || ''}`}>{form.roi}</span>
            </div>
            <div className="task-detail-meta-row">
              <span className="task-detail-meta-label">Complexity</span>
              <span className="badge badge-complexity">{form.complexity}</span>
            </div>
            {(() => {
              const assignee = users.find(u => u.id === form.assignee_id);
              return assignee ? (
                <div className="task-detail-meta-row">
                  <span className="task-detail-meta-label">Assignee</span>
                  <span className="task-detail-meta-val" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Avatar
                      src={assignee.avatar_url}
                      color={assignee.color || '#6366f1'}
                      initials={`${assignee.first_name[0]}${assignee.last_name[0]}`}
                      size={20}
                    />
                    {assignee.first_name} {assignee.last_name}
                  </span>
                </div>
              ) : null;
            })()}
            {form.due_date && (() => {
              const overdue = form.status !== 'completed' && isBefore(parseISO(form.due_date), startOfToday());
              return (
                <div className="task-detail-meta-row">
                  <span className="task-detail-meta-label">Due Date</span>
                  <span className={`task-detail-meta-val ${overdue ? 'task-detail-overdue' : ''}`}>
                    {format(parseISO(form.due_date), 'MMM d, yyyy')}{overdue ? ' — overdue' : ''}
                  </span>
                </div>
              );
            })()}
            {task.date_received && (
              <div className="task-detail-meta-row">
                <span className="task-detail-meta-label">Received</span>
                <span className="task-detail-meta-val">{format(new Date(task.date_received), 'MMM d, yyyy')}</span>
              </div>
            )}
            {task.date_completed && (
              <div className="task-detail-meta-row">
                <span className="task-detail-meta-label">Completed</span>
                <span className="task-detail-meta-val">{format(new Date(task.date_completed), 'MMM d, yyyy')}</span>
              </div>
            )}
            {task.completed_by && (
              <div className="task-detail-meta-row">
                <span className="task-detail-meta-label">Completed By</span>
                <span className="task-detail-meta-val">{task.completed_by}</span>
              </div>
            )}
          </div>

          {task.attachments?.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <label className="label" style={{ display: 'block', marginBottom: 8 }}>Attachments</label>
              <TaskAttachments attachments={task.attachments} />
            </div>
          )}
        </div>

        {/* Right: image */}
        <div className="task-detail-image-col">
          <label className="label">Screenshot</label>

          {imagePreview ? (
            <div className="task-detail-image-wrap">
              <img
                src={imagePreview}
                alt="Screenshot"
                className="task-detail-image"
                onClick={() => setImgZoom(true)}
                title="Click to view full size"
              />
              <div className="task-detail-image-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImgZoom(true)}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                  </svg>
                  Full size
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => fileRef.current?.click()}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => { setImagePreview(null); setImageFile(null); setForm(f => ({ ...f, png_url: null })); }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <div className="image-drop-zone detail-upload-zone" onClick={() => fileRef.current?.click()}>
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8, opacity: 0.5 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <div style={{ fontSize: 13 }}>Click to upload screenshot</div>
                <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>PNG, JPG, WebP — max 1MB</div>
              </div>
            </div>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={handleImage}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Zoom lightbox */}
      {imgZoom && (
        <ModalPortal>
        <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={() => setImgZoom(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <img
              src={imagePreview}
              alt="Screenshot full size"
              style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, boxShadow: 'var(--shadow-lg)' }}
            />
            <button
              onClick={() => setImgZoom(false)}
              style={{ position: 'absolute', top: -14, right: -14, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '50%', width: 32, height: 32, color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}
            >✕</button>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}
