/**
 * @ideal-harness/core — the harness substrate.
 *
 * Shared primitives (Result, logger), manifest/skill schema validation, and the
 * skill templating + multi-host generation engine that every other The Ideal Harness
 * module builds on.
 */

export { createLogger, type LogFields, type Logger, type LoggerOptions, type LogLevel } from './logger.js';
export { type Err, err, isErr, isOk, mapOk, type Ok, ok, type Result, unwrap } from './result.js';
export { createMcpServer, type McpServerOptions, type McpTool, type McpToolResult } from './runtime/mcp.js';
export * from './schema/index.js';
export * from './skills/index.js';
