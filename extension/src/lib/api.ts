/**
 * The extension's only way to reach the backend (T-027).
 *
 * Auth is `Authorization: Bearer`, never a cookie: an MV3 service worker is a
 * cross-origin caller with no reliable cookie jar, which is why T-013 gave the
 * `sessions` table two credential shapes for one row. `credentials: 'omit'` is
 * explicit so a browser that *would* attach a cookie doesn't quietly make this
 * work in dev and fail once the extension is installed for real.
 *
 * Responses are parsed with the synced Zod schemas rather than cast, so a
 * server change shows up here as a clear parse failure instead of `undefined`
 * reaching the card UI.
 */
import { z, type output, type ZodTypeAny } from 'zod';
import { MeResponseSchema, type Answer, type MeResponse } from '@learnos/shared';
import { clearToken, getToken } from './storage';

/** Set at build time from `WXT_API_URL` (see `.env.example`). The manifest's
 *  host permission is generated from the same value, so they cannot drift. */
export const API_URL: string =
  (import.meta.env.WXT_API_URL as string | undefined) ?? 'http://localhost:3001';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`${status}: ${body.slice(0, 200)}`);
    this.name = 'ApiError';
  }
}

/** No token stored yet — the learner has not been through "Connect extension".
 *  Distinct from a 401 so the UI can say "connect" instead of "reconnect". */
export class NotConnectedError extends Error {
  constructor() {
    super('no extension token stored');
    this.name = 'NotConnectedError';
  }
}

export interface ApiOptions extends RequestInit {
  /** Use this token instead of the stored one — how the options page checks a
   *  pasted token before saving it. */
  token?: string;
}

export async function apiFetch(path: string, options: ApiOptions = {}): Promise<Response> {
  const { token, headers, ...init } = options;
  const bearer = token?.trim() || (await getToken());
  if (!bearer) throw new NotConnectedError();

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    // Never the cookie jar: this is a cross-origin caller (see the module note).
    credentials: 'omit',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
      Authorization: `Bearer ${bearer}`,
    },
  });

  if (response.status === 401) {
    // A bearer token that 401s is dead — revoked or expired — and retrying it
    // on every alarm for the next month would just be noise. Only the stored
    // one is cleared: a bad *pasted* token must not disconnect a working
    // installation while someone is fiddling on the options page.
    if (!token) await clearToken();
    throw new ApiError(401, await response.text());
  }
  if (!response.ok) throw new ApiError(response.status, await response.text());

  return response;
}

// Generic over the schema rather than its result: a schema with defaults has a
// looser input type than output type, and binding to the output directly makes
// every such schema fail to match.
export async function apiJson<S extends ZodTypeAny>(
  schema: S,
  path: string,
  options: ApiOptions = {},
): Promise<output<S>> {
  const response = await apiFetch(path, options);
  return schema.parse(await response.json());
}

/**
 * The account behind a token. Two jobs: the options page uses it to check a
 * pasted token before storing it, and T-028's scheduler reads `timezone`,
 * `activeWindows` and `profile.dailyCap` from the same call.
 */
export function getMe(token?: string): Promise<MeResponse> {
  return apiJson(MeResponseSchema, '/me', token ? { token } : {});
}

/**
 * What the server says back about one answer (T-029).
 *
 * `gapDaysSinceLast` is the line the card is built around — "9 days since you
 * last saw this" is the product in one sentence, and it is the difference
 * between a flashcard and a retention measurement. `feedback` is the grader's
 * one line, null when nothing was answered.
 */
export const ReviewResultSchema = z.object({
  correct: z.boolean().nullable(),
  gapDaysSinceLast: z.number().nullable(),
  feedback: z.string().nullable(),
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

/**
 * Records one outcome. Snooze and dismiss go through here too, with
 * `correct: null` — a card waved away is data about when someone will not
 * answer, which is exactly what the daily cap and the backoff are tuned from.
 */
export function postReview(answer: Answer): Promise<ReviewResult> {
  return apiJson(ReviewResultSchema, '/reviews', {
    method: 'POST',
    body: JSON.stringify(answer),
  });
}

/**
 * Reports a bad question (T-029). Three reports retire it, using the same
 * `flagged_bad` count `pnpm qa:retire` writes — so a question the founder
 * rejected and one three learners reported leave circulation by exactly the
 * same rule.
 */
export function flagItem(itemId: string): Promise<{ retired: boolean }> {
  return apiJson(z.object({ retired: z.boolean() }), `/items/${itemId}/flag`, { method: 'POST' });
}
