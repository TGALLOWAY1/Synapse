import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { HomePage } from './components/HomePage';
import { LoginPage } from './components/LoginPage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { MeetSynapsePage } from './components/MeetSynapsePage';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { RecruiterAdminPage } from './components/RecruiterAdminPage';
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

function App() {
  const refreshSession = useAuthStore((s) => s.refreshSession);

  useEffect(() => {
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
        </Routes>
        <ToastContainer />
      </BrowserRouter>
      <Analytics />
    </GlobalErrorBoundary>
  );
}

export default App;
