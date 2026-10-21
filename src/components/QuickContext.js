import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeam } from '../context/TeamContext';
import { OPEN_QUICK_CONTEXT } from '../lib/events';
import { Icon } from '../ui';
import ContextSheet, { CONTEXT_CHANGED } from './ContextSheet';
import './QuickContext.css';

// Kept as exports here so older imports keep working.
export { CONTEXT_CHANGED, OPEN_QUICK_CONTEXT };

// "I just learned something" — reachable from every page (the + menu, the
// phone's create sheet, shortcuts), because the moment you find out where the
// captcha lives is never the moment you're on the Context page. It's the very
// same sheet the Context page uses, files and tags included.
// `hideTrigger`: mount only the sheet, opened by OPEN_QUICK_CONTEXT.
export default function QuickContext({ hideTrigger = false }) {
  const { activeTeamId } = useTeam();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_QUICK_CONTEXT, handler);
    return () => window.removeEventListener(OPEN_QUICK_CONTEXT, handler);
  }, []);

  if (!activeTeamId) return null;

  return (
    <>
      {!hideTrigger && (
        <button type="button" className="btn qctx-trigger" onClick={() => setOpen(true)} title="Save context">
          <Icon name="book" size={15} />
          <span className="qctx-trigger-label">Save context</span>
        </button>
      )}
      {open && (
        <ContextSheet
          onClose={() => setOpen(false)}
          onView={(row) => navigate(`/context?id=${row.id}`)}
        />
      )}
    </>
  );
}
