import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { awardTaskCreatedXp, awardTaskCompletedXp } from '../lib/xp';
import { bumpTeamStreak } from '../lib/streak';
import { scanNotebookPage, newScanItem } from '../lib/noteScan';
import Avatar from './Avatar';
import ModalPortal from './ModalPortal';
import './NoteScan.css';

// ══════════════════════════════════════════════════════════════
// Scan a notebook page → quick logs (phone only)
// --------------------------------------------------------------
// Photograph a handwritten checklist; every checkbox line becomes a
// quick-log candidate (read on the device — see lib/noteScan.js). Nothing
// is saved until the review screen: each line can be approved or denied,
// reworded, and given its own Page / Area (left blank it's logged as
// "Note scan"). Completed by starts as whoever is signed in.
// ══════════════════════════════════════════════════════════════

const DEFAULT_AREA = 'Note scan';
const LOW_CONFIDENCE = 60;

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nameOf = (u) => `${u?.first_name || ''} ${u?.last_name || ''}`.trim();

const Icon = ({ d, size = 18, width = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
  </svg>
);
const CAMERA = 'M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M12 17a4 4 0 100-8 4 4 0 000 8z';
const IMAGE = 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z M21 15l-5-5L5 21';
const CLOSE = 'M18 6L6 18 M6 6l12 12';
const PLUS = 'M12 5v14 M5 12h14';
const CHECK = 'M20 6L9 17l-5-5';

export default function NoteScan() {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const [status, setStatus] = useState(null); // { stage, progress } while scanning
  const [error, setError] = useState('');
  const [review, setReview] = useState(null); // { items, photoUrl }
  const [logged, setLogged] = useState(0);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError("That file isn't a photo."); return; }
    setError(''); setLogged(0);
    setStatus({ stage: 'Preparing the photo…', progress: 0 });
    try {
      const { items } = await scanNotebookPage(file, setStatus);
      setReview({ items, photoUrl: URL.createObjectURL(file) });
    } catch (err) {
      setError(err?.message || "Couldn't read that page. Try a brighter, straighter photo.");
    } finally {
      setStatus(null);
    }
  };

  const closeReview = () => {
    if (review?.photoUrl) URL.revokeObjectURL(review.photoUrl);
    setReview(null);
  };

  return (
    <div className="card nscan">
      <div className="nscan-head">
        <span className="nscan-icon"><Icon d={CAMERA} /></span>
        <div>
          <h2 className="nscan-title">Scan a notebook page</h2>
          <p className="nscan-sub">Photograph a checklist and each checkbox line becomes a quick log. You'll review everything before it's saved.</p>
        </div>
      </div>

      {status ? (
        <div className="nscan-progress" role="status">
          <div className="nscan-progress-label">{status.stage}</div>
          <div className="nscan-bar"><span style={{ width: `${Math.round((status.progress || 0) * 100)}%` }} /></div>
        </div>
      ) : (
        <div className="nscan-actions">
          <button type="button" className="btn btn-primary" onClick={() => cameraRef.current?.click()}>
            <Icon d={CAMERA} size={16} /> Take photo
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => libraryRef.current?.click()}>
            <Icon d={IMAGE} size={16} /> Choose photo
          </button>
        </div>
      )}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={libraryRef} type="file" accept="image/*" hidden onChange={onFile} />

      {error && <div className="error-msg nscan-msg">⚠ {error}</div>}
      {logged > 0 && (
        <div className="quicklog-success nscan-msg">
          <Icon d={CHECK} size={14} width={2.5} />
          {logged === 1 ? '1 task logged' : `${logged} tasks logged`} from your scan. Marked as completed.
        </div>
      )}

      {review && (
        <ReviewSheet
          initialItems={review.items}
          photoUrl={review.photoUrl}
          teamId={activeTeamId}
          userId={user?.id}
          myName={nameOf(profile)}
          onClose={closeReview}
          onLogged={(n) => { setLogged(n); closeReview(); }}
        />
      )}
    </div>
  );
}

