import type {
  MarketBriefing,
  MarketIntelligence,
  MarketSnapshotInput,
  TrendIntelligence,
  ScalpIntelligence,
  ConfirmationIntelligence,
  ReversalIntelligence,
  VolatilityIntelligence,
  Omega8PatternIntelligence,
} from '../types/market-briefing';
import type { Omega8Vote } from '../types/omega';

function extractTrend(input: MarketSnapshotInput): TrendIntelligence {
  const { ema20, ema50, ema200, momentum, sensors } = input;

  let emaAlignment: 'bull' | 'bear' | 'mixed' = 'mixed';
  if (ema20 > ema50 && ema50 > ema200) emaAlignment = 'bull';
  else if (ema20 < ema50 && ema50 < ema200) emaAlignment = 'bear';

  let momentumState: TrendIntelligence['momentum'] = 'neutral';
  if (momentum > 2) momentumState = 'strong_bull';
  else if (momentum > 0.5) momentumState = 'bull';
  else if (momentum < -2) momentumState = 'strong_bear';
  else if (momentum < -0.5) momentumState = 'bear';

  return {
    emaAlignment,
    momentum: momentumState,
    bos: sensors.bos as 'bull' | 'bear' | 'none',
    choch: sensors.cho as 'bull' | 'bear' | 'none',
    atrTrend: sensors.atr_t as 'up' | 'down' | 'flat',
  };
}

function extractScalp(input: MarketSnapshotInput): ScalpIntelligence {
  return {
    vwapDistance: input.sensors.mic.dvw,
    rsiLevel: input.rsi,
    stochLevel: input.stochastic,
    microSR: input.sensors.mic.msr as 'above' | 'below' | 'at',
    pullbackDepth: input.sensors.mic.pull,
  };
}

function extractConfirmation(input: MarketSnapshotInput): ConfirmationIntelligence {
  return {
    bosDirection: input.sensors.bos as 'bull' | 'bear' | 'none',
    equalHighs: input.sensors.eqh === 1,
    equalLows: input.sensors.eql === 1,
    volumeSpike: input.sensors.vol_s === 1,
  };
}

function extractReversal(input: MarketSnapshotInput): ReversalIntelligence {
  return {
    rsiDivergence: input.sensors.rdiv as 'bull' | 'bear' | 'none',
    macdDivergence: input.sensors.mdiv as 'bull' | 'bear' | 'none',
    engulfingBull: input.sensors.pat.eng_b === 1,
    engulfingSell: input.sensors.pat.eng_s === 1,
    pinBarBull: input.sensors.pat.pin_b === 1,
    pinBarSell: input.sensors.pat.pin_s === 1,
    doji: input.sensors.pat.doji === 1,
  };
}

function extractVolatility(input: MarketSnapshotInput): VolatilityIntelligence {
  return {
    regime: input.sensors.vol_r as 'low' | 'mid' | 'high',
    atrTrend: input.sensors.atr_t as 'up' | 'down' | 'flat',
    volumeSpike: input.sensors.vol_s === 1,
  };
}

/**
 * CCIP-2026-03-12: Omega-8 is a PURE PATTERN SENSOR.
 * Extracts raw computed pattern facts — no bias, no confidence, no pre-scored direction.
 * Alpha reasons about these facts independently.
 */
function extractOrderFlow(input: MarketSnapshotInput, omega8Vote: Omega8Vote | null): Omega8PatternIntelligence {
  if (!omega8Vote || !omega8Vote.patterns) {
    return {
      sweptHighs: 0, sweptLows: 0,
      fvgBullish: 0, fvgBearish: 0,
      equalHighs: 0, equalLows: 0,
      volSpikeBullish: false, volSpikeBearish: false,
      absorptionBullish: false, absorptionBearish: false,
      accumulationZone: false, distributionZone: false,
      confluenceScore: 0,
      liquidityBias: 'unknown',
      signals: [],
    };
  }

  const p = omega8Vote.patterns;
  const sd = omega8Vote.sweep_details;

  return {
    sweptHighs: p.sweptHighs,
    sweptLows: p.sweptLows,
    fvgBullish: p.fvgBullish,
    fvgBearish: p.fvgBearish,
    equalHighs: p.equalHighs,
    equalLows: p.equalLows,
    volSpikeBullish: p.volSpikeBullish,
    volSpikeBearish: p.volSpikeBearish,
    absorptionBullish: p.absorptionBullish,
    absorptionBearish: p.absorptionBearish,
    accumulationZone: p.accumulationZone,
    distributionZone: p.distributionZone,
    confluenceScore: p.confluenceScore,
    liquidityBias: omega8Vote.liquidity_bias || 'unknown',
    sweepType: sd?.type,
    sweepCandlesAgo: sd?.candles_ago,
    sweepHasBOS: sd?.has_bos,
    sweepExtremePrice: sd?.sweep_extreme_price,
    nearestClusterPrice: sd?.nearest_cluster_price,
    signals: omega8Vote.signals || [],
  };
}

