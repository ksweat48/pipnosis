import { GOAL_FEASIBILITY_CONFIG } from '../config/goal-feasibility-config';
import {
  MeaningfulnessChecks,
  MeaningfulTradeThresholds,
} from '../types/goal-feasibility';
import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export class MeaningfulTradeCalculator {
  static async calculateThresholds(params: {
    accountBalance: number;
    dailyATR: number;
    spreadCost: number;
    userId: string;
  }): Promise<MeaningfulTradeThresholds> {
    const { accountBalance, dailyATR, spreadCost, userId } = params;

    const volatilityFloorValue =
      dailyATR *
      accountBalance *
      GOAL_FEASIBILITY_CONFIG.meaningfulTrade.volatilityFloorPercent;

    const accountFloorValue =
      accountBalance *
      GOAL_FEASIBILITY_CONFIG.meaningfulTrade.accountFloorPercent;

    const spreadFloorValue =
      spreadCost * GOAL_FEASIBILITY_CONFIG.meaningfulTrade.spreadMultiplierMin;

    const historicalFloorValue = await this.calculateHistoricalFloor(userId);

    return {
      volatilityFloorValue,
      accountFloorValue,
      spreadFloorValue,
      historicalFloorValue,
    };
  }

  static async calculateHistoricalFloor(userId: string): Promise<number> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: recentWins, error } = await supabase
        .from('goal_trades')
        .select('profit')
        .eq('user_id', userId)
        .gt('profit', 0)
        .gte('closed_at', thirtyDaysAgo.toISOString())
        .order('closed_at', { ascending: false })
        .limit(20);

      if (error || !recentWins || recentWins.length === 0) {
        logger.debug(
          'No recent wins found for historical floor calculation',
          { userId }
        );
        return 0;
      }

      const avgProfit =
        recentWins.reduce((sum, trade) => sum + (trade.profit || 0), 0) /
        recentWins.length;

      const historicalFloor =
        avgProfit *
        GOAL_FEASIBILITY_CONFIG.meaningfulTrade.historicalFloorPercent;

      logger.info('Historical floor calculated', {
        userId,
        avgProfit,
        historicalFloor,
        sampleSize: recentWins.length,
      });

      return historicalFloor;
    } catch (error) {
      logger.error('Error calculating historical floor', { error, userId });
      return 0;
    }
  }

  static checkMeaningfulness(
    expectedProfit: number,
    thresholds: MeaningfulTradeThresholds,
    nearGoalCompletion: boolean = false
  ): MeaningfulnessChecks {
    let meetsVolatilityFloor = expectedProfit >= thresholds.volatilityFloorValue;
    let meetsAccountFloor = expectedProfit >= thresholds.accountFloorValue;
    let meetsSpreadFloor = expectedProfit >= thresholds.spreadFloorValue;
    let meetsHistoricalFloor =
      thresholds.historicalFloorValue === 0 ||
      expectedProfit >= thresholds.historicalFloorValue;

    if (
      nearGoalCompletion &&
      GOAL_FEASIBILITY_CONFIG.downshift.specialCases
        .relaxFloorsWhenNearCompletion
    ) {
      meetsAccountFloor = true;
      meetsHistoricalFloor = true;

      logger.debug('Relaxing floors due to near goal completion', {
        expectedProfit,
      });
    }

    const anyMet =
      meetsVolatilityFloor ||
      meetsAccountFloor ||
      meetsSpreadFloor ||
      meetsHistoricalFloor;

    return {
      meetsVolatilityFloor,
      meetsAccountFloor,
      meetsSpreadFloor,
      meetsHistoricalFloor,
      anyMet,
    };
  }

  static explainMeaningfulness(
    checks: MeaningfulnessChecks,
    expectedProfit: number,
    thresholds: MeaningfulTradeThresholds
  ): string {
    const passed: string[] = [];
    const failed: string[] = [];

    if (checks.meetsVolatilityFloor) {
      passed.push(
        `Volatility floor (${thresholds.volatilityFloorValue.toFixed(2)})`
      );
    } else {
      failed.push(
        `Volatility floor (need ${thresholds.volatilityFloorValue.toFixed(2)}, have ${expectedProfit.toFixed(2)})`
      );
    }

    if (checks.meetsAccountFloor) {
      passed.push(
        `Account floor (${thresholds.accountFloorValue.toFixed(2)})`
      );
    } else {
      failed.push(
        `Account floor (need ${thresholds.accountFloorValue.toFixed(2)}, have ${expectedProfit.toFixed(2)})`
      );
    }

    if (checks.meetsSpreadFloor) {
      passed.push(`Spread floor (${thresholds.spreadFloorValue.toFixed(2)})`);
    } else {
      failed.push(
        `Spread floor (need ${thresholds.spreadFloorValue.toFixed(2)}, have ${expectedProfit.toFixed(2)})`
      );
    }

    if (checks.meetsHistoricalFloor) {
      if (thresholds.historicalFloorValue > 0) {
        passed.push(
          `Historical floor (${thresholds.historicalFloorValue.toFixed(2)})`
        );
      }
    } else {
      failed.push(
        `Historical floor (need ${thresholds.historicalFloorValue.toFixed(2)}, have ${expectedProfit.toFixed(2)})`
      );
    }

    let explanation = '';

    if (passed.length > 0) {
      explanation += `Passes: ${passed.join(', ')}. `;
    }

    if (failed.length > 0) {
      explanation += `Fails: ${failed.join(', ')}.`;
    }

    return explanation.trim();
  }

  static determineSessionLiquidity(hour: number): 'high' | 'medium' | 'low' {
    if (hour >= 13 && hour < 17) return 'high';

    if ((hour >= 8 && hour < 13) || (hour >= 17 && hour < 22)) return 'medium';

    return 'low';
  }
}
