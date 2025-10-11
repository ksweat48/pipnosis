/**
 * Market Analysis Service
 * Handles database operations for AI market analysis results
 */

import { supabase } from '../lib/supabase';
import { AiMarketSummary } from '../lib/aiMarketEngine';

export interface MarketAnalysisRecord {
  id?: string;
  symbol: string;
  timeframe: string;
  rsi_value: number;
  rsi_status: string;
  vwap_value: number;
  vwap_position: string;
  volume_status: string;
  volume_delta: string;
  current_volume: number;
  average_volume: number;
  atr_value: number;
  atr_status: string;
  candle_signal_type: string;
  candle_signal_strength: string | null;
  structure_type: string;
  structure_recent: boolean;
  sentiment_status: string;
  sentiment_confidence: number;
  trade_signal_status: string;
  trade_signal_direction: string | null;
  trade_signal_confidence: number | null;
  trade_signal_reason: string | null;
  analyzed_at: string;
  candles_analyzed: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Save or update market analysis in database
 */
export async function saveMarketAnalysis(
  symbol: string,
  timeframe: string,
  analysis: AiMarketSummary
): Promise<{ success: boolean; error?: string }> {
  try {
    const record: Partial<MarketAnalysisRecord> = {
      symbol,
      timeframe,
      rsi_value: analysis.rsi.value,
      rsi_status: analysis.rsi.status,
      vwap_value: analysis.vwap.value,
      vwap_position: analysis.vwap.position,
      volume_status: analysis.volume.status,
      volume_delta: analysis.volume.delta,
      current_volume: analysis.volume.currentVolume,
      average_volume: analysis.volume.averageVolume,
      atr_value: analysis.atr.value,
      atr_status: analysis.atr.status,
      candle_signal_type: analysis.candleSignal.type,
      candle_signal_strength: analysis.candleSignal.strength,
      structure_type: analysis.structure.type,
      structure_recent: analysis.structure.recent,
      sentiment_status: analysis.sentiment.status,
      sentiment_confidence: analysis.sentiment.confidence,
      trade_signal_status: analysis.tradeSignal.status,
      trade_signal_direction: analysis.tradeSignal.direction || null,
      trade_signal_confidence: analysis.tradeSignal.confidence || null,
      trade_signal_reason: analysis.tradeSignal.reason || null,
      analyzed_at: analysis.metadata.timestamp.toISOString(),
      candles_analyzed: analysis.metadata.candlesAnalyzed
    };

    const { data, error } = await supabase
      .from('market_analysis')
      .upsert(record, {
        onConflict: 'symbol,timeframe'
      })
      .select()
      .single();

    if (error) {
      console.error('❌ Failed to save market analysis:', error);
      return { success: false, error: error.message };
    }

    console.log(`✅ Saved market analysis for ${symbol} ${timeframe}`);
    return { success: true };

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('❌ Exception saving market analysis:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * Get latest market analysis for a symbol and timeframe
 */
export async function getLatestAnalysis(
  symbol: string,
  timeframe: string
): Promise<MarketAnalysisRecord | null> {
  try {
    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('analyzed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('❌ Failed to fetch market analysis:', error);
      return null;
    }

    return data;

  } catch (err) {
    console.error('❌ Exception fetching market analysis:', err);
    return null;
  }
}

/**
 * Get all valid trade signals
 */
export async function getValidTradeSignals(): Promise<MarketAnalysisRecord[]> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .eq('trade_signal_status', 'VALID')
      .gte('analyzed_at', oneHourAgo)
      .order('trade_signal_confidence', { ascending: false })
      .order('analyzed_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch trade signals:', error);
      return [];
    }

    return data || [];

  } catch (err) {
    console.error('❌ Exception fetching trade signals:', err);
    return [];
  }
}

/**
 * Get market analysis for multiple symbols
 */
export async function getBatchAnalysis(
  symbols: string[],
  timeframe: string
): Promise<MarketAnalysisRecord[]> {
  try {
    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .in('symbol', symbols)
      .eq('timeframe', timeframe)
      .order('analyzed_at', { ascending: false });

    if (error) {
      console.error('❌ Failed to fetch batch analysis:', error);
      return [];
    }

    const latestBySymbol = new Map<string, MarketAnalysisRecord>();

    for (const record of data || []) {
      if (!latestBySymbol.has(record.symbol)) {
        latestBySymbol.set(record.symbol, record);
      }
    }

    return Array.from(latestBySymbol.values());

  } catch (err) {
    console.error('❌ Exception fetching batch analysis:', err);
    return [];
  }
}

/**
 * Clean up old analysis records
 * Keeps last 30 days of data
 */
export async function cleanupOldAnalysis(): Promise<{ success: boolean; deleted: number }> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('market_analysis')
      .delete()
      .lt('analyzed_at', thirtyDaysAgo)
      .select();

    if (error) {
      console.error('❌ Failed to cleanup old analysis:', error);
      return { success: false, deleted: 0 };
    }

    const deletedCount = data?.length || 0;
    console.log(`🧹 Cleaned up ${deletedCount} old analysis records`);

    return { success: true, deleted: deletedCount };

  } catch (err) {
    console.error('❌ Exception cleaning up analysis:', err);
    return { success: false, deleted: 0 };
  }
}

/**
 * Convert market analysis record to AI summary format
 */
export function recordToAiSummary(record: MarketAnalysisRecord): AiMarketSummary {
  return {
    rsi: {
      value: record.rsi_value,
      status: record.rsi_status as any
    },
    vwap: {
      value: record.vwap_value,
      position: record.vwap_position as any
    },
    volume: {
      status: record.volume_status as any,
      delta: record.volume_delta,
      currentVolume: record.current_volume,
      averageVolume: record.average_volume
    },
    atr: {
      value: record.atr_value,
      status: record.atr_status as any
    },
    candleSignal: {
      type: record.candle_signal_type,
      strength: record.candle_signal_strength as any
    },
    structure: {
      type: record.structure_type,
      recent: record.structure_recent
    },
    sentiment: {
      status: record.sentiment_status as any,
      confidence: record.sentiment_confidence
    },
    tradeSignal: {
      status: record.trade_signal_status as any,
      direction: record.trade_signal_direction as any,
      confidence: record.trade_signal_confidence || undefined,
      reason: record.trade_signal_reason || undefined
    },
    metadata: {
      candlesAnalyzed: record.candles_analyzed,
      timestamp: new Date(record.analyzed_at)
    }
  };
}
