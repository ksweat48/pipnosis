/**
 * Omega-10 Meta-Reasoning Brain Type Definitions
 *
 * Types for the system-level intelligence that oversees all Omegas and Alpha,
 * detects reasoning faults, and evolves long-term strategy.
 */

import type { AlphaDecision, OmegaCouncilVotes } from '../brains/coordinator-alpha';

export interface Contradiction {
  /**
   * Contradiction routing category — governs corrective action selection.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag.
   * Omega-10's specific explanation of what it observed must go in `description`.
   * A contradiction type with no description is a governance gap.
   */
  type: 'directional_conflict' | 'confidence_mismatch' | 'risk_inconsistency' | 'exhaustion_risk';
  /**
   * Severity routing tier — governs alert escalation logic.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag. The full analysis
   * of why this severity was assigned must appear in `description`.
   */
  severity: 'low' | 'medium' | 'high' | 'critical';
  source1: string;
  source2: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Omega-10's free-text description of the contradiction.
   * What specifically did it observe between source1 and source2?
   * This must be Omega-10's words — not derived from the type/severity labels.
   */
  description: string;
  alphaStance?: string;
  omegaStances?: string[];
}

export interface DriftWarning {
  /**
   * Drift pattern routing category.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag for corrective action selection.
   * The specific drift pattern Omega-10 observed must be described in `description`.
   */
  type: 'losing_streak' | 'sl_clustering' | 'regime_mismatch' | 'confidence_drift';
  severity: 'low' | 'medium' | 'high';
  pattern: string;
  occurrences: number;
  timeWindow: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Omega-10's free-text description of the drift pattern.
   * What exactly is drifting, over what period, and what is the observable evidence?
   */
  description: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Omega-10's free-text recommended corrective action.
   * Not a label from a list — Omega-10's own words for what should change and why.
   */
  suggestedAction?: string;
}

export interface ConfidenceIssue {
  /**
   * Confidence calibration routing category.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag.
   * The specific calibration problem must be described in `description`.
   */
  type: 'overconfidence' | 'underconfidence' | 'high_variance' | 'calibration_error';
  severity: 'low' | 'medium' | 'high';
  predictedConfidence: number;
  actualPerformance: number;
  variance: number;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Omega-10's free-text description of the calibration issue.
   * What pattern of divergence between predicted and actual confidence was observed?
   */
  description: string;
}

export interface StrategyAdjustment {
  /**
   * Adjustment routing category — governs which subsystem is targeted.
   * CCIP-ALPHA-AUDIT-TEXT: This is a machine-routing tag.
   * The specific adjustment and its full justification must go in `action` and `reason`.
   */
  type: 'omega_weight' | 'strategy_mode' | 'risk_reduction' | 'pattern_avoidance';
  target: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text description of what Omega-10 is adjusting.
   * Not a label. Omega-10's exact instruction in its own words.
   */
  action: string;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Free-text reasoning for why this adjustment is recommended.
   * The evidence and logic chain that led to this decision.
   */
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
