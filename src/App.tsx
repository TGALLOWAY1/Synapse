import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './components/HomePage';
import { ProjectWorkspace } from './components/ProjectWorkspace';
import { BranchCanvas } from './components/BranchCanvas';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/p/:projectId" element={<ProjectWorkspace />} />
        <Route path="/p/:projectId/branch/:branchId" element={<BranchCanvas />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
