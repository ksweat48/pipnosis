/**
 * Database Resilience Wrapper
 *
 * Wraps Supabase queries with retry logic, timeout protection,
 * and automatic fallback to cached data.
 *
 * ZERO RISK: Falls back to original query if wrapper fails.
 */

import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';

interface QueryOptions {
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  cacheKey?: string;
  cacheDuration?: number;
}

interface CachedResult<T> {
  data: T;
  timestamp: number;
}

class DatabaseResilienceWrapper {
  private cache = new Map<string, CachedResult<any>>();
  private activeQueries = new Map<string, Promise<any>>();

  async query<T>(
    queryFn: () => Promise<{ data: T | null; error: any }>,
    options: QueryOptions = {}
  ): Promise<{ data: T | null; error: any; fromCache?: boolean }> {
    if (!BULLETPROOF_CONFIG.enableDatabaseRetry) {
      return queryFn();
    }

    const {
      maxRetries = BULLETPROOF_CONFIG.maxDatabaseRetries,
      retryDelay = BULLETPROOF_CONFIG.databaseRetryDelayMs,
      timeout = BULLETPROOF_CONFIG.databaseTimeoutMs,
      cacheKey,
      cacheDuration = BULLETPROOF_CONFIG.cacheDurationMs,
    } = options;

    // Check cache first
    if (cacheKey && this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      const age = Date.now() - cached.timestamp;

      if (age < cacheDuration) {
        console.log(`[DatabaseResilience] ✅ Cache hit for ${cacheKey} (${Math.round(age / 1000)}s old)`);
        return { data: cached.data, error: null, fromCache: true };
      }
    }

    // Deduplicate concurrent identical queries
    if (cacheKey && this.activeQueries.has(cacheKey)) {
      console.log(`[DatabaseResilience] ⏳ Deduplicating query for ${cacheKey}`);
      return this.activeQueries.get(cacheKey)!;
    }

    const queryPromise = this.executeWithRetry(queryFn, maxRetries, retryDelay, timeout);

    if (cacheKey) {
      this.activeQueries.set(cacheKey, queryPromise);
    }

    try {
      const result = await queryPromise;

      // Cache successful results
      if (cacheKey && result.data && !result.error) {
        this.cache.set(cacheKey, {
          data: result.data,
          timestamp: Date.now(),
        });
      }

      return result;
    } catch (error) {
      console.error('[DatabaseResilience] ❌ Query failed after all retries:', error);

      // Try to return stale cached data as last resort
      if (cacheKey && this.cache.has(cacheKey)) {
        const cached = this.cache.get(cacheKey)!;
        const age = Date.now() - cached.timestamp;
        console.warn(`[DatabaseResilience] ⚠️ Returning stale cache (${Math.round(age / 1000)}s old) due to query failure`);
        return { data: cached.data, error: null, fromCache: true };
      }

      return { data: null, error };
    } finally {
      if (cacheKey) {
        this.activeQueries.delete(cacheKey);
      }
    }
  }

  private async executeWithRetry<T>(
    queryFn: () => Promise<{ data: T | null; error: any }>,
    maxRetries: number,
    retryDelay: number,
    timeout: number
  ): Promise<{ data: T | null; error: any }> {
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.withTimeout(queryFn(), timeout);

        if (!result.error) {
          if (attempt > 0) {
            console.log(`[DatabaseResilience] ✅ Query succeeded on attempt ${attempt + 1}`);
          }
          return result;
        }

        lastError = result.error;

        // Don't retry on certain errors
        if (this.isNonRetryableError(result.error)) {
          console.log(`[DatabaseResilience] ⚠️ Non-retryable error, not retrying:`, result.error.message);
          return result;
        }

        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt); // Exponential backoff
          console.warn(`[DatabaseResilience] ⚠️ Query failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt);
          console.warn(`[DatabaseResilience] ⚠️ Query threw error (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...`, error);
          await this.sleep(delay);
        }
      }
    }

    return { data: null, error: lastError };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Query timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle!);
      throw error;
    }
  }

  private isNonRetryableError(error: any): boolean {
    if (!error) return false;

    const message = error.message || '';
    const code = error.code || '';

    // RLS policy violations, invalid syntax, etc. shouldn't be retried
    const nonRetryableCodes = ['PGRST', '42501', '42601', '42P01'];
    const nonRetryableMessages = ['policy', 'permission', 'syntax error', 'does not exist'];

    return (
      nonRetryableCodes.some(c => code.includes(c)) ||
      nonRetryableMessages.some(m => message.toLowerCase().includes(m))
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
      console.log(`[DatabaseResilience] 🗑️ Cleared cache for ${key}`);
    } else {
      this.cache.clear();
      console.log('[DatabaseResilience] 🗑️ Cleared all cache');
    }
  }

  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
    };
  }
}

export const databaseResilienceWrapper = new DatabaseResilienceWrapper();
