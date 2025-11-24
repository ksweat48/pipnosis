/**
 * LLM Prompt Compressor
 *
 * Ultra-lean prompt builders for all 5 layers.
 * Reduces token usage by 80% while maintaining intelligence.
 */

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

Input:
tr=${snap.tr}, vol=${snap.vol}, mom=${snap.mom}
trig=${snap.trig}, trig_c=${snap.trig_c}
vw=${snap.vw}, e20=${snap.e20}, e50=${snap.e50}, atr=${snap.atr}`;

  if (skill) {
    prompt += `
skill: wr_gap=${skill.wr_gap.toFixed(1)}%`;
    if (skill.wr_gap < -5) {
      prompt += ` (strict mode)`;
    }
  }

  prompt += `

Rule: Check trend/vol/mom match trigger. Reject if mismatch.

JSON:
{"ok":bool,"tr":"...","vol":"...","mom":"...","conf":0-100,"rec":"proceed/abort","why":"..."}`;

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

Input:
trig=${snap.trig}, tr=${snap.tr}, vol=${snap.vol}
vw=${snap.vw}, e20=${snap.e20}, e50=${snap.e50}, atr=${snap.atr}
regime_conf=${regimeConf}, thresh=${threshold}`;

  if (skill && skill.wr_gap < -5) {
    prompt += `
strict: wr_gap=${skill.wr_gap.toFixed(1)}%`;
  }

  prompt += `

Task: Score entry, timing, context (0-100). Accept if >= ${threshold}.

JSON:
{"score":0-100,"entry":0-100,"timing":0-100,"ctx":0-100,"rr":1.0-5.0,"rec":"accept/reject","why":"..."}`;

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

Input:
qual=${qualityScore}, regime_conf=${regimeConf}
consec_loss=${lossContext.consec}, loss_rate=${lossContext.loss_rate}%
similar_patterns=${lossContext.similar}, corr_risk=${lossContext.corr_risk}

Rule: Block if similar > 5 OR corr_risk true OR consec > 3.

JSON:
{"allow":bool,"risk":"low/med/high","flags":["..."],"rec":"allow/warn/block"}`;

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

orig=${origConf}, hist_acc=${histAcc}, overconf=${overconf}`;

  if (skill && skill.wr_gap < -5) {
    prompt += `, wr_gap=${skill.wr_gap.toFixed(1)}`;
  }

  prompt += `

Rule: If hist<orig → lower 5-10. If overconf → lower 5 more. Max ±15.

JSON:
{"cal":0-100,"adj":±num,"curve":"conservative/balanced/aggressive"}`;

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
  let prompt = `Layer 5: Strategy Brain (Full Authority)

Market:
sym=${snap.sym}, p=${snap.p}, tr=${snap.tr}, vol=${snap.vol}
e9=${snap.vw}, e21=${snap.e20}, e50=${snap.e50}, vw=${snap.vw}
atr=${snap.atr}, mom=${snap.mom}

Goal: $${goal.target} (${goal.progress.toFixed(1)}% done, $${goal.remaining} left)
Perf: wr=${perf.wr.toFixed(1)}%, pf=${perf.pf.toFixed(2)}`;

  if (skill) {
    prompt += `
Skill: ${skill.lvl}→${skill.tgt}
Gaps: wr=${skill.wr_gap > 0 ? '+' : ''}${skill.wr_gap.toFixed(1)}%, pf=${skill.pf_gap > 0 ? '+' : ''}${skill.pf_gap.toFixed(2)}
Priority: ${skill.wr_gap < 0 ? 'IMPROVE WR' : 'MAINTAIN'}`;
  }

  prompt += `

Decision:
1. buy/sell/no_trade
2. SL/TP based on structure
3. Size: use conf + recent perf
4. Reject if low quality

Max hold: 4h. Min R:R: 1.5:1.

JSON:
{"act":"buy/sell/no_trade","sl":price,"tp":price,"size":pct,"conf":0-100,"why":"..."}`;

  return prompt;
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
