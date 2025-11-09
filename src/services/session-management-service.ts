import { supabase } from '@/lib/supabase';

/**
 * Session Management Service
 *
 * Handles the lifecycle of manual trading sessions:
 * - Start session
 * - Pause/Resume session
 * - End session
 * - Link trades to active session
 * - Calculate session metrics
 */

interface TradingSession {
  id: string;
  user_id: string;
  session_start: string;
  session_end: string | null;
  session_status: 'active' | 'paused' | 'ended';
  session_name?: string;
  session_notes?: string;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  profit_factor: number;
  average_rr: number;
  session_spc: number;
}

interface SessionMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number;
  totalPnl: number;
  totalWinsPnl: number;
  totalLossesPnl: number;
  profitFactor: number;
  averageRR: number;
  maxConsecutiveLosses: number;
  comebackTradesCount: number;
}

class SessionManagementService {
  /**
   * Start a new trading session
   */
  async startSession(
    userId: string,
    sessionName?: string,
    sessionNotes?: string
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> {
    try {
      // Check if there's already an active session
      const { data: activeSessions } = await supabase
        .from('trading_sessions')
        .select('id, session_status')
        .eq('user_id', userId)
        .in('session_status', ['active', 'paused'])
        .order('session_start', { ascending: false })
        .limit(1);

      if (activeSessions && activeSessions.length > 0) {
        return {
          success: false,
          error: 'You already have an active session. Please end it before starting a new one.'
        };
      }

      // Create new session
      const { data: newSession, error } = await supabase
        .from('trading_sessions')
        .insert({
          user_id: userId,
          session_status: 'active',
          session_name: sessionName || `Session ${new Date().toLocaleDateString()}`,
          session_notes: sessionNotes
        })
        .select()
        .single();

      if (error) {
        console.error('[Session Management] Error starting session:', error);
        return { success: false, error: error.message };
      }

      console.log(`[Session Management] ✅ Started session: ${newSession.id}`);
      return { success: true, sessionId: newSession.id };
    } catch (error) {
      console.error('[Session Management] Exception starting session:', error);
      return { success: false, error: 'Failed to start session' };
    }
  }

  /**
   * Get active session for user
   */
  async getActiveSession(userId: string): Promise<TradingSession | null> {
    try {
      const { data, error } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('user_id', userId)
        .in('session_status', ['active', 'paused'])
        .order('session_start', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Session Management] Error fetching active session:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Session Management] Exception fetching active session:', error);
      return null;
    }
  }

