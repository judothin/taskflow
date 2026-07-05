import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { TeamProvider, useTeam } from './context/TeamContext';
import { PetProvider, usePets } from './context/PetContext';
import { NotificationProvider } from './context/NotificationContext';
import { TopBarProvider } from './context/TopBarContext';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeCustomizationProvider } from './context/ThemeCustomizationContext';
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
import Pets from './pages/Pets';
import PetReveal from './pages/PetReveal';
import ChooseGamification from './pages/ChooseGamification';
import Settings from './pages/Settings';
import Help from './pages/Help';
import Files from './pages/Files';
import GuestPortal from './pages/GuestPortal';
import Submissions from './pages/Submissions';
import Projects from './pages/Projects';
import ProjectDetail from './pages/ProjectDetail';
import Layout from './components/Layout';
import PetPopupHost from './components/PetPopupHost';

const PrivateRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)' }}>Loading...</div>;
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
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)' }}>Loading...</div>;
  return teams.length > 0 ? children : <Navigate to="/onboarding" replace />;
};

const OnboardingRoute = () => {
  const { teams, loading } = useTeam();
  if (loading) return null;
  return teams.length === 0 ? <Onboarding /> : <Navigate to="/dashboard" replace />;
};

// Runs after RequireTeam/RequireGamificationChoice, so a team already
// exists and the user has answered "do you want pets/XP?" by this point.
// Sends anyone with zero pets or an unclaimed pet unlock to /pet-reveal
// first — unless they've personally opted out, in which case there's
// nothing to reveal and they should never be forced through this at all.
const RequirePet = ({ children }) => {
  const { pets, pendingUnlocks, loading, userGamificationEnabled } = usePets();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)' }}>Loading...</div>;
  if (!userGamificationEnabled) return children;
  const needsReveal = pets.length === 0 || pendingUnlocks > 0;
  return needsReveal ? <Navigate to="/pet-reveal" replace /> : children;
};

// Runs after RequireTeam. New signups (and existing users who never got a
// pet — see the migration's backfill) haven't said whether they even want
// the pet/XP system yet; send them to choose before anything else. Once
// `gamification_choice_made` is true this is a pure passthrough forever.
const RequireGamificationChoice = ({ children }) => {
  const { userLevel, loading } = usePets();
  if (loading) return <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)' }}>Loading...</div>;
  if (userLevel && userLevel.gamification_choice_made === false) {
    return <Navigate to="/choose-gamification" replace />;
  }
  return children;
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
    const exempt = ['/login', '/register', '/submit', '/onboarding', '/pet-reveal', '/choose-gamification'];
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
      <Route path="/choose-gamification" element={<PrivateRoute><RequireTeam><ChooseGamification /></RequireTeam></PrivateRoute>} />
      <Route path="/pet-reveal" element={<PrivateRoute><RequireTeam><RequireGamificationChoice><PetReveal /></RequireGamificationChoice></RequireTeam></PrivateRoute>} />
      <Route path="/" element={<PrivateRoute><RequireTeam><RequireGamificationChoice><RequirePet><Layout /></RequirePet></RequireGamificationChoice></RequireTeam></PrivateRoute>}>
        <Route index element={<Navigate to="/dashboard" />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="active" element={<ActiveTasks />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="tasks/:id" element={<TaskDetail />} />
        <Route path="completed" element={<Completed />} />
        <Route path="teams" element={<Teams />} />
        <Route path="pets" element={<Pets />} />
        <Route path="settings" element={<Settings />} />
        <Route path="help" element={<Help />} />
        <Route path="files" element={<Files />} />
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
            <PetProvider>
              <ThemeCustomizationProvider>
                <TopBarProvider>
                  <NotificationProvider>
                    <TabFirstLoadRedirect />
                    <AppRoutes />
                    <PetPopupHost />
                  </NotificationProvider>
                </TopBarProvider>
              </ThemeCustomizationProvider>
            </PetProvider>
          </TeamProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
