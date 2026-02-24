import type {
  MarketBriefing,
  MarketIntelligence,
  MarketSnapshotInput,
  TrendIntelligence,
  ScalpIntelligence,
  ConfirmationIntelligence,
  ReversalIntelligence,
  VolatilityIntelligence,
  OrderFlowIntelligence,
} from '../types/market-briefing';
import type { OmegaVote } from '../types/omega-vote';

interface Omega8Vote extends OmegaVote {
  liquidity_bias: string;
}

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

function extractOrderFlow(input: MarketSnapshotInput, omega8Vote: Omega8Vote | null): OrderFlowIntelligence {
  if (!omega8Vote) {
    return { bias: 'neutral', liquidityBias: 'unknown', confidence: 0 };
  }

  const bias = omega8Vote.vote === 'BUY' ? 'buy' : omega8Vote.vote === 'SELL' ? 'sell' : 'neutral';
  return {
    bias,
    liquidityBias: omega8Vote.liquidity_bias || 'unknown',
    confidence: omega8Vote.confidence,
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

  lines.push(`SYMBOL: ${intel.symbol}`);
  lines.push(`PRICE: ${formatPrice(intel.price)}`);
  lines.push(`ATR: ${formatPrice(intel.atr)} (${intel.atrPercent.toFixed(3)}%) | vs 20-period avg: ${atrAvgRatio.toFixed(2)}x`);
  if (intel.spreadPips !== undefined) {
    const spreadWarning = intel.spreadPips > intel.atr * 0.15 ? ' [HIGH - CAUTION]' : '';
    lines.push(`SPREAD: ${intel.spreadPips.toFixed(1)} pips${spreadWarning}`);
  }
  lines.push('');

  if (intel.sessionName || intel.sessionMinutesRemaining !== undefined) {
    lines.push('SESSION CONTEXT:');
    if (intel.sessionName) {
      lines.push(`  Active Session: ${intel.sessionName}`);
    }
    if (intel.sessionMinutesRemaining !== undefined) {
      const urgency = intel.sessionMinutesRemaining < 30 ? ' [CLOSING SOON]' : intel.sessionMinutesRemaining < 60 ? ' [LATE SESSION]' : '';
      lines.push(`  Minutes Remaining: ${intel.sessionMinutesRemaining}${urgency}`);
    }
    lines.push('');
  }

  lines.push('TREND STRUCTURE:');
  lines.push(`  EMA Alignment: ${intel.trend.emaAlignment.toUpperCase()} (20>${intel.rawIndicators.ema20 > intel.rawIndicators.ema50 ? '' : '!'}50>${intel.rawIndicators.ema50 > intel.rawIndicators.ema200 ? '' : '!'}200)`);
  lines.push(`  EMA20: ${formatPrice(intel.rawIndicators.ema20)} | EMA50: ${formatPrice(intel.rawIndicators.ema50)} | EMA200: ${formatPrice(intel.rawIndicators.ema200)}`);
  lines.push(`  Momentum: ${intel.trend.momentum.toUpperCase()} (raw: ${intel.rawIndicators.momentum.toFixed(2)})`);
  lines.push(`  Break of Structure: ${intel.trend.bos.toUpperCase()}`);
  lines.push(`  Change of Character: ${intel.trend.choch.toUpperCase()}`);
  lines.push(`  ATR Trend: ${intel.trend.atrTrend.toUpperCase()}`);
  lines.push('');

  const vwapDistanceAtr = intel.atr > 0
    ? Math.abs(intel.price - intel.rawIndicators.vwap) / intel.atr
    : 0;

  lines.push('SCALP SIGNALS:');
  lines.push(`  RSI: ${intel.scalp.rsiLevel.toFixed(1)} | Stochastic: ${intel.scalp.stochLevel.toFixed(1)}`);
  lines.push(`  VWAP: ${formatPrice(intel.rawIndicators.vwap)} | Distance: ${intel.scalp.vwapDistance.toFixed(2)}% (${vwapDistanceAtr.toFixed(2)} ATR)`);
  lines.push(`  Micro S/R Position: ${intel.scalp.microSR.toUpperCase()}`);
  lines.push(`  Pullback Depth: ${intel.scalp.pullbackDepth} candles`);
  lines.push('');

  lines.push('CONFIRMATION SIGNALS:');
  lines.push(`  BOS Direction: ${intel.confirmation.bosDirection.toUpperCase()}`);
  lines.push(`  Equal Highs: ${intel.confirmation.equalHighs ? 'YES' : 'NO'} | Equal Lows: ${intel.confirmation.equalLows ? 'YES' : 'NO'}`);
  lines.push(`  Volume Spike: ${intel.confirmation.volumeSpike ? 'YES' : 'NO'}`);
  lines.push('');

  lines.push('REVERSAL SIGNALS:');
  const reversalSignals: string[] = [];
  if (intel.reversal.rsiDivergence !== 'none') reversalSignals.push(`RSI Div: ${intel.reversal.rsiDivergence}`);
  if (intel.reversal.macdDivergence !== 'none') reversalSignals.push(`MACD Div: ${intel.reversal.macdDivergence}`);
  if (intel.reversal.engulfingBull) reversalSignals.push('Engulfing Bull');
  if (intel.reversal.engulfingSell) reversalSignals.push('Engulfing Bear');
  if (intel.reversal.pinBarBull) reversalSignals.push('Pin Bar Bull');
  if (intel.reversal.pinBarSell) reversalSignals.push('Pin Bar Bear');
  if (intel.reversal.doji) reversalSignals.push('Doji');
  lines.push(`  ${reversalSignals.length > 0 ? reversalSignals.join(' | ') : 'None detected'}`);
  lines.push(`  MACD Diff: ${intel.rawIndicators.macd.toFixed(5)} | Signal: ${intel.rawIndicators.macdSignal.toFixed(5)}`);
  lines.push('');

  lines.push('VOLATILITY:');
  lines.push(`  ATR: ${formatPrice(intel.atr)} | vs 20-period avg: ${atrAvgRatio.toFixed(2)}x | Trend: ${intel.volatility.atrTrend.toUpperCase()}`);
  lines.push(`  Vol Regime: ${intel.volatility.regime.toUpperCase()} | Volume Spike: ${intel.volatility.volumeSpike ? 'YES' : 'NO'}`);
  lines.push(`  Wick/Body Ratio (last 5 candles): ${wickRatio.toFixed(2)} (>1.5 = wick-heavy/noisy, <0.5 = clean/directional)`);
  lines.push('');

  lines.push('ORDER FLOW:');
  lines.push(`  Bias: ${intel.orderFlow.bias.toUpperCase()} (${intel.orderFlow.confidence}% confidence)`);
  lines.push(`  Liquidity: ${intel.orderFlow.liquidityBias}`);
  lines.push('');

  lines.push('KEY LEVELS:');
  if (intel.support.length > 0) {
    const supLevels = intel.support.slice(0, 3).map(s => {
      const distAtr = intel.atr > 0 ? Math.abs(intel.price - s) / intel.atr : 0;
      return `${formatPrice(s)} (${distAtr.toFixed(2)} ATR ${intel.price > s ? 'below' : 'above'})`;
    });
    lines.push(`  Support: ${supLevels.join(', ')}`);
  }
  if (intel.resistance.length > 0) {
    const resLevels = intel.resistance.slice(0, 3).map(r => {
      const distAtr = intel.atr > 0 ? Math.abs(intel.price - r) / intel.atr : 0;
      return `${formatPrice(r)} (${distAtr.toFixed(2)} ATR ${intel.price < r ? 'above' : 'below'})`;
    });
    lines.push(`  Resistance: ${resLevels.join(', ')}`);
  }
  lines.push(`  Swing High: ${formatPrice(intel.swingHigh)} | Swing Low: ${formatPrice(intel.swingLow)}`);
  if (intel.previousDayHigh !== undefined && intel.previousDayLow !== undefined) {
    const pdRange = intel.previousDayHigh - intel.previousDayLow;
    const pricePosition = pdRange > 0
      ? ((intel.price - intel.previousDayLow) / pdRange * 100).toFixed(0)
      : '50';
    lines.push(`  Prev Day High: ${formatPrice(intel.previousDayHigh)} | Prev Day Low: ${formatPrice(intel.previousDayLow)}`);
    if (intel.previousDayClose !== undefined) {
      lines.push(`  Prev Day Close: ${formatPrice(intel.previousDayClose)}`);
    }
    lines.push(`  Price Position in PD Range: ${pricePosition}% (0%=at PDL, 100%=at PDH)`);
  }
  lines.push('');

  lines.push('CANDLE PATTERNS:');
  const patterns: string[] = [];
  if (intel.sensors.pat.eng_b) patterns.push('Bullish Engulfing');
  if (intel.sensors.pat.eng_s) patterns.push('Bearish Engulfing');
  if (intel.sensors.pat.pin_b) patterns.push('Bullish Pin Bar');
  if (intel.sensors.pat.pin_s) patterns.push('Bearish Pin Bar');
  if (intel.sensors.pat.doji) patterns.push('Doji');
  if (intel.sensors.pat.mom) patterns.push('Momentum Bar');
  lines.push(`  ${patterns.length > 0 ? patterns.join(', ') : 'None'}`);

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