function buildIntelligence(input: MarketSnapshotInput, omega8Vote: Omega8Vote | null): MarketIntelligence {
  const atrPercent = input.price > 0 ? (input.atr / input.price) * 100 : 0;

  return {
    symbol: input.symbol,
    price: input.price,
    atr: input.atr,
    atrPercent,
    trend: extractTrend(input),
    scalp: extractScalp(input),
    confirmation: extractConfirmation(input),
    reversal: extractReversal(input),
    volatility: extractVolatility(input),
    orderFlow: extractOrderFlow(input, omega8Vote),
    sensors: input.sensors,
    rawIndicators: {
      ema20: input.ema20,
      ema50: input.ema50,
      ema200: input.ema200,
      rsi: input.rsi,
      momentum: input.momentum,
      stochastic: input.stochastic,
      macd: input.macd,
      macdSignal: input.macdSignal,
      vwap: input.vwap,
    },
    support: input.support,
    resistance: input.resistance,
    swingHigh: input.swingHigh,
    swingLow: input.swingLow,
    regime: input.regime || 'unknown',
    volatilityState: input.volatility,
    session: input.session || 'unknown',
    spreadPips: input.spreadPips,
    sessionName: input.sessionName,
    sessionMinutesRemaining: input.sessionMinutesRemaining,
    nextSessionName: input.nextSessionName,
    minutesUntilNextSession: input.minutesUntilNextSession,
    marketPhase: input.marketPhase,
    marketPhaseConfidence: input.marketPhaseConfidence,
    previousDayHigh: input.previousDayHigh,
    previousDayLow: input.previousDayLow,
    previousDayClose: input.previousDayClose,
  };
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(5);
  return price.toFixed(6);
}

function computeWickRatio(candles: Array<{ open: number; high: number; low: number; close: number }>): number {
  if (candles.length === 0) return 0;
  let totalWick = 0;
  let totalBody = 0;
  for (const c of candles) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const wick = range - body;
    totalWick += wick;
    totalBody += body;
  }
  return totalBody > 0 ? totalWick / totalBody : 0;
}

function computeAtrAvgRatio(atr: number, candles: Array<{ high: number; low: number }>): number {
  if (candles.length < 14) return 1;
  const ranges = candles.slice(-20).map(c => c.high - c.low);
  const avg = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  return avg > 0 ? atr / avg : 1;
}

