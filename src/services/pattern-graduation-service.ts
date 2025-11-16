import { supabase } from '../lib/supabase';

/**
 * Pattern Graduation Service
 *
 * Manages the lifecycle of exploratory patterns:
 * 1. Creates new exploratory patterns when AI tries new strategies
 * 2. Tracks performance of each pattern
 * 3. Auto-graduates successful patterns (65%+ WR over 20+ trades)
 * 4. Removes "exploratory" label once patterns prove themselves
 * 5. Provides analytics on pattern evolution
 */

export interface ExploratoryPattern {
  id: string;
  userId: string;
  patternName: string;
  patternType: string;
  patternDescription?: string;
  patternParams: any;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  graduationThresholdWr: number;
  graduationThresholdTrades: number;
  isGraduated: boolean;
  graduatedAt?: string;
  progressionWeight: number;
  isActive: boolean;
  status: 'testing' | 'graduated' | 'failed' | 'paused';
  firstTradeAt?: string;
  lastTradeAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PatternGraduation {
  id: string;
  userId: string;
  patternId: string;
  patternName: string;
  patternType: string;
  tradesAtGraduation: number;
  winRateAtGraduation: number;
  profitFactorAtGraduation: number;
  totalPnlAtGraduation: number;
  tradesAfterGraduation: number;
  winRateAfterGraduation: number;
  profitFactorAfterGraduation: number;
  stillPerformingWell: boolean;
  weightBeforeGraduation: number;
  weightAfterGraduation: number;
  graduatedAt: string;
  lastPerformanceCheck: string;
}

export interface PatternCreationParams {
  patternName: string;
  patternType: string;
  patternDescription?: string;
  patternParams?: any;
  graduationThresholdWr?: number;
  graduationThresholdTrades?: number;
}

class PatternGraduationService {
  /**
   * Create a new exploratory pattern
   */
  async createExploratoryPattern(
    userId: string,
    params: PatternCreationParams
  ): Promise<ExploratoryPattern | null> {
    try {
      const { data, error } = await supabase
        .from('ai_exploratory_patterns')
        .insert({
          user_id: userId,
          pattern_name: params.patternName,
          pattern_type: params.patternType,
          pattern_description: params.patternDescription,
          pattern_params: params.patternParams || {},
          graduation_threshold_wr: params.graduationThresholdWr || 65.0,
          graduation_threshold_trades: params.graduationThresholdTrades || 20,
          progression_weight: 0.25,
          is_active: true,
          status: 'testing'
        })
        .select()
        .single();

      if (error) {
        console.error('[Pattern Graduation] Error creating pattern:', error);
        return null;
      }

      console.log(`[Pattern Graduation] ✨ Created exploratory pattern: ${params.patternName}`);
      return data as ExploratoryPattern;
    } catch (error) {
      console.error('[Pattern Graduation] Exception creating pattern:', error);
      return null;
    }
  }

  /**
   * Get or create a pattern for confidence-based exploration
   */
  async getOrCreateConfidencePattern(
    userId: string,
    confidenceRange: string
  ): Promise<ExploratoryPattern | null> {
    try {
      const patternName = `Confidence ${confidenceRange}%`;

      // Check if pattern exists
      const { data: existing } = await supabase
        .from('ai_exploratory_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('pattern_name', patternName)
        .maybeSingle();

      if (existing) {
        return existing as ExploratoryPattern;
      }

      // Create new pattern
      return await this.createExploratoryPattern(userId, {
        patternName,
        patternType: 'confidence_range',
        patternDescription: `Exploratory trades in ${confidenceRange}% confidence range`,
        patternParams: { confidenceRange }
      });
    } catch (error) {
      console.error('[Pattern Graduation] Error in getOrCreateConfidencePattern:', error);
      return null;
    }
  }

  /**
   * Get active exploratory patterns for a user
   */
  async getActivePatterns(userId: string): Promise<ExploratoryPattern[]> {
    try {
      const { data, error } = await supabase
        .from('ai_exploratory_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('is_graduated', false)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[Pattern Graduation] Error fetching active patterns:', error);
        return [];
      }

      return (data || []) as ExploratoryPattern[];
    } catch (error) {
      console.error('[Pattern Graduation] Exception fetching active patterns:', error);
      return [];
    }
  }

  /**
   * Get graduated patterns for a user
   */
  async getGraduatedPatterns(userId: string): Promise<PatternGraduation[]> {
    try {
      const { data, error } = await supabase
        .from('ai_pattern_graduations')
        .select('*')
        .eq('user_id', userId)
        .order('graduated_at', { ascending: false });

      if (error) {
        console.error('[Pattern Graduation] Error fetching graduations:', error);
        return [];
      }

      return (data || []) as PatternGraduation[];
    } catch (error) {
      console.error('[Pattern Graduation] Exception fetching graduations:', error);
      return [];
    }
  }

