/**
 * Omega-10: Meta-Reasoning & Strategic Planner Brain
 *
 * The highest-ranking specialist that oversees the entire Omega Council and Alpha.
 * Performs system-level intelligence, detects reasoning faults, predicts future risks,
 * and updates long-term strategy plans.
 *
 * This brain analyzes THE SYSTEM, not individual trades.
 */

import type { AlphaDecision, OmegaCouncilVotes } from './coordinator-alpha';
import type {
  Omega10Input,
  Omega10Result,
  DeterministicAnalysis,
  Contradiction,
  DriftWarning,
  ConfidenceIssue,
  RiskHorizon,
  StrategyAdjustment,
  MemoryUpdate,
  TradeRecord,
  PatternPerformance,
  LLMMetaAnalysis
} from '../types/omega10';
import { openaiProxyClient } from '../services/openai-proxy-client';
import { llmTokenTracker } from '../services/llm-token-tracker';

const DEFAULT_OMEGA10_CONFIG = {
  scheduledIntervalHours: 4,
  contradictionThreshold: 2,
  driftThreshold: 3,
  confidenceVarianceThreshold: 30,
  minTradesForAnalysis: 10,
  llmTriggerThreshold: 2,
  maxAdjustmentsPerPeriod: 3,
  adjustmentDecayDays: 2
};

/**
 * Main entry point for Omega-10 meta-reasoning
 */
export async function runOmega10MetaReasoning(
  input: Omega10Input
): Promise<Omega10Result> {
  const startTime = Date.now();
  console.log('[Omega-10] 🧠 Starting meta-reasoning analysis...');

  const deterministicAnalysis = await runDeterministicAnalysis(input);

  let usedLLM = false;
  let llmReasoning: string | undefined;
  let llmAnalysis: LLMMetaAnalysis | null = null;

  if (shouldUseLLM(deterministicAnalysis)) {
    console.log('[Omega-10] 🤖 Triggering LLM meta-analysis...');
    llmAnalysis = await runLLMMetaAnalysis(input, deterministicAnalysis);
    usedLLM = true;
    llmReasoning = llmAnalysis.reasoning;
  }

  const strategyAdjustments = generateStrategyAdjustments(
    deterministicAnalysis,
    llmAnalysis
  );

  const omegaWeightOverrides = generateOmegaWeightOverrides(
    deterministicAnalysis,
    llmAnalysis
  );

  const recommendedStrategyMode = llmAnalysis?.strategyModeRecommendation || null;

  const memoryUpdate = generateMemoryUpdate(deterministicAnalysis, llmAnalysis);

  const metaConfidence = calculateMetaConfidence(
    deterministicAnalysis,
    llmAnalysis
  );

  const nextReviewAt = calculateNextReviewTime(
    deterministicAnalysis,
    DEFAULT_OMEGA10_CONFIG.scheduledIntervalHours
  );

  const result: Omega10Result = {
    omega: 'meta_reasoning',
    timestamp: new Date(),
    analysisType: 'scheduled',
    contradictions: deterministicAnalysis.contradictions,
    driftWarnings: deterministicAnalysis.driftWarnings,
    confidenceIssues: deterministicAnalysis.confidenceIssues,
    riskHorizon: deterministicAnalysis.riskHorizon,
    strategyAdjustments,
    omegaWeightOverrides,
    recommendedStrategyMode,
    memoryUpdate,
    usedLLM,
    llmReasoning,
    metaConfidence,
    nextReviewAt
  };

  const duration = Date.now() - startTime;
  console.log(`[Omega-10] ✅ Meta-analysis complete in ${duration}ms (confidence=${metaConfidence}%)`);

  logOmega10Summary(result);

  return result;
}

/**
 * LAYER 1: DETERMINISTIC SYSTEM ANALYSIS
 * Fast, rule-based detection of system-level issues
 */
