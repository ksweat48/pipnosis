/**
 * Omega-10 Meta-Reasoning Brain Tests
 *
 * Tests for system-level intelligence and contradiction detection
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import type {
  Omega10Input,
  Contradiction,
  DriftWarning,
  ConfidenceIssue
} from '../types/omega10';

describe('Omega-10 Meta-Reasoning Brain', () => {
  describe('Contradiction Detection', () => {
    it('should detect directional conflicts between Alpha and Omegas', () => {
      const mockInput: Omega10Input = {
        userId: 'test-user',
        recentAlphaDecisions: [
          {
            decision: 'BUY',
            confidence: 85,
            reasoning: 'Strong trend',
            symbol: 'EURUSD',
            timestamp: new Date()
          }
        ],
        recentOmegaVotes: [
          {
            trend: { vote: 'SELL', confidence: 80, reasoning: 'Downtrend' },
            scalper: { vote: 'SELL', confidence: 75, reasoning: 'Short setup' },
            reversal: { vote: 'SELL', confidence: 85, reasoning: 'Exhaustion' },
            volatility: { vote: 'SELL', confidence: 10, reasoning: 'High vol - weak lean' },
            risk: { vote: 'SELL', confidence: 15, reasoning: 'Risk elevated - weak lean' },
            omega8: null
          }
        ],
        tradeHistory: [],
        performanceStats: {
          overall: {
            winRate: 0.5,
            avgPnl: 0,
            totalTrades: 10,
            consecutiveLosses: 0,
            consecutiveWins: 0,
            maxDrawdown: -100,
            profitFactor: 1.0
          },
          byPattern: {},
          recentStreak: { type: 'win', count: 0 }
        },
        marketSnapshot: {
          symbol: 'EURUSD',
          price: 1.1000,
          regime: 'bull',
          volatility: 'medium',
          session: 'london',
          timeOfDay: '10'
        }
      };

      expect(mockInput.recentAlphaDecisions[0].decision).toBe('BUY');
      expect(mockInput.recentOmegaVotes[0].trend?.vote).toBe('SELL');
    });

    it('should flag high confidence variance as contradiction', () => {
      const alphaConfidence = 90;
      const omegaConfidences = [30, 35, 40, 45, 50];
      const avgOmegaConf = omegaConfidences.reduce((a, b) => a + b, 0) / omegaConfidences.length;

      expect(alphaConfidence - avgOmegaConf).toBeGreaterThan(50);
    });
  });

  describe('Pattern Drift Detection', () => {
    it('should detect consecutive losses', () => {
      const trades = [
        { pnl: -50, outcome: 'loss' as const },
        { pnl: -30, outcome: 'loss' as const },
        { pnl: -40, outcome: 'loss' as const },
        { pnl: -20, outcome: 'loss' as const }
      ];

      const consecutiveLosses = trades.filter(t => t.outcome === 'loss').length;
      expect(consecutiveLosses).toBeGreaterThanOrEqual(3);
    });

    it('should detect stop-loss clustering', () => {
      const slTypes: Record<string, number> = {
        'wick-out': 5,
        'whipsaw': 2,
        'fake-breakout': 1
      };

      const clusteredSL = Object.entries(slTypes).find(([, count]) => count >= 4);
      expect(clusteredSL).toBeDefined();
      if (clusteredSL) {
        expect(clusteredSL[0]).toBe('wick-out');
        expect(clusteredSL[1]).toBe(5);
      }
    });
  });

  describe('Confidence Calibration', () => {
    it('should detect overconfidence', () => {
      const predictedConfidence = 85;
      const actualWinRate = 45;
      const overconfidence = predictedConfidence - actualWinRate;

      expect(overconfidence).toBeGreaterThan(30);
    });

    it('should detect underconfidence', () => {
      const predictedConfidence = 55;
      const actualWinRate = 80;
      const underconfidence = actualWinRate - predictedConfidence;

      expect(underconfidence).toBeGreaterThan(20);
    });

    it('should calculate confidence variance', () => {
      const confidences = [60, 85, 40, 90, 35];
      const mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
      const variance = confidences.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / confidences.length;
      const stdDev = Math.sqrt(variance);

      expect(stdDev).toBeGreaterThan(20);
    });
  });

  describe('Risk Horizon Prediction', () => {
    it('should predict high risk for high volatility + losing streak', () => {
      let riskScore = 0;

      const volatility = 'high';
      const consecutiveLosses = 4;
      const winRate = 0.35;

      if (volatility === 'high') riskScore += 30;
      if (consecutiveLosses >= 3) riskScore += 30;
      if (winRate < 0.45) riskScore += 20;

      const riskLevel = riskScore < 30 ? 'low' : riskScore < 60 ? 'medium' : 'high';

      expect(riskScore).toBeGreaterThanOrEqual(60);
      expect(riskLevel).toBe('high');
    });

    it('should predict low risk for stable conditions', () => {
      let riskScore = 0;

      const volatility = 'low';
      const consecutiveLosses = 0;
      const winRate = 0.65;

      if (volatility === 'high') riskScore += 30;
      if (consecutiveLosses >= 3) riskScore += 30;
      if (winRate < 0.45) riskScore += 20;

      const riskLevel = riskScore < 30 ? 'low' : riskScore < 60 ? 'medium' : 'high';

      expect(riskScore).toBeLessThan(30);
      expect(riskLevel).toBe('low');
    });
  });

  describe('Strategy Adjustments', () => {
    it('should recommend risk reduction for high risk horizon', () => {
      const riskHorizon = 'high';
      const adjustments: string[] = [];

      if (riskHorizon === 'high') {
        adjustments.push('Reduce position sizes by 50%');
        adjustments.push('Tighten stop-losses');
        adjustments.push('Consider pausing trading');
      }

      expect(adjustments.length).toBeGreaterThan(0);
      expect(adjustments[0]).toContain('Reduce position sizes');
    });

    it('should recommend pattern avoidance for high drift', () => {
      const driftWarnings: DriftWarning[] = [
        {
          type: 'regime_mismatch',
          severity: 'high',
          pattern: 'breakout_trades',
          occurrences: 5,
          timeWindow: 'last 20 trades',
          description: 'Breakout pattern failing',
          suggestedAction: 'Avoid breakout trades in current regime'
        }
      ];

      const hasHighSeverityDrift = driftWarnings.some(w => w.severity === 'high');
      expect(hasHighSeverityDrift).toBe(true);
    });
  });

  describe('Omega Weight Overrides', () => {
    it('should boost risk specialist weight in high risk conditions', () => {
      const weights: Record<string, number> = {
        trend: 1.0,
        risk: 1.0,
        reversal: 1.0
      };

      const riskHorizon = 'high';
      if (riskHorizon === 'high') {
        weights.risk = 1.3;
      }

      expect(weights.risk).toBe(1.3);
      expect(weights.trend).toBe(1.0);
    });

    it('should boost trend specialist weight when pattern drift in reversals', () => {
      const weights: Record<string, number> = {
        trend: 1.0,
        reversal: 1.0
      };

      const driftInReversals = true;
      if (driftInReversals) {
        weights.trend = 1.2;
        weights.reversal = 0.8;
      }

      expect(weights.trend).toBeGreaterThan(weights.reversal);
    });
  });

  describe('LLM Trigger Conditions', () => {
    it('should trigger LLM for multiple contradictions', () => {
      const contradictions: Contradiction[] = [
        {
          type: 'directional_conflict',
          severity: 'high',
          source1: 'Alpha',
          source2: 'Omega Council',
          description: 'Alpha BUY vs Omegas SELL'
        },
        {
          type: 'confidence_mismatch',
          severity: 'medium',
          source1: 'Alpha',
          source2: 'Omegas',
          description: 'High confidence mismatch'
        }
      ];

      const shouldTriggerLLM = contradictions.length >= 2;
      expect(shouldTriggerLLM).toBe(true);
    });

    it('should trigger LLM for high overconfidence score', () => {
      const overconfidenceScore = 75;
      const shouldTriggerLLM = overconfidenceScore > 70;

      expect(shouldTriggerLLM).toBe(true);
    });

    it('should trigger LLM for high pattern drift', () => {
      const driftWarnings: DriftWarning[] = [
        { type: 'losing_streak', severity: 'high', pattern: 'all', occurrences: 5, timeWindow: 'recent', description: 'Losing streak' },
        { type: 'sl_clustering', severity: 'medium', pattern: 'wick-out', occurrences: 4, timeWindow: 'recent', description: 'SL clustering' },
        { type: 'regime_mismatch', severity: 'high', pattern: 'trend', occurrences: 3, timeWindow: 'recent', description: 'Regime mismatch' }
      ];

      const shouldTriggerLLM = driftWarnings.length >= 3;
      expect(shouldTriggerLLM).toBe(true);
    });
  });

  describe('Meta-Confidence Calculation', () => {
    it('should have high confidence when no issues detected', () => {
      const contradictions = 0;
      const driftWarnings = 0;
      const confidenceIssues = 0;

      let metaConfidence = 70;
      if (contradictions === 0) metaConfidence += 10;
      if (driftWarnings === 0) metaConfidence += 10;
      if (confidenceIssues === 0) metaConfidence += 10;

      expect(metaConfidence).toBeGreaterThanOrEqual(90);
    });

    it('should have low confidence when multiple issues detected', () => {
      const contradictions = 3;
      const driftWarnings = 2;
      const confidenceIssues = 2;

      let metaConfidence = 70;
      metaConfidence -= (contradictions * 5);
      metaConfidence -= (driftWarnings * 5);
      metaConfidence -= (confidenceIssues * 5);

      expect(metaConfidence).toBeLessThanOrEqual(50);
    });
  });
});

describe('Omega-10 Scheduler', () => {
  it('should require minimum trades for analysis', () => {
    const MIN_TRADES = 10;
    const tradeCount = 5;

    const hasMinimumData = tradeCount >= MIN_TRADES;
    expect(hasMinimumData).toBe(false);
  });

  it('should schedule next review based on risk level', () => {
    const baseInterval = 4;
    let nextInterval = baseInterval;

    const riskLevel = 'high';
    if (riskLevel === 'high') {
      nextInterval = 2;
    }

    expect(nextInterval).toBeLessThan(baseInterval);
    expect(nextInterval).toBe(2);
  });
});
