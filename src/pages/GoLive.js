import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useTeam } from '../context/TeamContext';
import { TopBarPortal } from '../context/HeaderActionsContext';
import { isUrl, pageLabel } from '../lib/taskText';
import {
  Icon, ConfirmDialog, Tabs, toast, PageHeader, Empty, SearchInput, SkeletonRows, shortDate, fullName,
} from '../ui';
import './GoLive.css';

// Ready for live — the Go Live list, separate from Review again: things on
// dev that still have to be pushed. It's kept while what's left gets cleared
// out, so nothing new is added here: mark things live, or delete them. Once
// both tabs are empty the page can go.

const TABS = [
  { value: 'pending', label: 'On dev' },
  { value: 'live', label: 'Live' },
];
const SELECT = '*, creator:profiles!created_by(first_name, last_name)';

const fileLines = (text) => (text || '').split('\n').map(l => l.trim()).filter(Boolean);

export default function GoLive() {
  const { activeTeamId } = useTeam();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState('pending');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set());
  const [confirm, setConfirm] = useState(null); // { title, text, ids }
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!activeTeamId) return;
    const { data, error } = await supabase.from('golive_items').select(SELECT)
      .eq('team_id', activeTeamId).order('created_at', { ascending: false });
    if (error) {
      if (/does not exist|schema cache|relation/i.test(error.message || '')) setMissing(true);
      else toast(error.message, { icon: 'alert' });
    } else setItems(data || []);
    setLoading(false);
  }, [activeTeamId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const counts = useMemo(() => ({
    pending: items.filter(i => i.status !== 'live').length,
    live: items.filter(i => i.status === 'live').length,
  }), [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(i => (tab === 'live' ? i.status === 'live' : i.status !== 'live'))
      .filter(i => !q || `${i.page} ${i.description} ${i.files}`.toLowerCase().includes(q));
  }, [items, tab, query]);

  const toggleOpen = (id) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const setStatus = async (item, status) => {
    const patch = { status, went_live_at: status === 'live' ? new Date().toISOString() : null, updated_at: new Date().toISOString() };
    setItems(list => list.map(i => (i.id === item.id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from('golive_items').update(patch).eq('id', item.id);
    if (error) { toast(error.message, { icon: 'alert' }); load(); return; }
    toast(status === 'live' ? 'Marked live' : 'Moved back to on dev', {
      action: { label: 'Undo', onClick: () => setStatus({ ...item, ...patch }, item.status === 'live' ? 'live' : 'pending') },
    });
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    const { error } = await supabase.from('golive_items').delete().in('id', confirm.ids);
    setBusy(false);
    if (error) { toast(error.message, { icon: 'alert' }); return; }
    const gone = new Set(confirm.ids);
    setItems(list => list.filter(i => !gone.has(i.id)));
    toast(confirm.ids.length === 1 ? 'Deleted' : `Deleted ${confirm.ids.length} items`);
    setConfirm(null);
  };

  const clearTab = () => {
    const ids = visible.map(i => i.id);
    if (!ids.length) return;
    setConfirm({
      title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}?`,
      text: `Everything ${query.trim() ? 'matching your search ' : ''}in “${TABS.find(t => t.value === tab).label}” is deleted for the whole team. This can’t be undone.`,
      ids,
    });
  };

  const allClear = !loading && !missing && items.length === 0;
  const sub = loading ? ' ' : missing ? 'The Go Live tables aren’t in this database.'
    : allClear ? 'All cleared — this page can be removed.'
      : <>{counts.pending} on dev<span className="sep">·</span>{counts.live} live</>;

  return (
    <div className="page">
      {visible.length > 0 && (
        <TopBarPortal>
          <button type="button" className="btn btn-danger" onClick={clearTab}>
            <Icon name="trash" size={14} /><span className="hide-phone">Delete all {tab === 'live' ? 'live' : 'on dev'}</span>
          </button>
        </TopBarPortal>
      )}

      <PageHeader eyebrow="Go Live" title="Ready for live" sub={sub} />

      {!missing && (
        <div className="gl-bar anim-rise">
          <Tabs value={tab} onChange={setTab} items={TABS.map(t => ({ ...t, count: loading ? undefined : counts[t.value] }))} />
          <SearchInput value={query} onChange={setQuery} placeholder="Search" className="gl-search" />
        </div>
      )}

      {missing ? (
        <Empty icon="rocket" title="Nothing to clear">There’s no Go Live data on this team, so this page can be removed.</Empty>
      ) : (
        <div className="table gl-table" style={{ '--cols': 'minmax(0, 1.3fr) minmax(0, 2fr) 70px 110px 150px' }}>
          <div className="table-head">
            <span>Page</span>
            <span>What changed</span>
            <span className="hide-phone">Files</span>
            <span className="hide-phone">{tab === 'live' ? 'Went live' : 'Added'}</span>
            <span />
          </div>
          {loading ? (
            <SkeletonRows rows={5} widths={['26%', '40%', '4%', '9%', '12%']} />
          ) : visible.length === 0 ? (
            query.trim()
              ? <Empty icon="search" title="No matches">Nothing here matches “{query}”.</Empty>
              : <Empty icon="done" title={allClear ? 'All cleared' : tab === 'live' ? 'Nothing marked live' : 'Nothing left on dev'}>
                {allClear ? 'Every Go Live item is gone. You can remove this page now.' : 'Check the other tab.'}
              </Empty>
          ) : (
            <div key={tab} className="stagger">
              {visible.map(item => {
                const files = fileLines(item.files);
                const isOpen = open.has(item.id);
                const live = item.status === 'live';
                return (
                  <div key={item.id} className={`gl-item ${isOpen ? 'is-open' : ''}`}>
                    <div className="table-row" role="button" tabIndex={0} aria-expanded={isOpen}
                      onClick={() => toggleOpen(item.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') toggleOpen(item.id); }}>
                      <div className="table-cell">
                        <Icon name="chevronRight" size={14} className="gl-chev" />
                        {isUrl(item.page)
                          ? <a className="gl-page truncate" href={item.page} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{pageLabel(item.page)}</a>
                          : <span className="gl-page truncate">{item.page || '—'}</span>}
                      </div>
                      <div className="table-cell"><span className="truncate t-2">{(item.description || '').split('\n')[0] || '—'}</span></div>
                      <div className="table-cell mono hide-phone">{files.length || '—'}</div>
                      <div className="table-cell mono hide-phone">{shortDate(live ? item.went_live_at || item.updated_at : item.created_at)}</div>
                      <div className="table-cell gl-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className={`btn btn-sm ${live ? 'btn-ghost' : ''}`} onClick={() => setStatus(item, live ? 'pending' : 'live')}>
                          {live ? 'Not live' : <><Icon name="rocket" size={13} />Mark live</>}
                        </button>
                        <button type="button" className="btn btn-sm btn-ghost btn-icon gl-del" aria-label="Delete"
                          onClick={() => setConfirm({ title: 'Delete this item?', text: `“${pageLabel(item.page) || item.page}” is deleted for the whole team.`, ids: [item.id] })}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </div>
                    {isOpen && (
                      <div className="gl-detail">
                        {item.description && <p className="gl-desc">{item.description}</p>}
                        {files.length > 0 && (
                          <div className="gl-files">
                            <span className="eyebrow">Files to push · {files.length}</span>
                            <pre>{files.join('\n')}</pre>
                          </div>
                        )}
                        <div className="gl-meta t-3">
                          Added by {fullName(item.creator) || 'someone'} · {shortDate(item.created_at)}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          text={confirm.text}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