async function runDeterministicAnalysis(input: Omega10Input): Promise<DeterministicAnalysis> {
  const contradictions = detectContradictions(
    input.recentAlphaDecisions,
    input.recentOmegaVotes
  );

  const driftWarnings = detectPatternDrift(
    input.tradeHistory,
    input.performanceStats
  );

  const confidenceIssues = analyzeConfidenceCalibration(
    input.recentAlphaDecisions,
    input.tradeHistory
  );

  const confidenceVariance = calculateConfidenceVariance(input.recentOmegaVotes);
  const overconfidenceScore = calculateOverconfidenceScore(input.recentAlphaDecisions, input.tradeHistory);
  const underconfidenceScore = calculateUnderconfidenceScore(input.recentAlphaDecisions, input.tradeHistory);
  const patternDriftScore = calculatePatternDriftScore(driftWarnings);

  const riskHorizon = predictRiskHorizon(
    input.marketSnapshot,
    driftWarnings,
    input.performanceStats
  );

  return {
    contradictions,
    driftWarnings,
    confidenceIssues,
    confidenceVariance,
    overconfidenceScore,
    underconfidenceScore,
    patternDriftScore,
    riskHorizon
  };
}

/**
 * Detect contradictions between Alpha and Omega specialists
 */
function detectContradictions(
  alphaDecisions: AlphaDecision[],
  omegaVotes: OmegaCouncilVotes[]
): Contradiction[] {
  const contradictions: Contradiction[] = [];

  if (alphaDecisions.length === 0 || omegaVotes.length === 0) {
    return contradictions;
  }

  for (let i = 0; i < Math.min(alphaDecisions.length, omegaVotes.length); i++) {
    const alpha = alphaDecisions[i];
    const omegas = omegaVotes[i];

    const omegaVoteArray = [
      omegas.trend,
      omegas.scalper,
      omegas.confirmation,
      omegas.reversal,
      omegas.volatility,
      omegas.risk
    ].filter(Boolean);

    const buyVotes = omegaVoteArray.filter(v => v?.vote === 'BUY').length;
    const sellVotes = omegaVoteArray.filter(v => v?.vote === 'SELL').length;

    if (alpha.decision === 'BUY' && sellVotes >= 4) {
      contradictions.push({
        type: 'directional_conflict',
        severity: 'high',
        source1: 'Alpha',
        source2: 'Omega Council',
        description: `Alpha decided BUY but ${sellVotes} Omegas voted SELL`,
        alphaStance: `BUY (conf: ${alpha.confidence})`,
        omegaStances: omegaVoteArray.map(v => `${v?.vote} (${v?.confidence})`)
      });
    }

    if (alpha.decision === 'SELL' && buyVotes >= 4) {
      contradictions.push({
        type: 'directional_conflict',
        severity: 'high',
        source1: 'Alpha',
        source2: 'Omega Council',
        description: `Alpha decided SELL but ${buyVotes} Omegas voted BUY`,
        alphaStance: `SELL (conf: ${alpha.confidence})`,
        omegaStances: omegaVoteArray.map(v => `${v?.vote} (${v?.confidence})`)
      });
    }

    const lowConfVotes = omegaVoteArray.filter(v => (v?.confidence || 0) < 20).length;
    if ((alpha.decision === 'BUY' || alpha.decision === 'SELL') && lowConfVotes >= 4) {
      contradictions.push({
        type: 'risk_inconsistency',
        severity: 'critical',
        source1: 'Alpha',
        source2: 'Omega Council',
        description: `Alpha decided to trade but ${lowConfVotes} Omegas have very low confidence (<20%)`,
        alphaStance: `${alpha.decision} (conf: ${alpha.confidence})`,
        omegaStances: omegaVoteArray.map(v => `${v?.vote} (${v?.confidence})`)
      });
    }

    const avgOmegaConfidence = omegaVoteArray.reduce((sum, v) => sum + (v?.confidence || 0), 0) / omegaVoteArray.length;
    if (alpha.confidence > 80 && avgOmegaConfidence < 50) {
      contradictions.push({
        type: 'confidence_mismatch',
        severity: 'medium',
        source1: 'Alpha',
        source2: 'Omega Council',
        description: `Alpha very confident (${alpha.confidence}) but Omegas uncertain (avg ${avgOmegaConfidence.toFixed(0)})`,
        alphaStance: `High confidence: ${alpha.confidence}`,
        omegaStances: [`Low avg confidence: ${avgOmegaConfidence.toFixed(0)}`]
      });
    }

    // TIER 3 FIX: Trend+Reversal exhaustion conflict detector
    // Detects when trend strength conflicts with reversal signals (potential exhaustion)
    const trendVote = omegas.trend;
    const reversalVote = omegas.reversal;

    if (trendVote && reversalVote && trendVote.confidence >= 70 && reversalVote.confidence >= 60) {
      // Trend says BUY but Reversal says SELL = bullish exhaustion
      if (trendVote.vote === 'BUY' && reversalVote.vote === 'SELL') {
        contradictions.push({
          type: 'exhaustion_risk',
          severity: 'high',
          source1: 'Trend Omega',
          source2: 'Reversal Omega',
          description: `Trend bullish (${trendVote.confidence}) but Reversal detecting bearish exhaustion (${reversalVote.confidence}) - potential trend reversal`,
          alphaStance: alpha.decision === 'BUY'
            ? `Aligned with trend (BUY, conf: ${alpha.confidence})`
            : alpha.decision === 'SELL'
            ? `Aligned with reversal (SELL, conf: ${alpha.confidence})`
            : `Sided with caution (NO_TRADE, conf: ${alpha.confidence})`,
          omegaStances: [
            `Trend: ${trendVote.vote} (${trendVote.confidence})`,
            `Reversal: ${reversalVote.vote} (${reversalVote.confidence})`
          ]
        });
      }

      // Trend says SELL but Reversal says BUY = bearish exhaustion
      if (trendVote.vote === 'SELL' && reversalVote.vote === 'BUY') {
        contradictions.push({
          type: 'exhaustion_risk',
          severity: 'high',
          source1: 'Trend Omega',
          source2: 'Reversal Omega',
          description: `Trend bearish (${trendVote.confidence}) but Reversal detecting bullish exhaustion (${reversalVote.confidence}) - potential trend reversal`,
          alphaStance: alpha.decision === 'SELL'
            ? `Aligned with trend (SELL, conf: ${alpha.confidence})`
            : alpha.decision === 'BUY'
            ? `Aligned with reversal (BUY, conf: ${alpha.confidence})`
            : `Sided with caution (NO_TRADE, conf: ${alpha.confidence})`,
          omegaStances: [
            `Trend: ${trendVote.vote} (${trendVote.confidence})`,
            `Reversal: ${reversalVote.vote} (${reversalVote.confidence})`
          ]
        });
      }
    }
  }

  return contradictions;
}

