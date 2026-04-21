/**
 * Alpha Mid-Trade Analyst
 *
 * Event-driven re-analysis of a live trade thesis.
 * Only fires when a deterministic trigger fires — NOT on a fixed timer.
 *
 * Alpha receives the full original trade context and the trigger that fired,
 * then re-evaluates whether the thesis is still valid or the user should act.
 *
 * Model selection:
 * - gpt-4o-mini for most triggers (sufficient reasoning with full context)
 * - gpt-4o for emergency + thesis_invalidated cases (requires deep reasoning)
 *
 * Returns a structured verdict:
 *   HOLD         — thesis intact, stay in trade
 *   CLOSE_NOW    — thesis broken or momentum dead, close immediately
 *   TAKE_PARTIAL — take profit on part of position, run rest to TP
 *   TRAIL_SL     — move SL to protect gains, let trade run
 */

import { openAIClient } from '../services/openai-client';
import { llmTokenTracker } from '../services/llm-token-tracker';
import type { MidTradePlan } from '../services/mid-trade-plan-engine';
import { getPairCharacterContext } from '../config/pair-personalities';
import type { OmegaSensors } from '../services/omega-sensors';

export type AlphaRecheckVerdict = 'HOLD' | 'CLOSE_NOW' | 'TAKE_PARTIAL' | 'TRAIL_SL';
export type ThesisStatus = 'INTACT' | 'WEAKENING' | 'INVALIDATED';

export interface AlphaRecheckInput {
  // Trade identity
  tradeId: string;
  userId?: string;
  sessionId?: string;
  symbol: string;
  direction: 'buy' | 'sell';

  // Current trade state
  entryPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  rMultiple: number;
  drawdownPercent: number;
  minutesInTrade: number;

  // Original plan stored at entry
  midTradePlan: MidTradePlan | null;

  // Original Alpha reasoning (answer sheet fields if available)
  originalReasoning?: string;
  answerSheet?: {
    Q1_trend_alignment?: string;
    Q2_structure_level?: string;
    Q3_prior_rejections?: string;
    Q4_momentum_stage?: string;
    Q5_failure_mode?: string;
    Q5_failure_probability?: number;
    Q8_move_position_pct?: number;
    Q8B_session_range_pct?: number;
  } | null;

  // Trigger that fired
  triggerType: string;
  triggerReason: string;
  thesisIntactBefore: boolean;

  // Candle hint (optional — used for momentum_dying trigger)
  candleHint?: string;

  // Live market snapshot at recheck time (fresh indicators, not entry-time stale data)
  liveSnapshot?: {
    rsi: number;
    momentum: number;
    atrPercent: number;
    trend: string;
    trendScore: number;
    cho: string;          // change_of_character: "bull" | "bear" | "none"
    bos: string;          // break_of_structure: "bull" | "bear" | "none"
    rdiv: string;         // rsi_divergence: "bull" | "bear" | "none"
    rdiv_candles: number; // how many candles the divergence has been building
    mdiv: string;         // macd_divergence: "bull" | "bear" | "none"
    mom_delta: number;    // body size change: negative = momentum shrinking
    vol_ratio: number;    // current volume vs 20-candle avg (1.0 = average)
    vol_s: number;        // volume spike (1/0)
    vol_r: string;        // volume regime: "low" | "mid" | "high"
    atr_t: string;        // atr trend: "up" | "down" | "flat"
    pin_b: number;        // bullish pin bar (1/0)
    pin_s: number;        // bearish pin bar (1/0)
    eng_b: number;        // bullish engulfing (1/0)
    eng_s: number;        // bearish engulfing (1/0)
    swingHigh: number;
    swingLow: number;
    support: number[];
    resistance: number[];
  } | null;
}

export interface AlphaRecheckResult {
  verdict: AlphaRecheckVerdict;
  thesisStatus: ThesisStatus;
  confidence: number | null;
  alphaReasoning: string;
  userMessage: string;
  modelUsed: string;
  tokensUsed: number;
  shouldNotify: boolean;
  urgency: 'critical' | 'high' | 'medium' | 'low';
}

