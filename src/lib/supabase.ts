import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase environment variables not found. Some features may not work.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key'
);

// Database Types
export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  plan_type: 'free' | 'beta' | 'premium';
  account_balance?: number;
  risk_profile: 'low' | 'medium' | 'high' | 'auto';
  created_at: string;
  updated_at: string;
}

export interface TradingPrompt {
  id: string;
  user_id: string;
  prompt_text: string;
  account_balance: number;
  strategies_generated: any[];
  selected_strategy?: any;
  status: 'pending' | 'analyzing' | 'executed' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface TradeRecord {
  id: string;
  user_id: string;
  prompt_id?: string;
  symbol: string;
  trade_type: 'buy' | 'sell';
  lot_size: number;
  entry_price: number;
  current_price?: number;
  stop_loss?: number;
  take_profit?: number;
  status: 'open' | 'closed' | 'pending';
  pnl?: number;
  opened_at: string;
  closed_at?: string;
  mt5_ticket?: string;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  trade_id?: string;
  entry_type: 'trade_entry' | 'trade_exit' | 'market_update' | 'ai_decision';
  title: string;
  content: string;
  confidence_level?: 'high' | 'medium' | 'low';
  created_at: string;
}

// Auth helpers
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
};

export const signUp = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });
  if (error) throw error;
  return data;
};

export const signIn = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
};

export const signOut = async () => {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};

// Database helpers
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('id', userId)
    .single();
  
  if (error && error.code !== 'PGRST116') throw error;
  return data;
};

export const createUserProfile = async (profile: Partial<UserProfile>) => {
  const { data, error } = await supabase
    .from('user_profiles')
    .insert(profile)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const saveTradingPrompt = async (prompt: Partial<TradingPrompt>) => {
  const { data, error } = await supabase
    .from('trading_prompts')
    .insert(prompt)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const saveTradeRecord = async (trade: Partial<TradeRecord>) => {
  const { data, error } = await supabase
    .from('trade_records')
    .insert(trade)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const saveJournalEntry = async (entry: Partial<JournalEntry>) => {
  const { data, error } = await supabase
    .from('journal_entries')
    .insert(entry)
    .select()
    .single();
  
  if (error) throw error;
  return data;
};

export const getUserTrades = async (userId: string) => {
  const { data, error } = await supabase
    .from('trade_records')
    .select('*')
    .eq('user_id', userId)
    .order('opened_at', { ascending: false });
  
  if (error) throw error;
  return data;
};

export const getUserJournal = async (userId: string) => {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data;
};