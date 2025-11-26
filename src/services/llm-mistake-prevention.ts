import { supabase } from '../lib/supabase';
import { MarketSnapshot } from './trigger-detection-rules';
import { RegimeValidationResult } from './llm-regime-validator';
import { SetupQualityResult } from './llm-setup-quality';
import { openaiProxyClient } from './openai-proxy-client';
import { llmCostOptimizer } from './llm-cost-optimizer';
import { llmResponseCache } from './llm-response-cache';
import { compressSnapshot, buildCompressedMistakePrompt } from './llm-prompt-compressor';
import { calculateCost } from '../config/llm-optimization-config';

export interface MistakePreventionResult {
  allow_trade: boolean;
  trade_action: 'allow' | 'adjust' | 'block';
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  mistake_flags: string[];
  similar_losing_patterns_found: number;
  correlated_loss_risk: boolean;
  recent_loss_context: {
    consecutive_losses: number;
    recent_loss_rate: number;
    needs_cooling_off: boolean;
  };
  warnings: string[];
  preventive_reasoning: string;
  recommendation: 'allow' | 'warn' | 'block';
  adjusted_parameters?: {
    risk_pct?: number;
    stop_loss_pips?: number;
    take_profit_pips?: number;
    confidence_adjustment?: number;
    min_trend_strength?: number;
  };
  adaptation_notes?: {
    reason: string;
    similarity_score: number;
    weighted_similarity: number;
    age_factor: number;
    patterns_matched: number;
    adjustments_summary: string;
  };
}

class LLMMistakePrevention {
  private enabled: boolean = true;
  private callCount: number = 0;

