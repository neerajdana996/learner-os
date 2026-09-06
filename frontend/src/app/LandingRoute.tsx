import { lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useMeQuery } from '../features/users/usersApi';
import { useTopicsQuery } from '../features/topics/topicsApi';
import { RouteFallback } from './RouteFallback';

const LandingPage = lazy(() => import('../features/landing/pages/LandingPage'));

/**
 * What `/` means.
 *
 * Every sign-in path lands here: `GET /auth/verify` redirects the browser to
 * `APP_URL` after setting the cookie, OAuth does the same, and dev sign-in
 * navigates here. Without this, all three deposited a freshly signed-in learner
 * back on the sign-in screen with no indication anything had worked (T-071).
 *
 * Signed out it is the landing page, not the sign-in form (T-101). The form
 * moved to `/signin` and is reached from the landing page's call to action
 * rather than by hitting the root URL cold, because someone arriving from a
 * recruitment email needs to be told what this is before being asked for their
 * address.
 *
 * The decision is made from the server's answer, never from client state: the
 * session is an httpOnly cookie the app cannot read, so "am I signed in?" is
 * exactly "does `GET /me` return 200?".
 */
export function LandingRoute() {
  const { data: me, isLoading: loadingMe, isError } = useMeQuery();
  // Only asked once we know there is a user; an anonymous /topics is a 401 that
  // would show up as an error in the console for no reason.
  const { data: topics, isLoading: loadingTopics } = useTopicsQuery(undefined, { skip: !me });

  if (loadingMe) return <RouteFallback />;

  if (isError || !me) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <LandingPage />
      </Suspense>
    );
  }

  if (loadingTopics) return <RouteFallback />;

  // A topic that is still generating belongs to onboarding, which owns the
  // wait screen — sending them to the dashboard would show "Nothing running
  // yet" while their map is being built.
  const usable = topics?.topics.find((topic) => topic.status !== 'generating' && topic.status !== 'failed');
  return <Navigate to={usable ? '/home' : '/onboarding'} replace />;
}
