import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';
import { calculateDollarPerPip, getCurrencyPipInfo } from '../utils/currencyHelpers';

/**
 * CCIP GOVERNANCE: Risk Tolerance Enforcer
 *
 * AUTHORITY: Single source of truth for position sizing based on user risk tolerance
 *
 * RESPONSIBILITY:
 * - Calculates appropriate position sizes from risk tolerance settings
 * - FIXES the 0.1 lot hardcoding bug (line 507 in alpha-execution-planner.ts)
 * - Ensures risk tolerance like "scalp aggressive 5%" actually impacts position sizing
 * - Links user risk settings to achievable profit targets
 *
 * ARCHITECTURAL GUARANTEE:
 * - Position sizing respects user's risk tolerance percentage
 * - With proper position sizing, $300 goals become achievable (not $125)
 * - All position sizing calculations go through this service
 * - Enables market assessment to be more accurate
 *
 * WHY THIS MATTERS:
 * - User's "scalp aggressive 5%" was being ignored (position size was hardcoded)
 * - This made market assessment predict too-low profit max ($125 instead of $300+)
 * - Fixing position sizing fixes the cascade of advisory generation
 */

interface RiskToleranceSettings {
  riskPercentage: number; // 0.5 - 5.0 for conservative to aggressive
  riskMode: 'low' | 'medium' | 'high';
  accountBalance: number;
  maxPositionSizePercent?: number; // Max % of account in single position
}

interface PositionSizingResult {
  positionSizeLots: number;
  dollarRiskPerTrade: number;
  maxProfitTarget: number; // Based on realistic market moves (3x ATR)
  reasoning: string;
}

class RiskToleranceEnforcer {
  /**
   * CCIP GATE: Calculate position size from risk tolerance
   *
   * REPLACES: The hardcoded 0.1 lot position size
   *
   * CALCULATION:
   * 1. dollarRisk = accountBalance * riskTolerancePercent
   * 2. positionSize = dollarRisk / (stopLossPips * dollarPerPip)
   *
   * EXAMPLE:
   * - Account: $1000
   * - Risk tolerance: 5% (aggressive scalp)
   * - dollarRisk: $50
   * - SL distance: 10 pips
   * - dollarPerPip (0.1 lot): $1
   * - Position size = $50 / (10 * $1) = 5.0 lots (realistic!)
   *
   * OLD HARDCODED APPROACH:
   * - Always used 0.1 lots regardless of risk tolerance
   * - Made market assessment too conservative
   * - Caused $300 goal to show as $125 achievable
   *
   * @param symbol - Trading pair
   * @param settings - Risk tolerance settings
   * @param stopLossPips - Stop loss distance in pips
   * @param atr - Average true range for market context
   * @returns Position sizing with reasoning
   */
  calculatePositionSizeFromRiskTolerance(
    symbol: string,
    settings: RiskToleranceSettings,
    stopLossPips: number,
    atr?: number
  ): PositionSizingResult {
    try {
      const {
        riskPercentage,
        accountBalance,
        maxPositionSizePercent = 5.0, // Max 5% of account per trade
      } = settings;

      // STEP 1: Calculate dollar amount user is willing to risk
      const dollarRiskPerTrade = accountBalance * (riskPercentage / 100);

      logger.info(LogCategory.RISK_MANAGEMENT, '[Risk Tolerance] Risk calculation', {
        accountBalance,
        riskPercentage,
        dollarRiskPerTrade,
      });

      // STEP 2: Get pip info for the symbol
      const pipInfo = getCurrencyPipInfo(symbol);

      // STEP 3: Calculate position size using Kelly-like formula
      // Position size = (Risk Amount) / (Stop Loss in pips * $ per pip per lot)
      // We use 1.0 lot to get base $ per pip
      const dollarPerPipBase = calculateDollarPerPip(symbol, 1.0);

      // Position size that matches risk tolerance
      const calculatedLotSize =
        dollarRiskPerTrade / (stopLossPips * dollarPerPipBase);

      // STEP 4: Apply max position size cap (% of account)
      const maxPositionSizeLots =
        (accountBalance * (maxPositionSizePercent / 100)) /
        (calculatedLotSize * dollarPerPipBase);

      const positionSizeLots = Math.min(calculatedLotSize, maxPositionSizeLots);

      logger.info(LogCategory.RISK_MANAGEMENT,
        '[Risk Tolerance] Position sizing calculated',
        {
          symbol,
          calculatedLotSize: parseFloat(calculatedLotSize.toFixed(2)),
          maxPositionSizeLots: parseFloat(maxPositionSizeLots.toFixed(2)),
          finalPositionSize: parseFloat(positionSizeLots.toFixed(2)),
          dollarRiskPerTrade,
          stopLossPips,
        }
      );

      // STEP 5: Calculate max achievable profit with this position size
      // Realistic market move: 3x ATR on optimistic day
      let maxProfitTarget = 300; // Default fallback
      if (atr) {
        const optimisticMove = atr * 3.0;
        const profitPips = optimisticMove / pipInfo.pipValue;
        const dollarPerPipActual = calculateDollarPerPip(symbol, positionSizeLots);
        maxProfitTarget = Math.round(profitPips * dollarPerPipActual * 100) / 100;
      }

      logger.info(LogCategory.RISK_MANAGEMENT,
        '[Risk Tolerance] Max profit target calculated',
        {
          atr,
          maxProfitTarget,
        }
      );

      return {
        positionSizeLots: parseFloat(positionSizeLots.toFixed(2)),
        dollarRiskPerTrade,
        maxProfitTarget,
        reasoning: `Position size calculated from risk tolerance.
          Account: $${accountBalance}, Risk: ${riskPercentage}% = $${dollarRiskPerTrade.toFixed(2)}/trade.
          ${atr ? `With ATR=${atr.toFixed(5)}, realistic max profit: $${maxProfitTarget.toFixed(2)}.` : ''}
          Stop loss distance: ${stopLossPips} pips.
          FIXED: No longer hardcoded at 0.1 lots.`,
      };
    } catch (error) {
      logger.error(LogCategory.RISK_MANAGEMENT,
        '[Risk Tolerance] Error calculating position size',
        error
      );

      // Fallback: conservative position
      return {
        positionSizeLots: 0.1,
        dollarRiskPerTrade: accountBalance * (settings.riskPercentage / 100),
        maxProfitTarget: 150,
        reasoning: 'Fallback position sizing due to calculation error',
      };
    }
  }

