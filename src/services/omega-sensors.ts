/**
 * Omega Sensor Package
 *
 * Pro-trader indicators computed locally at ZERO cost.
 * Provides Alpha Coordinator and Omega Specialists with institutional-grade market signals.
 *
 * Categories:
 * - Market Structure (BOS, CHoCH, swing points, equal highs/lows)
 * - Volume & Volatility (spikes, trends, regimes)
 * - Momentum & Divergence (RSI/MACD divergences)
 * - Candle Patterns (engulfing, pin bars, doji, momentum)
 * - Micro-Structure (pullbacks, VWAP distance, micro S/R)
 */

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  open_time?: string | Date;
}

export interface OmegaSensors {
  // Market Structure
  sh: number;           // swing_high (1/0)
  sl: number;           // swing_low (1/0)
  bos: string;          // break_of_structure: "bull" | "bear" | "none"
  cho: string;          // change_of_character: "bull" | "bear" | "none"
  eqh: number;          // equal_highs (1/0)
  eql: number;          // equal_lows (1/0)

  // Volume & Volatility
  vol: number;          // current volume
  vol_s: number;        // volume_spike (1/0)
  atr_t: string;        // atr_trend: "up" | "down" | "flat"
  vol_r: string;        // vol_regime: "low" | "mid" | "high"

  // Momentum & Divergence
  rdiv: string;         // rsi_divergence: "bull" | "bear" | "none"
  mdif: number;         // macd_diff (MACD - signal)
  mdiv: string;         // macd_divergence: "bull" | "bear" | "none"

  // Candle Patterns
  pat: {
    eng_b: number;      // engulfing_bullish (1/0)
    eng_s: number;      // engulfing_bearish (1/0)
    pin_b: number;      // pin_bar_bullish (1/0)
    pin_s: number;      // pin_bar_bearish (1/0)
    doji: number;       // doji (1/0)
    mom: number;        // momentum_bar (1/0)
  };

  // Micro-Structure
  mic: {
    pull: number;       // pullback_depth (candles)
    dvw: number;        // distance_from_vwap (%)
    msr: string;        // micro_sr: "above" | "below" | "at"
  };
}

/**
 * Compute all Omega Sensors from candle array
 */
export function computeOmegaSensors(
  candles: Candle[],
  rsi: number,
  macd: number,
  macdSignal: number,
  atr: number,
  vwap: number
): OmegaSensors {
  if (candles.length < 20) {
    return getDefaultSensors();
  }

  const structure = computeStructure(candles);
  const volume = computeVolume(candles);
  const momentum = computeMomentum(candles, rsi, macd, macdSignal);
  const patterns = computePatterns(candles);
  const micro = computeMicro(candles, vwap, atr);

  return {
    ...structure,
    ...volume,
    ...momentum,
    pat: patterns,
    mic: micro
  };
}

/**
 * A. Market Structure
 */
function computeStructure(candles: Candle[]): {
  sh: number;
  sl: number;
  bos: string;
  cho: string;
  eqh: number;
  eql: number;
} {
  const recent = candles.slice(-20);
  const current = candles[candles.length - 1];

  // Swing high: Current high > previous 2 highs AND next 2 highs (if available)
  const isSwingHigh = detectSwingPoint(candles, 'high');
  const isSwingLow = detectSwingPoint(candles, 'low');

  // Break of Structure: Price breaks previous swing high (bull) or low (bear)
  const bos = detectBOS(candles);

  // Change of Character: Market structure shift
  const cho = detectCHoCH(candles);

  // Equal highs/lows: Multiple touches at same level
  const eqh = detectEqualLevels(recent, 'high');
  const eql = detectEqualLevels(recent, 'low');

  return {
    sh: isSwingHigh ? 1 : 0,
    sl: isSwingLow ? 1 : 0,
    bos,
    cho,
    eqh: eqh ? 1 : 0,
    eql: eql ? 1 : 0
  };
}

/**
 * Detect swing high/low
 */
function detectSwingPoint(candles: Candle[], type: 'high' | 'low'): boolean {
  if (candles.length < 5) return false;

  const idx = candles.length - 3; // Check 3rd candle from end
  if (idx < 2) return false;

  const current = candles[idx][type];
  const left1 = candles[idx - 1][type];
  const left2 = candles[idx - 2][type];
  const right1 = candles[idx + 1][type];
  const right2 = candles[idx + 2][type];

  if (type === 'high') {
    return current > left1 && current > left2 && current > right1 && current > right2;
  } else {
    return current < left1 && current < left2 && current < right1 && current < right2;
  }
}

