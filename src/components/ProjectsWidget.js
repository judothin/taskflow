import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';

export default function ProjectsWidget() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const [projects,      setProjects]      = useState([]);
  const [commentUnread, setCommentUnread] = useState({});
  const [projUnread,    setProjUnread]    = useState(new Set());
  const [loading,       setLoading]       = useState(true);

  const fetchData = useCallback(async () => {
    if (!activeTeamId) { setLoading(false); return; }
    const [{ data: projs }, { data: comments }, { data: commentReads }, { data: projReads }] = await Promise.all([
      supabase.from('projects').select('*').eq('team_id', activeTeamId).order('updated_at', { ascending: false }).limit(5),
      supabase.from('project_comments').select('project_id, created_at'),
      supabase.from('project_comment_reads').select('project_id, last_read_at').eq('user_id', user?.id),
      supabase.from('project_reads').select('project_id, last_read_at').eq('user_id', user?.id),
    ]);

    setProjects(projs || []);

    // Comment unreads
    const cReadsMap = {};
    (commentReads || []).forEach(r => { cReadsMap[r.project_id] = r.last_read_at; });
    const cu = {};
    (comments || []).forEach(c => {
      const last = cReadsMap[c.project_id];
      if (!last || new Date(c.created_at) > new Date(last))
        cu[c.project_id] = (cu[c.project_id] || 0) + 1;
    });
    setCommentUnread(cu);

    // Project-level unreads (status change / task added / new project)
    const pReadsMap = {};
    (projReads || []).forEach(r => { pReadsMap[r.project_id] = r.last_read_at; });
    const pu = new Set(
      (projs || [])
        .filter(p => !pReadsMap[p.id] || new Date(p.updated_at) > new Date(pReadsMap[p.id]))
        .map(p => p.id)
    );
    setProjUnread(pu);

    setLoading(false);
  }, [user?.id, activeTeamId]);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('project-read',    handler);
    window.addEventListener('project-updated', handler);
    return () => {
      window.removeEventListener('project-read',    handler);
      window.removeEventListener('project-updated', handler);
    };
  }, [fetchData]);

  const totalUnread = Object.values(commentUnread).reduce((s, n) => s + n, 0)
    + [...projUnread].filter(id => !commentUnread[id]).length;

  return (
    <div className="sidebar-widget">
      <div className="sidebar-widget-header">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
        </svg>
        Projects
        {totalUnread > 0 && (
          <span style={{
            marginLeft: 'auto',
            background: 'rgba(239,68,68,0.15)',
            color: '#f87171',
            border: '1px solid rgba(239,68,68,0.3)',
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 8,
            fontFamily: 'var(--mono)',
          }}>{totalUnread}</span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: '8px 14px' }}>
          {[1, 2].map(i => (
            <div key={i} className="loading-pulse" style={{ height: 36, borderRadius: 6, marginBottom: 6, background: 'var(--bg-4)' }} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-dim)', padding: '10px 14px', margin: 0 }}>
          No projects yet.
        </p>
      ) : (
        <div className="pw-list">
          {projects.map(p => {
            const cUnread  = commentUnread[p.id] || 0;
            const hasUnread = cUnread > 0 || projUnread.has(p.id);
            const cover    = p.images?.[0]?.url || null;
            return (
              <button
                key={p.id}
                className="pw-item"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                {cover ? (
                  <img src={cover} alt={p.title} className="pw-thumb" />
                ) : (
                  <div className="pw-thumb pw-thumb-empty">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z"/>
                    </svg>
                  </div>
                )}
                <div className="pw-item-body">
                  <span className="pw-item-title">{p.title}</span>
                  <span className="pw-item-date">{format(new Date(p.updated_at), 'MMM d')}</span>
                </div>
                {hasUnread && (
                  <span className="pw-badge">{cUnread > 0 ? cUnread : '●'}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button className="pw-view-all" onClick={() => navigate('/projects')}>
        View all projects
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    </div>
  );
}
