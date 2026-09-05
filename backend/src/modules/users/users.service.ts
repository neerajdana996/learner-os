import {
  ActiveWindowsSchema,
  UserProfileSchema,
  type MeResponse,
  type UserUpdate,
} from '../../shared/index.js';
import { hasExtensionSession } from '../auth/auth.repository.js';
import { findUserById, updateUser } from './users.repository.js';

export class UserNotFoundError extends Error {
  constructor() {
    super('user not found');
    this.name = 'UserNotFoundError';
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
