import { supabase } from '../lib/supabase';

interface RRBucket {
  rr_range: string;
  min_rr: number;
  max_rr: number;
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  avg_fill_time_hours: number;
  profitability: number;
}

interface SLWidthAnalysis {
  sl_range: string;
  min_sl_pips: number;
  max_sl_pips: number;
  total_trades: number;
  stop_outs: number;
  stop_out_rate: number;
  avg_market_noise_pips: number;
  success_rate: number;
}

class RRSuccessTracker {
  async getRRPerformanceMatrix(userId: string, symbol?: string): Promise<RRBucket[]> {
    try {
      let query = supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['closed', 'tp_hit', 'sl_hit']);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: trades, error } = await query;

      if (error || !trades) {
        console.error('[RR Tracker] Error fetching trades:', error);
        return [];
      }

      const buckets: Map<string, RRBucket> = new Map();

      for (const trade of trades) {
        if (!trade.entry_price || !trade.stop_loss || !trade.take_profit) continue;

        const slDistance = Math.abs(trade.entry_price - trade.stop_loss);
        const tpDistance = Math.abs(trade.take_profit - trade.entry_price);
        const rr = slDistance > 0 ? tpDistance / slDistance : 0;

        if (rr === 0) continue;

        let bucketKey: string;
        let minRR: number;
        let maxRR: number;

        if (rr < 1.5) {
          bucketKey = '1.0-1.5';
          minRR = 1.0;
          maxRR = 1.5;
        } else if (rr < 2.5) {
          bucketKey = '1.5-2.5';
          minRR = 1.5;
          maxRR = 2.5;
        } else if (rr < 4.0) {
          bucketKey = '2.5-4.0';
          minRR = 2.5;
          maxRR = 4.0;
        } else if (rr < 7.0) {
          bucketKey = '4.0-7.0';
          minRR = 4.0;
          maxRR = 7.0;
        } else {
          bucketKey = '7.0+';
          minRR = 7.0;
          maxRR = 100.0;
        }

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            rr_range: bucketKey,
            min_rr: minRR,
            max_rr: maxRR,
            total_trades: 0,
            wins: 0,
            losses: 0,
            win_rate: 0,
            avg_fill_time_hours: 0,
            profitability: 0
          });
        }

        const bucket = buckets.get(bucketKey)!;
        bucket.total_trades++;

        const isWin = trade.status === 'tp_hit' || (trade.pnl && trade.pnl > 0);
        if (isWin) {
          bucket.wins++;
        } else {
          bucket.losses++;
        }

        if (trade.opened_at && trade.closed_at) {
          const fillTime = (new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime()) / (1000 * 60 * 60);
          bucket.avg_fill_time_hours = (bucket.avg_fill_time_hours * (bucket.total_trades - 1) + fillTime) / bucket.total_trades;
        }
      }

      const results: RRBucket[] = [];
      for (const bucket of buckets.values()) {
        bucket.win_rate = bucket.total_trades > 0 ? (bucket.wins / bucket.total_trades) * 100 : 0;
        bucket.profitability = bucket.wins - bucket.losses;
        results.push(bucket);
      }

      results.sort((a, b) => a.min_rr - b.min_rr);

      return results;
    } catch (error) {
      console.error('[RR Tracker] Error calculating performance matrix:', error);
      return [];
    }
  }

  async getSLWidthAnalysis(userId: string, symbol?: string): Promise<SLWidthAnalysis[]> {
    try {
      let query = supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['closed', 'tp_hit', 'sl_hit']);

      if (symbol) {
        query = query.eq('symbol', symbol);
      }

      const { data: trades, error } = await query;

      if (error || !trades) {
        console.error('[RR Tracker] Error fetching trades:', error);
        return [];
      }

      const buckets: Map<string, SLWidthAnalysis> = new Map();

      for (const trade of trades) {
        if (!trade.entry_price || !trade.stop_loss || !trade.symbol) continue;

        // ✅ SSOT FIX: Use calculatePipDistance() instead of hardcoded / 0.0001
        const { calculatePipDistance } = await import('../utils/currencyHelpers');
        const slPips = calculatePipDistance(trade.symbol, trade.entry_price, trade.stop_loss);

        let bucketKey: string;
        let minSL: number;
        let maxSL: number;

        if (slPips < 5) {
          bucketKey = '0-5 pips';
          minSL = 0;
          maxSL = 5;
        } else if (slPips < 10) {
          bucketKey = '5-10 pips';
          minSL = 5;
          maxSL = 10;
        } else if (slPips < 20) {
          bucketKey = '10-20 pips';
          minSL = 10;
          maxSL = 20;
        } else if (slPips < 40) {
          bucketKey = '20-40 pips';
          minSL = 20;
          maxSL = 40;
        } else {
          bucketKey = '40+ pips';
          minSL = 40;
          maxSL = 1000;
        }

        if (!buckets.has(bucketKey)) {
          buckets.set(bucketKey, {
            sl_range: bucketKey,
            min_sl_pips: minSL,
            max_sl_pips: maxSL,
            total_trades: 0,
            stop_outs: 0,
            stop_out_rate: 0,
            avg_market_noise_pips: 0,
            success_rate: 0
          });
        }

        const bucket = buckets.get(bucketKey)!;
        bucket.total_trades++;

        const stoppedOut = trade.status === 'sl_hit' || (trade.pnl && trade.pnl < 0);
        if (stoppedOut) {
          bucket.stop_outs++;
        }
      }

      const results: SLWidthAnalysis[] = [];
      for (const bucket of buckets.values()) {
        bucket.stop_out_rate = bucket.total_trades > 0 ? (bucket.stop_outs / bucket.total_trades) * 100 : 0;
        bucket.success_rate = 100 - bucket.stop_out_rate;
        results.push(bucket);
      }

      results.sort((a, b) => a.min_sl_pips - b.min_sl_pips);

      return results;
    } catch (error) {
      console.error('[RR Tracker] Error calculating SL width analysis:', error);
      return [];
    }
  }

  async getRecentPerformanceSummary(userId: string, symbol?: string, last_n_trades: number = 20): Promise<string> {
    try {
      const rrMatrix = await this.getRRPerformanceMatrix(userId, symbol);
      const slAnalysis = await this.getSLWidthAnalysis(userId, symbol);

      const parts: string[] = [];
      parts.push('📊 YOUR HISTORICAL PERFORMANCE ANALYSIS:');
      parts.push('');

      if (rrMatrix.length > 0) {
        parts.push('R:R RATIO SUCCESS RATES:');
        for (const bucket of rrMatrix) {
          if (bucket.total_trades >= 3) {
            const emoji = bucket.win_rate >= 50 ? '✅' : bucket.win_rate >= 30 ? '⚠️' : '❌';
            parts.push(`${emoji} ${bucket.rr_range} R:R: ${bucket.win_rate.toFixed(0)}% WR (${bucket.wins}W/${bucket.losses}L, avg ${bucket.avg_fill_time_hours.toFixed(1)}h to fill)`);
          }
        }
        parts.push('');
      }

      if (slAnalysis.length > 0) {
        parts.push('STOP LOSS WIDTH EFFECTIVENESS:');
        for (const bucket of slAnalysis) {
          if (bucket.total_trades >= 3) {
            const emoji = bucket.success_rate >= 60 ? '✅' : bucket.success_rate >= 40 ? '⚠️' : '❌';
            parts.push(`${emoji} ${bucket.sl_range}: ${bucket.success_rate.toFixed(0)}% survive rate (${bucket.stop_outs}/${bucket.total_trades} stopped out)`);
          }
        }
        parts.push('');
      }

      const bestRR = rrMatrix.filter(b => b.total_trades >= 3).sort((a, b) => b.win_rate - a.win_rate)[0];
      const worstRR = rrMatrix.filter(b => b.total_trades >= 3).sort((a, b) => a.win_rate - b.win_rate)[0];

      if (bestRR && worstRR) {
        parts.push('KEY INSIGHTS:');
        parts.push(`✅ Best performing: ${bestRR.rr_range} R:R (${bestRR.win_rate.toFixed(0)}% success)`);
        parts.push(`❌ Worst performing: ${worstRR.rr_range} R:R (${worstRR.win_rate.toFixed(0)}% success)`);
        parts.push('');
      }

      const tightSLs = slAnalysis.find(b => b.sl_range === '0-5 pips');
      if (tightSLs && tightSLs.total_trades >= 3) {
        parts.push(`⚠️ WARNING: ${tightSLs.stop_out_rate.toFixed(0)}% of your trades with <5 pip SLs get stopped out by noise`);
        parts.push('');
      }

      return parts.join('\n');
    } catch (error) {
      console.error('[RR Tracker] Error generating performance summary:', error);
      return '📊 Performance analysis unavailable';
    }
  }
}

export const rrSuccessTracker = new RRSuccessTracker();
