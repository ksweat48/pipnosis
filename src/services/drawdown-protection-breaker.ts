import { supabase } from '../lib/supabase';

export interface DrawdownCheckInputs {
  userId: string;
  currentBalance: number;
  startingBalance?: number; // If not provided, will fetch from DB
  goalSessionId?: string;
}

export interface DrawdownProtectionResult {
  tradingAllowed: boolean;
  currentDrawdown: number; // Percentage
  maxDrawdownLimit: number; // Percentage
  recoveryRequired: number; // Amount needed to resume trading
  riskReduction: number; // How much to reduce risk (0-1 multiplier)
  breachedLevel: 'none' | 'warning' | 'soft-stop' | 'hard-stop';
  reasoning: string;
  recommendations: string[];
}

class DrawdownProtectionBreaker {
  private readonly WARNING_DRAWDOWN = 0.05; // 5% drawdown warning
  private readonly SOFT_STOP_DRAWDOWN = 0.10; // 10% triggers risk reduction
  private readonly HARD_STOP_DRAWDOWN = 0.20; // 20% stops all trading
  private readonly RECOVERY_THRESHOLD = 0.05; // Need 5% recovery to resume

  async checkDrawdownProtection(inputs: DrawdownCheckInputs): Promise<DrawdownProtectionResult> {
    const { userId, currentBalance, startingBalance: providedStartingBalance, goalSessionId } = inputs;

    // Get starting balance if not provided
    let startingBalance = providedStartingBalance;
    if (!startingBalance) {
      startingBalance = await this.getStartingBalance(userId, goalSessionId);
    }

    // Calculate drawdown
    const drawdown = (startingBalance - currentBalance) / startingBalance;
    const drawdownPercent = drawdown * 100;

    // Determine breached level
    let breachedLevel: DrawdownProtectionResult['breachedLevel'];
    let tradingAllowed: boolean;
    let riskReduction: number;

    if (drawdown >= this.HARD_STOP_DRAWDOWN) {
      breachedLevel = 'hard-stop';
      tradingAllowed = false;
      riskReduction = 0; // No trading allowed
    } else if (drawdown >= this.SOFT_STOP_DRAWDOWN) {
      breachedLevel = 'soft-stop';
      tradingAllowed = true;
      riskReduction = 0.5; // Reduce risk by 50%
    } else if (drawdown >= this.WARNING_DRAWDOWN) {
      breachedLevel = 'warning';
      tradingAllowed = true;
      riskReduction = 0.75; // Reduce risk by 25%
    } else {
      breachedLevel = 'none';
      tradingAllowed = true;
      riskReduction = 1.0; // No reduction
    }

    // Calculate recovery required
    const recoveryRequired = breachedLevel === 'hard-stop'
      ? startingBalance * this.RECOVERY_THRESHOLD
      : 0;

    // Generate reasoning
    let reasoning = `Current drawdown: ${drawdownPercent.toFixed(2)}%. `;
    reasoning += `Starting balance: $${startingBalance.toFixed(2)}, Current: $${currentBalance.toFixed(2)}. `;

    if (breachedLevel === 'hard-stop') {
      reasoning += `🛑 HARD STOP TRIGGERED: ${(this.HARD_STOP_DRAWDOWN * 100).toFixed(0)}% drawdown limit breached. `;
      reasoning += `Trading is suspended until account recovers by $${recoveryRequired.toFixed(2)}. `;
    } else if (breachedLevel === 'soft-stop') {
      reasoning += `⚠️ SOFT STOP: ${(this.SOFT_STOP_DRAWDOWN * 100).toFixed(0)}% drawdown limit breached. `;
      reasoning += `Risk reduced to ${(riskReduction * 100).toFixed(0)}% of normal. `;
    } else if (breachedLevel === 'warning') {
      reasoning += `⚠️ WARNING: Approaching drawdown limit. Risk reduced to ${(riskReduction * 100).toFixed(0)}%. `;
    } else {
      reasoning += `✅ Within acceptable drawdown limits.`;
    }

    // Generate recommendations
    const recommendations: string[] = [];

    if (breachedLevel === 'hard-stop') {
      recommendations.push('🛑 STOP TRADING IMMEDIATELY');
      recommendations.push('Review all recent trades to identify mistakes');
      recommendations.push('Take a break - emotional recovery is as important as financial');
      recommendations.push('Consider paper trading until confidence is restored');
      recommendations.push(`Need $${recoveryRequired.toFixed(2)} recovery to resume trading`);
    } else if (breachedLevel === 'soft-stop') {
      recommendations.push('⚠️ Reduce position sizes by 50%');
      recommendations.push('Only take A+ setups');
      recommendations.push('Consider taking a day off to reset');
      recommendations.push('Review risk management rules');
      recommendations.push('Focus on preservation, not profit');
    } else if (breachedLevel === 'warning') {
      recommendations.push('⚠️ Tighten risk management');
      recommendations.push('Reduce position sizes by 25%');
      recommendations.push('Be more selective with trades');
      recommendations.push('Avoid revenge trading');
    } else {
      recommendations.push('Continue with standard risk management');
      recommendations.push('Maintain discipline');
    }

    return {
      tradingAllowed,
      currentDrawdown: drawdown,
      maxDrawdownLimit: this.HARD_STOP_DRAWDOWN,
      recoveryRequired,
      riskReduction,
      breachedLevel,
      reasoning,
      recommendations
    };
  }

