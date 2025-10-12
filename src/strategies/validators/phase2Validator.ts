import { Candle } from '../../lib/indicators';
import { Phase2TacticalSetup } from '../types';
import { isHalfTrendAlignedForTrade, getHalfTrendSignal } from '../indicators/halfTrend';
import { getStochRSISignal, isStochRSIAlignedForTrade } from '../indicators/stochasticRSI';
import { isSignalLineAlignedForTrade, getSignalLinePosition } from '../indicators/linearRegression';

export function validatePhase2TacticalSetup(
  m5Candles: Candle[],
  direction: 'BUY' | 'SELL'
): Phase2TacticalSetup {
  if (m5Candles.length < 50) {
    return {
      passed: false,
      halfTrendAligned: false,
      stochRSIAligned: false,
      signalLineAligned: false,
      confidence: 0,
      reason: 'Insufficient 5M candle data for tactical setup validation',
      details: {
        halfTrend: null,
        stochRSI: null,
        signalLinePosition: null
      }
    };
  }

  let halfTrendAligned = false;
  let stochRSIAligned = false;
  let signalLineAligned = false;

  let halfTrendValue: 'GREEN' | 'RED' | null = null;
  let stochRSIValue: any = null;
  let signalLinePosition: 'above' | 'below' | null = null;

  const reasons: string[] = [];
  let confidence = 0;

  try {
    halfTrendAligned = isHalfTrendAlignedForTrade(m5Candles, direction);
    const halfTrendSignal = getHalfTrendSignal(m5Candles);
    halfTrendValue = halfTrendSignal.current;

    if (halfTrendAligned) {
      reasons.push(`HalfTrend is ${halfTrendValue} (aligned)`);
      confidence += 33;
    } else {
      reasons.push(`HalfTrend is ${halfTrendValue} (misaligned for ${direction})`);
    }
  } catch (error) {
    reasons.push('HalfTrend calculation failed');
  }

  try {
    stochRSIAligned = isStochRSIAlignedForTrade(m5Candles, direction);
    const stochSignal = getStochRSISignal(m5Candles, direction);
    stochRSIValue = {
      value: stochSignal.k,
      zone: stochSignal.zone,
      crossing: stochSignal.crossing
    };

    if (stochRSIAligned) {
      reasons.push(`Stoch RSI ${stochSignal.zone} and crossing ${stochSignal.crossing} (aligned)`);
      confidence += 33;
    } else {
      if (direction === 'BUY') {
        reasons.push(`Stoch RSI not oversold or not crossing up (K=${stochSignal.k.toFixed(1)})`);
      } else {
        reasons.push(`Stoch RSI not overbought or not crossing down (K=${stochSignal.k.toFixed(1)})`);
      }
    }
  } catch (error) {
    reasons.push('Stoch RSI calculation failed');
  }

  try {
    signalLineAligned = isSignalLineAlignedForTrade(m5Candles, direction);
    const signalPos = getSignalLinePosition(m5Candles);
    signalLinePosition = signalPos.priceAbove ? 'above' : 'below';

    if (signalLineAligned) {
      const positionText = direction === 'BUY' ? 'above' : 'below';
      reasons.push(`Price is ${positionText} Signal Line (aligned)`);
      confidence += 34;
    } else {
      const expectedPos = direction === 'BUY' ? 'above' : 'below';
      const actualPos = signalPos.priceAbove ? 'above' : 'below';
      reasons.push(`Price is ${actualPos} Signal Line, expected ${expectedPos}`);
    }
  } catch (error) {
    reasons.push('Signal Line calculation failed');
  }

  const passed = halfTrendAligned && stochRSIAligned && signalLineAligned;
  const reason = passed
    ? `All tactical indicators aligned for ${direction}: ${reasons.join(', ')}`
    : `Tactical setup incomplete: ${reasons.join(', ')}`;

  return {
    passed,
    halfTrendAligned,
    stochRSIAligned,
    signalLineAligned,
    confidence: Math.round(confidence),
    reason,
    details: {
      halfTrend: halfTrendValue,
      stochRSI: stochRSIValue,
      signalLinePosition
    }
  };
}
