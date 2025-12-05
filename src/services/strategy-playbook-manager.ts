/**
 * Strategy Playbook Manager
 *
 * Manages deep strategy memory and auto-updating playbooks.
 * Core responsibilities:
 * - Load active playbooks for current market conditions
 * - Track playbook usage and performance
 * - Auto-promote best-performing variants
 * - Create new playbook variants from Alpha experiments
 * - Provide playbook context for Alpha + Omega
 *
 * This system enables Pipnosis to learn which strategies work best
 * per symbol/timeframe/regime WITHOUT expensive LLM calls.
 */

import { supabase } from '../lib/supabase';
import { getRegimeBucket, getBucketFallbackChain, isValidRegimeBucket } from './regime-bucketing';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';
import type { StrategyPlan } from './llm-strategy-brain';

export interface PlaybookBaseParams {
  rr_target: number;
  sl_factor_atr: number;
  tp_factor_atr: number;
  risk_pct: number;
  entry_filters: string[];
  min_confidence?: number;
  max_exposure?: number;
}

export interface StrategyPlaybook {
  id: string;
  user_id: string;
  name: string;
  symbol: string;
  timeframe: string;
  mode: string;
  version: number;
  is_active_default: boolean;
  regime_bucket: string;
  base_params: PlaybookBaseParams;
  meta_notes: string;
  created_at: string;
  updated_at: string;
}

export interface PlaybookStats {
  id: string;
  playbook_id: string;
  trades_count: number;
  wins_count: number;
  losses_count: number;
  breakeven_count: number;
  win_rate: number;
  avg_rr: number;
  avg_pnl_r: number;
  total_pnl_r: number;
  max_drawdown_r: number;
  best_run_r: number;
  worst_run_r: number;
  score: number;
  last_used_at: string | null;
  last_promotion_check: string | null;
}

export interface PlaybookWithStats {
  playbook: StrategyPlaybook;
  stats: PlaybookStats | null;
}

export interface PlaybookContext {
  has_playbook: boolean;
  playbook?: StrategyPlaybook;
  stats?: PlaybookStats;
  compressed_summary: string; // For LLM prompts
}

class StrategyPlaybookManager {
  private readonly MIN_TRADES_FOR_PROMOTION = 15;
  private readonly SCORE_IMPROVEMENT_THRESHOLD = 10;
  private readonly PROMOTION_COOLDOWN_HOURS = 24;

