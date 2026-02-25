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
  tp1_wins: number;
  tp2_wins: number;
  manual_closed: number;
  active_trades: number;
  active_trades_detail: Array<{
    symbol: string;
    pnl: number;
    direction: string;
    entry_price: number;
    current_price: number;
  }>;
  scanning_sessions: number;
  scanning_duration_minutes: number | null;
  awaiting_response_sessions: number;
  prompt_risk: 'low' | 'medium' | 'high' | null;
  trade_style: string | null;
  dollar_risk: number | null;
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
  old_balance?: number;
  new_balance?: number;
  amount_added?: number;
  reason?: string;
  error?: string;
  timestamp?: string;
  error_code?: string;
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

export interface StaleSessionResult {
  session_id: string;
  user_id: string;
  minutes_scanning: number;
}

export interface ForceCloseAllNonTradeResult {
  success: boolean;
  sessions_closed: number;
  affected_users: number;
  message: string;
  error?: string;
}

export interface PlatformKPIs {
  total_users: number;
  active_users: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  overall_win_rate: number;
  total_platform_pnl: number;
  total_platform_balance: number;
  open_positions_count: number;
  total_unrealized_pnl: number;
}

export interface PaginationMetadata {
  currentPage: number;
  pageSize: number;
  totalUsers: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface PaginatedUsersResult {
  users: AdminUser[];
  pagination: PaginationMetadata;
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

  async getAllUsersPaginated(
    page: number = 1,
    pageSize: number = 20,
    searchEmail?: string
  ): Promise<PaginatedUsersResult> {
    // Calculate offset
    const offset = (page - 1) * pageSize;

    // Get total count using RPC function with SECURITY DEFINER (bypasses RLS)
    const { data: countData, error: countError } = await supabase.rpc('admin_count_users', {
      search_email: searchEmail || null,
    });

    if (countError) {
      console.error('Error counting users:', countError);
      throw new Error(countError.message);
    }

    const totalCount = Number(countData) || 0;
    const totalPages = Math.ceil(totalCount / pageSize);

    // Get paginated data using existing RPC function
    const { data, error } = await supabase.rpc('admin_get_all_users_paginated', {
      search_email: searchEmail || null,
      page_size: pageSize,
      page_offset: offset,
    });

    if (error) {
      console.error('Error fetching paginated users:', error);
      throw new Error(error.message);
    }

    const users = (data || []).map((row: Record<string, unknown>) => ({
      user_id:                    row.user_id,
      email:                      row.out_email ?? row.email,
      created_at:                 row.out_created_at ?? row.created_at,
      is_admin:                   row.user_is_admin ?? row.is_admin ?? false,
      account_balance:            row.out_account_balance ?? row.account_balance ?? 0,
      credit_balance:             row.out_credit_balance ?? row.credit_balance ?? 0,
      total_trades:               row.total_trades ?? 0,
      winning_trades:             row.winning_trades ?? 0,
      losing_trades:              row.losing_trades ?? 0,
      tp1_wins:                   row.tp1_wins ?? 0,
      tp2_wins:                   row.tp2_wins ?? 0,
      manual_closed:              row.manual_closed ?? 0,
      active_trades:              row.active_trades ?? 0,
      active_trades_detail:       row.active_trades_detail ?? [],
      scanning_sessions:          row.scanning_sessions ?? 0,
      scanning_duration_minutes:  row.scanning_duration_minutes ?? null,
      awaiting_response_sessions: row.awaiting_response_sessions ?? 0,
      prompt_risk:                row.prompt_risk ?? null,
      trade_style:                row.out_trade_style ?? row.trade_style ?? null,
      dollar_risk:                row.out_dollar_risk ?? row.dollar_risk ?? null,
      last_activity:              row.last_activity,
    } as AdminUser));

    return {
      users,
      pagination: {
        currentPage: page,
        pageSize,
        totalUsers: totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
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
      console.error('[AdminUserService] RPC error adding credits:', {
        message: error.message,
        details: error,
        userId,
        amount,
      });
      throw new Error(error.message);
    }

    if (!data) {
      console.error('[AdminUserService] No data returned from add_credits RPC');
      throw new Error('No response from server');
    }

    if (!data.success && data.error) {
      console.error('[AdminUserService] Function returned error:', {
        error: data.error,
        userId,
        amount,
      });
      const error = new Error(data.error);
      (error as any).isKnownError = true;
      throw error;
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

  async forceCloseStaleScanningSessions(): Promise<StaleSessionResult[]> {
    const { data, error } = await supabase.rpc('force_close_stale_scanning_sessions');

    if (error) {
      console.error('Error force-closing stale sessions:', error);
      throw new Error(error.message);
    }

    return data || [];
  },

  async forceCloseAllNonTradeSessions(): Promise<ForceCloseAllNonTradeResult> {
    const { data, error } = await supabase.rpc('force_close_all_non_trade_sessions');

    if (error) {
      console.error('Error force-closing all non-trade sessions:', error);
      throw new Error(error.message);
    }

    if (!data) {
      throw new Error('No response from server');
    }

    return data as ForceCloseAllNonTradeResult;
  },

  /**
   * Subscribe to real-time price updates for active trades
   * Returns unsubscribe function
   */
  subscribeToRealtimePrices(callback: () => void) {
    const channel = supabase
      .channel('admin-realtime-prices')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'realtime_prices',
        },
        () => {
          callback();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  },

  /**
   * Get platform-wide KPIs
   */
  async getPlatformKPIs(): Promise<PlatformKPIs> {
    const { data, error } = await supabase.rpc('admin_get_platform_kpis');

    if (error) {
      console.error('Error fetching platform KPIs:', error);
      throw new Error(error.message);
    }

    // Supabase RPC returns an array for TABLE-returning functions
    // Extract first row or return defaults
    const kpis = Array.isArray(data) && data.length > 0 ? data[0] : null;

    if (!kpis) {
      console.warn('[Admin Service] No KPI data returned from database');
      return {
        total_users: 0,
        active_users: 0,
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        overall_win_rate: 0,
      };
    }

    return kpis;
  },
};
