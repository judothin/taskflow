import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTeam } from './TeamContext';
import { fetchUserPrefs, saveUserPrefs, saveUserPrefsDebounced } from '../lib/userPrefs';

// ── Notification types ──────────────────────────────────────
// `task_completed` is intentionally red — completions must grab attention.
export const NOTIF_TYPES = {
  task_completed: { label: 'Task completed',  color: '#ef4444' },
  task_created:   { label: 'Task created',    color: '#3b82f6' },
  comment:        { label: 'Project comment', color: '#a78bfa' },
  submission:     { label: 'Guest submission',color: '#f59e0b' },
  file_added:     { label: 'File added',      color: '#2dd4bf' },
};

const DEFAULT_SETTINGS = {
  types: { task_completed: true, task_created: true, comment: true, submission: true, file_added: true },
  completedScope: 'all',     // 'all' | 'selected'
  completedPeople: [],       // names matched against tasks.completed_by when scope === 'selected'
  includeSelf: false,        // notify me about things *I* do — off by default (people rarely want to be pinged for their own actions)
};

const WINDOW_DAYS = 30;
const MAX_ITEMS = 120;

const NotificationContext = createContext({});
export const useNotifications = () => useContext(NotificationContext);

const settingsKey = (uid) => `tf-notif-settings-${uid || 'anon'}`;
const readsKey    = (uid) => `tf-notif-reads-${uid || 'anon'}`;

function normalizeSettings(parsed) {
  return {
    ...DEFAULT_SETTINGS,
    ...(parsed || {}),
    types: { ...DEFAULT_SETTINGS.types, ...(parsed?.types || {}) },
    completedPeople: Array.isArray(parsed?.completedPeople) ? parsed.completedPeople : [],
  };
}

function loadSettings(uid) {
  try {
    const raw = localStorage.getItem(settingsKey(uid));
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw));
  } catch { return DEFAULT_SETTINGS; }
}

