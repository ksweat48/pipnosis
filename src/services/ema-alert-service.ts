/**
 * EMA Alert Service
 * Detects EMA events, generates notifications, and persists alerts to Supabase
 */

import { supabase } from '../lib/supabase';
import { Candle } from '../lib/indicators';
import { generateEMASignals, EMASignals, EMACrossover } from '../lib/emaAnalysis';

interface EMAAlert {
  id?: string;
  user_id: string;
  symbol: string;
  timeframe: string;
  alert_type: 'crossover' | 'pullback' | 'trend_change';
  event_data: object;
  is_read: boolean;
  created_at?: string;
}

const lastAlertTimestamps = new Map<string, number>();
const ALERT_THROTTLE_MS = 5 * 60 * 1000;

export async function detectAndSaveEMAEvents(
  userId: string,
  symbol: string,
  timeframe: string,
  candles: Candle[],
  h1Candles?: Candle[]
): Promise<EMAAlert[]> {
  if (candles.length < 200) {
    return [];
  }

  try {
    const signals = generateEMASignals(candles, h1Candles);
    const alerts: EMAAlert[] = [];

    if (signals.crossover) {
      const alert = await createCrossoverAlert(userId, symbol, timeframe, signals.crossover);
      if (alert) {
        alerts.push(alert);
      }
    }

    if (signals.pullback && signals.trend.direction !== 'NEUTRAL') {
      const alert = await createPullbackAlert(userId, symbol, timeframe, signals);
      if (alert) {
        alerts.push(alert);
      }
    }

    const trendChangeAlert = await detectTrendChange(userId, symbol, timeframe, signals);
    if (trendChangeAlert) {
      alerts.push(trendChangeAlert);
    }

    return alerts;
  } catch (err) {
    console.error('Error detecting EMA events:', err);
    return [];
  }
}

async function createCrossoverAlert(
  userId: string,
  symbol: string,
  timeframe: string,
  crossover: EMACrossover
): Promise<EMAAlert | null> {
  const alertKey = `${userId}-${symbol}-${timeframe}-crossover-${crossover.type}`;
  const now = Date.now();
  const lastAlert = lastAlertTimestamps.get(alertKey);

  if (lastAlert && now - lastAlert < ALERT_THROTTLE_MS) {
    return null;
  }

  const isBullish = crossover.type.includes('above') || crossover.type === 'golden_cross';
  const direction = isBullish ? 'Bullish' : 'Bearish';

  const alert: EMAAlert = {
    user_id: userId,
    symbol,
    timeframe,
    alert_type: 'crossover',
    event_data: {
      type: crossover.type,
      fastEMA: crossover.fastEMA,
      slowEMA: crossover.slowEMA,
      price: crossover.price,
      timestamp: crossover.timestamp.toISOString(),
      direction,
      strength: crossover.strength,
      description: `EMA${crossover.fastEMA} crossed ${isBullish ? 'above' : 'below'} EMA${crossover.slowEMA} - ${direction} momentum`
    },
    is_read: false
  };

  try {
    const { data, error } = await supabase
      .from('ema_alerts')
      .insert(alert)
      .select()
      .single();

    if (error) throw error;

    lastAlertTimestamps.set(alertKey, now);
    return data;
  } catch (err) {
    console.error('Error saving crossover alert:', err);
    return null;
  }
}

async function createPullbackAlert(
  userId: string,
  symbol: string,
  timeframe: string,
  signals: EMASignals
): Promise<EMAAlert | null> {
  if (!signals.pullback) return null;

  const alertKey = `${userId}-${symbol}-${timeframe}-pullback-${signals.pullback.ema}`;
  const now = Date.now();
  const lastAlert = lastAlertTimestamps.get(alertKey);

  if (lastAlert && now - lastAlert < ALERT_THROTTLE_MS) {
    return null;
  }

  const alert: EMAAlert = {
    user_id: userId,
    symbol,
    timeframe,
    alert_type: 'pullback',
    event_data: {
      ema: signals.pullback.ema,
      price: signals.pullback.price,
      distance: signals.pullback.distance,
      distancePercent: signals.pullback.distancePercent,
      type: signals.pullback.type,
      trendDirection: signals.trend.direction,
      description: `Price ${signals.pullback.type} EMA${signals.pullback.ema} - ${signals.trend.direction === 'BULLISH' ? 'Long' : 'Short'} entry opportunity`
    },
    is_read: false
  };

  try {
    const { data, error } = await supabase
      .from('ema_alerts')
      .insert(alert)
      .select()
      .single();

    if (error) throw error;

    lastAlertTimestamps.set(alertKey, now);
    return data;
  } catch (err) {
    console.error('Error saving pullback alert:', err);
    return null;
  }
}

async function detectTrendChange(
  userId: string,
  symbol: string,
  timeframe: string,
  signals: EMASignals
): Promise<EMAAlert | null> {
  const alertKey = `${userId}-${symbol}-${timeframe}-trend-${signals.trend.direction}`;
  const now = Date.now();
  const lastAlert = lastAlertTimestamps.get(alertKey);

  if (lastAlert && now - lastAlert < ALERT_THROTTLE_MS * 2) {
    return null;
  }

  if (signals.trend.strength < 75) {
    return null;
  }

  const alert: EMAAlert = {
    user_id: userId,
    symbol,
    timeframe,
    alert_type: 'trend_change',
    event_data: {
      direction: signals.trend.direction,
      strength: signals.trend.strength,
      shortTermAlign: signals.trend.shortTermAlign,
      mediumTermAlign: signals.trend.mediumTermAlign,
      longTermAlign: signals.trend.longTermAlign,
      description: `Strong ${signals.trend.direction} trend confirmed - ${signals.trend.strength}% alignment`
    },
    is_read: false
  };

  try {
    const { data, error } = await supabase
      .from('ema_alerts')
      .insert(alert)
      .select()
      .single();

    if (error) throw error;

    lastAlertTimestamps.set(alertKey, now);
    return data;
  } catch (err) {
    console.error('Error saving trend change alert:', err);
    return null;
  }
}

export async function getUnreadEMAAlerts(userId: string, symbol?: string, timeframe?: string): Promise<EMAAlert[]> {
  try {
    let query = supabase
      .from('ema_alerts')
      .select('*')
      .eq('user_id', userId)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (symbol) {
      query = query.eq('symbol', symbol);
    }

    if (timeframe) {
      query = query.eq('timeframe', timeframe);
    }

    const { data, error } = await query;

    if (error) throw error;

    return data || [];
  } catch (err) {
    console.error('Error fetching unread EMA alerts:', err);
    return [];
  }
}

export async function markAlertAsRead(alertId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ema_alerts')
      .update({ is_read: true })
      .eq('id', alertId);

    if (error) throw error;

    return true;
  } catch (err) {
    console.error('Error marking alert as read:', err);
    return false;
  }
}

export async function deleteAlert(alertId: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('ema_alerts')
      .delete()
      .eq('id', alertId);

    if (error) throw error;

    return true;
  } catch (err) {
    console.error('Error deleting alert:', err);
    return false;
  }
}
