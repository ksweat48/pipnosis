/**
 * Autonomous Wellness Monitor
 *
 * SSOT Authority for Periodic Wellness Checks + Alpha Trigger Re-Analysis
 *
 * Runs every 15 minutes via Netlify scheduled function.
 * Evaluates all open positions for deterministic trigger conditions.
 * When an important trigger fires, escalates to Alpha for a full thesis re-analysis.
 *
 * CCIP Architecture:
 * - Deterministic trigger check runs for ALL open trades (zero LLM cost)
 * - Alpha re-analysis only fires when shouldEscalateToAlpha() returns true
 * - Rate limited: no more than one Alpha call per trade per 15 minutes
 *   (except near_sl / severe_drawdown which bypass the rate limit)
 * - Results written via record_alpha_midtrade_recheck RPC (SSOT)
 */

import type { Handler } from '@netlify/functions';
import { getSupabaseAdmin } from './_shared/supabase-admin';
import OpenAI from 'openai';

const supabase = getSupabaseAdmin();

const MAX_EXECUTION_TIME_MS = 110000; // 110s — safe under Netlify 2-min limit

interface OpenPosition {
  id: string;
  user_id: string;
  goal_session_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  take_profit_1?: number | null;
  take_profit_2?: number | null;
  lot_size?: number;
  position_size?: number;
  current_pnl: number;
  status: string;
  opened_at?: string;
  created_at: string;
  mid_trade_plan?: any;
  alpha_reasoning_snapshot?: any;
  ai_reasoning?: string;
  thesis_status?: string | null;
  last_alpha_recheck_at?: string | null;
  alpha_recheck_count?: number;
}

interface TriggerResult {
  fired: boolean;
  triggerType: string | null;
  rMultiple: number;
  drawdownPercent: number;
  thesisIntactBefore: boolean;
  minutesInTrade: number;
  currentPrice: number;
  urgencyScore: number;
}

interface WellnessResult {
  positionId: string;
  symbol: string;
  triggerType: string | null;
  rMultiple: number;
  drawdownPercent: number;
  minutesInTrade: number;
  alphaCalledResult?: string;
  alphaVerdict?: string;
  actionTaken: boolean;
}

function getCurrentPrice(symbol: string, bid: number, ask: number, direction: 'buy' | 'sell'): number {
  return direction === 'buy' ? bid : ask;
}

function evaluateTriggers(position: OpenPosition, currentPrice: number): TriggerResult {
  const isLong = position.direction === 'buy';
  const risk = Math.abs(position.entry_price - position.stop_loss);
  if (risk === 0) {
    return { fired: false, triggerType: null, rMultiple: 0, drawdownPercent: 0, thesisIntactBefore: true, minutesInTrade: 0, currentPrice, urgencyScore: 0 };
  }

  const priceDiff = isLong
    ? (currentPrice - position.entry_price)
    : (position.entry_price - currentPrice);
  const rMultiple = priceDiff / risk;
  const distanceToSL = Math.abs(currentPrice - position.stop_loss);
  const slProximity = distanceToSL / risk;
  const drawdownPercent = Math.max(0, (-rMultiple) * 100);
  const totalTPDistance = Math.abs(position.take_profit - position.entry_price);
  const distanceToTP = Math.abs(currentPrice - position.take_profit);
  const tpProgress = totalTPDistance > 0 ? 1 - (distanceToTP / totalTPDistance) : 0;

  const openedAt = position.opened_at || position.created_at;
  const minutesInTrade = (Date.now() - new Date(openedAt).getTime()) / 1000 / 60;

  const plan = position.mid_trade_plan
    ? (typeof position.mid_trade_plan === 'string'
        ? JSON.parse(position.mid_trade_plan)
        : position.mid_trade_plan)
    : null;

  const invalidationPrice = plan?.invalidation_price ?? position.stop_loss;
  const thesisIntactBefore = isLong
    ? currentPrice > invalidationPrice
    : currentPrice < invalidationPrice;

  const expectedDuration = plan?.expected_duration_minutes ?? 90;

  // Evaluate in priority order (mirrors mid-trade-plan-engine.ts)
  if (slProximity < 0.15) {
    return { fired: true, triggerType: 'near_sl', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 95 };
  }
  if (drawdownPercent >= 70) {
    return { fired: true, triggerType: 'severe_drawdown', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 90 };
  }
  if (drawdownPercent >= 50) {
    return { fired: true, triggerType: 'moderate_drawdown', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 75 };
  }
  if (tpProgress >= 0.90) {
    return { fired: true, triggerType: 'near_tp', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 60 };
  }
  if (rMultiple >= 2.0) {
    return { fired: true, triggerType: 'trail_sl_2r', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 70 };
  }
  if (tpProgress >= 0.70) {
    return { fired: true, triggerType: 'tp_70_percent', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 55 };
  }
  if (minutesInTrade > 20 && rMultiple > 0.1 && rMultiple < 0.8 && tpProgress < 0.40) {
    return { fired: true, triggerType: 'momentum_dying', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 55 };
  }
  if (minutesInTrade > expectedDuration * 2 && rMultiple < 0) {
    return { fired: true, triggerType: 'time_exceeded_2x', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 50 };
  }
  if (rMultiple <= -0.50) {
    return { fired: true, triggerType: 'drawdown_0.50R', rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 60 };
  }

  return { fired: false, triggerType: null, rMultiple, drawdownPercent, thesisIntactBefore, minutesInTrade, currentPrice, urgencyScore: 0 };
}

