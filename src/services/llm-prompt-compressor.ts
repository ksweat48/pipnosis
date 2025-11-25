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
 * LAYER 5: Strategy Brain (Compressed)
 * Target: 350-400 tokens (vs 1800 original)
 */
export function buildCompressedStrategyPrompt(
  snap: CompactSnapshot,
  goal: {
    target: number;
    progress: number;
    remaining: number;
  },
  perf: {
    wr: number;
    pf: number;
  },
  skill?: CompactSkillContext
): string {
  try {
    // Defensive validation with safe defaults
    const safeGoal = {
      target: goal?.target ?? 0,
      progress: goal?.progress ?? 0,
      remaining: goal?.remaining ?? 0
    };
    const safePerf = {
      wr: perf?.wr ?? 0,
      pf: perf?.pf ?? 0
    };

  let prompt = `Layer 5: Strategy Brain (Full Authority)

Market:
sym=${snap.sym}, p=${snap.p}, tr=${snap.tr}, vol=${snap.vol}
e9=${snap.vw}, e21=${snap.e20}, e50=${snap.e50}, vw=${snap.vw}
atr=${snap.atr}, mom=${snap.mom}

Goal: $${safeGoal.target} (${safeToFixed(safeGoal.progress, 1)}% done, $${safeGoal.remaining} left)
Perf: wr=${safeToFixed(safePerf.wr, 1)}%, pf=${safeToFixed(safePerf.pf, 2)}`;

  if (skill) {
    const safeSkill = {
      lvl: skill.lvl ?? 'Unknown',
      tgt: skill.tgt ?? 'Unknown',
      wr_gap: skill.wr_gap ?? 0,
      pf_gap: skill.pf_gap ?? 0
    };
    prompt += `
Skill: ${safeSkill.lvl}→${safeSkill.tgt}
Gaps: wr=${safeDelta(safeSkill.wr_gap, 1)}%, pf=${safeDelta(safeSkill.pf_gap, 2)}
Priority: ${safeSkill.wr_gap < 0 ? 'IMPROVE WR' : 'MAINTAIN'}`;
  }

  prompt += `

CRITICAL: Return ONLY valid JSON. No explanation, no markdown, no text outside JSON.

Example format:
{"act":"buy","sl":1.0850,"tp":1.0920,"size":3,"conf":78,"why":"Strong trend + support"}

Decision rules:
1. act: "buy", "sell", or "no_trade"
2. sl/tp: exact prices based on structure
3. size: 1-5% based on conf + recent perf
4. conf: 0-100 based on setup quality
5. why: brief reason (max 10 words)

Max hold: 4h. Min R:R: 1.5:1.

Return JSON now:`;

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
  const currentCandle = snapshot.ohlc?.[snapshot.ohlc.length - 1] || {};

  return {
    sym: snapshot.symbol || '',
    p: currentCandle.close || 0,
    tr: snapshot.priceAction?.trend || 'unknown',
    vol: snapshot.priceAction?.volatility || 'unknown',
    mom: snapshot.priceAction?.momentum || 0,
    vw: snapshot.indicators?.vwap || 0,
    e20: snapshot.indicators?.ema20 || 0,
    e50: snapshot.indicators?.ema50 || 0,
    atr: snapshot.indicators?.atr || 0,
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
