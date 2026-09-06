import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';
import { env } from './lib/env.js';
import { configureMailTransport } from './lib/mail.js';
import { createGenerationWorker } from './workers/generator.worker.js';
import { createTestWorker } from './workers/tests.worker.js';
import { closeTestQueue } from './workers/tests.queue.js';
import { closeLifecycleQueue, startLifecycle } from './workers/lifecycle.worker.js';

configureMailTransport();

const app = createApp();
const server = createServer(app);
attachWebSocket(server);

const generationWorker = createGenerationWorker();
const testWorker = createTestWorker();
const lifecycleWorker = await startLifecycle();

server.listen(env.PORT, () => {
  console.log(`learnos backend listening on http://localhost:${env.PORT} (ws at /ws)`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    void Promise.all([generationWorker.close(), testWorker.close(), lifecycleWorker.close()])
      .then(() => Promise.all([closeTestQueue(), closeLifecycleQueue()]))
      .finally(() => server.close(() => process.exit(0)));
  });
}
