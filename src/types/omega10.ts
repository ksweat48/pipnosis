/**
 * Omega-10 Meta-Reasoning Brain Type Definitions
 *
 * Types for the system-level intelligence that oversees all Omegas and Alpha,
 * detects reasoning faults, and evolves long-term strategy.
 */

import type { AlphaDecision, OmegaCouncilVotes } from '../brains/coordinator-alpha';

export interface Contradiction {
  type: 'directional_conflict' | 'confidence_mismatch' | 'risk_inconsistency' | 'exhaustion_risk'; // TIER 3 FIX: Added exhaustion_risk
  severity: 'low' | 'medium' | 'high' | 'critical';
  source1: string;
  source2: string;
  description: string;
  alphaStance?: string;
  omegaStances?: string[];
}

export interface DriftWarning {
  type: 'losing_streak' | 'sl_clustering' | 'regime_mismatch' | 'confidence_drift';
  severity: 'low' | 'medium' | 'high';
  pattern: string;
  occurrences: number;
  timeWindow: string;
  description: string;
  suggestedAction?: string;
}

export interface ConfidenceIssue {
  type: 'overconfidence' | 'underconfidence' | 'high_variance' | 'calibration_error';
  severity: 'low' | 'medium' | 'high';
  predictedConfidence: number;
  actualPerformance: number;
  variance: number;
  description: string;
}

export interface StrategyAdjustment {
  type: 'omega_weight' | 'strategy_mode' | 'risk_reduction' | 'pattern_avoidance';
  target: string;
  action: string;
  reason: string;
  priority: 'low' | 'medium' | 'high';
  expiresAt?: Date;
}

export interface RiskHorizon {
  level: 'low' | 'medium' | 'high';
  reasons: string[];
  recommendedActions: string[];
  validForHours: number;
}

export interface MemoryUpdate {
  pattern: string;
  successRateChange: number;
  recommendation: string;
  source: 'omega10';
  confidence: number;
}

export interface Omega10Result {
  omega: 'meta_reasoning';
  timestamp: Date;
  analysisType: 'scheduled' | 'triggered' | 'manual';

  contradictions: Contradiction[];
  driftWarnings: DriftWarning[];
  confidenceIssues: ConfidenceIssue[];

  riskHorizon: RiskHorizon;

  strategyAdjustments: StrategyAdjustment[];
  omegaWeightOverrides: Record<string, number>;
  recommendedStrategyMode: string | null;

  memoryUpdate: MemoryUpdate | null;

  usedLLM: boolean;
  llmReasoning?: string;
  metaConfidence: number;
  nextReviewAt: Date;
}

export interface PerformanceMetrics {
  winRate: number;
  avgPnl: number;
  totalTrades: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  maxDrawdown: number;
  profitFactor: number;
}

export interface PatternPerformance {
  pattern: string;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  avgPnl: number;
  lastUsed: Date;
}

export interface TradeRecord {
  id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  outcome: 'win' | 'loss' | 'breakeven';
  stopLossType?: string;
  pattern?: string;
  alphaConfidence?: number;
  marketRegime?: string;
  timestamp: Date;
}

export interface Omega10Input {
  userId: string;

  recentAlphaDecisions: AlphaDecision[];
  recentOmegaVotes: OmegaCouncilVotes[];

  tradeHistory: TradeRecord[];
  performanceStats: {
    overall: PerformanceMetrics;
    byPattern: Record<string, PatternPerformance>;
    recentStreak: {
      type: 'win' | 'loss';
      count: number;
    };
  };

  marketSnapshot: {
    symbol: string;
    price: number;
    regime: string;
    volatility: string;
    session: string;
    timeOfDay: string;
  };

  activeStrategyPlan?: any;
  strategyMemory?: any[];
}

export interface DeterministicAnalysis {
  contradictions: Contradiction[];
  driftWarnings: DriftWarning[];
  confidenceIssues: ConfidenceIssue[];
  confidenceVariance: number;
  overconfidenceScore: number;
  underconfidenceScore: number;
  patternDriftScore: number;
  riskHorizon: RiskHorizon;
}

export interface LLMMetaAnalysis {
  faults: string[];
  adjustments: string[];
  omegaWeightChanges: Record<string, number>;
  strategyModeRecommendation: string | null;
  memoryUpdate: {
    pattern: string;
    action: string;
    reason: string;
  } | null;
  metaConfidence: number;
  reasoning: string;
}

export interface Omega10Config {
  scheduledIntervalHours: number;
  contradictionThreshold: number;
  driftThreshold: number;
  confidenceVarianceThreshold: number;
  minTradesForAnalysis: number;
  llmTriggerThreshold: number;
  maxAdjustmentsPerPeriod: number;
  adjustmentDecayDays: number;
}
