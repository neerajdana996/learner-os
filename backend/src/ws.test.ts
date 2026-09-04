import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createApp } from './app.js';
import { attachWebSocket } from './ws.js';

let server: Server;
let url: string;

beforeAll(async () => {
  server = createServer(createApp());
  attachWebSocket(server);
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  url = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => ws.once('message', (d) => resolve(JSON.parse(d.toString()))));
}

describe('ws', () => {
  it('greets on connect and answers ping with pong', async () => {
    const ws = new WebSocket(url);
    const hello = await nextMessage(ws);
    expect(hello.type).toBe('hello');

    const pong = nextMessage(ws);
    ws.send(JSON.stringify({ type: 'ping' }));
    expect((await pong).type).toBe('pong');

    const err = nextMessage(ws);
    ws.send('not json');
    expect((await err).message).toBe('invalid_json');
    ws.close();
  });
});
