/**
 * LLM Strategy Brain
 *
 * Multi-provider LLM integration for trade decision-making.
 * Primary: GPT-4, with infrastructure for future providers (Claude, Gemini).
 * All decisions are constrained by Pipnosis core rules.
 */

import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { llmContextEnricher, type EnrichedContext } from './llm-context-enricher';
import { openAIClient } from './openai-client';
import { validateAndNormalizeSnapshot, getBestTimeframe } from '../utils/snapshotValidator';
import type { MarketSnapshot as ValidatedMarketSnapshot } from '../utils/snapshotValidator';
import { llmCostOptimizer } from './llm-cost-optimizer';
import { compressSnapshot, buildCompressedStrategyPrompt } from './llm-prompt-compressor';
import { calculateCost } from '../config/llm-optimization-config';

/**
 * Safe helper to format numbers with toFixed, handling undefined/null gracefully
 */
function safeToFixed(value: number | undefined | null, decimals: number, fallback: number = 0): string {
  if (value === null || value === undefined || isNaN(value)) {
    return fallback.toFixed(decimals);
  }
  return value.toFixed(decimals);
}

export interface MarketSnapshot {
  symbol: string;
  timeframes: {
    [key: string]: {
      currentPrice: number;
      ema9: number;
      ema21: number;
      ema50: number;
      rsi: number;
      atr: number;
      vwap: number;
      trend: 'bullish' | 'bearish' | 'sideways';
      volatility: 'low' | 'medium' | 'high';
    };
  };
  recentPriceAction: string;
  openPositions: number;
  accountExposure: number;
}

export interface GoalContext {
  targetAmount: number;
  currentProfit: number;
  progressPercent: number;
  remainingAmount: number;
  tradesCompleted: number;
  avgProfitPerTrade: number;
  sessionDuration: string;
}

export interface RelevantHistory {
  recentWinRate: number;
  recentProfitFactor: number;
  bestSetupType: string;
  worstSetupType: string;
  avgTradeDuration: number;
  keyLessons: string[];
}

export interface LLMTradeDecision {
  action: 'enter_long' | 'enter_short' | 'no_trade' | 'hold' | 'close';
  confidence: number;
  entryZone?: {
    min: number;
    max: number;
    ideal: number;
  };
  stopLoss?: number;
  takeProfit?: number;
  positionSizePercent?: number;
  riskPercent?: number;  // NEW: Dynamic risk % (from LLM)
  riskRewardRatio?: number;  // NEW: Actual R:R ratio
  expectedDurationMinutes?: number;
  reasoning: string;
  riskAssessment: string;
  setupType: string;
  keyFactors: string[];
  alternativeScenarios?: string[];
}

export interface LLMProviderConfig {
  name: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

abstract class LLMProvider {
  protected config: LLMProviderConfig;
  protected callCount: number = 0;
  protected lastCallTime: Date | null = null;

  constructor(config: LLMProviderConfig) {
    this.config = config;
  }

