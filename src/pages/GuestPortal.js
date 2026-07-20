import React, { useState, useRef, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchGuestTeamInfo } from '../lib/teams';
import './Auth.css';

const MAX_TOTAL = 6 * 1024 * 1024;
const fmtBytes = b => b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`;

export default function GuestPortal() {
  const { slug } = useParams();
  const fileRef = useRef();
  const [form,   setForm]   = useState({ page: '', feedback: '', noticed_by: '' });
  const [images, setImages] = useState([]); // [{ file, preview }]
  const [error,  setError]  = useState('');
  const [success, setSuccess] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [team,    setTeam]    = useState(null);
  const [teamLoading, setTeamLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setTeamLoading(false); return; }
    let cancelled = false;
    fetchGuestTeamInfo(slug).then(info => {
      if (!cancelled) { setTeam(info); setTeamLoading(false); }
    });
    return () => { cancelled = true; };
  }, [slug]);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const totalBytes = images.reduce((s, i) => s + i.file.size, 0);

  const handleFiles = e => {
    const files = Array.from(e.target.files || []);
    fileRef.current.value = '';
    if (!files.length) return;
    const added = files.reduce((s, f) => s + f.size, 0);
    if (totalBytes + added > MAX_TOTAL) {
      setError(`Total images exceed ${fmtBytes(MAX_TOTAL)}.`);
      return;
    }
    setError('');
    setImages(prev => [
      ...prev,
      ...files.map(f => ({ file: f, preview: URL.createObjectURL(f) })),
    ]);
  };

  const removeImage = i => {
    setImages(prev => {
      const next = [...prev];
      URL.revokeObjectURL(next[i].preview);
      next.splice(i, 1);
      return next;
    });
  };

  const handleSubmit = async e => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const uploaded = [];
      for (const img of images) {
        const ext  = img.file.name.split('.').pop();
        const path = `submissions/guest-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-images').upload(path, img.file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }

      const { error: insertError } = await supabase.from('submissions').insert({
        team_id:    team.id,
        page:       form.page,
        feedback:   form.feedback,
        noticed_by: form.noticed_by,
        png_url:    uploaded[0] || null,   // first image kept for backward compat
        images:     uploaded,
        status:     'pending',
      });

      if (insertError) throw insertError;
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to submit. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSuccess(false);
    setForm({ page: '', feedback: '', noticed_by: '' });
    images.forEach(i => URL.revokeObjectURL(i.preview));
    setImages([]);
    setError('');
  };

  if (teamLoading) {
    return (
      <div className="auth-page">
        <div className="auth-bg"><div className="auth-orb auth-orb-1" /><div className="auth-orb auth-orb-2" /></div>
        <div className="auth-card fade-in" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>
      </div>
    );
  }

  if (!slug || !team) {
    return (
      <div className="auth-page">
        <div className="auth-bg"><div className="auth-orb auth-orb-1" /><div className="auth-orb auth-orb-2" /></div>
        <div className="auth-card fade-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 44, marginBottom: 12 }}>🔗</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            {slug ? 'Guest link not found' : 'This link needs a team code'}
          </h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
            {slug
              ? "This guest portal link is invalid or has been removed. Ask your team for their current link."
              : 'Ask your team for their guest-portal link — find it on the Teams page.'}
          </p>
          <Link to="/login" style={{ fontSize: 13, color: 'var(--text-dim)' }}>Team member? Sign in →</Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="auth-page">
        <div className="auth-bg">
          <div className="auth-orb auth-orb-1" />
          <div className="auth-orb auth-orb-2" />
        </div>
        <div className="auth-card fade-in" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Submitted!</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            Thank you for your feedback. The team will review it shortly.
          </p>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={reset}>
            Submit Another
          </button>
          <Link to="/login" style={{ display: 'block', marginTop: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            Team member? Sign in →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="guest-portal-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
      </div>

      <div className="auth-card guest-portal-card fade-in">
        <div className="auth-logo" style={{ marginBottom: 16 }}>
          <img src="/logo.png" alt="TaskFlow" style={{ margin: '0 auto 10px', width: 36, height: 36, borderRadius: 8, objectFit: 'contain', display: 'block' }} />
          <h1 style={{ fontSize: 22 }}>Submit a Task to {team.name}</h1>
          <p style={{ fontSize: 13 }}>Report an issue or suggest an improvement</p>
        </div>

        <form onSubmit={handleSubmit} className="form-grid" style={{ gap: 12 }}>
          <div className="form-group">
            <label className="label">Page</label>
            <input className="input guest-input" placeholder="Which page? (e.g. Home, Checkout)" value={form.page} onChange={set('page')} required />
          </div>

          <div className="form-group">
            <label className="label">Feedback / Issue</label>
            <textarea className="input guest-input" placeholder="Describe the issue or improvement..." value={form.feedback} onChange={set('feedback')} rows={4} required style={{ resize: 'none' }} />
          </div>

          <div className="form-group">
            <label className="label">Your Name</label>
            <input className="input guest-input" placeholder="Who noticed this?" value={form.noticed_by} onChange={set('noticed_by')} required />
          </div>

          <div className="form-group">
            <label className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Screenshots <span style={{ fontWeight: 400, color: 'var(--text-dim)', fontSize: 11 }}>optional</span></span>
              {images.length > 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                  {fmtBytes(totalBytes)} / {fmtBytes(MAX_TOTAL)}
                </span>
              )}
            </label>

            {images.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                {images.map((img, i) => (
                  <div key={i} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0 }}>
                    <img src={img.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    <button
                      type="button"
                      onClick={() => removeImage(i)}
                      style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.7)', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >✕</button>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{ border: '2px dashed var(--border-light)', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 52, gap: 8 }}
              onClick={() => fileRef.current?.click()}
            >
              <span style={{ fontSize: 18 }}>📎</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {images.length === 0 ? 'Click to attach screenshots' : 'Add more screenshots'}
              </span>
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple onChange={handleFiles} style={{ display: 'none' }} />
          </div>

          {error && <div className="error-msg">⚠ {error}</div>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={saving}>
            {saving ? 'Submitting…' : 'Submit'}
          </button>
        </form>

        <div style={{ marginTop: 14, textAlign: 'center' }}>
          <Link to="/login" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Team member? Sign in →
          </Link>
        </div>
      </div>
    </div>
  );
}
