import { Candle } from '../../lib/indicators';
import { RiskManagement } from '../types';
import { getLastOppositeColorCandle } from '../indicators/heikinAshi';

const PIP_VALUE = 0.0001;
const BUFFER_PIPS = 2;

export function calculateStopLoss(
  candles: Candle[],
  direction: 'BUY' | 'SELL',
  entryPrice: number
): number {
  const lastOppositeHA = getLastOppositeColorCandle(candles, direction);

  if (!lastOppositeHA) {
    const atrEstimate = Math.abs(candles[candles.length - 1].high - candles[candles.length - 1].low) * 2;
    return direction === 'BUY'
      ? entryPrice - atrEstimate - (BUFFER_PIPS * PIP_VALUE)
      : entryPrice + atrEstimate + (BUFFER_PIPS * PIP_VALUE);
  }

  if (direction === 'BUY') {
    return lastOppositeHA.low - (BUFFER_PIPS * PIP_VALUE);
  } else {
    return lastOppositeHA.high + (BUFFER_PIPS * PIP_VALUE);
  }
}

export function calculateTakeProfit(
  entryPrice: number,
  stopLoss: number,
  riskRewardRatio: number = 2
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = risk * riskRewardRatio;

  if (entryPrice > stopLoss) {
    return entryPrice + reward;
  } else {
    return entryPrice - reward;
  }
}

export function calculateBreakEvenPrice(
  entryPrice: number,
  stopLoss: number
): number {
  const risk = Math.abs(entryPrice - stopLoss);
  const direction = entryPrice > stopLoss ? 'BUY' : 'SELL';

  if (direction === 'BUY') {
    return entryPrice + risk;
  } else {
    return entryPrice - risk;
  }
}

export function calculatePipsDistance(price1: number, price2: number): number {
  return Math.abs(price1 - price2) / PIP_VALUE;
}

export function buildRiskManagement(
  candles: Candle[],
  direction: 'BUY' | 'SELL',
  entryPrice: number,
  riskRewardRatio: number = 2
): RiskManagement {
  const stopLoss = calculateStopLoss(candles, direction, entryPrice);
  const takeProfit = calculateTakeProfit(entryPrice, stopLoss, riskRewardRatio);
  const breakEvenPrice = calculateBreakEvenPrice(entryPrice, stopLoss);

  const stopLossPips = calculatePipsDistance(entryPrice, stopLoss);
  const takeProfitPips = calculatePipsDistance(entryPrice, takeProfit);

  return {
    entryPrice,
    stopLoss,
    takeProfit,
    stopLossPips,
    takeProfitPips,
    riskRewardRatio,
    breakEvenPrice,
    partialClosePrice: breakEvenPrice
  };
}

export function calculatePositionSize(
  accountBalance: number,
  riskPercentage: number,
  stopLossPips: number,
  pipValue: number = 10
): number {
  const riskAmount = accountBalance * (riskPercentage / 100);
  const lotSize = riskAmount / (stopLossPips * pipValue);

  return Math.max(0.01, Math.round(lotSize * 100) / 100);
}

export function shouldMoveToBreakeven(
  currentPrice: number,
  entryPrice: number,
  breakEvenPrice: number,
  direction: 'BUY' | 'SELL'
): boolean {
  if (direction === 'BUY') {
    return currentPrice >= breakEvenPrice;
  } else {
    return currentPrice <= breakEvenPrice;
  }
}

export function shouldExitOnSignalLineCross(
  currentPrice: number,
  signalLineValue: number,
  direction: 'BUY' | 'SELL'
): boolean {
  if (direction === 'BUY') {
    return currentPrice < signalLineValue;
  } else {
    return currentPrice > signalLineValue;
  }
}
