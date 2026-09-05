import { z } from 'zod';

// `pnpm dev` and `pnpm seed` read backend/.env; nothing else was loading it, so
// NVIDIA_API_KEY and the SMTP settings were silently empty outside Docker.
// Node's own loader — no dependency — and it does not overwrite variables that
// are already set, so compose's `environment:` block and the test overrides in
// vitest.setup.ts still win.
try {
  process.loadEnvFile();
} catch {
  // No .env (Docker, CI): env comes from the real environment.
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default('postgres://learnos:learnos@localhost:5432/learnos'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Generation provider. Every supported backend speaks the OpenAI chat-completions
  // shape, so switching is configuration rather than code (T-052's whole point).
  //   vertex — Google Agent Platform via ADC. No API key: the org policy forbids
  //            them, so the client mints a short-lived OAuth token instead.
  //   openai — api.openai.com, or anything OpenAI-compatible via LLM_BASE_URL.
  LLM_PROVIDER: z.enum(['openai', 'vertex']).default('openai'),
  /** OpenAI (or any OpenAI-compatible endpoint via LLM_BASE_URL). */
  OPENAI_API_KEY: z.string().default(''),
  LLM_BASE_URL: z.string().url().optional(),
  /** Vertex uses ADC, not a key — the org policy forbids API keys (T-056). */
  GOOGLE_CLOUD_PROJECT: z.string().default(''),
  GOOGLE_CLOUD_LOCATION: z.string().default('us-central1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
  // Where /auth/verify sends the browser after setting the session cookie (T-013).
  APP_URL: z.string().url().default('http://localhost:5173'),
  // Magic-link and session lifetimes, in minutes and days respectively. Kept in
  // env so a test can shorten them without reaching into module internals.
  AUTH_TOKEN_TTL_MIN: z.coerce.number().int().positive().default(15),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // SMTP. An empty SMTP_HOST selects the console transport, which is what dev
  // and every test run on — real mail is opt-in by configuration, so a suite
  // can never accidentally send to a learner.
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .string()
    .default('true')
    .transform((s) => s.toLowerCase() !== 'false'),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  MAIL_FROM: z.string().default('learnos <no-reply@example.com>'),
  // OAuth (T-055). Empty client id disables that provider rather than failing
  // at boot, so a deployment can run with one, both, or neither configured.
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  /** Public origin of this API — the base the provider redirects back to. */
  API_URL: z.string().url().default('http://localhost:3001'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parsed once at import time. Fails loudly on malformed values. */
export const env: Env = EnvSchema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
