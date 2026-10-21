import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { Icon, ConfirmDialog, Empty, SkeletonRows, toast } from '../ui';
import {
  fetchSubtaskPresets, createSubtaskPreset, updateSubtaskPreset, deleteSubtaskPreset,
  MAX_PRESET_ITEMS, MAX_PRESET_NAME,
} from '../lib/subtaskPresets';
import '../pages/Settings.css';
import './SubtaskPresets.css';

let draftKey = 0;
const draftItem = (text = '') => ({ key: `d${draftKey++}`, text });

// Settings › Subtask presets. Presets belong to the ACTIVE team and only its
// owners/admins can write them; members get a read-only list so they can see
// what's available in the task sheet. RLS enforces the same split.
// (The one-or-two-column checklist preference lives in Accessibility.)
export default function SubtaskPresetsCard() {
  const { user } = useAuth();
  const { activeTeam, activeTeamId, isAdmin } = useTeam();

  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // { id|null, name, items:[{key,text}] }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [open, setOpen] = useState(null); // preset id whose steps are expanded
  const itemRefs = useRef({});

  const load = useCallback(async () => {
    if (!activeTeamId) { setPresets([]); setLoading(false); return; }
    setLoading(true);
    setPresets(await fetchSubtaskPresets(activeTeamId));
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { load(); }, [load]);
  // Switching teams mid-edit would otherwise save the draft onto the new team.
  useEffect(() => { setDraft(null); setError(''); }, [activeTeamId]);

  const startCreate = () => { setError(''); setDraft({ id: null, name: '', items: [draftItem()] }); };
  const startEdit = (p) => {
    setError('');
    setDraft({ id: p.id, name: p.name, items: p.items.length ? p.items.map(draftItem) : [draftItem()] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setItem = (key, text) =>
    setDraft(d => ({ ...d, items: d.items.map(i => (i.key === key ? { ...i, text } : i)) }));

  const addItem = () => {
    const item = draftItem();
    setDraft(d => (d.items.length >= MAX_PRESET_ITEMS ? d : { ...d, items: [...d.items, item] }));
    setTimeout(() => itemRefs.current[item.key]?.focus(), 0);
  };

  const removeItem = (key) =>
    setDraft(d => {
      const items = d.items.filter(i => i.key !== key);
      return { ...d, items: items.length ? items : [draftItem()] };
    });

  const onItemKeyDown = (e, key, idx) => {
    if (e.key === 'Enter') { e.preventDefault(); addItem(); }
    else if (e.key === 'Backspace' && !draft.items[idx].text && draft.items.length > 1) {
      e.preventDefault();
      const prev = draft.items[idx - 1];
      removeItem(key);
      if (prev) setTimeout(() => itemRefs.current[prev.key]?.focus(), 0);
    }
  };

  const filled = draft ? draft.items.map(i => i.text.trim()).filter(Boolean) : [];
  const canSave = !!draft && !!draft.name.trim() && filled.length > 0 && !busy;

  const save = async (e) => {
    e?.preventDefault();
    if (!canSave) return;
    setBusy(true); setError('');
    try {
      if (draft.id) await updateSubtaskPreset(draft.id, draft.name, filled);
      else await createSubtaskPreset(activeTeamId, user?.id, draft.name, filled);
      toast(draft.id ? 'Preset saved' : 'Preset created');
      setDraft(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save the preset.');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setBusy(true); setError('');
    try {
      await deleteSubtaskPreset(confirmDelete.id);
      setConfirmDelete(null);
      toast('Preset deleted');
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete the preset.');
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  if (!activeTeamId) {
    return <Empty icon="list" title="No team yet">Join or create a team to set up subtask presets.</Empty>;
  }

  return (
    <div className="sp">
      <div className="sp-head anim-rise">
        <div style={{ minWidth: 0 }}>
          <div className="st-row-label">Presets for {activeTeam?.name || 'this team'}</div>
          <div className="st-row-desc">
            {isAdmin
              ? 'Everyone on the team can drop these into a task with “Use a preset”. Only owners and admins can change them.'
              : 'Saved by your team’s owners and admins. Apply one with “Use a preset” in any task.'}
          </div>
        </div>
        {isAdmin && !draft && (
          <button type="button" className="btn btn-primary anim-pop" onClick={startCreate}>
            <Icon name="plus" size={14} />New preset
          </button>
        )}
      </div>

      {error && (
        <div key={error} className="notice notice-error wiggle sp-error" role="alert">
          <Icon name="alert" size={15} /><span>{error}</span>
        </div>
      )}

      {draft && (
        <form className="sp-draft" onSubmit={save}>
          <div className="eyebrow">{draft.id ? 'Edit preset' : 'New preset'}</div>
          <input
            className="title-input sp-name"
            placeholder="Preset name, e.g. New page launch"
            value={draft.name}
            maxLength={MAX_PRESET_NAME}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            autoFocus
          />
          <div className="sp-steps-label">
            <span className="sheet-label" style={{ margin: 0 }}>Steps</span>
            <span className="mono t-3">{filled.length}/{MAX_PRESET_ITEMS}</span>
          </div>
          <div className="sp-items">
            {draft.items.map((item, idx) => (
              <div key={item.key} className="sp-item">
                <span className="sp-num">{idx + 1}</span>
                <input
                  ref={el => { itemRefs.current[item.key] = el; }}
                  className="sp-input"
                  placeholder="Step…"
                  value={item.text}
                  onChange={e => setItem(item.key, e.target.value)}
                  onKeyDown={e => onItemKeyDown(e, item.key, idx)}
                />
                <button type="button" className="sp-x" onClick={() => removeItem(item.key)} aria-label="Remove step">
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
          {draft.items.length < MAX_PRESET_ITEMS && (
            <button type="button" className="btn btn-ghost btn-sm sp-add" onClick={addItem}>
              <Icon name="plus" size={13} />Add step
              <span className="kbd">↵</span>
            </button>
          )}
          <div className="sp-draft-foot">
            {draft.name.trim() && filled.length === 0 && <span className="st-note t-3 anim-fade">Add at least one step.</span>}
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!canSave}>
              {busy ? <span className="spinner" /> : draft.id ? 'Save changes' : 'Create preset'}
            </button>
          </div>
        </form>
      )}

      <div className="table sp-table" style={{ '--cols': 'minmax(0, 1fr) 90px 150px' }}>
        <div className="table-head">
          <span>Preset</span>
          <span className="hide-phone">Steps</span>
          <span className="hide-phone" />
        </div>
        {loading ? (
          <SkeletonRows rows={3} widths={['46%', '8%', '14%']} />
        ) : presets.length === 0 ? (
          <Empty icon="list" title="No presets yet">
            {isAdmin ? 'Create one to save a checklist your team reuses.' : 'Ask a team owner or admin to add one.'}
          </Empty>
        ) : (
          <div className="stagger">
            {presets.map(p => (
              <div key={p.id} className={`table-row sp-row ${open === p.id ? 'is-open' : ''}`} onClick={() => setOpen(o => (o === p.id ? null : p.id))}>
                <div className="table-cell" style={{ display: 'block' }}>
                  <div className="table-title">{p.name}</div>
                  {open === p.id ? (
                    <ol className="sp-steps">
                      {p.items.map((s, i) => <li key={i}>{s}</li>)}
                    </ol>
                  ) : (
                    <div className="table-sub">{p.items.join(' · ')}</div>
                  )}
                </div>
                <div className="table-cell mono">{p.items.length} step{p.items.length === 1 ? '' : 's'}</div>
                <div className="table-cell sp-row-actions" onClick={e => e.stopPropagation()}>
                  {isAdmin && (
                    <>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>
                        <Icon name="edit" size={13} />Edit
                      </button>
                      <button type="button" className="btn btn-danger btn-sm btn-icon" onClick={() => setConfirmDelete(p)} aria-label={`Delete ${p.name}`}>
                        <Icon name="trash" size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this preset?"
          text={`“${confirmDelete.name}” will no longer be available to your team. Tasks it was already applied to keep their subtasks — they’re copies, not links.`}
          confirmLabel="Delete preset"
          danger
          busy={busy}
          onConfirm={doDelete}
          onClose={() => !busy && setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
