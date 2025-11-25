import { createClient } from '@supabase/supabase-js';

const supabaseUrl = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.VITE_SUPABASE_URL || ''
  : process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '';

const supabaseAnonKey = typeof import.meta !== 'undefined' && import.meta.env
  ? import.meta.env.VITE_SUPABASE_ANON_KEY || ''
  : process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase environment variables');
}

// Create Supabase client with request logging
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
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
      return fetch(url, options).then(response => {
        if (!response.ok) {
          console.error('[Supabase Error]', {
            url: url.toString(),
            status: response.status,
            statusText: response.statusText
          });
        }
        return response;
      }).catch(error => {
        console.error('[Supabase Request Failed]', {
          url: url.toString(),
          error: error.message
        });
        throw error;
      });
    }
  },
  realtime: {
    params: {
      eventsPerSecond: 10
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
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (error) {
      console.error('Error checking admin status:', error);
      return false;
    }

    return data !== null;
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
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error getting user role:', error);
      return null;
    }

    return (data?.role as 'admin' | 'user') || null;
  } catch (error) {
    console.error('Error in getCurrentUserRole:', error);
    return null;
  }
}
