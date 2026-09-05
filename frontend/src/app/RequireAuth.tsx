import { Navigate, Outlet } from 'react-router-dom';
import { useMeQuery } from '../features/users/usersApi';
import { RouteFallback } from './RouteFallback';

/**
 * Keeps the signed-in screens signed-in (T-071).
 *
 * Without it, opening `/session` with an expired cookie renders the session
 * player, fires four 401s, and settles on an empty page that looks like a bug
 * rather than a logged-out state.
 */
export function RequireAuth() {
  const { isLoading, isError } = useMeQuery();

  if (isLoading) return <RouteFallback />;
  if (isError) return <Navigate to="/" replace />;
  return <Outlet />;
}
