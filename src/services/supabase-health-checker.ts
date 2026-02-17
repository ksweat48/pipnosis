/**
 * Supabase Health Checker
 *
 * Verifies Supabase connectivity before app initialization
 * Prevents cascading failures when Supabase is unreachable
 */

import { supabase } from '@/lib/supabase';

interface HealthCheckResult {
  isHealthy: boolean;
  error?: string;
  latency?: number;
}

class SupabaseHealthChecker {
  private lastCheckTime = 0;
  private lastCheckResult: HealthCheckResult | null = null;
  private readonly CACHE_DURATION = 30000; // 30 seconds

  /**
   * Check if Supabase is reachable with timeout
   */
  async checkHealth(timeoutMs = 5000): Promise<HealthCheckResult> {
    const now = Date.now();

    // Return cached result if recent
    if (this.lastCheckResult && (now - this.lastCheckTime) < this.CACHE_DURATION) {
      return this.lastCheckResult;
    }

    const startTime = Date.now();

    try {
      // Race between health check and timeout
      const result = await Promise.race([
        this.performHealthCheck(),
        this.timeoutPromise(timeoutMs)
      ]);

      const latency = Date.now() - startTime;

      this.lastCheckResult = {
        isHealthy: result.isHealthy,
        error: result.error,
        latency
      };
      this.lastCheckTime = now;

      return this.lastCheckResult;
    } catch (error) {
      const result: HealthCheckResult = {
        isHealthy: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };

      this.lastCheckResult = result;
      this.lastCheckTime = now;

      return result;
    }
  }

  /**
   * Perform actual health check
   */
  private async performHealthCheck(): Promise<HealthCheckResult> {
    try {
      // Simple query to verify connectivity
      const { error } = await supabase
        .from('user_profiles')
        .select('count')
        .limit(0)
        .maybeSingle();

      if (error && error.message.includes('JWT')) {
        // JWT errors are OK - means auth is working but not authenticated
        return { isHealthy: true };
      }

      if (error) {
        return {
          isHealthy: false,
          error: error.message
        };
      }

      return { isHealthy: true };
    } catch (error) {
      return {
        isHealthy: false,
        error: error instanceof Error ? error.message : 'Connection failed'
      };
    }
  }

  /**
   * Create timeout promise
   */
  private timeoutPromise(ms: number): Promise<HealthCheckResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check timeout after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * Wait for Supabase to become healthy with retry
   */
  async waitForHealthy(maxAttempts = 3, delayMs = 2000): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`[HealthCheck] Attempt ${attempt}/${maxAttempts}...`);

      const result = await this.checkHealth();

      if (result.isHealthy) {
        console.log(`[HealthCheck] ✅ Supabase is healthy (${result.latency}ms)`);
        return true;
      }

      console.warn(`[HealthCheck] ⚠️ Attempt ${attempt} failed:`, result.error);

      if (attempt < maxAttempts) {
        console.log(`[HealthCheck] Retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    console.error('[HealthCheck] ❌ Supabase is unreachable after all attempts');
    return false;
  }
}

export const supabaseHealthChecker = new SupabaseHealthChecker();
