// SOURCE OF TRUTH for shared Zod schemas. Synced to frontend/src/shared and
// extension/src/shared by scripts/sync-shared.sh — never edit the copies.
//
// Browser-safe: only `zod` may be imported here. No `node:*`, drizzle, postgres,
// bullmq or ioredis (sync-shared.sh fails the build if it finds any).
//
// T-001 ships only what the bootstrap needs. T-003 adds the full set.
import { z } from 'zod';

// ---------- Topics ----------
export const TopicCreateSchema = z.object({
  title: z.string().trim().min(2).max(120),
  // TODO(T-003): why, startsAt/endsAt (≥ 7 days), dailyBudgetMin (5..30)
});

// ---------- WebSocket protocol ----------
export const WsClientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping') }),
]);

export const WsServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), serverTime: z.string() }),
  z.object({ type: z.literal('pong'), serverTime: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);

// ---------- Health ----------
export const HealthResponseSchema = z.object({ ok: z.literal(true) });
