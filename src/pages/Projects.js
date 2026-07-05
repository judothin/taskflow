import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { InlineClock } from '../components/dashboardWidgets';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import './Projects.css';

const MAX_BYTES = 6 * 1024 * 1024;
const fmtBytes = b => b < 1024 * 1024 ? `${(b/1024).toFixed(0)} KB` : `${(b/(1024*1024)).toFixed(1)} MB`;

const STATUS_META = {
  active:               { label: 'Active',               cls: 'proj-status-active' },
  ready_for_review:     { label: 'Ready for Review',     cls: 'proj-status-review' },
  ready_for_production: { label: 'Ready for Production', cls: 'proj-status-ready' },
  completed:            { label: 'Completed',            cls: 'proj-status-completed' },
};

function initForm(project) {
  return {
    title:       project?.title       || '',
    description: project?.description || '',
    link:        project?.link        || '',
  };
}

export default function Projects() {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const navigate  = useNavigate();

  const [projects,      setProjects]      = useState([]);
  const [unreadMap,     setUnreadMap]     = useState({});  // comment unreads
  const [unreadSet,     setUnreadSet]     = useState(new Set()); // project-level unreads
  const [loading,       setLoading]       = useState(true);
  const [showForm,      setShowForm]      = useState(false);
  const [editProject,   setEditProject]   = useState(null);
  const [confirmDel,    setConfirmDel]    = useState(null);
  const [deleting,      setDeleting]      = useState(false);
  const [tabFilter,     setTabFilter]     = useState('active');
  const [statusPopover, setStatusPopover] = useState(null);
  const statusPopoverRef = useRef(null);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setLoading(false); return; }
    setLoading(true);
    const [{ data: projs }, { data: comments }, { data: commentReads }, { data: projReads }] = await Promise.all([
      supabase.from('projects').select('*').eq('team_id', activeTeamId).order('updated_at', { ascending: false }),
      supabase.from('project_comments').select('project_id, created_at'),
      supabase.from('project_comment_reads').select('*').eq('user_id', user?.id),
      supabase.from('project_reads').select('project_id, last_read_at').eq('user_id', user?.id),
    ]);

    setProjects(projs || []);

    // Comment unread counts
    const commentReadsMap = {};
    (commentReads || []).forEach(r => { commentReadsMap[r.project_id] = r.last_read_at; });
    const unread = {};
    (comments || []).forEach(c => {
      const last = commentReadsMap[c.project_id];
      if (!last || new Date(c.created_at) > new Date(last))
        unread[c.project_id] = (unread[c.project_id] || 0) + 1;
    });
    setUnreadMap(unread);

    // Project-level unread set (new project / status change / task added)
    const projReadsMap = {};
    (projReads || []).forEach(r => { projReadsMap[r.project_id] = r.last_read_at; });
    const uSet = new Set(
      (projs || [])
        .filter(p => !projReadsMap[p.id] || new Date(p.updated_at) > new Date(projReadsMap[p.id]))
        .map(p => p.id)
    );
    setUnreadSet(uSet);

    setLoading(false);
  }, [user?.id, activeTeamId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Mark all projects visible in a tab as read (project-level + comments)
  const markTabRead = useCallback(async (tabKey, projList) => {
    if (!user?.id || !projList?.length) return;
    const inTab = projList.filter(p => (p.status || 'active') === tabKey);
    if (!inTab.length) return;
    // Use each project's own updated_at so the comparison (updated_at > last_read_at)
    // is always false after marking read, regardless of client/server clock skew
    const rows = inTab.map(p => ({ user_id: user.id, project_id: p.id, last_read_at: p.updated_at }));
    await Promise.all([
      supabase.from('project_reads').upsert(rows, { onConflict: 'user_id,project_id' }),
      supabase.from('project_comment_reads').upsert(rows, { onConflict: 'user_id,project_id' }),
    ]);
    // Optimistically clear local badges for these projects
    const ids = new Set(inTab.map(p => p.id));
    setUnreadSet(prev => { const n = new Set(prev); ids.forEach(id => n.delete(id)); return n; });
    setUnreadMap(prev => { const n = { ...prev }; ids.forEach(id => delete n[id]); return n; });
    window.dispatchEvent(new CustomEvent('project-read'));
  }, [user?.id]);

  // Mark current tab as read whenever tab changes or data first loads
  useEffect(() => {
    if (!loading && projects.length) markTabRead(tabFilter, projects);
  }, [tabFilter, projects, loading, markTabRead]);

  // Close status popover on outside click
  useEffect(() => {
    if (!statusPopover) return;
    const handler = (e) => {
      if (statusPopoverRef.current && !statusPopoverRef.current.contains(e.target))
        setStatusPopover(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [statusPopover]);

  const handleDelete = async () => {
    if (!confirmDel) return;
    setDeleting(true);
    await supabase.from('projects').delete().eq('id', confirmDel);
    setConfirmDel(null);
    setDeleting(false);
    fetchData();
  };

  const handleStatusChange = async (projectId, status) => {
    await supabase.from('projects').update({ status, updated_at: new Date().toISOString() }).eq('id', projectId);
    setStatusPopover(null);
    window.dispatchEvent(new CustomEvent('project-updated'));
    fetchData();
  };

  const openCreate = () => { setEditProject(null); setShowForm(true); };
  const openEdit   = (p, e) => { e.stopPropagation(); setEditProject(p); setShowForm(true); };

  const totalUnread = Object.values(unreadMap).reduce((s, n) => s + n, 0);

  const tabs = [
    { key: 'active',               label: 'Active' },
    { key: 'ready_for_review',     label: 'Ready for Review' },
    { key: 'ready_for_production', label: 'Ready for Production' },
    { key: 'completed',            label: 'Completed' },
  ];

  const filteredProjects = projects.filter(p => (p.status || 'active') === tabFilter);

  // Count of unread projects per tab
  const tabUnread = (key) =>
    projects
      .filter(p => (p.status || 'active') === key)
      .filter(p => unreadSet.has(p.id) || (unreadMap[p.id] || 0) > 0)
      .length;

  return (
    <div className="projects-page fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">
            {filteredProjects.length} project{filteredProjects.length !== 1 ? 's' : ''}
            {totalUnread > 0 && <span className="projects-unread-pill">{totalUnread} new</span>}
          </p>
        </div>
        <div className="page-header-actions">
          <InlineClock />
          <button className="btn btn-primary" onClick={openCreate}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Project
          </button>
        </div>
      </div>

      {/* Status tabs */}
      <div className="proj-tabs">
        {tabs.map(t => {
          const total  = projects.filter(p => (p.status || 'active') === t.key).length;
          const unseen = tabUnread(t.key);
          return (
            <button
              key={t.key}
              className={`proj-tab ${tabFilter === t.key ? 'proj-tab-active' : ''}`}
              onClick={() => { setTabFilter(t.key); markTabRead(t.key, projects); }}
            >
              {t.label}
              <span className="proj-tab-count">{total}</span>
              {unseen > 0 && <span className="proj-tab-unread">{unseen}</span>}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="projects-grid">
          {[1,2,3].map(i => <div key={i} className="project-skeleton loading-pulse" />)}
        </div>
      ) : filteredProjects.length === 0 ? (
        <div className="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
          </svg>
          <h3>No projects here</h3>
          <p>{STATUS_META[tabFilter] ? `No ${STATUS_META[tabFilter].label.toLowerCase()} projects` : 'Create your first project to get started'}</p>
        </div>
      ) : (
        <div className="projects-grid">
          {filteredProjects.map(p => {
            const unread  = unreadMap[p.id] || 0;
            const cover   = p.images?.[0]?.url || null;
            const pStatus = p.status || 'active';
            const sm      = STATUS_META[pStatus];

            return (
              <div
                key={p.id}
                className="project-card"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                {(unread > 0 || unreadSet.has(p.id)) && (
                  <div className="project-unread-badge">{unread > 0 ? unread : '●'}</div>
                )}

                {cover && (
                  <div className="project-card-cover">
                    <img src={cover} alt={p.title} />
                  </div>
                )}

                <div className="project-card-row">
                  <div className="project-card-body">
                    <div className="project-card-title">{p.title}</div>
                    {p.description && (
                      <p className="project-card-desc">{p.description.replace(/<[^>]*>/g, '')}</p>
                    )}
                    <div className="project-card-meta">
                      {pStatus !== 'active' && (
                        <span className={`proj-status-badge ${sm.cls}`}>{sm.label}</span>
                      )}
                      {p.link && (
                        <span className="project-link-badge">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>
                          </svg>
                          Link
                        </span>
                      )}
                      {p.images?.length > 0 && (
                        <span className="project-meta-chip">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                          </svg>
                          {p.images.length}
                        </span>
                      )}
                      <span className="project-meta-date">{format(new Date(p.created_at), 'MMM d, yyyy')}</span>
                    </div>
                  </div>

                  {/* Right-side action sidebar */}
                  <div className="project-card-sidebar" onClick={e => e.stopPropagation()}>

                    {/* Status popover */}
                    {statusPopover === p.id && (
                      <div className="proj-status-popover" ref={statusPopoverRef}>
                        {Object.entries(STATUS_META).map(([key, meta]) => (
                          <button
                            key={key}
                            className={`proj-status-option ${pStatus === key ? 'proj-status-option-active' : ''}`}
                            onClick={() => handleStatusChange(p.id, key)}
                          >
                            <span className={`proj-status-dot proj-status-dot-${key}`} />
                            {meta.label}
                            {pStatus === key && (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto' }}>
                                <polyline points="20 6 9 17 4 12"/>
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Status button */}
                    <button
                      className={`task-action-btn ${statusPopover === p.id ? 'task-action-btn-active' : ''}`}
                      data-tooltip="Set Status"
                      onClick={() => setStatusPopover(v => v === p.id ? null : p.id)}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </button>

                    {/* Edit */}
                    <button className="task-action-btn" data-tooltip="Edit" onClick={e => openEdit(p, e)}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>

                    {/* Delete */}
                    {confirmDel !== p.id ? (
                      <button className="task-action-btn task-action-btn-danger" data-tooltip="Delete" onClick={() => { setConfirmDel(p.id); setStatusPopover(null); }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
                          <path d="M10 11v6 M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
                        </svg>
                      </button>
                    ) : (
                      <>
                        <button className="task-action-btn task-action-btn-confirm" onClick={handleDelete} disabled={deleting}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        </button>
                        <button className="task-action-btn" onClick={() => setConfirmDel(null)}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showForm && (
        <ProjectModal
          project={editProject}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); fetchData(); }}
          userId={user?.id}
          teamId={activeTeamId}
        />
      )}
    </div>
  );
}

function ProjectModal({ project, onClose, onSaved, userId, teamId }) {
  const isEdit = !!project;
  const fileRef = useRef();
  const mdRef   = useRef(false);

  const [form,     setForm]    = useState(() => initForm(project));
  const [existing, setExisting] = useState(() => project?.images || []);
  const [pending,  setPending]  = useState([]);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');

  const pendingBytes = pending.reduce((s, p) => s + p.file.size, 0);

  const handleFiles = e => {
    const files = Array.from(e.target.files || []);
    fileRef.current.value = '';
    if (!files.length) return;
    const added = files.reduce((s, f) => s + f.size, 0);
    if (pendingBytes + added > MAX_BYTES) { setError('Total images exceed 6 MB.'); return; }
    setError('');
    setPending(prev => [...prev, ...files.map(f => ({
      file: f, name: f.name, size: f.size,
      preview: URL.createObjectURL(f),
    }))]);
  };

  const removePending  = i => setPending(prev => { const n = [...prev]; URL.revokeObjectURL(n[i].preview); n.splice(i, 1); return n; });
  const removeExisting = i => setExisting(prev => prev.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    setSaving(true); setError('');
    try {
      const uploaded = [...existing];
      for (const p of pending) {
        const ext  = p.file.name.split('.').pop();
        const path = `projects/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-images').upload(path, p.file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        uploaded.push({ url: data.publicUrl, name: p.name });
      }
      const payload = { ...form, images: uploaded, updated_at: new Date().toISOString() };
      let result;
      if (isEdit) {
        result = await supabase.from('projects').update(payload).eq('id', project.id);
      } else {
        result = await supabase.from('projects').insert({ ...payload, created_by: userId, team_id: teamId, status: 'active' });
      }
      if (result.error) throw result.error;
      onSaved();
    } catch (err) {
      setError(err.message || 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={e => { mdRef.current = e.target === e.currentTarget; }}
      onMouseUp={e => { if (mdRef.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth: 540 }}>
        <div className="modal-header">
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{isEdit ? 'Edit Project' : 'New Project'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-grid" style={{ gap: 14 }}>
            <div className="form-group">
              <label className="label">Title</label>
              <input className="input" placeholder="Project name" value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Description</label>
              <textarea className="input" rows={4} placeholder="What is this project about?"
                style={{ resize: 'vertical', minHeight: 80 }}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label">Link <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>optional</span></label>
              <input className="input" placeholder="https://…" value={form.link}
                onChange={e => setForm(f => ({ ...f, link: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Images</span>
                {pending.length > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-dim)', fontFamily: 'var(--mono)', textTransform: 'none', letterSpacing: 0 }}>
                    {fmtBytes(pendingBytes)} / 6 MB
                  </span>
                )}
              </label>
              {(existing.length > 0 || pending.length > 0) && (
                <div className="project-img-strip">
                  {existing.map((img, i) => (
                    <div key={`ex-${i}`} className="project-img-item">
                      <img src={img.url} alt={img.name} />
                      <button type="button" className="project-img-remove" onClick={() => removeExisting(i)}>✕</button>
                    </div>
                  ))}
                  {pending.map((p, i) => (
                    <div key={`pe-${i}`} className="project-img-item project-img-item-new">
                      <img src={p.preview} alt={p.name} />
                      <button type="button" className="project-img-remove" onClick={() => removePending(i)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" className="attach-add-btn" onClick={() => fileRef.current?.click()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
                Add images
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple onChange={handleFiles} style={{ display: 'none' }} />
            </div>
            {error && <div className="error-msg">⚠ {error}</div>}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}
