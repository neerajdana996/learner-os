import type { APIRequestContext } from '@playwright/test';

export const API = 'http://localhost:3001';

/**
 * Signs the request context in as the seeded dev learner and returns their id.
 *
 * `POST /auth/dev-login` is the same route the login page's dev button calls
 * (T-070), and it does not exist under `NODE_ENV=production` — so a suite that
 * accidentally ran against production would fail loudly on this line rather
 * than quietly doing something to a real account.
 */
export async function signIn(request: APIRequestContext): Promise<void> {
  const res = await request.post(`${API}/auth/dev-login`, {
    data: { email: 'dev@learnos.local', password: 'learnos' },
  });
  if (!res.ok()) {
    throw new Error(`dev-login failed (${res.status()}): ${await res.text()}`);
  }
}

/** A bearer token for the extension, minted the way the web app's Connect
 *  screen does (T-034). Requires `signIn` first. */
export async function mintExtensionToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/auth/extension-token`);
  if (!res.ok()) {
    throw new Error(`extension-token failed (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  return body.token;
}

/**
 * Pulls the review queue forward (T-128).
 *
 * After a session FSRS schedules the first review hours or days out, which is
 * correct and makes the extension untestable — the popup says "nothing due"
 * and there is no way to move time. This moves the cards instead of the clock,
 * and only ever the caller's own.
 */
export async function makeCardsDue(request: APIRequestContext, count = 5): Promise<number> {
  const res = await request.post(`${API}/dev/due-now`, { data: { count } });
  if (!res.ok()) {
    throw new Error(`due-now failed (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { due: number };
  return body.due;
}

/** The seeded learner's topic. `GET /topics` is the only place the client
 *  learns it, so this is the same route the app uses. */
export async function firstTopicId(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${API}/topics`);
  if (!res.ok()) throw new Error(`GET /topics failed (${res.status()})`);
  // Nested, deliberately: `GET /topics` and `GET /topics/:id` return the same
  // shape so one client-side type describes both (T-072).
  const body = (await res.json()) as { topics: Array<{ id: string; title: string }> };
  const topic = body.topics[0];
  if (!topic) throw new Error('no topics for the seeded learner — did `pnpm seed` run?');
  return topic.id;
}

export interface MapConcept {
  conceptId: string;
  title: string | null;
  state: 'known' | 'taught' | 'untaught' | 'heldout';
  mastery: number;
}

export async function fetchMap(
  request: APIRequestContext,
  topicId: string,
): Promise<{ score: number; concepts: MapConcept[] }> {
  const res = await request.get(`${API}/topics/${topicId}/map`);
  if (!res.ok()) throw new Error(`GET map failed (${res.status()}): ${await res.text()}`);
  return (await res.json()) as { score: number; concepts: MapConcept[] };
}