const TRIGGER_DESCRIPTIONS: Record<string, string> = {
  near_sl: 'Price is extremely close to the stop loss (< 15% buffer remaining)',
  severe_drawdown: 'Severe drawdown — price is 70%+ toward the stop loss',
  moderate_drawdown: 'Moderate drawdown — price is 50-69% toward the stop loss',
  momentum_dying: 'Momentum appears to be dying — candles shrinking, price failing to make new highs/lows',
  trade_stalling: 'Trade has been consolidating near entry for an extended period',
  time_exceeded_2x: 'Trade has been running for more than 2x its expected duration',
  drawdown_0_50R: 'Trade has pulled back to -0.50R from entry',
  drawdown_0_30R: 'Trade has pulled back to -0.30R from entry',
  tp_50_percent: 'Trade has reached 50% of the way to take profit',
  tp_70_percent: 'Trade has reached 70% of the way to take profit',
  near_tp: 'Take profit is 90%+ complete — final stretch',
  profit_1r: 'Trade has reached +1R profit milestone',
  profit_1_5R: 'Trade has reached +1.5R — consider trailing stop or taking partial profit',
  trail_sl_1_5r: 'Trade at +1.5R — time to consider trailing the stop loss',
  trail_sl_2r: 'Trade at +2R — strong trail opportunity to lock in gains',
  profit_giveback: 'Trade peaked in profit but has given back 50%+ of peak gains — defending profits',
};

function selectModel(triggerType: string, drawdownPercent: number): 'gpt-4o-mini' | 'gpt-4o' {
  // Use full gpt-4o when the stakes are highest: near SL with thesis broken,
  // or severe drawdown, or thesis was previously intact and now failing
  if (
    triggerType === 'near_sl' && drawdownPercent >= 80 ||
    triggerType === 'severe_drawdown'
  ) {
    return 'gpt-4o';
  }
  return 'gpt-4o-mini';
}

function buildSystemPrompt(symbol: string): string {
  const pairContext = getPairCharacterContext(symbol);

  return `You are Alpha — a professional trading AI monitoring a live trade in ${symbol}.

${pairContext}

Your job is to re-evaluate whether the original trade thesis is still valid now that a trigger has fired. You have the full original trade plan, the pre-trade answer_sheet Alpha completed at entry, and the current market state. Use the answer_sheet evidence to anchor your re-evaluation — your verdict must be consistent with the structural basis Alpha identified at entry, or explicitly state why that basis has changed.

Be direct. Be honest. Do not sugarcoat a failing thesis.

PERSONALITY:
- You are Alpha — the same identity that entered this trade
- Talk like an experienced trader who protects capital with the same conviction they deploy it
- Be concise — the user is watching a live trade
- When the thesis is broken, name what broke it with a specific structural observation
- When the thesis is intact but price is retesting, say so with conviction and name the level that must hold
- Never say "consider" or "might" — give a clear verdict with named structural evidence

VERDICT RULES:
- HOLD: Thesis intact, price action is normal, named structural support still holds — stay in trade
- CLOSE_NOW: Thesis is broken (name what broke) OR momentum is completely dead with no recovery signs — named evidence required
- TAKE_PARTIAL: Momentum is fading but partial profit makes sense — close partial now, run rest to named target
- TRAIL_SL: Trade in profit, protect gains by moving stop loss to named structural level

THESIS_STATUS RULES:
- INTACT: The original pattern, structure level, and Q1/Q2/Q4 answer_sheet pillars all still apply
- WEAKENING: One or two thesis pillars are cracking — name which fields from the answer_sheet are challenged
- INVALIDATED: The thesis is definitively broken — state which structural basis from the answer_sheet no longer holds

ANSWER_SHEET CROSS-REFERENCE:
When you receive the pre-trade answer_sheet, use it:
- Q1 trend alignment: is it still intact or has structure shifted?
- Q2 structure level: is price still respecting that named level or has it been broken?
- Q4 momentum stage: has momentum stage changed since entry?
- Q5 failure mode: has the failure mode Alpha identified at entry actually triggered?
- Primary failure mode probability vs what you now observe

Return ONLY valid JSON. No markdown, no explanation outside the JSON.`;
}

