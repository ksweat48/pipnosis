import { supabase } from '../lib/supabase';
import { correlatedLossTracker } from './correlated-loss-tracker';

interface AvoidListEntry {
  id: string;
  reason: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  addedAt: Date;
  expiresAt?: Date;
  isActive: boolean;
  conditions: any;
  occurrences: number;
}

interface TradeValidationResult {
  canTrade: boolean;
  blockingReasons: string[];
  warnings: string[];
  riskScore: number; // 0-100, higher = riskier
}

class DynamicAvoidList {
  private readonly HIGH_RISK_THRESHOLD = 70;
  private readonly CRITICAL_RISK_THRESHOLD = 85;

  async validateTrade(
    userId: string,
    symbol: string,
    direction: 'buy' | 'sell',
    context: {
      hour?: number;
      setup?: string;
      confidence?: number;
      regime?: string;
    }
  ): Promise<TradeValidationResult> {
    console.log(`[Dynamic Avoid List] Validating ${direction} trade for ${symbol}`);

    const blockingReasons: string[] = [];
    const warnings: string[] = [];
    let riskScore = 0;

    const antiCorrelationCheck = await correlatedLossTracker.shouldAvoidTrade(
      userId,
      symbol,
      direction,
      context.hour || 0,
      context.setup
    );

    if (antiCorrelationCheck.shouldAvoid) {
      blockingReasons.push(...antiCorrelationCheck.reasons);
      riskScore += 40;
    }

    const activeAvoids = await this.getActiveAvoidListEntries(userId);

    for (const entry of activeAvoids) {
      const matches = this.matchesAvoidConditions(
        entry,
        symbol,
        direction,
        context
      );

      if (matches) {
        if (entry.severity === 'critical') {
          blockingReasons.push(`CRITICAL: ${entry.reason}`);
          riskScore += 50;
        } else if (entry.severity === 'high') {
          blockingReasons.push(`HIGH RISK: ${entry.reason}`);
          riskScore += 30;
        } else if (entry.severity === 'medium') {
          warnings.push(`MEDIUM RISK: ${entry.reason}`);
          riskScore += 15;
        } else {
          warnings.push(`LOW RISK: ${entry.reason}`);
          riskScore += 5;
        }
      }
    }

    const streakCheck = await this.checkLossStreak(userId, symbol);
    if (streakCheck.consecutiveLosses >= 3) {
      warnings.push(
        `${streakCheck.consecutiveLosses} consecutive losses on ${symbol}. ` +
        `Consider taking a break or reducing position size.`
      );
      riskScore += 20;
    }

    const dailyLossCheck = await this.checkDailyLossLimit(userId);
    if (dailyLossCheck.approachingLimit) {
      warnings.push(
        `Daily loss at ${dailyLossCheck.lossPercent.toFixed(0)}% of limit. ` +
        `Consider stopping for the day.`
      );
      riskScore += 15;
    }

    if (dailyLossCheck.limitExceeded) {
      blockingReasons.push(
        `DAILY LOSS LIMIT EXCEEDED: ${dailyLossCheck.lossPercent.toFixed(0)}% of limit reached. ` +
        `Stop trading for today.`
      );
      riskScore += 50;
    }

    riskScore = Math.min(100, riskScore);

    const canTrade = blockingReasons.length === 0 && riskScore < this.CRITICAL_RISK_THRESHOLD;

    return {
      canTrade,
      blockingReasons,
      warnings,
      riskScore
    };
  }

  private matchesAvoidConditions(
    entry: AvoidListEntry,
    symbol: string,
    direction: 'buy' | 'sell',
    context: any
  ): boolean {
    const conditions = entry.conditions;

    if (conditions.symbol && conditions.symbol !== symbol) return false;
    if (conditions.direction && conditions.direction !== direction) return false;
    if (conditions.hour !== undefined && conditions.hour !== context.hour) return false;
    if (conditions.setup && conditions.setup !== context.setup) return false;
    if (conditions.regime && conditions.regime !== context.regime) return false;

    return true;
  }

  private async checkLossStreak(userId: string, symbol: string): Promise<any> {
    try {
      const { data: recentTrades } = await supabase
        .from('ai_trade_analysis')
        .select('outcome')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('entry_time', { ascending: false })
        .limit(10);

      if (!recentTrades || recentTrades.length === 0) {
        return { consecutiveLosses: 0 };
      }

      let streak = 0;
      for (const trade of recentTrades) {
        if (trade.outcome === 'loss') {
          streak++;
        } else {
          break;
        }
      }

      return { consecutiveLosses: streak };
    } catch (error) {
      console.error('[Dynamic Avoid List] Error checking loss streak:', error);
      return { consecutiveLosses: 0 };
    }
  }

