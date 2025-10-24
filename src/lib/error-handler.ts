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

  handleWebContainerTimeout(error: any): void {
    this.logWarning(
      'WebContainer environment taking longer than expected to initialize. This is normal in cloud environments.',
      'WebContainer'
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

  isWebContainerError(error: any): boolean {
    if (!error) return false;
    const errorMessage = error.message || error.toString();
    return (
      errorMessage.includes('WebContainer') ||
      errorMessage.includes('webcontainer') ||
      errorMessage.includes('took longer than')
    );
  }

  isNetworkError(error: any): boolean {
    if (!error) return false;

    const errorMessage = error.message || error.toString();
    const networkErrorPatterns = [
      'Failed to fetch',
      'NetworkError',
      'Network request failed',
      'ERR_INTERNET_DISCONNECTED',
      'ERR_CONNECTION',
      'ERR_NETWORK_CHANGED',
      'ERR_CONNECTION_RESET',
      'ECONNREFUSED',
      'net::ERR_',
    ];

    return networkErrorPatterns.some(pattern =>
      errorMessage.includes(pattern)
    );
  }

  isWebContainerEnvironment(): boolean {
    // Disabled for production - always use live MetaAPI when credentials are available
    return false;
  }

  isMetaApiError(error: any): boolean {
    if (!error) return false;
    const errorMessage = error.message || error.toString();
    return (
      errorMessage.includes('metaapi') ||
      errorMessage.includes('agiliumtrade') ||
      errorMessage.includes('mt-provisioning-api') ||
      errorMessage.includes('mt-client-api')
    );
  }

  handleMetaApiError(error: any, context?: string): void {
    this.logWarning(
      `MetaAPI connection issue${context ? ` (${context})` : ''}. Will attempt to use cached data.`,
      'MetaAPI'
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
    const errorMessage = args.join(' ');

    if (
      errorMessage.includes('ERR_NETWORK_CHANGED') ||
      errorMessage.includes('ERR_CONNECTION_RESET') ||
      errorMessage.includes('mt-provisioning-api') ||
      errorMessage.includes('agiliumtrade') ||
      errorMessage.includes('/api/analytics')
    ) {
      if (errorHandler.isWebContainerEnvironment()) {
        return;
      }
      const count = errorHandler['errorCounts'].get('network-errors') || 0;
      if (count < 2) {
        errorHandler['errorCounts'].set('network-errors', count + 1);
      }
      return;
    }

    if (
      errorMessage.includes('WebSocket connection') ||
      errorMessage.includes('ERR_INTERNET_DISCONNECTED')
    ) {
      const count = errorHandler['errorCounts'].get('websocket') || 0;
      if (count < 3) {
        originalConsoleError.apply(console, args);
        errorHandler['errorCounts'].set('websocket', count + 1);
      }
      return;
    }

    originalConsoleError.apply(console, args);
  };

  window.addEventListener('error', (event) => {
    const errorMessage = event.message || '';
    if (
      errorMessage.includes('ERR_NETWORK_CHANGED') ||
      errorMessage.includes('ERR_CONNECTION_RESET') ||
      errorMessage.includes('Failed to fetch')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason?.message || event.reason?.toString() || '';
    if (
      reason.includes('ERR_NETWORK_CHANGED') ||
      reason.includes('ERR_CONNECTION_RESET') ||
      reason.includes('mt-provisioning-api') ||
      reason.includes('/api/analytics')
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
}