function buildPrompt(input: AlphaRecheckInput): string {
  const plan = input.midTradePlan;
  const isLong = input.direction === 'buy';
  const directionWord = isLong ? 'LONG' : 'SHORT';
  const triggerDesc = TRIGGER_DESCRIPTIONS[input.triggerType] || input.triggerReason;

  const lines: string[] = [];

  lines.push(`TRIGGER FIRED: ${input.triggerType.toUpperCase()}`);
  lines.push(`What happened: ${triggerDesc}`);
  lines.push('');
  lines.push('CURRENT TRADE STATE:');
  lines.push(`  Symbol: ${input.symbol} | Direction: ${directionWord}`);
  lines.push(`  Entry: ${input.entryPrice} | Current: ${input.currentPrice}`);
  lines.push(`  SL: ${input.stopLoss} | TP: ${input.takeProfit}`);
  lines.push(`  R-Multiple: ${input.rMultiple >= 0 ? '+' : ''}${input.rMultiple.toFixed(2)}R`);
  lines.push(`  Drawdown: ${input.drawdownPercent.toFixed(0)}%`);
  lines.push(`  Time in trade: ${input.minutesInTrade} minutes`);

  if (input.candleHint) {
    lines.push('');
    lines.push(`PRICE ACTION OBSERVATION: ${input.candleHint}`);
  }

  lines.push('');
  lines.push('ORIGINAL TRADE THESIS:');

  if (plan) {
    lines.push(`  Setup: ${plan.setup_summary}`);
    lines.push(`  Regime at entry: ${plan.regime_at_entry}`);
    lines.push(`  Expected direction: ${plan.expected_direction}`);
    lines.push(`  Expected duration: ${plan.expected_duration_minutes ?? 'unknown'} minutes`);
    lines.push(`  Invalidation price: ${plan.invalidation_price ?? input.stopLoss}`);
    if (plan.patterns?.htf) lines.push(`  HTF pattern: ${plan.patterns.htf}`);
    if (plan.patterns?.mtf) lines.push(`  MTF pattern: ${plan.patterns.mtf}`);
    if (plan.patterns?.ltf) lines.push(`  LTF pattern: ${plan.patterns.ltf}`);
    if (plan.omega_consensus) lines.push(`  Omega consensus: ${plan.omega_consensus}`);
    if (plan.entry_narrative) {
      lines.push('');
      lines.push(`  Entry narrative: ${plan.entry_narrative}`);
    }
    if (plan.scalp_pattern && plan.scalp_pattern !== 'none') {
      lines.push(`  Scalp pattern: ${plan.scalp_pattern}`);
      if (plan.scalp_momentum_phase) lines.push(`  Momentum phase at entry: ${plan.scalp_momentum_phase}`);
    }
  }

  if (input.answerSheet) {
    const s = input.answerSheet;
    lines.push('');
    lines.push('PRE-TRADE ANSWER SHEET:');
    if (s.Q1_trend_alignment) lines.push(`  Trend alignment: ${s.Q1_trend_alignment}`);
    if (s.Q2_structure_level) lines.push(`  Structure level: ${s.Q2_structure_level}`);
    if (s.Q3_prior_rejections) lines.push(`  Prior rejections: ${s.Q3_prior_rejections}`);
    if (s.Q4_momentum_stage) lines.push(`  Momentum stage at entry: ${s.Q4_momentum_stage}`);
    if (s.Q5_failure_mode) lines.push(`  Primary failure mode: ${s.Q5_failure_mode} (${s.Q5_failure_probability ?? '?'}% probability)`);
  }

  if (input.originalReasoning && input.originalReasoning !== 'No reasoning recorded') {
    const truncated = input.originalReasoning.length > 400
      ? input.originalReasoning.slice(0, 400) + '...'
      : input.originalReasoning;
    lines.push('');
    lines.push(`ORIGINAL REASONING SUMMARY: ${truncated}`);
  }

  if (input.liveSnapshot) {
    const s = input.liveSnapshot;
    lines.push('');
    lines.push('LIVE MARKET STATE NOW (fresh — not entry-time data):');
    lines.push(`  RSI: ${s.rsi.toFixed(1)} | Momentum: ${s.momentum >= 0 ? '+' : ''}${s.momentum.toFixed(4)}`);
    lines.push(`  Trend: ${s.trend} (score: ${s.trendScore}) | ATR%: ${(s.atrPercent * 100).toFixed(3)}%`);

    const structureNow: string[] = [];
    if (s.cho !== 'none') structureNow.push(`CHoCH ${s.cho.toUpperCase()} fired`);
    if (s.bos !== 'none') structureNow.push(`BOS ${s.bos.toUpperCase()}`);
    if (structureNow.length > 0) lines.push(`  Structure: ${structureNow.join(' | ')}`);
    else lines.push(`  Structure: No new BOS or CHoCH`);

    const divergence: string[] = [];
    if (s.rdiv !== 'none') divergence.push(`RSI divergence ${s.rdiv} (${s.rdiv_candles} candles building)`);
    if (s.mdiv !== 'none') divergence.push(`MACD divergence ${s.mdiv}`);
    lines.push(`  Divergence: ${divergence.length > 0 ? divergence.join(' | ') : 'none'}`);

    const momDesc = s.mom_delta < -0.3
      ? `SHRINKING FAST (${(s.mom_delta * 100).toFixed(0)}% body compression — exhaustion signal)`
      : s.mom_delta < -0.1
      ? `shrinking (${(s.mom_delta * 100).toFixed(0)}% compression)`
      : s.mom_delta > 0.2
      ? `expanding (${(s.mom_delta * 100).toFixed(0)}% body growth)`
      : 'stable';
    lines.push(`  Momentum candle bodies: ${momDesc}`);

    const volDesc = s.vol_ratio >= 1.5
      ? `SURGING (${s.vol_ratio.toFixed(1)}x avg) — ${s.vol_r}`
      : s.vol_ratio <= 0.6
      ? `LOW (${s.vol_ratio.toFixed(1)}x avg) — move may lack conviction`
      : `normal (${s.vol_ratio.toFixed(1)}x avg)`;
    lines.push(`  Volume: ${volDesc} | ATR trend: ${s.atr_t}`);

    const patterns: string[] = [];
    if (s.pin_b) patterns.push('bullish pin bar');
    if (s.pin_s) patterns.push('bearish pin bar');
    if (s.eng_b) patterns.push('bullish engulfing');
    if (s.eng_s) patterns.push('bearish engulfing');
    if (patterns.length > 0) lines.push(`  Candle patterns: ${patterns.join(', ')}`);

    if (s.support.length > 0) lines.push(`  Nearest support: ${s.support[0]}`);
    if (s.resistance.length > 0) lines.push(`  Nearest resistance: ${s.resistance[0]}`);
    lines.push(`  Swing high: ${s.swingHigh} | Swing low: ${s.swingLow}`);
    lines.push('');
    lines.push('  USE THIS: Cross-reference the live state above against the original thesis. Has structure shifted? Is the reversal against you showing on high or low volume? Is momentum dying (body compression) or is the move against you accelerating?');
  }

  lines.push('');
  lines.push('YOUR TASK:');
  lines.push('Re-evaluate whether the original thesis is still valid given the current trigger.');
  lines.push('Give a clear verdict and explain in 2-3 sentences what changed (or what is still intact).');
  lines.push('The user_message must be plain English, conversational, and specific to THIS trade.');
  lines.push('');
  lines.push('Return JSON:');
  lines.push('{');
  lines.push('  "verdict": "HOLD|CLOSE_NOW|TAKE_PARTIAL|TRAIL_SL",');
  lines.push('  "thesis_status": "INTACT|WEAKENING|INVALIDATED",');
  lines.push('  "confidence": 0-100,');
  lines.push('  "alpha_reasoning": "Your technical reasoning (1-2 sentences for internal audit)",');
  lines.push('  "user_message": "Your conversational message to the trader (2-3 sentences max, plain English)"');
  lines.push('}');

  return lines.join('\n');
}

