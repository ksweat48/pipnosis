import { errorHandler } from './error-handler';

interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  shouldRetry?: (error: any, attempt: number) => boolean;
}

const defaultConfig: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  shouldRetry: (error: any) => {
    return errorHandler.isNetworkError(error) || error?.status >= 500;
  },
};

export async function fetchWithRetry<T>(
  url: string,
  options?: RequestInit,
  config: RetryConfig = {}
): Promise<T> {
  const mergedConfig = { ...defaultConfig, ...config };
  let lastError: any;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error: any) {
      lastError = error;

      if (attempt === mergedConfig.maxRetries) {
        errorHandler.handleNetworkError(error, url);
        throw error;
      }

      if (!mergedConfig.shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = Math.min(
        mergedConfig.baseDelay * Math.pow(2, attempt),
        mergedConfig.maxDelay
      );

      if (attempt < mergedConfig.maxRetries) {
        console.log(`Retrying request (attempt ${attempt + 1}/${mergedConfig.maxRetries}) after ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export async function retryOperation<T>(
  operation: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const mergedConfig = { ...defaultConfig, ...config };
  let lastError: any;

  for (let attempt = 0; attempt <= mergedConfig.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      if (attempt === mergedConfig.maxRetries) {
        errorHandler.logError(error, 'RetryOperation');
        throw error;
      }

      if (!mergedConfig.shouldRetry(error, attempt)) {
        throw error;
      }

      const delay = Math.min(
        mergedConfig.baseDelay * Math.pow(2, attempt),
        mergedConfig.maxDelay
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function onlineStatusListener(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}
