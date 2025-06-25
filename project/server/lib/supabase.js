import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from root directory
const envPath = join(__dirname, '../../.env');
console.log('🔧 Supabase loading environment variables from:', envPath);
dotenv.config({ path: envPath });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔑 Supabase Environment check:');
console.log('- SUPABASE_URL:', supabaseUrl ? 'SET' : 'MISSING');
console.log('- SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? 'SET' : 'MISSING');

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('⚠️ Supabase environment variables not configured');
}

// Server-side Supabase client with service role key
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseServiceKey || 'placeholder-key'
);

// Database operations for server
export const createUserProfile = async (userId, profileData) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert({
      id: userId,
      ...profileData,
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const saveTradingSession = async (sessionData) => {
  const { data, error } = await supabase
    .from('trading_sessions')
    .insert(sessionData)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const logTradeExecution = async (tradeData) => {
  const { data, error } = await supabase
    .from('trade_records')
    .insert({
      ...tradeData,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const saveAIJournalEntry = async (entryData) => {
  const { data, error } = await supabase
    .from('journal_entries')
    .insert({
      ...entryData,
      created_at: new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const getUserAccountInfo = async (userId) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('account_balance, risk_profile, plan_type')
    .eq('id', userId)
    .single();
  
  if (error) throw error;
  return data;
};

export const updateAccountBalance = async (userId, newBalance) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .update({ 
      account_balance: newBalance,
      updated_at: new Date().toISOString()
    })
    .eq('id', userId)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};