function shouldEscalateToAlpha(triggerType: string | null, drawdownPercent: number, rMultiple: number): boolean {
  if (!triggerType) return false;
  if (['near_sl', 'severe_drawdown', 'moderate_drawdown', 'momentum_dying'].includes(triggerType)) return true;
  if (['time_exceeded_2x'].includes(triggerType) && rMultiple < 0) return true;
  if (['near_tp', 'trail_sl_2r'].includes(triggerType) && rMultiple > 0) return true;
  if (triggerType === 'drawdown_0.50R' && drawdownPercent >= 45) return true;
  return false;
}

function isRateLimited(lastRecheckAt: string | null, triggerType: string): boolean {
  if (!lastRecheckAt) return false;
  if (['near_sl', 'severe_drawdown'].includes(triggerType)) return false;
  const lastCheck = new Date(lastRecheckAt).getTime();
  const minutesSinceLastCheck = (Date.now() - lastCheck) / 1000 / 60;
  return minutesSinceLastCheck < 15;
}

async function callAlphaReanalysis(
  openai: OpenAI,
  position: OpenPosition,
  trigger: TriggerResult
): Promise<{ verdict: string; thesisStatus: string; confidence: number; alphaReasoning: string; userMessage: string; tokensUsed: number; model: string }> {
  const plan = position.mid_trade_plan
    ? (typeof position.mid_trade_plan === 'string'
        ? JSON.parse(position.mid_trade_plan)
        : position.mid_trade_plan)
    : null;

  let answerSheet: any = null;
  if (position.alpha_reasoning_snapshot) {
    try {
      const raw = typeof position.alpha_reasoning_snapshot === 'string'
        ? JSON.parse(position.alpha_reasoning_snapshot)
        : position.alpha_reasoning_snapshot;
      if (raw?.answer_sheet) answerSheet = raw.answer_sheet;
    } catch {
      // ignore
    }
  }

  const useFullModel = ['near_sl', 'severe_drawdown'].includes(trigger.triggerType ?? '') && trigger.drawdownPercent >= 70;
  const model = useFullModel ? 'gpt-4o' : 'gpt-4o-mini';
  const maxTokens = useFullModel ? 250 : 200;

  const directionWord = position.direction === 'buy' ? 'LONG' : 'SHORT';

  const triggerDescriptions: Record<string, string> = {
    near_sl: 'Price is extremely close to the stop loss (< 15% buffer remaining)',
    severe_drawdown: 'Severe drawdown — price is 70%+ toward the stop loss',
    moderate_drawdown: 'Moderate drawdown — price is 50-69% toward the stop loss',
    momentum_dying: 'Momentum appears to be dying — price not progressing toward TP despite being in profit',
    near_tp: 'Take profit is 90%+ complete — final stretch, consider securing gains',
    trail_sl_2r: 'Trade at +2R profit — strong trail opportunity',
    tp_70_percent: 'Trade 70% to TP — consider protecting gains',
    time_exceeded_2x: 'Trade has been running 2x its expected duration without completing',
    drawdown_0_50R: 'Trade has pulled back to -0.50R',
  };

  const triggerDesc = triggerDescriptions[trigger.triggerType ?? ''] ?? trigger.triggerType;

  const lines: string[] = [
    `TRIGGER: ${(trigger.triggerType ?? '').toUpperCase()}`,
    `What happened: ${triggerDesc}`,
    '',
    'CURRENT TRADE STATE:',
    `  Symbol: ${position.symbol} | Direction: ${directionWord}`,
    `  Entry: ${position.entry_price} | Current: ${trigger.currentPrice}`,
    `  SL: ${position.stop_loss} | TP: ${position.take_profit}`,
    `  R-Multiple: ${trigger.rMultiple >= 0 ? '+' : ''}${trigger.rMultiple.toFixed(2)}R`,
    `  Drawdown: ${trigger.drawdownPercent.toFixed(0)}%`,
    `  Time in trade: ${Math.floor(trigger.minutesInTrade)} minutes`,
    '',
    'ORIGINAL TRADE THESIS:',
  ];

  if (plan) {
    lines.push(`  Setup: ${plan.setup_summary ?? 'unknown'}`);
    lines.push(`  Regime at entry: ${plan.regime_at_entry ?? 'unknown'}`);
    lines.push(`  Expected direction: ${plan.expected_direction ?? position.direction}`);
    lines.push(`  Invalidation price: ${plan.invalidation_price ?? position.stop_loss}`);
    if (plan.expected_duration_minutes) lines.push(`  Expected duration: ${plan.expected_duration_minutes} minutes`);
    if (plan.patterns?.htf) lines.push(`  HTF pattern: ${plan.patterns.htf}`);
    if (plan.patterns?.mtf) lines.push(`  MTF pattern: ${plan.patterns.mtf}`);
    if (plan.omega_consensus) lines.push(`  Omega consensus: ${plan.omega_consensus}`);
    if (plan.entry_narrative) lines.push(`  Entry narrative: ${plan.entry_narrative}`);
    if (plan.scalp_pattern && plan.scalp_pattern !== 'none') {
      lines.push(`  Scalp pattern: ${plan.scalp_pattern}`);
      if (plan.scalp_momentum_phase) lines.push(`  Momentum phase at entry: ${plan.scalp_momentum_phase}`);
    }
  }

  if (answerSheet) {
    lines.push('', 'PRE-TRADE ANSWER SHEET:');
    if (answerSheet.Q1_trend_alignment) lines.push(`  Trend alignment: ${answerSheet.Q1_trend_alignment}`);
    if (answerSheet.Q4_momentum_stage) lines.push(`  Momentum stage at entry: ${answerSheet.Q4_momentum_stage}`);
    if (answerSheet.Q5_failure_mode) lines.push(`  Primary failure mode: ${answerSheet.Q5_failure_mode} (${answerSheet.Q5_failure_probability ?? '?'}% probability)`);
  }

  if (position.ai_reasoning && position.ai_reasoning !== 'No reasoning recorded') {
    const truncated = position.ai_reasoning.length > 300
      ? position.ai_reasoning.slice(0, 300) + '...'
      : position.ai_reasoning;
    lines.push('', `ORIGINAL REASONING: ${truncated}`);
  }

  lines.push(
    '',
    'YOUR TASK: Re-evaluate whether the original thesis is still valid. Give a clear verdict.',
    '',
    'Return JSON only:',
    '{',
    '  "verdict": "HOLD|CLOSE_NOW|TAKE_PARTIAL|TRAIL_SL",',
    '  "thesis_status": "INTACT|WEAKENING|INVALIDATED",',
    '  "confidence": 0-100,',
    '  "alpha_reasoning": "1-2 sentence technical audit note",',
    '  "user_message": "2-3 sentence plain English message for the trader"',
    '}'
  );

  const systemPrompt = `You are Alpha — a professional trading AI monitoring a live trade.
Re-evaluate whether the original thesis is still valid given the trigger that fired.
Be direct and honest. Protect capital when the thesis is broken.
Return ONLY valid JSON.`;

  const completion = await openai.chat.completions.create({
    model,
    temperature: 0.25,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: lines.join('\n') },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const tokensUsed = completion.usage?.total_tokens ?? 0;

  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const verdict = ['HOLD', 'CLOSE_NOW', 'TAKE_PARTIAL', 'TRAIL_SL'].includes(parsed.verdict)
      ? parsed.verdict : 'HOLD';
    const thesisStatus = ['INTACT', 'WEAKENING', 'INVALIDATED'].includes(parsed.thesis_status)
      ? parsed.thesis_status : 'INTACT';
    return {
      verdict,
      thesisStatus,
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 70)),
      alphaReasoning: parsed.alpha_reasoning ?? 'No reasoning',
      userMessage: parsed.user_message ?? 'Alpha reviewed the trade.',
      tokensUsed,
      model,
    };
  } catch {
    return {
      verdict: 'HOLD',
      thesisStatus: 'INTACT',
      confidence: 60,
      alphaReasoning: 'Parse failed',
      userMessage: 'Alpha reviewed the trade — holding.',
      tokensUsed,
      model,
    };
  }
}

