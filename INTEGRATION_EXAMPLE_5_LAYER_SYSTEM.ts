/**
 * INTEGRATION EXAMPLE: 5-Layer LLM Decision Stack
 *
 * This file demonstrates how to integrate the new 5-layer system
 * into the existing event-based-llm-engine.ts
 *
 * DO NOT import this file directly - use it as a reference for updating
 * event-based-llm-engine.ts
 */

import { avoidPatternEnforcer } from './src/services/avoid-pattern-enforcer';
import { llmRegimeValidator } from './src/services/llm-regime-validator';
import { llmSetupQuality } from './src/services/llm-setup-quality';
import { llmMistakePrevention } from './src/services/llm-mistake-prevention';
import { llmConfidenceCalibrator } from './src/services/llm-confidence-calibrator';
import { developerModeLogger } from './src/services/developer-mode-logger';
import { MarketSnapshot } from './src/services/trigger-detection-rules';

/**
 * EXAMPLE INTEGRATION: Complete 5-Layer Pipeline
 *
 * Replace the single LLM call in event-based-llm-engine.ts
 * with this complete pipeline
 */
export async function analyzeTrigger5LayerPipeline(
  userId: string,
  sessionId: string | null,
  symbol: string,
  timeframe: string,
  snapshot: MarketSnapshot,
  triggerType: string,
  triggerConfidence: number
): Promise<{
  decision: 'BUY' | 'SELL' | 'NO_TRADE';
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence?: number;
  calibratedConfidence?: number;
  reasoning: string;
  layerResults: any;
}> {
  console.log('\n========================================');
  console.log('🚀 STARTING 5-LAYER LLM PIPELINE');
  console.log(`Symbol: ${symbol} | Trigger: ${triggerType} | Confidence: ${triggerConfidence}%`);
  console.log('========================================\n');

  const pipelineStart = Date.now();
  const layerResults: any = {};

  // ============================================================
  // HARD GATE: Avoid Pattern Enforcer
  // BLOCKS BEFORE ANY LLM CALLS
  // ============================================================
  console.log('[HARD GATE] 🚫 Checking avoid patterns...');
  const hardGateStart = Date.now();

  const avoidResult = await avoidPatternEnforcer.enforceAvoidPatterns(
    userId,
    snapshot,
    triggerType,
    'moderate' // strict | moderate | lenient
  );

  layerResults.hardGate = {
    duration: Date.now() - hardGateStart,
    result: avoidResult
  };

  await developerModeLogger.logAvoidPatternEvent(
    symbol,
    triggerType,
    avoidResult.is_blocked,
    avoidResult.block_reason,
    avoidResult.matched_patterns
  );

  if (avoidResult.is_blocked) {
    console.log(`[HARD GATE] 🚫 BLOCKED: ${avoidResult.block_reason}`);

    await logPipelineCompletion(userId, sessionId, symbol, triggerType, {
      hardGateResult: 'blocked',
      layer1Passed: false,
      layer2Passed: false,
      layer3Passed: false,
      layer4Completed: false,
      layer5Executed: false,
      finalDecision: 'NO_TRADE',
      finalConfidence: null,
      calibratedConfidence: null,
      totalProcessingTimeMs: Date.now() - pipelineStart,
      totalTokensUsed: 0,
      layersExecuted: 0,
      abortLayer: 0,
      abortReason: avoidResult.block_reason
    });

    return {
      decision: 'NO_TRADE',
      reasoning: avoidResult.block_reason || 'Setup matches losing pattern',
      layerResults
    };
  }

  console.log('[HARD GATE] ✅ ALLOWED - Proceeding to Layer 1');

  // ============================================================
  // LAYER 1: Regime Validator
  // ============================================================
  console.log('\n[LAYER 1] 🔍 Regime Validation...');
  const layer1Start = Date.now();

  const regimeResult = await llmRegimeValidator.validateRegime(
    snapshot,
    triggerType,
    triggerConfidence
  );

  const layer1Duration = Date.now() - layer1Start;
  layerResults.layer1 = {
    duration: layer1Duration,
    result: regimeResult
  };

  await developerModeLogger.logLayerDecision(
    sessionId,
    symbol,
    1,
    'Regime Validator',
    regimeResult.recommendation,
    regimeResult,
    layer1Duration,
    200,
    regimeResult.regime_ok
  );

  if (!regimeResult.regime_ok || regimeResult.recommendation === 'abort') {
    console.log(`[LAYER 1] ❌ REJECTED: ${regimeResult.reasoning}`);

    await logPipelineCompletion(userId, sessionId, symbol, triggerType, {
      hardGateResult: 'allowed',
      layer1Passed: false,
      layer2Passed: false,
      layer3Passed: false,
      layer4Completed: false,
      layer5Executed: false,
      finalDecision: 'NO_TRADE',
      finalConfidence: null,
      calibratedConfidence: null,
      totalProcessingTimeMs: Date.now() - pipelineStart,
      totalTokensUsed: 200,
      layersExecuted: 1,
      abortLayer: 1,
      abortReason: regimeResult.reasoning
    });

    return {
      decision: 'NO_TRADE',
      reasoning: `Regime validation failed: ${regimeResult.reasoning}`,
      layerResults
    };
  }

  console.log(`[LAYER 1] ✅ PASSED - Regime: ${regimeResult.detected_regime.trend} / ${regimeResult.detected_regime.volatility}`);

  // ============================================================
  // LAYER 2: Setup Quality Scorer
  // ============================================================
  console.log('\n[LAYER 2] 📊 Setup Quality Scoring...');
  const layer2Start = Date.now();

  const qualityResult = await llmSetupQuality.scoreSetup(
    snapshot,
    triggerType,
    triggerConfidence,
    regimeResult,
    65 // threshold
  );

  const layer2Duration = Date.now() - layer2Start;
  layerResults.layer2 = {
    duration: layer2Duration,
    result: qualityResult
  };

  await developerModeLogger.logLayerDecision(
    sessionId,
    symbol,
    2,
    'Setup Quality',
    qualityResult.recommendation,
    qualityResult,
    layer2Duration,
    300,
    qualityResult.meets_threshold
  );

  if (!qualityResult.meets_threshold) {
    console.log(`[LAYER 2] ❌ REJECTED: Quality score ${qualityResult.quality_score}/100`);

    await logPipelineCompletion(userId, sessionId, symbol, triggerType, {
      hardGateResult: 'allowed',
      layer1Passed: true,
      layer2Passed: false,
      layer3Passed: false,
      layer4Completed: false,
      layer5Executed: false,
      finalDecision: 'NO_TRADE',
      finalConfidence: null,
      calibratedConfidence: null,
      totalProcessingTimeMs: Date.now() - pipelineStart,
      totalTokensUsed: 500,
      layersExecuted: 2,
      abortLayer: 2,
      abortReason: qualityResult.reasoning
    });

    return {
      decision: 'NO_TRADE',
      reasoning: `Setup quality insufficient: ${qualityResult.reasoning}`,
      layerResults
    };
  }

  console.log(`[LAYER 2] ✅ PASSED - Quality: ${qualityResult.quality_score}/100 (${qualityResult.recommendation})`);

  // ============================================================
  // LAYER 3: Mistake Prevention Brain
  // ============================================================
  console.log('\n[LAYER 3] 🛡️ Mistake Prevention Check...');
  const layer3Start = Date.now();

  const mistakeResult = await llmMistakePrevention.checkForMistakes(
    userId,
    snapshot,
    triggerType,
    regimeResult,
    qualityResult
  );

  const layer3Duration = Date.now() - layer3Start;
  layerResults.layer3 = {
    duration: layer3Duration,
    result: mistakeResult
  };

  await developerModeLogger.logLayerDecision(
    sessionId,
    symbol,
    3,
    'Mistake Prevention',
    mistakeResult.recommendation,
    mistakeResult,
    layer3Duration,
    300,
    mistakeResult.allow_trade
  );

  if (!mistakeResult.allow_trade || mistakeResult.recommendation === 'block') {
    console.log(`[LAYER 3] 🚫 BLOCKED: ${mistakeResult.preventive_reasoning}`);

    await logPipelineCompletion(userId, sessionId, symbol, triggerType, {
      hardGateResult: 'allowed',
      layer1Passed: true,
      layer2Passed: true,
      layer3Passed: false,
      layer4Completed: false,
      layer5Executed: false,
      finalDecision: 'NO_TRADE',
      finalConfidence: null,
      calibratedConfidence: null,
      totalProcessingTimeMs: Date.now() - pipelineStart,
      totalTokensUsed: 800,
      layersExecuted: 3,
      abortLayer: 3,
      abortReason: mistakeResult.preventive_reasoning
    });

    return {
      decision: 'NO_TRADE',
      reasoning: `Mistake prevention: ${mistakeResult.preventive_reasoning}`,
      layerResults
    };
  }

  console.log(`[LAYER 3] ✅ PASSED - Risk Level: ${mistakeResult.risk_level}`);

  // ============================================================
  // LAYER 4: Confidence Calibrator
  // ============================================================
  console.log('\n[LAYER 4] 🎯 Confidence Calibration...');
  const layer4Start = Date.now();

  const calibrationResult = await llmConfidenceCalibrator.calibrateConfidence(
    userId,
    symbol,
    triggerConfidence,
    {
      triggerType,
      regimeQuality: regimeResult.confidence_in_regime,
      setupQuality: qualityResult.quality_score,
      riskLevel: mistakeResult.risk_level
    }
  );

  const layer4Duration = Date.now() - layer4Start;
  layerResults.layer4 = {
    duration: layer4Duration,
    result: calibrationResult
  };

  await developerModeLogger.logLayerDecision(
    sessionId,
    symbol,
    4,
    'Confidence Calibrator',
    calibrationResult.recommendation,
    calibrationResult,
    layer4Duration,
    200,
    true
  );

  const adjustment = calibrationResult.calibrated_confidence - triggerConfidence;
  console.log(`[LAYER 4] ✅ COMPLETE - ${triggerConfidence}% → ${calibrationResult.calibrated_confidence}% (${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)}%)`);

  // ============================================================
  // LAYER 5: Execution Brain
  // (Use existing llmStrategyBrain or similar)
  // ============================================================
  console.log('\n[LAYER 5] 🎯 Execution Decision...');
  const layer5Start = Date.now();

  // NOTE: This is a placeholder - replace with actual execution brain call
  const executionResult = await callExecutionBrain(
    snapshot,
    calibrationResult.calibrated_confidence
  );

  const layer5Duration = Date.now() - layer5Start;
  layerResults.layer5 = {
    duration: layer5Duration,
    result: executionResult
  };

  await developerModeLogger.logLayerDecision(
    sessionId,
    symbol,
    5,
    'Execution Brain',
    executionResult.decision,
    executionResult,
    layer5Duration,
    500,
    true
  );

  console.log(`[LAYER 5] ✅ DECISION: ${executionResult.decision} @ ${executionResult.entry?.toFixed(5)}`);

  // ============================================================
  // Log Complete Pipeline
  // ============================================================
  const totalDuration = Date.now() - pipelineStart;

  await logPipelineCompletion(userId, sessionId, symbol, triggerType, {
    hardGateResult: 'allowed',
    layer1Passed: true,
    layer2Passed: true,
    layer3Passed: true,
    layer4Completed: true,
    layer5Executed: true,
    finalDecision: executionResult.decision,
    finalConfidence: triggerConfidence,
    calibratedConfidence: calibrationResult.calibrated_confidence,
    totalProcessingTimeMs: totalDuration,
    totalTokensUsed: 1500,
    layersExecuted: 5,
    abortLayer: null,
    abortReason: null
  });

  console.log('\n========================================');
  console.log('✅ PIPELINE COMPLETE');
  console.log(`Total Duration: ${totalDuration}ms`);
  console.log(`Total Tokens: ~1500`);
  console.log(`Final Decision: ${executionResult.decision}`);
  console.log('========================================\n');

  return {
    decision: executionResult.decision,
    entry: executionResult.entry,
    stopLoss: executionResult.stopLoss,
    takeProfit: executionResult.takeProfit,
    confidence: triggerConfidence,
    calibratedConfidence: calibrationResult.calibrated_confidence,
    reasoning: executionResult.reasoning,
    layerResults
  };
}