/**
 * Detect pattern drift and recurring failures
 */
function detectPatternDrift(
  tradeHistory: TradeRecord[],
  performanceStats: Omega10Input['performanceStats']
): DriftWarning[] {
  const warnings: DriftWarning[] = [];

  if (tradeHistory.length < 5) {
    return warnings;
  }

  const recentTrades = tradeHistory.slice(0, 20);
  const lastFive = tradeHistory.slice(0, 5);
  const consecutiveLosses = lastFive.filter(t => t.outcome === 'loss').length;

  if (consecutiveLosses >= 3) {
    warnings.push({
      type: 'losing_streak',
      severity: consecutiveLosses >= 4 ? 'high' : 'medium',
      pattern: 'consecutive_losses',
      occurrences: consecutiveLosses,
      timeWindow: 'last 5 trades',
      description: `${consecutiveLosses} consecutive losses detected`,
      suggestedAction: 'Review strategy alignment with current market regime'
    });
  }

  const slTypes: Record<string, number> = {};
  for (const trade of recentTrades) {
    if (trade.outcome === 'loss' && trade.stopLossType) {
      slTypes[trade.stopLossType] = (slTypes[trade.stopLossType] || 0) + 1;
    }
  }

  for (const [slType, count] of Object.entries(slTypes)) {
    if (count >= 4) {
      warnings.push({
        type: 'sl_clustering',
        severity: count >= 6 ? 'high' : 'medium',
        pattern: slType,
        occurrences: count,
        timeWindow: 'last 20 trades',
        description: `${count} losses from ${slType} stop-loss type`,
        suggestedAction: `Adjust SL strategy for ${slType} scenarios`
      });
    }
  }

  for (const [pattern, perf] of Object.entries(performanceStats.byPattern)) {
    if (perf.losses >= 3 && perf.winRate < 0.35) {
      warnings.push({
        type: 'regime_mismatch',
        severity: perf.winRate < 0.25 ? 'high' : 'medium',
        pattern,
        occurrences: perf.losses,
        timeWindow: 'recent sessions',
        description: `Pattern "${pattern}" failing (WR: ${(perf.winRate * 100).toFixed(1)}%)`,
        suggestedAction: `Avoid or adjust "${pattern}" strategy`
      });
    }
  }

  return warnings;
}

