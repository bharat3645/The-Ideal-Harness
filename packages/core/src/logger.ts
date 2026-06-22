/**
 * Structured logger — newline-delimited JSON to stderr.
 *
 * stdout is reserved for machine output (MCP stdio transport, CLI JSON results),
 * so all human/diagnostic logging goes to stderr. Fields are merged into each
 * record for grep-able, parseable logs.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly name?: string;
  /** Sink for the rendered line. Defaults to stderr. Injectable for tests. */
  readonly sink?: (line: string) => void;
  readonly base?: LogFields;
}

function defaultSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info';
  const sink = options.sink ?? defaultSink;
  const base = options.base ?? {};
  const threshold = LEVEL_ORDER[level];

  function emit(recordLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_ORDER[recordLevel] < threshold) {
      return;
    }
    // Spread caller-supplied fields FIRST so they can never clobber the record's
    // own level/msg — those are authoritative and set last.
    const record: Record<string, unknown> = {
      ...base,
      ...fields,
      level: recordLevel,
      msg: message,
    };
    if (options.name !== undefined) {
      record.logger = options.name;
    }
    sink(JSON.stringify(record));
  }

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}
