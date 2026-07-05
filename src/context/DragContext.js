import React, { createContext, useContext, useRef } from 'react';

// We use a ref (not state) so setting the dragged task never causes a re-render.
const DragContext = createContext(null);

export function DragProvider({ children }) {
  const draggedTask = useRef(null);
  return (
    <DragContext.Provider value={draggedTask}>
      {children}
    </DragContext.Provider>
  );
}

// Returns the ref — call .current to read/write the dragged task.
export function useDraggedTask() {
  return useContext(DragContext);
}
