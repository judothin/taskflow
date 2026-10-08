import React from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { WidgetHead } from './dashboardWidgets';
import { useReviewPosts, isWaitingOn, REVIEW_STATUS, isUrl, shortUrl } from '../lib/reviews';
import './ReviewWidget.css';

const ICON = 'M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11';
const MAX_ROWS = 6;

// Dashboard widget for Ready for Review: the posts waiting on you first,
// then everything else still open, then anything sent back for work.
// Clicking a row opens that post on the page.
export default function ReviewWidget() {
  const { user } = useAuth();
  const uid = user?.id;
  const { activeTeamId } = useTeam();
  const { posts, loading } = useReviewPosts(activeTeamId);
  const navigate = useNavigate();

  const mine = posts.filter(p => isWaitingOn(p, uid));
  const open = posts.filter(p => p.status === 'pending' && !isWaitingOn(p, uid));
  const needsWork = posts.filter(p => p.status === 'needs_work');
  const rows = [...mine, ...open, ...needsWork].slice(0, MAX_ROWS);
  const total = mine.length + open.length + needsWork.length;

  return (
    <div className="widget rw">
      <WidgetHead
        icon={ICON}
        title="Ready for Review"
        action={(
          <button className="rw-all" onClick={() => navigate('/review')}>View all</button>
        )}
      />

      <div className="rw-summary">
        <button className={`rw-stat ${mine.length ? 'rw-stat-alert' : ''}`} onClick={() => navigate('/review?tab=mine')}>
          <span className="rw-stat-num">{mine.length}</span>
          <span className="rw-stat-label">Waiting on you</span>
        </button>
        <button className="rw-stat" onClick={() => navigate('/review?tab=open')}>
          <span className="rw-stat-num">{mine.length + open.length}</span>
          <span className="rw-stat-label">Open</span>
        </button>
        <button className="rw-stat" onClick={() => navigate('/review?tab=needs_work')}>
          <span className="rw-stat-num">{needsWork.length}</span>
          <span className="rw-stat-label">Needs work</span>
        </button>
      </div>

      {loading ? (
        <div className="rw-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rw-empty">Nothing waiting for review.</div>
      ) : (
        <div className="rw-list">
          {rows.map(p => {
            const waiting = isWaitingOn(p, uid);
            const s = REVIEW_STATUS[p.status];
            return (
              <button key={p.id} className={`rw-row ${waiting ? 'rw-row-mine' : ''}`}
                onClick={() => navigate(`/review?post=${p.id}`)}>
                <span className={`rw-dot rw-dot-${s.tone}`} title={s.label} />
                <span className="rw-row-body">
                  <span className="rw-row-title">{p.title}</span>
                  <span className="rw-row-meta">
                    {waiting ? 'Needs your review' : s.short}
                    {p.url && isUrl(p.url) && <> · {shortUrl(p.url)}</>}
                  </span>
                </span>
                <span className="rw-row-time">{formatDistanceToNowStrict(new Date(p.updated_at || p.created_at))}</span>
              </button>
            );
          })}
          {total > rows.length && (
            <button className="rw-more" onClick={() => navigate('/review')}>+{total - rows.length} more</button>
          )}
        </div>
      )}
    </div>
  );
}