  private async checkDailyLossLimit(userId: string): Promise<any> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: todayTrades } = await supabase
        .from('ai_trade_analysis')
        .select('pnl, outcome')
        .eq('user_id', userId)
        .gte('entry_time', today.toISOString());

      if (!todayTrades || todayTrades.length === 0) {
        return { approachingLimit: false, limitExceeded: false, lossPercent: 0 };
      }

      const totalLoss = todayTrades
        .filter(t => t.outcome === 'loss')
        .reduce((sum, t) => sum + Math.abs(parseFloat(t.pnl)), 0);

      const { data: preferences } = await supabase
        .from('user_trading_preferences')
        .select('max_daily_loss')
        .eq('user_id', userId)
        .maybeSingle();

      const maxDailyLoss = preferences?.max_daily_loss || 100;

      const lossPercent = (totalLoss / maxDailyLoss) * 100;

      return {
        approachingLimit: lossPercent >= 70 && lossPercent < 100,
        limitExceeded: lossPercent >= 100,
        lossPercent,
        totalLoss,
        maxDailyLoss
      };
    } catch (error) {
      console.error('[Dynamic Avoid List] Error checking daily loss limit:', error);
      return { approachingLimit: false, limitExceeded: false, lossPercent: 0 };
    }
  }

  async addToAvoidList(
    userId: string,
    reason: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    conditions: any,
    durationHours?: number
  ): Promise<void> {
    try {
      const expiresAt = durationHours
        ? new Date(Date.now() + durationHours * 60 * 60 * 1000)
        : undefined;

      await supabase.from('dynamic_avoid_list').insert({
        user_id: userId,
        reason,
        severity,
        conditions,
        expires_at: expiresAt?.toISOString(),
        is_active: true,
        occurrences: 1,
        added_at: new Date().toISOString()
      });

      console.log(`[Dynamic Avoid List] Added entry: ${reason} (${severity})`);
    } catch (error) {
      console.error('[Dynamic Avoid List] Error adding entry:', error);
    }
  }

  async removeFromAvoidList(userId: string, entryId: string): Promise<void> {
    try {
      await supabase
        .from('dynamic_avoid_list')
        .update({ is_active: false })
        .eq('id', entryId)
        .eq('user_id', userId);

      console.log(`[Dynamic Avoid List] Removed entry: ${entryId}`);
    } catch (error) {
      console.error('[Dynamic Avoid List] Error removing entry:', error);
    }
  }

  async cleanupExpiredEntries(userId: string): Promise<void> {
    try {
      const now = new Date().toISOString();

      const { data: expired } = await supabase
        .from('dynamic_avoid_list')
        .select('id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .lte('expires_at', now);

      if (expired && expired.length > 0) {
        const ids = expired.map(e => e.id);

        await supabase
          .from('dynamic_avoid_list')
          .update({ is_active: false })
          .in('id', ids);

        console.log(`[Dynamic Avoid List] Cleaned up ${expired.length} expired entries`);
      }
    } catch (error) {
      console.error('[Dynamic Avoid List] Error cleaning up:', error);
    }
  }

  private async getActiveAvoidListEntries(userId: string): Promise<AvoidListEntry[]> {
    try {
      await this.cleanupExpiredEntries(userId);

      const { data } = await supabase
        .from('dynamic_avoid_list')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('severity', { ascending: false });

      if (!data) return [];

      return data.map(d => ({
        id: d.id,
        reason: d.reason,
        severity: d.severity,
        addedAt: new Date(d.added_at),
        expiresAt: d.expires_at ? new Date(d.expires_at) : undefined,
        isActive: d.is_active,
        conditions: d.conditions,
        occurrences: d.occurrences
      }));
    } catch (error) {
      console.error('[Dynamic Avoid List] Error getting entries:', error);
      return [];
    }
  }

  async getAvoidListSummary(userId: string): Promise<{
    totalEntries: number;
    criticalEntries: number;
    highRiskEntries: number;
    recentAdditions: AvoidListEntry[];
  }> {
    const entries = await this.getActiveAvoidListEntries(userId);

    return {
      totalEntries: entries.length,
      criticalEntries: entries.filter(e => e.severity === 'critical').length,
      highRiskEntries: entries.filter(e => e.severity === 'high').length,
      recentAdditions: entries.slice(0, 5)
    };
  }

  async updateEntryOccurrences(userId: string, conditions: any): Promise<void> {
    try {
      const { data: matching } = await supabase
        .from('dynamic_avoid_list')
        .select('id, occurrences')
        .eq('user_id', userId)
        .eq('is_active', true)
        .contains('conditions', conditions)
        .maybeSingle();

      if (matching) {
        await supabase
          .from('dynamic_avoid_list')
          .update({
            occurrences: matching.occurrences + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', matching.id);
      }
    } catch (error) {
      console.error('[Dynamic Avoid List] Error updating occurrences:', error);
    }
  }
}

export const dynamicAvoidList = new DynamicAvoidList();
export type { AvoidListEntry, TradeValidationResult };
