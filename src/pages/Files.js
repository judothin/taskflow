import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { TopBarPortal } from '../context/HeaderActionsContext';
import useIsPhone from '../lib/useIsPhone';
import { searchRank } from '../lib/fuzzySearch';
import {
  Icon, Sheet, ConfirmDialog, Empty, SearchInput, SkeletonRows, Dropzone, Lightbox, PageHeader, toast,
} from '../ui';
import './Files.css';

// The team's map of its codebase: every source file worth knowing about, where
// it lives, what it does, grouped into sections. Context entries link to these.

const TYPES = [
  { value: 'php', label: 'PHP' },
  { value: 'js', label: 'JS' },
  { value: 'jsx', label: 'JSX' },
  { value: 'ts', label: 'TS' },
  { value: 'tsx', label: 'TSX' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'json', label: 'JSON' },
  { value: 'other', label: 'Other' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map(t => [t.value, t.label]));

function detectType(name = '') {
  const ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  if (['jsx', 'tsx', 'ts', 'js', 'php', 'json'].includes(ext)) return ext;
  if (['mjs', 'cjs'].includes(ext)) return 'js';
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'css';
  if (['html', 'htm'].includes(ext)) return 'html';
  return null;
}

const UNCATEGORIZED = 'Uncategorized';
const sectionOf = (e) => e.section?.trim() || UNCATEGORIZED;
const MAX_IMAGE = 3 * 1024 * 1024;
const EMPTY_FORM = { name: '', path: '', section: '', description: '', type: 'php' };

function TypeBadge({ type }) {
  return <span className={`file-badge fl-badge fl-badge-${type || 'other'}`}>{TYPE_LABEL[type] || '—'}</span>;
}

// ── Add / edit sheet ─────────────────────────────────────────────
// pending images: [{ preview, file: File|null, url: string|null }]
// Also used from Context, to add a file and link it in one go.
export function FileSheet({ entry, sections, teamId, onClose, onSaved, onDelete }) {
  const editing = !!entry?.id;
  const [form, setForm] = useState(() => (entry ? {
    name: entry.name || '',
    path: entry.path || '',
    section: entry.section || '',
    description: entry.description || '',
    type: entry.type || detectType(entry.name) || 'other',
  } : { ...EMPTY_FORM, ...(sections.length === 1 ? { section: sections[0] } : {}) }));
  const [images, setImages] = useState(() => (entry?.images || []).map(url => ({ preview: url, file: null, url })));
  const [errors, setErrors] = useState({});
  const [shake, setShake] = useState(0);
  const [saving, setSaving] = useState(null); // null | 'close' | 'again'
  const [newSections, setNewSections] = useState([]);
  const [addingSection, setAddingSection] = useState(false);
  const [sectionDraft, setSectionDraft] = useState('');
  const [lightbox, setLightbox] = useState(null);
  const [savedCount, setSavedCount] = useState(0);
  const nameRef = useRef(null);
  const sectionRef = useRef(null);
  const skipCommit = useRef(false);
  const blobs = useRef(new Set());

  useEffect(() => () => { blobs.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); if (errors[k]) setErrors(e => ({ ...e, [k]: null })); };

  const sectionChips = useMemo(() => {
    const all = [...sections.filter(s => s !== UNCATEGORIZED), ...newSections];
    if (form.section.trim() && !all.includes(form.section.trim())) all.push(form.section.trim());
    return [...new Set(all)];
  }, [sections, newSections, form.section]);

  const commitSection = () => {
    if (skipCommit.current) { skipCommit.current = false; return; }
    const name = sectionDraft.trim();
    setAddingSection(false);
    setSectionDraft('');
    if (!name) return;
    const existing = sectionChips.find(s => s.toLowerCase() === name.toLowerCase());
    if (!existing) setNewSections(list => [...list, name]);
    set('section', existing || name);
  };

  const addImages = (list) => {
    const imgs = list.filter(f => f.type?.startsWith('image/'));
    if (!imgs.length) return;
    const ok = imgs.filter(f => f.size <= MAX_IMAGE);
    if (ok.length < imgs.length) toast(`${imgs.length - ok.length === 1 ? 'An image was' : 'Some images were'} over 3 MB and skipped`, { icon: 'alert' });
    setImages(prev => [...prev, ...ok.map(file => {
      const preview = URL.createObjectURL(file);
      blobs.current.add(preview);
      return { preview, file, url: null };
    })]);
  };

  const removeImage = (i) => setImages(prev => prev.filter((_, j) => j !== i));

  const onPaste = (e) => {
    const list = Array.from(e.clipboardData?.files || []);
    if (list.some(f => f.type?.startsWith('image/'))) { e.preventDefault(); addImages(list); }
  };

  const upload = () => Promise.all(images.map(async (img) => {
    if (!img.file) return img.url;
    const ext = img.file.name.split('.').pop() || 'png';
    const path = `file-entries/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from('task-images').upload(path, img.file);
    if (error) throw error;
    return supabase.storage.from('task-images').getPublicUrl(path).data.publicUrl;
  }));

  const save = async (again = false) => {
    if (saving) return;
    const errs = {};
    if (!form.name.trim()) errs.name = 'File name is required.';
    if (!form.path.trim()) errs.path = 'Path is required.';
    if (!form.section.trim()) errs.section = 'Pick or add a section.';
    if (Object.keys(errs).length) { setErrors(errs); setShake(s => s + 1); return; }
    setSaving(again ? 'again' : 'close');
    setErrors({});
    try {
      const urls = await upload();
      const payload = {
        name: form.name.trim(),
        path: form.path.trim(),
        section: form.section.trim(),
        description: form.description.trim(),
        type: form.type,
        images: urls,
      };
      const { data, error } = editing
        ? await supabase.from('file_entries').update(payload).eq('id', entry.id).select().maybeSingle()
        : await supabase.from('file_entries').insert({ ...payload, team_id: teamId }).select().maybeSingle();
      if (error) throw error;
      onSaved(data || { ...entry, ...payload });
      toast(editing ? 'File updated' : `Added ${payload.name}`);
      if (again) {
        setForm({ ...EMPTY_FORM, path: payload.path, section: payload.section, type: payload.type });
        setImages([]);
        setSavedCount(n => n + 1);
        setTimeout(() => nameRef.current?.focus(), 0);
      } else {
        onClose();
      }
    } catch (err) {
      setErrors({ general: err.message || 'Saving failed.' });
      setShake(s => s + 1);
    } finally {
      setSaving(null);
    }
  };

  const err = (k) => errors[k] && <p key={`${k}-${shake}`} className="field-error wiggle">{errors[k]}</p>;

  return (
    <Sheet
      size="sm"
      eyebrow={editing ? 'Edit file' : <>Add file{savedCount > 0 && <span key={savedCount} className="t-4 bump">· {savedCount} added</span>}</>}
      onClose={onClose}
      onSubmit={() => save(false)}
      onPaste={onPaste}
      mainClassName="fl-sheet"
      footer={(
        <>
          {editing ? (
            <button type="button" className="btn btn-danger" onClick={onDelete}><Icon name="trash" size={14} />Delete</button>
          ) : (
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          )}
          <span className="spacer" />
          {editing && <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>}
          {!editing && (
            <button type="button" className="btn" onClick={() => save(true)} disabled={!!saving}>
              {saving === 'again' ? <span className="spinner" /> : 'Save & add another'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={!!saving}>
            {saving === 'close' ? <span className="spinner" /> : (editing ? 'Save changes' : 'Add file')}
            {saving !== 'close' && <span className="kbd">⌘↵</span>}
          </button>
        </>
      )}
    >
      <div className="fl-form stagger">
        <div className="field">
          <input
            ref={nameRef}
            className="title-input mono"
            placeholder="file-name.php"
            value={form.name}
            autoFocus
            spellCheck={false}
            aria-label="File name"
            onChange={(e) => {
              const name = e.target.value;
              const t = detectType(name);
              setForm(f => ({ ...f, name, type: t || f.type }));
              if (errors.name) setErrors(x => ({ ...x, name: null }));
            }}
          />
          {err('name')}
        </div>

        <div className="field">
          <span className="field-label">Type</span>
          <div className="chip-row fl-types" role="radiogroup" aria-label="Type">
            {TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={form.type === t.value}
                className={`chip-toggle is-square ${form.type === t.value ? 'is-on' : ''}`}
                onClick={() => set('type', t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field-label">Path</span>
          <input
            className="input input-mono"
            placeholder="e.g. themes/hnice-child"
            value={form.path}
            spellCheck={false}
            onChange={(e) => set('path', e.target.value)}
          />
          {err('path')}
        </label>

        <div className="field">
          <span className="field-label">Section</span>
          <div className="chip-row fl-sections">
            {sectionChips.map(s => (
              <button
                key={s}
                type="button"
                className={`chip-toggle ${form.section === s ? 'is-on' : ''} ${newSections.includes(s) ? 'fl-chip-new' : ''}`}
                aria-pressed={form.section === s}
                onClick={() => set('section', s)}
              >
                {s}
              </button>
            ))}
            {addingSection ? (
              <span className="fl-newsection anim-pop">
                <input
                  ref={sectionRef}
                  className="input input-sm"
                  placeholder="Section name"
                  value={sectionDraft}
                  maxLength={48}
                  onChange={(e) => setSectionDraft(e.target.value)}
                  onBlur={commitSection}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitSection(); }
                    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skipCommit.current = true; setSectionDraft(''); setAddingSection(false); }
                  }}
                />
              </span>
            ) : (
              <button
                type="button"
                className="chip-toggle is-dashed"
                onClick={() => { skipCommit.current = false; setAddingSection(true); setTimeout(() => sectionRef.current?.focus(), 0); }}
              >
                <Icon name="plus" size={13} />New section
              </button>
            )}
          </div>
          {err('section')}
        </div>

        <label className="field">
          <span className="field-label">Description</span>
          <textarea
            className="textarea"
            rows={4}
            placeholder="What does this file do?"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </label>

        <div className="field">
          <span className="field-label">Images <span className="field-hint">Optional · max 3 MB each</span></span>
          {images.length > 0 && (
            <div className="attach-grid fl-images">
              {images.map((img, i) => (
                <div key={img.preview} className="attach">
                  <img className="attach-thumb" src={img.preview} alt="" onClick={() => setLightbox(img.preview)} />
                  <button type="button" className="attach-x" onClick={() => removeImage(i)} aria-label="Remove image">
                    <Icon name="x" size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Dropzone onFiles={addImages} accept="image/*" title="Drop or paste images" row />
        </div>

        {errors.general && (
          <p key={`g-${shake}`} className="notice notice-error wiggle"><Icon name="alert" size={15} />{errors.general}</p>
        )}
      </div>

      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </Sheet>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function Files() {
  const { activeTeamId } = useTeam();
  const isPhone = useIsPhone();
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [section, setSection] = useState('all');
  const [sheet, setSheet] = useState(null); // null | { entry }
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [highlight, setHighlight] = useState(() => params.get('id'));
  const [settled, setSettled] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeamId) { setEntries([]); setLoading(false); return; }
    const { data, error } = await supabase
      .from('file_entries').select('*')
      .eq('team_id', activeTeamId)
      .order('section').order('name');
    setLoadError(error ? error.message : '');
    if (!error) setEntries(data || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  useEffect(() => {
    if (loading || settled) return undefined;
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [loading, settled]);

  // The + menu navigates here with { create: true } (or ?new=1).
  useEffect(() => {
    if (location.state?.create || params.get('new')) {
      setSheet({ entry: null });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state]);

  // Linked from a context entry: /files?id=… → show and highlight that row.
  const urlId = params.get('id');
  useEffect(() => { if (urlId) { setHighlight(urlId); setSection('all'); setSearch(''); } }, [urlId]);
  useEffect(() => {
    if (loading || !highlight) return undefined;
    const t = setTimeout(() => {
      document.getElementById(`fl-row-${highlight}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
    return () => clearTimeout(t);
  }, [loading, highlight]);

  const sectionCounts = useMemo(() => {
    const m = new Map();
    entries.forEach(e => m.set(sectionOf(e), (m.get(sectionOf(e)) || 0) + 1));
    return m;
  }, [entries]);
  const sectionNames = useMemo(() => [...sectionCounts.keys()].sort((a, b) => {
    if (a === UNCATEGORIZED) return 1;
    if (b === UNCATEGORIZED) return -1;
    return a.localeCompare(b);
  }), [sectionCounts]);

  useEffect(() => { if (section !== 'all' && !sectionCounts.has(section) && !loading) setSection('all'); }, [section, sectionCounts, loading]);

  const filtered = useMemo(() => {
    const inSection = section === 'all' ? entries : entries.filter(e => sectionOf(e) === section);
    return searchRank(inSection, search, e => [
      { text: e.name, weight: 3 },
      { text: e.path, weight: 2 },
      { text: e.section, weight: 1.5 },
      { text: e.description, weight: 1 },
    ]);
  }, [entries, section, search]);

  const groups = useMemo(() => {
    const m = new Map();
    filtered.forEach(e => { const k = sectionOf(e); if (!m.has(k)) m.set(k, []); m.get(k).push(e); });
    if (search.trim()) return [...m.entries()]; // keep relevance order
    return sectionNames.filter(s => m.has(s)).map(s => [s, m.get(s)]);
  }, [filtered, sectionNames, search]);

  const openRow = (entry) => {
    setHighlight(entry.id);
    setSheet({ entry });
    if (params.get('id')) { const p = new URLSearchParams(params); p.delete('id'); setParams(p, { replace: true }); }
  };

  const onSaved = (row) => {
    setEntries(list => {
      const i = list.findIndex(e => e.id === row.id);
      if (i < 0) return [...list, row];
      const copy = list.slice(); copy[i] = row; return copy;
    });
    if (row?.id) setHighlight(row.id);
    load();
  };

  const remove = async () => {
    const entry = confirmDelete;
    setDeleting(true);
    const { error } = await supabase.from('file_entries').delete().eq('id', entry.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (error) { toast(error.message, { icon: 'alert' }); return; }
    setSheet(null);
    setEntries(list => list.filter(e => e.id !== entry.id));
    toast(`Deleted ${entry.name}`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error: err } = await supabase.from('file_entries').insert(entry);
          if (err) { toast(err.message, { icon: 'alert' }); return; }
          load();
        },
      },
    });
  };

  const topBar = (
    <TopBarPortal>
      {!isPhone && <SearchInput value={search} onChange={setSearch} placeholder="Search files" className="fl-topsearch" />}
      <button type="button" className="btn btn-primary" onClick={() => setSheet({ entry: null })} disabled={!activeTeamId}>
        <Icon name="plus" size={15} />{isPhone ? 'Add' : 'Add file'}
      </button>
    </TopBarPortal>
  );

  if (!activeTeamId) {
    return (
      <div className="page">
        {topBar}
        <Empty icon="users" title="No team yet">Join or create a team to document its files.</Empty>
      </div>
    );
  }

  const total = entries.length;
  const sub = loading ? 'Loading…' : (
    <>
      <span key={total} className="bump fl-n">{total}</span> file{total === 1 ? '' : 's'}
      <span className="sep">·</span>
      {sectionNames.length} section{sectionNames.length === 1 ? '' : 's'}
    </>
  );

  const sectionItems = [{ key: 'all', label: 'All', count: total }, ...sectionNames.map(s => ({ key: s, label: s, count: sectionCounts.get(s) }))];
  const listKey = section;

  return (
    <div className="fl">
      {topBar}

      {!isPhone && (
        <aside className="fl-side" aria-label="Sections">
          <div className="eyebrow fl-side-label">Sections</div>
          {loading ? (
            <div className="fl-side-skel">
              {[70, 52, 60, 44].map((w, i) => <span key={i} className="skel skel-line" style={{ width: `${w}%` }} />)}
            </div>
          ) : (
            <nav className="fl-side-list stagger">
              {sectionItems.map(it => (
                <button
                  key={it.key}
                  type="button"
                  className={`fl-side-item ${section === it.key ? 'is-on' : ''}`}
                  aria-current={section === it.key ? 'true' : undefined}
                  onClick={() => setSection(it.key)}
                >
                  <span className="truncate">{it.label}</span>
                  <span key={it.count} className="fl-side-count mono bump">{it.count}</span>
                </button>
              ))}
            </nav>
          )}
        </aside>
      )}

      <div className="fl-main">
        <PageHeader eyebrow="Codebase" title="Source files" sub={sub} />

        {isPhone && (
          <>
            <SearchInput value={search} onChange={setSearch} placeholder="Search files" className="fl-phone-search" />
            {!loading && total > 0 && (
              <div className="fl-chips" role="tablist" aria-label="Sections">
                {sectionItems.map(it => (
                  <button
                    key={it.key}
                    type="button"
                    role="tab"
                    aria-selected={section === it.key}
                    className={`chip-toggle ${section === it.key ? 'is-on' : ''}`}
                    onClick={() => setSection(it.key)}
                  >
                    {it.label}<span className="fl-chip-n mono">{it.count}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {loadError && <p className="notice notice-error fl-error"><Icon name="alert" size={15} />{loadError}</p>}

        <div className="table fl-table">
          <div className="table-head">
            <span>File</span>
            <span>Path</span>
            <span>Description</span>
          </div>

          {loading ? (
            <SkeletonRows rows={7} widths={['26%', '16%', '40%']} />
          ) : total === 0 ? (
            <Empty
              icon="folder"
              title="No files yet"
              action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setSheet({ entry: null })}><Icon name="plus" size={13} />Add your first file</button>}
            >
              Start mapping the codebase: where things live and what they do.
            </Empty>
          ) : filtered.length === 0 ? (
            <Empty
              icon="search"
              title="No matches"
              action={<button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setSection('all'); }}>Clear search</button>}
            >
              No files match “{search}”{section !== 'all' ? ` in ${section}` : ''}.
            </Empty>
          ) : (
            <div key={listKey} className={`fl-body ${settled ? 'fl-body-fade' : ''}`}>
              {groups.map(([name, rows]) => (
                <div key={name} className="fl-group">
                  <div className="table-group">
                    <Icon name="folder" className="table-group-icon" />
                    {name}
                    <span className="count">{rows.length}</span>
                  </div>
                  <div className={`stagger ${settled ? 'settled' : ''}`}>
                    {rows.map(e => (
                      <div
                        key={e.id}
                        id={`fl-row-${e.id}`}
                        role="button"
                        tabIndex={0}
                        className={`table-row fl-row ${highlight === e.id ? 'is-selected' : ''} ${highlight === e.id && urlId === e.id ? 'fl-flash' : ''}`}
                        onClick={() => openRow(e)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openRow(e); } }}
                      >
                        <span className="table-cell fl-file">
                          <TypeBadge type={e.type || detectType(e.name) || 'other'} />
                          <span className="fl-name truncate">{e.name}</span>
                          {e.images?.length > 0 && (
                            <span className="fl-imgs mono" title={`${e.images.length} image${e.images.length === 1 ? '' : 's'}`}>
                              <Icon name="image" size={12} />{e.images.length}
                            </span>
                          )}
                        </span>
                        <span className="table-cell mono fl-path"><span className="truncate">{e.path || '—'}</span></span>
                        <span className="table-cell fl-desc">
                          {e.description ? <span className="fl-desc-text">{e.description}</span> : <span className="t-4">No description</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {sheet && (
        <FileSheet
          key={sheet.entry?.id || 'new'}
          entry={sheet.entry}
          sections={sectionNames}
          teamId={activeTeamId}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
          onDelete={() => setConfirmDelete(sheet.entry)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this file?"
          text={`${confirmDelete.name} will be removed for the whole team. Context entries linking to it will lose the link.`}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={remove}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
