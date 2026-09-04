import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';
import { env } from './lib/env.js';

const app = createApp();
const server = createServer(app);
attachWebSocket(server);

// TODO(T-012): start the generation worker here (createGenerationWorker() from
// workers/generator.worker.ts). Until then POST /topics enqueues a job that
// nothing consumes, so a topic stays `generating` forever in compose.

server.listen(env.PORT, () => {
  console.log(`learnos backend listening on http://localhost:${env.PORT} (ws at /ws)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
