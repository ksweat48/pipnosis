/**
 * Market Structure Event Detector
 *
 * SSOT: Sole authority for detecting institutional market structure events
 * from candle data. Pure math — zero LLM calls, zero side effects.
 *
 * CCIP ID: 20260220_rti_professional_intelligence_fields
 *
 * Events detected:
 *   BOS            - Break of Structure: close beyond prior swing high/low
 *   ChoCh          - Change of Character: first opposing swing break
 *   FVG            - Fair Value Gap: 3-candle imbalance
 *   OrderBlock     - Last opposing candle before impulse on retest
 *   LiquiditySweep - Wick beyond key level then close back inside
 *   AsiaRangeSweep - London sweeps the locked Asia high or low
 *   AsiaRangeBuilding - Asia session range actively forming
 *
 * Governance:
 *   - No DB writes — caller persists results
 *   - No business rules — pure detection
 *   - No LLM calls
 */

export type StructureEventType =
  | 'BOS'
  | 'ChoCh'
  | 'FVG'
  | 'OrderBlock'
  | 'LiquiditySweep'
  | 'AsiaRangeSweep'
  | 'AsiaRangeBuilding';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface SwingPoint {
  price: number;
  timestamp: number;
  index: number;
  type: 'high' | 'low';
}

export interface StructureEvent {
  eventType: StructureEventType;
  direction: 'buy' | 'sell' | 'neutral';
  eventPrice: number;
  keyLevel: number;
  confidence: number;
  description: string;
  candlesAgo: number;
  estimatedRR: number;
  liquidityPoolDirection: 'above' | 'below' | 'both' | 'none';
  liquidityPoolDistancePips: number;
}

export interface AsiaRangeData {
  asiaHigh: number | null;
  asiaLow: number | null;
  rangePips: number;
  isLocked: boolean;
}

const SWING_LOOKBACK = 5;

/**
 * Identify swing highs and lows from candle data.
 * A swing high has the highest high within SWING_LOOKBACK candles on each side.
 * A swing low has the lowest low within SWING_LOOKBACK candles on each side.
 */
function identifySwings(candles: Candle[]): SwingPoint[] {
  const swings: SwingPoint[] = [];
  const n = candles.length;

  for (let i = SWING_LOOKBACK; i < n - SWING_LOOKBACK; i++) {
    const slice = candles.slice(i - SWING_LOOKBACK, i + SWING_LOOKBACK + 1);
    const isSwingHigh = slice.every((c, idx) =>
      idx === SWING_LOOKBACK ? true : c.high <= candles[i].high
    );
    const isSwingLow = slice.every((c, idx) =>
      idx === SWING_LOOKBACK ? true : c.low >= candles[i].low
    );

    if (isSwingHigh) {
      swings.push({
        price: candles[i].high,
        timestamp: candles[i].timestamp,
        index: i,
        type: 'high',
      });
    }
    if (isSwingLow) {
      swings.push({
        price: candles[i].low,
        timestamp: candles[i].timestamp,
        index: i,
        type: 'low',
      });
    }
  }

  return swings;
}

/**
 * Detect Break of Structure (BOS).
 * BOS = price closes beyond the most recent significant swing high or low.
 * Bullish BOS: close above last swing high → buy direction.
 * Bearish BOS: close below last swing low → sell direction.
 */
