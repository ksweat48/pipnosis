import { Candle } from '../../lib/indicators';
import {
  STRATEGY_VERSION,
  TradeSignal,
  StrategyEvaluation,
  TimeframeData
} from '../types';
import { validatePhase1MacroBias, isDirectionAllowedByMacroBias } from '../validators/phase1Validator';
import { validatePhase2TacticalSetup } from '../validators/phase2Validator';
import { validatePhase3PrecisionEntry } from '../validators/phase3Validator';
import { buildRiskManagement } from './riskManagement';

export interface MultiTimeframeCandles {
  h1: Candle[];
  m5: Candle[];
  m1: Candle[];
}

export class FxFlowScalperV2 {
  private version = STRATEGY_VERSION;

  async evaluateStrategy(
    symbol: string,
    candles: MultiTimeframeCandles
  ): Promise<StrategyEvaluation> {
    const timestamp = new Date();

    const phase1 = validatePhase1MacroBias(candles.h1);

    if (!phase1.passed) {
      return {
        timestamp,
        version: this.version,
        symbol,
        timeframes: this.buildTimeframeData(candles, phase1.bias),
        conditions: {
          macro: false,
          tactical: false,
          entry: false
        },
        trade: null,
        notes: `Phase 1 Failed: ${phase1.reason}`
      };
    }

    const direction = phase1.bias === 'BULLISH' ? 'BUY' : 'SELL';

    const phase2 = validatePhase2TacticalSetup(candles.m5, direction);

    if (!phase2.passed) {
      return {
        timestamp,
        version: this.version,
        symbol,
        timeframes: this.buildTimeframeData(candles, phase1.bias),
        conditions: {
          macro: true,
          tactical: false,
          entry: false
        },
        trade: null,
        notes: `Phase 2 Failed: ${phase2.reason}`
      };
    }

    const phase3 = validatePhase3PrecisionEntry(candles.m1, direction);

    if (!phase3.passed) {
      return {
        timestamp,
        version: this.version,
        symbol,
        timeframes: this.buildTimeframeData(candles, phase1.bias),
        conditions: {
          macro: true,
          tactical: true,
          entry: false
        },
        trade: null,
        notes: `Phase 3 Failed: ${phase3.reason}`
      };
    }

    const currentPrice = candles.m1[candles.m1.length - 1].close;
    const riskManagement = buildRiskManagement(candles.m1, direction, currentPrice);

    const overallConfidence = Math.round(
      (phase1.confidence * 0.2 + phase2.confidence * 0.3 + phase3.confidence * 0.5)
    );

    const reasoning = [
      phase1.reason,
      phase2.reason,
      phase3.reason
    ];

    const tradeSignal: TradeSignal = {
      approved: true,
      direction,
      confidence: overallConfidence,
      symbol,
      timeframe: '1M',
      entryPrice: currentPrice,
      stopLoss: riskManagement.stopLoss,
      takeProfit: riskManagement.takeProfit,
      riskReward: riskManagement.riskRewardRatio,
      reasoning,
      conditions: {
        macro: true,
        tactical: true,
        entry: true
      },
      phases: {
        phase1,
        phase2,
        phase3
      },
      timestamp,
      version: this.version,
      notes: 'ALL CONDITIONS MET - Perfect alignment on all 3 phases'
    };

    return {
      timestamp,
      version: this.version,
      symbol,
      timeframes: this.buildTimeframeData(candles, phase1.bias),
      conditions: {
        macro: true,
        tactical: true,
        entry: true
      },
      trade: tradeSignal,
      notes: 'ALL CONDITIONS MET - Perfect alignment on all 3 phases'
    };
  }

  async evaluateForDirection(
    symbol: string,
    candles: MultiTimeframeCandles,
    direction: 'BUY' | 'SELL'
  ): Promise<StrategyEvaluation> {
    const timestamp = new Date();

    const phase1 = validatePhase1MacroBias(candles.h1);

    if (!isDirectionAllowedByMacroBias(phase1, direction)) {
      return {
        timestamp,
        version: this.version,
        symbol,
        timeframes: this.buildTimeframeData(candles, phase1.bias),
        conditions: {
          macro: false,
          tactical: false,
          entry: false
        },
        trade: null,
        notes: `Phase 1 Failed: H1 bias (${phase1.bias}) does not allow ${direction} trades`
      };
    }

    const phase2 = validatePhase2TacticalSetup(candles.m5, direction);

    if (!phase2.passed) {
      return {
        timestamp,
        version: this.version,
        symbol,
        timeframes: this.buildTimeframeData(candles, phase1.bias),
        conditions: {
          macro: true,
          tactical: false,
          entry: false
        },
        trade: null,
        notes: `Phase 2 Failed: ${phase2.reason}`
      };
    }

    const phase3 = validatePhase3PrecisionEntry(candles.m1, direction);

    if (!phase3.passed) {
      return {
        timestamp,
        version: this.version,
        symbol,
        timeframes: this.buildTimeframeData(candles, phase1.bias),
        conditions: {
          macro: true,
          tactical: true,
          entry: false
        },
        trade: null,
        notes: `Phase 3 Failed: ${phase3.reason}`
      };
    }

    const currentPrice = candles.m1[candles.m1.length - 1].close;
    const riskManagement = buildRiskManagement(candles.m1, direction, currentPrice);

    const overallConfidence = Math.round(
      (phase1.confidence * 0.2 + phase2.confidence * 0.3 + phase3.confidence * 0.5)
    );

    const reasoning = [
      phase1.reason,
      phase2.reason,
      phase3.reason
    ];

    const tradeSignal: TradeSignal = {
      approved: true,
      direction,
      confidence: overallConfidence,
      symbol,
      timeframe: '1M',
      entryPrice: currentPrice,
      stopLoss: riskManagement.stopLoss,
      takeProfit: riskManagement.takeProfit,
      riskReward: riskManagement.riskRewardRatio,
      reasoning,
      conditions: {
        macro: true,
        tactical: true,
        entry: true
      },
      phases: {
        phase1,
        phase2,
        phase3
      },
      timestamp,
      version: this.version,
      notes: 'ALL CONDITIONS MET'
    };

    return {
      timestamp,
      version: this.version,
      symbol,
      timeframes: this.buildTimeframeData(candles, phase1.bias),
      conditions: {
        macro: true,
        tactical: true,
        entry: true
      },
      trade: tradeSignal,
      notes: 'ALL CONDITIONS MET'
    };
  }

  private buildTimeframeData(
    candles: MultiTimeframeCandles,
    h1Bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  ): { h1: TimeframeData; m5: TimeframeData; m1: TimeframeData } {
    return {
      h1: {
        bias: h1Bias
      },
      m5: {
        bias: 'NEUTRAL'
      },
      m1: {
        bias: 'NEUTRAL'
      }
    };
  }

  getVersion(): string {
    return this.version;
  }
}

export const fxFlowScalperV2 = new FxFlowScalperV2();
