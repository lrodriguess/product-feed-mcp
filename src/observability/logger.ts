/**
 * Observability: Structured Logger (T071)
 * Structured JSON logger with pipeline context fields.
 * Compatible with pino-style output; replace .write() with pino in production.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  accountName?: string;
  channelId?: string;
  skuId?: string;
  traceId?: string;
  [key: string]: unknown;
}

function write(level: LogLevel, message: string, context: LogContext = {}): void {
  const entry = {
    time: new Date().toISOString(),
    level,
    msg: message,
    ...context,
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => write('debug', msg, ctx),
  info: (msg: string, ctx?: LogContext) => write('info', msg, ctx),
  warn: (msg: string, ctx?: LogContext) => write('warn', msg, ctx),
  error: (msg: string, ctx?: LogContext) => write('error', msg, ctx),

  /** Returns a child logger with pre-bound context fields */
  child: (baseCtx: LogContext) => ({
    debug: (msg: string, ctx?: LogContext) => write('debug', msg, { ...baseCtx, ...ctx }),
    info: (msg: string, ctx?: LogContext) => write('info', msg, { ...baseCtx, ...ctx }),
    warn: (msg: string, ctx?: LogContext) => write('warn', msg, { ...baseCtx, ...ctx }),
    error: (msg: string, ctx?: LogContext) => write('error', msg, { ...baseCtx, ...ctx }),
  }),
};
