const isDevelopment = import.meta.env.DEV;

class ErrorHandler {
  private errorCounts: Map<string, number> = new Map();
  private readonly maxErrorsPerType = 3;

  logError(error: any, context?: string): void {
    const errorKey = this.getErrorKey(error, context);
    const count = this.errorCounts.get(errorKey) || 0;

    if (count < this.maxErrorsPerType) {
      console.error(context ? `[${context}]` : '', error);
      this.errorCounts.set(errorKey, count + 1);
    } else if (count === this.maxErrorsPerType) {
      console.warn(`[${context || 'Error'}] Suppressing repeated errors of this type...`);
      this.errorCounts.set(errorKey, count + 1);
    }
  }

  logWarning(message: string, context?: string): void {
    const errorKey = `warning:${context}:${message}`;
    const count = this.errorCounts.get(errorKey) || 0;

    if (count < this.maxErrorsPerType) {
      console.warn(context ? `[${context}]` : '', message);
      this.errorCounts.set(errorKey, count + 1);
    }
  }

  handleNetworkError(error: any, url?: string): void {
    if (this.isNetworkError(error)) {
      this.logWarning(
        `Network request failed${url ? ` for ${url}` : ''}. Continuing gracefully...`,
        'Network'
      );
      return;
    }
    this.logError(error, 'Network');
  }

  handleRealtimeError(error: any, channelName?: string): void {
    this.logWarning(
      `Realtime connection issue${channelName ? ` for ${channelName}` : ''}. Data will be polled instead.`,
      'Realtime'
    );
  }


  handleResourcePreloadWarning(resource: string): void {
    const errorKey = `preload:${resource}`;
    const count = this.errorCounts.get(errorKey) || 0;

    if (count === 0) {
      this.logWarning(
        `Resource preload issue detected for ${resource}. This won't affect functionality.`,
        'ResourcePreload'
      );
      this.errorCounts.set(errorKey, count + 1);
    }
  }


  isSSLCertificateError(error: any): boolean {
    if (!error) return false;
    const errorMessage = error.message || error.toString();
    return (
      errorMessage.includes('ERR_CERT') ||
      errorMessage.includes('certificate') ||
      errorMessage.includes('SSL') ||
      errorMessage.includes('Expired') ||
      errorMessage.includes('ERR_CERT_AUTHORITY_INVALID') ||
      errorMessage.includes('ERR_CERT_DATE_INVALID')
    );
  }

  isNetworkError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message || error.toString();

    if (this.isSSLCertificateError(error)) {
      return false;
    }

    const networkErrorPatterns = [
      'Failed to fetch',
      'NetworkError',
      'Network request failed',
      'ERR_INTERNET_DISCONNECTED',
      'ERR_CONNECTION',
      'ERR_NETWORK_CHANGED',
      'ERR_CONNECTION_RESET',
      'ECONNREFUSED',
    ];

    return networkErrorPatterns.some(pattern =>
      errorMessage.includes(pattern)
    );
  }




  private getErrorKey(error: any, context?: string): string {
    const message = error?.message || error?.toString() || 'unknown';
    return `${context || 'error'}:${message}`;
  }

  clearErrorCounts(): void {
    this.errorCounts.clear();
  }
}

export const errorHandler = new ErrorHandler();

if (typeof window !== 'undefined') {
  const originalConsoleError = console.error;
  console.error = (...args: any[]) => {
    const errorStr = args.join(' ');

    if (errorStr.includes('/api/deploy/') && errorStr.includes('404')) {
      return;
    }

    if (errorStr.includes('blitz.') && errorStr.includes('running source code in new context')) {
      return;
    }

    if (errorStr.includes('preloaded using link preload') && errorStr.includes('not used within')) {
      errorHandler.handleResourcePreloadWarning(errorStr);
      return;
    }

    originalConsoleError.apply(console, args);
  };

  const originalConsoleWarn = console.warn;
  console.warn = (...args: any[]) => {
    const warnStr = args.join(' ');

    if (warnStr.includes('running source code in new context')) {
      return;
    }

    if (warnStr.includes('[Contexify]')) {
      return;
    }

    originalConsoleWarn.apply(console, args);
  };
}
