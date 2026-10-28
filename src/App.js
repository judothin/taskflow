import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TeamProvider, useTeam } from './context/TeamContext';
import { PetProvider } from './context/PetContext';
import { NotificationProvider } from './context/NotificationContext';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeCustomizationProvider } from './context/ThemeCustomizationContext';
import { openTask } from './lib/events';
import './styles';

import Login from './pages/Login';
import Register from './pages/Register';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Completed from './pages/Completed';
import Settings from './pages/Settings';
import Context from './pages/Context';
import Files from './pages/Files';
import GuestPortal from './pages/GuestPortal';
import Submissions from './pages/Submissions';
import Review from './pages/Review';
import TeamActivity from './pages/TeamActivity';
import Layout from './components/Layout';

const RouteLoader = () => (
  <div className="route-loader" aria-hidden="true"><span className="route-loader-spinner" /></div>
);

const HOME = '/dashboard';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <RouteLoader />;
  return user ? children : <Navigate to="/login" />;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  return !user ? children : <Navigate to={HOME} replace />;
};

// Brand-new accounts with no team go through onboarding first.
const RequireTeam = ({ children }) => {
  const { teams, loading } = useTeam();
  if (loading) return <RouteLoader />;
  return teams.length > 0 ? children : <Navigate to="/onboarding" replace />;
};

const OnboardingRoute = () => {
  const { teams, loading } = useTeam();
  if (loading) return null;
  return teams.length === 0 ? <Onboarding /> : <Navigate to={HOME} replace />;
};

/** A new tab always starts at home; a refresh keeps you where you are. */
function TabFirstLoadRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    const KEY = 'tf-tab-initialized';
    if (sessionStorage.getItem(KEY)) return;
    sessionStorage.setItem(KEY, '1');
    const exempt = ['/login', '/register', '/submit', '/onboarding'];
    if (exempt.includes(location.pathname) || location.pathname.startsWith('/submit/')) return;
    if (/^\/tasks\/[^/]+$/.test(location.pathname)) return; // a shared task link
    if (location.pathname !== HOME) navigate(HOME, { replace: true });
  }, []);
  return null;
}

/** /tasks/:id — the Tasks list with that task's sheet open on top. */
function TaskLink() {
  const { id } = useParams();
  useEffect(() => { const t = setTimeout(() => openTask(id), 60); return () => clearTimeout(t); }, [id]);
  return <Tasks />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
      <Route path="/submit" element={<GuestPortal />} />
      <Route path="/submit/:slug" element={<GuestPortal />} />
      <Route path="/onboarding" element={<PrivateRoute><OnboardingRoute /></PrivateRoute>} />
      <Route path="/" element={<PrivateRoute><RequireTeam><Layout /></RequireTeam></PrivateRoute>}>
        <Route index element={<Navigate to={HOME} replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskLink />} />
        <Route path="completed" element={<Completed />} />
        <Route path="review" element={<Review />} />
        <Route path="context" element={<Context />} />
        <Route path="files" element={<Files />} />
        <Route path="submissions" element={<Submissions />} />
        <Route path="team-activity" element={<TeamActivity />} />
        <Route path="settings" element={<Settings />} />
        {/* Old addresses: pages that were folded in or removed. */}
        <Route path="active" element={<Navigate to="/tasks" replace />} />
        <Route path="focus" element={<Navigate to={HOME} replace />} />
        <Route path="stats" element={<Navigate to={HOME} replace />} />
        <Route path="quicklog" element={<Navigate to={HOME} replace />} />
        <Route path="go-live" element={<Navigate to="/review?tab=approved" replace />} />
        <Route path="teams" element={<Navigate to="/settings?section=teams" replace />} />
        <Route path="appearance" element={<Navigate to="/settings?section=appearance" replace />} />
        <Route path="*" element={<Navigate to={HOME} replace />} />
      </Route>
      <Route path="*" element={<Navigate to={HOME} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TeamProvider>
            <PetProvider>
              <ThemeCustomizationProvider>
                <NotificationProvider>
                  <TabFirstLoadRedirect />
                  <AppRoutes />
                </NotificationProvider>
              </ThemeCustomizationProvider>
            </PetProvider>
          </TeamProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
