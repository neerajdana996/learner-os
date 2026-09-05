import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { oauthAccounts, users } from '../../db/schema.js';
import { createSession, type IssuedSession } from './auth.service.js';
import { OAuthError, type ProviderIdentity, type ProviderName } from './oauth.providers.js';

async function findLink(provider: ProviderName, providerUserId: string) {
  const [row] = await db
    .select()
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)));
  return row ?? null;
}

/**
 * Turns a verified provider identity into a session, creating or linking the
 * user as needed (T-055).
 *
 * Resolution order, and why:
 *   1. Known `(provider, provider_user_id)` → that user. The provider's subject
 *      id is immutable, so this keeps working even after they change their
 *      email at the provider.
 *   2. Verified email matching an existing user → link a new provider identity
 *      to that user, so Google, GitHub and a magic link all reach one account.
 *   3. Otherwise → new user.
 *
 * An **unverified** provider email never reaches steps 2 or 3. Linking on an
 * unverified address would mean anyone who can type a victim's address into
 * their provider profile inherits the victim's account; creating on one would
 * let them squat an address they do not control, and collide with the real
 * owner's magic-link sign-in later. GitHub allows exactly this, which is why
 * the identity comes from /user/emails and not the profile field.
 */
export async function signInWithProvider(
  provider: ProviderName,
  identity: ProviderIdentity,
): Promise<IssuedSession> {
  const existingLink = await findLink(provider, identity.providerUserId);
  if (existingLink) return createSession(existingLink.userId, 'web');

  if (!identity.emailVerified) {
    throw new OAuthError(
      'no_verified_email',
      `${provider} has not verified this email address, so it cannot be used to sign in`,
    );
  }

  const userId = await db.transaction(async (tx) => {
    const [existingUser] = await tx.select().from(users).where(eq(users.email, identity.email));

    let id: string;
    if (existingUser) {
      id = existingUser.id;
      // Fill in a name only if we don't have one — never overwrite what the
      // learner set themselves in onboarding.
      if (!existingUser.name && identity.name) {
        await tx.update(users).set({ name: identity.name }).where(eq(users.id, id));
      }
    } else {
      const [created] = await tx
        .insert(users)
        .values({ email: identity.email, name: identity.name })
        .returning({ id: users.id });
      if (!created) throw new Error('user insert returned no row');
      id = created.id;
    }

    await tx
      .insert(oauthAccounts)
      .values({
        userId: id,
        provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
      })
      // Two callbacks racing for the same identity must not 500 on the unique
      // index; the second is the same link and can be ignored.
      .onConflictDoNothing({ target: [oauthAccounts.provider, oauthAccounts.providerUserId] });

    return id;
  });

  return createSession(userId, 'web');
}
