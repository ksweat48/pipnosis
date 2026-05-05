import { createClient } from '@supabase/supabase-js';

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
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ [Supabase] Missing environment variables!');
  console.error('❌ [Supabase] URL:', supabaseUrl || 'MISSING');
  console.error('❌ [Supabase] Key:', supabaseAnonKey ? 'Set' : 'MISSING');
  console.error('❌ [Supabase] The app will continue but database features will not work');

  // Use dummy values to prevent crashes - the app will work in offline mode
  if (!supabaseUrl) {
    console.warn('⚠️ [Supabase] Using dummy URL');
  }
  if (!supabaseAnonKey) {
    console.warn('⚠️ [Supabase] Using dummy key');
  }
}

// Create Supabase client with request logging
// Use fallback values to prevent crashes if env vars are missing
const supabaseClient = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  db: {
    schema: 'public'
  },
  global: {
    headers: {
      'x-client-info': 'pipnosis-trading-v1'
    },
    fetch: (url, options = {}) => {
      // CCIP-2026-0505E NETWORK RESILIENCE SSOT
      // Single retry-with-backoff at the fetch boundary for transient
      // ERR_CONNECTION_CLOSED / TypeError network failures. Idempotent
      // methods only (GET/HEAD) to avoid duplicate writes on POST/PATCH.
      // One retry layer for all Supabase calls — no duplicated logic in
      // call sites. HTTP error responses are NOT retried (those are
      // application-level and handled upstream).
      const method = (options.method || 'GET').toUpperCase();
      const isIdempotent = method === 'GET' || method === 'HEAD';

      const isTransientNetworkError = (error: any): boolean => {
        if (!error) return false;
        const name = error.name || '';
        const message = (error.message || '').toLowerCase();
        if (name === 'AbortError' || message.includes('aborted') || message.includes('signal')) {
          return false;
        }
        return (
          name === 'TypeError' ||
          message.includes('failed to fetch') ||
          message.includes('network') ||
          message.includes('connection closed') ||
          message.includes('err_connection')
        );
      };

      const attemptFetch = (retriesLeft: number): Promise<Response> => {
        return fetch(url, options).then(response => {
          if (!response.ok) {
            const urlString = url.toString();

            // SSOT: Suppress expected 403 errors for realtime_prices
            // RLS correctly blocks unauthorized INSERT attempts; frontend
            // is read-only by design.
            const is403 = response.status === 403;
            const isRealtimePrices = urlString.includes('/realtime_prices');
            const isPost = method === 'POST';

            if (is403 && isRealtimePrices && isPost) {
              return response;
            }

            console.error('[Supabase Error]', {
              url: urlString,
              status: response.status,
              statusText: response.statusText
            });
          }
          return response;
        }).catch((error: any) => {
          const isAbortError = error?.name === 'AbortError' ||
                              error?.message?.includes('aborted') ||
                              error?.message?.includes('signal');

          if (isAbortError) {
            throw error;
          }

          if (retriesLeft > 0 && isIdempotent && isTransientNetworkError(error)) {
            const backoffMs = 300;
            return new Promise<Response>((resolve, reject) => {
              setTimeout(() => {
                attemptFetch(retriesLeft - 1).then(resolve, reject);
              }, backoffMs);
            });
          }

          console.error('[Supabase Request Failed]', {
            url: url.toString(),
            method,
            error: error?.message
          });
          throw error;
        });
      };

      return attemptFetch(isIdempotent ? 1 : 0);
    }
  },
  realtime: {
    params: {
      eventsPerSecond: 100
    }
  }
});

export const supabase = supabaseClient;

// Admin role check helper
export async function isCurrentUserAdmin(): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error checking admin status:', error);
      return false;
    }

    return data?.is_admin === true;
  } catch (error) {
    console.error('Error in isCurrentUserAdmin:', error);
    return false;
  }
}

// Get current user role
export async function getCurrentUserRole(): Promise<'admin' | 'user' | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();

    if (error) {
      console.error('Error getting user role:', error);
      return null;
    }

    return data?.is_admin === true ? 'admin' : 'user';
  } catch (error) {
    console.error('Error in getCurrentUserRole:', error);
    return null;
  }
}
