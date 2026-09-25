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
import Settings from './pages/Settings';
import useIsPhone from './lib/useIsPhone';
import Context from './pages/Context';
import Focus from './pages/Focus';
import Stats from './pages/Stats';
import QuickLogPage from './pages/QuickLogPage';
import Help from './pages/Help';
import Files from './pages/Files';
import GuestPortal from './pages/GuestPortal';
import Submissions from './pages/Submissions';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Pomodoro from './pages/Pomodoro';
import MobileAppearance from './pages/MobileAppearance';
import GoLive from './pages/GoLive';
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
  const isPhone = useIsPhone();
  if (loading) return null;
  return !user ? children : <Navigate to={homePath(isPhone)} replace />;
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
  const isPhone = useIsPhone();
  if (loading) return null;
  return teams.length === 0 ? <Onboarding /> : <Navigate to={homePath(isPhone)} replace />;
};

/**
 * On a tab's first load, always land on the home page for this device.
 * sessionStorage persists across refresh within the same tab (so a refresh
 * keeps you where you are) but is empty in a newly opened tab (so closing and
 * reopening always starts at home).
 */
function TabFirstLoadRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const home = homePath(useIsPhone());

  useEffect(() => {
    const KEY = 'tf-tab-initialized';
    if (sessionStorage.getItem(KEY)) return; // refresh within the same tab
    sessionStorage.setItem(KEY, '1');

    // Leave auth / guest entry points alone.
    const exempt = ['/login', '/register', '/submit', '/onboarding'];
    if (exempt.includes(location.pathname) || location.pathname.startsWith('/submit/')) return;

    if (location.pathname !== home) {
      navigate(home, { replace: true });
    }
  }, []); // run once per tab load

  return null;
}

// Where "home" is, by device. A phone opens the companion's Focus screen
// (what you're working on now); the dashboard's widget grid is a poor first
// thing to meet on a phone, and on a phone it isn't reachable at all — see
// DashboardRoute. Every redirect in this file goes through here so they can't
// drift apart.
const homePath = (isPhone) => (isPhone ? '/focus' : '/dashboard');

function HomeRedirect() {
  return <Navigate to={homePath(useIsPhone())} replace />;
}

// Pages whose layout is built for a wide screen. On a phone they redirect to
// Focus rather than rendering a desktop grid at 390px — the companion is a
// deliberate subset, and half-working screens are worse than absent ones. A
// stale bookmark, a deep link or a teammate's shared URL all land somewhere
// usable instead.
//
// The mobile-ready set is: focus, active, completed, stats, quicklog, context
// and a task's detail view. Everything else goes through here.
function DesktopOnly({ children }) {
  const isPhone = useIsPhone();
  if (isPhone) return <Navigate to="/focus" replace />;
  return children;
}

// Appearance on a phone is its own screen (phone-only overrides); on desktop
// the same URL goes to the full Settings section.
function AppearanceRoute() {
  const isPhone = useIsPhone();
  return isPhone ? <MobileAppearance /> : <Navigate to="/settings?section=appearance" replace />;
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
        <Route index element={<HomeRedirect />} />
        <Route path="dashboard" element={<DesktopOnly><Dashboard /></DesktopOnly>} />
        <Route path="active" element={<ActiveTasks />} />
        {/* Companion destinations — the phone dock's five tabs. They're
            ordinary pages, so they work at any width; the dock is just the
            only place that links to them. */}
        <Route path="focus" element={<Focus />} />
        <Route path="stats" element={<Stats />} />
        <Route path="quicklog" element={<QuickLogPage />} />
        <Route path="tasks" element={<DesktopOnly><Tasks /></DesktopOnly>} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="completed" element={<Completed />} />
        {/* Teams moved into Settings — keep old links, bookmarks and the
            in-app "Manage teams" entry point working. */}
        <Route path="teams" element={<Navigate to="/settings?section=teams" replace />} />
        <Route path="settings" element={<DesktopOnly><Settings /></DesktopOnly>} />
        <Route path="appearance" element={<AppearanceRoute />} />
        <Route path="help" element={<DesktopOnly><Help /></DesktopOnly>} />
        <Route path="files" element={<DesktopOnly><Files /></DesktopOnly>} />
        <Route path="context" element={<Context />} />
        <Route path="go-live" element={<DesktopOnly><GoLive /></DesktopOnly>} />
        <Route path="pomodoro" element={<DesktopOnly><Pomodoro /></DesktopOnly>} />
        <Route path="projects" element={<DesktopOnly><Projects /></DesktopOnly>} />
        <Route path="projects/:id" element={<DesktopOnly><ProjectDetail /></DesktopOnly>} />
        <Route path="submissions" element={<DesktopOnly><Submissions /></DesktopOnly>} />
      </Route>
      <Route path="*" element={<HomeRedirect />} />
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
