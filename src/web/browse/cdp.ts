/**
 * Minimal Chrome DevTools Protocol client over a raw WebSocket.
 *
 * `ws` is an optional devDependency, the exact same "optional engine tier"
 * pattern `src/memory/structural/treesitter.ts` already established for
 * `web-tree-sitter` — not a hard runtime dependency of the published
 * package, degrades to a clear error (never a crash) when absent. It's used
 * instead of Node's native `WebSocket` global specifically because that only
 * became stable in Node 22; this package's `engines` field is `>=20`, and a
 * silent incompatibility for Node 20/21 users would be worse than one
 * well-established, zero-dependencies-of-its-own optional package.
 *
 * This implements only the request/response half of CDP (`{id, method,
 * params}` -> `{id, result}`) that `actions.ts` needs — no generic event
 * subscription system. Where an action needs to know "did it finish" (e.g.
 * navigation), it polls state via `Runtime.evaluate` rather than this client
 * offering a full event bus; see `actions.ts` for why that trade was made.
 */

export interface CdpSession {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Returns null (never throws) when `ws` isn't installed — callers degrade to a clear error message. */
export async function loadWebSocketCtor(): Promise<(new (url: string) => import('ws').WebSocket) | null> {
  try {
    const mod = await import('ws');
    return (mod.default ?? mod) as unknown as new (
      url: string,
    ) => import('ws').WebSocket;
  } catch {
    return null;
  }
}

export async function connectCdp(wsUrl: string, timeoutMs = 10000): Promise<CdpSession> {
  const WebSocketCtor = await loadWebSocketCtor();
  if (!WebSocketCtor) {
    throw new Error("browse requires the optional 'ws' package — run: pnpm add -D ws @types/ws");
  }

  const socket = new WebSocketCtor(wsUrl);
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP connect timed out after ${timeoutMs}ms`)), timeoutMs);
    socket.once('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  socket.on('message', (data: Buffer | string) => {
    let msg: CdpMessage;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.id === undefined) {
      return; // an event we don't subscribe to — ignored by design, see module doc
    }
    const waiter = pending.get(msg.id);
    if (!waiter) {
      return;
    }
    pending.delete(msg.id);
    if (msg.error) {
      waiter.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
    } else {
      waiter.resolve(msg.result);
    }
  });

  socket.on('close', () => {
    for (const [, waiter] of pending) {
      waiter.reject(new Error('CDP connection closed while a call was pending'));
    }
    pending.clear();
  });

  return {
    send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        socket.send(JSON.stringify({ id, method, params }), (err?: Error) => {
          if (err) {
            pending.delete(id);
            reject(err);
          }
        });
      });
    },
    close(): void {
      socket.close();
    },
  };
}
