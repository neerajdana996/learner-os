import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';
import { env } from './lib/env.js';
import { log } from './lib/log.js';
import { configureMailTransport } from './lib/mail.js';
import { closeReadinessRedis } from './routes/health.js';
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
  log.info('server_listening', { port: env.PORT, websocket: '/ws' });
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.info('shutting_down', { signal: sig });
    void Promise.all([generationWorker.close(), testWorker.close(), lifecycleWorker.close()])
      .then(() => Promise.all([closeTestQueue(), closeLifecycleQueue(), closeReadinessRedis()]))
      .finally(() => server.close(() => process.exit(0)));
  });
}
