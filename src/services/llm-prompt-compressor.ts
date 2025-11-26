/**
 * LLM Prompt Compressor
 *
 * Ultra-lean prompt builders for all 5 layers.
 * Reduces token usage by 80% while maintaining intelligence.
 */

import { safeToFixed, safePercent, safeCurrency, safeNumber, safeDelta } from '../utils/safe-formatters';

export interface CompactSnapshot {
  sym: string; // symbol
  p: number; // price
  tr: string; // trend
  vol: string; // volatility
  mom: number; // momentum
  vw: number; // vwap
  e20: number; // ema20
  e50: number; // ema50
  atr: number;
  trig: string; // trigger
  trig_c: number; // trigger confidence
}

export interface CompactSkillContext {
  lvl: string; // current level
  tgt: string; // target level
  wr_gap: number; // win rate gap
  pf_gap: number; // profit factor gap
  cons_gap: number; // consistency gap
  wr: number; // current win rate
}

/**
 * LAYER 1: Regime Validator (Compressed)
 * Target: 120 tokens (vs 600 original)
 */
export function buildCompressedRegimePrompt(
  snap: CompactSnapshot,
  skill?: CompactSkillContext
): string {
  let prompt = `Layer 1: Regime Validator

Analyze market data and return ONLY this JSON:

{
  "ok": true|false,
  "tr": "bullish"|"bearish",
  "vol": "low"|"medium"|"high",
  "mom": "up"|"down"|"neutral",
  "conf": <0-100>,
  "rec": "long"|"short"|"hold"|"abort",
  "why": "<1 sentence>"
}

Rules:
- Neutral momentum is OK; never reject for neutral.
- Reject ONLY if mom OPPOSES tr:
    bullish+down → reject
    bearish+up → reject
- bullish+neutral = OK
- bearish+neutral = OK
- "conf" MUST be a number 0-100.
- "rec"="abort" if conf<30 or if momentum opposes trend.
- No text outside JSON.

Data:
tr=${snap.tr}, vol=${snap.vol}, mom=${snap.mom}
trig=${snap.trig}, trig_c=${snap.trig_c}
vw=${snap.vw}, e20=${snap.e20}, e50=${snap.e50}, atr=${snap.atr}`;

  if (skill) {
    prompt += `
skill: wr_gap=${safeToFixed(skill.wr_gap, 1)}%`;
    if (skill.wr_gap < -5) {
      prompt += ` (strict mode, be stricter)`;
    }
  }

  return prompt;
}

/**
 * LAYER 2: Setup Quality (Compressed)
 * Target: 150 tokens (vs 750 original)
 */
export function buildCompressedSetupPrompt(
  snap: CompactSnapshot,
  regimeConf: number,
  threshold: number,
  skill?: CompactSkillContext
): string {
  let prompt = `Layer 2: Setup Quality

Analyze setup and return ONLY this JSON:

{
  "score": <0-100>,           // REQUIRED overall quality score
  "entry": <0-100>,           // REQUIRED entry point quality
  "timing": <0-100>,          // REQUIRED timing quality
  "ctx": <0-100>,             // REQUIRED context quality
  "rr": <1.0-5.0>,            // REQUIRED risk:reward
  "rec": "accept"|"reject",
  "why": "<1 sentence>"
}

Rules:
- ALL numeric fields MUST exist and be NUMBERS.
- "rec"="reject" if score < ${threshold}.
- No extra words, no markdown, no text outside JSON.

Data:
trig=${snap.trig}, tr=${snap.tr}, vol=${snap.vol}
vw=${snap.vw}, e20=${snap.e20}, e50=${snap.e50}, atr=${snap.atr}
regime_conf=${regimeConf}, thresh=${threshold}`;

  if (skill && skill.wr_gap < -5) {
    prompt += `
strict: wr_gap=${safeToFixed(skill.wr_gap, 1)}% (be stricter)`;
  }

  return prompt;
}

