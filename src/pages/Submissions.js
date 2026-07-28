import React, { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { awardTaskCreatedXp } from '../lib/xp';
import { format } from 'date-fns';
import ModalPortal from '../components/ModalPortal';
import './Submissions.css';

const TABS = [
  { value: 'pending',  label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' },
];

function SubmissionCard({ submission, onRefresh }) {
  const { user } = useAuth();
  const fileRef  = useRef();

  const [page,       setPage]       = useState(submission.page       || '');
  const [feedback,   setFeedback]   = useState(submission.feedback   || '');
  const [noticedBy,  setNoticedBy]  = useState(submission.noticed_by || '');
  const [roi,        setRoi]        = useState('medium');
  const [complexity, setComplexity] = useState('medium');
  const [notes,      setNotes]      = useState(submission.notes      || '');
  const [lightboxIdx, setLightboxIdx] = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [action,  setAction]  = useState(null);

  // Multi-image state — existing URLs + pending new files
  const initImgs = () => {
    const urls = submission.images?.length
      ? submission.images
      : submission.png_url ? [submission.png_url] : [];
    return urls.map(url => ({ url, isNew: false }));
  };
  const [imgs, setImgs] = useState(initImgs);

  const isPending  = submission.status === 'pending';
  const isApproved = submission.status === 'approved';
  const isDeclined = submission.status === 'declined';

  const handleFiles = e => {
    const files = Array.from(e.target.files || []);
    fileRef.current.value = '';
    setImgs(prev => [...prev, ...files.map(f => ({
      isNew: true, file: f, preview: URL.createObjectURL(f),
    }))]);
  };

  const removeImg = i => setImgs(prev => {
    const next = [...prev];
    if (next[i].isNew) URL.revokeObjectURL(next[i].preview);
    next.splice(i, 1);
    return next;
  });

  const resolveImgs = async () => {
    const urls = [];
    for (const img of imgs) {
      if (img.isNew && img.file) {
        const ext  = img.file.name.split('.').pop();
        const path = `submissions/reviewed-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-images').upload(path, img.file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        urls.push(data.publicUrl);
      } else if (img.url) {
        urls.push(img.url);
      }
    }
    return urls;
  };

  const handleApprove = async () => {
    if (!page.trim()) { setError('Page is required.'); return; }
    setSaving(true); setError('');
    try {
      const now       = new Date().toISOString();
      const finalImgs = await resolveImgs();
      const { error: taskErr } = await supabase.from('tasks').insert({
        team_id: submission.team_id,
        page: page.trim(), feedback: feedback.trim(), noticed_by: noticedBy.trim(),
        png_url: finalImgs[0] || null, roi, complexity,
        status: 'open', date_received: submission.created_at, updated_at: now,
        created_by: user?.id || null, is_guest: true,
      });
      if (taskErr) throw taskErr;
      awardTaskCreatedXp(user?.id);
      const { error: subErr } = await supabase.from('submissions').update({
        page: page.trim(), feedback: feedback.trim(), noticed_by: noticedBy.trim(),
        png_url: finalImgs[0] || null, images: finalImgs,
        status: 'approved', reviewed_at: now, reviewed_by: user?.id,
        notes: notes.trim() || null,
      }).eq('id', submission.id);
      if (subErr) throw subErr;
      onRefresh();
    } catch (err) {
      setError(err.message || 'Failed to approve');
    } finally {
      setSaving(false); setAction(null);
    }
  };

  const handleDecline = async () => {
    setSaving(true); setError('');
    try {
      const now = new Date().toISOString();
      const { error: subErr } = await supabase.from('submissions').update({
        page: page.trim(), feedback: feedback.trim(), noticed_by: noticedBy.trim(),
        status: 'declined', reviewed_at: now, reviewed_by: user?.id,
        notes: notes.trim() || null,
      }).eq('id', submission.id);
      if (subErr) throw subErr;
      onRefresh();
    } catch (err) {
      setError(err.message || 'Failed to decline');
    } finally {
      setSaving(false); setAction(null);
    }
  };

  return (
    <>
      <div className={`sub-card sub-card-${submission.status}`}>
        {/* Header */}
        <div className="sub-card-header">
          <span className={`sub-status-badge sub-status-${submission.status}`}>
            {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
          </span>
          <span className="sub-card-date">{format(new Date(submission.created_at), 'MMM d, yyyy · h:mm a')}</span>
        </div>

        {/* Editable fields */}
        <div className="sub-card-body">
          <div className="sub-fields">
            <div className="sub-field-row">
              <div className="sub-field">
                <label className="sub-label">Page / URL</label>
                <input
                  className="input"
                  value={page}
                  onChange={e => setPage(e.target.value)}
                  readOnly={!isPending}
                  placeholder="Which page?"
                />
              </div>
              <div className="sub-field">
                <label className="sub-label">Noticed by</label>
                <input
                  className="input"
                  value={noticedBy}
                  onChange={e => setNoticedBy(e.target.value)}
                  readOnly={!isPending}
                  placeholder="Name"
                />
              </div>
            </div>

            <div className="sub-field">
              <label className="sub-label">Feedback / Issue</label>
              <textarea
                className="input"
                rows={4}
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                readOnly={!isPending}
                placeholder="Describe the issue…"
                style={{ resize: 'vertical', minHeight: 88 }}
              />
            </div>

            {isPending && (
              <div className="sub-field-row">
                <div className="sub-field">
                  <label className="sub-label">ROI / Priority</label>
                  <select className="input" value={roi} onChange={e => setRoi(e.target.value)}>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="sub-field">
                  <label className="sub-label">Complexity</label>
                  <select className="input" value={complexity} onChange={e => setComplexity(e.target.value)}>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>
            )}

            <div className="sub-field">
              <label className="sub-label">Notes <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 11 }}>internal only</span></label>
              <textarea
                className="input"
                rows={2}
                value={notes}
                onChange={e => setNotes(e.target.value)}
                readOnly={!isPending}
                placeholder="Internal notes…"
                style={{ resize: 'none' }}
              />
            </div>

            {/* Screenshots */}
            <div className="sub-field">
              <label className="sub-label">Screenshots</label>
              {imgs.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                  {imgs.map((img, i) => {
                    const src = img.isNew ? img.preview : img.url;
                    return (
                      <div key={i} style={{ position: 'relative', width: 100, height: 76, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
                        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', display: 'block' }} onClick={() => setLightboxIdx(i)} />
                        {isPending && (
                          <button type="button" onClick={() => removeImg(i)} style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {isPending && (
                <button type="button" className="attach-add-btn" onClick={() => fileRef.current?.click()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                  {imgs.length === 0 ? 'Attach screenshots' : 'Add more'}
                </button>
              )}
              {!isPending && imgs.length === 0 && <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>No screenshots</span>}
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: 'none' }} />
            </div>
          </div>
        </div>

        {/* Footer */}
        {isPending && (
          <div className="sub-card-footer">
            {error && <span className="error-msg" style={{ fontSize: 12 }}>⚠ {error}</span>}
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
              {action === 'decline' ? (
                <>
                  <button className="btn btn-danger btn-sm" onClick={handleDecline} disabled={saving}>
                    {saving ? 'Declining…' : 'Confirm Decline'}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAction(null)} disabled={saving}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="btn btn-ghost btn-sm" onClick={() => setAction('decline')}>Decline</button>
                  <button className="btn btn-primary btn-sm" onClick={handleApprove} disabled={saving}>
                    {saving ? 'Approving…' : 'Approve & Create Task'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {(isApproved || isDeclined) && submission.reviewed_at && (
          <div className="sub-reviewed">
            {isApproved ? '✓ Approved' : '✕ Declined'} on {format(new Date(submission.reviewed_at), 'MMM d, yyyy')}
            {submission.notes && <> · {submission.notes}</>}
          </div>
        )}
      </div>

      {lightboxIdx !== null && imgs[lightboxIdx] && (
        <ModalPortal>
        <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={() => setLightboxIdx(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <img src={imgs[lightboxIdx].isNew ? imgs[lightboxIdx].preview : imgs[lightboxIdx].url} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }} />
            <button onClick={() => setLightboxIdx(null)} style={{ position: 'absolute', top: -12, right: -12, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '50%', width: 32, height: 32, color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>✕</button>
          </div>
        </div>
        </ModalPortal>
      )}
    </>
  );
}

export default function Submissions() {
  const { activeTeamId } = useTeam();
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [activeTab, setActiveTab] = useState('pending');

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setAllSubmissions([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from('submissions').select('*')
      .eq('team_id', activeTeamId).order('created_at', { ascending: false });
    setAllSubmissions(data || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const counts  = { pending: 0, approved: 0, declined: 0 };
  allSubmissions.forEach(s => { if (counts[s.status] !== undefined) counts[s.status]++; });

  const visible = allSubmissions.filter(s => s.status === activeTab);

  return (
    <div className="submissions-page fade-in">
      <div className="sub-tabs">
        {TABS.map(t => (
          <button
            key={t.value}
            className={`sub-tab ${activeTab === t.value ? 'sub-tab-active' : ''}`}
            onClick={() => setActiveTab(t.value)}
          >
            {t.label}
            <span className="sub-tab-count">{counts[t.value]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="sub-grid">
          {[1, 2, 3].map(i => <div key={i} className="sub-card loading-pulse" style={{ height: 320 }} />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <h3>{activeTab === 'pending' ? 'No pending submissions' : activeTab === 'approved' ? 'No approved submissions' : 'No declined submissions'}</h3>
          <p>{activeTab === 'pending' ? 'New guest submissions will appear here for review' : 'Nothing here yet'}</p>
        </div>
      ) : (
        <div className="sub-grid">
          {visible.map(s => <SubmissionCard key={s.id} submission={s} onRefresh={fetchData} />)}
        </div>
      )}
    </div>
  );
}
