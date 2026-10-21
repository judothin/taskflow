import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { fetchTeamMembers } from '../lib/teams';
import { awardTaskCreatedXp, awardTaskCompletedXp } from '../lib/xp';
import { tasksChanged } from '../lib/events';
import useIsPhone from '../lib/useIsPhone';
import { scanNotebookPage, newScanItem, localDay, localTime, scanStamp } from '../lib/noteScan';
import { announceScan } from '../lib/scanBroadcast';
import { Sheet, Icon, Avatar, Lightbox, SheetLabel, toast, fullName, shortDate } from '../ui';
import './NoteScan.css';

// ══════════════════════════════════════════════════════════════
// Scan a notebook page → completed tasks
// --------------------------------------------------------------
// Photograph a handwritten checklist; every checkbox line becomes a
// candidate (read by a vision model — see lib/noteScan.js and
// api/scan-notes.js). Nothing is saved until the review: each line can be
// approved or denied, reworded, and given its own Page / Area (left blank
// it's logged as "Note scan"). Completed by starts as whoever is signed in.
//
// Each line is stamped with when it was done: the page's written date (or
// today) plus a time read beside the line, or one set in the review. Once
// logged, the person's other open TaskFlow tabs and the WordPress panel get
// a notice (lib/scanBroadcast.js → ScanNotifier).
//
// Opened by the 'open-note-scan' event; Layout mounts it while open. Works
// on a desktop too: drop, paste or choose a photo.
// ══════════════════════════════════════════════════════════════

const DEFAULT_AREA = 'Note scan';

