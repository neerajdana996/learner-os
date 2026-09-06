// Post-build: tsc emits only .js, so copy non-TS runtime assets (prompt .md
// files) into dist/ so `node dist/index.js` can load them in production.
import { cpSync, existsSync } from 'node:fs';

if (existsSync('src/llm/prompts')) {
  cpSync('src/llm/prompts', 'dist/llm/prompts', { recursive: true });
  console.log('copied src/llm/prompts → dist/llm/prompts');
}
