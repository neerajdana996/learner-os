import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { RouteFallback } from './RouteFallback';

/**
 * Every page is split out of the entry bundle.
 *
 * The first thing a learner loads is the login screen; without splitting they
 * would also download the diagnostic, the session player and the map before
 * being able to type an email. Each of these becomes its own chunk, fetched
 * when its route is first visited.
 */
const LoginPage = lazy(() => import('../features/auth/pages/LoginPage'));
const OnboardingPage = lazy(() => import('../features/topics/pages/OnboardingPage'));
const DiagnosticPage = lazy(() => import('../features/diagnostic/pages/DiagnosticPage'));

export function AppRoutes() {
  return (
    <Routes>
      {/* Signed-out: no shell, no score badge, nothing to distract from one action. */}
      <Route
        path="/"
        element={
          <Suspense fallback={<RouteFallback />}>
            <LoginPage />
          </Suspense>
        }
      />

      <Route element={<AppShell />}>
        <Route
          path="/onboarding"
          element={
            <Suspense fallback={<RouteFallback />}>
              <OnboardingPage />
            </Suspense>
          }
        />
        <Route
          path="/diagnostic/:topicId"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DiagnosticPage />
            </Suspense>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
