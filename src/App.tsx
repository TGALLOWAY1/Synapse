import { useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { MeetSynapsePage } from './components/MeetSynapsePage';
import { PrivacyPolicyPage } from './components/PrivacyPolicyPage';
import { RecruiterAdminPage } from './components/RecruiterAdminPage';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { ToastContainer } from './components/ToastContainer';
import { useAuthStore } from './store/authStore';

function App() {
  const refreshSession = useAuthStore((s) => s.refreshSession);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  return (
    <GlobalErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<MeetSynapsePage />} />
          <Route path="/p/:projectId" element={<ProjectWorkspace />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/admin/recruiters" element={<RecruiterAdminPage />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </GlobalErrorBoundary>
  );
}

export default App;
