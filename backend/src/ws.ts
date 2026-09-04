import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { WsClientMessageSchema, type WsServerMessage } from './shared/index.js';

/**
 * WebSocket endpoint at `/ws`, sharing the HTTP server's port.
 *
 * Sprint 1 only handles `ping` → `pong` so the wiring is proven; later tasks
 * add push events (e.g. "generation finished", "card due") by extending the
 * `WsClientMessage` / `WsServerMessage` unions in `src/shared`.
 */
export function attachWebSocket(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    send(socket, { type: 'hello', serverTime: new Date().toISOString() });

    socket.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        send(socket, { type: 'error', message: 'invalid_json' });
        return;
      }
      const result = WsClientMessageSchema.safeParse(parsed);
      if (!result.success) {
        send(socket, { type: 'error', message: 'invalid_message' });
        return;
      }
      switch (result.data.type) {
        case 'ping':
          send(socket, { type: 'pong', serverTime: new Date().toISOString() });
          break;
      }
    });
  });

  return wss;
}

function send(socket: WebSocket, msg: WsServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
}