/**
 * Analyze confidence calibration accuracy
 */
function analyzeConfidenceCalibration(
  alphaDecisions: AlphaDecision[],
  tradeHistory: TradeRecord[]
): ConfidenceIssue[] {
  const issues: ConfidenceIssue[] = [];

  if (alphaDecisions.length < 10 || tradeHistory.length < 10) {
    return issues;
  }

  const recentDecisions = alphaDecisions.slice(0, 20);
  const recentTrades = tradeHistory.slice(0, 20);

  const highConfDecisions = recentDecisions.filter(d => d.confidence >= 80);
  const highConfTrades = recentTrades.slice(0, highConfDecisions.length);
  const highConfWins = highConfTrades.filter(t => t.outcome === 'win').length;
  const highConfWinRate = highConfTrades.length > 0 ? highConfWins / highConfTrades.length : 0;

  if (highConfDecisions.length >= 5 && highConfWinRate < 0.55) {
    issues.push({
      type: 'overconfidence',
      severity: highConfWinRate < 0.40 ? 'high' : 'medium',
      predictedConfidence: 80,
      actualPerformance: highConfWinRate * 100,
      variance: 80 - (highConfWinRate * 100),
      description: `High confidence trades (80%+) only winning ${(highConfWinRate * 100).toFixed(1)}%`
    });
  }

  const lowConfDecisions = recentDecisions.filter(d => d.confidence < 65);
  const lowConfTrades = recentTrades.slice(0, lowConfDecisions.length);
  const lowConfWins = lowConfTrades.filter(t => t.outcome === 'win').length;
  const lowConfWinRate = lowConfTrades.length > 0 ? lowConfWins / lowConfTrades.length : 0;

  if (lowConfDecisions.length >= 5 && lowConfWinRate > 0.75) {
    issues.push({
      type: 'underconfidence',
      severity: 'medium',
      predictedConfidence: 60,
      actualPerformance: lowConfWinRate * 100,
      variance: (lowConfWinRate * 100) - 60,
      description: `Low confidence trades (<65%) winning ${(lowConfWinRate * 100).toFixed(1)}%`
    });
  }

  const confidenceValues = recentDecisions.map(d => d.confidence);
  const avgConfidence = confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length;
  const variance = confidenceValues.reduce((sum, val) => sum + Math.pow(val - avgConfidence, 2), 0) / confidenceValues.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev > 20) {
    issues.push({
      type: 'high_variance',
      severity: stdDev > 30 ? 'high' : 'medium',
      predictedConfidence: avgConfidence,
      actualPerformance: avgConfidence,
      variance: stdDev,
      description: `High confidence variance (σ=${stdDev.toFixed(1)}) indicates unstable decision-making`
    });
  }

  return issues;
}

/**
 * Calculate confidence variance across Omega council
 */
function calculateConfidenceVariance(omegaVotes: OmegaCouncilVotes[]): number {
  if (omegaVotes.length === 0) return 0;

  const allConfidences: number[] = [];

  for (const votes of omegaVotes) {
    const voteArray = [
      votes.trend,
      votes.scalper,
      votes.confirmation,
      votes.reversal,
      votes.volatility,
      votes.risk
    ].filter(Boolean);

    for (const vote of voteArray) {
      if (vote?.confidence) {
        allConfidences.push(vote.confidence);
      }
    }
  }

  if (allConfidences.length === 0) return 0;

  const mean = allConfidences.reduce((a, b) => a + b, 0) / allConfidences.length;
  const variance = allConfidences.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / allConfidences.length;

  return Math.sqrt(variance);
}

/**
 * Calculate overconfidence score
 */
function calculateOverconfidenceScore(
  alphaDecisions: AlphaDecision[],
  tradeHistory: TradeRecord[]
): number {
  if (alphaDecisions.length < 5 || tradeHistory.length < 5) return 0;

  const recentDecisions = alphaDecisions.slice(0, 10);
  const recentTrades = tradeHistory.slice(0, 10);

  const avgConfidence = recentDecisions.reduce((sum, d) => sum + d.confidence, 0) / recentDecisions.length;
  const wins = recentTrades.filter(t => t.outcome === 'win').length;
  const actualWinRate = (wins / recentTrades.length) * 100;

  const overconfidence = Math.max(0, avgConfidence - actualWinRate);

  return Math.min(100, overconfidence * 2);
}

