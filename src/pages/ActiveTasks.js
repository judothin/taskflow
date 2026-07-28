import React from 'react';
import { useLocation } from 'react-router-dom';
import ActiveTasksList from '../components/ActiveTasksList';
import './Dashboard.css';

export default function ActiveTasks() {
  const location = useLocation();
  const initialStatus = location.state?.status || 'all';

  return (
    <div className="dashboard fade-in">
      <ActiveTasksList initialStatus={initialStatus} showTitle={false} showNewTask />
    </div>
  );
}