  abstract makeDecision(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory,
    userId?: string,
    skillContext?: any,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<LLMTradeDecision>;

  protected buildSystemPrompt(): string {
    return PipnosisCoreRules.getSystemIdentityPrompt();
  }

  getUsageStats(): { calls: number; lastCall: Date | null } {
    return {
      calls: this.callCount,
      lastCall: this.lastCallTime
    };
  }
}

class GPT4Provider extends LLMProvider {
  async makeDecision(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory,
    userId?: string,
    skillContext?: any,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<LLMTradeDecision> {
    // Validate and normalize snapshot before processing
    let normalizedSnapshot: ValidatedMarketSnapshot;
    try {
      normalizedSnapshot = validateAndNormalizeSnapshot(snapshot);
    } catch (error) {
      console.error('[GPT-4 Provider] Snapshot validation failed:', error);
      throw error;
    }

    // Select optimal model based on quality
    const setupQuality = skillContext?.setupQuality || 75;
    const model = llmCostOptimizer.selectModel('layer5_strategy', {
      isBacktest,
      setupQuality
    });

    // Check rate limits
    const canProceed = await llmCostOptimizer.canMakeRequest(model);
    if (!canProceed) {
      console.warn('[Layer 5] Rate limit reached, using fallback');
      throw new Error('Rate limit reached');
    }

    const systemPrompt = this.buildSystemPrompt();

    let enrichedContext: EnrichedContext | null = null;
    if (userId) {
      enrichedContext = await llmContextEnricher.enrichDecisionContext(
        userId,
        normalizedSnapshot.symbol,
        75,
        normalizedSnapshot.timeframes
      );
    }

    // Use compressed prompt for cost optimization
    const compactSnap = compressSnapshot(normalizedSnapshot);
    const userPrompt = buildCompressedStrategyPrompt(
      compactSnap,
      setupQuality,
      goalContext ? {
        target: goalContext.targetAmount,
        progress: goalContext.progressPercent,
        remaining: goalContext.remainingAmount
      } : { target: 500, progress: 0, remaining: 500 },
      history ? {
        wr: history.recentWinRate,
        pf: history.recentProfitFactor
      } : { wr: 0, pf: 1.0 },
      skillContext ? {
        lvl: skillContext.currentLevel || 'Novice',
        tgt: skillContext.targetLevel || 'Intermediate',
        wr_gap: skillContext.gaps?.winRateGap || 0,
        pf_gap: skillContext.gaps?.profitFactorGap || 0,
        cons_gap: skillContext.gaps?.consistencyGap || 0,
        wr: skillContext.currentPerformance?.winRate || 0
      } : undefined,
      {
        qualityScore: setupQuality,
        regimeConf: skillContext?.regimeConfidence || 70,
        riskLevel: skillContext?.riskLevel || 'low',
        layersPassed: 4
      },
      {
        equity: 10000, // TODO: Get from account service
        maxRiskPct: 5.0, // TODO: Get from risk management settings
        dailyLossRemainingPct: 100 // TODO: Calculate from daily P&L
      }
    );

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Pipnosis AI. Return ONLY valid JSON. No explanations, no markdown, no extra text. Respond with raw JSON object only.'
          },
          { role: 'user', content: userPrompt }
        ],
        {
          model: model,
          temperature: 0.3,
          max_tokens: 400,
          requestType: 'trade_decision',
          endpoint: 'llm-strategy-brain'
        }
      );

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No content in GPT-4 response');
      }

      // Track usage
      llmCostOptimizer.trackRequest(model);
      this.callCount++;
      this.lastCallTime = new Date();

      // Calculate and log cost
      const usage = response.usage || { prompt_tokens: 350, completion_tokens: 150, total_tokens: 500 };
      const cost = calculateCost(model, usage.prompt_tokens, usage.completion_tokens);
      console.log(`[Layer 5] Model: ${model}, Tokens: ${usage.total_tokens}, Cost: $${safeToFixed(cost, 4)}`);

      if (userId && sessionId) {
        await llmCostOptimizer.logCost(
          userId,
          sessionId,
          'layer5_strategy',
          model,
          usage.prompt_tokens,
          usage.completion_tokens,
          cost,
          { symbol: normalizedSnapshot.symbol, action: 'pending' }
        );
      }

