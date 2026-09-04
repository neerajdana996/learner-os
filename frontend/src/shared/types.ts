// Inferred TS types for the shared schemas. Browser-safe (types only + zod).
import type { z } from 'zod';
import type {
  TopicCreateSchema,
  WsClientMessageSchema,
  WsServerMessageSchema,
  HealthResponseSchema,
} from './schemas.js';

export type TopicCreate = z.infer<typeof TopicCreateSchema>;
export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