async function logWellnessCheck(executionId: string, result: WellnessResult): Promise<void> {
  try {
    await supabase.from('wellness_check_logs').insert({
      execution_id: executionId,
      position_id: result.positionId,
      symbol: result.symbol,
      drawdown_percent: result.drawdownPercent,
      current_pnl: 0,
      minutes_in_trade: result.minutesInTrade,
      trigger_level: result.triggerType ?? 'none',
      analysis_triggered: !!result.alphaVerdict,
      action_taken: result.actionTaken,
      created_at: new Date().toISOString(),
    });
  } catch {
    // non-fatal
  }
}

export const handler: Handler = async () => {
  const executionId = `wellness_${Date.now()}`;
  const startTime = Date.now();

  console.log(`[AutonomousWellness:${executionId}] Starting...`);

  let openai: OpenAI;
  try {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  } catch {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'OpenAI client init failed', executionId }),
    };
  }

  try {
    const { data: positions, error: fetchError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('status', 'open')
      .not('entry_price', 'is', null)
      .order('opened_at', { ascending: true });

    if (fetchError) {
      console.error(`[AutonomousWellness:${executionId}] Fetch error:`, fetchError);
      return { statusCode: 500, body: JSON.stringify({ success: false, error: 'Fetch failed', executionId }) };
    }

    if (!positions || positions.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, message: 'No open positions', executionId, positionsChecked: 0 }),
      };
    }

    console.log(`[AutonomousWellness:${executionId}] Checking ${positions.length} positions`);

    const symbols = Array.from(new Set(positions.map((p: OpenPosition) => p.symbol)));
    const { data: priceRows } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask')
      .in('symbol', symbols)
      .order('created_at', { ascending: false });

    const latestPrices = new Map<string, { bid: number; ask: number }>();
    if (priceRows) {
      for (const row of priceRows) {
        if (!latestPrices.has(row.symbol)) {
          latestPrices.set(row.symbol, { bid: parseFloat(row.bid), ask: parseFloat(row.ask) });
        }
      }
    }

    let alphaCallCount = 0;
    let triggersDetected = 0;
    const results: WellnessResult[] = [];

    for (const position of positions as OpenPosition[]) {
      if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
        console.warn(`[AutonomousWellness:${executionId}] Timeout approaching — stopping`);
        break;
      }

      const prices = latestPrices.get(position.symbol);
      if (!prices) {
        results.push({
          positionId: position.id,
          symbol: position.symbol,
          triggerType: null,
          rMultiple: 0,
          drawdownPercent: 0,
          minutesInTrade: 0,
          actionTaken: false,
        });
        continue;
      }

      const currentPrice = getCurrentPrice(position.symbol, prices.bid, prices.ask, position.direction);
      const trigger = evaluateTriggers(position, currentPrice);

      const wellnessResult: WellnessResult = {
        positionId: position.id,
        symbol: position.symbol,
        triggerType: trigger.triggerType,
        rMultiple: trigger.rMultiple,
        drawdownPercent: trigger.drawdownPercent,
        minutesInTrade: trigger.minutesInTrade,
        actionTaken: false,
      };

      if (!trigger.fired || !trigger.triggerType) {
        results.push(wellnessResult);
        await logWellnessCheck(executionId, wellnessResult);
        continue;
      }

      triggersDetected++;

      if (!shouldEscalateToAlpha(trigger.triggerType, trigger.drawdownPercent, trigger.rMultiple)) {
        console.log(`[AutonomousWellness:${executionId}] ${position.symbol} trigger=${trigger.triggerType} — no Alpha escalation needed`);
        results.push(wellnessResult);
        await logWellnessCheck(executionId, wellnessResult);
        continue;
      }

      if (isRateLimited(position.last_alpha_recheck_at ?? null, trigger.triggerType)) {
        console.log(`[AutonomousWellness:${executionId}] ${position.symbol} — rate limited (last check < 15min)`);
        results.push(wellnessResult);
        await logWellnessCheck(executionId, wellnessResult);
        continue;
      }

      console.log(`[AutonomousWellness:${executionId}] ${position.symbol} trigger=${trigger.triggerType} rMultiple=${trigger.rMultiple.toFixed(2)} — calling Alpha`);
      alphaCallCount++;

      let alphaResult: Awaited<ReturnType<typeof callAlphaReanalysis>>;
      try {
        alphaResult = await callAlphaReanalysis(openai, position, trigger);
      } catch (err) {
        console.error(`[AutonomousWellness:${executionId}] Alpha call failed for ${position.symbol}:`, err);
        results.push(wellnessResult);
        await logWellnessCheck(executionId, wellnessResult);
        continue;
      }

      console.log(`[AutonomousWellness:${executionId}] ${position.symbol} verdict=${alphaResult.verdict} thesis=${alphaResult.thesisStatus}`);

      try {
        await supabase.rpc('record_alpha_midtrade_recheck', {
          p_trade_id: position.id,
          p_user_id: position.user_id,
          p_goal_session_id: position.goal_session_id,
          p_trigger_type: trigger.triggerType,
          p_trigger_reason: trigger.triggerType,
          p_current_price: trigger.currentPrice,
          p_r_multiple: trigger.rMultiple,
          p_drawdown_percent: trigger.drawdownPercent,
          p_minutes_in_trade: Math.floor(trigger.minutesInTrade),
          p_thesis_intact_before: trigger.thesisIntactBefore,
          p_verdict: alphaResult.verdict,
          p_thesis_status: alphaResult.thesisStatus,
          p_confidence: alphaResult.confidence,
          p_alpha_reasoning: alphaResult.alphaReasoning,
          p_user_message: alphaResult.userMessage,
          p_model_used: alphaResult.model,
          p_tokens_used: alphaResult.tokensUsed,
        });
      } catch (rpcErr) {
        console.error(`[AutonomousWellness:${executionId}] RPC record failed:`, rpcErr);
      }

      wellnessResult.alphaVerdict = alphaResult.verdict;
      wellnessResult.alphaCalledResult = alphaResult.thesisStatus;
      wellnessResult.actionTaken = alphaResult.verdict !== 'HOLD';

      results.push(wellnessResult);
      await logWellnessCheck(executionId, wellnessResult);
    }

    const duration = Date.now() - startTime;
    const closeNowCount = results.filter(r => r.alphaVerdict === 'CLOSE_NOW').length;
    const weakenCount = results.filter(r => r.alphaCalledResult === 'WEAKENING').length;

    console.log(`[AutonomousWellness:${executionId}] Done in ${duration}ms — positions=${positions.length} triggers=${triggersDetected} alphaCalls=${alphaCallCount} closeNow=${closeNowCount}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        executionId,
        positionsChecked: positions.length,
        triggersDetected,
        alphaCallsMade: alphaCallCount,
        closeNowSignals: closeNowCount,
        weakeningSignals: weakenCount,
        durationMs: duration,
        timestamp: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error(`[AutonomousWellness:${executionId}] Critical error:`, error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        executionId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
