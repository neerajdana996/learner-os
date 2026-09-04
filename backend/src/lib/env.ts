import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default('postgres://learnos:learnos@localhost:5432/learnos'),
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  // Generation runs against NVIDIA's OpenAI-compatible endpoint (see src/llm/client.ts).
  NVIDIA_API_KEY: z.string().default(''),
  NVIDIA_BASE_URL: z.string().url().default('https://integrate.api.nvidia.com/v1'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:5173')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),
});

export type Env = z.infer<typeof EnvSchema>;

/** Parsed once at import time. Fails loudly on malformed values. */
export const env: Env = EnvSchema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
