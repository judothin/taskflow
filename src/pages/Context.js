import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { InlineClock } from '../components/dashboardWidgets';
import ModalPortal from '../components/ModalPortal';
import useIsPhone from '../lib/useIsPhone';
import { searchRank } from '../lib/fuzzySearch';
import './Context.css';

// Team knowledge that isn't a task, a file or a project — "the captcha form is
// an Elementor plugin called X". A subject to find it by, a description
// holding what you actually want back later.
const EMPTY_FORM = { subject: '', description: '' };

export default function Context() {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const isPhone = useIsPhone();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(async () => {
    if (!activeTeamId) { setEntries([]); setLoading(false); return; }
    const { data } = await supabase
      .from('context_entries')
      .select('*')
      .eq('team_id', activeTeamId)
      .order('updated_at', { ascending: false });
    setEntries(data || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => searchRank(entries, search, e => [
    { text: e.subject, weight: 3 },
    { text: e.description, weight: 1 },
  ]), [entries, search]);

  const openAdd = () => { setEditEntry(null); setForm(EMPTY_FORM); setFormError(''); setShowForm(true); };
  const openEdit = (entry) => {
    setEditEntry(entry);
    setForm({ subject: entry.subject || '', description: entry.description || '' });
    setFormError('');
    setShowForm(true);
  };

  const save = async () => {
    if (!form.subject.trim()) { setFormError('Subject is required.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      subject: form.subject.trim(),
      description: form.description.trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = editEntry
      ? await supabase.from('context_entries').update(payload).eq('id', editEntry.id)
      : await supabase.from('context_entries').insert({ ...payload, team_id: activeTeamId, created_by: user?.id });
    setSaving(false);
    if (error) { setFormError(error.message); return; }
    setShowForm(false);
    load();
  };

  const remove = async (id) => {
    await supabase.from('context_entries').delete().eq('id', id);
    setConfirmDelete(null);
    load();
  };

  if (!activeTeamId) {
    return <div className="ctx-empty">Join or create a team to save context.</div>;
  }

  return (
    <div className="ctx-page fade-in">

      <header className="ctx-head">
        <div className="ctx-head-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
          </svg>
        </div>
        <div className="ctx-head-text">
          <div className="ctx-head-title">Context</div>
          <div className="ctx-head-sub">
            {loading ? 'Loading…' : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`}
          </div>
        </div>

        {!isPhone && <InlineClock />}

        <div className="ctx-search">
          <svg className="ctx-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            className="ctx-search-input"
            placeholder="Search context…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="ctx-search-clear" onClick={() => setSearch('')} aria-label="Clear search">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <button className="btn btn-primary btn-sm ctx-add" onClick={openAdd}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add Context
        </button>
      </header>

      {loading ? (
        <div className="ctx-list">
          {[1, 2, 3].map(i => <div key={i} className="ctx-skeleton loading-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="ctx-empty">
          {search ? (
            <>
              <p>Nothing matches <strong>"{search}"</strong>.</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
            </>
          ) : (
            <>
              <p>No context saved yet.</p>
              <p className="ctx-empty-sub">
                Write down the things that take longest to rediscover — where something lives,
                which plugin controls what, why a decision was made.
              </p>
              <button className="btn btn-primary btn-sm" onClick={openAdd}>Add the first one</button>
            </>
          )}
        </div>
      ) : (
        <div className="ctx-list">
          {filtered.map(entry => (
            <article key={entry.id} className="ctx-card">
              <div className="ctx-card-head">
                <h2 className="ctx-card-subject">{entry.subject}</h2>
                <div className="ctx-card-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => openEdit(entry)}>Edit</button>
                  <button className="theme-color-reset" onClick={() => setConfirmDelete(entry)}>Delete</button>
                </div>
              </div>
              {entry.description && <p className="ctx-card-desc">{entry.description}</p>}
            </article>
          ))}
        </div>
      )}

      {showForm && (
        <ModalPortal>
          <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
            <div className="modal" style={{ maxWidth: 560 }}>
              <div className="modal-header">
                <h2 style={{ fontSize: 17, fontWeight: 700 }}>{editEntry ? 'Edit context' : 'Add context'}</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)} aria-label="Close">✕</button>
              </div>
              <div className="modal-body">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Subject</label>
                    <input
                      className="input"
                      autoFocus
                      placeholder="e.g. Captcha on contact forms"
                      value={form.subject}
                      onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">
                      Description
                      <span className="label-note"> — what you'd want to read back later</span>
                    </label>
                    <textarea
                      className="input ctx-textarea"
                      rows={7}
                      placeholder="It's an Elementor add-on called X, configured under Settings → Forms. The site key lives in wp-config."
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    />
                  </div>
                  {formError && <div className="error-msg">⚠ {formError}</div>}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button>
                <button className="btn btn-primary" onClick={save} disabled={saving || !form.subject.trim()}>
                  {saving ? 'Saving…' : (editEntry ? 'Save changes' : 'Add context')}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}

      {confirmDelete && (
        <ModalPortal>
          <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) setConfirmDelete(null); }}>
            <div className="modal" style={{ maxWidth: 420 }}>
              <div className="modal-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Delete this context?</h2></div>
              <div className="modal-body">
                <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>
                  <strong>{confirmDelete.subject}</strong> will be removed for the whole team.
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="btn btn-danger" onClick={() => remove(confirmDelete.id)}>Delete</button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