const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const missingTitleColumn = (err) => /title/i.test(err?.message || '') && /column|schema/i.test(err?.message || '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export default function NoteScan({ onClose }) {
  const { user, profile } = useAuth();
  const { activeTeamId } = useTeam();
  const navigate = useNavigate();
  const isPhone = useIsPhone();
  const cameraRef = useRef(null);
  const libraryRef = useRef(null);
  const [status, setStatus] = useState(null); // { stage, progress } while scanning
  const [preview, setPreview] = useState(null); // object URL of the photo being read
  const [error, setError] = useState('');
  const [errorKey, setErrorKey] = useState(0);
  const [review, setReview] = useState(null); // { items, date, photoUrl }
  const [logged, setLogged] = useState(0);
  const [flash, setFlash] = useState(0);
  const [over, setOver] = useState(false);
  const [armedClose, setArmedClose] = useState(false);
  const [armKey, setArmKey] = useState(0);
  const saveRef = useRef(null); // the review's "log" handler, for ⌘↵
  // The review renders its own footer into the sheet's footer slot.
  const [footEl, setFootEl] = useState(null);

  // Page names the team already uses, handed to the scanner so a page written
  // beside a line (or as a heading over a group) maps onto an existing one.
  const knownPages = useRef([]);
  useEffect(() => {
    if (!activeTeamId) return;
    supabase.from('tasks').select('page').eq('team_id', activeTeamId)
      .order('date_received', { ascending: false }).limit(400)
      .then(({ data }) => {
        const seen = new Set();
        knownPages.current = (data || []).map(r => (r.page || '').trim())
          .filter(p => p && p !== DEFAULT_AREA && p.length <= 120 && !seen.has(p.toLowerCase()) && seen.add(p.toLowerCase()))
          .slice(0, 80);
      });
  }, [activeTeamId]);

  // Disarm the "close again to discard" after a moment.
  useEffect(() => {
    if (!armedClose) return undefined;
    const t = setTimeout(() => setArmedClose(false), 3000);
    return () => clearTimeout(t);
  }, [armedClose]);

  const fail = (msg) => { setError(msg); setErrorKey(k => k + 1); };

  const scanFile = async (file) => {
    if (!file || status) return;
    if (!file.type.startsWith('image/')) { fail("That file isn't a photo."); return; }
    setError(''); setLogged(0);
    const url = URL.createObjectURL(file);
    setPreview(url);
    setStatus({ stage: 'Preparing the photo…', progress: 0.05 });
    try {
      const { items, date } = await scanNotebookPage(file, setStatus, { pages: knownPages.current });
      setReview({ items, date, photoUrl: url });
    } catch (err) {
      URL.revokeObjectURL(url);
      fail(err?.message || "Couldn't read that page. Try a brighter, straighter photo.");
    } finally {
      setStatus(null);
      setPreview(null);
    }
  };

  const onPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    scanFile(file);
  };

  const shutter = () => {
    setFlash(k => k + 1);
    setTimeout(() => cameraRef.current?.click(), 120);
  };

  const discardReview = () => {
    if (review?.photoUrl) URL.revokeObjectURL(review.photoUrl);
    setReview(null);
    setArmedClose(false);
  };
  useEffect(() => () => { if (review?.photoUrl) URL.revokeObjectURL(review.photoUrl); }, [review]);

  // Closing with a review in progress takes a second try, so a stray tap or
  // swipe can't throw away a page of corrections.
  const requestClose = () => {
    if (review?.items?.length && !armedClose) { setArmedClose(true); setArmKey(k => k + 1); return; }
    onClose();
  };

  const onLogged = (n) => {
    discardReview();
    setLogged(n);
    toast(`${plural(n, 'task')} logged from your scan`, {
      icon: 'camera',
      action: { label: 'View', onClick: () => { onClose(); navigate('/completed'); } },
    });
  };

  // Desktop: paste a photo straight in.
  const onPaste = (e) => {
    if (review) return;
    const file = Array.from(e.clipboardData?.files || []).find(f => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); scanFile(file); }
  };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  const dragDepth = useRef(0);

  const eyebrow = (
    <>
      Scan notes
      <span className="t-4">· {review ? 'Review' : status ? 'Reading' : 'Notebook page'}</span>
    </>
  );

  if (review) {
    return (
      <Sheet
        eyebrow={eyebrow}
        size="sm"
        onClose={requestClose}
        onSubmit={() => saveRef.current?.()}
        className="ns-sheet"
        mainClassName="ns-main"
        footer={<div ref={setFootEl} className="ns-foot-slot" />}
      >
        <ReviewBody
          key={review.photoUrl}
          initialItems={review.items}
          initialDate={review.date}
          photoUrl={review.photoUrl}
          teamId={activeTeamId}
          userId={user?.id}
          myName={fullName(profile)}
          armedClose={armedClose}
          armKey={armKey}
          onCancel={requestClose}
          onRescan={discardReview}
          onLogged={onLogged}
          saveRef={saveRef}
          footEl={footEl}
        />
      </Sheet>
    );
  }

  return (
    <Sheet
      eyebrow={eyebrow}
      size="sm"
      onClose={onClose}
      onPaste={onPaste}
      className="ns-sheet"
      mainClassName="ns-main"
      footer={(
        <>
          <span className="sheet-foot-note">Nothing is saved until you review it.</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
        </>
      )}
    >
      <div className="ns-capture">
        <div className="ns-intro">
          <h2 className="ns-heading">Photograph a checklist</h2>
          <p className="ns-sub">Each checkbox line becomes a completed task. You'll check every line before anything is logged.</p>
        </div>

        {logged > 0 && (
          <div className="notice notice-ok ns-done">
            <Icon name="check" size={15} />
            <span>{plural(logged, 'task')} logged from your scan, marked as completed.</span>
            <button type="button" className="btn-link ns-done-link" onClick={() => { onClose(); navigate('/completed'); }}>View</button>
          </div>
        )}

        <div
          className={`ns-finder ${status ? 'is-scanning' : ''} ${over ? 'is-over' : ''}`}
          role={status ? 'status' : 'button'}
          tabIndex={status ? -1 : 0}
          aria-label={status ? status.stage : 'Choose a photo of the page'}
          onClick={() => { if (!status && !isPhone) libraryRef.current?.click(); }}
          onKeyDown={(e) => { if (!status && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); libraryRef.current?.click(); } }}
          onDragEnter={(e) => { if (!hasFiles(e) || status) return; e.preventDefault(); dragDepth.current += 1; setOver(true); }}
          onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
          onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setOver(false); }}
          onDrop={(e) => {
            if (!e.dataTransfer?.files?.length) return;
            e.preventDefault(); dragDepth.current = 0; setOver(false);
            scanFile(e.dataTransfer.files[0]);
          }}
        >
          <span className="ns-corner ns-c1" /><span className="ns-corner ns-c2" />
          <span className="ns-corner ns-c3" /><span className="ns-corner ns-c4" />
          {flash > 0 && <span key={flash} className="ns-flash" aria-hidden="true" />}
          {preview ? (
            <>
              <img className="ns-finder-img" src={preview} alt="" />
              <span className="ns-sweep" aria-hidden="true" />
            </>
          ) : (
            <div className="ns-finder-empty">
              <span className="ns-finder-icon"><Icon name={isPhone ? 'camera' : 'image'} size={22} /></span>
              <span className="ns-finder-title">{isPhone ? 'Fill the frame with the list' : over ? 'Drop to scan' : 'Drop, paste or choose a photo'}</span>
              <span className="ns-finder-sub">Bright light, page flat, just the list</span>
            </div>
          )}
        </div>

        {status ? (
          <div className="ns-progress" aria-live="polite">
            <div className="ns-progress-top">
              <span key={status.stage} className="ns-progress-label">{status.stage}</span>
              <span className="mono t-3">{Math.round((status.progress || 0) * 100)}%</span>
            </div>
            <div className="ns-bar"><span style={{ transform: `scaleX(${Math.max(0.04, status.progress || 0)})` }} /></div>
          </div>
        ) : (
          <div className="ns-actions">
            {isPhone && (
              <button type="button" className="ns-shutter" onClick={shutter} aria-label="Take photo">
                <span className="ns-shutter-disc" />
              </button>
            )}
            <button type="button" className={`btn ${isPhone ? '' : 'btn-primary btn-lg'}`} onClick={() => libraryRef.current?.click()}>
              <Icon name="image" size={15} />{isPhone ? 'Choose photo' : 'Choose photo'}
            </button>
            {!isPhone && (
              <button type="button" className="btn btn-lg" onClick={() => cameraRef.current?.click()}>
                <Icon name="camera" size={15} />Use camera
              </button>
            )}
          </div>
        )}
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />
        <input ref={libraryRef} type="file" accept="image/*" hidden onChange={onPick} />

        {error && (
          <div key={errorKey} className="notice notice-error wiggle" role="alert">
            <Icon name="alert" size={15} /><span>{error}</span>
          </div>
        )}

        <div className="ns-tips">
          <SheetLabel>How to write it</SheetLabel>
          <ul className="ns-tip-list stagger">
            <li><span className="ns-tip-box" />One checkbox per thing you did</li>
            <li><span className="mono ns-tip-ex">Fix hero - Homepage</span>A page after a dash, or as a heading over a group</li>
            <li><span className="mono ns-tip-ex">10:30</span>A time beside a line stamps when it was done</li>
          </ul>
        </div>
      </div>
    </Sheet>
  );
}

