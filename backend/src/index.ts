import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';
import { env } from './lib/env.js';
import { configureMailTransport } from './lib/mail.js';
import { createGenerationWorker } from './workers/generator.worker.js';

configureMailTransport();

const app = createApp();
const server = createServer(app);
attachWebSocket(server);

const generationWorker = createGenerationWorker();

server.listen(env.PORT, () => {
  console.log(`learnos backend listening on http://localhost:${env.PORT} (ws at /ws)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void generationWorker.close().finally(() => server.close(() => process.exit(0)));
  });
}
