/**
 * Global Intelligence Provider
 *
 * Central service to query platform-wide AI learning data
 * Used by Alpha, Omegas, and decision-making systems
 *
 * Data is aggregated from ALL users (anonymized, no user identification)
 * Provides collective intelligence to improve trading decisions
 */

import { supabase } from '../lib/supabase';

export interface GlobalPattern {
  pattern_id: string;
  pattern_name: string;
  symbol: string;
  setup_type: string;
  direction: 'buy' | 'sell' | 'both';
  win_rate: number;
  profit_factor: number;
  avg_rr: number;
  total_occurrences: number;
  market_conditions: Record<string, any>;
  volatility_regime: string;
  sample_size_adequate: boolean;
  decay_weight: number;
}

export interface GlobalSymbolIntelligence {
  symbol: string;
  total_trades_platform_wide: number;
  platform_win_rate: number;
  platform_profit_factor: number;
  best_timeframes: string[];
  best_session_times: string[];
  top_winning_patterns: any[];
  top_losing_patterns: any[];
  intelligence_quality_score: number;
}

export interface GlobalMarketScenario {
  scenario_id: string;
  symbol: string;
  market_type: string;
  volatility_regime: string;
  win_rate: number;
  profit_factor: number;
  total_trades: number;
  recommended_confidence_threshold: number;
  top_patterns: string[];
}

export interface PlatformStats {
  trades_analyzed_today: number;
  patterns_discovered_today: number;
  total_trades_analyzed: number;
  total_patterns_discovered: number;
  platform_win_rate: number;
  platform_profit_factor: number;
  intelligence_growth_rate: number;
  best_symbol_today: string | null;
  best_pattern_today: string | null;
}

export interface ConfidenceCalibration {
  confidence_bucket: string;
  actual_win_rate: number;
  expected_win_rate: number;
  calibration_error: number;
  is_well_calibrated: boolean;
  recommended_adjustment: number;
}

class GlobalIntelligenceProvider {
  /**
   * Get platform-wide pattern performance for a symbol
   */
  async getGlobalPatternsForSymbol(
    symbol: string,
    minSampleSize: number = 10
  ): Promise<GlobalPattern[]> {
    try {
      const { data, error } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .eq('symbol', symbol)
        .gte('total_occurrences', minSampleSize)
        .order('win_rate', { ascending: false })
        .limit(20);

      if (error) {
        console.error('[Global Intelligence] Error fetching patterns:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Global Intelligence] Exception in getGlobalPatternsForSymbol:', error);
      return [];
    }
  }

  /**
   * Get best performing patterns across all symbols
   */
  async getTopPerformingPatterns(limit: number = 10): Promise<GlobalPattern[]> {
    try {
      const { data, error } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .eq('sample_size_adequate', true)
        .gte('win_rate', 60)
        .order('profit_factor', { ascending: false })
        .order('win_rate', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Global Intelligence] Error fetching top patterns:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Global Intelligence] Exception in getTopPerformingPatterns:', error);
      return [];
    }
  }

