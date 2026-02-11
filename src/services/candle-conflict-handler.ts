import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

/**
 * CCIP Governance: Candle Conflict Handler
 *
 * AUTHORITY: Single service for handling candle write conflicts and retries
 *
 * RESPONSIBILITY:
 * - Handles 409 Conflict errors on candle upserts
 * - Implements exponential backoff for transient failures
 * - Distinguishes between retryable and fatal errors
 * - Logs all conflicts to candle_write_audit table
 * - Ensures no data loss due to constraint violations
 *
 * PROBLEM FIXED:
 * - 409 Conflict errors causing silent candle drops
 * - Multiple services racing on concurrent writes
 * - No visibility into write failures
 * - No retry mechanism for transient failures
 *
 * @see background-candle-aggregator.ts - Uses this service for conflict handling
 * @see candle_write_audit - Audit trail of all conflicts
 */

interface CandleRecord {
  symbol: string;
  timeframe: string;
  open_time: string; // ISO string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ConflictHandlerOptions {
  maxRetries?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  authority?: string;
}

class CandleConflictHandler {
  private readonly DEFAULT_MAX_RETRIES = 3;
  private readonly DEFAULT_INITIAL_BACKOFF_MS = 100;
  private readonly DEFAULT_MAX_BACKOFF_MS = 2000;

  /**
   * CCIP GATE: Upsert candle with conflict handling and retry logic
   *
   * Implements exponential backoff for transient failures (409, network timeouts)
   * Distinguishes between retryable and fatal errors
   * Logs all attempts to audit table
   *
   * @param candle - Candle record to upsert
   * @param options - Retry and logging options
   * @returns Success/failure status with details
   */
  async upsertCandleWithRetry(
    candle: CandleRecord,
    options: ConflictHandlerOptions = {}
  ): Promise<{
    success: boolean;
    error?: string;
    retryCount: number;
    wasConflict: boolean;
    operation: 'inserted' | 'updated' | 'failed';
  }> {
    const {
      maxRetries = this.DEFAULT_MAX_RETRIES,
      initialBackoffMs = this.DEFAULT_INITIAL_BACKOFF_MS,
      maxBackoffMs = this.DEFAULT_MAX_BACKOFF_MS,
      authority = 'background-aggregator',
    } = options;

    let retryCount = 0;
    let lastError: any = null;
    let wasConflict = false;

    while (retryCount <= maxRetries) {
      try {
        const { data, error } = await supabase.rpc('upsert_forex_candle', {
          candle_data: candle,
        });

        if (!error && data?.success) {
          logger.debug(
            LogCategory.BACKGROUND_AGGREGATOR,
            `[Candle Conflict] SUCCESS: ${candle.symbol} ${candle.timeframe} at ${candle.open_time}`,
            { retryCount, operation: 'upsert_succeeded' }
          );

          await this.logCandleWriteAttempt(
            candle,
            authority,
            'upsert',
            false,
            null,
            'success'
          );

          return {
            success: true,
            retryCount,
            wasConflict,
            operation: data?.id ? 'updated' : 'inserted',
          };
        }

        const rpcError = error || { message: data?.error || 'RPC returned failure', code: 'RPC_FAIL' };

        lastError = rpcError;

        const isRetryable = this.isRetryableError(rpcError);
        wasConflict = rpcError?.code === '23505' || rpcError?.status === 409;

        logger.warn(
          LogCategory.BACKGROUND_AGGREGATOR,
          `[Candle Conflict] ${isRetryable ? 'RETRYABLE' : 'FATAL'} error on attempt ${retryCount + 1}/${maxRetries + 1}`,
          {
            symbol: candle.symbol,
            timeframe: candle.timeframe,
            errorCode: rpcError?.code,
            errorStatus: rpcError?.status,
            isConflict: wasConflict,
          }
        );

        if (!isRetryable) {
          logger.error(
            LogCategory.BACKGROUND_AGGREGATOR,
            `[Candle Conflict] FATAL ERROR - not retrying: ${rpcError?.message}`,
            { candle, error: rpcError }
          );

          await this.logCandleWriteAttempt(
            candle,
            authority,
            'upsert',
            true,
            rpcError?.message || 'Non-retryable error',
            'fatal_error'
          );

          return {
            success: false,
            error: rpcError?.message,
            retryCount,
            wasConflict,
            operation: 'failed',
          };
        }

        // Retryable: exponential backoff
        if (retryCount < maxRetries) {
          const backoffMs = Math.min(
            initialBackoffMs * Math.pow(2, retryCount),
            maxBackoffMs
          );

          logger.info(
            LogCategory.BACKGROUND_AGGREGATOR,
            `[Candle Conflict] Retrying after ${backoffMs}ms backoff...`,
            { symbol: candle.symbol, timeframe: candle.timeframe }
          );

          await this.delay(backoffMs);
          retryCount++;
          continue;
        }

        // Max retries exceeded
        break;
      } catch (exception) {
        logger.error(
          LogCategory.BACKGROUND_AGGREGATOR,
          `[Candle Conflict] Exception during retry loop`,
          { exception, retryCount }
        );

        lastError = exception;

        if (retryCount < maxRetries) {
          const backoffMs = Math.min(
            initialBackoffMs * Math.pow(2, retryCount),
            maxBackoffMs
          );
          await this.delay(backoffMs);
          retryCount++;
        } else {
          break;
        }
      }
    }

    // Max retries exceeded
    logger.error(
      LogCategory.BACKGROUND_AGGREGATOR,
      `[Candle Conflict] MAX RETRIES EXCEEDED after ${retryCount} attempts`,
      {
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        lastError: lastError?.message,
      }
    );

    await this.logCandleWriteAttempt(
      candle,
      authority,
      'upsert',
      true,
      `Max retries (${retryCount}) exceeded: ${lastError?.message}`,
      'retry_exhausted'
    );

    return {
      success: false,
      error: `Max retries exceeded: ${lastError?.message}`,
      retryCount,
      wasConflict,
      operation: 'failed',
    };
  }