/**
 * LAYER 3: Mistake Prevention (Compressed)
 * Target: 180 tokens (vs 800 original)
 */
export function buildCompressedMistakePrompt(
  snap: CompactSnapshot,
  qualityScore: number,
  regimeConf: number,
  lossContext: {
    consec: number;
    loss_rate: number;
    similar: number;
    corr_risk: boolean;
  }
): string {
  const prompt = `Layer 3: Mistake Prevention

Check for red flags and return ONLY this JSON:

{
  "allow": true|false,        // REQUIRED
  "risk": "low"|"medium"|"high",  // REQUIRED
  "flags": ["..."],           // REQUIRED array (empty if none)
  "rec": "allow"|"warn"|"block"
}

Rules:
- ALL fields MUST exist.
- Block if similar > 5 OR corr_risk=true OR consec > 3.
- No extra words, no markdown, no text outside JSON.

Data:
qual=${qualityScore}, regime_conf=${regimeConf}
consec_loss=${lossContext.consec}, loss_rate=${lossContext.loss_rate}%
similar_patterns=${lossContext.similar}, corr_risk=${lossContext.corr_risk}`;

  return prompt;
}

/**
 * LAYER 4: Confidence Calibrator (Compressed)
 * Target: 100 tokens (vs 550 original)
 */
export function buildCompressedCalibrationPrompt(
  origConf: number,
  histAcc: number,
  overconf: boolean,
  skill?: CompactSkillContext
): string {
  let prompt = `Layer 4: Calibrator

Calibrate confidence and return ONLY this JSON:

{
  "cal": <0-100>,             // REQUIRED calibrated confidence
  "adj": <±number>,           // REQUIRED adjustment amount
  "curve": "conservative"|"balanced"|"aggressive"
}

Rules:
- ALL fields MUST exist and be valid.
- If hist_acc < orig → lower by 5-10.
- If overconf=true → lower by 5 more.
- Max adjustment: ±15.
- No extra words, no markdown, no text outside JSON.

Data:
orig=${origConf}, hist_acc=${histAcc}, overconf=${overconf}`;

  if (skill && skill.wr_gap < -5) {
    prompt += `, wr_gap=${safeToFixed(skill.wr_gap, 1)} (be stricter)`;
  }

  return prompt;
}

/**
 * LAYER 5: Execution Brain (Aggressive)
 * Target: 600-700 tokens for full context and psychological framing
 */