/**
 * Calculate underconfidence score
 */
function calculateUnderconfidenceScore(
  alphaDecisions: AlphaDecision[],
  tradeHistory: TradeRecord[]
): number {
  if (alphaDecisions.length < 5 || tradeHistory.length < 5) return 0;

  const recentDecisions = alphaDecisions.slice(0, 10);
  const recentTrades = tradeHistory.slice(0, 10);

  const avgConfidence = recentDecisions.reduce((sum, d) => sum + d.confidence, 0) / recentDecisions.length;
  const wins = recentTrades.filter(t => t.outcome === 'win').length;
  const actualWinRate = (wins / recentTrades.length) * 100;

  const underconfidence = Math.max(0, actualWinRate - avgConfidence);

  return Math.min(100, underconfidence * 2);
}

/**
 * Calculate pattern drift score
 */
function calculatePatternDriftScore(warnings: DriftWarning[]): number {
  if (warnings.length === 0) return 0;

  const severityScores = {
    low: 10,
    medium: 30,
    high: 60
  };

  const totalScore = warnings.reduce((sum, w) => sum + severityScores[w.severity], 0);

  return Math.min(100, totalScore);
}

/**
 * Predict risk horizon for next few hours
 */
function predictRiskHorizon(
  marketSnapshot: Omega10Input['marketSnapshot'],
  driftWarnings: DriftWarning[],
  performanceStats: Omega10Input['performanceStats']
): RiskHorizon {
  const reasons: string[] = [];
  let riskScore = 0;

  if (marketSnapshot.volatility === 'high') {
    riskScore += 30;
    reasons.push('High volatility environment');
  }

  if (driftWarnings.some(w => w.severity === 'high')) {
    riskScore += 40;
    reasons.push('High-severity pattern drift detected');
  }

  if (performanceStats.recentStreak.type === 'loss' && performanceStats.recentStreak.count >= 3) {
    riskScore += 30;
    reasons.push(`${performanceStats.recentStreak.count} consecutive losses`);
  }

  if (performanceStats.overall.winRate < 0.45) {
    riskScore += 20;
    reasons.push('Below-average win rate');
  }

  const level: 'low' | 'medium' | 'high' = riskScore < 30 ? 'low' : riskScore < 60 ? 'medium' : 'high';

  const recommendedActions: string[] = [];
  if (level === 'high') {
    recommendedActions.push('Reduce position sizes by 50%');
    recommendedActions.push('Tighten stop-losses');
    recommendedActions.push('Consider pausing trading');
  } else if (level === 'medium') {
    recommendedActions.push('Reduce position sizes by 25%');
    recommendedActions.push('Increase entry confidence threshold');
  }

  return {
    level,
    reasons,
    recommendedActions,
    validForHours: 4
  };
}

/**
 * Determine if LLM analysis is needed
 */
function shouldUseLLM(analysis: DeterministicAnalysis): boolean {
  return (
    analysis.contradictions.length >= DEFAULT_OMEGA10_CONFIG.contradictionThreshold ||
    analysis.driftWarnings.length >= DEFAULT_OMEGA10_CONFIG.driftThreshold ||
    analysis.confidenceVariance > DEFAULT_OMEGA10_CONFIG.confidenceVarianceThreshold ||
    analysis.overconfidenceScore > 70 ||
    analysis.patternDriftScore > 50
  );
}

/**
 * LAYER 2: LLM META-REASONING
 * Called only for complex system-level analysis
 */