/**
 * Placeholder for execution brain call
 * Replace with actual llmStrategyBrain.analyze() or similar
 */
async function callExecutionBrain(
  snapshot: MarketSnapshot,
  calibratedConfidence: number
): Promise<any> {
  // This is where you'd call the existing Layer 5 execution brain
  // For now, returning placeholder structure
  const currentPrice = snapshot.ohlc[snapshot.ohlc.length - 1].close;
  const atr = snapshot.indicators.atr;

  return {
    decision: 'BUY',
    entry: currentPrice,
    stopLoss: currentPrice - (atr * 1.5),
    takeProfit: currentPrice + (atr * 2.5),
    confidence: calibratedConfidence,
    reasoning: 'Setup passed all 5 layers with calibrated confidence'
  };
}

/**
 * Helper to log pipeline completion
 */
async function logPipelineCompletion(
  userId: string,
  sessionId: string | null,
  symbol: string,
  triggerType: string,
  data: any
): Promise<void> {
  await developerModeLogger.logPipelineExecution(
    sessionId,
    symbol,
    triggerType,
    data
  );
}

/**
 * USAGE EXAMPLE: How to call this from event-based-llm-engine.ts
 */
export async function exampleUsage() {
  const userId = 'user-123';
  const sessionId = 'session-456';
  const symbol = 'EURUSD';
  const timeframe = 'M15';

  // Build snapshot (use existing snapshot builder)
  const snapshot: MarketSnapshot = {
    symbol,
    timestamp: new Date(),
    ohlc: [], // populated by snapshot builder
    indicators: {
      vwap: 1.0850,
      ema20: 1.0845,
      ema50: 1.0840,
      atr: 0.0015,
      volumeBaseline: 1000
    },
    priceAction: {
      trend: 'bullish',
      volatility: 'medium',
      momentum: 0.5
    }
  };

  // Trigger detected
  const triggerType = 'vwap_touch';
  const triggerConfidence = 75;

  // Run through 5-layer pipeline
  const result = await analyzeTrigger5LayerPipeline(
    userId,
    sessionId,
    symbol,
    timeframe,
    snapshot,
    triggerType,
    triggerConfidence
  );

  console.log('Pipeline Result:', result);

  // If decision is BUY or SELL, execute trade
  if (result.decision !== 'NO_TRADE') {
    console.log(`Executing ${result.decision} trade at ${result.entry}`);
    // Execute trade logic here
  }
}
