import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import Avatar from '../components/Avatar';
import TaskForm from '../components/TaskForm';
import TaskCard from '../components/TaskCard';
import ModalPortal from '../components/ModalPortal';
import '../components/TaskCard.css';
import './ProjectDetail.css';

const MAX_BYTES = 6 * 1024 * 1024;

const STATUS_META = {
  active:               { label: 'Active',               color: '#818cf8', bg: 'rgba(99,102,241,0.12)',  border: 'rgba(99,102,241,0.35)' },
  ready_for_review:     { label: 'Ready for Review',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
  ready_for_production: { label: 'Ready for Production', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.35)' },
  completed:            { label: 'Completed',            color: '#4ade80', bg: 'rgba(34,197,94,0.12)',   border: 'rgba(34,197,94,0.3)' },
};

function authorName(p) {
  if (!p) return 'Unknown';
  return `${p.first_name || ''} ${p.last_name || ''}`.trim();
}
function initials(p) {
  if (!p) return '?';
  return `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase();
}

export default function ProjectDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTeamId } = useTeam();

  const [project,       setProject]       = useState(null);
  const [projectTasks,  setProjectTasks]  = useState([]);
  const [topComments,   setTopComments]   = useState([]);
  const [replyMap,      setReplyMap]      = useState({});
  const [allCount,      setAllCount]      = useState(0);
  const [profiles,      setProfiles]      = useState({});
  const [usersList,     setUsersList]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [lightbox,      setLightbox]      = useState(null);
  const [showTaskForm,   setShowTaskForm]   = useState(false);
  const [editTask,       setEditTask]       = useState(null);
  const [taskTab,        setTaskTab]        = useState('active');
  const [statusPopover,  setStatusPopover]  = useState(false);
  const statusPopoverRef = useRef();

  // Drag-to-reorder
  const [localTasks,  setLocalTasks]  = useState([]);
  const [orderDirty,  setOrderDirty]  = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [dragging,    setDragging]    = useState(false);
  const [ghostTask,   setGhostTask]   = useState(null);
  const [ghostPos,    setGhostPos]    = useState({ x: 0, y: 0 });
  const [ghostSize,   setGhostSize]   = useState({ w: 300, h: 160 });
  const dragData = useRef({ sourceId: null, offsetX: 0, offsetY: 0 });

  // Edit project
  const [editing,     setEditing]     = useState(false);
  const [editForm,    setEditForm]    = useState({});
  const [editImages,  setEditImages]  = useState([]);
  const [editPending, setEditPending] = useState([]);
  const [editSaving,  setEditSaving]  = useState(false);
  const [editError,   setEditError]   = useState('');
  const editFileRef = useRef();

  // New top-level comment
  const [commentText,   setCommentText]   = useState('');
  const [commentImages, setCommentImages] = useState([]);
  const [commentSaving, setCommentSaving] = useState(false);
  const [commentError,  setCommentError]  = useState('');
  const commentFileRef = useRef();

  // Reply
  const [replyToId,     setReplyToId]     = useState(null);
  const [replyText,     setReplyText]     = useState('');
  const [replyImages,   setReplyImages]   = useState([]);
  const [replySaving,   setReplySaving]   = useState(false);
  const replyFileRef = useRef();

  // Edit / delete comment
  const [editCommentId,      setEditCommentId]      = useState(null);
  const [editCommentText,    setEditCommentText]    = useState('');
  const [editCommentSaving,  setEditCommentSaving]  = useState(false);
  const [deleteCommentId,    setDeleteCommentId]    = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data: proj }, { data: cmts }, profs, { data: ptasks }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_comments').select('*').eq('project_id', id).order('created_at'),
      fetchTeamMembers(activeTeamId),
      supabase.from('tasks').select('*').eq('project_id', id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('updated_at', { ascending: false }),
    ]);

    setProject(proj);
    setProjectTasks(ptasks || []);
    setAllCount((cmts || []).length);

    const top = (cmts || []).filter(c => !c.parent_id);
    const rmap = {};
    (cmts || []).filter(c => c.parent_id).forEach(c => {
      rmap[c.parent_id] = rmap[c.parent_id] ? [...rmap[c.parent_id], c] : [c];
    });
    setTopComments(top);
    setReplyMap(rmap);

    const pmap = {};
    (profs || []).forEach(p => { pmap[p.id] = p; });
    setProfiles(pmap);
    setUsersList(profs || []);
    setLoading(false);

    if (user?.id) {
      // Use proj.updated_at (server time) so updated_at > last_read_at is always false after read
      const readAt = proj?.updated_at || new Date().toISOString();
      await Promise.all([
        supabase.from('project_comment_reads').upsert(
          { user_id: user.id, project_id: id, last_read_at: readAt },
          { onConflict: 'user_id,project_id' }
        ),
        supabase.from('project_reads').upsert(
          { user_id: user.id, project_id: id, last_read_at: readAt },
          { onConflict: 'user_id,project_id' }
        ),
      ]);
      window.dispatchEvent(new CustomEvent('project-read'));
    }
  }, [id, user?.id, activeTeamId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Keep localTasks in sync with DB unless user has unsaved drag changes
  useEffect(() => {
    if (!orderDirty) setLocalTasks(projectTasks);
  }, [projectTasks, orderDirty]);

  /* ── Edit project ── */
  const startEdit = () => {
    setEditForm({ title: project.title, description: project.description || '', link: project.link || '' });
    setEditImages(project.images || []);
    setEditPending([]);
    setEditError('');
    setEditing(true);
  };

  const handleEditFiles = e => {
    const files = Array.from(e.target.files || []);
    editFileRef.current.value = '';
    const added = files.reduce((s, f) => s + f.size, 0);
    const curr  = editPending.reduce((s, p) => s + p.file.size, 0);
    if (curr + added > MAX_BYTES) { setEditError('Images exceed 6 MB.'); return; }
    setEditPending(prev => [...prev, ...files.map(f => ({
      file: f, name: f.name, preview: URL.createObjectURL(f),
    }))]);
  };

  const saveEdit = async () => {
    if (!editForm.title.trim()) { setEditError('Title is required.'); return; }
    setEditSaving(true); setEditError('');
    try {
      const uploaded = [...editImages];
      for (const p of editPending) {
        const ext  = p.file.name.split('.').pop();
        const path = `projects/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('task-images').upload(path, p.file);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from('task-images').getPublicUrl(path);
        uploaded.push({ url: data.publicUrl, name: p.name });
      }
      const { error } = await supabase.from('projects').update({
        ...editForm, images: uploaded, updated_at: new Date().toISOString(),
      }).eq('id', id);
      if (error) throw error;
      setEditing(false);
      fetchAll();
    } catch (err) {
      setEditError(err.message || 'Failed to save');
    } finally {
      setEditSaving(false);
    }
  };

  /* ── Upload images helper ── */
  const uploadImages = async (pending, folder) => {
    const uploaded = [];
    for (const p of pending) {
      const ext  = p.file.name.split('.').pop();
      const path = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await supabase.storage.from('task-images').upload(path, p.file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('task-images').getPublicUrl(path);
      uploaded.push({ url: data.publicUrl, name: p.name });
    }
    return uploaded;
  };

  const markRead = async () => {
    if (!user?.id) return;
    await supabase.from('project_comment_reads').upsert(
      { user_id: user.id, project_id: id, last_read_at: new Date().toISOString() },
      { onConflict: 'user_id,project_id' }
    );
  };

  /* ── Add top-level comment ── */
  const handleCommentFiles = e => {
    const files = Array.from(e.target.files || []);
    commentFileRef.current.value = '';
    setCommentImages(prev => [...prev, ...files.map(f => ({
      file: f, name: f.name, preview: URL.createObjectURL(f),
    }))]);
  };

  const submitComment = async () => {
    if (!commentText.trim() && commentImages.length === 0) return;
    setCommentSaving(true); setCommentError('');
    try {
      const uploaded = await uploadImages(commentImages, 'project-comments');
      const { error } = await supabase.from('project_comments').insert({
        project_id: id, user_id: user?.id,
        content: commentText.trim(), images: uploaded,
      });
      if (error) throw error;
      await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id);
      await markRead();
      setCommentText('');
      commentImages.forEach(p => URL.revokeObjectURL(p.preview));
      setCommentImages([]);
      fetchAll();
    } catch (err) {
      setCommentError(err.message || 'Failed to post');
    } finally {
      setCommentSaving(false);
    }
  };

  /* ── Reply ── */
  const handleReplyFiles = e => {
    const files = Array.from(e.target.files || []);
    replyFileRef.current.value = '';
    setReplyImages(prev => [...prev, ...files.map(f => ({
      file: f, name: f.name, preview: URL.createObjectURL(f),
    }))]);
  };

  const openReply = (commentId) => {
    setReplyToId(commentId);
    setReplyText('');
    replyImages.forEach(p => URL.revokeObjectURL(p.preview));
    setReplyImages([]);
    setEditCommentId(null);
  };

  const cancelReply = () => {
    setReplyToId(null);
    replyImages.forEach(p => URL.revokeObjectURL(p.preview));
    setReplyImages([]);
    setReplyText('');
  };

  const submitReply = async (parentId) => {
    if (!replyText.trim() && replyImages.length === 0) return;
    setReplySaving(true);
    try {
      const uploaded = await uploadImages(replyImages, 'project-comments');
      const { error } = await supabase.from('project_comments').insert({
        project_id: id, user_id: user?.id, parent_id: parentId,
        content: replyText.trim(), images: uploaded,
      });
      if (error) throw error;
      await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', id);
      await markRead();
      setReplyToId(null);
      setReplyText('');
      replyImages.forEach(p => URL.revokeObjectURL(p.preview));
      setReplyImages([]);
      fetchAll();
    } catch (err) {
      /* reply error is silent — could add state if needed */
    } finally {
      setReplySaving(false);
    }
  };

  /* ── Edit comment ── */
  const startEditComment = (c) => {
    setEditCommentId(c.id);
    setEditCommentText(c.content);
    setReplyToId(null);
  };

  const saveEditComment = async () => {
    setEditCommentSaving(true);
    const { error } = await supabase.from('project_comments').update({
      content: editCommentText, updated_at: new Date().toISOString(),
    }).eq('id', editCommentId);
    setEditCommentSaving(false);
    if (!error) { setEditCommentId(null); fetchAll(); }
  };

  /* ── Delete comment ── */
  const confirmDeleteComment = async () => {
    await supabase.from('project_comments').delete().eq('id', deleteCommentId);
    setDeleteCommentId(null);
    fetchAll();
  };

  /* ── Project status ── */
  useEffect(() => {
    if (!statusPopover) return;
    const handler = (e) => {
      if (statusPopoverRef.current && !statusPopoverRef.current.contains(e.target))
        setStatusPopover(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [statusPopover]);

  const handleStatusChange = async (status) => {
    await supabase.from('projects').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    setStatusPopover(false);
    window.dispatchEvent(new CustomEvent('project-updated'));
    fetchAll();
  };

  /* ── Drag to reorder tasks ── */
  const startDrag = useCallback((e, task) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget.closest('.pd-drag-item');
    const rect = el.getBoundingClientRect();
    dragData.current = {
      sourceId: task.id,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    setGhostSize({ w: rect.width, h: rect.height });
    setGhostPos({ x: rect.left, y: rect.top });
    setGhostTask(task);
    setDragging(true);
    setOrderDirty(true);
  }, []);

  const onDragMove = useCallback(e => {
    setGhostPos({
      x: e.clientX - dragData.current.offsetX,
      y: e.clientY - dragData.current.offsetY,
    });
  }, []);

  const onDragEnterCard = useCallback(targetId => {
    const { sourceId } = dragData.current;
    if (!sourceId || sourceId === targetId) return;
    setLocalTasks(prev => {
      const arr  = [...prev];
      const from = arr.findIndex(t => t.id === sourceId);
      const to   = arr.findIndex(t => t.id === targetId);
      if (from === -1 || to === -1) return prev;
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved);
      return arr;
    });
  }, []);

  const endDrag = useCallback(() => {
    dragData.current.sourceId = null;
    setDragging(false);
    setGhostTask(null);
  }, []);

  useEffect(() => {
    if (!dragging) return;
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup',   endDrag);
    return () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup',   endDrag);
    };
  }, [dragging, onDragMove, endDrag]);

  const saveOrder = async () => {
    setSavingOrder(true);
    await Promise.all(
      localTasks.map((t, i) =>
        supabase.from('tasks').update({ sort_order: i }).eq('id', t.id)
      )
    );
    setSavingOrder(false);
    setOrderDirty(false);
  };

  /* ── Hide / unhide comment ── */
  const toggleHideComment = async (commentId, currentHidden) => {
    await supabase.from('project_comments').update({ hidden: !currentHidden }).eq('id', commentId);
    fetchAll();
  };

  /* ── Render a single comment (reused for top-level + replies) ── */
  const renderComment = (c, isReply = false) => {
    const author    = profiles[c.user_id];
    const isEditing = editCommentId === c.id;
    const isDeleting= deleteCommentId === c.id;
    const replies   = replyMap[c.id] || [];

    return (
      <div key={c.id} className={isReply ? 'pd-reply' : 'pd-comment'}>
        <Avatar
          src={author?.avatar_url}
          color={author?.color || '#6366f1'}
          initials={initials(author)}
          size={isReply ? 32 : 40}
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <div className="pd-comment-body">
          <div className="pd-comment-meta">
            <span className="pd-comment-author">{authorName(author)}</span>
            <span className="pd-comment-time">
              {format(new Date(c.created_at), 'MMM d, h:mm a')}
              {c.updated_at && c.updated_at !== c.created_at && (
                <span style={{ color: 'var(--text-dim)', marginLeft: 4 }}>(edited)</span>
              )}
            </span>
          </div>

          {c.hidden && !isEditing ? (
            <div className="pd-comment-hidden">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <span>Comment hidden</span>
              <button className="pd-comment-action-btn" style={{ marginLeft: 8 }} onClick={() => toggleHideComment(c.id, true)}>
                Unhide
              </button>
            </div>
          ) : isEditing ? (
            <div className="pd-comment-edit">
              <textarea
                className="input"
                rows={3}
                style={{ resize: 'vertical', fontSize: 14 }}
                value={editCommentText}
                onChange={e => setEditCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEditComment(); }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={saveEditComment} disabled={editCommentSaving}>
                  {editCommentSaving ? 'Saving…' : 'Save'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditCommentId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {c.content && <p className="pd-comment-text">{c.content}</p>}
              {c.images?.length > 0 && (
                <div className="pd-comment-images">
                  {c.images.map((img, i) => (
                    <button key={i} className="pd-comment-img-thumb" onClick={() => setLightbox(img.url)}>
                      <img src={img.url} alt={img.name || `Image ${i+1}`} />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {isDeleting ? (
            <div className="pd-comment-del-confirm">
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Delete this comment?</span>
              <button className="btn btn-danger btn-sm" onClick={confirmDeleteComment}>Yes, delete</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteCommentId(null)}>Cancel</button>
            </div>
          ) : !isEditing && !c.hidden && (
            <div className="pd-comment-actions">
              {!isReply && (
                <button className="pd-comment-action-btn pd-comment-action-reply" onClick={() => openReply(c.id)}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 00-4-4H4"/>
                  </svg>
                  Reply
                </button>
              )}
              <button className="pd-comment-action-btn" onClick={() => startEditComment(c)}>Edit</button>
              <button className="pd-comment-action-btn" onClick={() => toggleHideComment(c.id, false)}>Hide</button>
              <button className="pd-comment-action-btn pd-comment-action-danger" onClick={() => setDeleteCommentId(c.id)}>Delete</button>
            </div>
          )}

          {/* Inline reply form */}
          {replyToId === c.id && (
            <div className="pd-reply-form">
              <div className="pd-reply-form-top">
                <Avatar
                  src={profiles[user?.id]?.avatar_url}
                  color={profiles[user?.id]?.color || '#6366f1'}
                  initials={profiles[user?.id] ? initials(profiles[user.id]) : '?'}
                  size={30}
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <textarea
                  className="input pd-reply-input"
                  rows={2}
                  placeholder={`Reply to ${authorName(author)}…`}
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitReply(c.id); if (e.key === 'Escape') cancelReply(); }}
                  autoFocus
                />
              </div>
              {replyImages.length > 0 && (
                <div className="project-img-strip" style={{ paddingLeft: 42 }}>
                  {replyImages.map((p, i) => (
                    <div key={i} className="project-img-item project-img-item-new">
                      <img src={p.preview} alt={p.name} />
                      <button type="button" className="project-img-remove"
                        onClick={() => setReplyImages(prev => { const n=[...prev]; URL.revokeObjectURL(n[i].preview); n.splice(i,1); return n; })}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="pd-reply-form-footer">
                <button className="btn btn-ghost btn-sm" onClick={() => replyFileRef.current?.click()}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                  </svg>
                  Image
                </button>
                <input ref={replyFileRef} type="file" accept="image/*" multiple onChange={handleReplyFiles} style={{ display: 'none' }} />
                <button className="btn btn-ghost btn-sm" onClick={cancelReply}>Cancel</button>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => submitReply(c.id)}
                  disabled={replySaving || (!replyText.trim() && replyImages.length === 0)}
                >
                  {replySaving ? 'Posting…' : 'Post Reply'}
                </button>
              </div>
            </div>
          )}

          {/* Nested replies */}
          {replies.length > 0 && (
            <div className="pd-replies">
              {replies.map(r => renderComment(r, true))}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── Loading / not found ── */
  if (loading) return (
    <div className="pd-page fade-in">
      <div className="pd-skeleton loading-pulse" />
    </div>
  );

  if (!project) return (
    <div className="pd-page fade-in">
      <p style={{ color: 'var(--text-muted)' }}>Project not found.</p>
    </div>
  );

  return (
    <div className="pd-page fade-in">
      {/* Sticky header */}
      <div className="pd-header">
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/projects')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Projects
        </button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowTaskForm(true)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            New Task
          </button>

          {/* Status button + popover */}
          <div style={{ position: 'relative' }}>
            {(() => {
              const pStatus = project?.status || 'active';
              const sm = STATUS_META[pStatus] || STATUS_META.active;
              return (
                <>
                  <button
                    className="btn btn-sm"
                    onClick={() => setStatusPopover(v => !v)}
                    style={{
                      gap: 7,
                      background: sm.bg,
                      border: `1px solid ${sm.border}`,
                      color: sm.color,
                      fontWeight: 700,
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: sm.color, flexShrink: 0, display: 'inline-block', boxShadow: `0 0 6px ${sm.color}` }} />
                    {sm.label}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </button>
                  {statusPopover && (
                    <div ref={statusPopoverRef} style={{
                      position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                      background: 'var(--bg-3)', border: '1px solid var(--border-light)',
                      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
                      padding: 6, minWidth: 210, zIndex: 50, animation: 'fadeIn 0.15s ease',
                      display: 'flex', flexDirection: 'column', gap: 2,
                    }}>
                      {Object.entries(STATUS_META).map(([key, meta]) => (
                        <button
                          key={key}
                          onClick={() => handleStatusChange(key)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 12px', border: 'none', borderRadius: 'var(--radius)',
                            background: pStatus === key ? 'var(--bg-4)' : 'none',
                            cursor: 'pointer', fontSize: 13, textAlign: 'left', width: '100%',
                            color: pStatus === key ? 'var(--text)' : 'var(--text-muted)',
                            fontWeight: pStatus === key ? 700 : 400,
                            transition: 'background 0.12s ease',
                          }}
                          onMouseEnter={e => { if (pStatus !== key) e.currentTarget.style.background = 'var(--bg-4)'; }}
                          onMouseLeave={e => { if (pStatus !== key) e.currentTarget.style.background = 'none'; }}
                        >
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                          {meta.label}
                          {pStatus === key && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', color: meta.color }}>
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          {!editing && (
            <button className="btn btn-secondary btn-sm" onClick={startEdit}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Edit
            </button>
          )}
        </div>
      </div>

      <div className="pd-body">
        {/* ── Left: project info ── */}
        <div className="pd-main">
          {!editing ? (
            <div className="pd-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <h1 className="pd-title" style={{ margin: 0 }}>{project.title}</h1>
                {(() => {
                  const pStatus = project.status || 'active';
                  const sm = STATUS_META[pStatus] || STATUS_META.active;
                  return (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      background: sm.bg, border: `1px solid ${sm.border}`,
                      color: sm.color, fontWeight: 700, fontSize: 12,
                      padding: '4px 12px', borderRadius: 20,
                      letterSpacing: '0.02em',
                    }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: sm.color, boxShadow: `0 0 6px ${sm.color}`, flexShrink: 0 }} />
                      {sm.label}
                    </span>
                  );
                })()}
              </div>
              {project.link && (
                <a href={project.link} target="_blank" rel="noreferrer" className="pd-link">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>
                  </svg>
                  {project.link}
                </a>
              )}
              {project.description && <p className="pd-description">{project.description}</p>}
              {project.images?.length > 0 && (
                <div className="pd-gallery">
                  {project.images.map((img, i) => (
                    <button key={i} className="pd-gallery-thumb" onClick={() => setLightbox(img.url)}>
                      <img src={img.url} alt={img.name || `Image ${i+1}`} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="pd-edit-form">
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', marginBottom: 16 }}>Edit Project</h2>
              <div className="form-grid" style={{ gap: 14 }}>
                <div className="form-group">
                  <label className="label">Title</label>
                  <input className="input" value={editForm.title}
                    onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Description</label>
                  <textarea className="input" rows={4} style={{ resize: 'vertical' }}
                    value={editForm.description}
                    onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Link</label>
                  <input className="input" placeholder="https://…" value={editForm.link}
                    onChange={e => setEditForm(f => ({ ...f, link: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label className="label">Images</label>
                  {(editImages.length > 0 || editPending.length > 0) && (
                    <div className="project-img-strip">
                      {editImages.map((img, i) => (
                        <div key={`ex-${i}`} className="project-img-item">
                          <img src={img.url} alt={img.name} />
                          <button type="button" className="project-img-remove"
                            onClick={() => setEditImages(prev => prev.filter((_, idx) => idx !== i))}>✕</button>
                        </div>
                      ))}
                      {editPending.map((p, i) => (
                        <div key={`pe-${i}`} className="project-img-item project-img-item-new">
                          <img src={p.preview} alt={p.name} />
                          <button type="button" className="project-img-remove"
                            onClick={() => setEditPending(prev => { const n=[...prev]; URL.revokeObjectURL(n[i].preview); n.splice(i,1); return n; })}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button type="button" className="attach-add-btn" onClick={() => editFileRef.current?.click()}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                    </svg>
                    Add images
                  </button>
                  <input ref={editFileRef} type="file" accept="image/*" multiple onChange={handleEditFiles} style={{ display: 'none' }} />
                </div>
                {editError && <div className="error-msg">⚠ {editError}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveEdit} disabled={editSaving}>
                    {editSaving ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Tasks linked to this project ── */}
        {(() => {
          const activeTasks    = localTasks.filter(t => t.status !== 'completed');
          const completedTasks = localTasks.filter(t => t.status === 'completed');
          const visibleTasks   = taskTab === 'active' ? activeTasks : completedTasks;
          if (projectTasks.length === 0) return null;
          return (
            <div className="pd-tasks">
              <div className="pd-tasks-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2"/>
                </svg>
                Tasks
                <div className="pd-task-tabs">
                  <button
                    className={`pd-task-tab ${taskTab === 'active' ? 'pd-task-tab-active' : ''}`}
                    onClick={() => setTaskTab('active')}
                  >
                    Active
                    <span className="pd-task-tab-count">{activeTasks.length}</span>
                  </button>
                  <button
                    className={`pd-task-tab ${taskTab === 'completed' ? 'pd-task-tab-active' : ''}`}
                    onClick={() => setTaskTab('completed')}
                  >
                    Completed
                    <span className="pd-task-tab-count">{completedTasks.length}</span>
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', alignItems: 'center' }}>
                  {!orderDirty && visibleTasks.length > 1 && (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }}>drag to reorder</span>
                  )}
                  {orderDirty && (
                    <button className="btn btn-secondary btn-sm" onClick={saveOrder} disabled={savingOrder}>
                      {savingOrder ? 'Saving…' : 'Save Order'}
                    </button>
                  )}
                  <button className="btn btn-primary btn-sm" onClick={() => setShowTaskForm(true)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    New Task
                  </button>
                </div>
              </div>
              {visibleTasks.length === 0 ? (
                <p style={{ padding: '28px 20px', fontSize: 13, color: 'var(--text-dim)', margin: 0, textAlign: 'center' }}>
                  {taskTab === 'active' ? 'No active tasks.' : 'No completed tasks yet.'}
                </p>
              ) : (
                <div className={`pd-task-grid ${dragging ? 'pd-task-grid-dragging' : ''}`}>
                  {visibleTasks.map(t => {
                    const isSource = dragging && dragData.current.sourceId === t.id;
                    return (
                      <div
                        key={t.id}
                        onMouseEnter={() => onDragEnterCard(t.id)}
                        className={`pd-drag-item ${isSource ? 'pd-drag-placeholder' : ''}`}
                      >
                        <div className="pd-drag-handle" onMouseDown={e => startDrag(e, t)} title="Drag to reorder">
                          <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                            <circle cx="7" cy="4"  r="1.5"/><circle cx="13" cy="4"  r="1.5"/>
                            <circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>
                            <circle cx="7" cy="16" r="1.5"/><circle cx="13" cy="16" r="1.5"/>
                          </svg>
                        </div>
                        <TaskCard
                          task={t}
                          onEdit={setEditTask}
                          onDeleted={fetchAll}
                          users={usersList}
                          projects={project ? [{ id: project.id, title: project.title }] : []}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Right: comments ── */}
        <div className="pd-comments">
          <div className="pd-comments-header">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            Comments
            <span className="pd-comment-count">{allCount}</span>
          </div>

          <div className="pd-comment-list">
            {topComments.length === 0 && (
              <p className="pd-no-comments">No comments yet. Be the first to add one.</p>
            )}
            {topComments.map(c => renderComment(c, false))}
          </div>

          {/* Add comment */}
          <div className="pd-add-comment">
            <div className="pd-add-comment-top">
              <Avatar
                src={profiles[user?.id]?.avatar_url}
                color={profiles[user?.id]?.color || '#6366f1'}
                initials={profiles[user?.id] ? initials(profiles[user.id]) : '?'}
                size={40}
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <textarea
                className="input pd-comment-input"
                rows={3}
                placeholder="Add a comment…"
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment(); }}
              />
            </div>
            {commentImages.length > 0 && (
              <div className="project-img-strip" style={{ paddingLeft: 52 }}>
                {commentImages.map((p, i) => (
                  <div key={i} className="project-img-item project-img-item-new">
                    <img src={p.preview} alt={p.name} />
                    <button type="button" className="project-img-remove"
                      onClick={() => setCommentImages(prev => { const n=[...prev]; URL.revokeObjectURL(n[i].preview); n.splice(i,1); return n; })}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <div className="pd-comment-footer">
              <button className="btn btn-ghost btn-sm" onClick={() => commentFileRef.current?.click()}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
                </svg>
                Image
              </button>
              <input ref={commentFileRef} type="file" accept="image/*" multiple onChange={handleCommentFiles} style={{ display: 'none' }} />
              {commentError && <span className="error-msg" style={{ fontSize: 12 }}>⚠ {commentError}</span>}
              <button
                className="btn btn-primary btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={submitComment}
                disabled={commentSaving || (!commentText.trim() && commentImages.length === 0)}
              >
                {commentSaving ? 'Posting…' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showTaskForm && (
        <TaskForm
          onClose={() => setShowTaskForm(false)}
          onSaved={() => { setShowTaskForm(false); fetchAll(); }}
          users={usersList}
          projects={project ? [{ id: project.id, title: project.title }] : []}
          defaultProjectId={id}
        />
      )}
      {editTask && (
        <TaskForm
          task={editTask}
          onClose={() => setEditTask(null)}
          onSaved={() => { setEditTask(null); fetchAll(); }}
          users={usersList}
          projects={project ? [{ id: project.id, title: project.title }] : []}
        />
      )}

      {/* Drag ghost — follows the cursor */}
      {dragging && ghostTask && (
        <div
          className="pd-ghost"
          style={{
            position: 'fixed',
            top:  ghostPos.y,
            left: ghostPos.x,
            width: ghostSize.w,
            pointerEvents: 'none',
            zIndex: 9000,
          }}
        >
          <div className="pd-ghost-card">
            <div className="pd-ghost-label">
              <svg width="11" height="11" viewBox="0 0 20 20" fill="currentColor">
                <circle cx="7" cy="4" r="1.5"/><circle cx="13" cy="4" r="1.5"/>
                <circle cx="7" cy="10" r="1.5"/><circle cx="13" cy="10" r="1.5"/>
                <circle cx="7" cy="16" r="1.5"/><circle cx="13" cy="16" r="1.5"/>
              </svg>
              Moving
            </div>
            <div className="pd-ghost-page">{ghostTask.page || 'Untitled'}</div>
            {ghostTask.feedback && (
              <p className="pd-ghost-feedback" dangerouslySetInnerHTML={{ __html: ghostTask.feedback }} />
            )}
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <ModalPortal>
          <div className="modal-overlay" style={{ zIndex: 2000 }} onClick={() => setLightbox(null)}>
            <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
              <img src={lightbox} alt="" style={{ maxWidth: '90vw', maxHeight: '85vh', borderRadius: 12, boxShadow: 'var(--shadow-lg)' }} />
              <button onClick={() => setLightbox(null)} style={{ position: 'absolute', top: -12, right: -12, background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: '50%', width: 32, height: 32, color: 'var(--text)', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