/**
 * Detect Break of Structure
 */
function detectBOS(candles: Candle[]): string {
  if (candles.length < 15) return 'none';

  const recent = candles.slice(-15);
  const current = candles[candles.length - 1];

  // Find recent swing high and low
  const swingHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
  const swingLow = Math.min(...recent.slice(0, -1).map(c => c.low));

  // Bullish BOS: Close above recent swing high
  if (current.close > swingHigh) {
    return 'bull';
  }

  // Bearish BOS: Close below recent swing low
  if (current.close < swingLow) {
    return 'bear';
  }

  return 'none';
}

/**
 * Detect Change of Character (trend reversal signal)
 */
function detectCHoCH(candles: Candle[]): string {
  if (candles.length < 20) return 'none';

  const recent = candles.slice(-20);

  // Look for higher highs turning into lower highs (bearish CHoCH)
  const firstHalf = recent.slice(0, 10);
  const secondHalf = recent.slice(10);

  const firstHigh = Math.max(...firstHalf.map(c => c.high));
  const secondHigh = Math.max(...secondHalf.map(c => c.high));

  const firstLow = Math.min(...firstHalf.map(c => c.low));
  const secondLow = Math.min(...secondHalf.map(c => c.low));

  // Bearish CHoCH: Higher highs stop, lower lows form
  if (secondHigh < firstHigh && secondLow < firstLow) {
    return 'bear';
  }

  // Bullish CHoCH: Lower lows stop, higher highs form
  if (secondHigh > firstHigh && secondLow > firstLow) {
    return 'bull';
  }

  return 'none';
}

/**
 * Detect equal highs or lows (liquidity zones)
 */
function detectEqualLevels(candles: Candle[], type: 'high' | 'low'): boolean {
  if (candles.length < 10) return false;

  const levels = candles.map(c => c[type]);
  const tolerance = 0.0003; // 0.03% tolerance

  // Check for at least 2 touches at similar level
  for (let i = 0; i < levels.length - 1; i++) {
    for (let j = i + 1; j < levels.length; j++) {
      const diff = Math.abs(levels[i] - levels[j]) / levels[i];
      if (diff < tolerance) {
        return true;
      }
    }
  }

  return false;
}

/**
 * B. Volume & Volatility
 */
function computeVolume(candles: Candle[]): {
  vol: number;
  vol_s: number;
  atr_t: string;
  vol_r: string;
} {
  const recent = candles.slice(-20);
  const current = candles[candles.length - 1];

  // Current volume (or synthetic)
  const vol = current.volume || calculateSyntheticVolume(current);

  // Average volume
  const avgVol = recent.reduce((sum, c) => sum + (c.volume || calculateSyntheticVolume(c)), 0) / recent.length;

  // Volume spike: >1.5x average
  const vol_s = vol > avgVol * 1.5 ? 1 : 0;

  // ATR trend (computed from ranges)
  const atr_t = detectATRTrend(recent);

  // Volume regime classification
  const vol_r = classifyVolumeRegime(vol, avgVol);

  return { vol, vol_s, atr_t, vol_r };
}

/**
 * Calculate synthetic volume from price action
 */
function calculateSyntheticVolume(candle: Candle): number {
  const range = candle.high - candle.low;
  const bodySize = Math.abs(candle.close - candle.open);
  return Math.round(range * 1000 + bodySize * 500);
}

/**
 * Detect ATR trend
 */
function detectATRTrend(candles: Candle[]): string {
  if (candles.length < 10) return 'flat';

  const ranges = candles.map(c => c.high - c.low);
  const firstHalfAvg = ranges.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const secondHalfAvg = ranges.slice(-5).reduce((a, b) => a + b, 0) / 5;

  const change = (secondHalfAvg - firstHalfAvg) / firstHalfAvg;

  if (change > 0.15) return 'up';      // Volatility expanding
  if (change < -0.15) return 'down';   // Volatility contracting
  return 'flat';
}

/**
 * Classify volume regime
 */
function classifyVolumeRegime(currentVol: number, avgVol: number): string {
  const ratio = currentVol / avgVol;

  if (ratio > 1.3) return 'high';
  if (ratio < 0.7) return 'low';
  return 'mid';
}

/**
 * C. Momentum & Divergence
 */
