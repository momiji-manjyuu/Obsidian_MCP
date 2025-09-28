import { performance } from 'node:perf_hooks';
import pino from 'pino';

export interface TimerScope {
  end(message?: string, extra?: Record<string, unknown>): void;
  fail(error: unknown, message?: string, extra?: Record<string, unknown>): void;
}

export interface AppLogger extends pino.Logger {
  withModule(module: string, bindings?: Record<string, unknown>): AppLogger;
  withRequest(requestId: string): AppLogger;
  startTimer(message: string, bindings?: Record<string, unknown>): TimerScope;
}

export type Logger = AppLogger;

function roundMilliseconds(duration: number): number {
  return Math.round(duration * 1000) / 1000;
}

function wrapLogger(logger: pino.Logger): AppLogger {
  const enhanced = logger as AppLogger;
  const childFactory = logger.child.bind(logger);

  enhanced.withModule = (module: string, bindings: Record<string, unknown> = {}) => {
    const currentBindings = logger.bindings() as Record<string, unknown>;
    const parentModule = typeof currentBindings.module === 'string' ? (currentBindings.module as string) : undefined;
    const modulePath = parentModule ? `${parentModule}:${module}` : module;
    return wrapLogger(childFactory({ module: modulePath, ...bindings }));
  };

  enhanced.withRequest = (requestId: string) => {
    return wrapLogger(childFactory({ requestId }));
  };

  enhanced.startTimer = (message: string, bindings: Record<string, unknown> = {}) => {
    const start = performance.now();
    return {
      end(endMessage = message, extra: Record<string, unknown> = {}) {
        const elapsed = roundMilliseconds(performance.now() - start);
        logger.info({ ...bindings, ...extra, elapsedMs: elapsed }, endMessage);
      },
      fail(error: unknown, endMessage = message, extra: Record<string, unknown> = {}) {
        const elapsed = roundMilliseconds(performance.now() - start);
        logger.error({ ...bindings, ...extra, err: error, elapsedMs: elapsed }, endMessage);
      },
    } satisfies TimerScope;
  };

  return enhanced;
}

export function createLogger(level: pino.Level | string = process.env.MCP_OBSIDIAN_LOG_LEVEL || 'info'): AppLogger {
  const logger = pino({
    level,
    base: {
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    messageKey: 'message',
    formatters: {
      level(label) {
        return { level: label };
      },
      bindings(bindings) {
        const output: Record<string, unknown> = {
          pid: bindings.pid,
          hostname: bindings.hostname,
        };
        const moduleBinding = (bindings as Record<string, unknown>).module;
        if (typeof moduleBinding === 'string') {
          output.module = moduleBinding;
        }
        const requestId = (bindings as Record<string, unknown>).requestId;
        if (typeof requestId === 'string') {
          output.requestId = requestId;
        }
        return output;
      },
    },
  });

  return wrapLogger(logger);
}
