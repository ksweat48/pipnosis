import { supabase } from '@/lib/supabase';

export interface RiskValidationResult {
  valid: boolean;
  reason?: string;
  violations: string[];
}

export interface TradeRiskParams {
  userId: string;
  symbol: string;
  lotSize: number;
  stopLossPips: number;
  accountBalance: number;
}

const PIPNOSIS_LAWS = {
  MAX_RISK_PER_TRADE: 0.04,
  MIN_RISK_REWARD: 1.0,
  MAX_DRAWDOWN: 0.15,
  MAX_DAILY_TRADES_MANUAL: 2,
  MAX_DAILY_TRADES_AUTO: 6,
  MIN_ACCOUNT_BALANCE: 100
};

class RiskValidator {
  async validateTrade(params: TradeRiskParams): Promise<RiskValidationResult> {
    const violations: string[] = [];

    if (params.accountBalance < PIPNOSIS_LAWS.MIN_ACCOUNT_BALANCE) {
      violations.push(`Account balance ($${params.accountBalance}) below minimum ($${PIPNOSIS_LAWS.MIN_ACCOUNT_BALANCE})`);
    }

    const riskAmount = this.calculateRiskAmount(params.lotSize, params.stopLossPips);
    const riskPercent = riskAmount / params.accountBalance;

    if (riskPercent > PIPNOSIS_LAWS.MAX_RISK_PER_TRADE) {
      violations.push(
        `Trade risk (${(riskPercent * 100).toFixed(2)}%) exceeds maximum allowed (${PIPNOSIS_LAWS.MAX_RISK_PER_TRADE * 100}%) - Law #1 violation`
      );
    }

    const dailyTrades = await this.getTodayTradeCount(params.userId);
    if (dailyTrades >= PIPNOSIS_LAWS.MAX_DAILY_TRADES_MANUAL) {
      violations.push(
        `Daily trade limit reached (${dailyTrades}/${PIPNOSIS_LAWS.MAX_DAILY_TRADES_MANUAL}) - Law #4 violation`
      );
    }

    const currentDrawdown = await this.calculateCurrentDrawdown(params.userId);
    if (currentDrawdown >= PIPNOSIS_LAWS.MAX_DRAWDOWN) {
      violations.push(
        `Current drawdown (${(currentDrawdown * 100).toFixed(2)}%) exceeds maximum allowed (${PIPNOSIS_LAWS.MAX_DRAWDOWN * 100}%) - Law #3 violation`
      );
    }

    const openPositions = await this.getOpenPositionsCount(params.userId);
    if (openPositions >= PIPNOSIS_LAWS.MAX_DAILY_TRADES_MANUAL) {
      violations.push(
        `Maximum concurrent positions reached (${openPositions}) - Law #4 violation`
      );
    }

    return {
      valid: violations.length === 0,
      reason: violations.length > 0 ? violations[0] : undefined,
      violations
    };
  }

  async validateRiskReward(
    stopLossPips: number,
    takeProfitPips: number
  ): Promise<RiskValidationResult> {
    const violations: string[] = [];

    if (stopLossPips <= 0) {
      violations.push('Stop loss is required - Law #9 violation');
    }

    if (takeProfitPips <= 0) {
      violations.push('Take profit is required - Law #10 violation');
    }

    const riskReward = takeProfitPips / stopLossPips;

    if (riskReward < PIPNOSIS_LAWS.MIN_RISK_REWARD) {
      violations.push(
        `Risk/Reward ratio (1:${riskReward.toFixed(2)}) below minimum (1:${PIPNOSIS_LAWS.MIN_RISK_REWARD}) - Law #2 violation`
      );
    }

    return {
      valid: violations.length === 0,
      reason: violations.length > 0 ? violations[0] : undefined,
      violations
    };
  }

  async checkMarginRequirement(
    symbol: string,
    lotSize: number,
    entryPrice: number,
    accountBalance: number
  ): Promise<RiskValidationResult> {
    const violations: string[] = [];

    const marginRequired = this.calculateMarginRequirement(symbol, lotSize, entryPrice);

    if (marginRequired > accountBalance) {
      violations.push(
        `Insufficient margin. Required: $${marginRequired.toFixed(2)}, Available: $${accountBalance.toFixed(2)}`
      );
    }

    const marginPercent = (marginRequired / accountBalance) * 100;
    if (marginPercent > 50) {
      violations.push(
        `Trade would use ${marginPercent.toFixed(0)}% of account balance. Maximum recommended: 50%`
      );
    }

    return {
      valid: violations.length === 0,
      reason: violations.length > 0 ? violations[0] : undefined,
      violations
    };
  }

  async checkAutoTradingLimits(userId: string): Promise<RiskValidationResult> {
    const violations: string[] = [];

    const { data: status } = await supabase
      .from('auto_trading_status')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!status) {
      violations.push('Auto trading status not initialized');
      return { valid: false, reason: violations[0], violations };
    }

