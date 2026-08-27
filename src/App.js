import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TeamProvider, useTeam } from './context/TeamContext';
import { PetProvider, usePets } from './context/PetContext';
import { StreakProvider } from './context/StreakContext';
import { SpecialBadgesProvider } from './context/SpecialBadgesContext';
import { NotificationProvider } from './context/NotificationContext';
import { TopBarProvider } from './context/TopBarContext';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeCustomizationProvider } from './context/ThemeCustomizationContext';
import { PomodoroProvider } from './context/PomodoroContext';
import './index.css';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import ActiveTasks from './pages/ActiveTasks';
import Tasks from './pages/Tasks';
import TaskDetail from './pages/TaskDetail';
import Completed from './pages/Completed';
import Teams from './pages/Teams';
import Settings from './pages/Settings';
import Help from './pages/Help';
import Files from './pages/Files';
import GuestPortal from './pages/GuestPortal';
import Submissions from './pages/Submissions';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Pomodoro from './pages/Pomodoro';
import Layout from './components/Layout';

// A single, consistent boot loader for every gate. It's transparent (so the
// already-painted theme background shows through) and its spinner only fades in
// after a beat — fast loads show nothing, slow loads a subtle spinner, and the
// gates never flash different "Loading..." screens at each other.
const RouteLoader = () => (
  <div className="route-loader" aria-hidden="true"><span className="route-loader-spinner" /></div>
);

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <RouteLoader />;
  return user ? children : <Navigate to="/login" />;
};

const PublicRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return null;
  return !user ? children : <Navigate to="/dashboard" />;
};

// Signed-in users with zero teams get sent to /onboarding; everyone else
// passes straight through. Existing accounts are seeded into a team by the
// SQL migration, so this only ever triggers for brand-new signups.
const RequireTeam = ({ children }) => {
  const { teams, loading } = useTeam();
  if (loading) return <RouteLoader />;
  return teams.length > 0 ? children : <Navigate to="/onboarding" replace />;
};

const OnboardingRoute = () => {
  const { teams, loading } = useTeam();
  if (loading) return null;
  return teams.length === 0 ? <Onboarding /> : <Navigate to="/dashboard" replace />;
};

/**
 * On a tab's first load, always land on the dashboard.
 * sessionStorage persists across refresh within the same tab (so a refresh
 * keeps you where you are) but is empty in a newly opened tab (so closing and
 * reopening always starts at the dashboard).
 */
function TabFirstLoadRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const KEY = 'tf-tab-initialized';
    if (sessionStorage.getItem(KEY)) return; // refresh within the same tab
    sessionStorage.setItem(KEY, '1');

    // Leave auth / guest entry points alone.
    const exempt = ['/login', '/register', '/submit', '/onboarding'];
    if (exempt.includes(location.pathname) || location.pathname.startsWith('/submit/')) return;

    if (location.pathname !== '/dashboard') {
      navigate('/dashboard', { replace: true });
    }
  }, []); // run once per tab load

  return null;
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
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="active" element={<ActiveTasks />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="completed" element={<Completed />} />
        <Route path="teams" element={<Teams />} />
        <Route path="settings" element={<Settings />} />
        <Route path="help" element={<Help />} />
        <Route path="files" element={<Files />} />
        <Route path="pomodoro" element={<Pomodoro />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="submissions" element={<Submissions />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <TeamProvider>
            <StreakProvider>
            <SpecialBadgesProvider>
            <PetProvider>
              <ThemeCustomizationProvider>
                <TopBarProvider>
                  <NotificationProvider>
                    <PomodoroProvider>
                      <TabFirstLoadRedirect />
                      <AppRoutes />
                    </PomodoroProvider>
                  </NotificationProvider>
                </TopBarProvider>
              </ThemeCustomizationProvider>
            </PetProvider>
            </SpecialBadgesProvider>
            </StreakProvider>
          </TeamProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
