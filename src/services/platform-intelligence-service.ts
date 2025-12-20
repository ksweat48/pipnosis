import { supabase } from '../lib/supabase';

export interface PlatformStats {
  totalTradesAnalyzed: number;
  totalPatternsDiscovered: number;
  platformWinRate: number;
  platformProfitFactor: number;
  uniqueUsersContributing: number;
  totalSymbolsTracked: number;
  intelligenceGrowthRate: number;
  bestSymbolToday: string | null;
  bestPatternToday: string | null;
  tradesAnalyzedToday: number;
  patternsDiscoveredToday: number;
}

export interface GlobalPattern {
  id: string;
  pattern_id: string;
  pattern_name: string;
  symbol: string;
  setup_type: string;
  direction: string | null;
  total_occurrences: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  profit_factor: number;
  avg_rr: number;
  market_conditions: any;
  volatility_regime: string;
  optimal_timeframes: string[];
  last_occurrence_at: string | null;
  discovery_date: string;
  sample_size_adequate: boolean;
  statistical_significance: number;
}

export interface SymbolIntelligence {
  symbol: string;
  total_trades_platform_wide: number;
  platform_win_rate: number;
  platform_profit_factor: number;
  best_timeframes: string[];
  best_session_times: string[];
  top_winning_patterns: any[];
  intelligence_quality_score: number;
  last_pattern_discovered_at: string | null;
}

export interface UserContribution {
  totalTradesContributed: number;
  patternsDiscovered: number;
  contributionPercentage: number;
  rank: number | null;
}

class PlatformIntelligenceService {
  async fetchPlatformStats(): Promise<PlatformStats | null> {
    try {
      // Update platform stats with latest data (calculates growth rate)
      await supabase.rpc('update_platform_stats');

      const { data, error } = await supabase
        .from('ai_platform_learning_stats')
        .select('*')
        .order('stat_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return {
          totalTradesAnalyzed: 0,
          totalPatternsDiscovered: 0,
          platformWinRate: 0,
          platformProfitFactor: 0,
          uniqueUsersContributing: 0,
          totalSymbolsTracked: 0,
          intelligenceGrowthRate: 0,
          bestSymbolToday: null,
          bestPatternToday: null,
          tradesAnalyzedToday: 0,
          patternsDiscoveredToday: 0
        };
      }

      return {
        totalTradesAnalyzed: data.total_trades_analyzed || 0,
        totalPatternsDiscovered: data.total_patterns_discovered || 0,
        platformWinRate: data.platform_win_rate || 0,
        platformProfitFactor: data.platform_profit_factor || 0,
        uniqueUsersContributing: data.unique_users_contributing || 0,
        totalSymbolsTracked: data.total_symbols_tracked || 0,
        intelligenceGrowthRate: data.intelligence_growth_rate || 0,
        bestSymbolToday: data.best_symbol_today,
        bestPatternToday: data.best_pattern_today,
        tradesAnalyzedToday: data.trades_analyzed_today || 0,
        patternsDiscoveredToday: data.patterns_discovered_today || 0
      };
    } catch (error) {
      console.error('[Platform Intelligence] Error fetching platform stats:', error);
      return null;
    }
  }

  async fetchGlobalPatterns(filters?: {
    symbol?: string;
    setupType?: string;
    minWinRate?: number;
    limit?: number;
  }): Promise<GlobalPattern[]> {
    try {
      let query = supabase
        .from('ai_global_patterns')
        .select('*')
        .order('win_rate', { ascending: false });

      if (filters?.symbol) {
        query = query.eq('symbol', filters.symbol);
      }

      if (filters?.setupType) {
        query = query.eq('setup_type', filters.setupType);
      }

      if (filters?.minWinRate) {
        query = query.gte('win_rate', filters.minWinRate);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      } else {
        query = query.limit(50);
      }

      const { data, error } = await query;

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('[Platform Intelligence] Error fetching global patterns:', error);
      return [];
    }
  }

  async fetchTopSymbols(limit: number = 10): Promise<SymbolIntelligence[]> {
    try {
      const { data, error } = await supabase
        .from('ai_global_symbol_intelligence')
        .select('*')
        .order('intelligence_quality_score', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('[Platform Intelligence] Error fetching top symbols:', error);
      return [];
    }
  }

  async fetchUserContribution(userId: string): Promise<UserContribution> {
    try {
      const { data, error } = await supabase
        .from('ai_trade_analysis')
        .select('id, contributed_to_global_learning')
        .eq('user_id', userId);

      if (error) throw error;

      const totalTradesContributed = data?.length || 0;
      const patternsDiscovered = data?.filter(t => t.contributed_to_global_learning).length || 0;

      const { data: platformStats } = await supabase
        .from('ai_platform_learning_stats')
        .select('total_trades_analyzed')
        .order('stat_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const totalPlatformTrades = platformStats?.total_trades_analyzed || 1;
      const contributionPercentage = (totalTradesContributed / totalPlatformTrades) * 100;

      return {
        totalTradesContributed,
        patternsDiscovered,
        contributionPercentage: Math.min(contributionPercentage, 100),
        rank: null
      };
    } catch (error) {
      console.error('[Platform Intelligence] Error fetching user contribution:', error);
      return {
        totalTradesContributed: 0,
        patternsDiscovered: 0,
        contributionPercentage: 0,
        rank: null
      };
    }
  }

  async fetchRecentActivity(limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .order('last_occurrence_at', { ascending: false })
        .not('last_occurrence_at', 'is', null)
        .limit(limit);

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('[Platform Intelligence] Error fetching recent activity:', error);
      return [];
    }
  }
}

export const platformIntelligenceService = new PlatformIntelligenceService();
