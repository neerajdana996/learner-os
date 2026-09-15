import { eq, inArray, or, type AnyColumn } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  authTokens,
  cards,
  clientEvents,
  conceptPrereqs,
  concepts,
  dailyPulse,
  items,
  oauthAccounts,
  reviewEvents,
  sessionDays,
  sessions,
  tests,
  topics,
  users,
} from '../../db/schema.js';

export async function findUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id));
  return user ?? null;
}

export async function updateUser(
  id: string,
  values: Partial<{ name: string | null; timezone: string; activeWindows: unknown }>,
) {
  const [user] = await db.update(users).set(values).where(eq(users.id, id)).returning();
  if (!user) throw new Error('user update returned no row');
  return user;
}

/**
 * Removes a learner and every row that belongs to them (T-046).
 *
 * **No foreign key in `schema.ts` cascades**, and adding cascades is a schema
 * change, so children go first — the order the seed scripts already use to
 * wipe a user (`seedSessionUsers.ts`). A learner's topics, and so their
 * concepts and items, belong to them alone, so those go too.
 *
 * **One transaction.** A failure part-way through leaves the account whole
 * rather than half-erased: a half-deleted learner can still sign in to a
 * product that no longer has their topic.
 *
 * `users.test.ts` asserts that every foreign key referencing `users` is
 * handled here, so a table added later without a line below fails loudly
 * instead of blocking deletion in production with a constraint error.
 */
export async function deleteUserAndEverythingTheyOwn(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const topicIds = (await tx.select({ id: topics.id }).from(topics).where(eq(topics.userId, userId))).map(
      (row) => row.id,
    );
    const conceptIds =
      topicIds.length === 0
        ? []
        : (
            await tx.select({ id: concepts.id }).from(concepts).where(inArray(concepts.topicId, topicIds))
          ).map((row) => row.id);

    // Rows keyed to the learner, or to content that is about to go.
    const byUserOr = (userCol: AnyColumn, ownerCol: AnyColumn, ids: string[]) =>
      ids.length === 0 ? eq(userCol, userId) : or(eq(userCol, userId), inArray(ownerCol, ids));

    await tx.delete(reviewEvents).where(byUserOr(reviewEvents.userId, reviewEvents.conceptId, conceptIds));
    await tx.delete(tests).where(byUserOr(tests.userId, tests.topicId, topicIds));
    await tx.delete(sessionDays).where(byUserOr(sessionDays.userId, sessionDays.topicId, topicIds));
    await tx.delete(cards).where(byUserOr(cards.userId, cards.conceptId, conceptIds));

    await tx.delete(dailyPulse).where(eq(dailyPulse.userId, userId));
    await tx.delete(clientEvents).where(eq(clientEvents.userId, userId));
    await tx.delete(authTokens).where(eq(authTokens.userId, userId));
    await tx.delete(oauthAccounts).where(eq(oauthAccounts.userId, userId));
    // Every web session and every extension token: the extension's next
    // request is a 401, which clears its stored token (T-027).
    await tx.delete(sessions).where(eq(sessions.userId, userId));

    if (conceptIds.length > 0) {
      await tx.delete(items).where(inArray(items.conceptId, conceptIds));
      await tx
        .delete(conceptPrereqs)
        .where(
          or(
            inArray(conceptPrereqs.conceptId, conceptIds),
            inArray(conceptPrereqs.prerequisiteConceptId, conceptIds),
          ),
        );
      await tx.delete(concepts).where(inArray(concepts.id, conceptIds));
    }
    await tx.delete(topics).where(eq(topics.userId, userId));

    const deleted = await tx.delete(users).where(eq(users.id, userId)).returning({ id: users.id });
    return deleted.length > 0;
  });
}

/**
 * Everything the export is built from (T-046), read with explicit column lists.
 *
 * Explicit rather than `select()`: the two credential tables hold token hashes,
 * and a `select *` that later gains a column is how a secret ends up in a file
 * the learner downloads and forwards. Concepts come with `heldOut` so the
 * service can drop the control arm's titles; item payloads are never read at
 * all, because they carry answer keys.
 */
export async function loadUserExport(userId: string) {
  const user = await findUserById(userId);
  if (!user) return null;

  const topicRows = await db.select().from(topics).where(eq(topics.userId, userId));
  const topicIds = topicRows.map((row) => row.id);
  const conceptRows =
    topicIds.length === 0
      ? []
      : await db
          .select({ id: concepts.id, topicId: concepts.topicId, title: concepts.title, heldOut: concepts.heldOut })
          .from(concepts)
          .where(inArray(concepts.topicId, topicIds));

  const [cardRows, eventRows, testRows, pulseRows, dayRows, productRows, providerRows, sessionRows, linkRows] =
    await Promise.all([
      db.select().from(cards).where(eq(cards.userId, userId)),
      db.select().from(reviewEvents).where(eq(reviewEvents.userId, userId)),
      db
        .select({ topicId: tests.topicId, kind: tests.kind, scores: tests.scores, createdAt: tests.createdAt })
        .from(tests)
        .where(eq(tests.userId, userId)),
      db.select({ date: dailyPulse.date, mood: dailyPulse.mood }).from(dailyPulse).where(eq(dailyPulse.userId, userId)),
      db
        .select({ topicId: sessionDays.topicId, day: sessionDays.day, completedAt: sessionDays.completedAt })
        .from(sessionDays)
        .where(eq(sessionDays.userId, userId)),
      db
        .select({ event: clientEvents.event, meta: clientEvents.meta, at: clientEvents.at })
        .from(clientEvents)
        .where(eq(clientEvents.userId, userId)),
      db
        .select({ provider: oauthAccounts.provider, email: oauthAccounts.email, createdAt: oauthAccounts.createdAt })
        .from(oauthAccounts)
        .where(eq(oauthAccounts.userId, userId)),
      db
        .select({
          kind: sessions.kind,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
          revokedAt: sessions.revokedAt,
        })
        .from(sessions)
        .where(eq(sessions.userId, userId)),
      db
        .select({ createdAt: authTokens.createdAt, expiresAt: authTokens.expiresAt, consumedAt: authTokens.consumedAt })
        .from(authTokens)
        .where(eq(authTokens.userId, userId)),
    ]);

  return {
    user,
    topics: topicRows,
    concepts: conceptRows,
    cards: cardRows,
    reviewEvents: eventRows,
    tests: testRows,
    dailyPulse: pulseRows,
    sessionDays: dayRows,
    productEvents: productRows,
    providers: providerRows,
    sessions: sessionRows,
    signInLinks: linkRows,
  };
}
