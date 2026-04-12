import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { MeetSynapsePage } from './components/MeetSynapsePage';
import { GlobalErrorBoundary } from './components/GlobalErrorBoundary';
import { ToastContainer } from './components/ToastContainer';

function App() {
  return (
    <GlobalErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<MeetSynapsePage />} />
          <Route path="/p/:projectId" element={<ProjectWorkspace />} />
        </Routes>
        <ToastContainer />
      </BrowserRouter>
    </GlobalErrorBoundary>
  );
}

export default App;
