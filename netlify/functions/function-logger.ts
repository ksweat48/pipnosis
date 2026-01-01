/**
 * Logging utility for Netlify Functions
 * Provides structured logging with context for serverless functions
 */

interface LogContext {
  functionName: string;
  requestId?: string;
  userId?: string;
  [key: string]: any;
}

export class FunctionLogger {
  private context: LogContext;

  constructor(context: LogContext) {
    this.context = context;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString();
    const contextStr = JSON.stringify(this.context);
    const dataStr = data ? ` ${JSON.stringify(data)}` : '';
    return `[${timestamp}] [${level}] [${this.context.functionName}] ${message}${dataStr} ${contextStr}`;
  }

  info(message: string, data?: any): void {
    console.log(this.formatMessage('INFO', message, data));
  }

  warn(message: string, data?: any): void {
    console.warn(this.formatMessage('WARN', message, data));
  }

  error(message: string, error?: any): void {
    const errorData = error instanceof Error
      ? { message: error.message, stack: error.stack }
      : error;
    console.error(this.formatMessage('ERROR', message, errorData));
  }

  debug(message: string, data?: any): void {
    console.debug(this.formatMessage('DEBUG', message, data));
  }

  addContext(key: string, value: any): void {
    this.context[key] = value;
  }
}

export function createLogger(functionName: string, additionalContext?: Record<string, any>): FunctionLogger {
  return new FunctionLogger({
    functionName,
    ...additionalContext
  });
}
