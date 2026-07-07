import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { InlineClock } from '../components/dashboardWidgets';
import ModalPortal from '../components/ModalPortal';
import './Help.css';
import './Files.css';

const TYPE_META = {
  js:    { label: 'JS',  cls: 'file-type-js' },
  jsx:   { label: 'JSX', cls: 'file-type-js' },
  ts:    { label: 'TS',  cls: 'file-type-ts' },
  tsx:   { label: 'TSX', cls: 'file-type-ts' },
  css:   { label: 'CSS', cls: 'file-type-css' },
  php:   { label: 'PHP', cls: 'file-type-php' },
  other: { label: '—',   cls: 'file-type-other' },
};

function detectType(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'jsx') return 'jsx';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'ts')  return 'ts';
  if (ext === 'js')  return 'js';
  if (['css', 'scss', 'sass'].includes(ext)) return 'css';
  if (ext === 'php') return 'php';
  return 'other';
}

function TypeBadge({ type }) {
  const m = TYPE_META[type] || TYPE_META.other;
  return <span className={`file-type-dot ${m.cls}`}>{m.label}</span>;
}

const EMPTY_FORM = { name: '', path: '', section: '', description: '', type: 'js' };

// pendingImages shape: [{ preview: string, file: File|null, url: string|null }]
function imgFromUrl(url) { return { preview: url, file: null, url }; }

