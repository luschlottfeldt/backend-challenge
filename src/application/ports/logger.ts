export type LogContext = Record<string, string | number | boolean | undefined>;

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

export const LOGGER = Symbol('Logger');
