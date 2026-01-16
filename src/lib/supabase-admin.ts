/**
 * Supabase Admin Client (Service Role)
 *
 * CRITICAL: This client bypasses Row-Level Security (RLS) policies.
 * Use ONLY for system operations like:
 * - Alpha thought stream logging
 * - Scan results persistence
 * - System notifications
 * - Background jobs
 *
 * DO NOT use for user-initiated operations that should respect RLS.
 *
 * Security Note:
 * - Service role key has superuser privileges
 * - Only use server-side or in trusted contexts
 * - Never expose service role key to browser
 * - All operations are logged for audit trail
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { logger, LogCategory } from './logger';

// Support both browser (Vite) and Node.js (Netlify Functions) environments
const getEnvVar = (name: string): string => {
  // Try import.meta.env first (Vite/browser)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return import.meta.env[name] || '';
  }
  // Fall back to process.env (Node.js/Netlify)
  if (typeof process !== 'undefined' && process.env) {
    // Try with VITE_ prefix first, then without
    return process.env[name] || process.env[name.replace('VITE_', '')] || '';
  }
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseServiceRoleKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl) {
  logger.error(LogCategory.DATABASE, '❌ [Supabase Admin] Missing SUPABASE_URL');
}

if (!supabaseServiceRoleKey) {
  // INFO level - this is expected in browser environment
  logger.info(LogCategory.DATABASE, '[Supabase Admin] Service role key not available (expected in browser - using regular client with RLS)');
}

// Create admin client with service role key
let supabaseAdminClient: SupabaseClient | null = null;

if (supabaseUrl && supabaseServiceRoleKey) {
  supabaseAdminClient = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      db: {
        schema: 'public'
      },
      global: {
        headers: {
          'x-client-info': 'pipnosis-admin-client'
        },
        fetch: (url, options = {}) => {
          return fetch(url, options).then(response => {
            if (!response.ok) {
              logger.error(LogCategory.DATABASE, '[Supabase Admin Error]', {
                url: url.toString(),
                status: response.status,
                statusText: response.statusText
              });
            }
            return response;
          }).catch(error => {
            logger.error(LogCategory.DATABASE, '[Supabase Admin Request Failed]', {
              url: url.toString(),
              error: error.message
            });
            throw error;
          });
        }
      }
    }
  );

  logger.info(LogCategory.DATABASE, '✅ [Supabase Admin] Service role client initialized');
} else {
  // INFO level - this is expected in browser, only server-side has service role
  logger.info(LogCategory.DATABASE, '[Supabase Admin] Admin client not initialized (using regular client with RLS policies)');
}

/**
 * Get the Supabase admin client (bypasses RLS)
 * Returns null if service role key is not configured
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  // Returns null in browser (expected) - callers should fall back to regular client
  return supabaseAdminClient;
}

/**
 * Check if admin client is available
 */
export function isAdminClientAvailable(): boolean {
  return supabaseAdminClient !== null;
}

// Export admin client directly (backwards compatibility)
export const supabaseAdmin = supabaseAdminClient;