  /**
   * Pause active session
   */
  async pauseSession(userId: string, sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('trading_sessions')
        .update({
          session_status: 'paused',
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('session_status', 'active');

      if (error) {
        console.error('[Session Management] Error pausing session:', error);
        return { success: false, error: error.message };
      }

      console.log(`[Session Management] ⏸️ Paused session: ${sessionId}`);
      return { success: true };
    } catch (error) {
      console.error('[Session Management] Exception pausing session:', error);
      return { success: false, error: 'Failed to pause session' };
    }
  }

  /**
   * Resume paused session
   */
  async resumeSession(userId: string, sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('trading_sessions')
        .update({
          session_status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .eq('session_status', 'paused');

      if (error) {
        console.error('[Session Management] Error resuming session:', error);
        return { success: false, error: error.message };
      }

      console.log(`[Session Management] ▶️ Resumed session: ${sessionId}`);
      return { success: true };
    } catch (error) {
      console.error('[Session Management] Exception resuming session:', error);
      return { success: false, error: 'Failed to resume session' };
    }
  }

  /**
   * End session and calculate final metrics
   */
  async endSession(
    userId: string,
    sessionId: string
  ): Promise<{ success: boolean; metrics?: SessionMetrics; error?: string }> {
    try {
      // Calculate session metrics first
      const metrics = await this.calculateSessionMetrics(userId, sessionId);

      if (!metrics) {
        return { success: false, error: 'Failed to calculate session metrics' };
      }

      // Calculate profit weight based on profit factor
      const profitWeight = this.calculateProfitWeight(metrics.profitFactor);

      // Calculate base SPC
      const baseSPC = (metrics.winningTrades - metrics.losingTrades) * profitWeight;

      // Get comeback bonus from session_trades
      const { data: sessionTrades } = await supabase
        .from('session_trades')
        .select('comeback_bonus_applied')
        .eq('session_id', sessionId);

      const comebackBonus = sessionTrades?.reduce((sum, trade) =>
        sum + (parseFloat(trade.comeback_bonus_applied) || 0), 0
      ) || 0;

      const sessionSPC = baseSPC + comebackBonus;
      const spcTier = this.calculateSPCTier(sessionSPC);
      const sessionGrade = this.calculateSessionGrade(
        metrics.winRate,
        metrics.profitFactor,
        sessionSPC
      );

      // Determine session mood
      const sessionMood = this.determineSessionMood(
        sessionSPC,
        metrics.comebackTradesCount,
        metrics.profitFactor
      );

      // Update session with final metrics
      const { error } = await supabase
        .from('trading_sessions')
        .update({
          session_status: 'ended',
          session_end: new Date().toISOString(),
          total_trades: metrics.totalTrades,
          winning_trades: metrics.winningTrades,
          losing_trades: metrics.losingTrades,
          breakeven_trades: metrics.breakevenTrades,
          win_rate: metrics.winRate,
          total_pnl: metrics.totalPnl,
          total_wins_pnl: metrics.totalWinsPnl,
          total_losses_pnl: Math.abs(metrics.totalLossesPnl),
          profit_factor: metrics.profitFactor,
          average_rr: metrics.averageRR,
          profit_weight: profitWeight,
          base_spc: baseSPC,
          comeback_bonus: comebackBonus,
          session_spc: sessionSPC,
          spc_tier: spcTier,
          comeback_trades_count: metrics.comebackTradesCount,
          max_consecutive_losses: metrics.maxConsecutiveLosses,
          session_grade: sessionGrade,
          session_mood: sessionMood,
          updated_at: new Date().toISOString()
        })
        .eq('id', sessionId)
        .eq('user_id', userId);

      if (error) {
        console.error('[Session Management] Error ending session:', error);
        return { success: false, error: error.message };
      }

      console.log(`[Session Management] ✅ Ended session: ${sessionId}`);
      console.log(`[Session Management] 📊 SPC: ${sessionSPC.toFixed(2)} (Base: ${baseSPC.toFixed(2)}, Comeback: ${comebackBonus.toFixed(2)})`);

      return { success: true, metrics };
    } catch (error) {
      console.error('[Session Management] Exception ending session:', error);
      return { success: false, error: 'Failed to end session' };
    }
  }

  /**
   * Link a trade to active session
   */
  async linkTradeToSession(
    userId: string,
    tradeId: string,
    sessionId: string,
    tradeNumber: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Get trade details
      const { data: trade, error: tradeError } = await supabase
        .from('trade_history')
        .select('*')
        .eq('id', tradeId)
        .single();

      if (tradeError || !trade) {
        return { success: false, error: 'Trade not found' };
      }

      // Determine trade outcome
      const pnl = parseFloat(trade.profit_loss);
      const tradeOutcome = pnl > 0 ? 'win' : (pnl < 0 ? 'loss' : 'breakeven');

      // Calculate realized R:R
      const risk = Math.abs(parseFloat(trade.entry_price) - parseFloat(trade.stop_loss));
      const reward = Math.abs(parseFloat(trade.exit_price) - parseFloat(trade.entry_price));
      const realizedRR = risk > 0 ? reward / risk : 0;

      // Get consecutive losses before this trade
      const consecutiveLosses = await this.getConsecutiveLosses(sessionId, tradeNumber);

      // Check if this is a comeback trade
      const isComebackTrade = consecutiveLosses >= 2 && tradeOutcome === 'win' && realizedRR >= 2.0;
      const comebackBonus = isComebackTrade ? this.calculateComebackBonus(consecutiveLosses) : 0;

      // Get session profit weight
      const { data: session } = await supabase
        .from('trading_sessions')
        .select('profit_factor')
        .eq('id', sessionId)
        .single();

      const profitWeight = session ? this.calculateProfitWeight(session.profit_factor) : 1.0;

      // Insert session_trade record
      const { error } = await supabase
        .from('session_trades')
        .insert({
          session_id: sessionId,
          trade_id: tradeId,
          user_id: userId,
          trade_number: tradeNumber,
          is_comeback_trade: isComebackTrade,
          losses_before_comeback: isComebackTrade ? consecutiveLosses : 0,
          comeback_bonus_applied: comebackBonus,
          trade_outcome: tradeOutcome,
          realized_rr: realizedRR,
          pnl: pnl,
          profit_weight: profitWeight,
          consecutive_losses_before: consecutiveLosses
        });

      if (error) {
        console.error('[Session Management] Error linking trade to session:', error);
        return { success: false, error: error.message };
      }

      if (isComebackTrade) {
        console.log(`[Session Management] 🎉 COMEBACK TRADE! (${consecutiveLosses} losses, ${realizedRR.toFixed(2)}R, +${comebackBonus.toFixed(2)} bonus)`);
      }

      return { success: true };
    } catch (error) {
      console.error('[Session Management] Exception linking trade:', error);
      return { success: false, error: 'Failed to link trade to session' };
    }
  }

  /**
   * Calculate session metrics from session_trades
   */
  private async calculateSessionMetrics(
    userId: string,
    sessionId: string
  ): Promise<SessionMetrics | null> {
    try {
      const { data: trades, error } = await supabase
        .from('session_trades')
        .select(`
          *,
          trade_history!inner(*)
        `)
        .eq('session_id', sessionId);

      if (error || !trades || trades.length === 0) {
        return null;
      }

      const wins = trades.filter(t => t.trade_outcome === 'win');
      const losses = trades.filter(t => t.trade_outcome === 'loss');
      const breakeven = trades.filter(t => t.trade_outcome === 'breakeven');

      const totalWinsPnl = wins.reduce((sum, t) => sum + parseFloat(t.pnl), 0);
      const totalLossesPnl = losses.reduce((sum, t) => sum + parseFloat(t.pnl), 0);
      const totalPnl = totalWinsPnl + totalLossesPnl;

      const profitFactor = Math.abs(totalLossesPnl) > 0
        ? totalWinsPnl / Math.abs(totalLossesPnl)
        : (totalWinsPnl > 0 ? 99 : 0);

      const averageRR = trades.reduce((sum, t) => sum + (parseFloat(t.realized_rr) || 0), 0) / trades.length;

      // Calculate max consecutive losses
      let maxConsecutiveLosses = 0;
      let currentStreak = 0;
      for (const trade of trades) {
        if (trade.trade_outcome === 'loss') {
          currentStreak++;
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
        } else {
          currentStreak = 0;
        }
      }

      const comebackTradesCount = trades.filter(t => t.is_comeback_trade).length;

      return {
        totalTrades: trades.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        breakevenTrades: breakeven.length,
        winRate: (wins.length / trades.length) * 100,
        totalPnl,
        totalWinsPnl,
        totalLossesPnl,
        profitFactor,
        averageRR,
        maxConsecutiveLosses,
        comebackTradesCount
      };
    } catch (error) {
      console.error('[Session Management] Error calculating metrics:', error);
      return null;
    }
  }

  /**
   * Get consecutive losses before a trade number
   */
  private async getConsecutiveLosses(sessionId: string, beforeTradeNumber: number): Promise<number> {
    try {
      const { data: trades } = await supabase
        .from('session_trades')
        .select('trade_outcome')
        .eq('session_id', sessionId)
        .lt('trade_number', beforeTradeNumber)
        .order('trade_number', { ascending: false });

      if (!trades || trades.length === 0) return 0;

      let count = 0;
      for (const trade of trades) {
        if (trade.trade_outcome === 'loss') {
          count++;
        } else {
          break;
        }
      }

      return count;
    } catch (error) {
      console.error('[Session Management] Error getting consecutive losses:', error);
      return 0;
    }
  }

  /**
   * Calculate profit weight based on profit factor
   */
  private calculateProfitWeight(profitFactor: number): number {
    if (profitFactor >= 1.5) return 1.25;
    if (profitFactor >= 1.0) return 1.0;
    if (profitFactor >= 0.8) return 0.75;
    return 0.5;
  }

  /**
   * Calculate comeback bonus
   */
  private calculateComebackBonus(lossesBeforeComeback: number): number {
    const baseBonus = 0.5;
    const multiplier = lossesBeforeComeback >= 3 ? 2.0 : 1.0;
    return baseBonus * multiplier;
  }

  /**
   * Calculate SPC tier
   */
  private calculateSPCTier(spc: number): string {
    if (spc >= 5.0) return 'exceptional';
    if (spc >= 2.0) return 'strong';
    if (spc > 0) return 'positive';
    if (spc === 0) return 'flat';
    return 'negative';
  }

  /**
   * Calculate session grade
   */
  private calculateSessionGrade(winRate: number, profitFactor: number, spc: number): string {
    if (winRate >= 75 && profitFactor >= 2.0 && spc >= 5.0) return 'A+';
    if (winRate >= 70 && profitFactor >= 1.5 && spc >= 3.0) return 'A';
    if (winRate >= 60 && profitFactor >= 1.2 && spc >= 1.0) return 'B';
    if (winRate >= 50 && profitFactor >= 1.0 && spc >= 0) return 'C';
    if (winRate >= 40 && profitFactor >= 0.8) return 'D';
    return 'F';
  }

  /**
   * Determine session mood
   */
  private determineSessionMood(spc: number, comebackCount: number, profitFactor: number): string {
    if (comebackCount >= 2 && spc > 0) return 'Strong Recovery';
    if (spc >= 3.0) return 'Steady Profits';
    if (spc >= 0 && spc < 1.0) return 'Flat Day';
    if (profitFactor < 0.8) return 'Defensive Mode Active';
    if (spc < 0) return 'Regression Risk';
    return 'Mixed Performance';
  }

  /**
   * Get recent sessions
   */
  async getRecentSessions(userId: string, limit: number = 10): Promise<TradingSession[]> {
    try {
      const { data, error } = await supabase
        .from('trading_sessions')
        .select('*')
        .eq('user_id', userId)
        .order('session_start', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Session Management] Error fetching recent sessions:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Session Management] Exception fetching recent sessions:', error);
      return [];
    }
  }
}

export const sessionManagementService = new SessionManagementService();
export type { TradingSession, SessionMetrics };
