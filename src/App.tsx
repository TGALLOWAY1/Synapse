import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { DEMO_PROJECT_ID } from './data/demoProject';
import { TourPage } from './components/tour/TourPage';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { RecruiterAdminPage } from './components/RecruiterAdminPage';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { useAuthStore } from './store/authStore';
import { migrateGeminiFlashModel } from './lib/modelMigration';
import { Analytics } from '@vercel/analytics/react';

function HomeRoute() {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={24} />
      </div>
    );
  }

  return user ? <HomePage /> : <LoginPage />;
}

/**
 * Client-side guard for authenticated routes (e.g. a project workspace). While
 * the session is resolving we show a spinner; an unauthenticated user is sent
 * to `/`, which renders the login page. This is a UX gate only — the real
 * ownership/authorization checks live on the server (`requireUser`).
 */
function RequireAuth({ children }: { children: ReactElement }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={24} />
      </div>
    );
  }

  return user ? children : <Navigate to="/" replace />;
}

/**
 * Project route guard. The read-only demo project is public so recruiters can
 * explore Synapse without an account or any paid API keys; every other project
 * requires authentication (and the server enforces per-user ownership).
 */
function ProjectRoute() {
  const { projectId } = useParams();
  if (projectId === DEMO_PROJECT_ID) {
    return <ProjectWorkspace />;
  }
  return (
    <RequireAuth>
      <ProjectWorkspace />
    </RequireAuth>
  );
}

/**
 * One-shot migration: move anyone still on `gemini-2.5-flash` to the new
 * default (`gemini-3-flash-preview`) which has better capacity headroom.
 * Gated by a sentinel localStorage key so it only runs once — a user who
 * deliberately re-selects 2.5 Flash afterward is respected.
 */
const GEMINI_MODEL_MIGRATION_KEY = 'GEMINI_MODEL_MIGRATED_2026_04';
function migrateGeminiModel() {
  try {
    if (localStorage.getItem(GEMINI_MODEL_MIGRATION_KEY)) return;
    const current = localStorage.getItem('GEMINI_MODEL');
    if (current === 'gemini-2.5-flash') {
      localStorage.setItem('GEMINI_MODEL', 'gemini-3-flash-preview');
    }
    localStorage.setItem(GEMINI_MODEL_MIGRATION_KEY, '1');
    // Sweep the retired "Meet Synapse" banner-dismissal key — the interactive
    // tour now owns its own completion state (`synapse-tour-completed`).
    localStorage.removeItem('synapse-meet-dismissed');
  } catch {
    // localStorage unavailable (private mode, etc.) — skip migration.
  }
}

function App() {
  const refreshSession = useAuthStore((s) => s.refreshSession);

  useEffect(() => {
    migrateGeminiModel();
    migrateGeminiFlashModel();
    refreshSession();
  }, [refreshSession]);

  return (
    <GlobalErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/about" element={<TourPage />} />
          <Route path="/tour" element={<TourPage />} />
          <Route path="/p/:projectId" element={<ProjectRoute />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/admin/recruiters" element={<RecruiterAdminPage />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
      <Analytics />
    </GlobalErrorBoundary>
  );
}

export default App;
