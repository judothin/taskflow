import React, { createContext, useContext, useEffect, useState } from 'react';

// Lets any page inject its own action buttons into the global TopBar, so the
// bar shows page-specific controls instead of each page carrying its own
// header row. Two contexts: a stable setter (pages) + the current node (TopBar)
// so registering actions never re-renders the page that registered them.
const SetActionsContext = createContext(() => {});
const ActionsContext = createContext(null);

export function HeaderActionsProvider({ children }) {
  const [actions, setActions] = useState(null);
  return (
    <SetActionsContext.Provider value={setActions}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </SetActionsContext.Provider>
  );
}

// TopBar reads this to render whatever the current page registered.
export function useHeaderActions() {
  return useContext(ActionsContext);
}

// Drop this anywhere in a page's JSX; its children become the TopBar actions
// for as long as the page is mounted. Rendering it as a component (rather than
// a hook in the page body) keeps it safe across pages with early returns.
export function TopBarPortal({ children }) {
  const setActions = useContext(SetActionsContext);
  useEffect(() => {
    setActions(children);
    return () => setActions(null);
  });
  return null;
}
