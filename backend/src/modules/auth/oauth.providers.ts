import { env } from '../../lib/env.js';

/**
 * The two provider integrations, behind one shape (T-055).
 *
 * Each returns a **verified** identity or nothing. Verification is the whole
 * security story here: linking a provider identity to an existing account by
 * email means the provider is vouching that the person controls that address.
 * GitHub in particular lets anyone type any address onto their profile, so an
 * unverified address must never link — otherwise setting a GitHub email to a
 * victim's address would be a one-click account takeover.
 */
export type ProviderName = 'google' | 'github';

export interface ProviderIdentity {
  providerUserId: string;
  email: string;
  /** False means: do not link, do not create. See above. */
  emailVerified: boolean;
  name: string | null;
}

export class OAuthError extends Error {
  constructor(
    public readonly reason:
      | 'unknown_provider'
      | 'not_configured'
      | 'bad_state'
      | 'exchange_failed'
      | 'no_verified_email',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface Provider {
  name: ProviderName;
  configured(): boolean;
  authorizeUrl(state: string): string;
  exchange(code: string): Promise<ProviderIdentity>;
}

function redirectUri(provider: ProviderName): string {
  return `${env.API_URL}/auth/oauth/${provider}/callback`;
}

async function postForm(url: string, body: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    throw new OAuthError('exchange_failed', `token endpoint returned ${res.status}`);
  }
  return res.json();
}

const google: Provider = {
  name: 'google',
  configured: () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  authorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri('google'),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      // Without this Google silently reuses a prior grant and may omit the
      // fields we need on a repeat sign-in.
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  },
  async exchange(code) {
    const token = (await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri('google'),
      grant_type: 'authorization_code',
    })) as { access_token?: string };

    if (!token.access_token) throw new OAuthError('exchange_failed', 'google returned no access token');

    // The userinfo endpoint rather than decoding the id_token: same claims, no
    // JWT verification to get subtly wrong.
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${token.access_token}` },
    });
    if (!res.ok) throw new OAuthError('exchange_failed', `google userinfo returned ${res.status}`);

    const profile = (await res.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
    };
    if (!profile.sub || !profile.email) {
      throw new OAuthError('exchange_failed', 'google profile missing sub or email');
    }
    return {
      providerUserId: profile.sub,
      email: profile.email.toLowerCase(),
      emailVerified: profile.email_verified === true,
      name: profile.name ?? null,
    };
  },
};

const github: Provider = {
  name: 'github',
  configured: () => Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
  authorizeUrl(state) {
    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: redirectUri('github'),
      scope: 'read:user user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  },
  async exchange(code) {
    const token = (await postForm('https://github.com/login/oauth/access_token', {
      code,
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      redirect_uri: redirectUri('github'),
    })) as { access_token?: string };

    if (!token.access_token) throw new OAuthError('exchange_failed', 'github returned no access token');

    const headers = {
      authorization: `Bearer ${token.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'learnos',
    };

    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) throw new OAuthError('exchange_failed', `github user returned ${userRes.status}`);
    const user = (await userRes.json()) as { id?: number; name?: string; login?: string };
    if (!user.id) throw new OAuthError('exchange_failed', 'github profile missing id');

    // Deliberately NOT user.email from the profile: that field is whatever the
    // account chose to display and carries no verification. The dedicated
    // endpoint is the only place GitHub reports `verified`.
    const emailRes = await fetch('https://api.github.com/user/emails', { headers });
    if (!emailRes.ok) throw new OAuthError('exchange_failed', `github emails returned ${emailRes.status}`);
    const emails = (await emailRes.json()) as { email: string; primary: boolean; verified: boolean }[];

    const chosen = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (!chosen) {
      throw new OAuthError('no_verified_email', 'github account has no verified email address');
    }

    return {
      providerUserId: String(user.id),
      email: chosen.email.toLowerCase(),
      emailVerified: true,
      name: user.name ?? user.login ?? null,
    };
  },
};

const PROVIDERS: Record<ProviderName, Provider> = { google, github };

export function getProvider(name: string): Provider {
  const provider = PROVIDERS[name as ProviderName];
  if (!provider) throw new OAuthError('unknown_provider', `unknown provider ${name}`);
  if (!provider.configured()) {
    throw new OAuthError('not_configured', `${name} sign-in is not configured on this deployment`);
  }
  return provider;
}