function parseResponse(raw: string, fallbackTrigger: string): AlphaRecheckResult {
  const model = 'gpt-4o-mini';
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);

    const verdict: AlphaRecheckVerdict = ['HOLD', 'CLOSE_NOW', 'TAKE_PARTIAL', 'TRAIL_SL'].includes(parsed.verdict)
      ? parsed.verdict
      : 'HOLD';

    const thesisStatus: ThesisStatus = ['INTACT', 'WEAKENING', 'INVALIDATED'].includes(parsed.thesis_status)
      ? parsed.thesis_status
      : 'INTACT';

    const rawConfidence = parsed.confidence;
    if (rawConfidence === undefined || rawConfidence === null) {
      console.warn(`[CCIP-2026-0333] MISSING_MID_TRADE_CONFIDENCE: Alpha mid-trade response omitted confidence field. Trigger=${fallbackTrigger}. Persisting null.`);
    }
    const confidence: number | null = (rawConfidence !== undefined && rawConfidence !== null)
      ? Math.min(100, Math.max(0, rawConfidence))
      : null;

    const urgency: AlphaRecheckResult['urgency'] =
      verdict === 'CLOSE_NOW' ? 'critical' :
      verdict === 'TAKE_PARTIAL' ? 'high' :
      thesisStatus === 'WEAKENING' ? 'medium' :
      'low';

    return {
      verdict,
      thesisStatus,
      confidence,
      alphaReasoning: parsed.alpha_reasoning || 'No reasoning provided',
      userMessage: parsed.user_message || 'Alpha has reviewed the trade.',
      modelUsed: model,
      tokensUsed: 0,
      shouldNotify: verdict !== 'HOLD',
      urgency,
    };
  } catch {
    return {
      verdict: 'HOLD',
      thesisStatus: 'INTACT',
      confidence: 60,
      alphaReasoning: 'Parse failed — defaulting to HOLD',
      userMessage: `Alpha reviewed the ${fallbackTrigger} trigger. Trade appears to be within normal parameters — holding.`,
      modelUsed: model,
      tokensUsed: 0,
      shouldNotify: false,
      urgency: 'low',
    };
  }
}

