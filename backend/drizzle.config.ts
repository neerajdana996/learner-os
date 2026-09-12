import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://learnos:learnos@localhost:5432/learnos',
  },
  // Supabase's own internal schemas (auth, storage, realtime, ...) carry
  // constraints drizzle-kit's introspection chokes on ("Cannot read
  // properties of undefined (reading 'replace')") — scoping to `public`
  // avoids scanning them at all. Harmless against plain local Postgres,
  // which only has `public` to begin with.
  schemaFilter: ['public'],
});
