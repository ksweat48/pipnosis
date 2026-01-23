import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { WATCHLIST } from '@/config/watchlist';

interface SessionInfo {
  name: 'London' | 'New York' | 'Asian';
  startHour: number;
  endHour: number;
}

interface BestPair {
  symbol: string;
  confidence: number;
  reasoning: string;
}

const SESSIONS: SessionInfo[] = [
  { name: 'London', startHour: 3, endHour: 11 },
  { name: 'New York', startHour: 8, endHour: 16 },
  { name: 'Asian', startHour: 19, endHour: 3 },
];

const SESSION_PAIR_PREFERENCES: Record<string, string[]> = {
  London: ['XAUUSD', 'GBPUSD', 'EURUSD', 'GBPJPY', 'EURGBP'],
  'New York': ['US30', 'SPX500', 'XAUUSD', 'EURUSD', 'USDJPY'],
  Asian: ['USDJPY', 'AUDUSD', 'NZDUSD', 'EURJPY', 'GBPJPY'],
};

const SESSION_REASONING: Record<string, Record<string, string>> = {
  London: {
    XAUUSD: 'High volatility during European open, strong directional moves',
    GBPUSD: 'Peak liquidity for GBP pairs, central bank activity',
    EURUSD: 'European economic data releases, highest trading volume',
    GBPJPY: 'Cross-pair volatility from both EUR and GBP activity',
    EURGBP: 'European session captures both currencies at peak liquidity',
  },
  'New York': {
    US30: 'US stock market open, institutional trading activity',
    SPX500: 'Major equity moves during US trading hours',
    XAUUSD: 'Gold reacts to US data and Fed policy expectations',
    EURUSD: 'Overlapping EU/US sessions create high liquidity',
    USDJPY: 'US treasury yields and risk sentiment drive moves',
  },
  Asian: {
    USDJPY: 'Tokyo market activity, Japanese economic data',
    AUDUSD: 'Australian session liquidity, commodity correlation',
    NZDUSD: 'New Zealand data releases, agricultural markets',
    EURJPY: 'Cross-pair benefits from Asian JPY activity',
    GBPJPY: 'Strong overnight moves as London traders close positions',
  },
};

class TradingSessionMonitorService {
  private getCurrentSession(): SessionInfo | null {
    const now = new Date();
    const estTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const currentHour = estTime.getHours();

    for (const session of SESSIONS) {
      if (session.name === 'Asian') {
        if (currentHour >= session.startHour || currentHour < session.endHour) {
          return session;
        }
      } else {
        if (currentHour >= session.startHour && currentHour < session.endHour) {
          return session;
        }
      }
    }

    return null;
  }

  private async analyzeMarketCondition(): Promise<{
    condition: 'trending' | 'ranging' | 'volatile' | 'quiet' | 'sideways';
    isTradable: boolean;
  }> {
    try {
      const symbols = WATCHLIST.slice(0, 10);
      let volatileCount = 0;
      let trendingCount = 0;
      let quietCount = 0;

      for (const symbol of symbols) {
        const { data: candles } = await supabase
          .from('forex_candles_best')
          .select('high, low, close, open')
          .eq('symbol', symbol)
          .eq('timeframe', '1h')
          .order('timestamp', { ascending: false })
          .limit(24);

        if (candles && candles.length >= 20) {
          const ranges = candles.map((c) => parseFloat(c.high) - parseFloat(c.low));
          const avgRange = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
          const recentRange = ranges[0];

          if (recentRange > avgRange * 1.5) volatileCount++;
          if (recentRange < avgRange * 0.5) quietCount++;

          const closes = candles.map((c) => parseFloat(c.close));
          const trend = closes[0] - closes[closes.length - 1];
          if (Math.abs(trend) > avgRange * 3) trendingCount++;
        }
      }

      const totalChecked = symbols.length;
      const volatilePct = volatileCount / totalChecked;
      const trendingPct = trendingCount / totalChecked;
      const quietPct = quietCount / totalChecked;

      if (quietPct > 0.6) {
        return { condition: 'quiet', isTradable: false };
      }

      if (trendingPct > 0.4 && volatilePct > 0.3) {
        return { condition: 'volatile', isTradable: true };
      }

      if (trendingPct > 0.5) {
        return { condition: 'trending', isTradable: true };
      }

      if (volatilePct < 0.3 && trendingPct < 0.3) {
        return { condition: 'sideways', isTradable: false };
      }

      return { condition: 'ranging', isTradable: true };
    } catch (error) {
      logger.error('[TradingSessionMonitor] Error analyzing market condition', { error });
      return { condition: 'ranging', isTradable: true };
    }
  }

  async updateSessionIntelligence(): Promise<void> {
    try {
      const currentSession = this.getCurrentSession();

      if (!currentSession) {
        logger.warn('[TradingSessionMonitor] No active session detected');
        return;
      }

      const { condition, isTradable } = await this.analyzeMarketCondition();

      const preferredPairs = SESSION_PAIR_PREFERENCES[currentSession.name] || [];
      const bestPairs: BestPair[] = [];

      if (isTradable) {
        for (const symbol of preferredPairs.slice(0, 5)) {
          const reasoning = SESSION_REASONING[currentSession.name]?.[symbol] || 'Recommended for this session';
          const baseConfidence = preferredPairs.indexOf(symbol) === 0 ? 85 : 75 - preferredPairs.indexOf(symbol) * 5;

          bestPairs.push({
            symbol,
            confidence: Math.max(60, baseConfidence),
            reasoning,
          });
        }
      }

      let recommendationText: string;
      if (!isTradable) {
        if (condition === 'quiet') {
          recommendationText = `${currentSession.name} session is unusually quiet. Market trading sideways with low volatility. Wait for better setups.`;
        } else {
          recommendationText = `Market trading sideways during ${currentSession.name} session. No clear directional bias. Wait for breakout or increased volatility.`;
        }
      } else {
        recommendationText = `${currentSession.name} session ${
          currentSession.startHour
        }:00-${currentSession.endHour}:00 EST. Market condition: ${condition}. Best pairs: ${bestPairs
          .slice(0, 3)
          .map((p) => p.symbol)
          .join(', ')}.`;
      }

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      const { error } = await supabase.from('session_intelligence_data').insert({
        session_name: currentSession.name,
        session_start_hour: currentSession.startHour,
        session_end_hour: currentSession.endHour,
        best_pairs: bestPairs,
        market_condition: condition,
        is_tradable: isTradable,
        recommendation_text: recommendationText,
        expires_at: expiresAt.toISOString(),
      });

      if (error) {
        logger.error('[TradingSessionMonitor] Failed to insert session data', { error });
      } else {
        logger.info('[TradingSessionMonitor] Session intelligence updated', {
          session: currentSession.name,
          isTradable,
          pairsCount: bestPairs.length,
        });
      }
    } catch (error) {
      logger.error('[TradingSessionMonitor] Error updating session intelligence', { error });
    }
  }

  async getCurrentSessionData(): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('session_intelligence_data')
        .select('*')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('[TradingSessionMonitor] Failed to fetch current session', { error });
        return null;
      }

      return data;
    } catch (error) {
      logger.error('[TradingSessionMonitor] Error fetching current session', { error });
      return null;
    }
  }
}

export const tradingSessionMonitorService = new TradingSessionMonitorService();
