import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { MeetSynapsePage } from './components/MeetSynapsePage';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { RecruiterAdminPage } from './components/RecruiterAdminPage';
import { AdminCaptureDemo } from './components/AdminCaptureDemo';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { useAuthStore } from './store/authStore';
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
  } catch {
    // localStorage unavailable (private mode, etc.) — skip migration.
  }
}

function App() {
  const refreshSession = useAuthStore((s) => s.refreshSession);

  useEffect(() => {
    migrateGeminiModel();
    refreshSession();
  }, [refreshSession]);

  return (
    <GlobalErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/about" element={<MeetSynapsePage />} />
          <Route path="/p/:projectId" element={<ProjectWorkspace />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/admin/recruiters" element={<RecruiterAdminPage />} />
          {import.meta.env.DEV && (
            <Route path="/admin/capture-demo" element={<AdminCaptureDemo />} />
          )}
        </Routes>
        <ToastContainer />
      </BrowserRouter>
      <Analytics />
    </GlobalErrorBoundary>
  );
}

export default App;