function detectBOS(
  candles: Candle[],
  swings: SwingPoint[],
  pipValue: number
): StructureEvent | null {
  if (candles.length < 10 || swings.length < 2) return null;

  const recent = candles.slice(-5);
  const latestClose = recent[recent.length - 1].close;

  const swingHighs = swings.filter((s) => s.type === 'high').slice(-3);
  const swingLows = swings.filter((s) => s.type === 'low').slice(-3);

  if (swingHighs.length === 0 || swingLows.length === 0) return null;

  const lastHigh = swingHighs[swingHighs.length - 1];
  const lastLow = swingLows[swingLows.length - 1];

  if (latestClose > lastHigh.price) {
    const distancePips = Math.abs(latestClose - lastHigh.price) / pipValue;
    if (distancePips < 2) return null;

    const atr = calcATR(candles.slice(-14), pipValue);
    const estimatedSL = lastLow.price;
    const estimatedTP = latestClose + atr * 1.5;
    const riskPips = Math.abs(latestClose - estimatedSL) / pipValue;
    const rewardPips = Math.abs(estimatedTP - latestClose) / pipValue;
    const estimatedRR = riskPips > 0 ? parseFloat((rewardPips / riskPips).toFixed(2)) : 1.5;

    return {
      eventType: 'BOS',
      direction: 'buy',
      eventPrice: latestClose,
      keyLevel: lastHigh.price,
      confidence: Math.min(85, 65 + Math.floor(distancePips / atr * 10)),
      description: `BOS Confirmed — price closed above swing high at ${lastHigh.price.toFixed(5)}`,
      candlesAgo: 0,
      estimatedRR,
      liquidityPoolDirection: 'above',
      liquidityPoolDistancePips: atr * 2,
    };
  }

  if (latestClose < lastLow.price) {
    const distancePips = Math.abs(latestClose - lastLow.price) / pipValue;
    if (distancePips < 2) return null;

    const atr = calcATR(candles.slice(-14), pipValue);
    const estimatedSL = lastHigh.price;
    const estimatedTP = latestClose - atr * 1.5;
    const riskPips = Math.abs(estimatedSL - latestClose) / pipValue;
    const rewardPips = Math.abs(latestClose - estimatedTP) / pipValue;
    const estimatedRR = riskPips > 0 ? parseFloat((rewardPips / riskPips).toFixed(2)) : 1.5;

    return {
      eventType: 'BOS',
      direction: 'sell',
      eventPrice: latestClose,
      keyLevel: lastLow.price,
      confidence: Math.min(85, 65 + Math.floor(distancePips / atr * 10)),
      description: `BOS Confirmed — price closed below swing low at ${lastLow.price.toFixed(5)}`,
      candlesAgo: 0,
      estimatedRR,
      liquidityPoolDirection: 'below',
      liquidityPoolDistancePips: atr * 2,
    };
  }

  return null;
}

/**
 * Detect Change of Character (ChoCh).
 * ChoCh = the first candle that closes against the established trend direction,
 * breaking the most recent swing of the opposite type.
 * Signals a potential trend reversal — higher conviction than BOS in trending markets.
 */
function detectChoCh(
  candles: Candle[],
  swings: SwingPoint[],
  pipValue: number
): StructureEvent | null {
  if (candles.length < 20 || swings.length < 4) return null;

  const recentSwings = swings.slice(-6);
  const highs = recentSwings.filter((s) => s.type === 'high');
  const lows = recentSwings.filter((s) => s.type === 'low');

  if (highs.length < 2 || lows.length < 2) return null;

  // Downtrend detection: lower highs + lower lows
  const lh1 = highs[highs.length - 2].price;
  const lh2 = highs[highs.length - 1].price;
  const ll1 = lows[lows.length - 2].price;
  const ll2 = lows[lows.length - 1].price;

  const isDowntrend = lh2 < lh1 && ll2 < ll1;
  const isUptrend = lh2 > lh1 && ll2 > ll1;

  const latestClose = candles[candles.length - 1].close;
  const atr = calcATR(candles.slice(-14), pipValue);

  if (isDowntrend && latestClose > highs[highs.length - 1].price) {
    const distancePips = Math.abs(latestClose - highs[highs.length - 1].price) / pipValue;
    if (distancePips < 3) return null;

    return {
      eventType: 'ChoCh',
      direction: 'buy',
      eventPrice: latestClose,
      keyLevel: highs[highs.length - 1].price,
      confidence: Math.min(80, 70 + Math.floor(distancePips / 5)),
      description: `ChoCh — downtrend broken. First close above recent swing high at ${highs[highs.length - 1].price.toFixed(5)}`,
      candlesAgo: 0,
      estimatedRR: 1.8,
      liquidityPoolDirection: 'above',
      liquidityPoolDistancePips: atr * 2,
    };
  }

  if (isUptrend && latestClose < lows[lows.length - 1].price) {
    const distancePips = Math.abs(latestClose - lows[lows.length - 1].price) / pipValue;
    if (distancePips < 3) return null;

    return {
      eventType: 'ChoCh',
      direction: 'sell',
      eventPrice: latestClose,
      keyLevel: lows[lows.length - 1].price,
      confidence: Math.min(80, 70 + Math.floor(distancePips / 5)),
      description: `ChoCh — uptrend broken. First close below recent swing low at ${lows[lows.length - 1].price.toFixed(5)}`,
      candlesAgo: 0,
      estimatedRR: 1.8,
      liquidityPoolDirection: 'below',
      liquidityPoolDistancePips: atr * 2,
    };
  }

  return null;
}

/**
 * Detect Fair Value Gap (FVG).
 * FVG = 3-candle pattern where candle[1] creates an imbalance:
 *   Bullish FVG: candle[2].low > candle[0].high (gap left between them)
 *   Bearish FVG: candle[2].high < candle[0].low
 * A card fires when price returns to fill the gap (re-entry opportunity).
 */