      const decision = this.parseResponse(content);
      return this.validateAndEnforceRules(decision, snapshot);

    } catch (error) {
      console.error('[GPT-4 Provider] Error:', error);
      throw error;
    }
  }

  private buildUserPrompt(
    snapshot: ValidatedMarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory,
    enrichedContext?: EnrichedContext | null,
    skillContext?: any
  ): string {
    // Get the best available timeframe (snapshot is already validated)
    const bestTF = getBestTimeframe(snapshot);

    if (!bestTF) {
      throw new Error('[LLM Strategy Brain] No valid timeframe data in validated snapshot');
    }

    const primaryTF = bestTF.key;
    const tfData = bestTF.data;

    console.log('[DEBUG] Building prompt - tfData keys:', Object.keys(tfData));
    console.log('[DEBUG] tfData values:', JSON.stringify({
      currentPrice: tfData.currentPrice,
      ema9: tfData.ema9,
      ema21: tfData.ema21,
      ema50: tfData.ema50,
      rsi: tfData.rsi,
      atr: tfData.atr,
      vwap: tfData.vwap,
      trend: tfData.trend,
      volatility: tfData.volatility
    }));

    let prompt = '';

    try {
      prompt = `Analyze this short-term trading opportunity:

MARKET SNAPSHOT (${snapshot.symbol}):
Primary Timeframe: ${primaryTF}
- Current Price: ${safeToFixed(tfData.currentPrice, 5)}
- EMA9: ${safeToFixed(tfData.ema9, 5)} | EMA21: ${safeToFixed(tfData.ema21, 5)} | EMA50: ${safeToFixed(tfData.ema50, 5)}
- RSI: ${safeToFixed(tfData.rsi, 2, 50)}
- ATR: ${safeToFixed(tfData.atr, 5)}
- VWAP: ${safeToFixed(tfData.vwap || tfData.currentPrice, 5)}
- Trend: ${tfData.trend || 'unknown'}
- Volatility: ${tfData.volatility || 'medium'}
- Recent Price Action: ${snapshot.recentPriceAction || 'N/A'}

MULTI-TIMEFRAME CONTEXT:`;
      console.log('[DEBUG] ✅ Primary timeframe section built successfully');
    } catch (error) {
      console.error('[DEBUG] ❌ Error building primary timeframe section:', error);
      throw error;
    }

    // Iterate other validated timeframes
    try {
      console.log('[DEBUG] Building multi-timeframe section, timeframes:', Object.keys(snapshot.timeframes));
      for (const [tf, data] of Object.entries(snapshot.timeframes)) {
        if (tf !== primaryTF) {
          console.log(`[DEBUG] Processing timeframe ${tf}:`, JSON.stringify(data));
          const vwap = data.vwap || data.currentPrice || 0;
          const priceVsVwap = vwap > 0 ? safeToFixed(((data.currentPrice || 0) - vwap) / vwap * 100, 2) : '0.00';
          prompt += `\n${tf}: Trend=${data.trend || 'unknown'}, RSI=${safeToFixed(data.rsi, 1, 50)}, Price vs VWAP=${priceVsVwap}%`;
        }
      }
      console.log('[DEBUG] ✅ Multi-timeframe section built successfully');
    } catch (error) {
      console.error('[DEBUG] ❌ Error building multi-timeframe section:', error);
      throw error;
    }

    try {
      console.log('[DEBUG] Building exposure section');
      prompt += `\n\nCURRENT EXPOSURE:
- Open Positions: ${snapshot.openPositions || 0}
- Account Exposure: ${safeToFixed(snapshot.accountExposure, 1)}%`;
      console.log('[DEBUG] ✅ Exposure section built');
    } catch (error) {
      console.error('[DEBUG] ❌ Error building exposure section:', error);
      throw error;
    }

    if (goalContext) {
      try {
        console.log('[DEBUG] Building goal context:', JSON.stringify(goalContext));
        prompt += `\n\nGOAL CONTEXT:
- Target: $${safeToFixed(goalContext.targetAmount, 2)}
- Current Profit: $${safeToFixed(goalContext.currentProfit, 2)} (${safeToFixed(goalContext.progressPercent, 1)}%)
- Remaining: $${safeToFixed(goalContext.remainingAmount, 2)}
- Trades Completed: ${goalContext.tradesCompleted || 0}
- Avg Profit/Trade: $${safeToFixed(goalContext.avgProfitPerTrade, 2)}
- Session Duration: ${goalContext.sessionDuration || 'N/A'}`;
        console.log('[DEBUG] ✅ Goal context built');
      } catch (error) {
        console.error('[DEBUG] ❌ Error building goal context:', error);
        throw error;
      }
    }

    if (history) {
      try {
        console.log('[DEBUG] Building history section:', JSON.stringify(history));
        prompt += `\n\nRECENT PERFORMANCE:
- Win Rate: ${safeToFixed(history.recentWinRate, 1)}%
- Profit Factor: ${safeToFixed(history.recentProfitFactor, 2, 1)}
- Best Setup: ${history.bestSetupType || 'Unknown'}
- Avg Duration: ${safeToFixed(history.avgTradeDuration, 0)} minutes
- Key Lessons: ${(history.keyLessons || []).join(', ')}`;
        console.log('[DEBUG] ✅ History section built');
      } catch (error) {
        console.error('[DEBUG] ❌ Error building history section:', error);
        throw error;
      }
    }

    if (enrichedContext) {
      try {
        console.log('[DEBUG] Building enriched context, keys:', Object.keys(enrichedContext));
        console.log('[DEBUG] enrichedContext.historicalPerformance:', JSON.stringify(enrichedContext.historicalPerformance));

        prompt += `\n\nSELF-AWARE AI CONTEXT:
Historical Performance (${enrichedContext.historicalPerformance?.symbol || 'N/A'}):
- Recent Win Rate: ${safeToFixed(enrichedContext.historicalPerformance?.recentWinRate, 1)}%
- Recent Profit Factor: ${safeToFixed(enrichedContext.historicalPerformance?.recentProfitFactor, 2, 1)}
- Trades Analyzed: ${enrichedContext.historicalPerformance?.tradesAnalyzed || 0}
- Best Setup Type: ${enrichedContext.historicalPerformance?.bestSetupType || 'Unknown'}

LLM-Discovered Insights:`;

        console.log('[DEBUG] Building insights, count:', enrichedContext.llmInsights?.length || 0);
        if (enrichedContext.llmInsights?.length > 0) {
          enrichedContext.llmInsights.slice(0, 3).forEach((insight, i) => {
            prompt += `\n  ${i + 1}. ${insight.title} (${safeToFixed(insight.confidence, 0)}% confidence)
     - ${insight.description}
     - Apply when: ${insight.whenToApply}
     - Avoid when: ${insight.whenToAvoid}`;
          });
        } else {
          prompt += `\n  No LLM insights available yet - learning in progress`;
        }

        console.log('[DEBUG] Building confidence calibration:', JSON.stringify(enrichedContext.confidenceCalibration));
        prompt += `\n\nConfidence Calibration:
- Recommended Threshold: ${enrichedContext.confidenceCalibration?.recommendedThreshold || 70}%
- Reasoning: ${enrichedContext.confidenceCalibration?.reasoning || 'Default threshold'}
- Recent Accuracy: ${safeToFixed(enrichedContext.confidenceCalibration?.recentAccuracy, 1, 50)}%

Strategic Guidance:`;
        (enrichedContext.strategicGuidance || []).forEach(guidance => {
          prompt += `\n- ${guidance}`;
        });
        console.log('[DEBUG] ✅ Enriched context built');
      } catch (error) {
        console.error('[DEBUG] ❌ Error building enriched context:', error);
        throw error;
      }
    }

    if (skillContext) {
      try {
        console.log('[DEBUG] Building skill context, keys:', Object.keys(skillContext));
        console.log('[DEBUG] skillContext.currentPerformance:', JSON.stringify(skillContext.currentPerformance));
        console.log('[DEBUG] skillContext.targetRequirements:', JSON.stringify(skillContext.targetRequirements));
        console.log('[DEBUG] skillContext.gaps:', JSON.stringify(skillContext.gaps));

        prompt += `\n\n═══════════════════════════════════════════════════════════════════
AI SKILL LEVEL PROGRESSION OBJECTIVE
═══════════════════════════════════════════════════════════════════

Current Level: ${skillContext.currentLevel || 'Novice'} (${skillContext.currentLevelNumeric || 1}/6)
Target Level: ${skillContext.targetLevel || 'Intermediate'}

CURRENT PERFORMANCE:
• Win Rate: ${safeToFixed(skillContext.currentPerformance?.winRate, 1)}%
• Profit Factor: ${safeToFixed(skillContext.currentPerformance?.profitFactor, 2)}x
• Total Trades Analyzed: ${skillContext.currentPerformance?.totalTrades || 0}
• Consistency: ${safeToFixed(skillContext.currentPerformance?.consistency, 1)}%

REQUIREMENTS TO LEVEL UP:
• Win Rate Required: ${skillContext.targetRequirements?.minWinRate || 45}% (Gap: ${(skillContext.gaps?.winRateGap || 0) > 0 ? '+' : ''}${safeToFixed(skillContext.gaps?.winRateGap, 1)}%)
• Profit Factor Required: ${safeToFixed(skillContext.targetRequirements?.minProfitFactor, 2, 1.2)}x (Gap: ${(skillContext.gaps?.profitFactorGap || 0) > 0 ? '+' : ''}${safeToFixed(skillContext.gaps?.profitFactorGap, 2)})
• Trades Required: ${skillContext.targetRequirements?.minTrades || 100} (Remaining: ${Math.abs(skillContext.gaps?.tradesGap || 100)})
• Consistency Required: ${skillContext.targetRequirements?.minConsistency || 70}% (Gap: ${(skillContext.gaps?.consistencyGap || 0) > 0 ? '+' : ''}${safeToFixed(skillContext.gaps?.consistencyGap, 1)}%)

YOUR MISSION:
Your trading decisions in this session directly affect your ability to level up.
Prioritize actions that improve your OVERALL win rate, profit factor, and consistency.
Be more selective when gaps are negative.
Favor higher-quality setups and healthier risk-reward structures over sheer trade count.

STRATEGIC GUIDANCE (PRIORITY: WIN RATE → PROFIT FACTOR → CONSISTENCY):
${(skillContext.strategicGuidance || []).map((g: string) => `• ${g}`).join('\n')}
`;
        console.log('[DEBUG] ✅ Skill context built');
      } catch (error) {
        console.error('[DEBUG] ❌ Error building skill context:', error);
        throw error;
      }
    }

    prompt += `\n\n═══════════════════════════════════════════════════════════════════
YOU HAVE FULL TRADING AUTONOMY - CRITICAL INSTRUCTIONS
═══════════════════════════════════════════════════════════════════

STOP LOSS PLACEMENT (YOU DECIDE - NO FORMULAS):
✓ Base on market structure, NOT arbitrary percentages or ATR formulas
✓ Consider: key support/resistance, swing highs/lows, volatility context
✓ Place at logical invalidation points where setup is definitively broken
✓ Tighter stops in range-bound, wider in volatile trending markets
✗ NEVER use fixed percentages like "1% below entry"
✗ NEVER use simple ATR multipliers like "1.5 × ATR"

TAKE PROFIT PLACEMENT (YOU DECIDE - NO RATIOS):
✓ Base on resistance levels, price targets, market momentum
✓ Consider: nearest key resistance, Fibonacci extensions, trend strength
✓ In strong trends: extend TP to capture maximum profit
✓ In ranging: take profits at resistance levels
✓ Adjust based on goal progress (larger TP when far from goal)
✗ NEVER use fixed ratios like "2.5 × risk"
✗ NEVER use arbitrary R:R without market context

POSITION SIZING (YOU DECIDE DYNAMICALLY):
✓ Base on: setup quality, confidence level, recent performance
✓ High confidence (85%+) + excellent setup quality → larger size (3-5%)
✓ Medium confidence (70-85%) → moderate size (2-3%)
✓ After losing streak → reduce to 1-2%
✓ When close to goal → smaller sizes to protect gains
✓ Factor in volatility: reduce size in high volatility
✗ NEVER use fixed 2% for everything

TRADE DURATION (YOU DECIDE - MAX ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES} MINUTES):
✓ Scalps: 5-30 minutes for quick moves
✓ Intraday swing: 1-4 hours for trend following
✓ Consider momentum strength and timeframe
✗ Maximum: ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours (hard limit)

PROFIT MAXIMIZATION MANDATE (WITHIN SAFETY CONSTRAINTS):
✓ Hold winners as long as market structure supports
✓ Extend TP when momentum accelerates after entry
✓ Use trailing stops aggressively in strong trends
✓ Consider partial exits: take 50% at 1:1 R:R, trail remainder
✓ Exit early only if setup deteriorates or structure breaks
✓ In strong trends: let winners run for maximum profit
✗ Don't exit winners prematurely just to "lock in gains"
✗ Don't increase risk after entry
✗ Never exceed ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES} minute max hold

HARD CONSTRAINTS (NON-NEGOTIABLE):
✗ Max hold time: ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_HOURS} hours
✗ No overnight holds
✗ Minimum R:R at entry: 1.5:1
✗ Never widen stop loss after entry
✗ Never exceed user's max risk percentage

Provide your decision in this EXACT JSON format (no markdown):
{
  "action": "enter_long|enter_short|no_trade|hold|close",
  "confidence": <0-100>,
  "entryZone": {
    "min": <price>,
    "max": <price>,
    "ideal": <price>
  },
  "stopLoss": <price determined by market structure>,
  "takeProfit": <price determined by targets/resistance>,
  "positionSizePercent": <1-5 based on confidence and quality>,
  "expectedDurationMinutes": <10-${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES}>,
  "reasoning": "<concise 2-3 sentence explanation including WHY you chose this SL/TP/size>",
  "riskAssessment": "<1-2 sentence risk analysis>",
  "setupType": "<descriptive name>",
  "keyFactors": ["<factor1>", "<factor2>", "<factor3>"],
  "alternativeScenarios": ["<scenario1>", "<scenario2>"]
}

Remember: You're an elite AI trader making intelligent decisions based on market analysis, NOT following dumb formulas!`;

    return prompt;
  }

  private parseResponse(content: string): LLMTradeDecision {
    try {
      // Step 1: Try parsing raw content as JSON (fast path)
      try {
        const parsed = JSON.parse(content.trim());
        return this.normalizeDecision(parsed);
      } catch (e) {
        // Not raw JSON, continue to extraction
      }

      // Step 2: Remove markdown code blocks
      let cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

      // Step 3: Try parsing cleaned content
      try {
        const parsed = JSON.parse(cleanContent);
        return this.normalizeDecision(parsed);
      } catch (e) {
        // Still not valid, try regex extraction
      }

      // Step 4: Extract JSON object using regex (find first { to last })
      const jsonMatch = cleanContent.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/s);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          return this.normalizeDecision(parsed);
        } catch (e) {
          // JSON extraction failed
        }
      }

      // Step 5: Last resort - try to find act/action field and build minimal JSON
      console.error('[parseResponse] Failed to extract valid JSON from response:', content.substring(0, 200));
      throw new Error('Could not extract valid JSON from LLM response');

    } catch (error) {
      console.error('[parseResponse] Parsing error:', error);
      console.error('[parseResponse] Raw content:', content.substring(0, 500));
      throw error;
    }
  }

  private normalizeDecision(parsed: any): LLMTradeDecision {

    // Handle both 'act' (compressed) and 'action' (full) field names
    const action = parsed.act || parsed.action || 'no_trade';
    const confidence = parsed.conf !== undefined ? parsed.conf : (parsed.confidence || 0);
    const reasoning = parsed.why || parsed.reasoning || '';
    const stopLoss = parsed.sl !== undefined ? parsed.sl : parsed.stopLoss;
    const takeProfit = parsed.tp !== undefined ? parsed.tp : parsed.takeProfit;
    const positionSize = parsed.size !== undefined ? parsed.size : (parsed.positionSizePercent || 2);
    const riskPercent = parsed.risk_pct !== undefined ? parsed.risk_pct : undefined;
    const riskRewardRatio = parsed.rr !== undefined ? parsed.rr : undefined;

    // Log if we got new fields
    if (riskPercent !== undefined || riskRewardRatio !== undefined) {
      console.log(`[normalizeDecision] Enhanced fields: risk_pct=${riskPercent}%, rr=${riskRewardRatio}`);
    }

    return {
      action: action,
      confidence: confidence,
      entryZone: parsed.entryZone,
      stopLoss: stopLoss,
      takeProfit: takeProfit,
      positionSizePercent: positionSize,
      riskPercent: riskPercent,
      riskRewardRatio: riskRewardRatio,
      expectedDurationMinutes: parsed.expectedDurationMinutes || 120,
      reasoning: reasoning,
      riskAssessment: parsed.riskAssessment || '',
      setupType: parsed.setupType || 'Unknown',
      keyFactors: parsed.keyFactors || [],
      alternativeScenarios: parsed.alternativeScenarios || []
    };
  }

  private validateAndEnforceRules(
    decision: LLMTradeDecision,
    snapshot: MarketSnapshot
  ): LLMTradeDecision {
    const durationValidation = PipnosisCoreRules.validateTradeDuration(
      decision.expectedDurationMinutes || 120
    );

    if (!durationValidation.isValid) {
      PipnosisCoreRules.enforcementLog(
        durationValidation.violations.join(', '),
        `Adjusted duration from ${decision.expectedDurationMinutes} to ${PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60} minutes`
      );
      decision.expectedDurationMinutes = PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60;
    }

    if (decision.positionSizePercent && decision.positionSizePercent > 5) {
      PipnosisCoreRules.enforcementLog(
        `Position size ${decision.positionSizePercent}% exceeds safe limit`,
        'Reduced to 5%'
      );
      decision.positionSizePercent = 5;
    }

    return decision;
  }
}