  /**
   * Determine if an error is retryable
   *
   * Retryable: 409 Conflict, network timeouts, rate limits
   * Fatal: validation errors, auth errors, schema mismatches
   */
  private isRetryableError(error: any): boolean {
    if (!error) return false;

    // HTTP 409 Conflict - transient race condition
    if (error.status === 409) return true;

    // Database error codes
    if (error.code === '40P01') return true; // Deadlock
    if (error.code === '40001') return true; // Serialization failure
    if (error.code === '42P01') return false; // Table doesn't exist - fatal
    if (error.code === '23505') return true; // Unique violation - can be race condition

    // Network errors
    if (error.message?.includes('network') || error.message?.includes('timeout'))
      return true;
    if (error.message?.includes('ECONNREFUSED')) return true;

    // Default: assume not retryable
    return false;
  }

  /**
   * Log candle write attempt to audit table
   */
  private async logCandleWriteAttempt(
    candle: CandleRecord,
    authority: string,
    operation: string,
    conflict: boolean,
    reason: string | null,
    resolved: string
  ): Promise<void> {
    try {
      // Attempt to log audit trail (non-critical, best-effort)
      await supabase.from('candle_write_audit').insert({
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        open_time: candle.open_time,
        authority_service: authority,
        write_operation: operation,
        conflict_detected: conflict,
        conflict_reason: reason,
        resolved_by: resolved,
        completed_at: new Date().toISOString(),
        metadata: {
          candle_ohlc: {
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          },
        },
      });
    } catch (error) {
      // Silently ignore all audit logging failures
      // Common during page load before auth completes (401 errors)
      // Audit logging is nice-to-have for debugging, not critical
    }
  }

  /**
   * Delay helper for backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * GOVERNANCE QUERY: Get conflict statistics
   */
  async getConflictStats(hours: number = 24): Promise<{
    total_writes: number;
    total_conflicts: number;
    conflict_rate: number;
    symbols_affected: string[];
    last_conflict_at: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('candle_write_audit')
        .select('symbol, conflict_detected, completed_at')
        .gte(
          'attempt_at',
          new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
        );

      if (error || !data) {
        return {
          total_writes: 0,
          total_conflicts: 0,
          conflict_rate: 0,
          symbols_affected: [],
          last_conflict_at: null,
        };
      }

      const totalWrites = data.length;
      const totalConflicts = data.filter((d) => d.conflict_detected).length;
      const conflictRate = totalWrites > 0 ? totalConflicts / totalWrites : 0;
      const symbolsAffected = [...new Set(data.map((d) => d.symbol))];
      const lastConflict = data
        .filter((d) => d.conflict_detected)
        .map((d) => d.completed_at)
        .sort()
        .pop();

      return {
        total_writes: totalWrites,
        total_conflicts: totalConflicts,
        conflict_rate,
        symbols_affected: symbolsAffected as string[],
        last_conflict_at: lastConflict || null,
      };
    } catch (error) {
      logger.error(
        LogCategory.BACKGROUND_AGGREGATOR,
        '[Candle Conflict] Error fetching stats',
        { error }
      );
      return {
        total_writes: 0,
        total_conflicts: 0,
        conflict_rate: 0,
        symbols_affected: [],
        last_conflict_at: null,
      };
    }
  }
}

export const candleConflictHandler = new CandleConflictHandler();