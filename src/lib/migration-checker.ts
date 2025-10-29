import { supabase } from './supabase';

export async function verifyDatabaseSetup(): Promise<boolean> {
  try {
    const { error } = await supabase.from('user_profiles').select('id').limit(1);

    if (error) {
      console.warn('Database setup verification failed:', error.message);
      return false;
    }

    console.log('Database setup verified');
    return true;
  } catch (err) {
    console.error('Migration checker error:', err);
    return false;
  }
}
