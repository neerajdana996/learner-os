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
  ItemGenerationSchema,
  PublicItemSchema,
  DueItemsResponseSchema,
  DueQuerySchema,
  AnswerSchema,
  DiagnosticStartSchema,
  DiagnosticAnswerSchema,
  DiagnosticNextResponseSchema,
  SessionResponseSchema,
  SessionCompleteSchema,
  CorrectionSchema,
  ConceptStateSchema,
  MapConceptSchema,
  MapResponseSchema,
  TestStartSchema,
  TestSubmitSchema,
  PulseCreateSchema,
  ActiveWindowSchema,
  ActiveWindowsSchema,
  UserUpdateSchema,
  UserProfileSchema,
  MeResponseSchema,
  MagicLinkSchema,
  VerifyQuerySchema,
  MagicLinkResponseSchema,
  DevLoginSchema,
  DevResetSchema,
  ExtensionTokenResponseSchema,
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
/** What the model may return, before the worker derives an ItemPayload (T-080). */
export type ItemGeneration = z.infer<typeof ItemGenerationSchema>;
export type DueItemsResponse = z.infer<typeof DueItemsResponseSchema>;
export type DueQuery = z.infer<typeof DueQuerySchema>;

export type Answer = z.infer<typeof AnswerSchema>;

export type DiagnosticStart = z.infer<typeof DiagnosticStartSchema>;
export type DiagnosticAnswer = z.infer<typeof DiagnosticAnswerSchema>;
export type DiagnosticNextResponse = z.infer<typeof DiagnosticNextResponseSchema>;

export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type SessionComplete = z.infer<typeof SessionCompleteSchema>;
export type Correction = z.infer<typeof CorrectionSchema>;

export type ConceptState = z.infer<typeof ConceptStateSchema>;
export type MapConcept = z.infer<typeof MapConceptSchema>;
export type MapResponse = z.infer<typeof MapResponseSchema>;

export type TestStart = z.infer<typeof TestStartSchema>;
export type TestSubmit = z.infer<typeof TestSubmitSchema>;

export type PulseCreate = z.infer<typeof PulseCreateSchema>;

export type ActiveWindow = z.infer<typeof ActiveWindowSchema>;
export type ActiveWindows = z.infer<typeof ActiveWindowsSchema>;
export type UserUpdate = z.infer<typeof UserUpdateSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type MeResponse = z.infer<typeof MeResponseSchema>;

export type MagicLink = z.infer<typeof MagicLinkSchema>;
export type VerifyQuery = z.infer<typeof VerifyQuerySchema>;
export type MagicLinkResponse = z.infer<typeof MagicLinkResponseSchema>;
export type DevLogin = z.infer<typeof DevLoginSchema>;
export type DevReset = z.infer<typeof DevResetSchema>;
export type ExtensionTokenResponse = z.infer<typeof ExtensionTokenResponseSchema>;

export type WsClientMessage = z.infer<typeof WsClientMessageSchema>;
export type WsServerMessage = z.infer<typeof WsServerMessageSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