  /**
   * Get active playbook for current market conditions
   */
  async getActivePlaybook(
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regimeBucket: string
  ): Promise<StrategyPlaybook | null> {
    try {
      const { data, error } = await supabase
        .from('strategy_playbook')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('mode', mode)
        .eq('regime_bucket', regimeBucket)
        .eq('is_active_default', true)
        .maybeSingle();

      if (error) {
        console.error('[Playbook] Error fetching active playbook:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Playbook] Failed to get active playbook:', error);
      return null;
    }
  }

  /**
   * Get active playbook with fallback search
   */
  async getActivePlaybookWithFallback(
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regimeBucket: string
  ): Promise<StrategyPlaybook | null> {
    // Try primary bucket first
    let playbook = await this.getActivePlaybook(userId, symbol, timeframe, mode, regimeBucket);
    if (playbook) {
      console.log(`[Playbook] Found playbook for ${regimeBucket}: ${playbook.name}`);
      return playbook;
    }

    // Try fallback chain
    const fallbackChain = getBucketFallbackChain(regimeBucket);
    console.log(`[Playbook] Trying fallback chain: ${fallbackChain.join(' → ')}`);

    for (const fallbackBucket of fallbackChain.slice(1)) {
      playbook = await this.getActivePlaybook(userId, symbol, timeframe, mode, fallbackBucket);
      if (playbook) {
        console.log(`[Playbook] Found fallback playbook: ${playbook.name} (${fallbackBucket})`);
        return playbook;
      }
    }

    console.log(`[Playbook] No playbook found for ${symbol} ${timeframe} ${mode}`);
    return null;
  }

  /**
   * Get playbook statistics
   */
  async getPlaybookStats(playbookId: string): Promise<PlaybookStats | null> {
    try {
      const { data, error } = await supabase
        .from('strategy_variant_stats')
        .select('*')
        .eq('playbook_id', playbookId)
        .maybeSingle();

      if (error) {
        console.error('[Playbook] Error fetching stats:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Playbook] Failed to get stats:', error);
      return null;
    }
  }

  /**
   * Get playbook context for LLM prompts
   */
  async getPlaybookContext(
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regime?: RegimeSnapshot,
    adversarial?: AdversarialSignal
  ): Promise<PlaybookContext> {
    const regimeBucket = getRegimeBucket(regime, adversarial);

    if (!isValidRegimeBucket(regimeBucket)) {
      return {
        has_playbook: false,
        compressed_summary: ''
      };
    }

    const playbook = await this.getActivePlaybookWithFallback(
      userId,
      symbol,
      timeframe,
      mode,
      regimeBucket
    );

    if (!playbook) {
      return {
        has_playbook: false,
        compressed_summary: ''
      };
    }

    const stats = await this.getPlaybookStats(playbook.id);

    // Build compressed summary for LLM (target: <50 tokens)
    const summary = this.buildCompressedSummary(playbook, stats);

    return {
      has_playbook: true,
      playbook,
      stats: stats || undefined,
      compressed_summary: summary
    };
  }

  /**
   * Build ultra-compressed playbook summary for LLM prompts
   */
  private buildCompressedSummary(
    playbook: StrategyPlaybook,
    stats: PlaybookStats | null
  ): string {
    if (!stats || stats.trades_count === 0) {
      return `PLAYBOOK: ${playbook.mode} (NEW, no history)`;
    }

    const parts = [
      `PLAYBOOK:`,
      `mode=${playbook.mode}`,
      `bucket=${playbook.regime_bucket}`,
      `wr=${(stats.win_rate * 100).toFixed(0)}%`,
      `avgR=${stats.avg_pnl_r.toFixed(1)}`,
      `trades=${stats.trades_count}`
    ];

    // Add R:R if available
    if (playbook.base_params.rr_target) {
      parts.push(`rr=${playbook.base_params.rr_target}`);
    }

    // Add risk if different from default
    if (playbook.base_params.risk_pct && playbook.base_params.risk_pct !== 3) {
      parts.push(`risk=${playbook.base_params.risk_pct}%`);
    }

    return parts.join('\n');
  }

  /**
   * Register playbook usage (called when strategy is selected)
   */
  async registerPlaybookUsage(
    playbookId: string,
    userId: string
  ): Promise<void> {
    try {
      // Update last_used_at in stats
      await supabase
        .from('strategy_variant_stats')
        .update({ last_used_at: new Date().toISOString() })
        .eq('playbook_id', playbookId)
        .eq('user_id', userId);
    } catch (error) {
      console.warn('[Playbook] Failed to register usage:', error);
    }
  }

  /**
   * Update playbook stats after trade closes
   */
  async updatePlaybookStats(
    playbookId: string,
    userId: string,
    tradeResult: {
      pnl_r: number;
      realized_rr: number;
      is_win: boolean;
      is_loss: boolean;
      is_breakeven: boolean;
    }
  ): Promise<void> {
    try {
      // Get current stats
      const stats = await this.getPlaybookStats(playbookId);

      if (!stats) {
        console.error('[Playbook] Stats not found for update');
        return;
      }

      // Calculate new metrics
      const newTradesCount = stats.trades_count + 1;
      const newWinsCount = stats.wins_count + (tradeResult.is_win ? 1 : 0);
      const newLossesCount = stats.losses_count + (tradeResult.is_loss ? 1 : 0);
      const newBreakevenCount = stats.breakeven_count + (tradeResult.is_breakeven ? 1 : 0);

      const newWinRate = newTradesCount > 0 ? newWinsCount / newTradesCount : 0;

      // Update average R:R (running average)
      const newAvgRR = ((stats.avg_rr * stats.trades_count) + tradeResult.realized_rr) / newTradesCount;

      // Update average PnL in R
      const newTotalPnlR = stats.total_pnl_r + tradeResult.pnl_r;
      const newAvgPnlR = newTotalPnlR / newTradesCount;

      // Update drawdown tracking (simplified)
      let newMaxDrawdownR = stats.max_drawdown_r;
      if (tradeResult.is_loss && Math.abs(tradeResult.pnl_r) > newMaxDrawdownR) {
        newMaxDrawdownR = Math.abs(tradeResult.pnl_r);
      }

      // Update best/worst runs
      const newBestRunR = Math.max(stats.best_run_r, tradeResult.pnl_r);
      const newWorstRunR = Math.min(stats.worst_run_r, tradeResult.pnl_r);

      // Calculate new score
      const newScore = this.calculateScore({
        win_rate: newWinRate,
        avg_pnl_r: newAvgPnlR,
        max_drawdown_r: newMaxDrawdownR,
        trades_count: newTradesCount
      });

      // Update stats
      await supabase
        .from('strategy_variant_stats')
        .update({
          trades_count: newTradesCount,
          wins_count: newWinsCount,
          losses_count: newLossesCount,
          breakeven_count: newBreakevenCount,
          win_rate: newWinRate,
          avg_rr: newAvgRR,
          avg_pnl_r: newAvgPnlR,
          total_pnl_r: newTotalPnlR,
          max_drawdown_r: newMaxDrawdownR,
          best_run_r: newBestRunR,
          worst_run_r: newWorstRunR,
          score: newScore,
          last_used_at: new Date().toISOString()
        })
        .eq('playbook_id', playbookId)
        .eq('user_id', userId);

      console.log(`[Playbook] Updated stats: WR=${(newWinRate*100).toFixed(0)}%, avgR=${newAvgPnlR.toFixed(2)}, score=${newScore.toFixed(1)}`);

    } catch (error) {
      console.error('[Playbook] Failed to update stats:', error);
    }
  }

  /**
   * Calculate playbook score for ranking
   */
  private calculateScore(metrics: {
    win_rate: number;
    avg_pnl_r: number;
    max_drawdown_r: number;
    trades_count: number;
  }): number {
    const { win_rate, avg_pnl_r, max_drawdown_r, trades_count } = metrics;

    // Formula: (win_rate * 50) + (avg_pnl_r * 30) - (max_drawdown_r * 10) + (min(trades, 50) * 0.3)
    const score =
      (win_rate * 50) +
      (avg_pnl_r * 30) -
      (max_drawdown_r * 10) +
      (Math.min(trades_count, 50) * 0.3);

    return Math.max(0, score);
  }

  /**
   * Evaluate and promote best playbook variants
   */
  async evaluateAndPromotePlaybooks(
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regimeBucket: string
  ): Promise<void> {
    try {
      console.log(`[Playbook] Evaluating variants for ${symbol} ${timeframe} ${mode} ${regimeBucket}`);

      // Get all playbooks for this combination
      const { data: playbooks, error: playbooksError } = await supabase
        .from('strategy_playbook')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('mode', mode)
        .eq('regime_bucket', regimeBucket);

      if (playbooksError || !playbooks || playbooks.length === 0) {
        console.log('[Playbook] No playbooks to evaluate');
        return;
      }

      // Get stats for all playbooks
      const playbooksWithStats = await Promise.all(
        playbooks.map(async (p) => ({
          playbook: p,
          stats: await this.getPlaybookStats(p.id)
        }))
      );

      // Filter to playbooks with enough trades
      const eligible = playbooksWithStats.filter(
        (pws) => pws.stats && pws.stats.trades_count >= this.MIN_TRADES_FOR_PROMOTION
      );

      if (eligible.length === 0) {
        console.log('[Playbook] No variants with enough trades for promotion');
        return;
      }

      // Sort by score descending
      eligible.sort((a, b) => (b.stats?.score || 0) - (a.stats?.score || 0));

      const topVariant = eligible[0];
      const currentActive = playbooksWithStats.find((pws) => pws.playbook.is_active_default);

      if (!currentActive) {
        // No active default, promote top variant
        await this.promotePlaybook(topVariant.playbook.id, userId, symbol, timeframe, mode, regimeBucket);
        console.log(`[Playbook] ✅ Promoted ${topVariant.playbook.name} as first active default`);
        return;
      }

      // Check if top variant is significantly better
      const currentScore = currentActive.stats?.score || 0;
      const topScore = topVariant.stats?.score || 0;
      const improvement = topScore - currentScore;

      console.log(`[Playbook] Current: ${currentActive.playbook.name} (${currentScore.toFixed(1)})`);
      console.log(`[Playbook] Top: ${topVariant.playbook.name} (${topScore.toFixed(1)}), improvement: ${improvement.toFixed(1)}`);

      // Check cooldown
      if (currentActive.stats?.last_promotion_check) {
        const lastCheck = new Date(currentActive.stats.last_promotion_check);
        const hoursSinceCheck = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
        if (hoursSinceCheck < this.PROMOTION_COOLDOWN_HOURS) {
          console.log(`[Playbook] Cooldown active (${hoursSinceCheck.toFixed(1)}h / ${this.PROMOTION_COOLDOWN_HOURS}h)`);
          return;
        }
      }

      // Promote if significantly better
      if (improvement >= this.SCORE_IMPROVEMENT_THRESHOLD && topVariant.playbook.id !== currentActive.playbook.id) {
        await this.promotePlaybook(topVariant.playbook.id, userId, symbol, timeframe, mode, regimeBucket);
        console.log(`[Playbook] ✅ Promoted ${topVariant.playbook.name} (score improved by ${improvement.toFixed(1)})`);
      } else {
        console.log(`[Playbook] No promotion needed (improvement: ${improvement.toFixed(1)} < ${this.SCORE_IMPROVEMENT_THRESHOLD})`);

        // Update last check time
        await supabase
          .from('strategy_variant_stats')
          .update({ last_promotion_check: new Date().toISOString() })
          .eq('playbook_id', currentActive.playbook.id)
          .eq('user_id', userId);
      }

    } catch (error) {
      console.error('[Playbook] Error during evaluation:', error);
    }
  }

  /**
   * Promote a playbook to active default
   */
  private async promotePlaybook(
    playbookId: string,
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regimeBucket: string
  ): Promise<void> {
    try {
      // Deactivate current active defaults
      await supabase
        .from('strategy_playbook')
        .update({ is_active_default: false })
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('mode', mode)
        .eq('regime_bucket', regimeBucket)
        .eq('is_active_default', true);

      // Activate new default
      await supabase
        .from('strategy_playbook')
        .update({ is_active_default: true })
        .eq('id', playbookId)
        .eq('user_id', userId);

      // Update promotion check time
      await supabase
        .from('strategy_variant_stats')
        .update({ last_promotion_check: new Date().toISOString() })
        .eq('playbook_id', playbookId)
        .eq('user_id', userId);

    } catch (error) {
      console.error('[Playbook] Error promoting playbook:', error);
      throw error;
    }
  }

  /**
   * Create new playbook variant
   */
  async createPlaybookVariant(
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regimeBucket: string,
    baseParams: PlaybookBaseParams,
    metaNotes?: string
  ): Promise<string | null> {
    try {
      // Get max version for this combination
      const { data: existing } = await supabase
        .from('strategy_playbook')
        .select('version')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('mode', mode)
        .eq('regime_bucket', regimeBucket)
        .order('version', { ascending: false })
        .limit(1);

      const maxVersion = existing && existing.length > 0 ? existing[0].version : 0;
      const newVersion = maxVersion + 1;

      const name = `${mode}_${timeframe}_v${newVersion}`;

      // Create playbook
      const { data: playbook, error: playbookError } = await supabase
        .from('strategy_playbook')
        .insert({
          user_id: userId,
          name,
          symbol,
          timeframe,
          mode,
          version: newVersion,
          is_active_default: newVersion === 1, // First variant is default
          regime_bucket: regimeBucket,
          base_params: baseParams,
          meta_notes: metaNotes || ''
        })
        .select()
        .single();

      if (playbookError || !playbook) {
        console.error('[Playbook] Error creating playbook:', playbookError);
        return null;
      }

      // Create stats entry
      await supabase
        .from('strategy_variant_stats')
        .insert({
          playbook_id: playbook.id,
          user_id: userId,
          symbol,
          timeframe,
          mode,
          regime_bucket: regimeBucket
        });

      console.log(`[Playbook] ✅ Created new variant: ${name}`);
      return playbook.id;

    } catch (error) {
      console.error('[Playbook] Failed to create variant:', error);
      return null;
    }
  }

  /**
   * Check if playbook variant already exists with similar params
   */
  async findSimilarPlaybook(
    userId: string,
    symbol: string,
    timeframe: string,
    mode: string,
    regimeBucket: string,
    baseParams: PlaybookBaseParams
  ): Promise<StrategyPlaybook | null> {
    try {
      const { data: playbooks } = await supabase
        .from('strategy_playbook')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('mode', mode)
        .eq('regime_bucket', regimeBucket);

      if (!playbooks || playbooks.length === 0) {
        return null;
      }

      // Find playbook with similar params
      for (const p of playbooks) {
        if (this.areParamsSimilar(p.base_params, baseParams)) {
          return p;
        }
      }

      return null;
    } catch (error) {
      console.error('[Playbook] Error finding similar playbook:', error);
      return null;
    }
  }

  /**
   * Check if two param sets are similar enough to be considered same variant
   */
  private areParamsSimilar(params1: PlaybookBaseParams, params2: PlaybookBaseParams): boolean {
    const rrDiff = Math.abs(params1.rr_target - params2.rr_target);
    const slDiff = Math.abs(params1.sl_factor_atr - params2.sl_factor_atr);
    const tpDiff = Math.abs(params1.tp_factor_atr - params2.tp_factor_atr);
    const riskDiff = Math.abs(params1.risk_pct - params2.risk_pct);

    // Consider similar if differences are small
    return (
      rrDiff < 0.3 &&
      slDiff < 0.2 &&
      tpDiff < 0.3 &&
      riskDiff < 0.5
    );
  }
}

export const strategyPlaybookManager = new StrategyPlaybookManager();
