import { supabase } from '@/lib/supabase';

/**
 * Adaptive Risk Manager
 *
 * Manages defensive mode activation/deactivation and risk adjustments
 * based on drawdown and consecutive losses.
 *
 * Defensive Mode Triggers:
 * - 2 consecutive losses → Reduce risk by 50%
 * - 10% drawdown → Activate defensive mode
 *
 * Defensive Mode Actions:
 * - Increase minimum confidence threshold to 80%
 * - Filter: Only patterns with Profit Factor > 1.5
 * - Pause trading during volatility spikes
 *
 * Recovery Criteria:
 * - 1 winning trade AND drawdown below 5%
 */

interface RiskState {
  isDefensiveModeActive: boolean;
  riskAdjustmentFactor: number;
  currentDrawdown: number;
  consecutiveLosses: number;
  minConfidenceOverride?: number;
  minProfitFactorFilter?: number;
  volatilityPauseEnabled: boolean;
  activatedAt?: Date;
  activationReason?: string;
}

interface DefensiveModeConfig {
  minConfidenceThreshold: number;
  minProfitFactor: number;
  riskReductionFactor: number;
  pauseOnVolatilitySpike: boolean;
}

interface TradeOutcome {
  outcome: 'win' | 'loss' | 'breakeven';
  pnl: number;
}

class AdaptiveRiskManager {
  // Defensive mode triggers
  private readonly CONSECUTIVE_LOSS_THRESHOLD = 2;
  private readonly DRAWDOWN_THRESHOLD_PERCENT = 10;

  // Defensive mode settings
  private readonly DEFENSIVE_CONFIDENCE_THRESHOLD = 80;
  private readonly DEFENSIVE_PROFIT_FACTOR_MIN = 1.5;
  private readonly DEFENSIVE_RISK_FACTOR = 0.5;

  // Recovery criteria
  private readonly RECOVERY_DRAWDOWN_THRESHOLD = 5;
  private readonly RECOVERY_WIN_COUNT_NEEDED = 1;

