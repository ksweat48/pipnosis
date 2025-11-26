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
  winningTrades: number;
  losingTrades: number;
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

    // Fetch daily results from dedicated table
    const { data: dailyResultsData, error } = await supabase
      .from('daily_session_results')
      .select('*')
      .eq('user_id', userId)
      .eq('month_number', monthNumber)
      .order('day_number', { ascending: true });

    if (error) {
      console.error('[Monthly Session] Error fetching daily results:', error);
    }

    const dailyResults: DailySessionResult[] = [];

    // Parse daily results from database
    if (dailyResultsData && dailyResultsData.length > 0) {
      for (const dayData of dailyResultsData) {
        dailyResults.push({
          dayNumber: dayData.day_number,
          sessionDate: new Date(dayData.session_date),
          sessionName: dayData.session_name,
          winRate: parseFloat(dayData.win_rate || '0'),
          totalTrades: dayData.total_trades || 0,
          winningTrades: dayData.winning_trades || 0,
          losingTrades: dayData.losing_trades || 0,
          pnl: parseFloat(dayData.pnl || '0'),
          sessionCss: parseFloat(dayData.session_css || '0'),
          sessionEv: parseFloat(dayData.session_ev || '0'),
          isProfitable: dayData.is_profitable || false,
          keyLearnings: dayData.key_learnings || []
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
    // Fetch daily results from dedicated table for historical month
    const { data: dailyResultsData, error } = await supabase
      .from('daily_session_results')
      .select('*')
      .eq('user_id', userId)
      .eq('month_number', monthNumber)
      .order('day_number', { ascending: true });

    if (error) {
      console.error('[Monthly Session] Error fetching historical month data:', error);
      return null;
    }

    if (!dailyResultsData || dailyResultsData.length === 0) {
      return null;
    }

    const dailyResults: DailySessionResult[] = dailyResultsData.map(dayData => ({
      dayNumber: dayData.day_number,
      sessionDate: new Date(dayData.session_date),
      sessionName: dayData.session_name,
      winRate: parseFloat(dayData.win_rate || '0'),
      totalTrades: dayData.total_trades || 0,
      pnl: parseFloat(dayData.pnl || '0'),
      sessionCss: parseFloat(dayData.session_css || '0'),
      sessionEv: parseFloat(dayData.session_ev || '0'),
      isProfitable: dayData.is_profitable || false,
      keyLearnings: dayData.key_learnings || []
    }));

    const monthTotalPnl = dailyResults.reduce((sum, day) => sum + day.pnl, 0);
    const monthAvgWinRate = dailyResults.length > 0
      ? dailyResults.reduce((sum, day) => sum + day.winRate, 0) / dailyResults.length
      : 0;
    const monthTotalTrades = dailyResults.reduce((sum, day) => sum + day.totalTrades, 0);

    // Get start and end dates from daily results
    const startDate = dailyResults.length > 0 ? dailyResults[0].sessionDate : new Date();
    const endDate = dailyResults.length > 0 ? dailyResults[dailyResults.length - 1].sessionDate : new Date();

    return {
      monthNumber,
      monthlyParentSessionId: dailyResultsData[0]?.monthly_parent_session_id || `historical-month-${monthNumber}`,
      startDate,
      endDate,
      daysCompleted: dailyResults.length,
      totalDays: 30,
      dailyResults,
      monthTotalPnl,
      monthAvgWinRate,
      monthTotalTrades,
      isCurrentMonth: false,
      isComplete: dailyResults.length >= 30
    };
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
