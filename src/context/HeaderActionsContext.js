import React, { createContext, useContext, useLayoutEffect, useState } from 'react';

// Lets any page inject its own action buttons into the global TopBar, so the
// bar shows page-specific controls instead of each page carrying its own
// header row. Two contexts: a stable setter (pages) + the current node (TopBar)
// so registering actions never re-renders the page that registered them.
const SetActionsContext = createContext(() => {});
const ActionsContext = createContext(null);
// Same split for page-specific entries in the top bar's "⋯" menu — things a
// page offers that don't need to be a button of their own (Edit Dashboard).
const SetMenuContext = createContext(() => {});
const MenuContext = createContext(null);

export function HeaderActionsProvider({ children }) {
  const [actions, setActions] = useState(null);
  const [menuItems, setMenuItems] = useState(null);
  return (
    <SetActionsContext.Provider value={setActions}>
      <SetMenuContext.Provider value={setMenuItems}>
        <ActionsContext.Provider value={actions}>
          <MenuContext.Provider value={menuItems}>{children}</MenuContext.Provider>
        </ActionsContext.Provider>
      </SetMenuContext.Provider>
    </SetActionsContext.Provider>
  );
}

// TopBarMenu reads this: [{ key, label, icon, onClick, hint? }] or null.
export function useTopBarMenuItems() {
  return useContext(MenuContext);
}

// A page's own entries for the "⋯" menu, while it's mounted. Same shape as
// TopBarPortal: render it, don't call it.
export function TopBarMenuItems({ items }) {
  const setItems = useContext(SetMenuContext);
  useLayoutEffect(() => {
    setItems(items && items.length ? items : null);
    return () => setItems(null);
  });
  return null;
}

// TopBar reads this to render whatever the current page registered.
export function useHeaderActions() {
  return useContext(ActionsContext);
}

// Drop this anywhere in a page's JSX; its children become the TopBar actions
// for as long as the page is mounted. Rendering it as a component (rather than
// a hook in the page body) keeps it safe across pages with early returns.
// Layout effects, not effects: the actions have to land in the same commit
// as the page itself. With a plain effect the top bar spends a frame with no
// actions between pages — its buttons blink out and back, and the page under
// it jumps as the bar changes height.
export function TopBarPortal({ children }) {
  const setActions = useContext(SetActionsContext);
  useLayoutEffect(() => {
    setActions(children);
    return () => setActions(null);
  });
  return null;
}
