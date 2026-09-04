// Inferred TS types for the shared schemas. Browser-safe (types only + zod).
import type { z } from 'zod';
import type {
  ConfidenceSchema,
  SurfaceSchema,
  TeachModeSchema,
  ItemTypeSchema,
  IdParamSchema,
  UserCreateSchema,
  TopicCreateSchema,
  ItemPayloadSchema,
  PublicItemSchema,
  DueItemsResponseSchema,
  AnswerSchema,
  DiagnosticStartSchema,
  DiagnosticAnswerSchema,
  DiagnosticNextResponseSchema,
  SessionResponseSchema,
  TestStartSchema,
  TestSubmitSchema,
  PulseCreateSchema,
  WsClientMessageSchema,
  WsServerMessageSchema,
  HealthResponseSchema,
} from './schemas.js';

export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Surface = z.infer<typeof SurfaceSchema>;
export type TeachMode = z.infer<typeof TeachModeSchema>;
export type ItemType = z.infer<typeof ItemTypeSchema>;

export type IdParam = z.infer<typeof IdParamSchema>;
export type UserCreate = z.infer<typeof UserCreateSchema>;
export type TopicCreate = z.infer<typeof TopicCreateSchema>;

export type ItemPayload = z.infer<typeof ItemPayloadSchema>;
export type PublicItem = z.infer<typeof PublicItemSchema>;
export type DueItemsResponse = z.infer<typeof DueItemsResponseSchema>;

export type Answer = z.infer<typeof AnswerSchema>;

export type DiagnosticStart = z.infer<typeof DiagnosticStartSchema>;
export type DiagnosticAnswer = z.infer<typeof DiagnosticAnswerSchema>;
export type DiagnosticNextResponse = z.infer<typeof DiagnosticNextResponseSchema>;

export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export type TestStart = z.infer<typeof TestStartSchema>;
export type TestSubmit = z.infer<typeof TestSubmitSchema>;

export type PulseCreate = z.infer<typeof PulseCreateSchema>;

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