function computeMomentum(
  candles: Candle[],
  rsi: number,
  macd: number,
  macdSignal: number
): {
  rdiv: string;
  mdif: number;
  mdiv: string;
} {
  const rdiv = detectRSIDivergence(candles, rsi);
  const mdif = parseFloat((macd - macdSignal).toFixed(4));
  const mdiv = detectMACDDivergence(candles, macd);

  return { rdiv, mdif, mdiv };
}

/**
 * Detect RSI divergence
 */
function detectRSIDivergence(candles: Candle[], currentRSI: number): string {
  if (candles.length < 15) return 'none';

  const recent = candles.slice(-15);
  const currentPrice = candles[candles.length - 1].close;
  const previousPrice = recent[0].close;

  // Simplified divergence detection
  // Bullish: Price makes lower low, RSI makes higher low
  if (currentPrice < previousPrice && currentRSI > 30 && currentRSI < 50) {
    // Assume RSI is not making lower low (simplified)
    const priceChange = (currentPrice - previousPrice) / previousPrice;
    if (priceChange < -0.02) { // 2% drop
      return 'bull';
    }
  }

  // Bearish: Price makes higher high, RSI makes lower high
  if (currentPrice > previousPrice && currentRSI > 50 && currentRSI < 80) {
    const priceChange = (currentPrice - previousPrice) / previousPrice;
    if (priceChange > 0.02) { // 2% gain
      return 'bear';
    }
  }

  return 'none';
}

/**
 * Detect MACD divergence
 */
function detectMACDDivergence(candles: Candle[], currentMACD: number): string {
  if (candles.length < 15) return 'none';

  const recent = candles.slice(-15);
  const currentPrice = candles[candles.length - 1].close;
  const previousPrice = recent[0].close;

  // Simplified MACD divergence
  // Bullish: Price lower, MACD higher
  const priceChange = currentPrice - previousPrice;

  if (priceChange < 0 && currentMACD > 0) {
    return 'bull';
  }

  if (priceChange > 0 && currentMACD < 0) {
    return 'bear';
  }

  return 'none';
}

/**
 * D. Candle Patterns
 */
function computePatterns(candles: Candle[]): {
  eng_b: number;
  eng_s: number;
  pin_b: number;
  pin_s: number;
  doji: number;
  mom: number;
} {
  if (candles.length < 2) {
    return { eng_b: 0, eng_s: 0, pin_b: 0, pin_s: 0, doji: 0, mom: 0 };
  }

  const current = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  return {
    eng_b: isBullishEngulfing(previous, current) ? 1 : 0,
    eng_s: isBearishEngulfing(previous, current) ? 1 : 0,
    pin_b: isBullishPinBar(current) ? 1 : 0,
    pin_s: isBearishPinBar(current) ? 1 : 0,
    doji: isDoji(current) ? 1 : 0,
    mom: isMomentumBar(current) ? 1 : 0
  };
}

/**
 * Bullish engulfing pattern
 */
function isBullishEngulfing(prev: Candle, curr: Candle): boolean {
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  const engulfs = curr.open <= prev.close && curr.close >= prev.open;

  return prevBearish && currBullish && engulfs;
}

/**
 * Bearish engulfing pattern
 */
function isBearishEngulfing(prev: Candle, curr: Candle): boolean {
  const prevBullish = prev.close > prev.open;
  const currBearish = curr.close < curr.open;
  const engulfs = curr.open >= prev.close && curr.close <= prev.open;

  return prevBullish && currBearish && engulfs;
}

/**
 * Bullish pin bar (hammer)
 */
function isBullishPinBar(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const range = candle.high - candle.low;

  // Lower wick > 2x body, upper wick < body, bullish close
  return lowerWick > body * 2 && upperWick < body && candle.close > candle.open && range > 0;
}

/**
 * Bearish pin bar (shooting star)
 */
function isBearishPinBar(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const range = candle.high - candle.low;

  // Upper wick > 2x body, lower wick < body, bearish close
  return upperWick > body * 2 && lowerWick < body && candle.close < candle.open && range > 0;
}

/**
 * Doji pattern
 */
function isDoji(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;

  // Body < 10% of range
  return range > 0 && body / range < 0.1;
}

/**
 * Momentum bar (strong directional candle)
 */
function isMomentumBar(candle: Candle): boolean {
  const body = Math.abs(candle.close - candle.open);
  const range = candle.high - candle.low;

  // Body > 70% of range, large range
  return range > 0 && body / range > 0.7;
}

/**
 * E. Micro-Structure
 */
