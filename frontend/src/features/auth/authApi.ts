import { api } from '../../store/api';
import type { MagicLink, MagicLinkResponse } from '../../shared';

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
  }),
});

export const { useRequestMagicLinkMutation } = authApi;
