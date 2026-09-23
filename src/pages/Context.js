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
const EMPTY_FORM = { subject: '', description: '', fileIds: [] };

export default function Context() {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const isPhone = useIsPhone();

  const [entries, setEntries] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileQuery, setFileQuery] = useState('');
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
    const [{ data }, { data: fileRows }] = await Promise.all([
      supabase.from('context_entries').select('*')
        .eq('team_id', activeTeamId).order('updated_at', { ascending: false }),
      supabase.from('file_entries').select('id, name, path, section')
        .eq('team_id', activeTeamId).order('name'),
    ]);
    setEntries(data || []);
    setFiles(fileRows || []);
    setLoading(false);
  }, [activeTeamId]);

  // id → file, for rendering the chips on each card without a second lookup.
  const fileById = useMemo(() => {
    const m = new Map();
    files.forEach(f => m.set(f.id, f));
    return m;
  }, [files]);

  const linkedFiles = (entry) =>
    (Array.isArray(entry.file_ids) ? entry.file_ids : [])
      .map(id => fileById.get(id))
      .filter(Boolean);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => searchRank(entries, search, e => [
    { text: e.subject, weight: 3 },
    { text: e.description, weight: 1 },
  ]), [entries, search]);

  const openAdd = () => {
    setEditEntry(null); setForm(EMPTY_FORM); setFormError(''); setFileQuery(''); setShowForm(true);
  };
  const openEdit = (entry) => {
    setEditEntry(entry);
    setForm({
      subject: entry.subject || '',
      description: entry.description || '',
      fileIds: Array.isArray(entry.file_ids) ? entry.file_ids : [],
    });
    setFormError('');
    setFileQuery('');
    setShowForm(true);
  };

  const toggleFile = (id) => setForm(f => ({
    ...f,
    fileIds: f.fileIds.includes(id) ? f.fileIds.filter(x => x !== id) : [...f.fileIds, id],
  }));

  // Ranked by the same forgiving matcher the rest of the app uses, so the
  // picker finds "mini inpo gal" when you type "mini gallery".
  const fileOptions = useMemo(() => searchRank(files, fileQuery, f => [
    { text: f.name, weight: 3 },
    { text: f.path, weight: 2 },
    { text: f.section, weight: 1.5 },
  ]).slice(0, 40), [files, fileQuery]);

  const save = async () => {
    if (!form.subject.trim()) { setFormError('Subject is required.'); return; }
    setSaving(true);
    setFormError('');
    const payload = {
      subject: form.subject.trim(),
      description: form.description.trim(),
      file_ids: form.fileIds,
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
              {linkedFiles(entry).length > 0 && (
                <div className="ctx-card-files">
                  {linkedFiles(entry).map(f => (
                    <span key={f.id} className="ctx-file-chip" title={f.path}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" />
                      </svg>
                      {f.name}
                    </span>
                  ))}
                </div>
              )}
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
                  <div className="form-group">
                    <label className="label">
                      Files
                      <span className="label-note"> — source files this is about</span>
                    </label>

                    {form.fileIds.length > 0 && (
                      <div className="ctx-picked">
                        {form.fileIds.map(id => {
                          const f = fileById.get(id);
                          if (!f) return null;
                          return (
                            <button
                              key={id}
                              type="button"
                              className="ctx-file-chip ctx-file-chip-on"
                              onClick={() => toggleFile(id)}
                              title={`Remove ${f.name}`}
                            >
                              {f.name}
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          );
                        })}
                      </div>
                    )}

                    <input
                      className="input"
                      placeholder={files.length ? 'Search files to link…' : 'No files on this team yet'}
                      value={fileQuery}
                      disabled={!files.length}
                      onChange={e => setFileQuery(e.target.value)}
                    />

                    {files.length > 0 && (
                      <div className="ctx-file-list">
                        {fileOptions.length === 0 ? (
                          <p className="ctx-file-none">No files match "{fileQuery}".</p>
                        ) : fileOptions.map(f => {
                          const on = form.fileIds.includes(f.id);
                          return (
                            <button
                              key={f.id}
                              type="button"
                              className={`ctx-file-row ${on ? 'ctx-file-row-on' : ''}`}
                              onClick={() => toggleFile(f.id)}
                              aria-pressed={on}
                            >
                              <span className="ctx-file-row-text">
                                <span className="ctx-file-row-name">{f.name}</span>
                                <span className="ctx-file-row-path">{[f.section, f.path].filter(Boolean).join(' · ')}</span>
                              </span>
                              {on && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
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
