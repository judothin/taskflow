import React from 'react';
import { useLocation } from 'react-router-dom';
import { InlineClock } from '../components/dashboardWidgets';
import ActiveTasksList from '../components/ActiveTasksList';
import './Dashboard.css';

export default function ActiveTasks() {
  const location = useLocation();
  const initialStatus = location.state?.status || 'all';

  return (
    <div className="dashboard fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Active Tasks</h1>
          <p className="page-subtitle">Every task that isn't completed yet</p>
        </div>
        <InlineClock />
      </div>

      <ActiveTasksList initialStatus={initialStatus} showTitle={false} showNewTask />
    </div>
  );
}
