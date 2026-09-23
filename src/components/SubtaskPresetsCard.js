import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import ModalPortal from './ModalPortal';
import { SettingRow, Toggle } from './SettingsControls';
import {
  fetchSubtaskPresets, createSubtaskPreset, updateSubtaskPreset, deleteSubtaskPreset,
  MAX_PRESET_ITEMS, MAX_PRESET_NAME,
} from '../lib/subtaskPresets';
import './SubtaskPresets.css';

let draftKey = 0;
const draftItem = (text = '') => ({ key: `d${draftKey++}`, text });

// Settings → Subtask Presets. Presets belong to the ACTIVE team and only its
// owners/admins can write them; members get a read-only list so they can see
// what's available to them in the task form. RLS enforces the same split, so
// a member who gets past this UI still can't write.
export default function SubtaskPresetsCard() {
  const { user } = useAuth();
  const { activeTeam, activeTeamId, isAdmin } = useTeam();
  // Two-column checklists are a personal display preference, not a team one,
  // so it rides along with the other per-user display settings.
  const { colors, setColor } = useThemeCustomization();
  const twoColumns = Number(colors.subtaskColumns) === 2;

  const [presets, setPresets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null); // { id|null, name, items:[{key,text}] }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
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
  };

  const setItem = (key, text) =>
    setDraft(d => ({ ...d, items: d.items.map(i => (i.key === key ? { ...i, text } : i)) }));

  const addItem = (focus = true) => {
    const item = draftItem();
    setDraft(d => (d.items.length >= MAX_PRESET_ITEMS ? d : { ...d, items: [...d.items, item] }));
    if (focus) setTimeout(() => itemRefs.current[item.key]?.focus(), 0);
  };

  const removeItem = (key) =>
    setDraft(d => {
      const items = d.items.filter(i => i.key !== key);
      // Never leave the editor with zero rows — there'd be nothing to type in.
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

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setError('');
    try {
      if (draft.id) await updateSubtaskPreset(draft.id, draft.name, filled);
      else await createSubtaskPreset(activeTeamId, user?.id, draft.name, filled);
      setDraft(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not save the preset.');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (p) => {
    setBusy(true); setError('');
    try {
      await deleteSubtaskPreset(p.id);
      setConfirmDelete(null);
      await load();
    } catch (err) {
      setError(err.message || 'Could not delete the preset.');
    } finally {
      setBusy(false);
    }
  };

  const displayCard = (
    <div className="card">
      <h2 className="settings-card-title">Display</h2>
      <p className="settings-card-sub">
        How checklists are laid out on task cards, everywhere you see them.
      </p>
      <SettingRow
        label="Two columns on cards"
        desc="Fits longer checklists without scrolling. Narrow cards and phones stay single-column."
      >
        <Toggle
          on={twoColumns}
          onClick={() => setColor('subtaskColumns', twoColumns ? 1 : 2)}
          label="Show subtasks in two columns on cards"
        />
      </SettingRow>
    </div>
  );

  if (!activeTeamId) {
    return (
      <>
        {displayCard}
        <div className="card settings-empty-card">
          Join or create a team to set up subtask presets.
        </div>
      </>
    );
  }

  return (
    <>
      {displayCard}

      <div className="card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">
            Presets for {activeTeam?.name || 'this team'}
          </h2>
          {isAdmin && !draft && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={startCreate}>
              New preset
            </button>
          )}
        </div>
        <p className="settings-card-sub">
          {isAdmin
            ? 'Everyone on the team can drop these into a task from the Subtasks field. Only owners and admins can change them.'
            : 'Saved by your team’s owners and admins. Apply one from the Subtasks field when you create or edit a task.'}
        </p>

        {error && <div className="error-msg settings-inline-err">⚠ {error}</div>}

        {draft && (
          <div className="preset-draft">
            <div className="form-group">
              <label className="label">Preset name</label>
              <input
                className="input"
                placeholder="e.g. New page launch"
                value={draft.name}
                maxLength={MAX_PRESET_NAME}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              />
            </div>

            <div className="form-group">
              <label className="label">
                Steps
                <span className="label-note"> — added to the task unchecked, in this order</span>
              </label>
              <div className="preset-item-list">
                {draft.items.map((item, idx) => (
                  <div key={item.key} className="preset-item-row">
                    <span className="preset-item-num">{idx + 1}</span>
                    <input
                      ref={el => { itemRefs.current[item.key] = el; }}
                      className="preset-item-input"
                      placeholder="Step…"
                      value={item.text}
                      onChange={e => setItem(item.key, e.target.value)}
                      onKeyDown={e => onItemKeyDown(e, item.key, idx)}
                    />
                    <button
                      type="button"
                      className="preset-item-remove"
                      onClick={() => removeItem(item.key)}
                      title="Remove step"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
              {draft.items.length < MAX_PRESET_ITEMS && (
                <button type="button" className="st-editor-add preset-add-step" onClick={() => addItem()}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add step
                </button>
              )}
            </div>

            <div className="preset-draft-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={!canSave} onClick={save}>
                {busy ? 'Saving…' : (draft.id ? 'Save changes' : 'Create preset')}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setDraft(null)}>
                Cancel
              </button>
              {draft.name.trim() && filled.length === 0 && (
                <span className="preset-draft-hint">Add at least one step.</span>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <p className="settings-empty">Loading…</p>
        ) : presets.length === 0 ? (
          <p className="settings-empty">
            {isAdmin
              ? 'No presets yet — create one to save a checklist your team reuses.'
              : 'No presets yet. Ask a team owner or admin to add one.'}
          </p>
        ) : (
          <div className="preset-list">
            {presets.map(p => (
              <div key={p.id} className="preset-row">
                <div className="preset-row-main">
                  <div className="preset-row-name">{p.name}</div>
                  <div className="preset-row-steps">
                    {p.items.length} step{p.items.length === 1 ? '' : 's'} — {p.items.join(' · ')}
                  </div>
                </div>
                {isAdmin && (
                  <div className="preset-row-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => startEdit(p)}>Edit</button>
                    <button type="button" className="theme-color-reset" onClick={() => setConfirmDelete(p)}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmDelete && (
        <ModalPortal>
          <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
            <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <div className="modal-header"><h2 className="settings-card-title">Delete this preset?</h2></div>
              <div className="modal-body">
                <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>
                  <strong>{confirmDelete.name}</strong> will no longer be available to your team.
                </p>
                <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                  Tasks it was already applied to keep their subtasks — they're copies, not links.
                </p>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
                <button className="btn btn-danger" disabled={busy} onClick={() => doDelete(confirmDelete)}>
                  {busy ? 'Deleting…' : 'Delete preset'}
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </>
  );
}