export function buildCompressedStrategyPrompt(
  snap: CompactSnapshot,
  setupQuality: number,
  goal: {
    target: number;
    progress: number;
    remaining: number;
  },
  perf: {
    wr: number;
    pf: number;
  },
  skill?: CompactSkillContext,
  validation?: {
    qualityScore: number;
    regimeConf: number;
    riskLevel: string;
    layersPassed: number;
  },
  account?: {
    equity: number;
    maxRiskPct: number;
    dailyLossRemainingPct: number;
  }
): string {
  try {
    // Defensive validation with safe defaults
    const safeGoal = {
      target: goal?.target ?? 500,
      progress: goal?.progress ?? 0,
      remaining: goal?.remaining ?? 500
    };
    const safePerf = {
      wr: perf?.wr ?? 0,
      pf: perf?.pf ?? 1.0
    };
    const safeValidation = {
      qualityScore: validation?.qualityScore ?? setupQuality ?? 70,
      regimeConf: validation?.regimeConf ?? 70,
      riskLevel: validation?.riskLevel ?? 'low',
      layersPassed: validation?.layersPassed ?? 4
    };
    const safeAccount = {
      equity: account?.equity ?? 10000,
      maxRiskPct: account?.maxRiskPct ?? 5.0,
      dailyLossRemainingPct: account?.dailyLossRemainingPct ?? 100
    };

    // Calculate derived values
    const wrTarget = skill?.wr_gap !== undefined ? skill.wr - skill.wr_gap : 45;
    const wrPerformance = skill?.wr_gap ?? 0 >= 0 ? 'CRUSHING IT' : 'below target';
    const pfStatus = safePerf.pf >= 1.2 ? 'excellent' : safePerf.pf >= 1.0 ? 'profitable' : 'needs improvement';
    const alignmentStrength = snap.mom > 0 && snap.tr === 'bullish' ? 'STRONG BULLISH' :
                               snap.mom < 0 && snap.tr === 'bearish' ? 'STRONG BEARISH' : 'MIXED';
    const volImpact = snap.vol === 'high' ? 'BIG PROFIT POTENTIAL' : snap.vol === 'low' ? 'tighter ranges' : 'normal';

  let prompt = `PIPNOSIS EXECUTION BRAIN - LIVE TRADING MODE

You are an elite institutional trader. This setup has PASSED ${safeValidation.layersPassed} validation layers.
Quality Score: ${safeValidation.qualityScore}/100 ✓ | Regime Conf: ${safeValidation.regimeConf}% ✓ | Risk: ${safeValidation.riskLevel.toUpperCase()} ✓

Your job: EXECUTE high-probability trades. Be decisive. Be aggressive within limits.

=== MARKET SNAPSHOT ===
Symbol: ${snap.sym} | Price: $${safeToFixed(snap.p, 2)}
Trend: ${snap.tr.toUpperCase()} | Volatility: ${snap.vol.toUpperCase()} | Momentum: ${snap.mom > 0 ? 'UP' : snap.mom < 0 ? 'DOWN' : 'NEUTRAL'}
EMA9: ${safeToFixed(snap.vw, 2)} | EMA21: ${safeToFixed(snap.e20, 2)} | EMA50: ${safeToFixed(snap.e50, 2)} | VWAP: ${safeToFixed(snap.vw, 2)}
ATR: $${safeToFixed(snap.atr, 2)} (use for SL/TP calculation)

${alignmentStrength} ALIGNMENT
${snap.vol === 'high' ? volImpact : ''}

=== YOUR PERFORMANCE ===
Win Rate: ${safeToFixed(safePerf.wr, 1)}% (TARGET: ${safeToFixed(wrTarget, 0)}% - ${wrPerformance}${ skill?.wr_gap && skill.wr_gap > 0 ? ` +${safeToFixed(skill.wr_gap, 1)}% above target` : ''})
Profit Factor: ${safeToFixed(safePerf.pf, 2)} (${pfStatus})
Skill Level: ${skill?.lvl ?? 'Developing'} → ${skill?.tgt ?? 'Intermediate'} (PROGRESSING)

=== MISSION OBJECTIVE ===
Target: $${safeToFixed(safeGoal.target, 0)} | Progress: $${safeToFixed(safeGoal.target - safeGoal.remaining, 0)} (${safeToFixed(safeGoal.progress, 1)}%) | Remaining: $${safeToFixed(safeGoal.remaining, 0)}
You need MORE TRADES to reach goal. Sitting idle = mission failure.

=== ACCOUNT STATE ===
Equity: $${safeToFixed(safeAccount.equity, 2)} | Max Risk/Trade: ${safeToFixed(safeAccount.maxRiskPct, 1)}%
Daily Loss Budget: ${safeToFixed(safeAccount.dailyLossRemainingPct, 0)}% remaining

=== TRADING MANDATE ===
🎯 This setup PASSED all filters - there's a reason you're seeing it
🎯 Quality ${safeValidation.qualityScore}/100 = TRADEABLE. Institutions trade 65+. You should too.
🎯 ${skill?.wr_gap && skill.wr_gap > 0 ? `Your win rate is ${safeToFixed(skill.wr_gap, 1)}% ABOVE target - you have EARNED the right to trade` : 'Focus on quality setups to improve performance'}
🎯 ${snap.vol === 'high' ? 'High volatility = high reward. Don\'t fear it. EXPLOIT it.' : ''}
🎯 ${alignmentStrength !== 'MIXED' ? `${snap.tr === 'bullish' ? 'Bullish' : 'Bearish'} trend + momentum = probabilistic edge. USE IT.` : ''}

=== EXECUTION RULES ===
- Direction: ${snap.tr === 'bullish' ? 'PREFER "buy"' : snap.tr === 'bearish' ? 'PREFER "sell"' : 'WAIT for clarity or no_trade'}
- If trend + momentum align → TRADE (buy on bullish, sell on bearish)
- Stop Loss: Current price ± (1.5 × ATR) = ${snap.tr === 'bullish' ? safeToFixed(snap.p - (1.5 * snap.atr), 2) : safeToFixed(snap.p + (1.5 * snap.atr), 2)}
- Take Profit: SL ± (2.0 × ATR) minimum for 1.5:1 R:R
- Risk %: ${safeValidation.qualityScore >= 80 ? '3.5-5.0%' : safeValidation.qualityScore >= 70 ? '2.5-3.5%' : '1.5-2.5%'} (quality-based)
- Position Size: Calculate from risk_pct, equity, and SL distance
- Confidence: ${safeValidation.qualityScore >= 75 ? '75-90' : '65-80'} for passed setups (reflect true conviction)
- Max Hold: 4 hours
- Only use "no_trade" if setup is genuinely flawed (rare after ${safeValidation.layersPassed} layers)

=== DYNAMIC RISK SIZING ===
Quality ${safeValidation.qualityScore}+ & WR above target → Upper risk band (${safeToFixed(safeAccount.maxRiskPct * 0.8, 1)}-${safeToFixed(safeAccount.maxRiskPct, 1)}%)
Quality 65-79 or normal state → Middle band (${safeToFixed(safeAccount.maxRiskPct * 0.5, 1)}-${safeToFixed(safeAccount.maxRiskPct * 0.7, 1)}%)
Drawdown or loss streak → Lower band (${safeToFixed(safeAccount.maxRiskPct * 0.3, 1)}-${safeToFixed(safeAccount.maxRiskPct * 0.5, 1)}%)

=== AGGRESSIVE TRADING PSYCHOLOGY ===
You are NOT a scared retail trader.
You are a FUNDED, VALIDATED, ALGORITHM-BACKED execution system.
The hard thinking is DONE (${safeValidation.layersPassed} layers passed).
Your job: EXECUTE WITH PRECISION AND CONFIDENCE.

Fear kills profit. Hesitation costs money. Decisiveness wins.

=== OUTPUT FORMAT ===
Return ONLY this JSON (no text before/after):

{
  "act": "buy",
  "sl": ${snap.tr === 'bullish' ? safeToFixed(snap.p - (1.5 * snap.atr), 2) : safeToFixed(snap.p + (1.5 * snap.atr), 2)},
  "tp": ${snap.tr === 'bullish' ? safeToFixed(snap.p + (3.0 * snap.atr), 2) : safeToFixed(snap.p - (3.0 * snap.atr), 2)},
  "risk_pct": ${safeValidation.qualityScore >= 80 ? '4.0' : '3.0'},
  "size": ${safeValidation.qualityScore >= 80 ? '4' : '3'},
  "conf": ${safeValidation.qualityScore >= 75 ? '80' : '70'},
  "rr": 2.0,
  "setup": "ema_trend",
  "why": "${snap.tr === 'bullish' ? 'Bullish trend + EMA alignment + high momentum' : snap.tr === 'bearish' ? 'Bearish trend + breakdown + momentum down' : 'Unclear setup'}"
}

Fields:
- act: "buy" (bullish), "sell" (bearish), or "no_trade" (only if truly broken)
- sl: exact price (use ATR formula: price ± 1.5×ATR)
- tp: exact price (min 1.5:1 R:R, aim for 2:1+)
- risk_pct: ${safeToFixed(safeAccount.maxRiskPct * 0.3, 1)}-${safeToFixed(safeAccount.maxRiskPct, 1)}% (dynamic based on quality+state)
- size: 2-5 (position size %, higher for better quality)
- conf: 65-90 (reflect true conviction - passed setups deserve high conf)
- rr: 1.5-3.0 (actual risk:reward ratio)
- setup: "ema_trend"|"breakout"|"sr_bounce"|"momentum"|"reversal"|"pullback" (categorize setup type)
- why: 5-10 words explaining edge

EXECUTE NOW. BE BOLD. CAPTURE PROFIT.`;

    return prompt;
  } catch (error) {
    console.error('[buildCompressedStrategyPrompt] Error building prompt:', error);
    console.error('[buildCompressedStrategyPrompt] goal:', goal);
    console.error('[buildCompressedStrategyPrompt] perf:', perf);
    console.error('[buildCompressedStrategyPrompt] skill:', skill);

    // Return a minimal safe fallback prompt
    return `Layer 5: Strategy Brain (Full Authority)

Market: ${snap.sym} at ${snap.p}

Decision: no_trade (Error in prompt building)
JSON: {"act":"no_trade","sl":0,"tp":0,"size":0,"conf":0,"why":"Prompt building error - safety fallback"}`;
  }
}

