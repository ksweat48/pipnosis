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
  };
}

function formatPrice(price: number): string {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 1) return price.toFixed(5);
  return price.toFixed(6);
}

function formatBriefingText(intel: MarketIntelligence): string {
  const lines: string[] = [];

  lines.push(`SYMBOL: ${intel.symbol}`);
  lines.push(`PRICE: ${formatPrice(intel.price)}`);
  lines.push(`ATR: ${formatPrice(intel.atr)} (${intel.atrPercent.toFixed(3)}%)`);
  lines.push('');

  lines.push('TREND STRUCTURE:');
  lines.push(`  EMA Alignment: ${intel.trend.emaAlignment.toUpperCase()} (20>${intel.rawIndicators.ema20 > intel.rawIndicators.ema50 ? '' : '!'}50>${intel.rawIndicators.ema50 > intel.rawIndicators.ema200 ? '' : '!'}200)`);
  lines.push(`  EMA20: ${formatPrice(intel.rawIndicators.ema20)} | EMA50: ${formatPrice(intel.rawIndicators.ema50)} | EMA200: ${formatPrice(intel.rawIndicators.ema200)}`);
  lines.push(`  Momentum: ${intel.trend.momentum.toUpperCase()} (raw: ${intel.rawIndicators.momentum.toFixed(2)})`);
  lines.push(`  Break of Structure: ${intel.trend.bos.toUpperCase()}`);
  lines.push(`  Change of Character: ${intel.trend.choch.toUpperCase()}`);
  lines.push(`  ATR Trend: ${intel.trend.atrTrend.toUpperCase()}`);
  lines.push('');

  lines.push('SCALP SIGNALS:');
  lines.push(`  RSI: ${intel.scalp.rsiLevel.toFixed(1)} | Stochastic: ${intel.scalp.stochLevel.toFixed(1)}`);
  lines.push(`  VWAP Distance: ${intel.scalp.vwapDistance.toFixed(2)}% | VWAP: ${formatPrice(intel.rawIndicators.vwap)}`);
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
  lines.push(`  Regime: ${intel.volatility.regime.toUpperCase()} | ATR Trend: ${intel.volatility.atrTrend.toUpperCase()}`);
  lines.push(`  Volume Spike: ${intel.volatility.volumeSpike ? 'YES' : 'NO'}`);
  lines.push('');

  lines.push('ORDER FLOW:');
  lines.push(`  Bias: ${intel.orderFlow.bias.toUpperCase()} (${intel.orderFlow.confidence}% confidence)`);
  lines.push(`  Liquidity: ${intel.orderFlow.liquidityBias}`);
  lines.push('');

  lines.push('KEY LEVELS:');
  if (intel.support.length > 0) {
    lines.push(`  Support: ${intel.support.slice(0, 3).map(formatPrice).join(', ')}`);
  }
  if (intel.resistance.length > 0) {
    lines.push(`  Resistance: ${intel.resistance.slice(0, 3).map(formatPrice).join(', ')}`);
  }
  lines.push(`  Swing High: ${formatPrice(intel.swingHigh)} | Swing Low: ${formatPrice(intel.swingLow)}`);
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
  const briefingText = formatBriefingText(intelligence);

  return {
    intelligence,
    briefingText,
    timestamp: Date.now(),
  };
}
