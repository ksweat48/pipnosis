/**
 * Position Safety Validator
 *
 * CRITICAL HARD LIMITS TO PROTECT ACCOUNT FROM:
 * - LLM hallucinations (decides to risk 47% on one trade)
 * - System bugs (JPY error that turned 2% into 100%)
 * - Calculation errors (formula breaks, returns wrong value)
 *
 * These are NON-NEGOTIABLE safety guards, separate from LLM decision-making.
 */

export interface PositionSafetyResult {
  isValid: boolean;
  violations: string[];
  safetyAdjustments: string[];
  adjustedPositionSize?: number;
  adjustedRiskPercent?: number;
  originalRiskPercent: number;
  finalRiskPercent: number;
}

export interface PositionSafetyConfig {
  // HARD LIMITS (Account Protection)
  MAX_RISK_PER_TRADE: number;    // 5% default
  MIN_RISK_PER_TRADE: number;    // 1% default
  MAX_TOTAL_EXPOSURE: number;    // 8% default
}

export const DEFAULT_SAFETY_CONFIG: PositionSafetyConfig = {
  MAX_RISK_PER_TRADE: 5.0,
  MIN_RISK_PER_TRADE: 1.0,
  MAX_TOTAL_EXPOSURE: 8.0
};

class PositionSafetyValidator {
  private config: PositionSafetyConfig;

  constructor(config: PositionSafetyConfig = DEFAULT_SAFETY_CONFIG) {
    this.config = config;
  }

  /**
   * Validate position size against all safety rules
   * Returns adjusted position size if needed
   */
  validatePosition(
    positionSize: number,
    entryPrice: number,
    stopLoss: number,
    accountBalance: number,
    currentOpenTradesRisk: number[], // Array of risk % for each open trade
    symbol: string,
    pipValue: number,
    valuePerLotPerPoint: number
  ): PositionSafetyResult {
    const violations: string[] = [];
    const safetyAdjustments: string[] = [];
    let adjustedSize = positionSize;

    // Calculate original risk
    const stopDistance = Math.abs(entryPrice - stopLoss);
    const pointsRisked = stopDistance / pipValue;
    const originalRiskAmount = pointsRisked * valuePerLotPerPoint * positionSize;
    const originalRiskPercent = (originalRiskAmount / accountBalance) * 100;

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('POSITION SAFETY VALIDATION');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`Symbol: ${symbol}`);
    console.log(`Account Balance: $${accountBalance.toFixed(2)}`);
    console.log(`Position Size: ${positionSize.toFixed(3)} lots`);
    console.log(`Entry: ${entryPrice.toFixed(5)} | SL: ${stopLoss.toFixed(5)}`);
    console.log(`Stop Distance: ${pointsRisked.toFixed(1)} pips`);
    console.log(`Original Risk: $${originalRiskAmount.toFixed(2)} (${originalRiskPercent.toFixed(2)}%)`);

    // VALIDATION 1: Technical validity (must be finite, positive number)
    if (!isFinite(positionSize) || isNaN(positionSize) || positionSize <= 0) {
      violations.push(`🚨 CRITICAL: Invalid position size: ${positionSize}`);
      console.error(`❌ VALIDATION 1 FAILED: Position size is not a valid number`);
      return {
        isValid: false,
        violations,
        safetyAdjustments,
        originalRiskPercent,
        finalRiskPercent: 0,
        adjustedPositionSize: 0.01
      };
    }

    console.log(`✅ VALIDATION 1 PASSED: Position size is valid number`);

    // VALIDATION 2: Max risk per trade (5% default)
    if (originalRiskPercent > this.config.MAX_RISK_PER_TRADE) {
      violations.push(
        `🚨 SAFETY: Risk ${originalRiskPercent.toFixed(2)}% > ${this.config.MAX_RISK_PER_TRADE}% max`
      );

      // Calculate adjusted size for exactly max risk
      const maxRiskAmount = accountBalance * (this.config.MAX_RISK_PER_TRADE / 100);
      adjustedSize = maxRiskAmount / (pointsRisked * valuePerLotPerPoint);

      safetyAdjustments.push(
        `Position clamped: ${positionSize.toFixed(3)} lots → ${adjustedSize.toFixed(3)} lots (${this.config.MAX_RISK_PER_TRADE}% risk)`
      );

      console.error(`❌ VALIDATION 2 FAILED: Risk exceeds ${this.config.MAX_RISK_PER_TRADE}% maximum`);
      console.warn(`🛡️  SAFETY ADJUSTMENT: Reducing position size to ${adjustedSize.toFixed(3)} lots`);
    } else {
      console.log(`✅ VALIDATION 2 PASSED: Risk within ${this.config.MAX_RISK_PER_TRADE}% limit`);
    }

    // VALIDATION 3: Min risk per trade (1% default)
    const currentRiskPercent = (pointsRisked * valuePerLotPerPoint * adjustedSize / accountBalance) * 100;

    if (currentRiskPercent < this.config.MIN_RISK_PER_TRADE) {
      violations.push(
        `⚠️  Risk ${currentRiskPercent.toFixed(2)}% < ${this.config.MIN_RISK_PER_TRADE}% min`
      );

      // Calculate adjusted size for exactly min risk
      const minRiskAmount = accountBalance * (this.config.MIN_RISK_PER_TRADE / 100);
      adjustedSize = minRiskAmount / (pointsRisked * valuePerLotPerPoint);

      safetyAdjustments.push(
        `Position increased: ${positionSize.toFixed(3)} lots → ${adjustedSize.toFixed(3)} lots (${this.config.MIN_RISK_PER_TRADE}% risk)`
      );

      console.warn(`⚠️  VALIDATION 3 FAILED: Risk below ${this.config.MIN_RISK_PER_TRADE}% minimum`);
      console.warn(`🛡️  SAFETY ADJUSTMENT: Increasing position size to ${adjustedSize.toFixed(3)} lots`);
    } else {
      console.log(`✅ VALIDATION 3 PASSED: Risk above ${this.config.MIN_RISK_PER_TRADE}% minimum`);
    }

