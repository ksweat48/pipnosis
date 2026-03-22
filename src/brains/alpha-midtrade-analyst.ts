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
}

export interface AlphaRecheckResult {
  verdict: AlphaRecheckVerdict;
  thesisStatus: ThesisStatus;
  confidence: number;
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
  tp_50_percent: 'Trade has reached 50% of the way to take profit',
  tp_70_percent: 'Trade has reached 70% of the way to take profit',
  near_tp: 'Take profit is 90%+ complete — final stretch',
  profit_1r: 'Trade has reached +1R profit milestone',
  trail_sl_1_5r: 'Trade at +1.5R — time to consider trailing the stop loss',
  trail_sl_2r: 'Trade at +2R — strong trail opportunity to lock in gains',
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

function buildSystemPrompt(): string {
  return `You are Alpha — a professional trading AI monitoring a live trade.

Your job is to re-evaluate whether the original trade thesis is still valid now that a trigger has fired.

You have the full original trade plan, the entry reasoning, and the current market state.
Be direct. Be honest. Do not sugarcoat a failing thesis.

PERSONALITY:
- Talk like an experienced trader who cares about protecting capital
- Be concise — the user is watching a live trade
- When the thesis is broken, say so clearly
- When the thesis is intact but price is retesting, say so with conviction
- Never say "consider" or "might" — give a clear verdict

VERDICT RULES:
- HOLD: Thesis intact, price action is normal, stay in trade
- CLOSE_NOW: Thesis is broken OR momentum is completely dead with no recovery signs
- TAKE_PARTIAL: Momentum is fading but partial profit makes sense — close 50% now, run rest
- TRAIL_SL: Trade in profit, protect gains by moving stop loss

THESIS_STATUS RULES:
- INTACT: The original pattern, structure, and reasoning all still apply
- WEAKENING: One or two thesis pillars are cracking but not fully broken yet
- INVALIDATED: The thesis is definitively broken — original entry reasoning no longer applies

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

    const confidence = Math.min(100, Math.max(0, parsed.confidence ?? 70));

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
  const maxTokens = model === 'gpt-4o' ? 250 : 200;

  const prompt = buildPrompt(input);
  const systemPrompt = buildSystemPrompt();

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
      brainName: 'Alpha-MidTrade-Analyst',
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

  // Always escalate on danger signals
  if (['near_sl', 'severe_drawdown', 'moderate_drawdown', 'momentum_dying'].includes(triggerType)) {
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
