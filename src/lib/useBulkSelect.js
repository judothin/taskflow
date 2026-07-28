import { useState, useCallback, useMemo } from 'react';

// Shared multi-select state for any page that renders a grid of TaskCards.
// A page toggles `selectMode` from a toolbar button; while it's on, cards
// show a checkbox overlay and clicking a card toggles its selection instead
// of opening it. `selectedIds` is a Set of task ids.
export default function useBulkSelect() {
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggle = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  // Toggle the whole visible set: if everything is already selected, clear;
  // otherwise select all of the given ids.
  const toggleAll = useCallback((ids) => {
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  }, []);

  // Enter/leave select mode. Leaving always drops the current selection.
  const enterSelectMode = useCallback(() => setSelectMode(true), []);
  const exitSelectMode = useCallback(() => { setSelectMode(false); setSelectedIds(new Set()); }, []);
  const toggleSelectMode = useCallback(() => {
    setSelectMode(prev => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  return useMemo(() => ({
    selectMode, selectedIds,
    toggle, clear, toggleAll,
    enterSelectMode, exitSelectMode, toggleSelectMode,
  }), [selectMode, selectedIds, toggle, clear, toggleAll, enterSelectMode, exitSelectMode, toggleSelectMode]);
}
