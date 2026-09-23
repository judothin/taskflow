import React from 'react';
import { QuickLogForm } from './QuickLog';
import './QuickLog.css';
import './Dashboard.css';
import './Companion.css';

// The quick-log form as a full page rather than a modal — the phone dock's
// one write surface. Everything else the companion shows is read-only, so
// this is deliberately the one place with a submit button.
export default function QuickLogPage() {
  return (
    <div className="dashboard fade-in">
      <div className="card companion-quicklog">
        <div className="quicklog-header">
          <div className="quicklog-header-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>
          <div>
            <h2 className="quicklog-title">Log Completed Task</h2>
            <p className="quicklog-sub">Record something finished that wasn&rsquo;t already tracked.</p>
          </div>
        </div>

        <QuickLogForm />
      </div>
    </div>
  );
}