  /**
   * Get pattern progress toward graduation
   */
  async getPatternProgress(patternId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .from('ai_exploratory_patterns_progress')
        .select('*')
        .eq('id', patternId)
        .maybeSingle();

      if (error) {
        console.error('[Pattern Graduation] Error fetching pattern progress:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Pattern Graduation] Exception fetching pattern progress:', error);
      return null;
    }
  }

  /**
   * Check if a pattern should graduate and handle graduation
   * This is called automatically by database trigger, but can be called manually
   */
  async checkAndGraduatePattern(patternId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('check_pattern_graduation', { p_pattern_id: patternId });

      if (error) {
        console.error('[Pattern Graduation] Error checking graduation:', error);
        return false;
      }

      if (data) {
        console.log(`[Pattern Graduation] 🎓 Pattern ${patternId} graduated!`);
      }

      return data || false;
    } catch (error) {
      console.error('[Pattern Graduation] Exception checking graduation:', error);
      return false;
    }
  }

  /**
   * Get exploration statistics for a user
   */
  async getExplorationStats(userId: string): Promise<any> {
    try {
      const { data, error } = await supabase
        .rpc('get_exploration_stats', { p_user_id: userId });

      if (error) {
        console.error('[Pattern Graduation] Error fetching exploration stats:', error);
        return null;
      }

      return data?.[0] || null;
    } catch (error) {
      console.error('[Pattern Graduation] Exception fetching exploration stats:', error);
      return null;
    }
  }

  /**
   * Mark a trade as exploratory and link it to a pattern
   */
  async markTradeAsExploratory(
    userId: string,
    tradeId: string,
    patternId: string,
    confidence: number,
    reasoning: string
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('trade_history')
        .update({
          is_exploratory: true,
          exploration_pattern_id: patternId,
          exploration_confidence: confidence,
          exploration_reasoning: reasoning
        })
        .eq('id', tradeId)
        .eq('user_id', userId);

      if (error) {
        console.error('[Pattern Graduation] Error marking trade as exploratory:', error);
      } else {
        console.log(`[Pattern Graduation] 🔍 Marked trade ${tradeId} as exploratory (pattern: ${patternId})`);
      }
    } catch (error) {
      console.error('[Pattern Graduation] Exception marking trade:', error);
    }
  }

  /**
   * Get exploratory trades for analysis
   */
  async getExploratoryTrades(
    userId: string,
    limit: number = 100
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('trade_history')
        .select('*')
        .eq('user_id', userId)
        .eq('is_exploratory', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Pattern Graduation] Error fetching exploratory trades:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Pattern Graduation] Exception fetching exploratory trades:', error);
      return [];
    }
  }

  /**
   * Fail a pattern if it's performing poorly
   */
  async failPattern(patternId: string, reason: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_exploratory_patterns')
        .update({
          status: 'failed',
          is_active: false,
          pattern_description: `FAILED: ${reason}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', patternId);

      if (error) {
        console.error('[Pattern Graduation] Error failing pattern:', error);
      } else {
        console.log(`[Pattern Graduation] ❌ Pattern ${patternId} marked as failed: ${reason}`);
      }
    } catch (error) {
      console.error('[Pattern Graduation] Exception failing pattern:', error);
    }
  }

  /**
   * Get pattern performance comparison
   */
  async comparePatternPerformance(userId: string): Promise<any> {
    try {
      const patterns = await this.getActivePatterns(userId);
      const graduated = await this.getGraduatedPatterns(userId);

      const activePerformance = patterns.map(p => ({
        name: p.patternName,
        type: p.patternType,
        status: 'testing',
        trades: p.totalTrades,
        winRate: p.winRate,
        profitFactor: p.profitFactor,
        progressToGraduation: (p.totalTrades / p.graduationThresholdTrades) * 100,
        readyToGraduate: p.totalTrades >= p.graduationThresholdTrades && p.winRate >= p.graduationThresholdWr
      }));

      const graduatedPerformance = graduated.map(g => ({
        name: g.patternName,
        type: g.patternType,
        status: 'graduated',
        tradesBeforeGraduation: g.tradesAtGraduation,
        winRateAtGraduation: g.winRateAtGraduation,
        tradesAfterGraduation: g.tradesAfterGraduation,
        winRateAfterGraduation: g.winRateAfterGraduation,
        stillPerformingWell: g.stillPerformingWell
      }));

      return {
        activePatterns: activePerformance,
        graduatedPatterns: graduatedPerformance,
        totalPatternsDiscovered: patterns.length + graduated.length,
        successfulGraduations: graduated.filter(g => g.stillPerformingWell).length,
        failedPatterns: graduated.filter(g => !g.stillPerformingWell).length
      };
    } catch (error) {
      console.error('[Pattern Graduation] Error comparing patterns:', error);
      return null;
    }
  }
}

export const patternGraduationService = new PatternGraduationService();