function detectFVG(candles: Candle[], pipValue: number): StructureEvent | null {
  if (candles.length < 10) return null;

  const recent = candles.slice(-10);
  const latestClose = candles[candles.length - 1].close;
  const atr = calcATR(candles.slice(-14), pipValue);
  const minGapPips = atr * 0.3;

  for (let i = 0; i < recent.length - 2; i++) {
    const c0 = recent[i];
    const c2 = recent[i + 2];

    const bullishGap = c2.low - c0.high;
    const bearishGap = c0.low - c2.high;

    if (bullishGap > minGapPips * pipValue) {
      const gapMid = (c0.high + c2.low) / 2;
      const inFillZone =
        latestClose >= c0.high - atr * 0.2 * pipValue &&
        latestClose <= c2.low + atr * 0.5 * pipValue;

      if (inFillZone) {
        return {
          eventType: 'FVG',
          direction: 'buy',
          eventPrice: latestClose,
          keyLevel: gapMid,
          confidence: 72,
          description: `FVG Retest — bullish imbalance zone ${c0.high.toFixed(5)} – ${c2.low.toFixed(5)}`,
          candlesAgo: recent.length - i - 2,
          estimatedRR: 2.0,
          liquidityPoolDirection: 'above',
          liquidityPoolDistancePips: atr * 2,
        };
      }
    }

    if (bearishGap > minGapPips * pipValue) {
      const gapMid = (c0.low + c2.high) / 2;
      const inFillZone =
        latestClose <= c0.low + atr * 0.2 * pipValue &&
        latestClose >= c2.high - atr * 0.5 * pipValue;

      if (inFillZone) {
        return {
          eventType: 'FVG',
          direction: 'sell',
          eventPrice: latestClose,
          keyLevel: gapMid,
          confidence: 72,
          description: `FVG Retest — bearish imbalance zone ${c2.high.toFixed(5)} – ${c0.low.toFixed(5)}`,
          candlesAgo: recent.length - i - 2,
          estimatedRR: 2.0,
          liquidityPoolDirection: 'below',
          liquidityPoolDistancePips: atr * 2,
        };
      }
    }
  }

  return null;
}

/**
 * Detect Order Block.
 * Order Block = the last opposing candle before a strong impulse move.
 * Fires when price retests the order block zone.
 */
function detectOrderBlock(candles: Candle[], pipValue: number): StructureEvent | null {
  if (candles.length < 15) return null;

  const atr = calcATR(candles.slice(-14), pipValue);
  const latestClose = candles[candles.length - 1].close;
  const minImpulsePips = atr * 1.5;

  for (let i = 5; i < candles.length - 3; i++) {
    const c = candles[i];
    const impulse = candles.slice(i + 1, i + 4);

    const impulseMove = Math.abs(impulse[impulse.length - 1].close - c.close);
    if (impulseMove < minImpulsePips * pipValue) continue;

    const isBullishImpulse = impulse[impulse.length - 1].close > c.close;
    const isBearishImpulse = impulse[impulse.length - 1].close < c.close;

    const obHigh = Math.max(c.open, c.close);
    const obLow = Math.min(c.open, c.close);
    const inRetestZone =
      latestClose >= obLow - atr * 0.1 * pipValue &&
      latestClose <= obHigh + atr * 0.3 * pipValue;

    if (isBullishImpulse && c.close < c.open && inRetestZone) {
      return {
        eventType: 'OrderBlock',
        direction: 'buy',
        eventPrice: latestClose,
        keyLevel: obLow,
        confidence: 75,
        description: `Order Block Retest — bullish OB zone ${obLow.toFixed(5)} – ${obHigh.toFixed(5)}`,
        candlesAgo: candles.length - i - 1,
        estimatedRR: 2.2,
        liquidityPoolDirection: 'above',
        liquidityPoolDistancePips: atr * 3,
      };
    }

    if (isBearishImpulse && c.close > c.open && inRetestZone) {
      return {
        eventType: 'OrderBlock',
        direction: 'sell',
        eventPrice: latestClose,
        keyLevel: obHigh,
        confidence: 75,
        description: `Order Block Retest — bearish OB zone ${obLow.toFixed(5)} – ${obHigh.toFixed(5)}`,
        candlesAgo: candles.length - i - 1,
        estimatedRR: 2.2,
        liquidityPoolDirection: 'below',
        liquidityPoolDistancePips: atr * 3,
      };
    }
  }

  return null;
}