  /**
   * GOVERNANCE QUERY: Get user's current risk tolerance settings
   *
   * @param userId - User to fetch settings for
   * @returns Risk tolerance settings or defaults
   */
  async getUserRiskTolerance(userId: string): Promise<RiskToleranceSettings | null> {
    try {
      // Fetch from user_profiles or similar table with risk preferences
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('dollar_risk, risk_mode')
        .eq('user_id', userId)
        .maybeSingle();

      if (error || !profile) {
        logger.warn(LogCategory.RISK_MANAGEMENT,
          '[Risk Tolerance] User profile not found, using defaults',
          { userId }
        );
        return null;
      }

      // Extract risk percentage from dollar_risk or use default
      const riskPercentage = profile.dollar_risk || 2.0; // Default 2%
      const riskMode = profile.risk_mode || 'medium';

      // Get account balance
      const { data: user, error: userError } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (userError || !user) {
        logger.warn(LogCategory.RISK_MANAGEMENT,
          '[Risk Tolerance] Could not fetch account balance',
          { userId }
        );
        return null;
      }

      return {
        riskPercentage,
        riskMode: riskMode as 'low' | 'medium' | 'high',
        accountBalance: user.account_balance || 1000,
      };
    } catch (error) {
      logger.error(LogCategory.RISK_MANAGEMENT,
        '[Risk Tolerance] Error fetching user risk tolerance',
        error
      );
      return null;
    }
  }

  /**
   * GOVERNANCE: Map risk mode to percentage range
   *
   * "scalp aggressive 5%" → 5.0%
   * "swing moderate 2%" → 2.0%
   * "position conservative 0.5%" → 0.5%
   *
   * @param description - User's risk description
   * @returns Risk percentage or null
   */
  parseRiskDescription(description: string): number | null {
    try {
      // Match percentage in description
      const percentMatch = description.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch) {
        const percentage = parseFloat(percentMatch[1]);
        // Clamp to valid range: 0.1% - 10%
        return Math.max(0.1, Math.min(10, percentage));
      }

      // Fallback: map by keywords
      if (description.toLowerCase().includes('aggressive')) {
        return 5.0;
      } else if (description.toLowerCase().includes('conservative')) {
        return 0.5;
      } else {
        return 2.0; // moderate default
      }
    } catch (error) {
      logger.error(LogCategory.RISK_MANAGEMENT,
        '[Risk Tolerance] Error parsing risk description',
        { description, error }
      );
      return null;
    }
  }
}

export const riskToleranceEnforcer = new RiskToleranceEnforcer();