    // VALIDATION 4: Total exposure check (8% default)
    const currentTotalExposure = currentOpenTradesRisk.reduce((sum, r) => sum + r, 0);
    const finalRiskPercent = (pointsRisked * valuePerLotPerPoint * adjustedSize / accountBalance) * 100;
    const newTotalExposure = currentTotalExposure + finalRiskPercent;

    console.log(`Current Total Exposure: ${currentTotalExposure.toFixed(2)}% (${currentOpenTradesRisk.length} open trades)`);
    console.log(`New Trade Risk: ${finalRiskPercent.toFixed(2)}%`);
    console.log(`Total Exposure After: ${newTotalExposure.toFixed(2)}%`);

    if (newTotalExposure > this.config.MAX_TOTAL_EXPOSURE) {
      violations.push(
        `🚨 EXPOSURE: Total ${newTotalExposure.toFixed(2)}% > ${this.config.MAX_TOTAL_EXPOSURE}% max`
      );

      console.error(`❌ VALIDATION 4 FAILED: Total exposure exceeds ${this.config.MAX_TOTAL_EXPOSURE}% limit`);
      console.error(`🚫 TRADE REJECTED: Cannot accept more risk`);

      return {
        isValid: false,
        violations,
        safetyAdjustments,
        originalRiskPercent,
        finalRiskPercent: 0,
        adjustedPositionSize: 0
      };
    } else {
      console.log(`✅ VALIDATION 4 PASSED: Total exposure within ${this.config.MAX_TOTAL_EXPOSURE}% limit`);
    }

    // Final summary
    console.log('\n═══════════════════════════════════════════════════════');
    if (violations.length === 0) {
      console.log('✅ ALL VALIDATIONS PASSED');
    } else {
      console.log(`⚠️  ${violations.length} VALIDATION(S) FAILED - ADJUSTMENTS APPLIED`);
      violations.forEach(v => console.log(`   ${v}`));
    }
    console.log(`Final Position Size: ${adjustedSize.toFixed(3)} lots`);
    console.log(`Final Risk: $${(finalRiskPercent * accountBalance / 100).toFixed(2)} (${finalRiskPercent.toFixed(2)}%)`);
    console.log('═══════════════════════════════════════════════════════\n');

    return {
      isValid: true,
      violations,
      safetyAdjustments,
      originalRiskPercent,
      finalRiskPercent,
      adjustedPositionSize: adjustedSize !== positionSize ? adjustedSize : undefined
    };
  }

  /**
   * Quick validation for LLM-requested risk percent (before position calculation)
   */
  validateRiskPercent(
    requestedRiskPercent: number,
    currentTotalExposure: number
  ): { isValid: boolean; adjustedRiskPercent: number; reason?: string } {
    let adjusted = requestedRiskPercent;
    let reason: string | undefined;

    // Clamp to 1-5% range
    if (requestedRiskPercent > this.config.MAX_RISK_PER_TRADE) {
      adjusted = this.config.MAX_RISK_PER_TRADE;
      reason = `Clamped from ${requestedRiskPercent.toFixed(2)}% to ${this.config.MAX_RISK_PER_TRADE}% max`;
    } else if (requestedRiskPercent < this.config.MIN_RISK_PER_TRADE) {
      adjusted = this.config.MIN_RISK_PER_TRADE;
      reason = `Raised from ${requestedRiskPercent.toFixed(2)}% to ${this.config.MIN_RISK_PER_TRADE}% min`;
    }

    // Check total exposure
    if (currentTotalExposure + adjusted > this.config.MAX_TOTAL_EXPOSURE) {
      const maxAllowable = this.config.MAX_TOTAL_EXPOSURE - currentTotalExposure;
      if (maxAllowable < this.config.MIN_RISK_PER_TRADE) {
        return {
          isValid: false,
          adjustedRiskPercent: 0,
          reason: `Cannot accept trade: Would exceed ${this.config.MAX_TOTAL_EXPOSURE}% total exposure limit`
        };
      }
      adjusted = maxAllowable;
      reason = `Reduced to ${adjusted.toFixed(2)}% to stay within ${this.config.MAX_TOTAL_EXPOSURE}% total exposure`;
    }

    return {
      isValid: true,
      adjustedRiskPercent: adjusted,
      reason
    };
  }

  /**
   * Log safety violation (for monitoring and debugging)
   */
  logSafetyViolation(
    context: string,
    violation: string,
    adjustment: string,
    originalValue: number,
    adjustedValue: number
  ): void {
    console.error('\n🚨 SAFETY VIOLATION DETECTED 🚨');
    console.error(`Context: ${context}`);
    console.error(`Violation: ${violation}`);
    console.error(`Adjustment: ${adjustment}`);
    console.error(`Original: ${originalValue.toFixed(3)}`);
    console.error(`Adjusted: ${adjustedValue.toFixed(3)}`);
    console.error('═══════════════════════════════════════════════════════\n');
  }
}

export const positionSafetyValidator = new PositionSafetyValidator();