/**
 * Detect Liquidity Sweep.
 * A wick that extends beyond a key level then closes back inside it.
 * Institutional signature: stop hunt followed by reversal.
 */
function detectLiquiditySweep(
  candles: Candle[],
  swings: SwingPoint[],
  pipValue: number
): StructureEvent | null {
  if (candles.length < 5 || swings.length < 2) return null;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const atr = calcATR(candles.slice(-14), pipValue);
  const minWickPips = atr * 0.4;

  const swingHighs = swings.filter((s) => s.type === 'high').slice(-3);
  const swingLows = swings.filter((s) => s.type === 'low').slice(-3);

  for (const sh of swingHighs) {
    const sweptHigh = last.high > sh.price;
    const closedBelow = last.close < sh.price;
    const wickSizePips = (last.high - Math.max(last.open, last.close)) / pipValue;

    if (sweptHigh && closedBelow && wickSizePips >= minWickPips) {
      return {
        eventType: 'LiquiditySweep',
        direction: 'sell',
        eventPrice: last.close,
        keyLevel: sh.price,
        confidence: 78,
        description: `Liquidity Sweep — stops above ${sh.price.toFixed(5)} cleared, close back inside`,
        candlesAgo: 0,
        estimatedRR: 2.0,
        liquidityPoolDirection: 'below',
        liquidityPoolDistancePips: atr * 2,
      };
    }
  }

  for (const sl of swingLows) {
    const sweptLow = last.low < sl.price;
    const closedAbove = last.close > sl.price;
    const wickSizePips = (Math.min(last.open, last.close) - last.low) / pipValue;

    if (sweptLow && closedAbove && wickSizePips >= minWickPips) {
      return {
        eventType: 'LiquiditySweep',
        direction: 'buy',
        eventPrice: last.close,
        keyLevel: sl.price,
        confidence: 78,
        description: `Liquidity Sweep — stops below ${sl.price.toFixed(5)} cleared, close back above`,
        candlesAgo: 0,
        estimatedRR: 2.0,
        liquidityPoolDirection: 'above',
        liquidityPoolDistancePips: atr * 2,
      };
    }
  }

  return null;
}

/**
 * Detect Asia Range Sweep.
 * Fires when London opens and price sweeps the locked Asia high or low.
 * This is the most reliable intraday event after a proper Asia range forms.
 */
function detectAsiaRangeSweep(
  candles: Candle[],
  asiaRange: AsiaRangeData,
  pipValue: number
): StructureEvent | null {
  if (!asiaRange.isLocked || asiaRange.asiaHigh === null || asiaRange.asiaLow === null) {
    return null;
  }

  const utcHour = new Date().getUTCHours();
  if (utcHour < 8 || utcHour > 11) return null;

  if (candles.length < 3) return null;

  const last = candles[candles.length - 1];
  const atr = calcATR(candles.slice(-14), pipValue);
  const tolerance = atr * 0.2 * pipValue;

  const sweptAbove = last.high > asiaRange.asiaHigh + tolerance;
  const closedBelow = last.close < asiaRange.asiaHigh;

  const sweptBelow = last.low < asiaRange.asiaLow - tolerance;
  const closedAbove = last.close > asiaRange.asiaLow;

  if (sweptAbove && closedBelow) {
    return {
      eventType: 'AsiaRangeSweep',
      direction: 'sell',
      eventPrice: last.close,
      keyLevel: asiaRange.asiaHigh,
      confidence: 82,
      description: `London Swept Asia High at ${asiaRange.asiaHigh.toFixed(5)} — bearish reversal entry`,
      candlesAgo: 0,
      estimatedRR: 2.5,
      liquidityPoolDirection: 'below',
      liquidityPoolDistancePips: asiaRange.rangePips,
    };
  }

  if (sweptBelow && closedAbove) {
    return {
      eventType: 'AsiaRangeSweep',
      direction: 'buy',
      eventPrice: last.close,
      keyLevel: asiaRange.asiaLow,
      confidence: 82,
      description: `London Swept Asia Low at ${asiaRange.asiaLow.toFixed(5)} — bullish reversal entry`,
      candlesAgo: 0,
      estimatedRR: 2.5,
      liquidityPoolDirection: 'above',
      liquidityPoolDistancePips: asiaRange.rangePips,
    };
  }

  return null;
}

/**
 * Detect Asia Range Building (informational).
 * During Asia session, track the forming range for London targeting.
 */
