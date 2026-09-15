import {
  ActiveWindowsSchema,
  MeExportSchema,
  UserProfileSchema,
  type MeExport,
  type MeResponse,
  type UserUpdate,
} from '@learnos/shared';
import { hasExtensionSession } from '../auth/auth.repository.js';
import { deleteUserAndEverythingTheyOwn, findUserById, loadUserExport, updateUser } from './users.repository.js';

export class UserNotFoundError extends Error {
  constructor() {
    super('user not found');
    this.name = 'UserNotFoundError';
  }
}

/** The typed confirmation did not match the account's address (T-046). */
export class EmailMismatchError extends Error {
  constructor() {
    super('confirmation email does not match the account');
    this.name = 'EmailMismatchError';
  }
}

/**
 * Builds the `/me` payload field by field. The jsonb columns are `unknown` as
 * far as the DB layer is concerned, so they are parsed through their schemas
 * here — `UserProfileSchema` also supplies `dailyCap: 12` for users onboarded
 * before the field existed, which is what stops T-028 having to handle a
 * missing cap.
 */
export async function getMe(userId: string): Promise<MeResponse> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    timezone: user.timezone,
    activeWindows: ActiveWindowsSchema.parse(user.activeWindows ?? []),
    profile: UserProfileSchema.parse(user.profile ?? {}),
    hasExtensionToken: await hasExtensionSession(userId),
  };
}

/** Partial update: an omitted key is left alone, an explicit null clears it. */
export async function patchMe(userId: string, body: UserUpdate): Promise<MeResponse> {
  const values: Parameters<typeof updateUser>[1] = {};
  if ('name' in body) values.name = body.name ?? null;
  if (body.timezone !== undefined) values.timezone = body.timezone;
  if (body.activeWindows !== undefined) values.activeWindows = body.activeWindows;

  if (Object.keys(values).length > 0) {
    await updateUser(userId, values);
  }
  return getMe(userId);
}

const iso = (value: Date) => value.toISOString();
const isoOrNull = (value: Date | null) => (value ? value.toISOString() : null);

/**
 * A copy of everything held about one learner (T-046).
 *
 * See `MeExportSchema` for what is left out and why — answer keys and the
 * held-out concepts' titles, both of which would change the Day-30 result. The
 * output is parsed through that schema before it leaves, so a field added to
 * the repository without a decision here is dropped rather than leaked.
 */
export async function exportMe(userId: string, now: Date = new Date()): Promise<MeExport> {
  const data = await loadUserExport(userId);
  if (!data) throw new UserNotFoundError();

  const exported: MeExport = {
    exportedAt: iso(now),
    account: {
      id: data.user.id,
      email: data.user.email,
      name: data.user.name,
      timezone: data.user.timezone,
      activeWindows: data.user.activeWindows,
      profile: data.user.profile,
      createdAt: iso(data.user.createdAt),
    },
    signIns: {
      providers: data.providers.map((p) => ({ provider: p.provider, email: p.email, linkedAt: iso(p.createdAt) })),
      sessions: data.sessions.map((s) => ({
        kind: s.kind,
        createdAt: iso(s.createdAt),
        expiresAt: iso(s.expiresAt),
        revokedAt: isoOrNull(s.revokedAt),
      })),
      signInLinks: data.signInLinks.map((l) => ({
        createdAt: iso(l.createdAt),
        expiresAt: iso(l.expiresAt),
        consumedAt: isoOrNull(l.consumedAt),
      })),
    },
    topics: data.topics.map((t) => ({
      id: t.id,
      title: t.title,
      why: t.why,
      language: t.language,
      status: t.status,
      startsAt: isoOrNull(t.startsAt),
      endsAt: isoOrNull(t.endsAt),
      dailyBudgetMin: t.dailyBudgetMin,
      createdAt: iso(t.createdAt),
    })),
    // The control arm stays unnamed: the map never shows these titles either.
    concepts: data.concepts.filter((c) => !c.heldOut).map((c) => ({ id: c.id, topicId: c.topicId, title: c.title })),
    cards: data.cards.map((c) => ({
      conceptId: c.conceptId,
      due: iso(c.due),
      stability: c.stability,
      difficulty: c.difficulty,
      reps: c.reps,
      lapses: c.lapses,
      state: c.state,
      lastReview: isoOrNull(c.lastReview),
      taughtAt: isoOrNull(c.taughtAt),
      createdAt: iso(c.createdAt),
    })),
    reviewEvents: data.reviewEvents.map((e) => ({
      conceptId: e.conceptId,
      itemId: e.itemId,
      surface: e.surface,
      correct: e.correct,
      confidence: e.confidence,
      latencyMs: e.latencyMs,
      snoozed: e.snoozed,
      dismissed: e.dismissed,
      assisted: e.assisted,
      predictedRecall: e.predictedRecall,
      gapDaysSinceLast: e.gapDaysSinceLast,
      createdAt: iso(e.createdAt),
    })),
    tests: data.tests.map((t) => ({ topicId: t.topicId, kind: t.kind, scores: t.scores, createdAt: iso(t.createdAt) })),
    dailyPulse: data.dailyPulse.map((p) => ({ date: iso(p.date).slice(0, 10), mood: p.mood })),
    sessionDays: data.sessionDays.map((d) => ({ topicId: d.topicId, day: d.day, completedAt: iso(d.completedAt) })),
    productEvents: data.productEvents.map((e) => ({ event: e.event, meta: e.meta, at: iso(e.at) })),
    counts: {},
  };

  exported.counts = {
    topics: exported.topics.length,
    concepts: exported.concepts.length,
    cards: exported.cards.length,
    reviewEvents: exported.reviewEvents.length,
    tests: exported.tests.length,
    dailyPulse: exported.dailyPulse.length,
    sessionDays: exported.sessionDays.length,
    productEvents: exported.productEvents.length,
  };

  return MeExportSchema.parse(exported);
}

/**
 * Deletes the account and everything attached to it (T-046).
 *
 * The confirmation is compared case-insensitively: `DeleteMeSchema` lowercases
 * what was typed, and an address that arrived through an OAuth provider may be
 * stored with capitals. A mismatch deletes nothing.
 */
export async function deleteMe(userId: string, confirmEmail: string): Promise<void> {
  const user = await findUserById(userId);
  if (!user) throw new UserNotFoundError();
  if (user.email.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) throw new EmailMismatchError();

  const deleted = await deleteUserAndEverythingTheyOwn(userId);
  if (!deleted) throw new UserNotFoundError();
}
