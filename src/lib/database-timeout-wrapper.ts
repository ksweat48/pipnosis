/**
 * Database Query Timeout Wrapper - CCIP P0-2
 *
 * Prevents system hangs by enforcing timeouts on all database queries.
 * Returns null on timeout to allow graceful degradation.
 */

import { logger } from './logger';

export interface TimeoutResult<T> {
  data: T | null;
  timedOut: boolean;
  error?: Error;
}

/**
 * Wraps a database query with a timeout.
 * Returns null if query exceeds timeout, allowing system to continue.
 *
 * @param query - Promise to execute (typically a Supabase query)
 * @param operationName - Name for logging/debugging
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Result with data, timeout flag, and optional error
 */
export async function queryWithTimeout<T>(
  query: Promise<T>,
  operationName: string,
  timeoutMs: number = 5000
): Promise<TimeoutResult<T>> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Database timeout: ${operationName} exceeded ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const data = await Promise.race([query, timeoutPromise]);
    return { data, timedOut: false };
  } catch (error) {
    const errorObj = error instanceof Error ? error : new Error(String(error));

    if (errorObj.message?.includes('Database timeout')) {
      logger.error(`[DatabaseTimeout] ${operationName} exceeded ${timeoutMs}ms`, {
        operation: operationName,
        timeout: timeoutMs
      });
      return { data: null, timedOut: true, error: errorObj };
    }

    // Other database error
    logger.error(`[DatabaseError] ${operationName} failed`, {
      error: errorObj.message,
      operation: operationName
    });
    return { data: null, timedOut: false, error: errorObj };
  }
}

/**
 * Wraps a Supabase query that returns { data, error } format.
 * Handles timeout and returns standard Supabase response shape.
 *
 * @param query - Supabase query promise
 * @param operationName - Name for logging/debugging
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Standard Supabase response { data, error }
 */
export async function supabaseQueryWithTimeout<T>(
  query: Promise<{ data: T | null; error: any }>,
  operationName: string,
  timeoutMs: number = 5000
): Promise<{ data: T | null; error: any }> {
  const result = await queryWithTimeout(query, operationName, timeoutMs);

  if (result.timedOut) {
    return {
      data: null,
      error: { message: `Query timeout: ${operationName}`, code: 'TIMEOUT' }
    };
  }

  if (result.error) {
    return {
      data: null,
      error: { message: result.error.message, code: 'DATABASE_ERROR' }
    };
  }

  // Extract data/error from Supabase response
  const supabaseResult = result.data as { data: T | null; error: any };
  return supabaseResult || { data: null, error: null };
}