/**
 * Convert full snapshot to compact format
 */
export function compressSnapshot(snapshot: any): CompactSnapshot {
  // Get the best available timeframe (prefer M15, M5, or H1)
  const timeframeKeys = Object.keys(snapshot.timeframes || {});
  let bestTimeframe = null;

  // Priority order for timeframes
  const priorities = ['M15', '15m', 'M5', '5m', 'H1', '1h', 'M30', '30m'];
  for (const pref of priorities) {
    const found = timeframeKeys.find(k =>
      k === pref || k.toLowerCase() === pref.toLowerCase()
    );
    if (found) {
      bestTimeframe = snapshot.timeframes[found];
      break;
    }
  }

  // Fallback to first available timeframe
  if (!bestTimeframe && timeframeKeys.length > 0) {
    bestTimeframe = snapshot.timeframes[timeframeKeys[0]];
  }

  // Extract data from best timeframe or use fallbacks
  const price = bestTimeframe?.currentPrice || 0;
  const ema9 = bestTimeframe?.ema9 || 0;
  const ema21 = bestTimeframe?.ema21 || 0;
  const ema50 = bestTimeframe?.ema50 || 0;
  const vwap = bestTimeframe?.vwap || 0;
  const atr = bestTimeframe?.atr || 0;
  const trend = bestTimeframe?.trend || 'unknown';
  const volatility = bestTimeframe?.volatility || 'unknown';

  // Calculate momentum from EMAs
  let momentum = 0;
  if (ema9 && ema21) {
    momentum = ((ema9 - ema21) / ema21) * 100; // percentage difference
  }

  return {
    sym: snapshot.symbol || '',
    p: price,
    tr: trend,
    vol: volatility,
    mom: momentum,
    vw: vwap,
    e20: ema21,
    e50: ema50,
    atr: atr,
    trig: '',
    trig_c: 0,
  };
}

/**
 * Convert skill context to compact format
 */
export function compressSkillContext(skillContext: any): CompactSkillContext | undefined {
  if (!skillContext) return undefined;

  return {
    lvl: skillContext.currentLevel || 'unknown',
    tgt: skillContext.targetLevel || 'unknown',
    wr_gap: skillContext.gaps?.winRateGap || 0,
    pf_gap: skillContext.gaps?.profitFactorGap || 0,
    cons_gap: skillContext.gaps?.consistencyGap || 0,
    wr: skillContext.currentPerformance?.winRate || 0,
  };
}
