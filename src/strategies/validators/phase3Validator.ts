import { Candle, calculateRSI } from '../../lib/indicators';
import { Phase3PrecisionEntry } from '../types';
import { detectHeikinAshiShift, getCurrentHeikinAshiColor } from '../indicators/heikinAshi';
import { isSignalLineAlignedForTrade, getSignalLinePosition } from '../indicators/linearRegression';

export function validatePhase3PrecisionEntry(
  m1Candles: Candle[],
  direction: 'BUY' | 'SELL'
): Phase3PrecisionEntry {
  if (m1Candles.length < 50) {
    return {
      passed: false,
      haCandleShifted: false,
      rsiMomentumAligned: false,
      signalLineConfirmed: false,
      confidence: 0,
      reason: 'Insufficient 1M candle data for precision entry validation',
      details: {
        haCandleColor: null,
        rsiValue: null,
        rsiCrossing: 'none',
        signalLinePosition: null
      }
    };
  }

  let haCandleShifted = false;
  let rsiMomentumAligned = false;
  let signalLineConfirmed = false;

  let haCandleColor: 'green' | 'red' | null = null;
  let rsiValue: number | null = null;
  let rsiCrossing: 'up' | 'down' | 'none' = 'none';
  let signalLinePosition: 'above' | 'below' | null = null;

  const reasons: string[] = [];
  let confidence = 0;

  try {
    haCandleShifted = detectHeikinAshiShift(m1Candles, direction);
    haCandleColor = getCurrentHeikinAshiColor(m1Candles);

    if (haCandleShifted) {
      const colorText = direction === 'BUY' ? 'green' : 'red';
      reasons.push(`Heikin Ashi shifted to ${colorText} (aligned)`);
      confidence += 33;
    } else {
      reasons.push(`No Heikin Ashi color shift detected for ${direction}`);
    }
  } catch (error) {
    reasons.push('Heikin Ashi calculation failed');
  }

  try {
    rsiValue = calculateRSI(m1Candles, 14);

    if (m1Candles.length >= 16) {
      const previousCandles = m1Candles.slice(0, -1);
      const previousRSI = calculateRSI(previousCandles, 14);

      if (direction === 'BUY') {
        if (previousRSI < 50 && rsiValue >= 50) {
          rsiCrossing = 'up';
          rsiMomentumAligned = true;
        } else if (rsiValue > 50) {
          rsiMomentumAligned = true;
        }
      } else {
        if (previousRSI > 50 && rsiValue <= 50) {
          rsiCrossing = 'down';
          rsiMomentumAligned = true;
        } else if (rsiValue < 50) {
          rsiMomentumAligned = true;
        }
      }
    }

    if (rsiMomentumAligned) {
      if (rsiCrossing !== 'none') {
        reasons.push(`RSI crossing ${rsiCrossing} at ${rsiValue.toFixed(1)} (strong signal)`);
        confidence += 38;
      } else {
        const side = direction === 'BUY' ? 'above' : 'below';
        reasons.push(`RSI ${side} 50 at ${rsiValue.toFixed(1)} (aligned)`);
        confidence += 33;
      }
    } else {
      const expectedSide = direction === 'BUY' ? 'above or crossing up' : 'below or crossing down';
      reasons.push(`RSI at ${rsiValue.toFixed(1)}, expected ${expectedSide}`);
    }
  } catch (error) {
    reasons.push('RSI calculation failed');
  }

  try {
    signalLineConfirmed = isSignalLineAlignedForTrade(m1Candles, direction);
    const signalPos = getSignalLinePosition(m1Candles);
    signalLinePosition = signalPos.priceAbove ? 'above' : 'below';

    if (signalLineConfirmed) {
      const positionText = direction === 'BUY' ? 'above' : 'below';
      reasons.push(`1M close ${positionText} Signal Line (confirmed)`);
      confidence += 29;
    } else {
      const expectedPos = direction === 'BUY' ? 'above' : 'below';
      const actualPos = signalPos.priceAbove ? 'above' : 'below';
      reasons.push(`1M close is ${actualPos} Signal Line, expected ${expectedPos}`);
    }
  } catch (error) {
    reasons.push('Signal Line calculation failed');
  }

  const passed = haCandleShifted && rsiMomentumAligned && signalLineConfirmed;
  const reason = passed
    ? `All precision entry conditions met for ${direction}: ${reasons.join(', ')}`
    : `Precision entry incomplete: ${reasons.join(', ')}`;

  return {
    passed,
    haCandleShifted,
    rsiMomentumAligned,
    signalLineConfirmed,
    confidence: Math.round(confidence),
    reason,
    details: {
      haCandleColor,
      rsiValue,
      rsiCrossing,
      signalLinePosition
    }
  };
}
