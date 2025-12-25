import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY', 'NAS100', 'SPX500', 'BTCUSD', 'ETHUSD'];

interface SymbolHealth {
  symbol: string;
  lastUpdate: string | null;
  ageSeconds: number | null;
  status: 'active' | 'stale' | 'inactive' | 'no_data';
  price: number | null;
  source: string | null;
}

export const handler: Handler = async (event, context) => {
  try {
    const { data: recentPrices, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, source, created_at')
      .in('symbol', ACTIVE_SYMBOLS)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }

    const symbolHealth = new Map<string, SymbolHealth>();

    recentPrices?.forEach((price: any) => {
      if (!symbolHealth.has(price.symbol)) {
        const lastUpdate = new Date(price.created_at);
        const ageMs = Date.now() - lastUpdate.getTime();
        const ageSeconds = Math.floor(ageMs / 1000);

        let status: 'active' | 'stale' | 'inactive' | 'no_data';
        if (ageSeconds < 180) {
          status = 'active';
        } else if (ageSeconds < 600) {
          status = 'stale';
        } else {
          status = 'inactive';
        }

        symbolHealth.set(price.symbol, {
          symbol: price.symbol,
          lastUpdate: lastUpdate.toISOString(),
          ageSeconds,
          status,
          price: price.bid,
          source: price.source
        });
      }
    });

    ACTIVE_SYMBOLS.forEach(symbol => {
      if (!symbolHealth.has(symbol)) {
        symbolHealth.set(symbol, {
          symbol,
          lastUpdate: null,
          ageSeconds: null,
          status: 'no_data',
          price: null,
          source: null
        });
      }
    });

    const healthArray = Array.from(symbolHealth.values());
    const activeCount = healthArray.filter(h => h.status === 'active').length;
    const staleCount = healthArray.filter(h => h.status === 'stale').length;
    const inactiveCount = healthArray.filter(h => h.status === 'inactive').length;
    const noDataCount = healthArray.filter(h => h.status === 'no_data').length;

    let overallStatus: 'healthy' | 'degraded' | 'critical';
    if (activeCount === ACTIVE_SYMBOLS.length) {
      overallStatus = 'healthy';
    } else if (activeCount >= Math.floor(ACTIVE_SYMBOLS.length / 2)) {
      overallStatus = 'degraded';
    } else {
      overallStatus = 'critical';
    }

    const { data: pollingHistory, error: historyError } = await supabase
      .from('price_polling_health')
      .select('poll_timestamp, successful_pairs, failed_pairs')
      .order('poll_timestamp', { ascending: false })
      .limit(10);

    let lastPollTime: string | null = null;
    let recentSuccessRate: number | null = null;

    if (!historyError && pollingHistory && pollingHistory.length > 0) {
      lastPollTime = pollingHistory[0].poll_timestamp;

      const totalPairs = pollingHistory.reduce((sum, h) => sum + h.successful_pairs + h.failed_pairs, 0);
      const successfulPairs = pollingHistory.reduce((sum, h) => sum + h.successful_pairs, 0);
      recentSuccessRate = totalPairs > 0 ? (successfulPairs / totalPairs) * 100 : 0;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      },
      body: JSON.stringify({
        success: true,
        overallStatus,
        polling: {
          lastPollTime,
          recentSuccessRate: recentSuccessRate !== null ? recentSuccessRate.toFixed(1) : null
        },
        summary: {
          totalSymbols: ACTIVE_SYMBOLS.length,
          active: activeCount,
          stale: staleCount,
          inactive: inactiveCount,
          noData: noDataCount
        },
        symbols: healthArray,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('[PollingHealth] Error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