  private async getStartingBalance(userId: string, goalSessionId?: string): Promise<number> {
    try {
      if (goalSessionId) {
        // Get starting balance from goal session
        const { data: session, error } = await supabase
          .from('goal_sessions')
          .select('starting_balance')
          .eq('id', goalSessionId)
          .single();

        if (!error && session) {
          return session.starting_balance;
        }
      }

      // Fallback: Get from user token balance
      const { data: profile, error } = await supabase
        .from('user_token_balance')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (!error && profile) {
        return profile.balance || 10000; // Default to $10,000
      }

      return 10000; // Ultimate fallback
    } catch (error) {
      console.error('Error fetching starting balance:', error);
      return 10000;
    }
  }

  async logDrawdownCheck(
    userId: string,
    inputs: DrawdownCheckInputs,
    result: DrawdownProtectionResult
  ): Promise<void> {
    try {
      await supabase.from('drawdown_protection_log').insert({
        user_id: userId,
        goal_session_id: inputs.goalSessionId,
        current_balance: inputs.currentBalance,
        starting_balance: inputs.startingBalance,
        current_drawdown: result.currentDrawdown,
        breached_level: result.breachedLevel,
        trading_allowed: result.tradingAllowed,
        risk_reduction: result.riskReduction,
        reasoning: result.reasoning
      });

      // If hard stop triggered, also log a critical event
      if (result.breachedLevel === 'hard-stop') {
        await supabase.from('critical_risk_events').insert({
          user_id: userId,
          goal_session_id: inputs.goalSessionId,
          event_type: 'hard_stop_drawdown',
          severity: 'critical',
          details: {
            drawdown: result.currentDrawdown,
            currentBalance: inputs.currentBalance,
            reasoning: result.reasoning
          }
        });
      }
    } catch (error) {
      console.error('Error logging drawdown check:', error);
    }
  }

  calculateMaxPositionSize(
    basePositionSize: number,
    drawdownResult: DrawdownProtectionResult
  ): number {
    return basePositionSize * drawdownResult.riskReduction;
  }

  async getDailyDrawdownStats(userId: string): Promise<{
    maxDrawdownToday: number;
    tradesStoppedToday: number;
    avgDrawdown7Days: number;
  }> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: logs, error } = await supabase
        .from('drawdown_protection_log')
        .select('current_drawdown, trading_allowed, created_at')
        .eq('user_id', userId)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      if (error || !logs || logs.length === 0) {
        return {
          maxDrawdownToday: 0,
          tradesStoppedToday: 0,
          avgDrawdown7Days: 0
        };
      }

      // Calculate max drawdown today
      const todayLogs = logs.filter(log => new Date(log.created_at) >= today);
      const maxDrawdownToday = todayLogs.length > 0
        ? Math.max(...todayLogs.map(log => log.current_drawdown))
        : 0;

      // Count trades stopped today
      const tradesStoppedToday = todayLogs.filter(log => !log.trading_allowed).length;

      // Calculate 7-day average
      const avgDrawdown7Days = logs.reduce((sum, log) => sum + log.current_drawdown, 0) / logs.length;

      return {
        maxDrawdownToday,
        tradesStoppedToday,
        avgDrawdown7Days
      };
    } catch (error) {
      console.error('Error fetching drawdown stats:', error);
      return {
        maxDrawdownToday: 0,
        tradesStoppedToday: 0,
        avgDrawdown7Days: 0
      };
    }
  }
}

export const drawdownProtectionBreaker = new DrawdownProtectionBreaker();
