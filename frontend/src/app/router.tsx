import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ErrorBoundary } from './ErrorBoundary';
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
const LoginPage = lazy(() => import('../features/auth/pages/LoginPage'));
const OnboardingPage = lazy(() => import('../features/onboarding/pages/OnboardingPage'));
const DiagnosticPage = lazy(() => import('../features/diagnostic/pages/DiagnosticPage'));
const TestPage = lazy(() => import('../features/tests/pages/TestPage'));
const SessionPage = lazy(() => import('../features/session/pages/SessionPage'));
const MapPage = lazy(() => import('../features/map/pages/MapPage'));
const DashboardPage = lazy(() => import('../features/dashboard/pages/DashboardPage'));
const ConnectExtensionPage = lazy(() => import('../features/extension/pages/ConnectExtensionPage'));
/** Founder-only, and gated on the server by `ADMIN_EMAILS` (T-041). The route
 *  existing is not the permission — a non-admin reaching it gets a 403 from the
 *  API and the page says so. Client-side hiding is a courtesy, never a control. */
const AdminPage = lazy(() => import('../features/admin/pages/AdminPage'));
const ResultsPage = lazy(() => import('../features/results/pages/ResultsPage'));
/** Public and deliberately outside `RequireAuth`: a privacy policy behind a
 *  login is not a privacy policy, and a reviewer checking the domain has no
 *  account (T-046). */
const PrivacyPage = lazy(() => import('../features/legal/pages/PrivacyPage'));
const TermsPage = lazy(() => import('../features/legal/pages/TermsPage'));
const ContactPage = lazy(() => import('../features/legal/pages/ContactPage'));

/**
 * The whole route tree sits inside an outermost error boundary (T-047).
 *
 * `AppShell` has its own boundary around the routed screen, which keeps the bar
 * alive when a screen throws — but the bar, the landing page and the sign-in
 * form sit outside that one. A malformed response reaching the bar (a session
 * object with no `newConcepts`) would otherwise still unmount everything to a
 * blank page. Keyed on the path, like the inner one.
 */
export function AppRoutes() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary resetKey={pathname}>
    <Routes>
      {/* Signed out this is the landing page; signed in it forwards to
          whichever screen this learner is actually up to (T-101, T-071). */}
      <Route path="/" element={<LandingRoute />} />

      {/* The sign-in form, reached from the landing page's call to action and
          from every guard that finds no session. Deliberately not `/`: a
          stranger has to be told what this is before being asked for their
          address. */}
      <Route
        path="/signin"
        element={
          <Suspense fallback={<RouteFallback />}>
            <LoginPage />
          </Suspense>
        }
      />

      <Route
        path="/privacy"
        element={
          <Suspense fallback={<RouteFallback />}>
            <PrivacyPage />
          </Suspense>
        }
      />
      <Route
        path="/terms"
        element={
          <Suspense fallback={<RouteFallback />}>
            <TermsPage />
          </Suspense>
        }
      />
      <Route
        path="/contact"
        element={
          <Suspense fallback={<RouteFallback />}>
            <ContactPage />
          </Suspense>
        }
      />

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
        <Route path="/tests/:testId" element={<Suspense fallback={<RouteFallback />}><TestPage /></Suspense>} />
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
        <Route
          path="/results/:topicId"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ResultsPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AdminPage />
            </Suspense>
          }
        />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}