class LLMStrategyBrain {
  private providers: Map<string, LLMProvider> = new Map();
  private primaryProvider: string = 'gpt4';
  private fallbackEnabled: boolean = true;

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    if (openAIClient.isAvailable()) {
      const gpt4Config: LLMProviderConfig = {
        name: 'GPT-4',
        model: 'gpt-4o',
        maxTokens: 1000,
        temperature: 0.3
      };

      this.providers.set('gpt4', new GPT4Provider(gpt4Config));
      console.log('[LLM Strategy Brain] GPT-4 provider initialized (via secure proxy)');
    } else {
      console.warn('[LLM Strategy Brain] Secure proxy not available, LLM features disabled');
    }
  }

  async makeDecision(
    snapshot: MarketSnapshot,
    goalContext?: GoalContext,
    history?: RelevantHistory,
    userId?: string,
    skillContext?: any,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<LLMTradeDecision> {
    const provider = this.providers.get(this.primaryProvider);

    if (!provider) {
      console.warn('[LLM Strategy Brain] Primary provider not available, using fallback');
      console.warn('  → Reason: Secure OpenAI proxy not available or user not authenticated');
      console.warn('  → Using rule-based fallback (VWAP/EMA/RSI logic)');
      return this.fallbackDecision(snapshot);
    }

    try {
      const decision = await provider.makeDecision(snapshot, goalContext, history, userId, skillContext, sessionId, isBacktest);
      console.log(`[LLM Strategy Brain] Decision: ${decision.action}, Confidence: ${decision.confidence}%`);
      return decision;
    } catch (error) {
      console.error('[LLM Strategy Brain] Provider error:', error);

      if (this.fallbackEnabled) {
        console.log('[LLM Strategy Brain] Falling back to rule-based decision');
        return this.fallbackDecision(snapshot);
      }

      throw error;
    }
  }

  private fallbackDecision(snapshot: MarketSnapshot): LLMTradeDecision {
    console.log('[LLM Strategy Brain] 🔧 FALLBACK MODE: Using simple rule-based logic');
    console.log('  Note: This is NOT the AI engine - just basic technical analysis');

    // Validate snapshot has timeframe data
    if (!snapshot.timeframes || Object.keys(snapshot.timeframes).length === 0) {
      console.log('[Fallback] ❌ No timeframe data available - NO TRADE');
      return {
        action: 'no_trade',
        confidence: 0,
        reasoning: 'No timeframe data available in snapshot',
        riskAssessment: 'Unable to assess risk without market data',
        setupType: 'No Setup',
        keyFactors: ['Missing timeframe data'],
        expectedDurationMinutes: 120
      };
    }

    // Try preferred timeframes, fallback to first available
    const preferredTimeframes = ['M15', '15m', 'M5', '5m', 'H1', '1h'];
    let primaryTF: string | null = null;

    for (const tf of preferredTimeframes) {
      if (snapshot.timeframes[tf]) {
        primaryTF = tf;
        break;
      }
    }

    if (!primaryTF) {
      primaryTF = Object.keys(snapshot.timeframes)[0];
    }

    const tfData = snapshot.timeframes[primaryTF];

    if (!tfData || typeof tfData.currentPrice !== 'number') {
      console.log('[Fallback] ❌ Invalid timeframe data - NO TRADE');
      console.log(`  Available: ${Object.keys(snapshot.timeframes).join(', ')}`);
      console.log(`  Selected: ${primaryTF}, Data: ${JSON.stringify(tfData)}`);
      return {
        action: 'no_trade',
        confidence: 0,
        reasoning: 'Invalid or incomplete timeframe data',
        riskAssessment: 'Unable to assess risk without valid price data',
        setupType: 'No Setup',
        keyFactors: ['Invalid market data'],
        expectedDurationMinutes: 120
      };
    }

    const priceVsVwap = tfData.currentPrice - tfData.vwap;
    const priceVsVwapPercent = (priceVsVwap / tfData.vwap) * 100;
    const emaAligned = tfData.ema9 > tfData.ema21 && tfData.ema21 > tfData.ema50;
    const emaBearish = tfData.ema9 < tfData.ema21 && tfData.ema21 < tfData.ema50;

    if (Math.abs(priceVsVwapPercent) < 0.15 && emaAligned && tfData.rsi > 45 && tfData.rsi < 65) {
      console.log('[Fallback] ✅ LONG setup detected (VWAP bounce + EMA bullish)');
      return {
        action: 'enter_long',
        confidence: 70,
        entryZone: {
          min: tfData.currentPrice - tfData.atr * 0.2,
          max: tfData.currentPrice + tfData.atr * 0.2,
          ideal: tfData.currentPrice
        },
        stopLoss: tfData.currentPrice - tfData.atr * 1.5,
        takeProfit: tfData.currentPrice + tfData.atr * 2.5,
        positionSizePercent: 2,
        expectedDurationMinutes: 90,
        reasoning: 'VWAP support with bullish EMA alignment and neutral RSI',
        riskAssessment: 'Moderate risk with defined stop loss at 1.5 ATR',
        setupType: 'VWAP Bounce Long',
        keyFactors: ['VWAP support', 'EMA alignment', 'Neutral momentum']
      };
    }

    if (Math.abs(priceVsVwapPercent) < 0.15 && emaBearish && tfData.rsi > 35 && tfData.rsi < 55) {
      console.log('[Fallback] ✅ SHORT setup detected (VWAP rejection + EMA bearish)');
      return {
        action: 'enter_short',
        confidence: 70,
        entryZone: {
          min: tfData.currentPrice - tfData.atr * 0.2,
          max: tfData.currentPrice + tfData.atr * 0.2,
          ideal: tfData.currentPrice
        },
        stopLoss: tfData.currentPrice + tfData.atr * 1.5,
        takeProfit: tfData.currentPrice - tfData.atr * 2.5,
        positionSizePercent: 2,
        expectedDurationMinutes: 90,
        reasoning: 'VWAP resistance with bearish EMA alignment and weak RSI',
        riskAssessment: 'Moderate risk with defined stop loss at 1.5 ATR',
        setupType: 'VWAP Rejection Short',
        keyFactors: ['VWAP resistance', 'Bearish EMAs', 'Weak momentum']
      };
    }

    console.log('[Fallback] ❌ NO TRADE - Conditions not met');
    console.log(`  Price vs VWAP: ${safeToFixed(priceVsVwapPercent, 2)}% (need <0.15%)`);
    console.log(`  EMA Aligned: ${emaAligned}, EMA Bearish: ${emaBearish}`);
    console.log(`  RSI: ${safeToFixed(tfData.rsi, 1, 50)} (need 45-65 for long, 35-55 for short)`);

    return {
      action: 'no_trade',
      confidence: 50,
      reasoning: 'No high-probability short-term setup detected. Waiting for clearer opportunity.',
      riskAssessment: 'Low confidence prevents trade entry',
      setupType: 'No Setup',
      keyFactors: ['Unclear trend', 'No VWAP alignment', 'Waiting for confirmation'],
      expectedDurationMinutes: 120
    };
  }

  getProviderStats(): Record<string, any> {
    const stats: Record<string, any> = {};
    for (const [name, provider] of this.providers.entries()) {
      stats[name] = provider.getUsageStats();
    }
    return stats;
  }

  setPrimaryProvider(providerName: string): boolean {
    if (this.providers.has(providerName)) {
      this.primaryProvider = providerName;
      console.log(`[LLM Strategy Brain] Primary provider set to: ${providerName}`);
      return true;
    }
    return false;
  }
}

export const llmStrategyBrain = new LLMStrategyBrain();
