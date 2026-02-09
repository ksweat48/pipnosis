import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

let adminInstance: SupabaseClient | null = null;
let anonInstance: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (!adminInstance) {
    adminInstance = createClient(supabaseUrl, supabaseServiceKey);
  }
  return adminInstance;
}

export function getSupabaseAnon(): SupabaseClient {
  if (!anonInstance) {
    anonInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return anonInstance;
}

export function getSupabaseUrl(): string {
  return supabaseUrl;
}
