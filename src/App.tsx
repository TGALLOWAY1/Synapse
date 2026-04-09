import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { MeetSynapsePage } from './components/MeetSynapsePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<MeetSynapsePage />} />
        <Route path="/p/:projectId" element={<ProjectWorkspace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