  /**
   * Get current risk state for user
   */
  async getRiskState(userId: string): Promise<RiskState> {
    try {
      const { data, error } = await supabase
        .from('ai_risk_state')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        console.error('[Adaptive Risk Manager] Error fetching risk state:', error);
        return this.getDefaultRiskState();
      }

      if (!data) {
        // Initialize risk state for new user
        return await this.initializeRiskState(userId);
      }

      return {
        isDefensiveModeActive: data.is_defensive_mode_active,
        riskAdjustmentFactor: parseFloat(data.risk_adjustment_factor.toString()),
        currentDrawdown: parseFloat(data.current_drawdown_percent.toString()),
        consecutiveLosses: data.consecutive_losses,
        minConfidenceOverride: data.min_confidence_threshold_override
          ? parseFloat(data.min_confidence_threshold_override.toString())
          : undefined,
        minProfitFactorFilter: data.min_profit_factor_filter
          ? parseFloat(data.min_profit_factor_filter.toString())
          : undefined,
        volatilityPauseEnabled: data.volatility_pause_enabled,
        activatedAt: data.defensive_mode_activated_at ? new Date(data.defensive_mode_activated_at) : undefined,
        activationReason: data.defensive_mode_activation_reason || undefined
      };
    } catch (error) {
      console.error('[Adaptive Risk Manager] Exception getting risk state:', error);
      return this.getDefaultRiskState();
    }
  }

  /**
   * Process trade outcome and update risk state
   */
  async processTradeOutcome(
    userId: string,
    tradeOutcome: TradeOutcome,
    currentEquity: number,
    peakEquity: number
  ): Promise<{ riskStateChanged: boolean; defensiveModeActivated: boolean; defensiveModeDeactivated: boolean }> {
    try {
      const riskState = await this.getRiskState(userId);

      // Calculate current drawdown
      const drawdownPercent = peakEquity > 0
        ? ((peakEquity - currentEquity) / peakEquity) * 100
        : 0;

      // Update consecutive losses
      let consecutiveLosses = riskState.consecutiveLosses;
      if (tradeOutcome.outcome === 'loss') {
        consecutiveLosses++;
      } else if (tradeOutcome.outcome === 'win') {
        consecutiveLosses = 0;
      }

      // Update risk state in database
      await this.updateRiskState(userId, {
        currentDrawdown: drawdownPercent,
        consecutiveLosses
      });

      // Check if defensive mode should be activated
      if (!riskState.isDefensiveModeActive) {
        const shouldActivate = await this.shouldActivateDefensiveMode(
          consecutiveLosses,
          drawdownPercent
        );

        if (shouldActivate.activate) {
          await this.activateDefensiveMode(userId, shouldActivate.reason, shouldActivate.trigger, drawdownPercent, consecutiveLosses);
          return { riskStateChanged: true, defensiveModeActivated: true, defensiveModeDeactivated: false };
        }
      }

      // Check if defensive mode should be deactivated
      if (riskState.isDefensiveModeActive) {
        const shouldDeactivate = await this.shouldDeactivateDefensiveMode(
          userId,
          tradeOutcome.outcome,
          drawdownPercent
        );

        if (shouldDeactivate) {
          await this.deactivateDefensiveMode(userId);
          return { riskStateChanged: true, defensiveModeActivated: false, defensiveModeDeactivated: true };
        }
      }

      return { riskStateChanged: false, defensiveModeActivated: false, defensiveModeDeactivated: false };
    } catch (error) {
      console.error('[Adaptive Risk Manager] Error processing trade outcome:', error);
      return { riskStateChanged: false, defensiveModeActivated: false, defensiveModeDeactivated: false };
    }
  }

  /**
   * Check if defensive mode should be activated
   */
  private async shouldActivateDefensiveMode(
    consecutiveLosses: number,
    drawdownPercent: number
  ): Promise<{ activate: boolean; reason: string; trigger: 'drawdown' | 'consecutive_losses' | 'manual' }> {
    // Trigger 1: Consecutive losses
    if (consecutiveLosses >= this.CONSECUTIVE_LOSS_THRESHOLD) {
      return {
        activate: true,
        reason: `${consecutiveLosses} consecutive losses detected. Reducing risk to protect capital.`,
        trigger: 'consecutive_losses'
      };
    }

    // Trigger 2: Drawdown threshold
    if (drawdownPercent >= this.DRAWDOWN_THRESHOLD_PERCENT) {
      return {
        activate: true,
        reason: `Drawdown reached ${drawdownPercent.toFixed(1)}%. Activating defensive mode to limit further losses.`,
        trigger: 'drawdown'
      };
    }

    return { activate: false, reason: '', trigger: 'manual' };
  }

  /**
   * Check if defensive mode should be deactivated
   */
  private async shouldDeactivateDefensiveMode(
    userId: string,
    lastTradeOutcome: 'win' | 'loss' | 'breakeven',
    currentDrawdown: number
  ): Promise<boolean> {
    // Recovery criteria: 1 winning trade AND drawdown below 5%
    if (lastTradeOutcome === 'win' && currentDrawdown < this.RECOVERY_DRAWDOWN_THRESHOLD) {
      console.log(`[Adaptive Risk Manager] ✅ Recovery conditions met: Win trade + drawdown ${currentDrawdown.toFixed(1)}% < 5%`);
      return true;
    }

    return false;
  }

  /**
   * Activate defensive mode
   */
  async activateDefensiveMode(
    userId: string,
    reason: string,
    trigger: 'drawdown' | 'consecutive_losses' | 'manual',
    currentDrawdown: number = 0,
    consecutiveLosses: number = 0
  ): Promise<void> {
    try {
      console.log(`\n[Adaptive Risk Manager] 🛡️ ACTIVATING DEFENSIVE MODE`);
      console.log(`  Reason: ${reason}`);
      console.log(`  Trigger: ${trigger}`);
      console.log(`  Current Drawdown: ${currentDrawdown.toFixed(1)}%`);
      console.log(`  Consecutive Losses: ${consecutiveLosses}`);

      // Call database function to activate
      const { data, error } = await supabase.rpc('activate_defensive_mode', {
        p_user_id: userId,
        p_reason: reason,
        p_trigger_type: trigger,
        p_current_drawdown: currentDrawdown,
        p_consecutive_losses: consecutiveLosses
      });

      if (error) {
        console.error('[Adaptive Risk Manager] Error activating defensive mode:', error);
        return;
      }

      console.log(`[Adaptive Risk Manager] ✅ Defensive mode activated successfully`);
      console.log(`  Risk reduced to: 50%`);
      console.log(`  Min confidence: 80%`);
      console.log(`  Min profit factor: 1.5`);
      console.log(`  Volatility pause: ENABLED`);
    } catch (error) {
      console.error('[Adaptive Risk Manager] Exception activating defensive mode:', error);
    }
  }

  /**
   * Deactivate defensive mode
   */
  async deactivateDefensiveMode(userId: string): Promise<void> {
    try {
      console.log(`\n[Adaptive Risk Manager] ✅ DEACTIVATING DEFENSIVE MODE`);
      console.log(`  Recovery conditions met - returning to normal trading`);

      // Call database function to deactivate
      const { data, error } = await supabase.rpc('deactivate_defensive_mode', {
        p_user_id: userId,
        p_recovery_win_count: this.RECOVERY_WIN_COUNT_NEEDED
      });

      if (error) {
        console.error('[Adaptive Risk Manager] Error deactivating defensive mode:', error);
        return;
      }

      console.log(`[Adaptive Risk Manager] ✅ Defensive mode deactivated successfully`);
      console.log(`  Risk restored to: 100%`);
      console.log(`  Confidence thresholds: Normal`);
      console.log(`  All filters removed`);
    } catch (error) {
      console.error('[Adaptive Risk Manager] Exception deactivating defensive mode:', error);
    }
  }

  /**
   * Get defensive mode configuration
   */
  getDefensiveModeConfig(): DefensiveModeConfig {
    return {
      minConfidenceThreshold: this.DEFENSIVE_CONFIDENCE_THRESHOLD,
      minProfitFactor: this.DEFENSIVE_PROFIT_FACTOR_MIN,
      riskReductionFactor: this.DEFENSIVE_RISK_FACTOR,
      pauseOnVolatilitySpike: true
    };
  }

  /**
   * Calculate adjusted position size based on risk state
   */
  async getAdjustedPositionSize(
    userId: string,
    basePositionSize: number
  ): Promise<number> {
    const riskState = await this.getRiskState(userId);
    return basePositionSize * riskState.riskAdjustmentFactor;
  }

  /**
   * Check if a trade should be taken based on defensive mode filters
   */
  async shouldTakeTrade(
    userId: string,
    tradeSignal: {
      confidence: number;
      patternProfitFactor?: number;
      isVolatilityHigh?: boolean;
    }
  ): Promise<{ shouldTake: boolean; reason?: string }> {
    const riskState = await this.getRiskState(userId);

    if (!riskState.isDefensiveModeActive) {
      return { shouldTake: true };
    }

    // Check confidence threshold
    if (riskState.minConfidenceOverride && tradeSignal.confidence < riskState.minConfidenceOverride) {
      return {
        shouldTake: false,
        reason: `Confidence ${tradeSignal.confidence}% below defensive mode threshold ${riskState.minConfidenceOverride}%`
      };
    }

    // Check profit factor filter
    if (riskState.minProfitFactorFilter && tradeSignal.patternProfitFactor) {
      if (tradeSignal.patternProfitFactor < riskState.minProfitFactorFilter) {
        return {
          shouldTake: false,
          reason: `Pattern profit factor ${tradeSignal.patternProfitFactor.toFixed(2)} below defensive mode minimum ${riskState.minProfitFactorFilter}`
        };
      }
    }

    // Check volatility pause
    if (riskState.volatilityPauseEnabled && tradeSignal.isVolatilityHigh) {
      return {
        shouldTake: false,
        reason: 'High volatility detected - defensive mode pausing trades'
      };
    }

    return { shouldTake: true };
  }

  /**
   * Get defensive mode statistics
   */
  async getDefensiveModeStats(userId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('ai_risk_state')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      let durationMinutes = 0;
      if (data.is_defensive_mode_active && data.defensive_mode_activated_at) {
        const now = new Date();
        const activatedAt = new Date(data.defensive_mode_activated_at);
        durationMinutes = Math.floor((now.getTime() - activatedAt.getTime()) / 60000);
      } else if (data.defensive_mode_duration_minutes) {
        durationMinutes = data.defensive_mode_duration_minutes;
      }

      return {
        isActive: data.is_defensive_mode_active,
        activatedAt: data.defensive_mode_activated_at,
        deactivatedAt: data.defensive_mode_deactivated_at,
        durationMinutes,
        tradesD uringDefensiveMode: data.trades_during_defensive_mode,
        activationReason: data.defensive_mode_activation_reason,
        triggerType: data.defensive_mode_trigger_type,
        currentDrawdown: parseFloat(data.current_drawdown_percent.toString()),
        consecutiveLosses: data.consecutive_losses,
        recoveryWinCount: data.recovery_win_count
      };
    } catch (error) {
      console.error('[Adaptive Risk Manager] Error getting defensive mode stats:', error);
      return null;
    }
  }

  /**
   * Manual activation of defensive mode (for testing or user override)
   */
  async manualActivateDefensiveMode(userId: string, reason: string): Promise<void> {
    await this.activateDefensiveMode(userId, reason, 'manual', 0, 0);
  }

  /**
   * Manual deactivation of defensive mode (for testing or user override)
   */
  async manualDeactivateDefensiveMode(userId: string): Promise<void> {
    await this.deactivateDefensiveMode(userId);
  }

  /**
   * Initialize risk state for new user
   */
  private async initializeRiskState(userId: string): Promise<RiskState> {
    const defaultState = this.getDefaultRiskState();

    try {
      const { error } = await supabase
        .from('ai_risk_state')
        .insert({
          user_id: userId,
          is_defensive_mode_active: false,
          risk_adjustment_factor: 1.0,
          current_drawdown_percent: 0,
          consecutive_losses: 0,
          volatility_pause_enabled: false
        });

      if (error) {
        console.error('[Adaptive Risk Manager] Error initializing risk state:', error);
      }
    } catch (error) {
      console.error('[Adaptive Risk Manager] Exception initializing risk state:', error);
    }

    return defaultState;
  }

  /**
   * Update risk state fields
   */
  private async updateRiskState(
    userId: string,
    updates: {
      currentDrawdown?: number;
      consecutiveLosses?: number;
    }
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_risk_state')
        .update({
          current_drawdown_percent: updates.currentDrawdown,
          consecutive_losses: updates.consecutiveLosses,
          last_updated: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) {
        console.error('[Adaptive Risk Manager] Error updating risk state:', error);
      }
    } catch (error) {
      console.error('[Adaptive Risk Manager] Exception updating risk state:', error);
    }
  }

  /**
   * Get default risk state
   */
  private getDefaultRiskState(): RiskState {
    return {
      isDefensiveModeActive: false,
      riskAdjustmentFactor: 1.0,
      currentDrawdown: 0,
      consecutiveLosses: 0,
      volatilityPauseEnabled: false
    };
  }

  /**
   * Increment trades during defensive mode counter
   */
  async incrementDefensiveModeTradeCount(userId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('increment_defensive_mode_trades', {
        p_user_id: userId
      });

      if (error) {
        // If function doesn't exist, do it manually
        await supabase
          .from('ai_risk_state')
          .update({
            trades_during_defensive_mode: supabase.rpc('coalesce', {
              value: supabase.rpc('trades_during_defensive_mode'),
              default_value: 0
            }) + 1
          })
          .eq('user_id', userId)
          .eq('is_defensive_mode_active', true);
      }
    } catch (error) {
      console.error('[Adaptive Risk Manager] Error incrementing defensive mode trade count:', error);
    }
  }
}

export const adaptiveRiskManager = new AdaptiveRiskManager();
export type { RiskState, DefensiveModeConfig, TradeOutcome };
