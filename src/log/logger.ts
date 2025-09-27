import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: pino.Level | string = process.env.MCP_OBSIDIAN_LOG_LEVEL || 'info') {
  return pino({
    level,
    transport: process.env.NODE_ENV === 'development' ? undefined : undefined,
    base: {
      pid: process.pid,
    },
  });
}
