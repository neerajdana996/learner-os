import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { LandingRoute } from './LandingRoute';
import { RequireAuth } from './RequireAuth';
import { RouteFallback } from './RouteFallback';

/**
 * Every page is split out of the entry bundle.
 *
 * The first thing a learner loads is the login screen; without splitting they
 * would also download the diagnostic, the session player and the map before
 * being able to type an email. Each of these becomes its own chunk, fetched
 * when its route is first visited.
 */
const OnboardingPage = lazy(() => import('../features/onboarding/pages/OnboardingPage'));
const DiagnosticPage = lazy(() => import('../features/diagnostic/pages/DiagnosticPage'));
const SessionPage = lazy(() => import('../features/session/pages/SessionPage'));
const MapPage = lazy(() => import('../features/map/pages/MapPage'));
const DashboardPage = lazy(() => import('../features/dashboard/pages/DashboardPage'));
const ConnectExtensionPage = lazy(() => import('../features/extension/pages/ConnectExtensionPage'));

export function AppRoutes() {
  return (
    <Routes>
      {/* Signed out this is the login screen — no shell, no score badge,
          nothing to distract from one action. Signed in it forwards to
          whichever screen this learner is actually up to. */}
      <Route path="/" element={<LandingRoute />} />

      <Route element={<RequireAuth />}>
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
        <Route
          path="/home"
          element={
            <Suspense fallback={<RouteFallback />}>
              <DashboardPage />
            </Suspense>
          }
        />
        <Route
          path="/session"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SessionPage />
            </Suspense>
          }
        />
        <Route
          path="/map"
          element={
            <Suspense fallback={<RouteFallback />}>
              <MapPage />
            </Suspense>
          }
        />
        <Route
          path="/map/:topicId"
          element={
            <Suspense fallback={<RouteFallback />}>
              <MapPage />
            </Suspense>
          }
        />
        <Route
          path="/connect"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ConnectExtensionPage />
            </Suspense>
          }
        />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