function formatBriefingText(intel: MarketIntelligence, snapshot?: { candles: Array<{ open: number; high: number; low: number; close: number }> }): string {
  const lines: string[] = [];

  const atrAvgRatio = snapshot ? computeAtrAvgRatio(intel.atr, snapshot.candles) : 1;
  const wickRatio = snapshot ? computeWickRatio(snapshot.candles.slice(-5)) : 0;

  const spreadStr = intel.spreadPips !== undefined
    ? ` | SPREAD:${intel.spreadPips.toFixed(1)}p`
    : '';
  lines.push(`${intel.symbol} | PRICE:${formatPrice(intel.price)} | ATR:${formatPrice(intel.atr)}(${intel.atrPercent.toFixed(2)}%,${atrAvgRatio.toFixed(2)}x avg)${spreadStr}`);

  if (intel.sessionName || intel.marketPhase) {
    const sessionRem = intel.sessionMinutesRemaining !== undefined
      ? ` ${intel.sessionMinutesRemaining}min`
      : '';
    const nextSess = intel.nextSessionName && intel.minutesUntilNextSession && intel.minutesUntilNextSession > 0
      ? ` next:${intel.nextSessionName} in ${intel.minutesUntilNextSession}min`
      : '';
    // CCIP-2026-0513M-SEALED-COORDINATOR: marketPhase English label removed.
    // Phase classification is verdict-shaped; raw indicators above already convey state.
    void intel.marketPhase;
    void intel.marketPhaseConfidence;
    lines.push(`SESSION:${intel.sessionName ?? ''}${sessionRem}${nextSess}`);
  }

  // CCIP-2026-0513J SEALED-PROMPT DOCTRINE:
  // Emit raw numerics and symmetric +1/0/-1 codes only. No BULL/BEAR/STRONG_BEAR/MIXED
  // verdict labels. Alpha reasons over raw readings.
  const e20 = formatPrice(intel.rawIndicators.ema20);
  const e50 = formatPrice(intel.rawIndicators.ema50);
  const e200 = formatPrice(intel.rawIndicators.ema200);
  const emaSpread20_50 = intel.rawIndicators.ema20 - intel.rawIndicators.ema50;
  const emaSpread50_200 = intel.rawIndicators.ema50 - intel.rawIndicators.ema200;
  const bosCode = intel.trend.bos === 'bull' ? 1 : intel.trend.bos === 'bear' ? -1 : 0;
  const chochCode = intel.trend.choch === 'bull' ? 1 : intel.trend.choch === 'bear' ? -1 : 0;
  const atrTrendCode = intel.trend.atrTrend === 'up' ? 1 : intel.trend.atrTrend === 'down' ? -1 : 0;
  lines.push(`TREND_RAW: e20:${e20} e50:${e50} e200:${e200} spread20_50:${emaSpread20_50.toFixed(5)} spread50_200:${emaSpread50_200.toFixed(5)} | mom_raw:${intel.rawIndicators.momentum.toFixed(2)} | bos:${bosCode} choch:${chochCode} atr_trend:${atrTrendCode}`);

  const vwapDistAtr = intel.atr > 0 ? (Math.abs(intel.price - intel.rawIndicators.vwap) / intel.atr).toFixed(2) : '0';
  const microSRCode = intel.scalp.microSR === 'above' ? 1 : intel.scalp.microSR === 'below' ? -1 : 0;
  lines.push(`INDICATORS_RAW: rsi:${intel.scalp.rsiLevel.toFixed(1)} stoch:${intel.scalp.stochLevel.toFixed(1)} | vwap:${formatPrice(intel.rawIndicators.vwap)} vwap_dist_pct:${intel.scalp.vwapDistance.toFixed(2)} vwap_dist_atr:${vwapDistAtr} micro_sr:${microSRCode} pb_depth:${intel.scalp.pullbackDepth} | macd:${intel.rawIndicators.macd.toFixed(5)} macd_sig:${intel.rawIndicators.macdSignal.toFixed(5)}`);

  const rsiDivCode = intel.reversal.rsiDivergence === 'bull' ? 1 : intel.reversal.rsiDivergence === 'bear' ? -1 : 0;
  const macdDivCode = intel.reversal.macdDivergence === 'bull' ? 1 : intel.reversal.macdDivergence === 'bear' ? -1 : 0;
  const volRegimeCode = intel.volatility.regime === 'high' ? 2 : intel.volatility.regime === 'mid' ? 1 : 0;
  lines.push(`SIGNALS_RAW: bos:${bosCode} eqh:${intel.confirmation.equalHighs ? 1 : 0} eql:${intel.confirmation.equalLows ? 1 : 0} vol_spk:${intel.confirmation.volumeSpike ? 1 : 0} | vol_regime:${volRegimeCode} atr_avg_ratio:${atrAvgRatio.toFixed(2)} wick_body:${wickRatio.toFixed(2)} | rsi_div:${rsiDivCode} macd_div:${macdDivCode} eng_b:${intel.reversal.engulfingBull ? 1 : 0} eng_s:${intel.reversal.engulfingSell ? 1 : 0} pin_b:${intel.reversal.pinBarBull ? 1 : 0} pin_s:${intel.reversal.pinBarSell ? 1 : 0} doji:${intel.reversal.doji ? 1 : 0} mom_bar:${intel.sensors.pat.mom ? 1 : 0}`);

  // CCIP-2026-0513M-SEALED-COORDINATOR: symmetric ±1/0/-1 sweep_type code in briefing.
  const sweepTypeCode = intel.orderFlow.sweepType === 'high' ? 1 : intel.orderFlow.sweepType === 'low' ? -1 : 0;
  const sweepStr = sweepTypeCode !== 0
    ? ` | sweep_type_code:${sweepTypeCode} sweep_candles_ago:${intel.orderFlow.sweepCandlesAgo ?? -1} sweep_has_bos:${intel.orderFlow.sweepHasBOS ? 1 : 0}${intel.orderFlow.sweepExtremePrice ? ` sweep_ext:${intel.orderFlow.sweepExtremePrice.toFixed(5)}` : ''}${intel.orderFlow.nearestClusterPrice ? ` cluster:${intel.orderFlow.nearestClusterPrice.toFixed(5)}` : ''}`
    : '';
  // CCIP-2026-0513M-SEALED-COORDINATOR: bound signals[] alphabet to snake_case pattern names only.
  const SIGNAL_ALPHABET = /^[a-z0-9_]+$/;
  const filteredSignals = intel.orderFlow.signals.filter(s => SIGNAL_ALPHABET.test(s));
  const ofSignals = filteredSignals.length > 0 ? ` sigs:[${filteredSignals.join(',')}]` : '';
  const liqBiasCode = intel.orderFlow.liquidityBias === 'bull' ? 1 : intel.orderFlow.liquidityBias === 'bear' ? -1 : 0;
  lines.push(`ORDERFLOW_RAW: sw_h:${intel.orderFlow.sweptHighs} sw_l:${intel.orderFlow.sweptLows} fvg_up:${intel.orderFlow.fvgBullish} fvg_dn:${intel.orderFlow.fvgBearish} eqh:${intel.orderFlow.equalHighs} eql:${intel.orderFlow.equalLows} | vol_spk_up:${intel.orderFlow.volSpikeBullish ? 1 : 0} vol_spk_dn:${intel.orderFlow.volSpikeBearish ? 1 : 0} abs_up:${intel.orderFlow.absorptionBullish ? 1 : 0} abs_dn:${intel.orderFlow.absorptionBearish ? 1 : 0} acc:${intel.orderFlow.accumulationZone ? 1 : 0} dist:${intel.orderFlow.distributionZone ? 1 : 0} | confluence:${intel.orderFlow.confluenceScore} liq_bias:${liqBiasCode}${sweepStr}${ofSignals}`);

  const supLevels = intel.support.slice(0, 3).map(s => {
    const d = intel.atr > 0 ? (Math.abs(intel.price - s) / intel.atr).toFixed(2) : '?';
    return `${formatPrice(s)}(${d}ATR)`;
  });
  const resLevels = intel.resistance.slice(0, 3).map(r => {
    const d = intel.atr > 0 ? (Math.abs(intel.price - r) / intel.atr).toFixed(2) : '?';
    return `${formatPrice(r)}(${d}ATR)`;
  });
  let keyLevels = `LEVELS: Sup:${supLevels.join(' ') || 'none'} Res:${resLevels.join(' ') || 'none'} | SwHigh:${formatPrice(intel.swingHigh)} SwLow:${formatPrice(intel.swingLow)}`;
  if (intel.previousDayHigh !== undefined && intel.previousDayLow !== undefined) {
    const pdRange = intel.previousDayHigh - intel.previousDayLow;
    const pricePos = pdRange > 0 ? ((intel.price - intel.previousDayLow) / pdRange * 100).toFixed(0) : '50';
    const pdClose = intel.previousDayClose !== undefined ? ` PDC:${formatPrice(intel.previousDayClose)}` : '';
    keyLevels += ` | PDH:${formatPrice(intel.previousDayHigh)} PDL:${formatPrice(intel.previousDayLow)}${pdClose} pos:${pricePos}%`;
  }
  lines.push(keyLevels);

  return lines.join('\n');
}

export function buildMarketBriefing(
  snapshot: MarketSnapshotInput,
  omega8Vote: Omega8Vote | null
): MarketBriefing {
  const intelligence = buildIntelligence(snapshot, omega8Vote);
  const briefingText = formatBriefingText(intelligence, snapshot);

  return {
    intelligence,
    briefingText,
    timestamp: Date.now(),
  };
}
