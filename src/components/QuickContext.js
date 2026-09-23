import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import ModalPortal from './ModalPortal';
import './QuickContext.css';

// Fired after a successful save so an open Context page refreshes without a
// round trip through the database. Realtime would also catch it, but this is
// instant and works whether or not context_entries is in the publication.
export const CONTEXT_CHANGED = 'context-changed';
// Lets the + menu in the nav open this sheet without owning a second copy.
export const OPEN_QUICK_CONTEXT = 'open-quick-context';

// "I just learned something" — reachable from the top bar on every page,
// because the moment you find out where the captcha lives is never the moment
// you're on the Context page. Subject and description only; linking files is
// the considered version of this, and that lives on the Context page itself.
export default function QuickContext() {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_QUICK_CONTEXT, handler);
    return () => window.removeEventListener(OPEN_QUICK_CONTEXT, handler);
  }, []);

  if (!activeTeamId) return null;

  const close = () => {
    setOpen(false);
    setSubject(''); setDescription(''); setError(''); setSaved(false);
  };

  const save = async () => {
    if (!subject.trim() || saving) return;
    setSaving(true);
    setError('');
    const { error: err } = await supabase.from('context_entries').insert({
      team_id: activeTeamId,
      created_by: user?.id,
      subject: subject.trim(),
      description: description.trim(),
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    window.dispatchEvent(new CustomEvent(CONTEXT_CHANGED));
    setSaved(true);
    // Leave the confirmation up for a beat rather than yanking the sheet away.
    setTimeout(close, 900);
  };

  return (
    <>
      <button
        type="button"
        className="qctx-trigger"
        onClick={() => setOpen(true)}
        title="Save context"
        aria-label="Save context"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
        </svg>
        <span className="qctx-trigger-label">Context</span>
      </button>

      {open && (
        <ModalPortal onDismiss={close}>
          <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) close(); }}>
            <div className="modal qctx-modal">
              <div className="modal-header">
                <h2 style={{ fontSize: 17, fontWeight: 700 }}>Save context</h2>
                <button className="btn btn-ghost btn-sm" onClick={close} aria-label="Close">✕</button>
              </div>

              <div className="modal-body">
                {saved ? (
                  <div className="qctx-saved">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Saved to Context
                  </div>
                ) : (
                  <div className="form-grid">
                    <div className="form-group">
                      <label className="label">Subject</label>
                      <input
                        className="input"
                        autoFocus
                        placeholder="e.g. Captcha on contact forms"
                        value={subject}
                        onChange={e => setSubject(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
                      />
                    </div>
                    <div className="form-group">
                      <label className="label">
                        Description
                        <span className="label-note"> — what you'd want to read back later</span>
                      </label>
                      <textarea
                        className="input qctx-textarea"
                        rows={5}
                        placeholder="It's an Elementor add-on called X, configured under Settings → Forms."
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                      />
                    </div>
                    {error && <div className="error-msg">⚠ {error}</div>}
                  </div>
                )}
              </div>

              {!saved && (
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={close} disabled={saving}>Cancel</button>
                  <button className="btn btn-primary" onClick={save} disabled={saving || !subject.trim()}>
                    {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