function loadReads(uid) {
  try {
    const raw = localStorage.getItem(readsKey(uid));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function NotificationProvider({ children }) {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const uid = user?.id;
  // The signed-in user's display name, used to recognise notifications about
  // their own activity (completions store a name string, not an id).
  const myName = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim().toLowerCase();

  const [items, setItems]       = useState([]);     // raw notifications (unfiltered)
  const [settings, setSettings] = useState(() => loadSettings(uid));
  const [reads, setReads]       = useState(() => loadReads(uid));
  const [people, setPeople]     = useState([]);     // full names for the per-person filter

  // Lookup maps for enriching realtime events that arrive without joins.
  const profilesRef = useRef({});   // id -> "First Last"
  const profileMetaRef = useRef({}); // lowercased "first last" -> { avatar_url, color }
  const projectsRef = useRef({});   // id -> title
  const seenRef     = useRef(new Set());

  // Reload per-user persisted state when the signed-in user changes, then
  // reconcile settings with the server so they're identical across devices.
  useEffect(() => {
    setSettings(loadSettings(uid));
    setReads(loadReads(uid));
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const prefs = await fetchUserPrefs(uid);
      if (cancelled) return;
      if (prefs && prefs.notif_settings) {
        const remote = normalizeSettings(prefs.notif_settings);
        setSettings(remote);
        try { localStorage.setItem(settingsKey(uid), JSON.stringify(remote)); } catch {}
      } else {
        saveUserPrefs(uid, { notif_settings: loadSettings(uid) });
      }

      // Reconcile read-state: union of what this device knows and what the
      // server has, so viewing a notification on one device carries over.
      const remoteReads = Array.isArray(prefs?.notif_reads) ? prefs.notif_reads : null;
      if (remoteReads) {
        setReads(prev => {
          const union = new Set([...prev, ...remoteReads]);
          const arr = [...union].slice(-1000);
          try { localStorage.setItem(readsKey(uid), JSON.stringify(arr)); } catch {}
          if (union.size !== remoteReads.length) saveUserPrefs(uid, { notif_reads: arr });
          return union;
        });
      } else {
        // No server read-state yet — seed it from this device.
        const local = [...loadReads(uid)].slice(-1000);
        if (local.length) saveUserPrefs(uid, { notif_reads: local });
      }
    })();
    return () => { cancelled = true; };
  }, [uid]);

  const addItems = useCallback((incoming) => {
    setItems(prev => {
      const map = new Map(prev.map(n => [n.id, n]));
      incoming.forEach(n => { if (n && !map.has(n.id)) map.set(n.id, n); });
      return [...map.values()]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, MAX_ITEMS);
    });
  }, []);

  const buildTaskNotifs = useCallback((task) => {
    const out = [];
    if (!task) return out;
    const title = task.page || 'Untitled task';
    if (task.created_at) {
      out.push({
        id: `tk-${task.id}`, type: 'task_created', createdAt: task.created_at,
        title, subtitle: `New task · ${task.roi || 'medium'} ROI`,
        from: profilesRef.current[task.created_by] || task.noticed_by || null,
        data: { kind: 'task', task },
      });
    }
    if (task.status === 'completed' && task.date_completed) {
      out.push({
        id: `tc-${task.id}`, type: 'task_completed', createdAt: task.date_completed,
        title, subtitle: 'Task completed',
        from: task.completed_by || null,
        data: { kind: 'task', task },
      });
    }
    return out;
  }, []);

  // ── Initial backfill ─────────────────────────────────────
  const backfill = useCallback(async () => {
    if (!activeTeamId) return;
    const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();

    const results = await Promise.allSettled([
      supabase.from('profiles').select('id, first_name, last_name, avatar_url, color'),
      supabase.from('tasks').select('*').eq('team_id', activeTeamId).order('created_at', { ascending: false }).limit(80),
      supabase.from('projects').select('id, title').eq('team_id', activeTeamId),
      supabase.from('submissions').select('*').eq('team_id', activeTeamId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(30),
      supabase.from('file_entries').select('*').eq('team_id', activeTeamId).gte('created_at', since)
        .order('created_at', { ascending: false }).limit(30),
    ]);
    const val = (i) => (results[i].status === 'fulfilled' ? results[i].value.data : null) || [];

    const profs = val(0);
    profs.forEach(p => {
      const full = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      profilesRef.current[p.id] = full;
      if (full) profileMetaRef.current[full.toLowerCase()] = { avatar_url: p.avatar_url || null, color: p.color || '#6366f1' };
    });
    setPeople(profs.map(p => `${p.first_name || ''} ${p.last_name || ''}`.trim()).filter(Boolean).sort());

    const projs = val(2);
    projectsRef.current = {};
    projs.forEach(p => { projectsRef.current[p.id] = p.title; });

    // project_comments has no team_id of its own — scope it to this team's
    // project ids (fetched above) rather than the whole comments table.
    const projectIds = projs.map(p => p.id);
    const { data: comments } = projectIds.length
      ? await supabase.from('project_comments').select('id, project_id, user_id, content, created_at')
          .in('project_id', projectIds).gte('created_at', since).order('created_at', { ascending: false }).limit(40)
      : { data: [] };

    const out = [];
    val(1).forEach(t => out.push(...buildTaskNotifs(t)));
    (comments || []).forEach(c => out.push({
      id: `cm-${c.id}`, type: 'comment', createdAt: c.created_at,
      title: projectsRef.current[c.project_id] || 'a project',
      subtitle: 'New comment',
      from: profilesRef.current[c.user_id] || 'Someone',
      data: { kind: 'comment', comment: c, projectId: c.project_id, projectTitle: projectsRef.current[c.project_id] },
    }));
    val(3).forEach(s => out.push({
      id: `sb-${s.id}`, type: 'submission', createdAt: s.created_at,
      title: s.page || 'Guest submission',
      subtitle: 'Guest submission',
      from: s.noticed_by || 'a guest',
      data: { kind: 'submission', submission: s },
    }));
    val(4).forEach(f => out.push({
      id: `fl-${f.id}`, type: 'file_added', createdAt: f.created_at || new Date().toISOString(),
      title: f.name || f.title || 'New file',
      subtitle: 'Added to Files',
      data: { kind: 'file', file: f },
    }));

    out.forEach(n => seenRef.current.add(n.id));
    addItems(out);
  }, [activeTeamId, addItems, buildTaskNotifs]);

  useEffect(() => {
    if (!uid || !activeTeamId) { setItems([]); return; }
    setItems([]); // clear the previous team's feed immediately when switching
    seenRef.current = new Set();
    backfill();

    const teamFilter = `team_id=eq.${activeTeamId}`;
    const channel = supabase
      .channel(`notif-feed-${activeTeamId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tasks', filter: teamFilter },
        (p) => addItems(buildTaskNotifs(p.new)))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tasks', filter: teamFilter },
        (p) => addItems(buildTaskNotifs(p.new)))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'project_comments' },
        (p) => {
          const c = p.new;
          if (!projectsRef.current[c.project_id]) return; // not a project in this team
          addItems([{
            id: `cm-${c.id}`, type: 'comment', createdAt: c.created_at || new Date().toISOString(),
            title: projectsRef.current[c.project_id] || 'a project',
            subtitle: 'New comment',
            from: profilesRef.current[c.user_id] || 'Someone',
            data: { kind: 'comment', comment: c, projectId: c.project_id, projectTitle: projectsRef.current[c.project_id] },
          }]);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: teamFilter },
        (p) => {
          const s = p.new;
          addItems([{
            id: `sb-${s.id}`, type: 'submission', createdAt: s.created_at || new Date().toISOString(),
            title: s.page || 'Guest submission', subtitle: 'Guest submission',
            from: s.noticed_by || 'a guest',
            data: { kind: 'submission', submission: s },
          }]);
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'file_entries', filter: teamFilter },
        (p) => {
          const f = p.new;
          addItems([{
            id: `fl-${f.id}`, type: 'file_added', createdAt: f.created_at || new Date().toISOString(),
            title: f.name || f.title || 'New file', subtitle: 'Added to Files',
            data: { kind: 'file', file: f },
          }]);
        })
      .subscribe();

    // Fallbacks so the feed stays live even if realtime replication isn't
    // enabled for a table: poll periodically, refresh when the tab regains
    // focus, and re-read on the app's own mutation events.
    const poll = setInterval(backfill, 30000);
    const onVisible = () => { if (document.visibilityState === 'visible') backfill(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', backfill);
    window.addEventListener('tasks-changed', backfill);
    window.addEventListener('queue-changed', backfill);
    window.addEventListener('project-updated', backfill);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', backfill);
      window.removeEventListener('tasks-changed', backfill);
      window.removeEventListener('queue-changed', backfill);
      window.removeEventListener('project-updated', backfill);
    };
  }, [uid, activeTeamId, backfill, addItems, buildTaskNotifs]);

  // ── Settings ─────────────────────────────────────────────
  const updateSettings = useCallback((next) => {
    setSettings(prev => {
      const merged = typeof next === 'function' ? next(prev) : { ...prev, ...next };
      try { localStorage.setItem(settingsKey(uid), JSON.stringify(merged)); } catch {}
      saveUserPrefs(uid, { notif_settings: merged }); // sync across devices
      return merged;
    });
  }, [uid]);

  // ── Read state (synced across devices) ───────────────────
  const persistReads = useCallback((set) => {
    const arr = [...set].slice(-1000); // cap growth; ids are stable & de-duped
    try { localStorage.setItem(readsKey(uid), JSON.stringify(arr)); } catch {}
    saveUserPrefsDebounced(uid, { notif_reads: arr });
  }, [uid]);

  const markRead = useCallback((id) => {
    setReads(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev); next.add(id); persistReads(next); return next;
    });
  }, [persistReads]);

  // Resolve a notification's `from` name to that teammate's profile picture +
  // color, so the feed can show their pfp. Returns null for names with no
  // matching profile (e.g. guest submitters) — the UI falls back to an initial.
  const senderMeta = useCallback((name) => {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    return profileMetaRef.current[key]
      || profileMetaRef.current[key.split(',')[0].trim()]  // completed_by can list several names
      || null;
  }, []);

  // Is this notification about something the signed-in user did themselves?
  // task_created / comment carry the actor's id; task_completed stores a
  // (possibly comma-separated) list of names. Guest submissions and file
  // adds aren't attributable to a signed-in teammate, so they're never "self".
  const isSelf = useCallback((n) => {
    const d = n.data || {};
    if (n.type === 'comment') return !!uid && d.comment?.user_id === uid;
    if (n.type === 'task_created') return !!uid && d.task?.created_by === uid;
    if (n.type === 'task_completed') {
      if (!myName) return false;
      return (d.task?.completed_by || '')
        .split(',').map(s => s.trim().toLowerCase()).includes(myName);
    }
    return false;
  }, [uid, myName]);

  // ── Settings-aware filtering ─────────────────────────────
  const passesSettings = useCallback((n) => {
    if (!settings.types[n.type]) return false;
    if (!settings.includeSelf && isSelf(n)) return false;
    if (n.type === 'task_completed' && settings.completedScope === 'selected') {
      const by = (n.data?.task?.completed_by || '').toLowerCase();
      if (!settings.completedPeople.length) return false;
      return settings.completedPeople.some(name => by.includes(name.toLowerCase()));
    }
    return true;
  }, [settings, isSelf]);

  const visible = items.filter(passesSettings).map(n => ({ ...n, read: reads.has(n.id) }));

  const markAllRead = useCallback(() => {
    setReads(prev => {
      const next = new Set(prev);
      visible.forEach(n => next.add(n.id));
      persistReads(next);
      return next;
    });
  }, [visible, persistReads]);

  const unreadCount = visible.filter(n => !n.read).length;

  return (
    <NotificationContext.Provider value={{
      notifications: visible,
      unreadCount,
      settings,
      updateSettings,
      people,
      senderMeta,
      markRead,
      markAllRead,
    }}>
      {children}
    </NotificationContext.Provider>
  );
}
