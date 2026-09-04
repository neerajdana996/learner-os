import { Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';

/**
 * Route table. loop.md §4: every new page must be registered here.
 * Sprint 2 adds: /onboarding, /diagnostic, /map, /session, /home.
 */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="*" element={<LoginPage />} />
    </Routes>
  );
}
