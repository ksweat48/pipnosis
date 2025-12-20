/**
 * Mid-Trade Monitor Brain
 *
 * Monitors open trades and evaluates if they should be:
 * - Held (continue to SL/TP)
 * - Closed early (exit before SL)
 * - Trailed (move SL to lock profits)
 * - Reduced (tighten SL)
 *
 * Three escalation levels:
 * - Soft (30-49% drawdown): Alpha quick check
 * - Hard (50-69% drawdown): Alpha full evaluation
 * - Emergency (70%+ drawdown): Full Omega council + Alpha
 */

import { openAIClient } from '../services/openai-client';
import { omegaTrend } from './omega/trend';
import { omegaVolatility } from './omega/volatility';
import { omegaRisk } from './omega/risk';
import { omegaConfirmation } from './omega/confirmation';
import { sentimentCoordinator } from '../services/sentiment-coordinator';
import type { OmegaVote } from './omega/trend';
import type { TraderScore } from '../services/ai-identity';
import { llmTokenTracker } from '../services/llm-token-tracker';
import { tradeContextRetriever, type TradeContext } from '../services/trade-context-retriever';

export interface MidTradeSnapshot {
  // Position info
  p: number;           // current price
  ep: number;          // entry price
  sl: number;          // stop loss
  tp: number;          // take profit
  dir: 'buy' | 'sell'; // direction
  dd: number;          // drawdown % of SL (0-1.0)
  pnl: number;         // current P&L in dollars

  // Market indicators
  e20: number;         // ema20
  e50: number;         // ema50
  rsi: number;         // rsi
  atr: number;         // atr
  vw_d: number;        // distance from vwap
  tr: string;          // trend state
  vol: string;         // volatility

  // Trade context
  t: number;           // minutes in trade
  risk_pct: number;    // % of account
  sym: string;         // symbol

  // Structure (for swing trades)
  structure?: {
    hh: boolean;       // higher high
    hl: boolean;       // higher low
    lh: boolean;       // lower high
    ll: boolean;       // lower low
  };
}

export interface MidTradeDecision {
  action: 'HOLD' | 'CLOSE' | 'TRAIL_SL' | 'REDUCE_RISK';
  adjustedSL?: number;
  confidence: number;
  reasoning: string;
  trigger_level: 'soft' | 'hard' | 'emergency';
}

class MidTradeMonitorBrain {
  /**
   * Check if sentiment should trigger mid-trade override
   */
  async shouldTriggerSentimentOverride(snapshot: MidTradeSnapshot): Promise<{
    trigger: boolean;
    reason: string;
  }> {
    try {
      const sentimentData = await sentimentCoordinator.getSentimentForMidTrade();

      // Trigger if sentiment has flipped
      if (sentimentData.hasFlipped) {
        return {
          trigger: true,
          reason: `Sentiment flipped ${sentimentData.direction}`
        };
      }

      // Trigger if current sentiment is risk-off and high volatility
      if (sentimentData.current?.sentiment === 'risk_off' &&
          sentimentData.current?.volatility === 'high') {
        return {
          trigger: true,
          reason: 'Risk-OFF + High volatility detected'
        };
      }

      // Trigger if USD strength conflicts with position
      if (sentimentData.current?.usd_strength === 'strong' &&
          snapshot.sym === 'XAUUSD' &&
          snapshot.dir === 'sell') {
        return {
          trigger: true,
          reason: 'Strong USD against XAU/USD sell position'
        };
      }

      return { trigger: false, reason: '' };

    } catch (error) {
      console.error('[MidTrade] Sentiment override check failed:', error);
      return { trigger: false, reason: 'Sentiment check failed' };
    }
  }

