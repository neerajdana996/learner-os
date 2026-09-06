import { api } from '../../store/api';
import type { DevLogin, MagicLink, MagicLinkResponse } from '@learnos/shared';

/**
 * Magic-link sign-in. The OAuth routes are deliberately absent: the provider
 * redirect chain has to happen in the address bar, so those are plain links
 * (`<a href>`), not fetches — a request here would be blocked by CORS and could
 * not set the session cookie anyway.
 */
export const authApi = api.injectEndpoints({
  endpoints: (build) => ({
    requestMagicLink: build.mutation<MagicLinkResponse, MagicLink>({
      query: (body) => ({ url: '/auth/magic', method: 'POST', body }),
    }),
    /** Dev only (T-070). The backend does not register this route under
     *  NODE_ENV=production, so calling it there is a 404. */
    devLogin: build.mutation<{ ok: true }, DevLogin>({
      query: (body) => ({ url: '/auth/dev-login', method: 'POST', body }),
      invalidatesTags: ['Me'],
    }),
    /**
     * Mints a bearer token for the extension (T-034).
     *
     * A mutation rather than a query, and deliberately uncached: each call
     * issues a new session row, so re-fetching on a re-render would quietly
     * create sessions. `Me` is invalidated because `hasExtensionToken` changes.
     */
    extensionToken: build.mutation<{ token: string; expiresAt: string }, void>({
      query: () => ({ url: '/auth/extension-token', method: 'POST' }),
      invalidatesTags: ['Me'],
    }),
    /**
     * Ends this browser session (T-080). Only the cookie presented is revoked,
     * so the learner's extension — which holds its own token by design — stays
     * connected.
     */
    logout: build.mutation<{ ok: true }, void>({
      query: () => ({ url: '/auth/logout', method: 'POST' }),
      invalidatesTags: ['Me', 'Topic', 'Map', 'Session', 'Due', 'Diagnostic'],
    }),
  }),
});

export const {
  useRequestMagicLinkMutation,
  useDevLoginMutation,
  useExtensionTokenMutation,
  useLogoutMutation,
} = authApi;
