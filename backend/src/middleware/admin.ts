import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { env } from '../lib/env.js';
import { userId } from './auth.js';

/**
 * The founder dashboard gate (T-041).
 *
 * Mounted **after** `requireUser`, so this only ever decides authorisation and
 * never authentication — the two failures are also reported differently on
 * purpose: 401 means "who are you", 403 means "not you".
 *
 * The email is read from the database rather than trusted from the request.
 * There is no header, query parameter or body field anywhere in this path that
 * a caller could use to claim an identity; the session decides who you are and
 * this decides what that person may see.
 *
 * With `ADMIN_EMAILS` unset, `env` parses it to an empty list and **everyone is
 * refused**. That is the intended failure mode: this endpoint exposes every
 * participant's results together, so a deployment that forgets to configure it
 * should be locked, not open.
 */
export const requireAdmin: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId(req)));

  if (!user || !env.ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    // Deliberately says nothing about whether the list is empty, or who is on
    // it. A different message for "no admins configured" would tell an attacker
    // which deployments are worth coming back to.
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  next();
};
