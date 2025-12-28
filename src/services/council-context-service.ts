import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface CouncilContext {
  id?: string;
  user_id: string;
  session_id: string;
  alpha_decision: 'no_trade' | 'trade_taken' | 'scouting';
  confidence: number;
  threshold_gap: number;
  target_threshold: number;
  omega_issues: Record<string, string[]>;
  required_improvements: Record<string, string[]>;
  last_snapshot: Record<string, any>;
  symbols_scanned: string[];
  total_omega_votes: number;
  scout_cycles?: number;
  last_improvement_score?: number;
  improvement_trend?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface OmegaIssue {
  omega_name: string;
  issues: string[];
}

export interface RequiredImprovement {
  category: string;
  requirements: string[];
}

class CouncilContextService {
  async storeCouncilContext(context: CouncilContext): Promise<string | null> {
    try {
      logger.info('[CouncilContext] Storing new council context', {
        session_id: context.session_id,
        confidence: context.confidence,
        alpha_decision: context.alpha_decision,
        omega_votes: context.total_omega_votes,
      });

      const { data, error } = await supabase.rpc('store_council_context', {
        p_user_id: context.user_id,
        p_session_id: context.session_id,
        p_alpha_decision: context.alpha_decision,
        p_confidence: context.confidence,
        p_threshold_gap: context.threshold_gap,
        p_target_threshold: context.target_threshold,
        p_omega_issues: context.omega_issues,
        p_required_improvements: context.required_improvements,
        p_last_snapshot: context.last_snapshot,
        p_symbols_scanned: context.symbols_scanned,
        p_total_omega_votes: context.total_omega_votes,
      });

      if (error) {
        logger.error('[CouncilContext] Failed to store context', { error });
        return null;
      }

      logger.info('[CouncilContext] Context stored successfully', { context_id: data });
      return data;
    } catch (error) {
      logger.error('[CouncilContext] Exception storing context', { error });
      return null;
    }
  }

  async getLatestContext(userId: string, sessionId: string): Promise<CouncilContext | null> {
    try {
      const { data, error } = await supabase.rpc('get_latest_council_context', {
        p_user_id: userId,
        p_session_id: sessionId,
      });

      if (error) {
        console.error('%c❌ DATABASE ERROR: Failed to retrieve council context', 'color: white; background: #ff0000; font-size: 14px; font-weight: bold; padding: 5px;');
        console.error('   Error:', error);
        console.error('   This means the database function is failing - Alpha Scout will not work!');
        logger.error('[CouncilContext] Failed to retrieve context', { error });
        return null;
      }

      if (!data || Object.keys(data).length === 0) {
        console.log('%c📭 No existing context - first scan for this session', 'color: #666; font-size: 12px;');
        logger.info('[CouncilContext] No context found for session', { sessionId });
        return null;
      }

      console.log('%c✅ Context retrieved successfully from database', 'color: #00aa00; font-size: 12px; font-weight: bold;');
      logger.info('[CouncilContext] Retrieved context', {
        session_id: sessionId,
        confidence: data.confidence,
        scout_cycles: data.scout_cycles,
      });

      return data as CouncilContext;
    } catch (error) {
      console.error('%c❌ EXCEPTION: Error retrieving council context', 'color: white; background: #ff0000; font-size: 14px; font-weight: bold; padding: 5px;');
      console.error('   Exception:', error);
      logger.error('[CouncilContext] Exception retrieving context', { error });
      return null;
    }
  }

  async incrementScoutCycle(
    userId: string,
    sessionId: string,
    improvementScore: number
  ): Promise<boolean> {
    try {
      logger.info('[CouncilContext] Incrementing scout cycle', {
        session_id: sessionId,
        improvement_score: improvementScore,
      });

      const { error } = await supabase.rpc('increment_scout_cycle', {
        p_user_id: userId,
        p_session_id: sessionId,
        p_improvement_score: improvementScore,
      });

      if (error) {
        logger.error('[CouncilContext] Failed to increment scout cycle', { error });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[CouncilContext] Exception incrementing scout cycle', { error });
      return false;
    }
  }

  extractOmegaIssues(omegaVotes: any[]): Record<string, string[]> {
    const issues: Record<string, string[]> = {};

    for (const vote of omegaVotes) {
      if (!vote.vote || vote.vote === 'YES') continue;

      const omegaName = vote.omega_name || 'unknown';
      const reasoning = vote.reasoning || 'No reasoning provided';

      if (!issues[omegaName]) {
        issues[omegaName] = [];
      }

      issues[omegaName].push(reasoning);
    }

    return issues;
  }

  extractRequiredImprovements(omegaIssues: Record<string, string[]>): Record<string, string[]> {
    const improvements: Record<string, string[]> = {
      trend: [],
      volatility: [],
      liquidity: [],
      momentum: [],
      structure: [],
      sentiment: [],
      other: [],
    };

    for (const [omegaName, issuesList] of Object.entries(omegaIssues)) {
      for (const issue of issuesList) {
        const lowerIssue = issue.toLowerCase();

        if (
          lowerIssue.includes('trend') ||
          lowerIssue.includes('ema') ||
          lowerIssue.includes('direction') ||
          lowerIssue.includes('sideways')
        ) {
          improvements.trend.push(`${omegaName}: ${issue}`);
        } else if (
          lowerIssue.includes('volatility') ||
          lowerIssue.includes('atr') ||
          lowerIssue.includes('range')
        ) {
          improvements.volatility.push(`${omegaName}: ${issue}`);
        } else if (
          lowerIssue.includes('liquidity') ||
          lowerIssue.includes('volume') ||
          lowerIssue.includes('spread')
        ) {
          improvements.liquidity.push(`${omegaName}: ${issue}`);
        } else if (
          lowerIssue.includes('momentum') ||
          lowerIssue.includes('rsi') ||
          lowerIssue.includes('macd')
        ) {
          improvements.momentum.push(`${omegaName}: ${issue}`);
        } else if (
          lowerIssue.includes('structure') ||
          lowerIssue.includes('support') ||
          lowerIssue.includes('resistance')
        ) {
          improvements.structure.push(`${omegaName}: ${issue}`);
        } else if (
          lowerIssue.includes('sentiment') ||
          lowerIssue.includes('bias') ||
          lowerIssue.includes('risk')
        ) {
          improvements.sentiment.push(`${omegaName}: ${issue}`);
        } else {
          improvements.other.push(`${omegaName}: ${issue}`);
        }
      }
    }

    const filtered: Record<string, string[]> = {};
    for (const [category, items] of Object.entries(improvements)) {
      if (items.length > 0) {
        filtered[category] = items;
      }
    }

    return filtered;
  }

  buildContextSnapshot(symbols: string[], marketData: any): Record<string, any> {
    const snapshot: Record<string, any> = {};

    for (const symbol of symbols) {
      const data = marketData[symbol];
      if (!data) continue;

      snapshot[symbol] = {
        price: data.price || 0,
        ema20: data.ema20 || 0,
        ema50: data.ema50 || 0,
        ema200: data.ema200 || 0,
        rsi: data.rsi || 0,
        atr: data.atr || 0,
        volume: data.volume || 0,
        spread: data.spread || 0,
        timestamp: data.timestamp || new Date().toISOString(),
      };
    }

    return snapshot;
  }

  shouldForceRefresh(context: CouncilContext): boolean {
    if (!context.created_at) return true;

    const createdAt = new Date(context.created_at).getTime();
    const now = Date.now();
    const minutesSinceCreation = (now - createdAt) / 1000 / 60;

    if (minutesSinceCreation > 15) {
      logger.info('[CouncilContext] Forcing refresh - context older than 15 minutes', {
        minutes_old: minutesSinceCreation.toFixed(1),
      });
      return true;
    }

    if (context.scout_cycles && context.scout_cycles >= 10) {
      logger.info('[CouncilContext] Forcing refresh - max scout cycles reached', {
        scout_cycles: context.scout_cycles,
      });
      return true;
    }

    return false;
  }

  formatContextForDisplay(context: CouncilContext): string {
    const lines: string[] = [];

    lines.push(`📊 Last Council Decision (${new Date(context.created_at || '').toLocaleTimeString()})`);
    lines.push(`   Confidence: ${context.confidence}% (need ${context.target_threshold}%+)`);
    lines.push(`   Gap: +${context.threshold_gap}% needed`);
    lines.push('');

    if (Object.keys(context.omega_issues).length > 0) {
      lines.push('🚨 Issues Identified:');
      for (const [omega, issues] of Object.entries(context.omega_issues)) {
        lines.push(`   ${omega}:`);
        for (const issue of issues) {
          lines.push(`      - ${issue}`);
        }
      }
      lines.push('');
    }

    if (Object.keys(context.required_improvements).length > 0) {
      lines.push('🎯 What Needs to Improve:');
      for (const [category, requirements] of Object.entries(context.required_improvements)) {
        lines.push(`   ${category.toUpperCase()}:`);
        for (const req of requirements) {
          lines.push(`      - ${req}`);
        }
      }
      lines.push('');
    }

    if (context.scout_cycles !== undefined && context.scout_cycles > 0) {
      lines.push(`🔍 Scout Cycles: ${context.scout_cycles}`);
      if (context.improvement_trend && context.improvement_trend.length > 0) {
        lines.push(`   Trend: ${context.improvement_trend.join(' → ')}`);
      }
    }

    return lines.join('\n');
  }
}

export const councilContextService = new CouncilContextService();