function computeMicro(candles: Candle[], vwap: number, atr: number): {
  pull: number;
  dvw: number;
  msr: string;
} {
  const pull = detectPullbackDepth(candles);
  const dvw = calculateVWAPDistance(candles[candles.length - 1], vwap);
  const msr = detectMicroSR(candles, atr);

  return { pull, dvw, msr };
}

/**
 * Detect pullback depth (number of consecutive candles in pullback)
 */
function detectPullbackDepth(candles: Candle[]): number {
  if (candles.length < 10) return 0;

  const recent = candles.slice(-10);
  const trend = detectShortTermTrend(recent);

  let pullbackCount = 0;

  // Count consecutive candles against trend
  for (let i = recent.length - 1; i >= 0; i--) {
    const candle = recent[i];
    const isPullback = trend === 'bull'
      ? candle.close < candle.open
      : candle.close > candle.open;

    if (isPullback) {
      pullbackCount++;
    } else {
      break;
    }
  }

  return pullbackCount;
}

/**
 * Detect short-term trend
 */
function detectShortTermTrend(candles: Candle[]): 'bull' | 'bear' {
  const firstPrice = candles[0].close;
  const lastPrice = candles[candles.length - 1].close;

  return lastPrice > firstPrice ? 'bull' : 'bear';
}

/**
 * Calculate distance from VWAP as percentage
 */
function calculateVWAPDistance(candle: Candle, vwap: number): number {
  const distance = (candle.close - vwap) / vwap;
  return parseFloat((distance * 100).toFixed(2)); // Return as percentage
}

/**
 * Detect micro support/resistance
 */
function detectMicroSR(candles: Candle[], atr: number): string {
  if (candles.length < 10) return 'at';

  const recent = candles.slice(-10);
  const current = candles[candles.length - 1];

  // Find recent high/low
  const recentHigh = Math.max(...recent.map(c => c.high));
  const recentLow = Math.min(...recent.map(c => c.low));

  const threshold = atr * 0.3; // 30% of ATR

  // Near resistance
  if (Math.abs(current.close - recentHigh) < threshold) {
    return 'at';
  }

  // Near support
  if (Math.abs(current.close - recentLow) < threshold) {
    return 'at';
  }

  // Above resistance
  if (current.close > recentHigh) {
    return 'above';
  }

  // Below support
  if (current.close < recentLow) {
    return 'below';
  }

  return 'at';
}

/**
 * Get default sensors when insufficient data
 */
function getDefaultSensors(): OmegaSensors {
  return {
    sh: 0,
    sl: 0,
    bos: 'none',
    cho: 'none',
    eqh: 0,
    eql: 0,
    vol: 0,
    vol_s: 0,
    atr_t: 'flat',
    vol_r: 'mid',
    rdiv: 'none',
    mdif: 0,
    mdiv: 'none',
    pat: {
      eng_b: 0,
      eng_s: 0,
      pin_b: 0,
      pin_s: 0,
      doji: 0,
      mom: 0
    },
    mic: {
      pull: 0,
      dvw: 0,
      msr: 'at'
    }
  };
}

/**
 * Format sensors for compressed snapshot
 */
export function formatSensorsCompressed(sensors: OmegaSensors): any {
  return {
    sh: sensors.sh,
    sl: sensors.sl,
    bos: sensors.bos,
    cho: sensors.cho,
    eqh: sensors.eqh,
    eql: sensors.eql,
    vol: sensors.vol,
    vol_s: sensors.vol_s,
    atr_t: sensors.atr_t,
    vol_r: sensors.vol_r,
    rdiv: sensors.rdiv,
    mdif: sensors.mdif,
    mdiv: sensors.mdiv,
    pat: sensors.pat,
    mic: sensors.mic
  };
}

/**
 * Format sensors for dev logging
 */
export function formatSensorsForLogging(sensors: OmegaSensors, trend: string): string {
  const parts = [
    `tr=${trend}`,
    `sh=${sensors.sh} sl=${sensors.sl}`,
    `bos=${sensors.bos} cho=${sensors.cho}`,
    `vol_s=${sensors.vol_s}`,
    `rdiv=${sensors.rdiv}`,
    `mdiv=${sensors.mdiv}`,
    `pat:eng_b=${sensors.pat.eng_b} pin_s=${sensors.pat.pin_s} mom=${sensors.pat.mom}`
  ];

  return `[OmegaSensor] ${parts.join(' | ')}`;
}