  /**
   * Get symbol-specific collective intelligence
   */
  async getSymbolIntelligence(symbol: string): Promise<GlobalSymbolIntelligence | null> {
    try {
      const { data, error } = await supabase
        .from('ai_global_symbol_intelligence')
        .select('*')
        .eq('symbol', symbol)
        .maybeSingle();

      if (error) {
        console.error('[Global Intelligence] Error fetching symbol intelligence:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Global Intelligence] Exception in getSymbolIntelligence:', error);
      return null;
    }
  }

  /**
   * Get platform-wide market scenario performance
   */
  async getMarketScenarioPerformance(
    symbol: string,
    marketType: string,
    volatilityRegime: string
  ): Promise<GlobalMarketScenario | null> {
    try {
      const { data, error } = await supabase
        .from('ai_global_market_scenarios')
        .select('*')
        .eq('symbol', symbol)
        .eq('market_type', marketType)
        .eq('volatility_regime', volatilityRegime)
        .maybeSingle();

      if (error) {
        console.error('[Global Intelligence] Error fetching market scenario:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Global Intelligence] Exception in getMarketScenarioPerformance:', error);
      return null;
    }
  }

  /**
   * Get platform-wide statistics
   */
  async getPlatformStats(): Promise<PlatformStats | null> {
    try {
      const { data, error } = await supabase
        .from('ai_platform_learning_stats')
        .select('*')
        .order('stat_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[Global Intelligence] Error fetching platform stats:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Global Intelligence] Exception in getPlatformStats:', error);
      return null;
    }
  }

  /**
   * Get confidence calibration data
   */
  async getConfidenceCalibration(confidenceLevel: number): Promise<ConfidenceCalibration | null> {
    try {
      // Determine which bucket this confidence falls into
      let bucket = '70-75';
      if (confidenceLevel >= 95) bucket = '95-100';
      else if (confidenceLevel >= 90) bucket = '90-95';
      else if (confidenceLevel >= 85) bucket = '85-90';
      else if (confidenceLevel >= 80) bucket = '80-85';
      else if (confidenceLevel >= 75) bucket = '75-80';

      const { data, error } = await supabase
        .from('ai_global_confidence_calibration')
        .select('*')
        .eq('confidence_bucket', bucket)
        .maybeSingle();

      if (error) {
        console.error('[Global Intelligence] Error fetching confidence calibration:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Global Intelligence] Exception in getConfidenceCalibration:', error);
      return null;
    }
  }

  /**
   * Check if a specific pattern is validated by platform data
   */
  async isPatternValidated(
    symbol: string,
    setupType: string,
    minWinRate: number = 55
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('ai_global_patterns')
        .select('win_rate, sample_size_adequate')
        .eq('symbol', symbol)
        .eq('setup_type', setupType)
        .eq('sample_size_adequate', true)
        .gte('win_rate', minWinRate)
        .maybeSingle();

      if (error || !data) {
        return false;
      }

      return true;
    } catch (error) {
      console.error('[Global Intelligence] Exception in isPatternValidated:', error);
      return false;
    }
  }

  /**
   * Get recommended confidence threshold for a symbol based on platform data
   */
  async getRecommendedConfidenceThreshold(symbol: string): Promise<number> {
    try {
      const intelligence = await this.getSymbolIntelligence(symbol);

      if (!intelligence || intelligence.total_trades_platform_wide < 50) {
        // Not enough data, return default
        return 75;
      }

      // Base threshold on platform win rate
      if (intelligence.platform_win_rate >= 70) {
        return 70; // Can be more aggressive
      } else if (intelligence.platform_win_rate >= 60) {
        return 75; // Standard threshold
      } else {
        return 80; // Need higher confidence for difficult symbols
      }
    } catch (error) {
      console.error('[Global Intelligence] Exception in getRecommendedConfidenceThreshold:', error);
      return 75;
    }
  }

  /**
   * Get pattern intelligence summary for Alpha decision-making
   */
  async getPatternIntelligenceSummary(
    symbol: string,
    setupType: string,
    direction: 'buy' | 'sell'
  ): Promise<{
    exists: boolean;
    winRate: number;
    profitFactor: number;
    sampleSize: number;
    reliable: boolean;
    recommendation: 'strong_support' | 'support' | 'neutral' | 'caution' | 'avoid';
  }> {
    try {
      const { data, error } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .eq('symbol', symbol)
        .eq('setup_type', setupType)
        .or(`direction.eq.${direction},direction.eq.both`)
        .maybeSingle();

      if (error || !data) {
        return {
          exists: false,
          winRate: 0,
          profitFactor: 0,
          sampleSize: 0,
          reliable: false,
          recommendation: 'neutral'
        };
      }

      // Determine recommendation based on performance
      let recommendation: 'strong_support' | 'support' | 'neutral' | 'caution' | 'avoid' = 'neutral';

      if (data.sample_size_adequate && data.win_rate >= 65 && data.profit_factor >= 2.0) {
        recommendation = 'strong_support';
      } else if (data.sample_size_adequate && data.win_rate >= 55 && data.profit_factor >= 1.5) {
        recommendation = 'support';
      } else if (data.sample_size_adequate && data.win_rate < 45) {
        recommendation = 'avoid';
      } else if (data.win_rate < 50) {
        recommendation = 'caution';
      }

      return {
        exists: true,
        winRate: parseFloat(data.win_rate.toString()),
        profitFactor: parseFloat(data.profit_factor.toString()),
        sampleSize: data.total_occurrences,
        reliable: data.sample_size_adequate,
        recommendation
      };
    } catch (error) {
      console.error('[Global Intelligence] Exception in getPatternIntelligenceSummary:', error);
      return {
        exists: false,
        winRate: 0,
        profitFactor: 0,
        sampleSize: 0,
        reliable: false,
        recommendation: 'neutral'
      };
    }
  }

  /**
   * Get all symbols tracked by platform
   */
  async getAllTrackedSymbols(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('ai_global_symbol_intelligence')
        .select('symbol')
        .gte('total_trades_platform_wide', 10)
        .order('total_trades_platform_wide', { ascending: false });

      if (error) {
        console.error('[Global Intelligence] Error fetching tracked symbols:', error);
        return ['EURUSD', 'XAUUSD', 'GBPUSD']; // Defaults
      }

      return data?.map(d => d.symbol) || ['EURUSD', 'XAUUSD', 'GBPUSD'];
    } catch (error) {
      console.error('[Global Intelligence] Exception in getAllTrackedSymbols:', error);
      return ['EURUSD', 'XAUUSD', 'GBPUSD'];
    }
  }
}

export const globalIntelligenceProvider = new GlobalIntelligenceProvider();
