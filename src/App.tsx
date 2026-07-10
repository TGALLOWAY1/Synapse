import { useEffect } from 'react';
import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { DemoRouteGate } from './components/DemoRouteGate';
import { DEMO_PROJECT_ID } from './data/demoProject';
import { TourPage } from './components/tour/TourPage';
import { MetricsPage } from './components/metrics/MetricsPage';
import { LlmTraceViewerPage } from './components/developer/LlmTraceViewerPage';
import { getOwnerToken } from './lib/snapshotClient';
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
  const authError = useAuthStore((s) => s.authError);
  const refreshSession = useAuthStore((s) => s.refreshSession);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={24} />
      </div>
    );
  }

  // A transport/server failure resolving the session is distinct from being
  // signed out. Don't drop the user to the login page (which makes their saved
  // projects look gone) — show a retry so a transient blip is recoverable.
  if (authError && !user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center space-y-4">
          <h2 className="text-xl font-semibold">Couldn't reach the server</h2>
          <p className="text-sm text-neutral-400">
            We couldn't confirm your session, so your projects aren't shown right
            now. Your saved projects are safe on this device — this is usually a
            temporary connection issue.
          </p>
          <button
            type="button"
            onClick={() => { void refreshSession(); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm hover:bg-indigo-700 transition"
          >
            Retry
          </button>
        </div>
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
 *
 * The demo route owns demo hydration: `DemoRouteGate` restores the pinned
 * public snapshot (when needed) before mounting the workspace, so a direct /
 * bookmarked / refreshed demo URL works in a clean browser without going
 * through the Login/Home demo buttons. Exported for route-level tests.
 */
export function ProjectRoute() {
  const { projectId } = useParams();
  if (projectId === DEMO_PROJECT_ID) {
    return (
      <DemoRouteGate>
        <ProjectWorkspace />
      </DemoRouteGate>
    );
  }
  return (
    <RequireAuth>
      <ProjectWorkspace />
    </RequireAuth>
  );
}

/**
 * Owner-only guard for the developer tools (LLM Trace Viewer). Requires both a
 * signed-in session AND possession of the SYNAPSE_OWNER_TOKEN — the same client
 * signal the Snapshots panel uses. A non-owner is redirected to `/`, so the
 * experience for every other user is unchanged. This is a client-side UX gate
 * for a purely client-side debugging surface (the traces are read from local
 * IndexedDB, never the server), consistent with the rest of the app's
 * owner-affordance gating.
 */
function RequireOwner({ children }: { children: ReactElement }) {
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.loading);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-neutral-400" size={24} />
      </div>
    );
  }

  if (!user || !getOwnerToken()) return <Navigate to="/" replace />;
  return children;
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
          <Route
            path="/metrics"
            element={
              <RequireAuth>
                <MetricsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/developer/llm-trace"
            element={
              <RequireOwner>
                <LlmTraceViewerPage />
              </RequireOwner>
            }
          />
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
