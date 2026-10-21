import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { TopBarPortal } from '../context/HeaderActionsContext';
import useIsPhone from '../lib/useIsPhone';
import { searchRank } from '../lib/fuzzySearch';
import {
  Icon, Sheet, ConfirmDialog, Empty, SearchInput, SkeletonRows, toast, shortDate,
} from '../ui';
import ContextSheet, { CONTEXT_CHANGED, Tag, tagsOf, tagKey, teamTagsFrom } from '../components/ContextSheet';
import { FileSheet } from './Files';
import './Context.css';

// Team knowledge that isn't a task, a file or a project — "the captcha form is
// an Elementor plugin called X". A subject to find it by, a description
// holding what you actually want back later, the source files it's about and
// any number of team-wide tags.

export { ContextSheet };

const preview = (text = '') => text.split(/\n+/).map(s => s.trim()).filter(Boolean).join(' · ');

function ContextRow({ entry, linkedCount, selected, onSelect }) {
  const tags = tagsOf(entry);
  return (
    <button
      type="button"
      className={`ctx-row ${selected ? 'is-selected' : ''}`}
      onClick={() => onSelect(entry.id)}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="ctx-row-top">
        <span className="ctx-row-subject truncate">{entry.subject}</span>
        {tags.length > 0 && (
          <span className="ctx-row-tags">
            {tags.slice(0, 3).map(t => <Tag key={tagKey(t)} tag={t} />)}
            {tags.length > 3 && <span className="tag">+{tags.length - 3}</span>}
          </span>
        )}
        {linkedCount > 0 && (
          <span className="ctx-row-count mono">{linkedCount} file{linkedCount === 1 ? '' : 's'}</span>
        )}
      </span>
      <span className="ctx-row-preview truncate">{preview(entry.description) || <span className="t-4">No description</span>}</span>
    </button>
  );
}

function ContextDetail({ entry, files, onOpenFile, onAddFile, actions }) {
  const tags = tagsOf(entry);
  const paragraphs = (entry.description || '').split(/\n+/).filter(s => s.trim());
  return (
    <article key={entry.id} className="ctx-detail-inner">
      <div className="ctx-detail-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow ctx-detail-eyebrow">
            Context<span className="ctx-dot-sep">·</span>{shortDate(entry.updated_at || entry.created_at)}
          </div>
          <h2 className="ctx-detail-title">{entry.subject}</h2>
          {tags.length > 0 && (
            <div className="ctx-detail-tags">
              {tags.map(t => <Tag key={tagKey(t)} tag={t} />)}
            </div>
          )}
        </div>
        {actions && <div className="ctx-detail-actions">{actions}</div>}
      </div>

      <div className="ctx-detail-body">
        {paragraphs.length
          ? paragraphs.map((p, i) => <p key={i}>{p}</p>)
          : <p className="t-3">No description.</p>}
      </div>

      <hr className="divider ctx-detail-divider" />

      <div className="ctx-files-head">
        <span className="sheet-label">Linked files</span>
        {onAddFile && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onAddFile}>
            <Icon name="plus" size={13} />Add file
          </button>
        )}
      </div>
      {files.length ? (
        <div className="ctx-files stagger">
          {files.map(f => (
            <button key={f.id} type="button" className="ctx-file" onClick={() => onOpenFile(f)} title="Show in Files">
              <Icon name="file" size={16} className="ctx-file-icon" />
              <span className="ctx-file-name mono truncate">{f.name}</span>
              <span className="ctx-file-path truncate">{[f.section, f.path].filter(Boolean).join(' · ')}</span>
              <Icon name="arrowUpRight" size={14} className="ctx-file-go" />
            </button>
          ))}
        </div>
      ) : (
        <p className="ctx-files-none">No files linked yet.</p>
      )}
    </article>
  );
}

