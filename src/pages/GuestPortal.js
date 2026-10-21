import React, { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fetchGuestTeamInfo } from '../lib/teams';
import { Icon, Dropzone, Lightbox, PageHeader, Empty } from '../ui';
import './Auth.css';

// Public page (/submit/:slug, no account, no app shell): anyone with a team's
// link can send it feedback. It lands in that team's Submissions inbox.

const MAX_TOTAL = 6 * 1024 * 1024;
const fmtBytes = b => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / (1024 * 1024)).toFixed(1)} MB`);
const EMPTY = { title: '', page: '', feedback: '', noticed_by: '' };

// Older databases may not have submissions.title yet — PostgREST then says
// the column doesn't exist. Retry without it, folding the title into the text.
const missingTitle = (err) => !!err && /title/i.test(`${err.message || ''} ${err.details || ''}`)
  && /column|schema cache/i.test(`${err.message || ''} ${err.details || ''}`);

function Bar() {
  return (
    <header className="gp-bar">
      <span className="au-logo" aria-hidden="true">T</span>
      <span className="gp-bar-name">TaskFlow</span>
      <span className="crumb-sep">/</span>
      <span className="t-2">Feedback</span>
      <span className="gp-bar-right"><Link to="/login">Team member? Sign in</Link></span>
    </header>
  );
}

export default function GuestPortal() {
  const { slug } = useParams();
  const [form, setForm] = useState(EMPTY);
  const [images, setImages] = useState([]); // [{ file, preview }]
  const [error, setError] = useState('');
  const [errTick, setErrTick] = useState(0);
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);
  const [team, setTeam] = useState(null);
  const [teamLoading, setTeamLoading] = useState(true);
  const [zoom, setZoom] = useState(null);

  useEffect(() => {
    if (!slug) { setTeamLoading(false); return undefined; }
    let cancelled = false;
    fetchGuestTeamInfo(slug).then(info => {
      if (!cancelled) { setTeam(info); setTeamLoading(false); }
    });
    return () => { cancelled = true; };
  }, [slug]);

  useEffect(() => () => images.forEach(i => URL.revokeObjectURL(i.preview)), []);

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const fail = (msg) => { setError(msg); setErrTick(t => t + 1); };
  const totalBytes = images.reduce((s, i) => s + i.file.size, 0);

  const addFiles = (files) => {
    const imgs = files.filter(f => f.type.startsWith('image/'));
    if (!imgs.length) { if (files.length) fail('Only images can be attached.'); return; }
    const added = imgs.reduce((s, f) => s + f.size, 0);
    if (totalBytes + added > MAX_TOTAL) { fail(`Screenshots can add up to ${fmtBytes(MAX_TOTAL)} in total.`); return; }
    setError('');
    setImages(prev => [...prev, ...imgs.map(f => ({ file: f, preview: URL.createObjectURL(f) }))]);
  };

  const onPaste = (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  };

  const removeImage = i => setImages(prev => {
    const next = [...prev];
    URL.revokeObjectURL(next[i].preview);
    next.splice(i, 1);
    return next;
  });

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.title.trim() || !form.feedback.trim() || !form.noticed_by.trim()) {
      fail('Fill in what needs fixing, the details and your name.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const uploaded = [];
      for (const img of images) {
        const ext = img.file.name.split('.').pop();
        const path = `submissions/guest-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-images').upload(path, img.file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        uploaded.push(data.publicUrl);
      }

      const row = {
        team_id: team.id,
        title: form.title.trim(),
        page: form.page.trim(),
        feedback: form.feedback.trim(),
        noticed_by: form.noticed_by.trim(),
        png_url: uploaded[0] || null, // first image kept for older readers
        images: uploaded,
        status: 'pending',
      };
      let { error: insertError } = await supabase.from('submissions').insert(row);
      if (missingTitle(insertError)) {
        const { title, ...rest } = row;
        ({ error: insertError } = await supabase.from('submissions').insert({ ...rest, feedback: `${title}\n\n${rest.feedback}` }));
      }
      if (insertError) throw insertError;
      setSuccess(true);
    } catch (err) {
      fail(err.message || 'Failed to send. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setSuccess(false);
    setForm(f => ({ ...EMPTY, noticed_by: f.noticed_by }));
    images.forEach(i => URL.revokeObjectURL(i.preview));
    setImages([]);
    setError('');
  };

  let body;
  if (teamLoading) {
    body = (
      <div className="anim-fade" aria-busy="true">
        <span className="skel skel-line" style={{ display: 'block', width: 90, marginBottom: 16 }} />
        <span className="skel" style={{ display: 'block', width: '62%', height: 38, marginBottom: 14 }} />
        <span className="skel skel-line" style={{ display: 'block', width: '44%', marginBottom: 40 }} />
        {[0, 1, 2].map(i => <span key={i} className="skel" style={{ display: 'block', height: 42, marginBottom: 18 }} />)}
      </div>
    );
  } else if (!slug || !team) {
    body = (
      <Empty icon="link" title={slug ? 'This link isn’t working' : 'This link needs a team'}>
        {slug
          ? 'The feedback link is invalid or has been replaced. Ask the team for their current one.'
          : 'Ask the team for their feedback link — it’s in Settings › Teams.'}
      </Empty>
    );
  } else if (success) {
    body = (
      <div className="gp-done">
        <div className="gp-done-icon"><Icon name="check" size={28} stroke={2.4} /></div>
        <h1 className="au-title">Thanks — it’s in.</h1>
        <p className="au-sub">{team.name} will look at it shortly. You can send another whenever you spot something.</p>
        <div className="gp-done-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={reset}>
            <Icon name="plus" size={15} />Send another
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <PageHeader
          eyebrow={`Feedback for ${team.name}`}
          title="What needs fixing?"
          sub="Report a problem or suggest an improvement. No account needed."
        />
        <form onSubmit={handleSubmit} onPaste={onPaste} className="gp-form stagger">
          <label className="field">
            <span className="field-label">In a sentence</span>
            <input
              className="input gp-title-input" placeholder="e.g. The checkout button doesn’t work on mobile"
              value={form.title} onChange={set('title')} maxLength={160} autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Where? <span className="opt-hint">· a page name or link</span></span>
            <input className="input input-mono" placeholder="Checkout, or https://…" value={form.page} onChange={set('page')} />
          </label>
          <label className="field">
            <span className="field-label">Details</span>
            <textarea className="textarea" placeholder="What did you see, and what did you expect?" value={form.feedback} onChange={set('feedback')} rows={5} />
          </label>
          <label className="field">
            <span className="field-label">Your name</span>
            <input className="input" placeholder="So the team knows who noticed" value={form.noticed_by} onChange={set('noticed_by')} autoComplete="name" />
          </label>
          <div className="field">
            <span className="field-label">Screenshots <span className="opt-hint">· optional</span></span>
            {images.length > 0 && (
              <div className="attach-grid">
                {images.map((img, i) => (
                  <div key={img.preview} className="attach">
                    <img className="attach-thumb" src={img.preview} alt="" onClick={() => setZoom(img.preview)} />
                    <button type="button" className="attach-x" onClick={() => removeImage(i)} aria-label="Remove screenshot">
                      <Icon name="x" size={11} stroke={2.4} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Dropzone
              onFiles={addFiles}
              accept="image/png,image/jpeg,image/webp,image/gif"
              title={images.length ? 'Add more screenshots' : 'Drop, paste or pick screenshots'}
              sub={`PNG, JPG, WebP or GIF · up to ${fmtBytes(MAX_TOTAL)} in total`}
              row={images.length > 0}
            />
          </div>

          {error && (
            <div key={errTick} className="notice notice-error wiggle" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>
          )}

          <div className="gp-foot">
            {images.length > 0 && <span className="gp-size">{fmtBytes(totalBytes)} / {fmtBytes(MAX_TOTAL)}</span>}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><span className="spinner" />Sending…</> : <>Send feedback <Icon name="send" size={14} /></>}
            </button>
          </div>
        </form>
      </>
    );
  }

  return (
    <div className="gp-page">
      <Bar />
      <main className="gp-main">{body}</main>
      {zoom && <Lightbox src={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}