// ── Review ──────────────────────────────────────────────────
function ReviewBody({
  initialItems, initialDate, photoUrl, teamId, userId, myName,
  armedClose, armKey, onCancel, onRescan, onLogged, saveRef, footEl,
}) {
  const [items, setItems] = useState(initialItems);
  const today = localDay();
  const [day, setDay] = useState(initialDate && initialDate <= today ? initialDate : today);
  const [members, setMembers] = useState(null);
  const [completedBy, setCompletedBy] = useState(myName ? [myName] : []);
  const [areaForAll, setAreaForAll] = useState('');
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fetchTeamMembers(teamId).then(m => setMembers(m || [])); }, [teamId]);

  const update = (id, patch) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id) => setItems(prev => prev.filter(it => it.id !== id));
  const addItem = () => setItems(prev => [...prev, newScanItem()]);
  const setAll = (approved) => setItems(prev => prev.map(it => ({ ...it, approved })));
  const applyArea = () => setItems(prev => prev.map(it => ({ ...it, area: areaForAll, areaFromScan: false })));
  const togglePerson = (name) =>
    setCompletedBy(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
  const fillBlankTimes = () => {
    const t = localTime();
    setItems(prev => prev.map(it => (it.time ? it : { ...it, time: t })));
  };

  const approved = items.filter(it => it.approved);
  const timed = items.filter(it => it.time).length;
  const blank = approved.some(it => !it.text.trim());
  const canLog = approved.length > 0 && completedBy.length > 0 && !blank && !saving;

  const logAll = async () => {
    if (!canLog) return;
    setSaving(true); setError('');
    const now = new Date().toISOString();
    const who = completedBy.join(', ');
    // Each line keeps its own moment: the page's day plus its time.
    const rows = approved.map(it => {
      const at = scanStamp(day, it.time).toISOString();
      return {
        team_id: teamId,
        title: it.text.trim(),
        page: it.area.trim() || DEFAULT_AREA,
        feedback: '',
        noticed_by: who,
        completed_by: who,
        status: 'completed',
        roi: 'medium',
        complexity: 'medium',
        date_received: at,
        date_completed: at,
        updated_at: now,
        created_by: userId || null,
      };
    });
    let { error: err } = await supabase.from('tasks').insert(rows);
    if (err && missingTitleColumn(err)) {
      // An older database without the title column: the line becomes the description.
      ({ error: err } = await supabase.from('tasks').insert(
        rows.map(({ title, ...r }) => ({ ...r, feedback: `<p>${escapeHtml(title)}</p>` }))
      ));
    }
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
    tasksChanged();
    announceScan(userId, { count: rows.length, teamId, sample: approved.slice(0, 3).map(it => it.text.trim().slice(0, 80)) });
    onLogged(rows.length);
  };
  saveRef.current = logAll;

  const note = completedBy.length === 0
    ? 'Pick at least one person under Completed by.'
    : blank ? 'An approved line is empty — write it in or deny it.'
      : null;

  return (
    <>
      <div className="ns-review">
        <div className="ns-summary">
          <button type="button" className="ns-thumb" onClick={() => setZoom(true)} aria-label="View the photo">
            <img src={photoUrl} alt="" />
            <span className="ns-thumb-zoom"><Icon name="search" size={13} /></span>
          </button>
          <div className="ns-summary-text">
            <h2 className="ns-heading">
              {items.length ? <><span key={approved.length} className="bump ns-count">{approved.length}</span> of {plural(items.length, 'line')} to log</> : 'No lines found'}
            </h2>
            <p className="ns-sub">
              {items.length
                ? (initialDate ? `Dated ${shortDate(`${initialDate}T12:00`)} on the page` : 'No date on the page — stamped today')
                : 'Nothing with a checkbox came through. Add the lines yourself, or try another photo.'}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm ns-rescan" onClick={onRescan}>
            <Icon name="refresh" size={13} />Rescan
          </button>
        </div>

        {items.length > 0 && (
          <div className="ns-bulk">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(true)}>Approve all</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAll(false)}>Deny all</button>
            {timed < items.length && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={fillBlankTimes}>
                <Icon name="clock" size={13} />Time blanks now
              </button>
            )}
          </div>
        )}

        <ul className="ns-lines stagger">
          {items.map(it => (
            <ScanLine key={it.id} it={it} onChange={(p) => update(it.id, p)} onRemove={() => remove(it.id)} />
          ))}
        </ul>
        <button type="button" className="ns-add" onClick={addItem}>
          <Icon name="plus" size={14} />Add a line
        </button>

        <div className="ns-details">
          <section>
            <SheetLabel sub="Everyone picked shares the credit">Completed by</SheetLabel>
            {members === null ? (
              <div className="chip-row">{[90, 120, 100].map((w, i) => <span key={i} className="skel ns-chip-skel" style={{ width: w }} />)}</div>
            ) : (
              <div className="chip-row stagger">
                {members.map(m => {
                  const name = fullName(m);
                  const on = completedBy.includes(name);
                  return (
                    <button key={m.id} type="button" className={`chip-toggle ns-person ${on ? 'is-on' : ''}`}
                      onClick={() => togglePerson(name)} aria-pressed={on}>
                      <Avatar person={m} size={20} />{name}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <div className="ns-detail-grid">
            <section>
              <SheetLabel>Done on</SheetLabel>
              <input type="date" className="input input-mono" value={day} max={today}
                onChange={e => setDay(e.target.value || today)} aria-label="Done on" />
              <p className="ns-hint">
                {initialDate && day === initialDate && <span className="tag tag-green ns-hint-tag">From the page</span>}
                {day === today ? 'Lines without a time are stamped when you log.' : 'Lines without a time are stamped at midday.'}
              </p>
            </section>
            <section>
              <SheetLabel>Page for every line</SheetLabel>
              <div className="ns-area-all">
                <input className="input" value={areaForAll} onChange={e => setAreaForAll(e.target.value)}
                  placeholder={DEFAULT_AREA} aria-label="Page / Area for every line" />
                <button type="button" className="btn" onClick={applyArea} disabled={!items.length}>Apply</button>
              </div>
            </section>
          </div>
        </div>

        {error && <div className="notice notice-error wiggle" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}
      </div>

      {footEl && createPortal(
      <>
        {armedClose
          ? <span key={armKey} className="sheet-foot-note ns-armed wiggle">Close again to discard this scan</span>
          : <span className={`sheet-foot-note ${note ? 'ns-foot-warn' : ''}`}>{note || `${plural(approved.length, 'line')} will be logged as completed`}</span>}
        <span className="spacer" />
        <button type="button" className={`btn ${armedClose ? 'btn-danger' : 'btn-ghost'}`} onClick={onCancel} disabled={saving}>
          {armedClose ? 'Discard scan' : 'Cancel'}
        </button>
        <button type="button" className="btn btn-primary" onClick={logAll} disabled={!canLog}>
          {saving ? <span className="spinner" /> : <>Log {approved.length} <span className="kbd">⌘↵</span></>}
        </button>
      </>, footEl)}

      {zoom && <Lightbox src={photoUrl} onClose={() => setZoom(false)} />}
    </>
  );
}

function ScanLine({ it, onChange, onRemove }) {
  const grow = (el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  const hasFlags = it.checked !== null || it.unclear || it.fromPage || (it.areaFromScan && it.area);
  return (
    <li className={`ns-line ${it.approved ? '' : 'is-off'}`}>
      <button
        type="button"
        className={`check-round ns-approve ${it.approved ? 'is-on' : ''}`}
        onClick={() => onChange({ approved: !it.approved })}
        role="switch"
        aria-checked={it.approved}
        aria-label={it.approved ? 'Approved — tap to deny' : 'Denied — tap to approve'}
        title={it.approved ? 'Will be logged' : 'Won’t be logged'}
      />
      <div className="ns-line-main">
        <textarea
          ref={grow}
          className="ns-line-text"
          rows={1}
          value={it.text}
          onChange={e => { onChange({ text: e.target.value }); grow(e.target); }}
          placeholder="What was done"
          aria-label="What was done"
        />
        {hasFlags && (
          <div className="ns-flags">
            {it.checked === true && <span className="tag tag-green">Ticked</span>}
            {it.checked === false && <span className="tag tag-gray">Not ticked</span>}
            {it.areaFromScan && it.area && <span className="tag tag-blue">Page from scan</span>}
            {it.fromPage && <span className="tag tag-blue">Time from page</span>}
            {it.unclear && <span className="tag tag-yellow">Hard to read — check it</span>}
          </div>
        )}
        <div className="ns-line-meta">
          <label className="ns-field ns-field-area">
            <Icon name="link" size={13} />
            <input value={it.area} onChange={e => onChange({ area: e.target.value, areaFromScan: false })}
              placeholder={DEFAULT_AREA} aria-label="Page / Area" />
          </label>
          <label className={`ns-field ns-field-time ${it.time ? '' : 'is-empty'}`}>
            <Icon name="clock" size={13} />
            <input type="time" value={it.time} onChange={e => onChange({ time: e.target.value, fromPage: false })} aria-label="Time it was done" />
          </label>
          {it.time
            ? <button type="button" className="ns-mini" onClick={() => onChange({ time: '', fromPage: false })} aria-label="Clear time"><Icon name="x" size={12} /></button>
            : <button type="button" className="ns-mini ns-now" onClick={() => onChange({ time: localTime(), fromPage: false })}>Now</button>}
        </div>
      </div>
      <button type="button" className="ns-remove" onClick={onRemove} aria-label="Remove line">
        <Icon name="trash" size={14} />
      </button>
    </li>
  );
}