function detectAsiaRangeBuilding(
  candles: Candle[],
  pipValue: number
): StructureEvent | null {
  const utcHour = new Date().getUTCHours();
  if (utcHour < 0 || utcHour >= 8) return null;
  if (candles.length < 20) return null;

  const asiaCandles = candles.slice(-Math.min(candles.length, 48));
  const high = Math.max(...asiaCandles.map((c) => c.high));
  const low = Math.min(...asiaCandles.map((c) => c.low));
  const rangePips = (high - low) / pipValue;

  if (rangePips < 5) return null;

  return {
    eventType: 'AsiaRangeBuilding',
    direction: 'neutral',
    eventPrice: (high + low) / 2,
    keyLevel: high,
    confidence: 60,
    description: `Asia Range: ${low.toFixed(5)} – ${high.toFixed(5)} (${Math.round(rangePips)} pips). London will target these levels.`,
    candlesAgo: 0,
    estimatedRR: 0,
    liquidityPoolDirection: 'both',
    liquidityPoolDistancePips: rangePips / 2,
  };
}

/**
 * Simple ATR calculator over last N candles.
 * Returns ATR in pips.
 */
function calcATR(candles: Candle[], pipValue: number): number {
  if (candles.length < 2) return 10;
  const ranges = candles.map((c) => (c.high - c.low) / pipValue);
  return ranges.reduce((s, r) => s + r, 0) / ranges.length;
}

export interface MarketStructureAnalysis {
  primaryEvent: StructureEvent | null;
  allEvents: StructureEvent[];
  asiaRange: AsiaRangeData;
}

/**
 * Run all structure event detectors against candle data.
 * Returns the highest confidence event as primaryEvent.
 * No LLM calls. Pure math.
 */
export function analyzeMarketStructure(
  candles: Candle[],
  pipValue: number,
  asiaRange?: AsiaRangeData
): MarketStructureAnalysis {
  const defaultAsiaRange: AsiaRangeData = {
    asiaHigh: null,
    asiaLow: null,
    rangePips: 0,
    isLocked: false,
  };

  const effectiveAsiaRange = asiaRange ?? defaultAsiaRange;
  const swings = identifySwings(candles);
  const events: StructureEvent[] = [];

  const asiaRangeSweep = detectAsiaRangeSweep(candles, effectiveAsiaRange, pipValue);
  if (asiaRangeSweep) events.push(asiaRangeSweep);

  const choch = detectChoCh(candles, swings, pipValue);
  if (choch) events.push(choch);

  const liqSweep = detectLiquiditySweep(candles, swings, pipValue);
  if (liqSweep) events.push(liqSweep);

  const bos = detectBOS(candles, swings, pipValue);
  if (bos) events.push(bos);

  const ob = detectOrderBlock(candles, pipValue);
  if (ob) events.push(ob);

  const fvg = detectFVG(candles, pipValue);
  if (fvg) events.push(fvg);

  const asiaBuilding = detectAsiaRangeBuilding(candles, pipValue);
  if (asiaBuilding) events.push(asiaBuilding);

  events.sort((a, b) => b.confidence - a.confidence);

  return {
    primaryEvent: events[0] ?? null,
    allEvents: events,
    asiaRange: effectiveAsiaRange,
  };
}

/**
 * Compute the current Asia range from candle history.
 * If utcHour < 8, range is still forming (not locked).
 * If utcHour >= 8, range is locked from the most recent Asia session.
 */
export function computeAsiaRange(candles: Candle[], pipValue: number): AsiaRangeData {
  const utcHour = new Date().getUTCHours();
  const isLocked = utcHour >= 8;

  const now = Date.now() / 1000;
  const asiaStartUnix = isLocked
    ? now - (utcHour * 3600) - (new Date().getUTCMinutes() * 60)
    : now - (utcHour * 3600) - (new Date().getUTCMinutes() * 60);
  const asiaEndUnix = isLocked
    ? asiaStartUnix + 8 * 3600
    : now;

  const asiaCandles = candles.filter(
    (c) => c.timestamp >= asiaStartUnix - 8 * 3600 && c.timestamp <= asiaEndUnix
  );

  if (asiaCandles.length < 5) {
    return { asiaHigh: null, asiaLow: null, rangePips: 0, isLocked: false };
  }

  const asiaHigh = Math.max(...asiaCandles.map((c) => c.high));
  const asiaLow = Math.min(...asiaCandles.map((c) => c.low));
  const rangePips = (asiaHigh - asiaLow) / pipValue;

  return { asiaHigh, asiaLow, rangePips, isLocked };
}
