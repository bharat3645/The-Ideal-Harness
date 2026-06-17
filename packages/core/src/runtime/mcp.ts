/**
 * Minimal MCP server over the stdio transport (newline-delimited JSON-RPC 2.0).
 *
 * Dependency-free and reusable: each The Ideal Harness engine package builds its MCP
 * face by handing this a tool list. We implement only what an agent host needs
 * — `initialize`, `tools/list`, `tools/call`, and the `initialized`
 * notification — and frame messages as one JSON object per line per the stdio
 * transport spec.
 */

import { createInterface } from 'node:readline';

const DEFAULT_PROTOCOL = '2025-06-18';

export interface McpToolResult {
  readonly text: string;
  readonly isError?: boolean;
}

export interface McpTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the tool's arguments. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly handler: (args: Record<string, unknown>) => Promise<McpToolResult> | McpToolResult;
}

export interface McpServerOptions {
  readonly name: string;
  readonly version: string;
  readonly tools: readonly McpTool[];
  /** Streams, injectable for tests. Default stdin/stdout. */
  readonly input?: NodeJS.ReadableStream;
  readonly output?: NodeJS.WritableStream;
}

interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export function createMcpServer(options: McpServerOptions): { listen: () => Promise<void> } {
  const output = options.output ?? process.stdout;
  const input = options.input ?? process.stdin;
  const toolsByName = new Map(options.tools.map((tool) => [tool.name, tool]));

  function send(message: Record<string, unknown>): void {
    output.write(`${JSON.stringify(message)}\n`);
  }

  function reply(id: JsonRpcRequest['id'], result: unknown): void {
    send({ jsonrpc: '2.0', id, result });
  }

  function replyError(id: JsonRpcRequest['id'], code: number, message: string): void {
    send({ jsonrpc: '2.0', id, error: { code, message } });
  }

  async function dispatch(req: JsonRpcRequest): Promise<void> {
    switch (req.method) {
      case 'initialize':
        reply(req.id, {
          protocolVersion: (req.params?.protocolVersion as string) ?? DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: options.name, version: options.version },
        });
        return;
      case 'notifications/initialized':
      case 'initialized':
        return; // notification: no response
      case 'ping':
        reply(req.id, {});
        return;
      case 'tools/list':
        reply(req.id, {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
        return;
      case 'tools/call': {
        const name = req.params?.name as string;
        const tool = toolsByName.get(name);
        if (tool === undefined) {
          replyError(req.id, -32602, `unknown tool: ${name}`);
          return;
        }
        try {
          const args = (req.params?.arguments as Record<string, unknown>) ?? {};
          const result = await tool.handler(args);
          reply(req.id, { content: [{ type: 'text', text: result.text }], isError: result.isError ?? false });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          reply(req.id, { content: [{ type: 'text', text: `error: ${message}` }], isError: true });
        }
        return;
      }
      default:
        if (req.id !== undefined && req.id !== null) {
          replyError(req.id, -32601, `method not found: ${req.method}`);
        }
    }
  }

  async function listen(): Promise<void> {
    const rl = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        continue; // ignore malformed frames
      }
      await dispatch(req);
    }
  }

  return { listen };
}
