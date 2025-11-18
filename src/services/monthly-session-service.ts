import { supabase } from '@/lib/supabase';

/**
 * Monthly Session Service
 *
 * Handles fetching and managing 30-day monthly backtest session data
 * for display in the monthly performance calendar.
 */

export interface DailySessionResult {
  dayNumber: number;
  sessionDate: Date;
  sessionName: string;
  winRate: number;
  totalTrades: number;
  pnl: number;
  sessionCss: number;
  sessionEv: number;
  isProfitable: boolean;
  keyLearnings: string[];
}

export interface MonthlySessionData {
  monthNumber: number;
  monthlyParentSessionId: string;
  startDate: Date;
  endDate: Date;
  daysCompleted: number;
  totalDays: number;
  dailyResults: DailySessionResult[];
  monthTotalPnl: number;
  monthAvgWinRate: number;
  monthTotalTrades: number;
  isCurrentMonth: boolean;
  isComplete: boolean;
}

class MonthlySessionService {
  /**
   * Fetch data for a specific month
   */
  async getMonthData(userId: string, monthNumber: number): Promise<MonthlySessionData | null> {
    try {
      // Get the monthly session metadata from auto_backtest_global_state
      const { data: currentState } = await supabase
        .from('auto_backtest_global_state')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (!currentState) {
        console.log('[Monthly Session] No backtest state found');
        return null;
      }

      const isCurrentMonth = currentState.current_month_number === monthNumber;

      // For current month, use the live state data
      if (isCurrentMonth && currentState.current_day_in_month > 0) {
        return await this.getCurrentMonthData(userId, currentState);
      }

      // For historical months, fetch from ai_session_learnings
      return await this.getHistoricalMonthData(userId, monthNumber);

    } catch (error) {
      console.error('[Monthly Session] Error fetching month data:', error);
      return null;
    }
  }

  /**
   * Get current month data (in progress)
   */
  private async getCurrentMonthData(userId: string, state: any): Promise<MonthlySessionData> {
    const monthNumber = state.current_month_number;
    const daysCompleted = state.current_day_in_month;

    // Fetch daily session learnings for current month
    // We look for sessions that match the naming pattern Month-X-Day-Y
    const { data: sessions } = await supabase
      .from('ai_session_learnings')
      .select('*')
      .eq('user_id', userId)
      .eq('session_type', 'backtest')
      .order('session_date', { ascending: true })
      .limit(30);

    const dailyResults: DailySessionResult[] = [];

    // Parse sessions to extract day-specific results
    if (sessions) {
      for (let day = 1; day <= daysCompleted; day++) {
        // Find session matching this day
        const daySession = sessions.find(s => {
          // Extract day number from session name or match by date
          return s.session_date && this.isDayInMonth(s.session_date, day, monthNumber, state);
        });

        if (daySession) {
          dailyResults.push(this.parseDailyResult(daySession, day));
        }
      }
    }

    // If we have the last_day result in state, ensure it's included
    if (state.last_day_number && state.last_day_number <= daysCompleted) {
      const existingDay = dailyResults.find(d => d.dayNumber === state.last_day_number);
      if (!existingDay && state.last_day_session_name) {
        dailyResults.push({
          dayNumber: state.last_day_number,
          sessionDate: new Date(state.last_day_completed_at),
          sessionName: state.last_day_session_name,
          winRate: parseFloat(state.last_day_win_rate || '0'),
          totalTrades: state.last_day_total_trades || 0,
          pnl: parseFloat(state.last_day_pnl || '0'),
          sessionCss: 0,
          sessionEv: 0,
          isProfitable: parseFloat(state.last_day_pnl || '0') > 0,
          keyLearnings: []
        });
      }
    }

    // Sort by day number
    dailyResults.sort((a, b) => a.dayNumber - b.dayNumber);

    // Calculate month totals
    const monthTotalPnl = dailyResults.reduce((sum, day) => sum + day.pnl, 0);
    const monthAvgWinRate = dailyResults.length > 0
      ? dailyResults.reduce((sum, day) => sum + day.winRate, 0) / dailyResults.length
      : 0;
    const monthTotalTrades = dailyResults.reduce((sum, day) => sum + day.totalTrades, 0);

    return {
      monthNumber,
      monthlyParentSessionId: state.monthly_parent_session_id || `month-${monthNumber}`,
      startDate: state.started_at ? new Date(state.started_at) : new Date(),
      endDate: new Date(),
      daysCompleted,
      totalDays: 30,
      dailyResults,
      monthTotalPnl,
      monthAvgWinRate,
      monthTotalTrades,
      isCurrentMonth: true,
      isComplete: daysCompleted >= 30
    };
  }