function ReviewSheet({ initialItems, photoUrl, teamId, userId, myName, onClose, onLogged }) {
  const [items, setItems] = useState(initialItems);
  const [members, setMembers] = useState([]);
  const [completedBy, setCompletedBy] = useState(myName ? [myName] : []);
  const [areaForAll, setAreaForAll] = useState('');
  const [showPhoto, setShowPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [armedClose, setArmedClose] = useState(false);

  useEffect(() => { fetchTeamMembers(teamId).then(setMembers); }, [teamId]);
  useEffect(() => {
    if (!armedClose) return undefined;
    const t = setTimeout(() => setArmedClose(false), 3000);
    return () => clearTimeout(t);
  }, [armedClose]);

  const update = (id, patch) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id) => setItems(prev => prev.filter(it => it.id !== id));
  const addItem = () => setItems(prev => [...prev, { ...newScanItem('', true), approved: true }]);
  const setAll = (approved) => setItems(prev => prev.map(it => ({ ...it, approved })));
  const applyArea = () => setItems(prev => prev.map(it => ({ ...it, area: areaForAll })));
  const togglePerson = (name) =>
    setCompletedBy(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));

  const approved = items.filter(it => it.approved);
  const blank = approved.some(it => !it.text.trim());
  const canLog = approved.length > 0 && completedBy.length > 0 && !blank && !saving;

  // Closing with work in it takes a second tap, so a stray tap on the
  // backdrop can't throw away a page of corrections.
  const requestClose = () => {
    if (saving) return;
    if (armedClose || !items.length) onClose();
    else setArmedClose(true);
  };

  const logAll = async () => {
    if (!canLog) return;
    setSaving(true); setError('');
    const now = new Date().toISOString();
    const who = completedBy.join(', ');
    const rows = approved.map(it => ({
      team_id: teamId,
      page: it.area.trim() || DEFAULT_AREA,
      feedback: `<p>${escapeHtml(it.text.trim())}</p>`,
      noticed_by: who,
      completed_by: who,
      status: 'completed',
      roi: 'medium',
      complexity: 'medium',
      date_received: now,
      date_completed: now,
      updated_at: now,
      created_by: userId || null,
    }));
    const { error: err } = await supabase.from('tasks').insert(rows);
    if (err) { setError(err.message); setSaving(false); return; }
    // One at a time: each award reads the user's XP and writes it back, so
    // running them together would let them overwrite one another. In the
    // background — the sheet doesn't wait on it.
    (async () => {
      for (let i = 0; i < rows.length; i++) {
        await awardTaskCreatedXp(userId);
        await awardTaskCompletedXp(userId, 'medium');
      }
    })().catch(() => {});
    bumpTeamStreak(teamId);
    window.dispatchEvent(new CustomEvent('tasks-changed'));
    onLogged(rows.length);
  };

  return (
    <ModalPortal>
      <div className="modal-overlay" onClick={requestClose}>
        <div className="modal nscan-review" onClick={e => e.stopPropagation()}>
          <div className="modal-header nscan-review-head">
            <div>
              <h2 className="nscan-title">Review scan</h2>
              <p className="nscan-sub">
                {items.length
                  ? `${approved.length} of ${items.length} line${items.length === 1 ? '' : 's'} will be logged`
                  : 'No lines were found — add them below.'}
              </p>
            </div>
            <button type="button" className="nscan-icon-btn" onClick={requestClose} aria-label="Close">
              <Icon d={CLOSE} />
            </button>
          </div>

          <div className="modal-body nscan-review-body">
            <button type="button" className="nscan-photo-toggle" onClick={() => setShowPhoto(v => !v)}>
              <Icon d={IMAGE} size={15} /> {showPhoto ? 'Hide photo' : 'Show photo'}
            </button>
            {showPhoto && <img className="nscan-photo" src={photoUrl} alt="The scanned page" />}

            <section className="nscan-section">
              <span className="label">Completed by</span>
              <div className="nscan-people">
                {members.map(m => {
                  const name = nameOf(m);
                  const on = completedBy.includes(name);
                  return (
                    <button key={m.id} type="button" className={`nscan-person ${on ? 'nscan-person-on' : ''}`}
                      onClick={() => togglePerson(name)} aria-pressed={on}>
                      <Avatar src={m.avatar_url} color={m.color || '#6366f1'}
                        initials={`${m.first_name?.[0] || ''}${m.last_name?.[0] || ''}`} size={22} />
                      {name}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="nscan-section">
              <label className="label" htmlFor="nscan-area-all">Page / Area for every line</label>
              <div className="nscan-area-all">
                <input id="nscan-area-all" className="input" value={areaForAll}
                  onChange={e => setAreaForAll(e.target.value)} placeholder={DEFAULT_AREA} />
                <button type="button" className="btn btn-secondary" onClick={applyArea} disabled={!items.length}>Apply</button>
              </div>
            </section>

            <section className="nscan-section">
              <div className="nscan-list-head">
                <span className="label">Lines</span>
                {items.length > 0 && (
                  <span className="nscan-bulk">
                    <button type="button" onClick={() => setAll(true)}>Approve all</button>
                    <button type="button" onClick={() => setAll(false)}>Deny all</button>
                  </span>
                )}
              </div>
              <ul className="nscan-items">
                {items.map(it => (
                  <li key={it.id} className={`nscan-item ${it.approved ? '' : 'nscan-item-off'}`}>
                    <div className="nscan-item-top">
                      <div className="nscan-verdict" role="radiogroup" aria-label="Log this line?">
                        <button type="button" role="radio" aria-checked={it.approved}
                          className={`nscan-approve ${it.approved ? 'nscan-on' : ''}`}
                          onClick={() => update(it.id, { approved: true })}>
                          <Icon d={CHECK} size={14} width={2.5} /> Approve
                        </button>
                        <button type="button" role="radio" aria-checked={!it.approved}
                          className={`nscan-deny ${!it.approved ? 'nscan-on' : ''}`}
                          onClick={() => update(it.id, { approved: false })}>
                          <Icon d={CLOSE} size={14} width={2.5} /> Deny
                        </button>
                      </div>
                      <button type="button" className="nscan-remove" onClick={() => remove(it.id)} aria-label="Remove line">
                        <Icon d={CLOSE} size={14} />
                      </button>
                    </div>
                    {(!it.hasBox || it.confidence < LOW_CONFIDENCE) && (
                      <div className="nscan-flags">
                        {!it.hasBox && <span className="nscan-flag">No checkbox found</span>}
                        {it.confidence < LOW_CONFIDENCE && <span className="nscan-flag nscan-flag-warn">Hard to read — check the wording</span>}
                      </div>
                    )}
                    <textarea className="input nscan-text" rows={2} value={it.text}
                      onChange={e => update(it.id, { text: e.target.value })}
                      placeholder="What was done" aria-label="What was done" />
                    <input className="input nscan-area" value={it.area}
                      onChange={e => update(it.id, { area: e.target.value })}
                      placeholder={DEFAULT_AREA} aria-label="Page / Area" />
                  </li>
                ))}
              </ul>
              <button type="button" className="nscan-add" onClick={addItem}>
                <Icon d={PLUS} size={15} /> Add a line
              </button>
            </section>

            {completedBy.length === 0 && <div className="error-msg">⚠ Pick at least one person under Completed by.</div>}
            {blank && <div className="error-msg">⚠ An approved line is empty — write it in or deny it.</div>}
            {error && <div className="error-msg">⚠ {error}</div>}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>
              {armedClose ? 'Discard scan?' : 'Cancel'}
            </button>
            <button type="button" className="btn btn-primary" onClick={logAll} disabled={!canLog}>
              {saving ? 'Logging…' : `Log ${approved.length} as completed`}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
