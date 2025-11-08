/**
 * Database Validation Utilities
 *
 * Provides reusable validation and sanitization functions for database operations
 * to prevent schema mismatches and improve error handling.
 */

/**
 * Sanitize an object to only include specified fields
 * Useful for ensuring database updates only include valid columns
 */
export function sanitizeFields<T extends Record<string, any>>(
  data: T,
  allowedFields: string[]
): Partial<T> {
  const sanitized: Partial<T> = {};

  for (const field of allowedFields) {
    if (field in data) {
      const value = data[field];

      // Convert Date objects to ISO strings
      if (value instanceof Date) {
        (sanitized as any)[field] = value.toISOString();
        continue;
      }

      // Validate numeric fields
      if (typeof value === 'number') {
        if (isNaN(value) || !isFinite(value)) {
          console.warn(`[DB Validation] Invalid numeric value for ${field}: ${value}`);
          continue;
        }
      }

      // Skip undefined values
      if (value === undefined) {
        continue;
      }

      (sanitized as any)[field] = value;
    }
  }

  return sanitized;
}

/**
 * Validate that required fields are present in an object
 * Throws an error if any required field is missing
 */
export function validateRequiredFields<T extends Record<string, any>>(
  data: T,
  requiredFields: string[]
): void {
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!(field in data) || data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Missing required fields: ${missingFields.join(', ')}`
    );
  }
}

/**
 * Convert all Date objects in an object to ISO strings
 * Handles nested objects and arrays
 */
export function convertDatesToISO<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as any;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => convertDatesToISO(item)) as any;
  }

  if (typeof obj === 'object') {
    const converted: any = {};
    for (const [key, value] of Object.entries(obj)) {
      converted[key] = convertDatesToISO(value);
    }
    return converted;
  }

  return obj;
}

/**
 * Parse Supabase error and provide user-friendly message
 */
export function parseSupabaseError(error: any): string {
  if (!error) return 'Unknown database error';

  // Check for common Supabase error codes
  if (error.code === '23505') {
    return 'A record with this information already exists';
  }

  if (error.code === '23503') {
    return 'This operation references data that does not exist';
  }

  if (error.code === '42P01') {
    return 'Database table not found. Please ensure migrations are applied.';
  }

  if (error.code === '42703') {
    return 'Database column not found. Schema may be outdated.';
  }

  if (error.code === '23502') {
    return 'Required field is missing';
  }

  // Return the original message if no specific handling
  return error.message || 'Database operation failed';
}

/**
 * Batch array into smaller chunks for bulk operations
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Retry a database operation with exponential backoff
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  initialDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, attempt);
        console.warn(
          `[DB Retry] Operation failed (attempt ${attempt + 1}/${maxRetries}). ` +
          `Retrying in ${delay}ms...`,
          error
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Validate numeric range
 */
export function validateNumericRange(
  value: number,
  fieldName: string,
  min?: number,
  max?: number
): void {
  if (isNaN(value) || !isFinite(value)) {
    throw new Error(`${fieldName} must be a valid number`);
  }

  if (min !== undefined && value < min) {
    throw new Error(`${fieldName} must be at least ${min}`);
  }

  if (max !== undefined && value > max) {
    throw new Error(`${fieldName} must be at most ${max}`);
  }
}

/**
 * Log database operation for debugging
 */
export function logDatabaseOperation(
  operation: string,
  table: string,
  data?: any,
  error?: any
): void {
  const timestamp = new Date().toISOString();

  if (error) {
    console.error(
      `[DB Error] ${timestamp} - ${operation} on ${table} failed:`,
      error,
      data ? `\nData: ${JSON.stringify(data, null, 2)}` : ''
    );
  } else {
    console.log(
      `[DB Success] ${timestamp} - ${operation} on ${table}`,
      data ? `\nData: ${JSON.stringify(data, null, 2)}` : ''
    );
  }
}

/**
 * Check if value is a valid UUID
 */
export function isValidUUID(value: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Safe JSON stringify that handles circular references and BigInt
 */
export function safeStringify(obj: any, indent?: number): string {
  const seen = new WeakSet();

  return JSON.stringify(
    obj,
    (key, value) => {
      // Handle BigInt
      if (typeof value === 'bigint') {
        return value.toString();
      }

      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }

      return value;
    },
    indent
  );
}
