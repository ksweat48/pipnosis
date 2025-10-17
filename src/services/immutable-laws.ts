export interface Strategy {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high';
  symbol: string;
  action: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  estimatedGain: number;
  riskRewardRatio: number;
  feasible: boolean;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface ValidationResult {
  valid: boolean;
  violations: string[];
  warnings: string[];
}

export interface TradingContext {
  accountBalance: number;
  activeTrades: number;
  totalPnL: number;
  currentDrawdown: number;
  tradesInSession: number;
  lastStopLossSymbol?: string;
  marketHour: number;
}

export class ImmutableLawsValidator {
  private static LAWS = {
    LAW_1: 'Capital Preservation - Never risk more than 2-4% of account balance per trade',
    LAW_2: 'Risk-Reward Ratio - Minimum 1:1 RRR, target 2:1 or better',
    LAW_3: 'Drawdown Management - Maximum 15% account drawdown before stopping',
    LAW_4: 'Continuous Learning - Execute all high-probability setups for maximum learning',
    LAW_5: 'AI Final Decision - AI has ultimate authority on trade execution',
    LAW_6: 'Quality Over Quantity - Only high-probability setups with multiple confirmations',
    LAW_7: 'No Revenge Trading - No re-entry after stop loss without new analysis',
    LAW_8: 'Market Hours - Only trade during active market sessions',
    LAW_9: 'Stop Loss Mandatory - Every trade must have a stop loss',
    LAW_10: 'Take Profit Strategy - Define clear profit targets before entry'
  };

  static validateStrategy(strategy: Strategy, context: TradingContext): ValidationResult {
    const violations: string[] = [];
    const warnings: string[] = [];

    this.validateLaw1(strategy, context, violations, warnings);
    this.validateLaw2(strategy, violations, warnings);
    this.validateLaw3(context, violations, warnings);
    this.validateLaw4(context, violations, warnings);
    this.validateLaw7(strategy, context, violations, warnings);
    this.validateLaw8(context, warnings);
    this.validateLaw9(strategy, violations);
    this.validateLaw10(strategy, violations);

    return {
      valid: violations.length === 0,
      violations,
      warnings
    };
  }

  private static validateLaw1(
    strategy: Strategy,
    context: TradingContext,
    violations: string[],
    warnings: string[]
  ): void {
    const pipValue = this.calculatePipValue(strategy.symbol, strategy.lotSize);
    const pipsAtRisk = Math.abs(strategy.entry - strategy.stopLoss);
    const dollarRisk = pipsAtRisk * pipValue;
    const riskPercent = (dollarRisk / context.accountBalance) * 100;

    if (riskPercent > 4) {
      violations.push(`Law #1 Violation: Risk ${riskPercent.toFixed(2)}% exceeds 4% maximum`);
    } else if (riskPercent < 1) {
      warnings.push(`Law #1 Warning: Risk ${riskPercent.toFixed(2)}% is below 1%, consider increasing position size`);
    }
  }

  private static validateLaw2(
    strategy: Strategy,
    violations: string[],
    warnings: string[]
  ): void {
    if (!strategy.riskRewardRatio || strategy.riskRewardRatio < 1) {
      violations.push(`Law #2 Violation: RRR ${strategy.riskRewardRatio?.toFixed(2) || '0.00'} is below minimum 1:1`);
    } else if (strategy.riskRewardRatio < 1.5) {
      warnings.push(`Law #2 Warning: RRR ${strategy.riskRewardRatio.toFixed(2)} is acceptable but below target 2:1`);
    }
  }

  private static validateLaw3(
    context: TradingContext,
    violations: string[],
    warnings: string[]
  ): void {
    if (context.currentDrawdown > 15) {
      violations.push(`Law #3 Violation: Current drawdown ${context.currentDrawdown.toFixed(2)}% exceeds 15% maximum - Trading must stop`);
    } else if (context.currentDrawdown > 10) {
      warnings.push(`Law #3 Warning: Drawdown ${context.currentDrawdown.toFixed(2)}% is approaching 15% limit`);
    }
  }

  private static validateLaw4(
    context: TradingContext,
    violations: string[],
    warnings: string[]
  ): void {
    // Law #4: Continuous Learning - No trade limits, execute all high-probability setups
    // This validation is now a no-op but kept for consistency
  }

  private static validateLaw7(
    strategy: Strategy,
    context: TradingContext,
    violations: string[],
    warnings: string[]
  ): void {
    if (context.lastStopLossSymbol === strategy.symbol) {
      violations.push(`Law #7 Violation: Cannot re-enter ${strategy.symbol} after stop loss without new comprehensive analysis`);
    }
  }

  private static validateLaw8(
    context: TradingContext,
    warnings: string[]
  ): void {
    const hour = context.marketHour;

    const isLondonOpen = hour >= 8 && hour < 16;
    const isNewYorkOpen = hour >= 13 && hour < 21;
    const isTokyoOpen = hour >= 0 && hour < 8;
    const isActiveSession = isLondonOpen || isNewYorkOpen || isTokyoOpen;

    if (!isActiveSession) {
      warnings.push(`Law #8 Warning: Trading outside major market sessions (current hour: ${hour}:00 UTC) - Lower liquidity expected`);
    }
  }

  private static validateLaw9(
    strategy: Strategy,
    violations: string[]
  ): void {
    if (!strategy.stopLoss || strategy.stopLoss === 0) {
      violations.push(`Law #9 Violation: Stop Loss is mandatory for all trades`);
    }
  }

  private static validateLaw10(
    strategy: Strategy,
    violations: string[]
  ): void {
    if (!strategy.takeProfit || strategy.takeProfit === 0) {
      violations.push(`Law #10 Violation: Take Profit target must be defined before entry`);
    }
  }

  private static calculatePipValue(symbol: string, lotSize: number): number {
    const isJPY = symbol.includes('JPY');
    const isGold = symbol.includes('XAU');

    if (isGold) {
      return lotSize * 100;
    } else if (isJPY) {
      return lotSize * 1000 * 0.01;
    } else {
      return lotSize * 100000 * 0.0001;
    }
  }

  static calculateRiskRewardRatio(entry: number, stopLoss: number, takeProfit: number, action: 'buy' | 'sell'): number {
    if (action === 'buy') {
      const risk = Math.abs(entry - stopLoss);
      const reward = Math.abs(takeProfit - entry);
      return reward / risk;
    } else {
      const risk = Math.abs(stopLoss - entry);
      const reward = Math.abs(entry - takeProfit);
      return reward / risk;
    }
  }

  static calculateLotSize(
    accountBalance: number,
    riskPercent: number,
    entry: number,
    stopLoss: number,
    symbol: string
  ): number {
    const riskAmount = accountBalance * (riskPercent / 100);
    const pipsAtRisk = Math.abs(entry - stopLoss);

    const isJPY = symbol.includes('JPY');
    const isGold = symbol.includes('XAU');

    let pipValue: number;
    if (isGold) {
      pipValue = 1;
    } else if (isJPY) {
      pipValue = 1000 * 0.01;
    } else {
      pipValue = 100000 * 0.0001;
    }

    const lotSize = riskAmount / (pipsAtRisk * pipValue);

    return Math.round(lotSize * 100) / 100;
  }

  static getAllLaws(): string[] {
    return Object.values(this.LAWS);
  }

  static getLawByNumber(lawNumber: number): string | null {
    const key = `LAW_${lawNumber}` as keyof typeof ImmutableLawsValidator.LAWS;
    return this.LAWS[key] || null;
  }
}
