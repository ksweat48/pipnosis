/**
 * Alpha Hunter Learning Context Service
 *
 * PURPOSE: Feed Alpha rich, actionable learning intelligence before each trade.
 * This is the "sharpen the aim" system — not the "slow the trigger" system.
 *
 * GOVERNANCE:
 * - All output is ADVISORY CONTEXT only — pure information for Alpha's reasoning
 * - Nothing here gates, blocks, cooldowns, or restricts trading
 * - Alpha reads this the way a sniper reads wind data — context that improves the shot
 * - Losses feed refinement of WHEN and HOW to enter, never WHETHER to enter
 *
 * WHAT THIS PROVIDES:
 * 1. Loss pattern clustering — what setups fail on this symbol and why
 * 2. Entry mode calibration — which entry modes yield best R:R in current regime
 * 3. Optimal threshold self-awareness — Alpha's historical accuracy by conviction tier
 * 4. Near-miss pattern recognition — where Alpha enters slightly early vs ideal
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface HunterLearningContext {
  lossPatternAdvisory: string | null;
  entryModeCalibration: string | null;
  thresholdSelfAwareness: string | null;
  nearMissPatterns: string | null;
}

interface LossTrade {
  direction: string | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  profit_loss: number | null;
  entry_mode: string | null;
  alpha_style: string | null;
  created_at: string | null;
  close_reason: string | null;
}

interface EntryModeStat {
  entry_mode: string;
  total: number;
  wins: number;
  win_rate: number;
  avg_r: number;
  full_tp_count: number;
}

class AlphaHunterLearningContextService {
  /**
   * Build the full hunter learning context for a given user and symbol.
   * All fields are optional — returns null strings if insufficient data.
   * Never throws — always safe to call before trade decisions.
   */
  async buildContext(userId: string, symbol: string, tradeStyle?: string): Promise<HunterLearningContext> {
    const [lossPatternAdvisory, entryModeCalibration, thresholdSelfAwareness, nearMissPatterns] = await Promise.all([
      this.buildLossPatternAdvisory(userId, symbol).catch(() => null),
      this.buildEntryModeCalibration(userId, symbol, tradeStyle).catch(() => null),
      this.buildThresholdSelfAwareness(userId).catch(() => null),
      this.buildNearMissPatterns(userId, symbol).catch(() => null),
    ]);

    return { lossPatternAdvisory, entryModeCalibration, thresholdSelfAwareness, nearMissPatterns };
  }

  /**
   * Format the full context into a single prompt block.
   * Returns empty string if no data available.
   */
  formatForPrompt(ctx: HunterLearningContext): string {
    const sections: string[] = [];

    if (ctx.lossPatternAdvisory) {
      sections.push(ctx.lossPatternAdvisory);
    }

    if (ctx.entryModeCalibration) {
      sections.push(ctx.entryModeCalibration);
    }

    if (ctx.thresholdSelfAwareness) {
      sections.push(ctx.thresholdSelfAwareness);
    }

    if (ctx.nearMissPatterns) {
      sections.push(ctx.nearMissPatterns);
    }

    if (sections.length === 0) return '';

    return '\n' + sections.join('\n') + '\n';
  }

  /**
   * Loss Pattern Advisory: Cluster recent losses by common characteristics
   * to help Alpha identify setup types and timing that historically underperform
   * on this specific symbol. Purely informational — refines timing and entry
   * quality selection, never blocks a trade.
   */
  private async buildLossPatternAdvisory(userId: string, symbol: string): Promise<string | null> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: lossTrades, error } = await supabase
      .from('goal_session_trades')
      .select('direction, close_reason, entry_price, stop_loss, take_profit, profit_loss, entry_mode, alpha_style, created_at')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .eq('status', 'closed')
      .lt('profit_loss', 0)
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(15);

    if (error || !lossTrades || lossTrades.length < 3) return null;

    const losses = lossTrades as LossTrade[];

    const directionCounts: Record<string, number> = {};
    const closeReasonCounts: Record<string, number> = {};
    const entryModeCounts: Record<string, number> = {};

    for (const trade of losses) {
      if (trade.direction) {
        directionCounts[trade.direction] = (directionCounts[trade.direction] || 0) + 1;
      }
      if (trade.close_reason) {
        const reason = trade.close_reason.replace(/_/g, ' ');
        closeReasonCounts[reason] = (closeReasonCounts[reason] || 0) + 1;
      }
      if (trade.entry_mode) {
        entryModeCounts[trade.entry_mode] = (entryModeCounts[trade.entry_mode] || 0) + 1;
      }
    }

    const lines: string[] = [];
    lines.push(`LOSS PATTERN INTELLIGENCE (${symbol} — last 30 days, ${losses.length} losses — context only, not a gate):`);

    const topCloseReason = Object.entries(closeReasonCounts).sort((a, b) => b[1] - a[1])[0];
    if (topCloseReason && topCloseReason[1] >= 2) {
      lines.push(`  Most common exit: "${topCloseReason[0]}" (${topCloseReason[1]}/${losses.length} losses)`);
    }

    const topDirection = Object.entries(directionCounts).sort((a, b) => b[1] - a[1])[0];
    if (topDirection && topDirection[1] >= 3) {
      const pct = Math.round((topDirection[1] / losses.length) * 100);
      lines.push(`  Loss direction cluster: ${topDirection[0].toUpperCase()} trades (${pct}% of losses)`);
    }

    const topEntryMode = Object.entries(entryModeCounts).sort((a, b) => b[1] - a[1])[0];
    if (topEntryMode && topEntryMode[1] >= 2) {
      lines.push(`  Entry mode in losses: ${topEntryMode[0].replace(/_/g, ' ')} used in ${topEntryMode[1]}/${losses.length} losses`);
    }

    lines.push('  Use this to refine WHEN and HOW to enter — a clean structural setup remains valid.');

    return lines.join('\n');
  }

  /**
   * Entry Mode Calibration: How do different entry modes (execute_now, wait_pullback,
   * push_confirmation) perform on this symbol in recent history?
   * Alpha uses this to select the highest-R-expectancy entry mode for the current setup.
   */
  private async buildEntryModeCalibration(userId: string, symbol: string, tradeStyle?: string): Promise<string | null> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    let query = supabase
      .from('goal_session_trades')
      .select('entry_mode, profit_loss, take_profit, stop_loss, entry_price, close_reason')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .eq('status', 'closed')
      .not('entry_mode', 'is', null)
      .gte('created_at', ninetyDaysAgo)
      .limit(100);

    if (tradeStyle) {
      query = query.eq('alpha_style', tradeStyle);
    }

    const { data: trades, error } = await query;
    if (error || !trades || trades.length < 5) return null;

    const modeStats: Record<string, EntryModeStat> = {};

    for (const trade of trades) {
      const mode = trade.entry_mode || 'unknown';
      if (!modeStats[mode]) {
        modeStats[mode] = { entry_mode: mode, total: 0, wins: 0, win_rate: 0, avg_r: 0, full_tp_count: 0 };
      }

      const stat = modeStats[mode];
      stat.total++;

      const pnl = Number(trade.profit_loss || 0);
      if (pnl > 0) stat.wins++;

      const entry = Number(trade.entry_price || 0);
      const sl = Number(trade.stop_loss || 0);
      const tp = Number(trade.take_profit || 0);

      if (entry > 0 && sl > 0 && Math.abs(entry - sl) > 0) {
        const riskPips = Math.abs(entry - sl);
        const actualPips = pnl >= 0 ? Math.min(pnl / (entry > 0 ? 1 : 1), Math.abs(tp - entry)) : -riskPips;
        const rValue = actualPips / riskPips;
        stat.avg_r = (stat.avg_r * (stat.total - 1) + rValue) / stat.total;
      }

      const closeReason = trade.close_reason || '';
      if (closeReason.includes('take_profit') || closeReason.includes('tp_full') || closeReason === 'take_profit_2') {
        stat.full_tp_count++;
      }
    }

    const validModes = Object.values(modeStats).filter(s => s.total >= 3);
    if (validModes.length < 2) return null;

    for (const stat of validModes) {
      stat.win_rate = stat.wins / stat.total;
    }

    validModes.sort((a, b) => b.win_rate - a.win_rate);

    const lines: string[] = [];
    const styleLabel = tradeStyle ? ` (${tradeStyle})` : '';
    lines.push(`ENTRY MODE CALIBRATION (${symbol}${styleLabel}, last 90 days — advisory context):`);

    for (const stat of validModes) {
      const wrLabel = stat.win_rate >= 0.65 ? 'strong edge'
        : stat.win_rate >= 0.55 ? 'positive edge'
        : stat.win_rate >= 0.45 ? 'neutral'
        : 'historically weak';
      const fullTpPct = stat.total > 0 ? Math.round((stat.full_tp_count / stat.total) * 100) : 0;
      const modeName = stat.entry_mode.replace(/_/g, ' ');
      lines.push(`  ${modeName}: ${wrLabel} (${stat.wins}W/${stat.total - stat.wins}L, full_tp=${fullTpPct}%)`);
    }

    lines.push('  Select entry mode based on current structure quality — these are historical tendencies, not rules.');

    return lines.join('\n');
  }

  /**
   * Threshold Self-Awareness: How well does Alpha's conviction level map to actual outcomes?
   * Shows the difference between calling a setup at 80% vs 60% conviction — so Alpha can
   * self-calibrate conviction RATINGS over time (not restrict trade execution).
   */
  private async buildThresholdSelfAwareness(userId: string): Promise<string | null> {
    const { data: prefs } = await supabase
      .from('user_trading_preferences')
      .select('min_confidence_threshold')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: analysis } = await supabase
      .from('ai_trade_analysis')
      .select('entry_confidence, outcome')
      .eq('user_id', userId)
      .not('entry_confidence', 'is', null)
      .order('entry_time', { ascending: false })
      .limit(50);

    if (!analysis || analysis.length < 15) return null;

    const buckets: Record<string, { wins: number; total: number }> = {
      '50-60': { wins: 0, total: 0 },
      '60-70': { wins: 0, total: 0 },
      '70-80': { wins: 0, total: 0 },
      '80+': { wins: 0, total: 0 },
    };

    for (const row of analysis) {
      const conf = Number(row.entry_confidence || 0);
      const won = row.outcome === 'win';

      let bucket: string;
      if (conf >= 80) bucket = '80+';
      else if (conf >= 70) bucket = '70-80';
      else if (conf >= 60) bucket = '60-70';
      else bucket = '50-60';

      buckets[bucket].total++;
      if (won) buckets[bucket].wins++;
    }

    const validBuckets = Object.entries(buckets).filter(([, s]) => s.total >= 5);
    if (validBuckets.length < 2) return null;

    const optimalThreshold = prefs?.min_confidence_threshold;
    const lines: string[] = [];
    lines.push(`CONVICTION CALIBRATION (your own historical accuracy — no threshold gates, advisory only):`);

    for (const [range, stat] of validBuckets) {
      const wr = Math.round((stat.wins / stat.total) * 100);
      const edgeLabel = wr >= 65 ? 'strong edge'
        : wr >= 55 ? 'positive edge'
        : wr >= 45 ? 'neutral'
        : 'historically weak';
      lines.push(`  Conviction ${range}%: ${edgeLabel} (${stat.wins}W/${stat.total - stat.wins}L, n=${stat.total})`);
    }

    if (optimalThreshold) {
      lines.push(`  Your historically optimal conviction level: ${optimalThreshold}%+ (calibrated from ${analysis.length} trades)`);
    }

    lines.push('  This is self-knowledge — use it to calibrate conviction ratings honestly, not to restrict trading.');

    return lines.join('\n');
  }

  /**
   * Near-Miss Pattern Recognition: Detect when Alpha enters too early (price
   * comes back close to SL before eventually hitting TP) or exits too early.
   * Informs TIMING refinement within a setup, not setup rejection.
   */
  private async buildNearMissPatterns(userId: string, symbol: string): Promise<string | null> {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data: trades, error } = await supabase
      .from('goal_session_trades')
      .select('profit_loss, entry_price, stop_loss, take_profit, close_reason, tp1_hit, tp2_hit')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .eq('status', 'closed')
      .lt('profit_loss', 0)
      .gte('created_at', sixtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error || !trades || trades.length < 3) return null;

    let tightSlCount = 0;
    let earlyExitCount = 0;
    let tp1OnlyCount = 0;

    for (const trade of trades) {
      const entry = Number(trade.entry_price || 0);
      const sl = Number(trade.stop_loss || 0);
      const tp = Number(trade.take_profit || 0);
      const pnl = Number(trade.profit_loss || 0);

      if (entry > 0 && sl > 0 && tp > 0) {
        const riskPips = Math.abs(entry - sl);
        const rewardPips = Math.abs(tp - entry);
        if (rewardPips > 0 && riskPips / rewardPips < 0.4) {
          tightSlCount++;
        }
      }

      const closeReason = trade.close_reason || '';
      if (closeReason === 'manual' && pnl < 0) earlyExitCount++;
      if (trade.tp1_hit && !trade.tp2_hit) tp1OnlyCount++;
    }

    const lines: string[] = [];
    let hasData = false;

    if (tightSlCount >= 2) {
      lines.push(`NEAR-MISS PATTERNS (${symbol}, last 60 days — timing refinement context):`);
      lines.push(`  ${tightSlCount}/${trades.length} recent losses had tight SL relative to TP — consider wider structure-based SL zone`);
      hasData = true;
    }

    if (earlyExitCount >= 2) {
      if (!hasData) {
        lines.push(`NEAR-MISS PATTERNS (${symbol}, last 60 days — timing refinement context):`);
        hasData = true;
      }
      lines.push(`  ${earlyExitCount} manual exits before SL — monitor if early exits are protecting capital or leaving R on table`);
    }

    if (tp1OnlyCount >= 2) {
      if (!hasData) {
        lines.push(`NEAR-MISS PATTERNS (${symbol}, last 60 days — timing refinement context):`);
        hasData = true;
      }
      lines.push(`  ${tp1OnlyCount} trades hit TP1 but not TP2 — consider TP2 reachability when setting dual-TP targets`);
    }

    if (!hasData || lines.length <= 1) return null;

    lines.push('  Use these to sharpen entry timing and TP geometry — not to avoid the setup type.');
    return lines.join('\n');
  }
}

export const alphaHunterLearningContext = new AlphaHunterLearningContextService();
