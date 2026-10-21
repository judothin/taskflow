import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { searchRank } from '../lib/fuzzySearch';
import { Sheet, SheetLabel, SearchInput, Icon, toast } from '../ui';
import { FileSheet } from '../pages/Files';
import './ContextSheet.css';

// Fired after any context save/delete so an open Context page refreshes
// without waiting on realtime. detail: { id } of the entry that changed.
export const CONTEXT_CHANGED = 'context-changed';

// ── Tags ─────────────────────────────────────────────────────────
// Free-text, team-wide labels ("Dev only", "Live", "Plugin"). They live on
// each entry as context_entries.tags = [{ name, color }]; the team's palette
// is simply every distinct tag across its entries.
export const TAG_COLORS = ['yellow', 'blue', 'green', 'red', 'purple', 'pink', 'gray'];

export const tagKey = (t) => (t?.name || '').trim().toLowerCase();

export function tagsOf(entry) {
  const raw = entry?.tags;
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  raw.forEach(t => {
    const name = typeof t?.name === 'string' ? t.name.trim() : '';
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    out.push({ name, color: TAG_COLORS.includes(t.color) ? t.color : 'gray' });
  });
  return out;
}

export function teamTagsFrom(entries = []) {
  const m = new Map();
  entries.forEach(e => tagsOf(e).forEach(t => { if (!m.has(tagKey(t))) m.set(tagKey(t), t); }));
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function Tag({ tag, className = '' }) {
  return <span className={`tag tag-${tag.color || 'gray'} ${className}`}>{tag.name}</span>;
}

// PostgREST answers PGRST204 ("could not find the 'tags' column … in the
// schema cache") until supabase sql/context.sql has run; Postgres itself says
// 42703. Either way: save without tags rather than lose the entry.
function isMissingTagsColumn(err) {
  const msg = err?.message || '';
  return /tags/i.test(msg) && (err.code === 'PGRST204' || err.code === '42703' || /column|schema cache/i.test(msg));
}

/**
 * Add / edit a context entry. Used by the Context page and by the app-wide
 * "Save context" (QuickContext), so both look and save the same way.
 *
 *   <ContextSheet entry={entry|null} files={files?} teamTags={tags?}
 *                 onClose={…} onSaved={(row) => …} onView={(row) => …} />
 *
 * `files` / `teamTags` are loaded here when the caller doesn't pass them.
 * `onView`, when given, adds a "View" action to the saved toast.
 */
// Sections already in use, for the add-file sheet's chips.
const sectionsOf = (files) => [...new Set(files.map(f => (f.section || '').trim()).filter(Boolean))].sort();

export default function ContextSheet({ entry = null, files: filesProp, teamTags: tagsProp, onClose, onSaved, onView }) {
  const { user } = useAuth();
  const { activeTeamId } = useTeam();
  const editing = !!entry?.id;

  const [subject, setSubject] = useState(entry?.subject || '');
  const [description, setDescription] = useState(entry?.description || '');
  const [fileIds, setFileIds] = useState(Array.isArray(entry?.file_ids) ? entry.file_ids : []);
  const [tags, setTags] = useState(() => tagsOf(entry));
  const [fileQuery, setFileQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);

  const [loadedFiles, setLoadedFiles] = useState(null);
  const [addedFiles, setAddedFiles] = useState([]); // made with "New file" in this sheet
  const [addingFile, setAddingFile] = useState(false);
  const [loadedTags, setLoadedTags] = useState(null);
  const [tagsSupported, setTagsSupported] = useState(true);
  const [created, setCreated] = useState([]); // tags made in this sheet

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('yellow');
  const newInput = useRef(null);
  const bodyRef = useRef(null);

  // Only fetch what the caller didn't hand us.
  useEffect(() => {
    if (!activeTeamId || (filesProp && tagsProp)) return undefined;
    let alive = true;
    (async () => {
      const [f, t] = await Promise.all([
        filesProp ? null : supabase.from('file_entries').select('id, name, path, section').eq('team_id', activeTeamId).order('name'),
        tagsProp ? null : supabase.from('context_entries').select('tags').eq('team_id', activeTeamId),
      ]);
      if (!alive) return;
      if (f) setLoadedFiles(f.data || []);
      if (t) {
        if (t.error) { setLoadedTags([]); if (isMissingTagsColumn(t.error)) setTagsSupported(false); }
        else setLoadedTags(teamTagsFrom(t.data || []));
      }
    })();
    return () => { alive = false; };
  }, [activeTeamId, filesProp, tagsProp]);

  const files = useMemo(() => {
    const base = filesProp || loadedFiles || [];
    const have = new Set(base.map(f => f.id));
    return [...base, ...addedFiles.filter(f => !have.has(f.id))];
  }, [filesProp, loadedFiles, addedFiles]);
  const teamTags = useMemo(() => tagsProp || loadedTags || [], [tagsProp, loadedTags]);
  const filesLoading = !filesProp && loadedFiles === null;

  // Palette = the team's tags + whatever this entry already has + new ones.
  const palette = useMemo(() => {
    const m = new Map();
    [...teamTags, ...tagsOf(entry), ...created].forEach(t => { if (!m.has(tagKey(t))) m.set(tagKey(t), t); });
    return [...m.values()];
  }, [teamTags, entry, created]);

  const fileById = useMemo(() => new Map(files.map(f => [f.id, f])), [files]);

  // Ranked by the app's forgiving matcher; with no query the linked files
  // float to the top so you can see what's picked without scrolling.
  const fileOptions = useMemo(() => {
    const ranked = searchRank(files, fileQuery, f => [
      { text: f.name, weight: 3 },
      { text: f.path, weight: 2 },
      { text: f.section, weight: 1.5 },
    ]);
    if (fileQuery.trim()) return ranked.slice(0, 60);
    const on = ranked.filter(f => fileIds.includes(f.id));
    const off = ranked.filter(f => !fileIds.includes(f.id));
    return [...on, ...off].slice(0, Math.max(60, on.length));
    // fileIds is intentionally read only when the query/list changes, so a
    // ticked row doesn't jump to the top under your cursor.
  }, [files, fileQuery]);

  const toggleFile = (id) => setFileIds(ids => (ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]));

  // A file made from here is added to the team's Files and linked straight away.
  const onFileAdded = (f) => {
    if (!f?.id) return;
    setAddedFiles(list => [...list.filter(x => x.id !== f.id), f]);
    setFileIds(ids => (ids.includes(f.id) ? ids : [...ids, f.id]));
    setFileQuery('');
  };

  const hasTag = (t) => tags.some(x => tagKey(x) === tagKey(t));
  const toggleTag = (t) => setTags(list => (hasTag(t) ? list.filter(x => tagKey(x) !== tagKey(t)) : [...list, t]));

  const addTag = () => {
    const name = newName.trim().slice(0, 32);
    if (!name) return;
    const existing = palette.find(t => tagKey(t) === name.toLowerCase());
    const tag = existing || { name, color: newColor };
    if (!existing) setCreated(c => [...c, tag]);
    if (!hasTag(tag)) setTags(list => [...list, tag]);
    setNewName('');
    setCreating(false);
  };

  const save = async () => {
    if (saving) return;
    if (!subject.trim()) { setError('Give it a subject so you can find it again.'); setShake(s => s + 1); return; }
    setSaving(true);
    setError('');
    const base = {
      subject: subject.trim(),
      description: description.trim(),
      file_ids: fileIds.filter(id => fileById.has(id) || filesLoading),
      updated_at: new Date().toISOString(),
    };
    const run = (payload) => (editing
      ? supabase.from('context_entries').update(payload).eq('id', entry.id).select().maybeSingle()
      : supabase.from('context_entries').insert({ ...payload, team_id: activeTeamId, created_by: user?.id }).select().maybeSingle());

    let { data, error: err } = await run({ ...base, tags });
    let tagsDropped = false;
    if (err && isMissingTagsColumn(err)) {
      ({ data, error: err } = await run(base));
      tagsDropped = true;
    }
    setSaving(false);
    if (err) { setError(err.message); setShake(s => s + 1); return; }

    const row = data || { ...entry, ...base };
    window.dispatchEvent(new CustomEvent(CONTEXT_CHANGED, { detail: { id: row.id } }));
    if (tagsDropped && tags.length) {
      toast('Saved without tags. Tags need the context migration first.', { icon: 'alert', duration: 6000 });
    } else {
      toast(editing ? 'Context updated' : 'Saved to Context', onView && row.id ? { action: { label: 'View', onClick: () => onView(row) } } : {});
    }
    onSaved?.(row);
    onClose?.();
  };

  const linked = fileIds.filter(id => fileById.has(id)).length || (filesLoading ? fileIds.length : 0);
  const note = [
    linked ? `${linked} file${linked === 1 ? '' : 's'} linked` : 'No files linked',
    tags.length ? `${tags.length} tag${tags.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');

  const aside = (
    <>
      <section className="cs-section">
        <div className="cs-files-head">
          <SheetLabel sub="Source files this is about">Files</SheetLabel>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddingFile(true)} disabled={!activeTeamId}>
            <Icon name="plus" size={13} />New file
          </button>
        </div>
        <SearchInput
          value={fileQuery}
          onChange={setFileQuery}
          placeholder={files.length || filesLoading ? 'Search files to link' : 'No files on this team yet'}
          className="cs-file-search"
        />
        <div className="cs-files">
          {filesLoading ? (
            [0, 1, 2, 3].map(i => (
              <div key={i} className="cs-file-skel">
                <span className="skel" style={{ width: 17, height: 17 }} />
                <span className="skel skel-line" style={{ width: `${62 - i * 9}%` }} />
              </div>
            ))
          ) : !files.length ? (
            <p className="cs-none">No files on this team yet. <button type="button" className="btn-link" onClick={() => setAddingFile(true)}>Add one</button> and it’s linked here.</p>
          ) : !fileOptions.length ? (
            <p className="cs-none">No files match “{fileQuery}”.</p>
          ) : (
            <div key={fileQuery ? 'q' : 'all'} className="cs-file-list anim-fade">
              {fileOptions.map(f => {
                const on = fileIds.includes(f.id);
                return (
                  <label key={f.id} className={`cs-file ${on ? 'is-on' : ''}`}>
                    <input type="checkbox" className="check" checked={on} onChange={() => toggleFile(f.id)} />
                    <span className="cs-file-text">
                      <span className="cs-file-name mono truncate">{f.name}</span>
                      <span className="cs-file-sub truncate">{[f.section, f.path].filter(Boolean).join(' · ') || '—'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="cs-section">
        <SheetLabel sub="Team-wide labels, e.g. Dev only or Live">Tags</SheetLabel>
        {!tagsSupported && (
          <p className="notice cs-tags-note"><Icon name="info" size={15} />Tags will save once the context migration has run.</p>
        )}
        <div className="chip-row cs-tags">
          {palette.map(t => {
            const on = hasTag(t);
            const isNew = created.some(c => tagKey(c) === tagKey(t));
            return (
              <button
                key={tagKey(t)}
                type="button"
                className={`chip-toggle cs-tag ${on ? 'is-on' : ''} ${isNew ? 'cs-tag-new' : ''}`}
                aria-pressed={on}
                onClick={() => toggleTag(t)}
              >
                <span className={`cs-swatch-dot tag-${t.color}`} aria-hidden="true" />
                {t.name}
                {on && <Icon name="check" size={13} className="cs-tag-check" />}
              </button>
            );
          })}
          {!creating && (
            <button
              type="button"
              className="chip-toggle is-dashed cs-tag"
              onClick={() => { setCreating(true); setTimeout(() => newInput.current?.focus(), 0); }}
            >
              <Icon name="plus" size={13} />New tag
            </button>
          )}
        </div>

        {creating && (
          <div className="cs-newtag anim-pop">
            <div className="cs-newtag-row">
              <input
                ref={newInput}
                className="input input-sm"
                placeholder="Tag name"
                value={newName}
                maxLength={32}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); addTag(); }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCreating(false); setNewName(''); }
                }}
              />
              <span className="cs-newtag-preview">
                <Tag key={newColor} tag={{ name: newName.trim() || 'Preview', color: newColor }} className="anim-pop" />
              </span>
            </div>
            <div className="cs-newtag-row">
              <div className="cs-swatches" role="radiogroup" aria-label="Tag colour">
                {TAG_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={newColor === c}
                    aria-label={c}
                    title={c}
                    className={`cs-swatch tag-${c} ${newColor === c ? 'is-on' : ''}`}
                    onClick={() => setNewColor(c)}
                  />
                ))}
              </div>
              <span className="spacer" />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setCreating(false); setNewName(''); }}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={addTag} disabled={!newName.trim()}>Add tag</button>
            </div>
          </div>
        )}
      </section>
    </>
  );

  return (
    <Sheet
      eyebrow={editing ? 'Edit context' : 'Add context'}
      onClose={onClose}
      onSubmit={save}
      mainClassName="cs-main"
      aside={aside}
      footer={(
        <>
          <span key={note} className="sheet-foot-note cs-note">{note}</span>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !subject.trim()}>
            {saving ? <span className="spinner" /> : (editing ? 'Save changes' : 'Add context')}
            {!saving && <span className="kbd">⌘↵</span>}
          </button>
        </>
      )}
    >
      <input
        className="title-input"
        autoFocus
        placeholder="Subject, e.g. Captcha on contact forms"
        value={subject}
        maxLength={200}
        onChange={(e) => { setSubject(e.target.value); if (error) setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); bodyRef.current?.focus(); } }}
      />
      <p className="cs-hint">Write what you'd want to read back later.</p>
      <textarea
        ref={bodyRef}
        className="body-input cs-body"
        placeholder={'It\'s an Elementor add-on called X, configured under Settings → Forms. The site key lives in wp-config.'}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && <p key={shake} className="notice notice-error wiggle cs-error"><Icon name="alert" size={15} />{error}</p>}
      {addingFile && (
        <FileSheet
          entry={null}
          sections={sectionsOf(files)}
          teamId={activeTeamId}
          onClose={() => setAddingFile(false)}
          onSaved={onFileAdded}
        />
      )}
    </Sheet>
  );
}