  /**
   * Get historical month data (completed months)
   */
  private async getHistoricalMonthData(userId: string, monthNumber: number): Promise<MonthlySessionData | null> {
    // For historical months, we need to reconstruct from ai_session_learnings
    // This is a best-effort approach since we may not have perfect records

    const { data: sessions } = await supabase
      .from('ai_session_learnings')
      .select('*')
      .eq('user_id', userId)
      .eq('session_type', 'backtest')
      .order('session_date', { ascending: true });

    if (!sessions || sessions.length === 0) {
      return null;
    }

    // Try to group sessions into months of 30 days
    // This is approximate since we don't have explicit month markers in old data
    const sessionsPerMonth = 30;
    const monthStartIndex = (monthNumber - 1) * sessionsPerMonth;
    const monthSessions = sessions.slice(monthStartIndex, monthStartIndex + sessionsPerMonth);

    if (monthSessions.length === 0) {
      return null;
    }

    const dailyResults: DailySessionResult[] = monthSessions.map((session, index) =>
      this.parseDailyResult(session, index + 1)
    );

    const monthTotalPnl = dailyResults.reduce((sum, day) => sum + day.pnl, 0);
    const monthAvgWinRate = dailyResults.length > 0
      ? dailyResults.reduce((sum, day) => sum + day.winRate, 0) / dailyResults.length
      : 0;
    const monthTotalTrades = dailyResults.reduce((sum, day) => sum + day.totalTrades, 0);

    return {
      monthNumber,
      monthlyParentSessionId: `historical-month-${monthNumber}`,
      startDate: new Date(monthSessions[0].session_date),
      endDate: new Date(monthSessions[monthSessions.length - 1].session_date),
      daysCompleted: monthSessions.length,
      totalDays: 30,
      dailyResults,
      monthTotalPnl,
      monthAvgWinRate,
      monthTotalTrades,
      isCurrentMonth: false,
      isComplete: monthSessions.length >= 30
    };
  }

  /**
   * Parse daily session result from database record
   */
  private parseDailyResult(session: any, dayNumber: number): DailySessionResult {
    const pnl = parseFloat(session.session_ev || session.best_setup_ev || '0');

    return {
      dayNumber,
      sessionDate: new Date(session.session_date),
      sessionName: `Day ${dayNumber}`,
      winRate: parseFloat(session.best_setup_win_rate || '0'),
      totalTrades: session.trades_taken || 0,
      pnl,
      sessionCss: parseFloat(session.session_css || '0'),
      sessionEv: parseFloat(session.session_ev || '0'),
      isProfitable: pnl > 0,
      keyLearnings: session.key_learnings || []
    };
  }

  /**
   * Check if a session date belongs to a specific day in a month
   */
  private isDayInMonth(sessionDate: string, dayNumber: number, monthNumber: number, state: any): boolean {
    // Simple heuristic: check if the session is recent enough
    // In a perfect world, we'd track this explicitly in the database
    const date = new Date(sessionDate);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    // If we're in month 1, day should be within last 30 days
    const expectedDaysAgo = (state.current_month_number - monthNumber) * 30 + (30 - dayNumber);

    return Math.abs(daysDiff - expectedDaysAgo) < 2; // Allow 2 day tolerance
  }

  /**
   * Get list of all available months
   */
  async getAvailableMonths(userId: string): Promise<number[]> {
    try {
      const { data: state } = await supabase
        .from('auto_backtest_global_state')
        .select('total_months_completed, current_month_number')
        .eq('user_id', userId)
        .single();

      if (!state) {
        return [];
      }

      const months: number[] = [];

      // Add all completed months
      for (let i = 1; i <= state.total_months_completed; i++) {
        months.push(i);
      }

      // Add current month if it has progress
      if (state.current_month_number > state.total_months_completed) {
        months.push(state.current_month_number);
      }

      return months;
    } catch (error) {
      console.error('[Monthly Session] Error fetching available months:', error);
      return [];
    }
  }

  /**
   * Get the current active month number
   */
  async getCurrentMonthNumber(userId: string): Promise<number> {
    try {
      const { data: state } = await supabase
        .from('auto_backtest_global_state')
        .select('current_month_number')
        .eq('user_id', userId)
        .single();

      return state?.current_month_number || 0;
    } catch (error) {
      console.error('[Monthly Session] Error fetching current month:', error);
      return 0;
    }
  }
}

export const monthlySessionService = new MonthlySessionService();