export default function Files() {
  const { activeTeamId } = useTeam();
  const [entries, setEntries]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [showForm, setShowForm]           = useState(false);
  const [editEntry, setEditEntry]         = useState(null);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [pendingImages, setPendingImages] = useState([]);
  const [saving, setSaving]               = useState(false);
  const [formError, setFormError]         = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch]               = useState('');
  const [viewEntry, setViewEntry]         = useState(null);
  const [lightboxImg, setLightboxImg]     = useState(null);
  const imgInputRef                       = useRef();

  const loadEntries = useCallback(async () => {
    if (!activeTeamId) { setEntries([]); setLoading(false); return; }
    const { data } = await supabase
      .from('file_entries')
      .select('*')
      .eq('team_id', activeTeamId)
      .order('section')
      .order('name');
    setEntries(data || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const filtered = search.trim()
    ? entries.filter(e => {
        const q = search.toLowerCase();
        return (
          e.name?.toLowerCase().includes(q) ||
          e.path?.toLowerCase().includes(q) ||
          e.section?.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q)
        );
      })
    : entries;

  const sections = filtered.reduce((acc, e) => {
    const key = e.section?.trim() || 'Uncategorized';
    (acc[key] = acc[key] || []).push(e);
    return acc;
  }, {});
  const sectionNames = Object.keys(sections).sort();
  const existingSections = [...new Set(entries.map(e => e.section).filter(Boolean))].sort();

  const openAdd = () => {
    setEditEntry(null);
    setForm(EMPTY_FORM);
    setPendingImages([]);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (entry) => {
    setEditEntry(entry);
    setForm({
      name:        entry.name        || '',
      path:        entry.path        || '',
      section:     entry.section     || '',
      description: entry.description || '',
      type:        entry.type        || 'js',
    });
    setPendingImages((entry.images || []).map(imgFromUrl));
    setFormError('');
    setShowForm(true);
  };

  const setField = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleNameChange = (e) => {
    const name = e.target.value;
    setForm(f => ({ ...f, name, type: name ? detectType(name) : f.type }));
  };

  const handleImagePick = (e) => {
    const files = Array.from(e.target.files || []);
    const tooBig = files.filter(f => f.size > 3 * 1024 * 1024);
    if (tooBig.length) { setFormError('Each image must be under 3 MB.'); return; }
    setFormError('');
    const newItems = files.map(file => ({
      preview: URL.createObjectURL(file),
      file,
      url: null,
    }));
    setPendingImages(prev => [...prev, ...newItems]);
    e.target.value = '';
  };

  const removeImage = (idx) => {
    setPendingImages(prev => {
      const copy = [...prev];
      if (copy[idx].preview?.startsWith('blob:')) URL.revokeObjectURL(copy[idx].preview);
      copy.splice(idx, 1);
      return copy;
    });
  };

  const uploadPendingImages = async () => {
    return Promise.all(
      pendingImages.map(async (img) => {
        if (!img.file) return img.url;
        const ext = img.file.name.split('.').pop();
        const path = `file-entries/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error } = await supabase.storage.from('task-images').upload(path, img.file);
        if (error) throw error;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        return data.publicUrl;
      })
    );
  };

  const saveEntry = async () => {
    if (!form.name.trim())    { setFormError('File name is required.');  return null; }
    if (!form.path.trim())    { setFormError('Path is required.');        return null; }
    if (!form.section.trim()) { setFormError('Section is required.');     return null; }
    setSaving(true);
    setFormError('');
    try {
      const images = await uploadPendingImages();
      const payload = {
        name:        form.name.trim(),
        path:        form.path.trim(),
        section:     form.section.trim(),
        description: form.description.trim(),
        type:        form.type,
        images,
      };
      const { error } = editEntry
        ? await supabase.from('file_entries').update(payload).eq('id', editEntry.id)
        : await supabase.from('file_entries').insert({ ...payload, team_id: activeTeamId });
      if (error) { setFormError(error.message); setSaving(false); return null; }
      loadEntries();
      setSaving(false);
      return payload;
    } catch (err) {
      setFormError(err.message || 'Upload failed.');
      setSaving(false);
      return null;
    }
  };

  const handleSave = async () => {
    const result = await saveEntry();
    if (result) setShowForm(false);
  };

  const handleSaveAndAnother = async () => {
    const result = await saveEntry();
    if (result) {
      setEditEntry(null);
      setForm({ name: '', path: result.path, section: result.section, description: '', type: 'js' });
      setPendingImages([]);
      setFormError('');
      document.getElementById('files-form-name')?.focus();
    }
  };

  const handleDelete = async (id) => {
    await supabase.from('file_entries').delete().eq('id', id);
    setConfirmDelete(null);
    loadEntries();
  };

  return (
    <div>
      {/* Mobile pill nav */}
      <nav className="help-mobile-nav">
        {sectionNames.map(s => (
          <a key={s} href={`#section-${s}`} className="help-mobile-nav-item">{s}</a>
        ))}
      </nav>

      <div className="help-layout">

        {/* ── Sticky side nav ── */}
        <aside className="help-sticky-nav files-sticky-nav">
          <div className="files-nav-header">Sections</div>
          {sectionNames.length === 0 && !loading && (
            <span className="files-nav-empty">None yet</span>
          )}
          {sectionNames.map(s => (
            <a key={s} href={`#section-${s}`} className="files-nav-item">{s}</a>
          ))}
          <div className="files-nav-footer">
            <span>{entries.length} file{entries.length !== 1 ? 's' : ''}</span>
            {sectionNames.length > 0 && (
              <><span className="files-nav-sep">·</span><span>{sectionNames.length} sections</span></>
            )}
          </div>
        </aside>

        {/* ── Main content ── */}
        <div className="help-content">

          {/* Page header */}
          <div className="files-page-header">
            <div className="files-page-header-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div className="files-page-title">Source Files</div>
              <div className="files-page-sub">
                {loading ? 'Loading…' : `${entries.length} file${entries.length !== 1 ? 's' : ''} · ${sectionNames.length} section${sectionNames.length !== 1 ? 's' : ''}`}
              </div>
            </div>
            <InlineClock />
            <div className="files-search-wrap">
              <svg className="files-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                className="files-search-input"
                placeholder="Search files…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button className="files-search-clear" onClick={() => setSearch('')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>
            <button className="btn btn-primary btn-sm" onClick={openAdd}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Add File
            </button>
          </div>

          {!loading && entries.length > 0 && filtered.length === 0 && (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <p>No files match <strong>"{search}"</strong></p>
              <button className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="empty-state">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              <h3>No files yet</h3>
              <p>Start documenting your codebase by adding your first file.</p>
              <button className="btn btn-primary btn-sm" onClick={openAdd}>Add your first file</button>
            </div>
          )}

          {/* Sections */}
          {sectionNames.map(sectionName => (
            <section key={sectionName} id={`section-${sectionName}`} className="help-section">
              <div className="files-section-header">
                <div className="files-folder-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                  </svg>
                </div>
                <span className="files-section-title">{sectionName}</span>
                <span className="files-section-count">{sections[sectionName].length}</span>
              </div>

              <div className="files-list">
                {sections[sectionName].map(entry => (
                  <div key={entry.id} className="files-entry" onClick={() => setViewEntry(entry)}>
                    <TypeBadge type={entry.type || 'other'} />
                    <span className="files-entry-name">{entry.name}</span>
                    {entry.path && <span className="files-entry-path">{entry.path}</span>}
                    <span className="files-entry-desc">{entry.description}</span>
                    {entry.images?.length > 0 && (
                      <span className="files-entry-img-count">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                          <polyline points="21 15 16 10 5 21"/>
                        </svg>
                        {entry.images.length}
                      </span>
                    )}
                    <div className="files-entry-actions" onClick={e => e.stopPropagation()}>
                      <button className="files-action-btn" onClick={() => openEdit(entry)} title="Edit">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      {confirmDelete === entry.id ? (
                        <>
                          <button className="files-action-btn files-action-confirm" onClick={() => handleDelete(entry.id)} title="Confirm">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </button>
                          <button className="files-action-btn" onClick={() => setConfirmDelete(null)} title="Cancel">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                          </button>
                        </>
                      ) : (
                        <button className="files-action-btn files-action-danger" onClick={() => setConfirmDelete(entry.id)} title="Delete">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}

        </div>
      </div>

      {/* ── Detail view modal ── */}
      {viewEntry && (
        <ModalPortal>
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewEntry(null); }}>
          <div className="modal files-detail-modal">
            <div className="modal-header files-detail-header">
              <div className="files-detail-title-row">
                <TypeBadge type={viewEntry.type || 'other'} />
                <h2 className="files-detail-name">{viewEntry.name}</h2>
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewEntry(null)}>✕</button>
            </div>

            <div className="modal-body files-detail-body">
              <div className="files-detail-meta-row">
                <div className="files-detail-field">
                  <span className="label" style={{ marginBottom: 4 }}>Path</span>
                  <span className="files-detail-path">{viewEntry.path || '—'}</span>
                </div>
                <div className="files-detail-field">
                  <span className="label" style={{ marginBottom: 4 }}>Section</span>
                  <span className="files-detail-value">{viewEntry.section || '—'}</span>
                </div>
                <div className="files-detail-field">
                  <span className="label" style={{ marginBottom: 4 }}>Type</span>
                  <TypeBadge type={viewEntry.type || 'other'} />
                </div>
              </div>

              <div className="files-detail-desc-block">
                <span className="label" style={{ marginBottom: 8 }}>Description</span>
                {viewEntry.description
                  ? <p className="files-detail-desc-text">{viewEntry.description}</p>
                  : <p className="files-detail-desc-empty">No description added.</p>
                }
              </div>

              {viewEntry.images?.length > 0 && (
                <div className="files-detail-desc-block">
                  <span className="label" style={{ marginBottom: 10 }}>
                    Images
                    <span style={{ marginLeft: 6, fontWeight: 500, textTransform: 'none', letterSpacing: 0, fontSize: 11, color: 'var(--text-dim)' }}>
                      {viewEntry.images.length} attached
                    </span>
                  </span>
                  <div className="files-img-gallery">
                    {viewEntry.images.map((url, i) => (
                      <button
                        key={i}
                        className="files-img-thumb"
                        onClick={() => setLightboxImg(url)}
                      >
                        <img src={url} alt={`Screenshot ${i + 1}`} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-danger btn-sm"
                style={{ marginRight: 'auto' }}
                onClick={() => { setConfirmDelete(viewEntry.id); setViewEntry(null); }}
              >
                Delete
              </button>
              <button className="btn btn-ghost" onClick={() => setViewEntry(null)}>Close</button>
              <button className="btn btn-primary" onClick={() => { openEdit(viewEntry); setViewEntry(null); }}>
                Edit
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Lightbox ── */}
      {lightboxImg && (
        <ModalPortal>
        <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={() => setLightboxImg(null)}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
            <img
              src={lightboxImg}
              alt="Full size"
              style={{ maxWidth: '92vw', maxHeight: '88vh', borderRadius: 10, boxShadow: 'var(--shadow-lg)', display: 'block' }}
            />
            <button
              onClick={() => setLightboxImg(null)}
              style={{ position: 'absolute', top: -14, right: -14, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '50%', width: 32, height: 32, color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}
            >✕</button>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* ── Add / Edit modal ── */}
      {showForm && (
        <ModalPortal>
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>
                {editEntry ? 'Edit File' : 'Add File'}
              </h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>✕</button>
            </div>

            <div className="modal-body">
              <div className="form-grid" style={{ gap: 14 }}>

                <div className="form-grid form-grid-2">
                  <div className="form-group">
                    <label className="label">File Name</label>
                    <input
                      id="files-form-name"
                      className="input"
                      placeholder="e.g. TaskCard.js"
                      value={form.name}
                      onChange={handleNameChange}
                      style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label className="label">Type</label>
                    <select className="input" value={form.type} onChange={setField('type')}>
                      <option value="js">JS</option>
                      <option value="jsx">JSX</option>
                      <option value="ts">TS</option>
                      <option value="tsx">TSX</option>
                      <option value="css">CSS</option>
                      <option value="php">PHP</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label className="label">
                    Path
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>directory location</span>
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. src/components/"
                    value={form.path}
                    onChange={setField('path')}
                    style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
                  />
                </div>

                <div className="form-group">
                  <label className="label">
                    Section
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>used for grouping</span>
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Components"
                    value={form.section}
                    onChange={setField('section')}
                    list="section-suggestions"
                  />
                  <datalist id="section-suggestions">
                    {existingSections.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>

                <div className="form-group">
                  <label className="label">Description</label>
                  <textarea
                    className="input"
                    placeholder="What does this file do?"
                    value={form.description}
                    onChange={setField('description')}
                    rows={3}
                    style={{ resize: 'none' }}
                  />
                </div>

                {/* Images */}
                <div className="form-group">
                  <label className="label">
                    Images
                    <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11, marginLeft: 6 }}>max 3 MB each</span>
                  </label>

                  {pendingImages.length > 0 && (
                    <div className="files-img-strip">
                      {pendingImages.map((img, i) => (
                        <div key={i} className="files-img-strip-item">
                          <img src={img.preview} alt="" />
                          <button
                            type="button"
                            className="files-img-strip-remove"
                            onClick={() => removeImage(i)}
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    className="files-img-add-btn"
                    onClick={() => imgInputRef.current?.click()}
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                      <polyline points="21 15 16 10 5 21"/>
                    </svg>
                    {pendingImages.length > 0 ? 'Add more images' : 'Add images'}
                  </button>
                  <input
                    ref={imgInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleImagePick}
                    style={{ display: 'none' }}
                  />
                </div>

                {formError && <div className="error-msg">⚠ {formError}</div>}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
              {!editEntry && (
                <button className="btn btn-ghost" onClick={handleSaveAndAnother} disabled={saving}>
                  Save & Add Another
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : editEntry ? 'Save Changes' : 'Add File'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}
    </div>
  );
}