    if (!status.enabled) {
      violations.push('Auto trading is disabled');
    }

    if (status.emergency_stop) {
      violations.push('Emergency stop is active - daily loss limit exceeded');
    }

    if (status.trades_taken_today >= status.max_daily_trades) {
      violations.push(
        `Auto trading daily limit reached (${status.trades_taken_today}/${status.max_daily_trades})`
      );
    }

    if (status.daily_pnl <= status.daily_loss_limit) {
      violations.push(
        `Daily loss limit exceeded ($${status.daily_pnl.toFixed(2)} / $${status.daily_loss_limit.toFixed(2)})`
      );
    }

    return {
      valid: violations.length === 0,
      reason: violations.length > 0 ? violations[0] : undefined,
      violations
    };
  }

  async checkCorrelation(userId: string, newSymbol: string): Promise<RiskValidationResult> {
    const violations: string[] = [];

    const { data: openTrades } = await supabase
      .from('trade_records')
      .select('symbol, trade_type')
      .eq('user_id', userId)
      .eq('status', 'open');

    if (!openTrades) return { valid: true, violations: [] };

    const correlatedPairs = this.getCorrelatedPairs(newSymbol);

    for (const trade of openTrades) {
      if (correlatedPairs.includes(trade.symbol)) {
        violations.push(
          `Already have open position on correlated pair ${trade.symbol}. Avoid over-concentration.`
        );
      }
    }

    return {
      valid: violations.length === 0,
      reason: violations.length > 0 ? violations[0] : undefined,
      violations
    };
  }

  private calculateRiskAmount(lotSize: number, stopLossPips: number): number {
    const pipValue = 10;
    return lotSize * stopLossPips * pipValue;
  }

  private calculateMarginRequirement(symbol: string, lotSize: number, entryPrice: number): number {
    const leverage = 100;
    const contractSize = symbol.includes('XAU') ? 100 : 100000;
    const notionalValue = contractSize * lotSize * entryPrice;
    return notionalValue / leverage;
  }

  private async getTodayTradeCount(userId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from('trade_records')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .gte('opened_at', today.toISOString());

    if (error) {
      console.error('Error getting today trade count:', error);
      return 0;
    }

    return data?.length || 0;
  }

  private async calculateCurrentDrawdown(userId: string): Promise<number> {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('account_balance, initial_balance')
      .eq('id', userId)
      .single();

    if (!profile) return 0;

    const currentBalance = parseFloat(profile.account_balance || '10000');
    const initialBalance = parseFloat(profile.initial_balance || '10000');

    if (currentBalance >= initialBalance) return 0;

    return (initialBalance - currentBalance) / initialBalance;
  }

  private async getOpenPositionsCount(userId: string): Promise<number> {
    const { data, error } = await supabase
      .from('trade_records')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'open');

    if (error) {
      console.error('Error getting open positions count:', error);
      return 0;
    }

    return data?.length || 0;
  }

  private getCorrelatedPairs(symbol: string): string[] {
    const correlations: { [key: string]: string[] } = {
      'EURUSD': ['GBPUSD', 'AUDUSD', 'NZDUSD'],
      'GBPUSD': ['EURUSD', 'AUDUSD', 'NZDUSD'],
      'AUDUSD': ['EURUSD', 'GBPUSD', 'NZDUSD'],
      'NZDUSD': ['EURUSD', 'GBPUSD', 'AUDUSD'],
      'USDJPY': ['USDCHF', 'USDCAD'],
      'USDCHF': ['USDJPY', 'USDCAD'],
      'USDCAD': ['USDJPY', 'USDCHF'],
      'XAUUSD': ['XAGUSD'],
      'XAGUSD': ['XAUUSD']
    };

    return correlations[symbol] || [];
  }

  getLawsReference(): string[] {
    return [
      "Law #1: Capital Preservation - Never risk more than 2-4% of account balance per trade",
      "Law #2: Risk-Reward Ratio - Minimum 1:1 RRR, target 2:1 or better",
      "Law #3: Drawdown Management - Maximum 15% account drawdown before stopping",
      "Law #4: Trade Limit - Maximum 2 trades per session (6 for auto trading)",
      "Law #5: AI Final Decision - AI has ultimate authority on trade execution",
      "Law #6: Quality Over Quantity - Only high-probability setups with multiple confirmations",
      "Law #7: No Revenge Trading - No re-entry after stop loss without new analysis",
      "Law #8: Market Hours - Only trade during active market sessions",
      "Law #9: Stop Loss Mandatory - Every trade must have a stop loss",
      "Law #10: Take Profit Strategy - Define clear profit targets before entry"
    ];
  }
}

export const riskValidator = new RiskValidator();
