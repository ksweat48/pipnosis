import { supabase } from '../lib/supabase';

export interface AdminUser {
  user_id: string;
  email: string;
  created_at: string;
  is_admin: boolean;
  account_balance: number;
  credit_balance: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  active_trades: number;
  active_trades_detail: Array<{
    symbol: string;
    pnl: number;
    direction: string;
    entry_price: number;
  }>;
  scanning_sessions: number;
  scanning_duration_minutes: number | null;
  awaiting_response_sessions: number;
  last_activity: string;
}

export interface UserDetails {
  user: {
    user_id: string;
    email: string;
    created_at: string;
    is_admin: boolean;
  };
  balances: {
    account_balance: number;
    credit_balance: number;
    lifetime_credits_earned: number;
  };
  trade_stats: {
    total_trades: number;
    winning_trades: number;
    losing_trades: number;
    win_rate: number;
    net_pnl: number;
    avg_win: number;
    avg_loss: number;
  };
  active: {
    active_trades_count: number;
    active_trades: Array<{
      id: string;
      symbol: string;
      direction: string;
      entry_price: number;
      current_price: number;
      unrealized_pnl: number;
      opened_at: string;
    }>;
  };
  recent_trades: Array<{
    id: string;
    symbol: string;
    direction: string;
    pnl: number;
    closed_at: string;
    source: string;
  }>;
  goal_sessions: {
    active_sessions: number;
    completed_sessions: number;
    stuck_sessions: number;
    sessions: Array<{
      id: string;
      target_value: number;
      current_progress: number;
      status: string;
      created_at: string;
    }>;
  };
}

export interface SessionResetResult {
  success: boolean;
  session_id?: string;
  old_status?: string;
  new_status?: string;
  recalculated_progress?: number;
  target_value?: number;
  error?: string;
}

export interface AddCreditsResult {
  success: boolean;
  old_balance: number;
  new_balance: number;
  amount_added: number;
  reason: string;
}

export interface RecalculateBalanceResult {
  success: boolean;
  old_balance: number;
  correct_balance: number;
  balance_diff: number;
  trades_pnl: number;
  goal_trades_pnl: number;
  total_trades: number;
  total_goal_trades: number;
}

export const adminUserService = {
  async getAllUsers(searchEmail?: string, limit: number = 100): Promise<AdminUser[]> {
    const { data, error } = await supabase.rpc('admin_get_all_users', {
      search_email: searchEmail || null,
      limit_count: limit,
    });

    if (error) {
      console.error('Error fetching users:', error);
      throw new Error(error.message);
    }

    return data || [];
  },

  async getUserDetails(userId: string): Promise<UserDetails> {
    const { data, error } = await supabase.rpc('admin_get_user_details', {
      target_user_id: userId,
    });

    if (error) {
      console.error('Error fetching user details:', error);
      throw new Error(error.message);
    }

    return data;
  },

  async addCredits(
    userId: string,
    amount: number,
    reason: string
  ): Promise<AddCreditsResult> {
    if (amount <= 0) {
      throw new Error('Credit amount must be positive');
    }

    if (!reason || reason.trim().length === 0) {
      throw new Error('Reason is required');
    }

    const { data, error } = await supabase.rpc('admin_add_credits_to_user', {
      target_user_id: userId,
      credit_amount: amount,
      reason: reason.trim(),
    });

    if (error) {
      console.error('Error adding credits:', error);
      throw new Error(error.message);
    }

    return data;
  },

  async resetStuckSession(
    userId: string,
    sessionId: string
  ): Promise<SessionResetResult> {
    const { data, error } = await supabase.rpc('admin_clear_stuck_goal_session', {
      target_user_id: userId,
      session_id: sessionId,
    });

    if (error) {
      console.error('Error resetting session:', error);
      throw new Error(error.message);
    }

    return data;
  },

  async recalculateBalance(userId: string): Promise<RecalculateBalanceResult> {
    const { data, error } = await supabase.rpc('admin_recalculate_user_balance', {
      target_user_id: userId,
    });

    if (error) {
      console.error('Error recalculating balance:', error);
      throw new Error(error.message);
    }

    return data;
  },
};