  /**
   * Periodic Wellness Check (every 15 minutes)
   * Comprehensive evaluation with full trade context
   * Uses gpt-4o-mini for cost efficiency (~$0.0003 per check with context)
   */
  async evaluatePeriodicWellness(
    snapshot: MidTradeSnapshot,
    traderScore: TraderScore,
    tradeId?: string
  ): Promise<MidTradeDecision> {
    // CRITICAL: Get original trade context
    let tradeContext: TradeContext | null = null;
    if (tradeId) {
      tradeContext = await tradeContextRetriever.getTradeContext(tradeId);
    }

    // Get sentiment context (lightweight)
    const sentimentData = await sentimentCoordinator.getSentimentForMidTrade().catch(() => null);
    const sentimentContext = sentimentData?.current
      ? ` | Sentiment: ${sentimentData.current.sentiment}, Vol: ${sentimentData.current.volatility}`
      : '';

    // Build comprehensive prompt with trade context
    let contextSection = '';
    if (tradeContext) {
      const thesisSummary = tradeContextRetriever.buildThesisSummary(tradeContext);
      contextSection = `

ORIGINAL TRADE CONTEXT:
- Entry Reasoning: ${tradeContext.originalReasoning}
- Setup Pattern: ${thesisSummary}
- Expected Outcome: ${tradeContext.expectedOutcome || 'Move to TP as expected'}
- Market Read at Entry: ${tradeContext.marketRead || 'Favorable conditions'}
- Time in Trade: ${tradeContext.minutesInTrade} minutes
- Entry: ${tradeContext.entryPrice.toFixed(5)} | SL: ${tradeContext.stopLoss.toFixed(5)} | TP: ${tradeContext.takeProfit.toFixed(5)}`;
    }

    const prompt = `Quick Wellness Check (15-min):

TRADE INFO:
${JSON.stringify(snapshot)}${sentimentContext}

P&L: ${snapshot.pnl >= 0 ? '+' : ''}$${snapshot.pnl.toFixed(2)}
Current: ${snapshot.p.toFixed(5)} | Entry: ${snapshot.ep.toFixed(5)} | SL: ${snapshot.sl.toFixed(5)} | TP: ${snapshot.tp.toFixed(5)}${contextSection}

Give me a natural, human update in 1-2 SHORT paragraphs. Follow this structure:

1. Quick status (1 sentence - where does the trade stand?)
2. What matters right now (1 key price level to watch - be specific)
3. Why we're holding or adjusting (brief reasoning)
4. Reassurance + monitoring (remind me you're watching)

CRITICAL RULES:
- NO labels like "STATUS:" or "SITUATION:" - just write naturally
- NO probabilities ("60% chance") - use words like "still looks solid" or "setup weakening"
- NO technical jargon (RSI, timeframes, structure) - plain English
- NO multiple far-away levels - ONE specific price that matters next
- Keep it SHORT - max 3-4 sentences total
- Sound like a human trader, not a report

Return simple JSON:
{
  "action": "HOLD|TRAIL_SL|REDUCE_RISK|CLOSE",
  "confidence": 0-100,
  "message": "Your natural 1-2 paragraph update here"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: `You are Alpha, a human-like trading assistant giving quick check-ins on open trades.

PERSONALITY:
- Talk like a real trader, not a robot
- Keep it SHORT and conversational (1-2 paragraphs max)
- Use plain English, not technical jargon
- Be specific with ONE key price level, not multiple
- Sound confident and reassuring

NEVER DO:
- NO labels like "STATUS:" "SITUATION:" "WATCHING FOR:" etc
- NO probability percentages ("60% chance...")
- NO technical terms (RSI, divergence, timeframe analysis)
- NO long multi-paragraph reports
- NO far-away levels the price hasn't reached yet

ALWAYS DO:
- Quick status in plain words
- ONE specific price to watch right now
- Brief reason for holding/adjusting
- Confidence that you're monitoring closely

Write naturally like you're texting an update to a friend.`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 150,
          requestType: 'periodic_wellness',
          endpoint: 'periodic-wellness'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'MidTrade-Periodic',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'periodic_wellness',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const parsed = this.parseComprehensiveWellness(content);

      console.log(`[Periodic Wellness] ${snapshot.sym}: ${parsed.action} (${parsed.confidence}%) - ${parsed.reasoning}`);
      return parsed;
    } catch (error) {
      console.error('[Periodic Wellness] Error:', error);
      return {
        action: 'HOLD',
        confidence: 50,
        reasoning: 'Periodic check failed - continuing normally',
        trigger_level: 'soft'
      };
    }
  }

  /**
   * Parse comprehensive wellness response with full context
   */
  private parseComprehensiveWellness(response: string): MidTradeDecision & {
    tradeStatus?: string;
    currentSituation?: string;
    watchingFor?: string;
    actionTriggers?: string;
    probabilityAssessment?: string;
    timeframeAnalysis?: string;
  } {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      // Simple parsing - just extract action, confidence, and natural message
      let action: MidTradeDecision['action'] = parsed.action || 'HOLD';
      if (!['HOLD', 'CLOSE', 'TRAIL_SL', 'REDUCE_RISK'].includes(action)) {
        action = 'HOLD';
      }

      const message = parsed.message || 'Trade update unavailable';
      const confidence = Math.min(100, Math.max(0, parsed.confidence || 75));

      return {
        action,
        confidence,
        reasoning: message, // Pass through the natural message as-is
        trigger_level: 'soft'
      };
    } catch (error) {
      return {
        action: 'HOLD',
        confidence: 75,
        reasoning: 'Wellness check parse failed - trade appears normal',
        trigger_level: 'soft'
      };
    }
  }

  /**
   * DEPRECATED: Old parser for simple wellness checks
   * Kept for backwards compatibility only
   */
  private parsePeriodicWellness(response: string): MidTradeDecision {
    return this.parseComprehensiveWellness(response);
  }

  /**
   * Soft Check (30-49% drawdown)
   * Quick Alpha evaluation with sentiment context
   */
  async evaluateSoft(snapshot: MidTradeSnapshot, traderScore: TraderScore): Promise<MidTradeDecision> {
    // Get sentiment context
    const sentimentData = await sentimentCoordinator.getSentimentForMidTrade();
    const sentimentContext = sentimentData.current
      ? `\nSentiment: ${sentimentData.current.sentiment}, Vol: ${sentimentData.current.volatility}, USD: ${sentimentData.current.usd_strength}${sentimentData.hasFlipped ? ' [FLIPPED]' : ''}`
      : '';

    const prompt = `Mid-Trade Soft Check:
${JSON.stringify(snapshot)}
Trader: ${traderScore.confidence_level}${sentimentContext}

Position ${snapshot.dd.toFixed(0)}% toward SL. Quick check - is this normal or concerning?

Return JSON:
{
  "action": "HOLD|CLOSE|TRAIL_SL",
  "adjustedSL": number (if trailing),
  "confidence": 0-100,
  "reasoning": "brief explanation"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Alpha monitoring trades. Quick soft check. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 100,
          requestType: 'midtrade_soft',
          endpoint: 'midtrade-soft'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'MidTrade-Monitor',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'mid_trade',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const decision = this.parseDecision(content, 'soft');

      console.log(`[MidTrade Soft] ${snapshot.sym}: ${decision.action} @ ${snapshot.dd.toFixed(0)}% DD`);
      return decision;
    } catch (error) {
      console.error('[MidTrade Soft] Error:', error);
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: 'Soft check failed - holding',
        trigger_level: 'soft'
      };
    }
  }

  /**
   * Hard Check (50-69% drawdown)
   * Full Alpha evaluation with sentiment
   */
  async evaluateHard(snapshot: MidTradeSnapshot, traderScore: TraderScore): Promise<MidTradeDecision> {
    // Get sentiment context
    const sentimentData = await sentimentCoordinator.getSentimentForMidTrade();
    const sentimentContext = sentimentData.current
      ? `\nSENTIMENT: ${sentimentData.current.sentiment}, Vol: ${sentimentData.current.volatility}, USD: ${sentimentData.current.usd_strength}\nWarnings: ${sentimentData.current.warnings.join(', ') || 'none'}${sentimentData.hasFlipped ? '\n⚠️ SENTIMENT FLIPPED' : ''}`
      : '\nSentiment: unavailable';

    const prompt = `Mid-Trade Hard Check:
${JSON.stringify(snapshot)}
Trader: ${traderScore.confidence_level} (Score: ${traderScore.current_score}, Streak: ${traderScore.win_streak})${sentimentContext}

Position ${snapshot.dd.toFixed(0)}% toward SL. SERIOUS evaluation needed.
Analyze: Is trend still valid? Should we exit early? Trail SL?
Consider sentiment conditions in your decision.

Return JSON:
{
  "action": "HOLD|CLOSE|TRAIL_SL|REDUCE_RISK",
  "adjustedSL": number (if adjusting),
  "confidence": 0-100,
  "reasoning": "detailed explanation"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Alpha monitoring trades. Full hard evaluation. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 150,
          requestType: 'midtrade_hard',
          endpoint: 'midtrade-hard'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'MidTrade-Monitor',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'mid_trade',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const decision = this.parseDecision(content, 'hard');

      console.log(`[MidTrade Hard] ${snapshot.sym}: ${decision.action} @ ${snapshot.dd.toFixed(0)}% DD`);
      console.log(`[MidTrade Hard] Reasoning: ${decision.reasoning}`);
      return decision;
    } catch (error) {
      console.error('[MidTrade Hard] Error:', error);
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: 'Hard check failed - holding',
        trigger_level: 'hard'
      };
    }
  }

  /**
   * Emergency Check (70%+ drawdown)
   * Full Omega council + Alpha coordination
   */
  async evaluateEmergency(
    snapshot: MidTradeSnapshot,
    traderScore: TraderScore
  ): Promise<MidTradeDecision> {
    console.log(`[MidTrade Emergency] ${snapshot.sym}: EMERGENCY @ ${snapshot.dd.toFixed(0)}% DD - Calling Omega Council`);

    // Call critical Omegas in parallel
    const [trendVote, volVote, riskVote, confirmationVote] = await Promise.all([
      omegaTrend.evaluate({
        p: snapshot.p,
        e20: snapshot.e20,
        e50: snapshot.e50,
        e200: snapshot.e50, // Approximation
        mom: 0, // Not critical for mid-trade
        tr: snapshot.tr,
        vol: snapshot.vol
      }).catch(() => null),

      omegaVolatility.evaluate({
        atr: snapshot.atr,
        atr_avg: snapshot.atr,
        vol: snapshot.vol,
        c: [], // Not needed for mid-trade
        wick_ratio: 0
      }).catch(() => null),

      omegaRisk.evaluate({
        p: snapshot.p,
        proposed_sl: snapshot.sl,
        proposed_tp: snapshot.tp,
        atr: snapshot.atr,
        sup: [],
        res: [],
        vol: snapshot.vol,
        risk_pct: snapshot.risk_pct
      }).catch(() => null),

      omegaConfirmation.evaluate({
        p: snapshot.p,
        sup: [],
        res: [],
        sw: { h: snapshot.p, l: snapshot.sl },
        str: snapshot.structure ? 'check' : 'unknown',
        tr: snapshot.tr
      }).catch(() => null)
    ]);

    // Count votes
    const votes = [trendVote, volVote, riskVote, confirmationVote].filter(v => v !== null) as OmegaVote[];
    const exitVotes = votes.filter(v => v.vote === 'NO_TRADE' || v.vote !== snapshot.dir.toUpperCase()).length;
    const holdVotes = votes.filter(v => v.vote === snapshot.dir.toUpperCase()).length;

    console.log(`[MidTrade Emergency] Omega Council: ${exitVotes} EXIT, ${holdVotes} HOLD (of ${votes.length})`);

    // Alpha coordinates the emergency decision
    const alphaPrompt = `EMERGENCY Mid-Trade Decision:
${JSON.stringify(snapshot)}

Omega Council Votes:
Trend: ${trendVote?.vote || 'N/A'} (${trendVote?.confidence || 0}%) - ${trendVote?.reasoning || ''}
Volatility: ${volVote?.vote || 'N/A'} (${volVote?.confidence || 0}%) - ${volVote?.reasoning || ''}
Risk: ${riskVote?.vote || 'N/A'} (${riskVote?.confidence || 0}%) - ${riskVote?.reasoning || ''}
Confirmation: ${confirmationVote?.vote || 'N/A'} (${confirmationVote?.confidence || 0}%) - ${confirmationVote?.reasoning || ''}

Vote Count: ${exitVotes} favor EXIT, ${holdVotes} favor HOLD

Trade is ${snapshot.dd.toFixed(0)}% toward SL. CRITICAL DECISION.

Return JSON:
{
  "action": "HOLD|CLOSE",
  "confidence": 0-100,
  "reasoning": "final decision rationale"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Alpha coordinating emergency exit. Respect Omega votes. Return JSON only.'
          },
          {
            role: 'user',
            content: alphaPrompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.2, // Lower temp for emergency
          max_tokens: 150,
          requestType: 'midtrade_emergency',
          endpoint: 'midtrade-emergency'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'MidTrade-Monitor',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'mid_trade',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const decision = this.parseDecision(content, 'emergency');

      console.log(`[MidTrade Emergency] FINAL DECISION: ${decision.action} (${decision.confidence}%)`);
      console.log(`[MidTrade Emergency] Reasoning: ${decision.reasoning}`);

      return decision;
    } catch (error) {
      console.error('[MidTrade Emergency] Error:', error);

      // Default to Omega majority if Alpha fails
      if (exitVotes > holdVotes) {
        return {
          action: 'CLOSE',
          confidence: 85,
          reasoning: 'Omega majority voted EXIT - emergency fallback',
          trigger_level: 'emergency'
        };
      }

      return {
        action: 'HOLD',
        confidence: 50,
        reasoning: 'Emergency coordination failed - holding by default',
        trigger_level: 'emergency'
      };
    }
  }

  /**
   * Parse mid-trade decision
   */
  private parseDecision(response: string, level: 'soft' | 'hard' | 'emergency'): MidTradeDecision {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      let action = parsed.action || 'HOLD';
      if (!['HOLD', 'CLOSE', 'TRAIL_SL', 'REDUCE_RISK'].includes(action)) {
        action = 'HOLD';
      }

      return {
        action,
        adjustedSL: parsed.adjustedSL,
        confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
        reasoning: parsed.reasoning || 'No reasoning provided',
        trigger_level: level
      };
    } catch (error) {
      return {
        action: 'HOLD',
        confidence: 0,
        reasoning: 'Parse failed - holding by default',
        trigger_level: level
      };
    }
  }
}

export const midTradeMonitor = new MidTradeMonitorBrain();
