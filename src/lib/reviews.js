// ============================================================
// Ready for Review — data helpers
// ------------------------------------------------------------
// Shared by the page (pages/Review.js), its dashboard widget, the sidebar
// badge and the notification feed. Tables and RPCs come from
// supabase-review-migration.sql: status only ever changes through the
// review_* RPCs, which check that the caller is an assigned reviewer (or
// the author/an admin, for resubmitting and editing reviewers).
// ============================================================
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import useRefresh from './useRefresh';

export const REVIEW_STATUS = {
  pending:    { label: 'Waiting for review', short: 'Open',           tone: 'open' },
  approved:   { label: 'Reviewed — ready for live', short: 'Ready for live', tone: 'approved' },
  needs_work: { label: 'Reviewed — needs work', short: 'Needs work',  tone: 'needs-work' },
};

// Fired after any change made from this tab, so lists elsewhere on screen
// (widget, badge) refresh without waiting for realtime.
export const REVIEWS_CHANGED = 'reviews-changed';
export const notifyReviewsChanged = () => window.dispatchEvent(new CustomEvent(REVIEWS_CHANGED));

const POST_SELECT = '*, author:profiles!created_by(id, first_name, last_name, color, avatar_url)';

export const fullName = (p) => (p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : '');
export const initialsOf = (p) =>
  p ? `${p.first_name?.[0] || ''}${p.last_name?.[0] || ''}`.toUpperCase() || '?' : '?';

export const isUrl = (s) => /^https?:\/\/\S+$/i.test((s || '').trim());
export function shortUrl(s) {
  try {
    const u = new URL(s);
    return (u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '')) || s;
  } catch { return s; }
}
// "example.com/page" typed without a scheme still makes a working link.
export const normalizeUrl = (s) => {
  const t = (s || '').trim();
  if (!t || /^https?:\/\//i.test(t)) return t;
  return /^[\w-]+(\.[\w-]+)+/.test(t) ? `https://${t}` : t;
};

// Everything the list needs for one team: posts (newest activity first),
// each with its reviewer ids and comment count.
export async function fetchReviewPosts(teamId) {
  if (!teamId) return [];
  const [{ data: posts, error }, { data: reviewers }, { data: comments }] = await Promise.all([
    supabase.from('review_posts').select(POST_SELECT).eq('team_id', teamId).order('updated_at', { ascending: false }),
    supabase.from('review_reviewers').select('post_id, user_id').eq('team_id', teamId),
    supabase.from('review_comments').select('post_id').eq('team_id', teamId),
  ]);
  if (error) throw error;
  const byPost = {};
  (reviewers || []).forEach(r => { (byPost[r.post_id] = byPost[r.post_id] || []).push(r.user_id); });
  const counts = {};
  (comments || []).forEach(c => { counts[c.post_id] = (counts[c.post_id] || 0) + 1; });
  return (posts || []).map(p => ({ ...p, reviewers: byPost[p.id] || [], commentCount: counts[p.id] || 0 }));
}

// One post's history and comments, oldest first.
export async function fetchReviewThread(postId) {
  const [{ data: events }, { data: comments }] = await Promise.all([
    supabase.from('review_events').select('*').eq('post_id', postId).order('created_at'),
    supabase.from('review_comments').select('*').eq('post_id', postId).order('created_at'),
  ]);
  return { events: events || [], comments: comments || [] };
}

export const isWaitingOn = (post, uid) =>
  !!uid && post.status === 'pending' && post.reviewers.includes(uid);

// ── Mutations ──────────────────────────────────────────────
async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  notifyReviewsChanged();
  return data;
}

export const createReview = ({ teamId, title, url, description, screenshots, reviewers }) =>
  rpc('review_create', {
    p_team_id: teamId, p_title: title, p_url: normalizeUrl(url), p_description: description,
    p_screenshots: screenshots, p_reviewers: reviewers,
  });
export const decideReview = (postId, verdict, note) =>
  rpc('review_decide', { p_post_id: postId, p_verdict: verdict, p_note: note || '' });
export const reopenReview = (postId) => rpc('review_reopen', { p_post_id: postId });
export const resubmitReview = (postId, note) => rpc('review_resubmit', { p_post_id: postId, p_note: note || '' });
export const setReviewers = (postId, reviewers) =>
  rpc('review_set_reviewers', { p_post_id: postId, p_reviewers: reviewers });

export async function updateReview(postId, patch) {
  const { error } = await supabase.from('review_posts').update({
    ...patch, ...(patch.url != null ? { url: normalizeUrl(patch.url) } : {}),
  }).eq('id', postId);
  if (error) throw new Error(error.message);
  notifyReviewsChanged();
}

