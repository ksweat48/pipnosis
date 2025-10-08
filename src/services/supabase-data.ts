import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  plan_type: 'free' | 'beta' | 'premium';
  account_balance: number;
  risk_profile: 'low' | 'medium' | 'high' | 'auto';
  trading_preferences: any;
  created_at: string;
  updated_at: string;
}

export interface TradingPrompt {
  id: string;
  user_id: string;
  prompt_text: string;
  account_balance: number;
  market_data?: any;
  strategies_generated: any[];
  selected_strategy?: any;
  ai_confidence?: 'high' | 'medium' | 'low';
  status: 'pending' | 'analyzing' | 'completed' | 'executed' | 'failed';
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
  status: 'pending' | 'open' | 'closed' | 'cancelled';
  pnl: number;
  opened_at: string;
  closed_at?: string;
  mt5_ticket?: string;
  trade_metadata: any;
}

export interface JournalEntry {
  id: string;
  user_id: string;
  trade_id?: string;
  entry_type: 'trade_entry' | 'trade_exit' | 'market_update' | 'ai_decision' | 'modification';
  title: string;
  content: string;
  confidence_level?: 'high' | 'medium' | 'low';
  metadata: any;
  created_at: string;
}

export interface TradingSession {
  id: string;
  user_id: string;
  session_start: string;
  session_end?: string;
  total_trades: number;
  total_pnl: number;
  session_metadata: any;
  created_at: string;
}

class SupabaseDataService {
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }

    return data;
  }

  async createOrUpdateUserProfile(profile: Partial<UserProfile>): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from('user_profiles')
      .upsert(profile)
      .select()
      .single();

    if (error) {
      console.error('Error upserting user profile:', error);
      return null;
    }

    return data;
  }

  async createTradingPrompt(prompt: Partial<TradingPrompt>): Promise<TradingPrompt | null> {
    const { data, error } = await supabase
      .from('trading_prompts')
      .insert(prompt)
      .select()
      .single();

    if (error) {
      console.error('Error creating trading prompt:', error);
      return null;
    }

    return data;
  }

  async updateTradingPrompt(id: string, updates: Partial<TradingPrompt>): Promise<TradingPrompt | null> {
    const { data, error } = await supabase
      .from('trading_prompts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating trading prompt:', error);
      return null;
    }

    return data;
  }

  async createTradeRecord(trade: Partial<TradeRecord>): Promise<TradeRecord | null> {
    const { data, error } = await supabase
      .from('trade_records')
      .insert(trade)
      .select()
      .single();

    if (error) {
      console.error('Error creating trade record:', error);
      return null;
    }

    return data;
  }

  async updateTradeRecord(id: string, updates: Partial<TradeRecord>): Promise<TradeRecord | null> {
    const { data, error } = await supabase
      .from('trade_records')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating trade record:', error);
      return null;
    }

    return data;
  }

  async getActiveTrades(userId: string): Promise<TradeRecord[]> {
    const { data, error } = await supabase
      .from('trade_records')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) {
      console.error('Error fetching active trades:', error);
      return [];
    }

    return data || [];
  }

  async getTradeHistory(userId: string, limit: number = 50): Promise<TradeRecord[]> {
    const { data, error } = await supabase
      .from('trade_records')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['closed', 'cancelled'])
      .order('closed_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching trade history:', error);
      return [];
    }

    return data || [];
  }

  async createJournalEntry(entry: Partial<JournalEntry>): Promise<JournalEntry | null> {
    const { data, error } = await supabase
      .from('journal_entries')
      .insert(entry)
      .select()
      .single();

    if (error) {
      console.error('Error creating journal entry:', error);
      return null;
    }

    return data;
  }

  async getJournalEntries(userId: string, limit: number = 50): Promise<JournalEntry[]> {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching journal entries:', error);
      return [];
    }

    return data || [];
  }

  async createTradingSession(session: Partial<TradingSession>): Promise<TradingSession | null> {
    const { data, error } = await supabase
      .from('trading_sessions')
      .insert(session)
      .select()
      .single();

    if (error) {
      console.error('Error creating trading session:', error);
      return null;
    }

    return data;
  }

  async updateTradingSession(id: string, updates: Partial<TradingSession>): Promise<TradingSession | null> {
    const { data, error } = await supabase
      .from('trading_sessions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating trading session:', error);
      return null;
    }

    return data;
  }

  async getActiveSessions(userId: string): Promise<TradingSession[]> {
    const { data, error } = await supabase
      .from('trading_sessions')
      .select('*')
      .eq('user_id', userId)
      .is('session_end', null)
      .order('session_start', { ascending: false });

    if (error) {
      console.error('Error fetching active sessions:', error);
      return [];
    }

    return data || [];
  }

  async getTradingKPIs(userId: string): Promise<any> {
    const trades = await this.getTradeHistory(userId, 1000);

    const totalTrades = trades.length;
    const winningTrades = trades.filter(t => t.pnl > 0).length;
    const losingTrades = trades.filter(t => t.pnl < 0).length;
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);

    const tradesWithRRR = trades.filter(t => t.trade_metadata?.riskRewardRatio);
    const averageRRR = tradesWithRRR.length > 0
      ? tradesWithRRR.reduce((sum, t) => sum + (t.trade_metadata.riskRewardRatio || 0), 0) / tradesWithRRR.length
      : 0;

    let maxDrawdown = 0;
    let peak = 0;
    let runningTotal = 0;

    for (const trade of trades) {
      runningTotal += trade.pnl;
      if (runningTotal > peak) {
        peak = runningTotal;
      }
      const drawdown = ((peak - runningTotal) / Math.max(peak, 1)) * 100;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return {
      winRate,
      averageRRR,
      maxDrawdown,
      totalPnL,
      winningTrades,
      losingTrades,
      totalTrades
    };
  }

  subscribeToActiveTrades(userId: string, callback: (trades: TradeRecord[]) => void) {
    try {
      const channel = supabase
        .channel(`trades:${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'trade_records',
            filter: `user_id=eq.${userId}`
          },
          async () => {
            const trades = await this.getActiveTrades(userId);
            callback(trades);
          }
        );

      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Realtime subscription issue for trades: ${status}`);
        }
      });

      return channel;
    } catch (error) {
      console.error('Failed to subscribe to active trades:', error);
      return null;
    }
  }

  subscribeToJournalEntries(userId: string, callback: (entries: JournalEntry[]) => void) {
    try {
      const channel = supabase
        .channel(`journal:${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'journal_entries',
            filter: `user_id=eq.${userId}`
          },
          async () => {
            const entries = await this.getJournalEntries(userId);
            callback(entries);
          }
        );

      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Realtime subscription issue for journal: ${status}`);
        }
      });

      return channel;
    } catch (error) {
      console.error('Failed to subscribe to journal entries:', error);
      return null;
    }
  }
}

export const supabaseDataService = new SupabaseDataService();
