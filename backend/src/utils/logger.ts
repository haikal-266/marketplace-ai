import { config } from '../config';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const MIN_LEVEL: LogLevel = config.isDev ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[MIN_LEVEL];
}

function formatLog(level: LogLevel, module: string, message: string, data?: unknown): string {
  const ts = new Date().toISOString();
  const dataStr = data ? `\n${JSON.stringify(data, null, 2)}` : '';
  return `[${ts}] [${level.toUpperCase()}] [${module}] ${message}${dataStr}`;
}

/**
 * Logger sederhana dengan level dan module name.
 * Setiap module membuat instance-nya sendiri untuk mudah tracking.
 *
 * @example
 * const log = createLogger('AuthService');
 * log.info('Login berhasil', { userId: '123' });
 */
export function createLogger(module: string) {
  return {
    debug(message: string, data?: unknown) {
      if (shouldLog('debug')) {
        console.debug(formatLog('debug', module, message, data));
      }
    },
    info(message: string, data?: unknown) {
      if (shouldLog('info')) {
        console.info(formatLog('info', module, message, data));
      }
    },
    warn(message: string, data?: unknown) {
      if (shouldLog('warn')) {
        console.warn(formatLog('warn', module, message, data));
      }
    },
    error(message: string, data?: unknown) {
      if (shouldLog('error')) {
        console.error(formatLog('error', module, message, data));
      }
    },
  };
}