async function runLLMMetaAnalysis(
  input: Omega10Input,
  deterministicAnalysis: DeterministicAnalysis
): Promise<LLMMetaAnalysis> {
  try {
    const prompt = buildLLMPrompt(input, deterministicAnalysis);

    const response = await openaiProxyClient.chat({
      messages: [
        {
          role: 'system',
          content: 'You are Omega-10, meta-reasoning specialist. Analyze system-level intelligence. Return JSON only.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 500,
      requestType: 'omega10_meta_reasoning',
      endpoint: 'omega10-meta'
    });

    // Log token usage
    await llmTokenTracker.logUsage({
      brainName: 'Omega-10',
      model: 'gpt-4o-mini',
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
      contextType: 'optimization',
      userId: input.userId || undefined,
      sessionId: undefined
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);

    return {
      faults: parsed.faults || [],
      adjustments: parsed.adjustments || [],
      omegaWeightChanges: parsed.omegaWeightChanges || {},
      strategyModeRecommendation: parsed.strategyModeRecommendation || null,
      memoryUpdate: parsed.memoryUpdate || null,
      metaConfidence: parsed.metaConfidence || 70,
      reasoning: parsed.reasoning || 'No reasoning provided'
    };
  } catch (error) {
    console.error('[Omega-10] LLM analysis failed:', error);
    return {
      faults: [],
      adjustments: [],
      omegaWeightChanges: {},
      strategyModeRecommendation: null,
      memoryUpdate: null,
      metaConfidence: 50,
      reasoning: 'LLM analysis failed'
    };
  }
}

/**
 * Build ultra-compressed LLM prompt
 */
function buildLLMPrompt(
  input: Omega10Input,
  analysis: DeterministicAnalysis
): string {
  const alphaStance = input.recentAlphaDecisions.length > 0
    ? `${input.recentAlphaDecisions[0].decision} (conf: ${input.recentAlphaDecisions[0].confidence})`
    : 'No recent decisions';

  const omegaSummary = input.recentOmegaVotes.length > 0
    ? JSON.stringify(input.recentOmegaVotes[0]).slice(0, 200)
    : 'No recent votes';

  const tradeSummary = {
    total: input.tradeHistory.length,
    wins: input.tradeHistory.filter(t => t.outcome === 'win').length,
    losses: input.tradeHistory.filter(t => t.outcome === 'loss').length,
    recentStreak: input.performanceStats.recentStreak
  };

  return `You are Omega-10, meta-reasoning supervisor. Analyze the SYSTEM, not charts. Return JSON only.

alpha: ${alphaStance}
omegas: ${omegaSummary}
contradictions: ${JSON.stringify(analysis.contradictions.slice(0, 3))}
drift: ${JSON.stringify(analysis.driftWarnings.slice(0, 3))}
confCalibration: {predicted: avg, actual: ${input.performanceStats.overall.winRate}, variance: ${analysis.confidenceVariance}}
recentTrades: ${JSON.stringify(tradeSummary)}
riskHorizon: ${analysis.riskHorizon.level}

Task: Identify system reasoning faults, recommend adjustments
Return JSON:
{
  "faults": ["description"],
  "adjustments": ["action"],
  "omegaWeightChanges": {"omega_name": 1.2},
  "strategyModeRecommendation": "trend|range|reversal|null",
  "memoryUpdate": {"pattern": "...", "action": "...", "reason": "..."},
  "metaConfidence": 0-100,
  "reasoning": "brief"
}`;
}

/**
 * Generate strategy adjustments from analysis
 */
function generateStrategyAdjustments(
  deterministicAnalysis: DeterministicAnalysis,
  llmAnalysis: LLMMetaAnalysis | null
): StrategyAdjustment[] {
  const adjustments: StrategyAdjustment[] = [];

  if (deterministicAnalysis.riskHorizon.level === 'high') {
    adjustments.push({
      type: 'risk_reduction',
      target: 'position_sizing',
      action: 'Reduce position sizes by 50%',
      reason: 'High risk horizon detected',
      priority: 'high'
    });
  }

  for (const warning of deterministicAnalysis.driftWarnings) {
    if (warning.severity === 'high' && warning.suggestedAction) {
      adjustments.push({
        type: 'pattern_avoidance',
        target: warning.pattern,
        action: warning.suggestedAction,
        reason: warning.description,
        priority: 'high'
      });
    }
  }

  if (llmAnalysis) {
    for (const adjustment of llmAnalysis.adjustments) {
      adjustments.push({
        type: 'strategy_mode',
        target: 'system',
        action: adjustment,
        reason: 'LLM recommendation',
        priority: 'medium'
      });
    }
  }

  return adjustments;
}

/**
 * Generate Omega weight overrides
 */
function generateOmegaWeightOverrides(
  deterministicAnalysis: DeterministicAnalysis,
  llmAnalysis: LLMMetaAnalysis | null
): Record<string, number> {
  const overrides: Record<string, number> = {};

  if (deterministicAnalysis.riskHorizon.level === 'high') {
    overrides['risk'] = 1.3;
  }

  if (deterministicAnalysis.driftWarnings.some(w => w.type === 'regime_mismatch')) {
    overrides['trend'] = 1.2;
  }

  if (llmAnalysis?.omegaWeightChanges) {
    Object.assign(overrides, llmAnalysis.omegaWeightChanges);
  }

  return overrides;
}

/**
 * Generate memory update for strategy learning
 */
function generateMemoryUpdate(
  deterministicAnalysis: DeterministicAnalysis,
  llmAnalysis: LLMMetaAnalysis | null
): MemoryUpdate | null {
  if (llmAnalysis?.memoryUpdate) {
    return {
      pattern: llmAnalysis.memoryUpdate.pattern,
      successRateChange: -10,
      recommendation: llmAnalysis.memoryUpdate.action,
      source: 'omega10',
      confidence: llmAnalysis.metaConfidence
    };
  }

  for (const warning of deterministicAnalysis.driftWarnings) {
    if (warning.severity === 'high') {
      return {
        pattern: warning.pattern,
        successRateChange: -15,
        recommendation: warning.suggestedAction || 'Avoid pattern temporarily',
        source: 'omega10',
        confidence: 80
      };
    }
  }

  return null;
}

/**
 * Calculate overall meta-confidence
 */
function calculateMetaConfidence(
  deterministicAnalysis: DeterministicAnalysis,
  llmAnalysis: LLMMetaAnalysis | null
): number {
  let confidence = 70;

  if (deterministicAnalysis.contradictions.length === 0) confidence += 10;
  if (deterministicAnalysis.driftWarnings.length === 0) confidence += 10;
  if (deterministicAnalysis.confidenceIssues.length === 0) confidence += 10;

  if (llmAnalysis) {
    confidence = (confidence + llmAnalysis.metaConfidence) / 2;
  }

  return Math.min(100, Math.max(0, confidence));
}

/**
 * Calculate next review time
 */
function calculateNextReviewTime(
  deterministicAnalysis: DeterministicAnalysis,
  baseIntervalHours: number
): Date {
  let intervalHours = baseIntervalHours;

  if (deterministicAnalysis.riskHorizon.level === 'high') {
    intervalHours = 2;
  } else if (deterministicAnalysis.driftWarnings.length >= 2) {
    intervalHours = 3;
  }

  return new Date(Date.now() + intervalHours * 60 * 60 * 1000);
}

/**
 * Log summary of Omega-10 analysis
 */
function logOmega10Summary(result: Omega10Result): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🧠 OMEGA-10 META-REASONING SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (result.contradictions.length > 0) {
    console.log(`⚠️  ${result.contradictions.length} CONTRADICTIONS DETECTED:`);
    result.contradictions.forEach(c => console.log(`   - ${c.description}`));
  }

  if (result.driftWarnings.length > 0) {
    console.log(`📉 ${result.driftWarnings.length} DRIFT WARNINGS:`);
    result.driftWarnings.forEach(w => console.log(`   - ${w.description}`));
  }

  if (result.confidenceIssues.length > 0) {
    console.log(`🎯 ${result.confidenceIssues.length} CONFIDENCE ISSUES:`);
    result.confidenceIssues.forEach(i => console.log(`   - ${i.description}`));
  }

  console.log(`\n🚨 RISK HORIZON: ${result.riskHorizon.level.toUpperCase()}`);
  result.riskHorizon.reasons.forEach(r => console.log(`   - ${r}`));

  if (result.strategyAdjustments.length > 0) {
    console.log(`\n🔧 ${result.strategyAdjustments.length} ADJUSTMENTS RECOMMENDED:`);
    result.strategyAdjustments.forEach(a => console.log(`   - ${a.action}`));
  }

  if (Object.keys(result.omegaWeightOverrides).length > 0) {
    console.log(`\n⚖️  OMEGA WEIGHT OVERRIDES:`);
    Object.entries(result.omegaWeightOverrides).forEach(([omega, weight]) => {
      console.log(`   - ${omega}: ${weight.toFixed(2)}x`);
    });
  }

  console.log(`\n✅ Meta-Confidence: ${result.metaConfidence}%`);
  console.log(`⏰ Next Review: ${result.nextReviewAt.toLocaleTimeString()}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

export default {
  runOmega10MetaReasoning
};