export async function runAlphaMidTradeReanalysis(input: AlphaRecheckInput): Promise<AlphaRecheckResult> {
  const model = selectModel(input.triggerType, input.drawdownPercent);
  const maxTokens = model === 'gpt-4o' ? 350 : 280;

  const prompt = buildPrompt(input);
  const systemPrompt = buildSystemPrompt(input.symbol);

  try {
    const response = await openAIClient.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
      {
        model,
        temperature: 0.25,
        max_tokens: maxTokens,
        requestType: 'midtrade_reanalysis',
        endpoint: 'midtrade-reanalysis',
        symbol: input.symbol,
      }
    );

    const totalTokens = response.usage?.total_tokens ?? 0;

    await llmTokenTracker.logUsage({
      brainName: 'MidTrade-Analyst',
      model,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens,
      contextType: 'trade_monitoring',
      userId: input.userId,
      sessionId: input.sessionId,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const result = parseResponse(content, input.triggerType);
    result.modelUsed = model;
    result.tokensUsed = totalTokens;

    console.log(
      `[AlphaMidTradeAnalyst] ${input.symbol} | trigger=${input.triggerType} | verdict=${result.verdict} | thesis=${result.thesisStatus} | confidence=${result.confidence}%`
    );

    return result;
  } catch (error) {
    console.error('[AlphaMidTradeAnalyst] Error calling LLM:', error);
    return {
      verdict: 'HOLD',
      thesisStatus: 'INTACT',
      confidence: 50,
      alphaReasoning: 'LLM call failed — defaulting to HOLD',
      userMessage: 'Alpha was unable to complete the re-analysis. Continuing to monitor the trade.',
      modelUsed: model,
      tokensUsed: 0,
      shouldNotify: false,
      urgency: 'low',
    };
  }
}

/**
 * Determine whether a given trigger type should escalate to Alpha re-analysis.
 * Not every trigger warrants an LLM call — only the ones where Alpha's judgment
 * adds value beyond the deterministic message.
 */
export function shouldEscalateToAlpha(
  triggerType: string | null,
  drawdownPercent: number,
  rMultiple: number
): boolean {
  if (!triggerType) return false;

  // Always escalate on danger signals and profit-giveback (CCIP-2026-0324A)
  if (['near_sl', 'severe_drawdown', 'moderate_drawdown', 'momentum_dying', 'profit_giveback'].includes(triggerType)) {
    return true;
  }

  // Escalate on stalling / time overrun only if in drawdown
  if (['trade_stalling', 'time_exceeded_2x'].includes(triggerType) && rMultiple < 0) {
    return true;
  }

  // Escalate on profit milestones to get Alpha's exit/trail advice
  if (['near_tp', 'tp_70_percent', 'trail_sl_2r'].includes(triggerType) && rMultiple > 0) {
    return true;
  }

  // For minor drawdown triggers, only escalate if drawdown is meaningful
  if (triggerType === 'drawdown_0.50R' && drawdownPercent >= 45) {
    return true;
  }

  return false;
}

/**
 * Alpha Watch Contract
 *
 * Generated at trade entry based on Alpha's original reasoning.
 * Prescribes exactly what to watch for during the trade —
 * trade-specific conditions derived from Alpha's thesis, not generic percentages.
 *
 * CCIP-2026-0322A: SSOT for mid-trade watch conditions.
 * Written once by coordinator-alpha at entry. Never mutated post-entry.
 */
export interface AlphaWatchContract {
  invalidation_price: number | null;
  expected_duration_minutes: number | null;
  failure_mode: string | null;
  failure_probability: number | null;
  key_levels: Array<{ price: number; type: 'support' | 'resistance' | 'invalidation'; label: string }>;
  escalate_on: string[];
  created_at: string;
}

/**
 * Build an AlphaWatchContract from Alpha's decision data.
 * Called once at trade entry in alpha-trade-executor.
 * Replaces generic percentage thresholds with Alpha's own prescribed conditions.
 */
export function buildAlphaWatchContract(params: {
  stopLoss: number;
  takeProfit: number;
  direction: 'buy' | 'sell';
  expectedDurationMinutes: number | null;
  failureMode: string | null;
  failureProbability: number | null;
  invalidationPrice: number | null;
  patternInvalidationReasoning: string | null;
  confidence: number;
}): AlphaWatchContract {
  const {
    stopLoss,
    takeProfit,
    direction,
    expectedDurationMinutes,
    failureMode,
    failureProbability,
    invalidationPrice,
    confidence,
  } = params;

  const keyLevels: AlphaWatchContract['key_levels'] = [];
  const resolvedInvalidation = invalidationPrice ?? stopLoss;

  keyLevels.push({
    price: resolvedInvalidation,
    type: 'invalidation',
    label: invalidationPrice ? 'Pattern invalidation' : 'Stop loss',
  });

  const escalateOn: string[] = ['near_sl', 'severe_drawdown', 'moderate_drawdown'];

  if (failureProbability !== null && failureProbability >= 40) {
    escalateOn.push('momentum_dying');
  }

  if (expectedDurationMinutes !== null) {
    escalateOn.push('time_exceeded_2x');
  }

  if (confidence >= 70) {
    escalateOn.push('near_tp', 'trail_sl_2r');
  }

  return {
    invalidation_price: resolvedInvalidation,
    expected_duration_minutes: expectedDurationMinutes,
    failure_mode: failureMode,
    failure_probability: failureProbability,
    key_levels: keyLevels,
    escalate_on: [...new Set(escalateOn)],
    created_at: new Date().toISOString(),
  };
}

/**
 * Rate limit check: prevent Alpha from being called more than once per 15 minutes
 * per trade, UNLESS the trigger is near_sl or severe_drawdown (bypass rate limit).
 */
export function isRateLimited(
  lastRecheckAt: string | null,
  triggerType: string
): boolean {
  if (!lastRecheckAt) return false;

  // Emergency triggers bypass rate limit completely
  if (['near_sl', 'severe_drawdown'].includes(triggerType)) return false;

  const lastCheck = new Date(lastRecheckAt).getTime();
  const minutesSinceLastCheck = (Date.now() - lastCheck) / 1000 / 60;

  return minutesSinceLastCheck < 15;
}