  constructor() {
    console.log('[LLM Mistake Prevention] 🛡️ Layer 3 initialized (optimized mode)');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async checkForMistakes(
    userId: string,
    snapshot: MarketSnapshot,
    triggerType: string,
    regimeValidation: RegimeValidationResult,
    setupQuality: SetupQualityResult,
    skillContext?: any,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<MistakePreventionResult> {
    if (!this.enabled) {
      return this.createFallbackCheck(userId, snapshot);
    }

    console.log(`\n[LLM Layer 3 - Mistake Prevention] 🛡️ Checking for mistakes on ${snapshot.symbol}`);
    const startTime = Date.now();

    try {
      // In backtest mode, skip correlated loss check (it's for live trading protection)
      // Use default/minimal loss context to avoid querying stale simulated data
      const [losingPatterns, recentLosses, correlatedLosses] = isBacktest
        ? await Promise.all([
            this.getLosingPatternsWithAge(userId, snapshot.symbol),
            Promise.resolve({
              consecutive_losses: 0,
              recent_loss_rate: 0,
              total_recent_trades: 0,
              needs_cooling_off: false
            }),
            Promise.resolve(false) // No correlated risk in backtest
          ])
        : await Promise.all([
            this.getLosingPatternsWithAge(userId, snapshot.symbol),
            this.getRecentLossContext(userId),
            this.checkCorrelatedLossRisk(userId, snapshot.symbol)
          ]);

      // 🚨 CRITICAL SAFETY CHECKS - These bypass adaptive learning
      const criticalBlock = this.checkCriticalSafety(losingPatterns, recentLosses, correlatedLosses, isBacktest);
      if (criticalBlock) {
        console.log('[LLM Layer 3] 🚨 CRITICAL SAFETY BLOCK:', criticalBlock.reason);
        return criticalBlock;
      }

      // 🧠 ADAPTIVE LEARNING - Calculate adjustments instead of blocking
      const adaptiveResult = this.calculateAdaptiveAdjustments(
        losingPatterns,
        recentLosses,
        snapshot,
        setupQuality,
        isBacktest
      );

      if (adaptiveResult.trade_action === 'adjust') {
        console.log('[LLM Layer 3] ✨ ADAPTIVE LEARNING APPLIED');
        console.log(`  Similarity: ${adaptiveResult.adaptation_notes?.weighted_similarity.toFixed(2)} (age factor: ${adaptiveResult.adaptation_notes?.age_factor.toFixed(2)})`);
        console.log(`  ${adaptiveResult.adaptation_notes?.adjustments_summary}`);
        return adaptiveResult;
      }

      // Check cache first with improved specificity
      const currentPrice = snapshot.ohlc[snapshot.ohlc.length - 1]?.close || 0;
      const priceRange = Math.floor(currentPrice * 100) / 100; // Round to 2 decimals for grouping

      const cacheContext = {
        symbol: snapshot.symbol,
        quality: Math.floor(setupQuality.quality_score / 10) * 10,
        consecutive: recentLosses.consecutive_losses,
        similar: losingPatterns.length,
        priceRange: priceRange // Add price range for better specificity
      };

      const cached = llmResponseCache.get<MistakePreventionResult>('layer3_mistake', cacheContext);
      if (cached) {
        // Validate cached result - reject if block decision has empty reasoning
        if (!cached.allow_trade && (!cached.preventive_reasoning || cached.preventive_reasoning.trim() === '')) {
          console.warn('[LLM Layer 3] ⚠️ Cache hit but block decision has empty reasoning - invalidating cache');
          llmResponseCache.invalidate('layer3_mistake', cacheContext);
        } else {
          console.log('[LLM Layer 3] 💾 Cache hit - skipping API call');
          return cached;
        }
      }

      // Select optimal model
      const model = llmCostOptimizer.selectModel('layer3_mistake', { isBacktest });

      // Check rate limits
      const canProceed = await llmCostOptimizer.canMakeRequest(model);
      if (!canProceed) {
        console.warn('[LLM Layer 3] Rate limit reached, using fallback');
        return this.createFallbackCheck(userId, snapshot);
      }

      // Build compressed prompt
      const compactSnap = compressSnapshot(snapshot);
      const prompt = buildCompressedMistakePrompt(
        compactSnap,
        setupQuality.quality_score,
        regimeValidation.confidence_in_regime,
        {
          consec: recentLosses.consecutive_losses,
          loss_rate: recentLosses.recent_loss_rate,
          similar: losingPatterns.length,
          corr_risk: correlatedLosses
        }
      );

      // Call LLM
      const response = await this.callLLM(prompt, model);
      const result = this.parsePreventionResult(response.content, losingPatterns.length);

      // Track usage
      llmCostOptimizer.trackRequest(model);
      this.callCount++;

      // Calculate and log cost
      const cost = calculateCost(model, response.usage.prompt_tokens, response.usage.completion_tokens);
      console.log(`[LLM Layer 3] Model: ${model}, Tokens: ${response.usage.total_tokens}, Cost: $${cost.toFixed(4)}`);

      if (sessionId) {
        await llmCostOptimizer.logCost(
          userId,
          sessionId,
          'layer3_mistake',
          model,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          cost,
          { triggerType, symbol: snapshot.symbol, allow: result.allow_trade }
        );
      }

      // Cache result with shorter TTL for block decisions (30s vs 60s)
      const cacheTTL = result.allow_trade ? 60 : 30;
      llmResponseCache.set('layer3_mistake', cacheContext, result, cacheTTL);

      const duration = Date.now() - startTime;
      const actionEmoji = result.allow_trade ? '✅ ALLOW' : '🚫 BLOCK';
      console.log(`[LLM Layer 3] ${actionEmoji} (${duration}ms)`);
      console.log(`  Risk Level: ${result.risk_level}`);

      // Track adaptation effectiveness if this was an adapted trade
      if (result.trade_action === 'adjust' && sessionId) {
        await this.trackAdaptation(userId, sessionId, result, snapshot.symbol);
      }

      return result;
    } catch (error) {
      console.error('[LLM Layer 3] Error:', error);
      return this.createFallbackCheck(userId, snapshot);
    }
  }

  private async getLosingPatternsWithAge(userId: string, symbol: string): Promise<any[]> {
    try {
      const { data: patterns } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('insight_type', 'losing_pattern')
        .gte('confidence_score', 60)
        .order('confidence_score', { ascending: false })
        .limit(10);

      if (!patterns) return [];

      // Add age calculation to each pattern
      const now = Date.now();
      return patterns.map(p => ({
        ...p,
        age_days: (now - new Date(p.created_at).getTime()) / (24 * 60 * 60 * 1000)
      }));
    } catch (error) {
      console.error('[Mistake Prevention] Error fetching losing patterns:', error);
      return [];
    }
  }

  private async getLosingPatterns(userId: string, symbol: string): Promise<any[]> {
    // Backward compatibility wrapper
    return this.getLosingPatternsWithAge(userId, symbol);
  }

  private async getRecentLossContext(userId: string): Promise<any> {
    try {
      const { data: recentTrades } = await supabase
        .from('trade_history')
        .select('outcome, profit_loss')
        .eq('user_id', userId)
        .order('closed_at', { ascending: false })
        .limit(20);

      if (!recentTrades || recentTrades.length === 0) {
        return {
          consecutive_losses: 0,
          recent_loss_rate: 0,
          total_recent_trades: 0,
          needs_cooling_off: false
        };
      }

      let consecutiveLosses = 0;
      for (const trade of recentTrades) {
        if (trade.outcome === 'loss') {
          consecutiveLosses++;
        } else {
          break;
        }
      }

      const losses = recentTrades.filter(t => t.outcome === 'loss').length;
      const lossRate = (losses / recentTrades.length) * 100;

      return {
        consecutive_losses: consecutiveLosses,
        recent_loss_rate: lossRate,
        total_recent_trades: recentTrades.length,
        needs_cooling_off: consecutiveLosses >= 3 || lossRate > 60
      };
    } catch (error) {
      console.error('[Mistake Prevention] Error fetching recent losses:', error);
      return {
        consecutive_losses: 0,
        recent_loss_rate: 0,
        total_recent_trades: 0,
        needs_cooling_off: false
      };
    }
  }

  private async checkCorrelatedLossRisk(userId: string, symbol: string): Promise<boolean> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: recentLosses } = await supabase
        .from('trade_history')
        .select('symbol')
        .eq('user_id', userId)
        .eq('outcome', 'loss')
        .gte('closed_at', oneDayAgo);

      if (!recentLosses || recentLosses.length === 0) return false;

      const symbolLosses = recentLosses.filter(t => t.symbol === symbol).length;
      return symbolLosses >= 3;
    } catch (error) {
      return false;
    }
  }

  private buildPreventionPrompt(
    snapshot: MarketSnapshot,
    triggerType: string,
    regimeValidation: RegimeValidationResult,
    setupQuality: SetupQualityResult,
    losingPatterns: any[],
    recentLosses: any,
    correlatedLossRisk: boolean,
    skillContext?: any
  ): string {
    const currentCandle = snapshot.ohlc[snapshot.ohlc.length - 1];

    let losingPatternsText = 'None on record';
    if (losingPatterns.length > 0) {
      losingPatternsText = losingPatterns.map((p, i) =>
        `  ${i + 1}. "${p.insight_title}" (confidence: ${p.confidence_score}%)\n     ${p.insight_description}\n     Avoid when: ${p.avoid_when_conditions?.when || 'N/A'}`
      ).join('\n\n');
    }

    let prompt = `You are the Mistake Prevention Brain (Layer 3 of 5) in Pipnosis AI Trading System.

Your critical responsibility: BLOCK this trade if it matches past mistakes or shows high risk of repeating losses.`;

    if (skillContext) {
      prompt += `

SKILL LEVEL CONTEXT & BLOCKING GUIDANCE:
Current Level: ${skillContext.currentLevel} → Target: ${skillContext.targetLevel}
Win Rate Gap: ${skillContext.gaps.winRateGap > 0 ? '+' : ''}${skillContext.gaps.winRateGap.toFixed(1)}%
Consistency Gap: ${skillContext.gaps.consistencyGap > 0 ? '+' : ''}${skillContext.gaps.consistencyGap.toFixed(1)}%

MISTAKE PREVENTION GUIDANCE:
${skillContext.gaps.winRateGap < -10
  ? `CRITICAL: Win rate severely low. Be EXTREMELY aggressive in blocking marginal setups.
     Block if ANY similarity to past losses OR if recent loss rate > 40%.`
  : skillContext.gaps.winRateGap < -5
  ? `Win rate below target. Be MORE aggressive blocking. Block if recent loss rate > 50% OR 2+ consecutive losses.`
  : skillContext.gaps.winRateGap < 0
  ? `Win rate slightly below. Standard blocking criteria with slight bias toward caution.`
  : `Win rate on target. Standard blocking criteria.`}
${skillContext.gaps.consistencyGap < 0
  ? `Consistency needs improvement. Block if correlated loss risk is present OR pattern similarity > 60%.`
  : ''}
${recentLosses.consecutive_losses >= 3 && skillContext.gaps.winRateGap < 0
  ? `⚠️ 3+ consecutive losses + low win rate = MANDATORY cooling-off period. BLOCK this trade.`
  : ''}`;
    }

    prompt += `

PREVIOUS LAYERS PASSED:
✅ Layer 1 - Regime validated: ${regimeValidation.detected_regime.trend} / ${regimeValidation.detected_regime.volatility}
✅ Layer 2 - Setup quality: ${setupQuality.quality_score}/100 (${setupQuality.recommendation})

CURRENT SETUP:
Symbol: ${snapshot.symbol}
Trigger: ${triggerType}
Price: ${currentCandle?.close?.toFixed(5) || 'N/A'}
Trend: ${snapshot.priceAction?.trend || 'unknown'}
Volatility: ${snapshot.priceAction?.volatility || 'unknown'}

RECENT LOSS CONTEXT (Last 20 trades):
⚠️ Consecutive Losses: ${recentLosses.consecutive_losses}
⚠️ Recent Loss Rate: ${recentLosses.recent_loss_rate.toFixed(1)}%
⚠️ Needs Cooling Off: ${recentLosses.needs_cooling_off ? 'YES' : 'NO'}
⚠️ Correlated Loss Risk on ${snapshot.symbol}: ${correlatedLossRisk ? 'HIGH' : 'LOW'}

KNOWN LOSING PATTERNS FOR ${snapshot.symbol}:
${losingPatternsText}

Your task:
1. Check if current setup matches any losing patterns
2. Assess if trader needs cooling-off period (too many recent losses)
3. Check for correlated loss risk (repeated losses on same symbol)
4. Identify specific mistake flags
5. Make ALLOW/WARN/BLOCK recommendation

RED FLAGS that should trigger BLOCK:
- 3+ consecutive losses (currently: ${recentLosses.consecutive_losses})
- Loss rate > 60% in last 20 trades (currently: ${recentLosses.recent_loss_rate.toFixed(1)}%)
- Current setup matches high-confidence losing pattern
- 3+ losses on this symbol in last 24h

Respond in this EXACT JSON format (no markdown):
{
  "allow_trade": <true/false>,
  "risk_level": "<low/medium/high/critical>",
  "mistake_flags": ["<flag 1>", "<flag 2>"],
  "similar_losing_patterns_found": <number of patterns that match>,
  "correlated_loss_risk": <true if symbol has recent losses>,
  "warnings": ["<warning 1>", "<warning 2>"],
  "preventive_reasoning": "<why you're blocking or allowing, reference specific patterns if blocking>",
  "recommendation": "<allow/warn/block>"
}

Be RUTHLESS. When in doubt, BLOCK. Protecting capital is priority #1.`;

    return prompt;
  }

  private async callLLM(prompt: string, model: 'gpt-4o' | 'gpt-4o-mini'): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    const response = await openaiProxyClient.chat({
      messages: [
        {
          role: 'system',
          content: 'Mistake prevention. Protect capital. When in doubt, block.'
        },
        { role: 'user', content: prompt }
      ],
      model: model,
      temperature: 0.1,
      max_tokens: 200,
      requestType: 'layer-3-mistake-prevention',
      endpoint: 'llm-mistake-prevention'
    });

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage
    };
  }

  private parsePreventionResult(content: string, patternCount: number): MistakePreventionResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    // Handle BOTH compressed format and full format
    // Compressed: {allow, risk, flags, rec}
    // Full: {allow_trade, risk_level, mistake_flags, recommendation}

    const isCompressed = 'allow' in parsed && !('allow_trade' in parsed);

    let allowTrade: boolean;
    let riskLevel: string;
    let mistakeFlags: string[];
    let recommendation: string;

    if (isCompressed) {
      allowTrade = parsed.allow ?? true;
      riskLevel = parsed.risk || 'medium';
      mistakeFlags = parsed.flags || [];
      recommendation = parsed.rec || 'allow';
    } else {
      allowTrade = parsed.allow_trade ?? true;
      riskLevel = parsed.risk_level || 'medium';
      mistakeFlags = parsed.mistake_flags || [];
      recommendation = parsed.recommendation || 'allow';
    }

    // Extract reasoning - check all possible field names
    // Priority: why (compressed) → preventive_reasoning (full) → reasoning (legacy)
    let reasoning = parsed.why || parsed.preventive_reasoning || parsed.reasoning || '';

    // Generate intelligent fallback reasoning if empty
    if (!reasoning || reasoning.trim() === '') {
      if (!allowTrade) {
        // Block decision - construct detailed reasoning from available data
        const reasons: string[] = [];

        if (mistakeFlags.length > 0) {
          reasons.push(`Flags: ${mistakeFlags.join(', ')}`);
        }
        if (parsed.correlated_loss_risk) {
          reasons.push('correlated loss risk detected');
        }
        if (parsed.similar_losing_patterns_found > 0) {
          reasons.push(`${parsed.similar_losing_patterns_found} similar losing patterns found`);
        }

        reasoning = reasons.length > 0
          ? `Trade blocked. ${reasons.join('; ')}.`
          : `Trade blocked by Layer 3. Risk level: ${riskLevel}.`;

        console.warn('[LLM Layer 3] ⚠️ Block decision with empty reasoning - using fallback');
      } else {
        // Allow decision - simple fallback
        reasoning = 'No significant red flags detected.';
      }
    }

    return {
      allow_trade: allowTrade,
      trade_action: allowTrade ? 'allow' : 'block',
      risk_level: riskLevel,
      mistake_flags: mistakeFlags,
      similar_losing_patterns_found: parsed.similar_losing_patterns_found || patternCount,
      correlated_loss_risk: parsed.correlated_loss_risk || false,
      recent_loss_context: {
        consecutive_losses: 0,
        recent_loss_rate: 0,
        needs_cooling_off: false
      },
      warnings: parsed.warnings || [],
      preventive_reasoning: reasoning,
      recommendation: recommendation
    };
  }

  private async createFallbackCheck(userId: string, snapshot: MarketSnapshot): Promise<MistakePreventionResult> {
    const recentLosses = await this.getRecentLossContext(userId);

    const shouldBlock = recentLosses.consecutive_losses >= 3 || recentLosses.recent_loss_rate > 70;

    return {
      allow_trade: !shouldBlock,
      trade_action: shouldBlock ? 'block' : 'allow',
      risk_level: shouldBlock ? 'high' : 'medium',
      mistake_flags: shouldBlock ? ['Consecutive losses detected'] : [],
      similar_losing_patterns_found: 0,
      correlated_loss_risk: false,
      recent_loss_context: recentLosses,
      warnings: shouldBlock ? ['Cooling-off period recommended'] : [],
      preventive_reasoning: 'Fallback check: basic loss prevention based on recent trades',
      recommendation: shouldBlock ? 'block' : 'allow'
    };
  }

  private checkCriticalSafety(
    patterns: any[],
    recentLosses: any,
    correlatedLosses: boolean,
    isBacktest?: boolean
  ): MistakePreventionResult | null {
    // 1. Check for extremely dangerous patterns (90%+ loss rate)
    const dangerousPattern = patterns.find(p => {
      const lossRate = p.metadata?.loss_rate || 0;
      const sampleSize = p.metadata?.sample_size || 0;
      return lossRate >= 0.9 && sampleSize >= 5;
    });

    if (dangerousPattern) {
      return {
        allow_trade: false,
        trade_action: 'block',
        risk_level: 'critical',
        mistake_flags: ['Extremely dangerous pattern detected'],
        similar_losing_patterns_found: patterns.length,
        correlated_loss_risk: correlatedLosses,
        recent_loss_context: recentLosses,
        warnings: ['This pattern has 90%+ loss rate - not adaptable'],
        preventive_reasoning: `Critical safety block: Pattern "${dangerousPattern.insight_title}" has proven extremely dangerous (${(dangerousPattern.metadata.loss_rate * 100).toFixed(0)}% loss rate over ${dangerousPattern.metadata.sample_size} trades). This is not adaptable with parameter adjustments.`,
        recommendation: 'block'
      };
    }

    // 2. Only in LIVE trading: enforce cooling off period
    if (!isBacktest && recentLosses.consecutive_losses >= 5) {
      return {
        allow_trade: false,
        trade_action: 'block',
        risk_level: 'critical',
        mistake_flags: ['Mandatory cooling-off period'],
        similar_losing_patterns_found: patterns.length,
        correlated_loss_risk: correlatedLosses,
        recent_loss_context: recentLosses,
        warnings: ['5+ consecutive losses - mandatory break required'],
        preventive_reasoning: 'Critical safety: 5+ consecutive losses detected. Mandatory cooling-off period to prevent emotional/revenge trading.',
        recommendation: 'block'
      };
    }

    // 3. Extreme loss rate in live trading
    if (!isBacktest && recentLosses.recent_loss_rate > 80 && recentLosses.total_recent_trades >= 10) {
      return {
        allow_trade: false,
        trade_action: 'block',
        risk_level: 'critical',
        mistake_flags: ['Extreme loss rate detected'],
        similar_losing_patterns_found: patterns.length,
        correlated_loss_risk: correlatedLosses,
        recent_loss_context: recentLosses,
        warnings: ['80%+ loss rate - system needs review'],
        preventive_reasoning: `Critical safety: Loss rate of ${recentLosses.recent_loss_rate.toFixed(1)}% is extremely high. Trading paused for system review.`,
        recommendation: 'block'
      };
    }

    return null; // No critical safety issues
  }

  private calculateAdaptiveAdjustments(
    patterns: any[],
    recentLosses: any,
    snapshot: MarketSnapshot,
    setupQuality: SetupQualityResult,
    isBacktest?: boolean
  ): MistakePreventionResult {
    if (patterns.length === 0) {
      // No patterns - allow trade without adjustment
      return {
        allow_trade: true,
        trade_action: 'allow',
        risk_level: 'low',
        mistake_flags: [],
        similar_losing_patterns_found: 0,
        correlated_loss_risk: false,
        recent_loss_context: recentLosses,
        warnings: [],
        preventive_reasoning: 'No losing patterns detected for this symbol.',
        recommendation: 'allow'
      };
    }

    // Calculate similarity score (normalized 0-1)
    const similarityScore = Math.min(patterns.length / 10, 1);

    // Calculate pattern age factor (30-day decay)
    const avgAge = patterns.reduce((sum, p) => sum + (p.age_days || 0), 0) / patterns.length;
    const ageFactor = Math.max(0.3, 1 - (avgAge / 30));

    // Weighted similarity (age-adjusted)
    const weightedSimilarity = similarityScore * ageFactor;

    // Determine adjustment intensity based on weighted similarity
    let adjustmentLevel: 'small' | 'medium' | 'strong';
    if (weightedSimilarity < 0.3) {
      adjustmentLevel = 'small';
    } else if (weightedSimilarity < 0.6) {
      adjustmentLevel = 'medium';
    } else {
      adjustmentLevel = 'strong';
    }

    // Calculate risk adjustment
    const baseRiskPct = 2.0; // Default 2%
    const riskReduction = weightedSimilarity * 0.4; // Up to 40% reduction
    const adjustedRiskPct = Math.max(0.5, Math.min(5.0, baseRiskPct * (1 - riskReduction)));

    // Analyze patterns for SL/TP adjustments
    const slAnalysis = this.analyzeStopLossPatterns(patterns);
    const tpAnalysis = this.analyzeTakeProfitPatterns(patterns);

    // Calculate SL adjustment (if needed)
    let adjustedSL: number | undefined;
    if (slAnalysis.shouldWiden) {
      const widenFactor = 0.1 + (weightedSimilarity * 0.1); // 10-20% wider
      adjustedSL = 1 + widenFactor; // Multiplier: 1.1 to 1.2
    }

    // Calculate TP adjustment (if needed)
    let adjustedTP: number | undefined;
    if (tpAnalysis.shouldTighten) {
      const tightenFactor = 0.1 + (weightedSimilarity * 0.05); // 10-15% tighter
      adjustedTP = 1 - tightenFactor; // Multiplier: 0.85 to 0.9
    }

    // Confidence adjustment
    const confidenceAdjustment = -(weightedSimilarity * 5); // Up to -5 points

    // Build adjustment summary
    const adjustments: string[] = [];
    adjustments.push(`Risk: ${baseRiskPct.toFixed(1)}% → ${adjustedRiskPct.toFixed(1)}%`);
    if (adjustedSL) adjustments.push(`SL: widened by ${((adjustedSL - 1) * 100).toFixed(0)}%`);
    if (adjustedTP) adjustments.push(`TP: tightened by ${((1 - adjustedTP) * 100).toFixed(0)}%`);
    if (confidenceAdjustment < 0) adjustments.push(`Confidence: ${confidenceAdjustment.toFixed(1)} pts`);

    return {
      allow_trade: true,
      trade_action: 'adjust',
      risk_level: adjustmentLevel === 'strong' ? 'high' : adjustmentLevel === 'medium' ? 'medium' : 'low',
      mistake_flags: [],
      similar_losing_patterns_found: patterns.length,
      correlated_loss_risk: false,
      recent_loss_context: recentLosses,
      warnings: [
        `${patterns.length} similar losing patterns detected`,
        `Adaptive learning applied (${adjustmentLevel} adjustments)`
      ],
      preventive_reasoning: `Adaptive learning: ${patterns.length} similar patterns found (age: ${avgAge.toFixed(1)}d). Adjusting parameters instead of blocking to enable continuous learning.`,
      recommendation: 'allow',
      adjusted_parameters: {
        risk_pct: adjustedRiskPct,
        stop_loss_pips: adjustedSL,
        take_profit_pips: adjustedTP,
        confidence_adjustment: confidenceAdjustment
      },
      adaptation_notes: {
        reason: 'Similar losing patterns detected',
        similarity_score: similarityScore,
        weighted_similarity: weightedSimilarity,
        age_factor: ageFactor,
        patterns_matched: patterns.length,
        adjustments_summary: adjustments.join('; ')
      }
    };
  }

  private analyzeStopLossPatterns(patterns: any[]): { shouldWiden: boolean; reason: string } {
    // Check if patterns indicate SL was too tight
    const tightSLPatterns = patterns.filter(p => {
      const desc = (p.insight_description || '').toLowerCase();
      return desc.includes('stop loss') && (desc.includes('tight') || desc.includes('hit early'));
    });

    return {
      shouldWiden: tightSLPatterns.length >= 2,
      reason: tightSLPatterns.length >= 2 ? 'Multiple patterns indicate SL too tight' : ''
    };
  }

  private analyzeTakeProfitPatterns(patterns: any[]): { shouldTighten: boolean; reason: string } {
    // Check if patterns indicate TP was too ambitious
    const ambitiousTPPatterns = patterns.filter(p => {
      const desc = (p.insight_description || '').toLowerCase();
      return desc.includes('take profit') && (desc.includes('missed') || desc.includes('reversed'));
    });

    return {
      shouldTighten: ambitiousTPPatterns.length >= 2,
      reason: ambitiousTPPatterns.length >= 2 ? 'Multiple patterns indicate TP too ambitious' : ''
    };
  }

  private async trackAdaptation(
    userId: string,
    sessionId: string,
    result: MistakePreventionResult,
    symbol: string
  ): Promise<void> {
    if (!result.adaptation_notes || !result.adjusted_parameters) return;

    try {
      await supabase.from('adaptation_effectiveness').insert({
        user_id: userId,
        pattern_id: `${symbol}_${Date.now()}`,
        adaptation_type: result.adaptation_notes.adjustments_summary,
        session_id: sessionId,
        original_params: {
          risk_pct: 2.0,
          symbol: symbol
        },
        adjusted_params: result.adjusted_parameters,
        similarity_score: result.adaptation_notes.similarity_score,
        weighted_similarity: result.adaptation_notes.weighted_similarity,
        age_factor: result.adaptation_notes.age_factor,
        outcome: 'pending'
      });
    } catch (error) {
      console.error('[Layer 3] Failed to track adaptation:', error);
    }
  }

  getUsageStats(): { calls: number } {
    return { calls: this.callCount };
  }
}

export const llmMistakePrevention = new LLMMistakePrevention();