export default function Context() {
  const { activeTeamId } = useTeam();
  const isPhone = useIsPhone();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [entries, setEntries] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [activeTags, setActiveTags] = useState([]);
  const [selectedId, setSelectedId] = useState(() => params.get('id'));
  const [sheet, setSheet] = useState(null); // null | { entry }
  const [phoneDetail, setPhoneDetail] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [addFileTo, setAddFileTo] = useState(null); // entry id the new file gets linked to
  const [settled, setSettled] = useState(false);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    if (!activeTeamId) { setEntries([]); setLoading(false); return; }
    const [{ data, error }, { data: fileRows }] = await Promise.all([
      supabase.from('context_entries').select('*')
        .eq('team_id', activeTeamId).order('updated_at', { ascending: false }),
      supabase.from('file_entries').select('id, name, path, section')
        .eq('team_id', activeTeamId).order('name'),
    ]);
    setLoadError(error ? error.message : '');
    if (!error) setEntries(data || []);
    setFiles(fileRows || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  // Saves from the sheet here or from the app-wide quick add.
  useEffect(() => {
    const handler = (e) => {
      load();
      if (e.detail?.id) setSelectedId(e.detail.id);
    };
    window.addEventListener(CONTEXT_CHANGED, handler);
    return () => window.removeEventListener(CONTEXT_CHANGED, handler);
  }, [load]);

  // A "View" from the quick-add toast lands here with ?id=.
  const urlId = params.get('id');
  useEffect(() => {
    if (urlId) { setSelectedId(urlId); if (isPhone) setPhoneDetail(true); }
  }, [urlId, isPhone]);

  // After the first paint the list shouldn't replay its stagger on re-render.
  useEffect(() => {
    if (loading || settled) return undefined;
    const t = setTimeout(() => setSettled(true), 700);
    return () => clearTimeout(t);
  }, [loading, settled]);

  const fileById = useMemo(() => new Map(files.map(f => [f.id, f])), [files]);
  const linkedFiles = useCallback((entry) => (Array.isArray(entry?.file_ids) ? entry.file_ids : [])
    .map(id => fileById.get(id)).filter(Boolean), [fileById]);

  const teamTags = useMemo(() => teamTagsFrom(entries), [entries]);
  const tagCounts = useMemo(() => {
    const m = new Map();
    entries.forEach(e => tagsOf(e).forEach(t => m.set(tagKey(t), (m.get(tagKey(t)) || 0) + 1)));
    return m;
  }, [entries]);

  // Drop filters for tags that no longer exist on any entry.
  useEffect(() => {
    setActiveTags(list => {
      const next = list.filter(k => tagCounts.has(k));
      return next.length === list.length ? list : next;
    });
  }, [tagCounts]);

  const filtered = useMemo(() => {
    const byTag = activeTags.length
      ? entries.filter(e => tagsOf(e).some(t => activeTags.includes(tagKey(t))))
      : entries;
    return searchRank(byTag, search, e => [
      { text: e.subject, weight: 3 },
      { text: tagsOf(e).map(t => t.name).join(' '), weight: 2 },
      { text: e.description, weight: 1 },
      { text: linkedFiles(e).map(f => f.name).join(' '), weight: 1 },
    ]);
  }, [entries, activeTags, search, linkedFiles]);

  const selected = entries.find(e => e.id === selectedId) || null;

  // Desktop always shows something on the right when there's something to show.
  useEffect(() => {
    if (loading || isPhone) return;
    if (!selected && filtered.length) setSelectedId(filtered[0].id);
  }, [loading, isPhone, selected, filtered]);

  const select = (id) => {
    setSelectedId(id);
    if (isPhone) setPhoneDetail(true);
    if (params.get('id')) { const p = new URLSearchParams(params); p.delete('id'); setParams(p, { replace: true }); }
  };

  const toggleTagFilter = (k) => setActiveTags(list => (list.includes(k) ? list.filter(x => x !== k) : [...list, k]));

  const openFile = (f) => navigate(`/files?id=${f.id}`);

  // "Add file" on an entry: the file goes into Files and is linked to the
  // entry. Read from a ref so "Save & add another" keeps adding to the
  // latest list rather than one captured when the sheet opened.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const linkNewFile = async (entryId, f) => {
    if (!f?.id) return;
    setFiles(list => (list.some(x => x.id === f.id) ? list : [...list, f].sort((a, b) => a.name.localeCompare(b.name))));
    const entry = entriesRef.current.find(e => e.id === entryId);
    if (!entry) return;
    const ids = [...new Set([...(Array.isArray(entry.file_ids) ? entry.file_ids : []), f.id])];
    const next = entriesRef.current.map(e => (e.id === entryId ? { ...e, file_ids: ids } : e));
    entriesRef.current = next;
    setEntries(next);
    const { error } = await supabase.from('context_entries').update({ file_ids: ids }).eq('id', entryId);
    if (error) { toast(`Added the file, but couldn’t link it: ${error.message}`, { icon: 'alert' }); load(); }
  };
  const fileSections = useMemo(() => [...new Set(files.map(f => (f.section || '').trim()).filter(Boolean))].sort(), [files]);

  const remove = async () => {
    const entry = confirmDelete;
    if (!entry) return;
    setDeleting(true);
    const { error } = await supabase.from('context_entries').delete().eq('id', entry.id);
    setDeleting(false);
    setConfirmDelete(null);
    if (error) { toast(error.message, { icon: 'alert' }); return; }
    setPhoneDetail(false);
    const idx = filtered.findIndex(e => e.id === entry.id);
    const next = filtered[idx + 1] || filtered[idx - 1];
    setSelectedId(next?.id || null);
    setEntries(list => list.filter(e => e.id !== entry.id));
    toast('Context deleted', {
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error: err } = await supabase.from('context_entries').insert(entry);
          if (err) { toast(err.message, { icon: 'alert' }); return; }
          setSelectedId(entry.id);
          load();
        },
      },
    });
  };

  const topBar = (
    <TopBarPortal>
      {!isPhone && (
        <SearchInput inputRef={searchRef} value={search} onChange={setSearch} placeholder="Search context" className="ctx-topsearch" />
      )}
      <button type="button" className="btn btn-primary" onClick={() => setSheet({ entry: null })} disabled={!activeTeamId}>
        <Icon name="plus" size={15} />{isPhone ? 'Add' : 'Add context'}
      </button>
    </TopBarPortal>
  );

  if (!activeTeamId) {
    return (
      <div className="ctx-noteam">
        {topBar}
        <Empty icon="users" title="No team yet">Join or create a team to save context.</Empty>
      </div>
    );
  }

  const detailActions = selected && (
    <>
      <button type="button" className="btn" onClick={() => setSheet({ entry: selected })}>Edit</button>
      <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(selected)}>Delete</button>
    </>
  );

  const listKey = activeTags.join('|') || 'all';

  return (
    <div className="ctx">
      {topBar}

      <section className="ctx-list-col">
        <header className="ctx-head anim-rise">
          <div className="eyebrow">Knowledge</div>
          <h1 className="page-title">Context</h1>
          <p className="ctx-sub">
            {loading ? 'Loading…' : (
              <><span key={entries.length} className="bump ctx-sub-n">{entries.length}</span> entr{entries.length === 1 ? 'y' : 'ies'}. Notes on how things are built, for later.</>
            )}
          </p>
          {isPhone && (
            <SearchInput value={search} onChange={setSearch} placeholder="Search context" className="ctx-phone-search" />
          )}
        </header>

        {teamTags.length > 0 && (
          <div className="ctx-filters anim-rise" role="group" aria-label="Filter by tag">
            {teamTags.map(t => {
              const k = tagKey(t);
              const on = activeTags.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  className={`chip-toggle ctx-filter ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleTagFilter(k)}
                >
                  <span className={`ctx-swatch tag-${t.color}`} aria-hidden="true" />
                  {t.name}
                  <span className="ctx-filter-n mono">{tagCounts.get(k) || 0}</span>
                </button>
              );
            })}
            {activeTags.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm ctx-filter-clear" onClick={() => setActiveTags([])}>Clear</button>
            )}
          </div>
        )}

        {loadError && <p className="notice notice-error ctx-error"><Icon name="alert" size={15} />{loadError}</p>}

        {loading ? (
          <div className="ctx-skel"><SkeletonRows rows={5} widths={['56%', '18%']} /></div>
        ) : filtered.length === 0 ? (
          <div key={`empty-${listKey}`} className="anim-fade">
            {search || activeTags.length ? (
              <Empty
                icon="search"
                title="Nothing matches"
                action={<button type="button" className="btn btn-sm" onClick={() => { setSearch(''); setActiveTags([]); }}>Clear filters</button>}
              >
                {search ? <>No context matches “{search}”.</> : 'No entries have those tags.'}
              </Empty>
            ) : (
              <Empty
                icon="book"
                title="No context saved yet"
                action={<button type="button" className="btn btn-primary btn-sm" onClick={() => setSheet({ entry: null })}><Icon name="plus" size={13} />Add the first one</button>}
              >
                Where something lives, which plugin controls what, why a decision was made.
              </Empty>
            )}
          </div>
        ) : (
          <div key={listKey} className={`ctx-rows stagger ${settled ? 'settled' : ''} ${listKey !== 'all' ? 'anim-fade' : ''}`}>
            {filtered.map(e => (
              <ContextRow
                key={e.id}
                entry={e}
                linkedCount={linkedFiles(e).length}
                selected={!isPhone && e.id === selectedId}
                onSelect={select}
              />
            ))}
          </div>
        )}
      </section>

      {!isPhone && (
        <section className="ctx-detail">
          {loading ? (
            <div className="ctx-detail-inner">
              <span className="skel skel-line" style={{ width: 120, display: 'block' }} />
              <span className="skel" style={{ width: '46%', height: 30, display: 'block', marginTop: 18 }} />
              <span className="skel skel-line" style={{ width: '70%', display: 'block', marginTop: 34 }} />
              <span className="skel skel-line" style={{ width: '54%', display: 'block', marginTop: 14 }} />
            </div>
          ) : selected ? (
            <ContextDetail
              entry={selected}
              files={linkedFiles(selected)}
              onOpenFile={openFile}
              onAddFile={() => setAddFileTo(selected.id)}
              actions={detailActions}
            />
          ) : (
            <div className="ctx-detail-empty">
              <Empty icon="book" title={entries.length ? 'Pick an entry' : 'Nothing here yet'}>
                {entries.length ? 'Choose something on the left to read it.' : 'Saved context shows up here.'}
              </Empty>
            </div>
          )}
        </section>
      )}

      {isPhone && phoneDetail && selected && (
        <Sheet
          eyebrow={<>Context<span className="t-4">· {shortDate(selected.updated_at || selected.created_at)}</span></>}
          onClose={() => setPhoneDetail(false)}
          mainClassName="ctx-phone-main"
          footer={(
            <>
              <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(selected)}>Delete</button>
              <span className="spacer" />
              <button type="button" className="btn btn-primary" onClick={() => setSheet({ entry: selected })}>Edit</button>
            </>
          )}
        >
          <ContextDetail entry={selected} files={linkedFiles(selected)} onOpenFile={openFile} onAddFile={() => setAddFileTo(selected.id)} />
        </Sheet>
      )}

      {sheet && (
        <ContextSheet
          key={sheet.entry?.id || 'new'}
          entry={sheet.entry}
          files={files}
          teamTags={teamTags}
          onClose={() => setSheet(null)}
          onSaved={(row) => { if (row?.id) setSelectedId(row.id); }}
        />
      )}

      {addFileTo && (
        <FileSheet
          entry={null}
          sections={fileSections}
          teamId={activeTeamId}
          onClose={() => setAddFileTo(null)}
          onSaved={(f) => linkNewFile(addFileTo, f)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this context?"
          text={`“${confirmDelete.subject}” will be removed for the whole team.`}
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
