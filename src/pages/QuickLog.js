import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { awardTaskCreatedXp, awardTaskCompletedXp } from '../lib/xp';
import Avatar from '../components/Avatar';
import FeedbackEditor from '../components/FeedbackEditor';
import './QuickLog.css';

export default function QuickLogModal({ onClose }) {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const [users, setUsers]             = useState([]);
  const [page, setPage]               = useState('');
  const [feedback, setFeedback]       = useState('');
  const [completedBy, setCompletedBy] = useState([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [successCount, setSuccessCount] = useState(0);
  const [editorKey, setEditorKey]     = useState(0);

  const mouseDownRef = useRef(false);
  const handleOverlayMD = useCallback(e => { mouseDownRef.current = e.target === e.currentTarget; }, []);
  const handleOverlayMU = useCallback(e => { if (mouseDownRef.current && e.target === e.currentTarget) onClose(); }, [onClose]);

  useEffect(() => {
    if (!activeTeamId) return;
    fetchTeamMembers(activeTeamId).then(setUsers);
  }, [activeTeamId]);

  const togglePerson = (name) => {
    setCompletedBy(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  };

  // Keep the Page / Area between entries (often logging several for the same
  // area) — only clear what was done and who did it. Bumping editorKey remounts
  // the rich-text editor so its contents actually clear on screen.
  const reset = () => {
    setFeedback('');
    setCompletedBy([]);
    setError('');
    setEditorKey(k => k + 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!page.trim()) { setError('Page is required.'); return; }
    const plainFeedback = feedback.replace(/<[^>]*>/g, '').trim();
    if (!plainFeedback) { setError('Feedback is required.'); return; }
    if (!completedBy.length) { setError('Select at least one person who completed this.'); return; }

    setSaving(true);
    setError('');
    const now = new Date().toISOString();
    const { error: err } = await supabase.from('tasks').insert({
      team_id:        activeTeamId,
      page:           page.trim(),
      feedback,
      noticed_by:     completedBy.join(', '),
      completed_by:   completedBy.join(', '),
      status:         'completed',
      roi:            'medium',
      complexity:     'medium',
      date_received:  now,
      date_completed: now,
      updated_at:     now,
      created_by:     user?.id || null,
    });

    setSaving(false);
    if (err) { setError(err.message); return; }
    awardTaskCreatedXp(user?.id);
    awardTaskCompletedXp(user?.id, 'medium');
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    setSuccessCount(c => c + 1);
    reset();
  };

  return (
    <div className="modal-overlay" onMouseDown={handleOverlayMD} onMouseUp={handleOverlayMU}>
      <div className="modal quicklog-modal">

        {/* Header */}
        <div className="modal-header">
          <div className="quicklog-header">
            <div className="quicklog-header-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
            </div>
            <div>
              <h2 className="quicklog-title">Log Completed Task</h2>
              <p className="quicklog-sub">Record something finished that wasn't already tracked.</p>
            </div>
          </div>
          <button className="btn btn-secondary" onClick={onClose} aria-label="Close" style={{ padding: '7px 10px' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="modal-body">

          {/* Success flash */}
          {successCount > 0 && (
            <div className="quicklog-success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {successCount === 1 ? 'Task logged.' : `${successCount} tasks logged.`} Marked as completed.
            </div>
          )}

          <form onSubmit={handleSubmit} className="quicklog-form">

            <div className="form-group">
              <label className="label">Page / Area</label>
              <input
                className="input"
                placeholder="e.g. Checkout, Admin Dashboard, API"
                value={page}
                onChange={e => setPage(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="label">What was done</label>
              <FeedbackEditor key={editorKey} value={feedback} onChange={setFeedback} />
            </div>

            <div className="form-group">
              <label className="label">
                Completed By
                {completedBy.length > 0 && (
                  <span className="quicklog-selected-count">{completedBy.length} selected</span>
                )}
              </label>
              <div className="quicklog-people">
                {users.map(u => {
                  const name = `${u.first_name} ${u.last_name}`;
                  const checked = completedBy.includes(name);
                  return (
                    <label key={u.id} className={`complete-person-row quicklog-person-row ${checked ? 'complete-person-row-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePerson(name)}
                        className="complete-person-checkbox"
                      />
                      <Avatar
                        src={u.avatar_url}
                        color={u.color || '#6366f1'}
                        initials={`${u.first_name[0]}${u.last_name[0]}`}
                        size={28}
                        style={{ flexShrink: 0 }}
                      />
                      <span className="complete-person-name">{u.first_name} {u.last_name}</span>
                    </label>
                  );
                })}
                {users.length === 0 && (
                  <p style={{ fontSize: 13, color: 'var(--text-dim)', padding: '8px 4px' }}>No team members found.</p>
                )}
              </div>
            </div>

            {error && <div className="error-msg">⚠ {error}</div>}

            <button type="submit" className="btn btn-primary quicklog-submit" disabled={saving}>
              {saving ? 'Logging…' : 'Log as Completed'}
            </button>

          </form>
        </div>
      </div>
    </div>
  );
}