export async function deleteReview(postId) {
  const { error } = await supabase.from('review_posts').delete().eq('id', postId);
  if (error) throw new Error(error.message);
  notifyReviewsChanged();
}

export async function addReviewComment({ postId, teamId, userId, content }) {
  const { error } = await supabase.from('review_comments')
    .insert({ post_id: postId, team_id: teamId, user_id: userId, content: content.trim() });
  if (error) throw new Error(error.message);
  notifyReviewsChanged();
}

export async function deleteReviewComment(id) {
  const { error } = await supabase.from('review_comments').delete().eq('id', id);
  if (error) throw new Error(error.message);
  notifyReviewsChanged();
}

export async function uploadReviewScreenshot(teamId, file) {
  const ext = (file.name?.split('.').pop() || file.type.split('/')[1] || 'png').toLowerCase();
  const path = `reviews/${teamId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from('task-images').upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return supabase.storage.from('task-images').getPublicUrl(path).data.publicUrl;
}

// ── Team default reviewers ─────────────────────────────────
export async function fetchDefaultReviewers(teamId) {
  if (!teamId) return [];
  const { data } = await supabase.from('review_settings').select('default_reviewers').eq('team_id', teamId).maybeSingle();
  return data?.default_reviewers || [];
}

export async function saveDefaultReviewers(teamId, ids) {
  const { error } = await supabase.from('review_settings')
    .upsert({ team_id: teamId, default_reviewers: ids, updated_at: new Date().toISOString() }, { onConflict: 'team_id' });
  if (error) throw new Error(error.message);
}

// ── Live data hook ─────────────────────────────────────────
// Posts for the active team, kept current by realtime plus this tab's own
// change events (burst-coalesced, latest-only — see useRefresh).
export function useReviewPosts(teamId) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const { run, refresh } = useRefresh(async (isStale) => {
    if (!teamId) { setPosts([]); setLoading(false); return; }
    try {
      const list = await fetchReviewPosts(teamId);
      if (isStale()) return;
      setPosts(list);
      setError('');
    } catch (e) {
      if (isStale()) return;
      setError(e.message || 'Could not load reviews.');
    }
    setLoading(false);
  });

  useEffect(() => {
    setLoading(true);
    run();
    if (!teamId) return undefined;
    const filter = `team_id=eq.${teamId}`;
    const channel = supabase
      .channel(`reviews-${teamId}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_posts', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_reviewers', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_comments', filter }, refresh)
      .subscribe();
    window.addEventListener(REVIEWS_CHANGED, refresh);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(REVIEWS_CHANGED, refresh);
    };
  }, [teamId, run, refresh]);

  return { posts, loading, error, refresh };
}

// How many open posts are waiting on this user's verdict — the sidebar badge.
// A count query rather than the whole list, since the shell is always mounted.
export function useWaitingOnMeCount(teamId, uid) {
  const [count, setCount] = useState(0);
  const { run, refresh } = useRefresh(async (isStale) => {
    if (!teamId || !uid) { setCount(0); return; }
    const { count: n } = await supabase
      .from('review_reviewers')
      .select('post_id, review_posts!inner(status)', { count: 'exact', head: true })
      .eq('team_id', teamId).eq('user_id', uid).eq('review_posts.status', 'pending');
    if (isStale()) return;
    setCount(n || 0);
  });

  useEffect(() => {
    run();
    if (!teamId || !uid) return undefined;
    const filter = `team_id=eq.${teamId}`;
    const channel = supabase
      .channel(`review-badge-${teamId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_posts', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'review_reviewers', filter }, refresh)
      .subscribe();
    window.addEventListener(REVIEWS_CHANGED, refresh);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener(REVIEWS_CHANGED, refresh);
    };
  }, [teamId, uid, run, refresh]);

  return count;
}

// The pre-check: what the author confirms before posting (or resubmitting)
// something for review. Shown as a checklist in the new-post form and the
// resubmit form, and from the page's "Pre-check" button any time.
export const REVIEW_PRECHECK = [
  { id: 'responsive', label: 'Responsive', hint: 'Works on mobile, tablet, and desktop widths' },
  { id: 'resolved',   label: 'Tasks and comments resolved', hint: 'Nothing open on the related tasks or from earlier feedback' },
  { id: 'keyboard',   label: 'Keyboard navigation works', hint: 'Tab order, focus states, Enter/Escape behave' },
  { id: 'debug',      label: 'No leftover debug logs', hint: 'No console.log / debugger / test output left behind' },
];
