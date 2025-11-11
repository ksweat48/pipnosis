import { supabase } from '../lib/supabase';

/**
 * Cross-Symbol Pattern Clustering Service
 *
 * Enables transfer learning between correlated currency pairs.
 * When the AI discovers a profitable pattern on EURUSD, it can apply
 * that learning to correlated pairs like GBPUSD, EURGBP, etc.
 *
 * Benefits:
 * - Faster learning (insights from one pair help others)
 * - Better generalization (patterns proven across multiple assets)
 * - Reduced data requirements (shared learning pool)
 * - Improved robustness (cluster consensus)
 */

interface SymbolCorrelation {
  symbolA: string;
  symbolB: string;
  correlation: number;
  strength: 'strong' | 'moderate' | 'weak' | 'none';
  lastCalculated: Date;
}

interface SymbolCluster {
  id: string;
  clusterName: string;
  symbols: string[];
  primarySymbol: string;
  avgCorrelation: number;
  minCorrelation: number;
  sharedInsightsCount: number;
  clusterWinRate: number;
  isActive: boolean;
}

interface TransferableInsight {
  insightId: string;
  sourceSymbol: string;
  clusterName: string;
  targetSymbols: string[];
  originalConfidence: number;
  transferSuccessRate: number;
  adjustmentFactor: number;
}

class CrossSymbolClustering {
  /**
   * Get correlation between two symbols
   */
  async getSymbolCorrelation(
    userId: string,
    symbolA: string,
    symbolB: string
  ): Promise<SymbolCorrelation | null> {
    try {
      // Ensure symbols are in alphabetical order for lookup
      const [first, second] = [symbolA, symbolB].sort();

      const { data, error } = await supabase
        .from('symbol_correlation_matrix')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol_a', first)
        .eq('symbol_b', second)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        symbolA: data.symbol_a,
        symbolB: data.symbol_b,
        correlation: parseFloat(data.correlation_coefficient),
        strength: data.correlation_strength,
        lastCalculated: new Date(data.last_calculated_at)
      };
    } catch (error) {
      console.error('[Cross-Symbol] Error getting correlation:', error);
      return null;
    }
  }

  /**
   * Get all correlations for a symbol
   */
  async getSymbolCorrelations(userId: string, symbol: string): Promise<SymbolCorrelation[]> {
    try {
      const { data, error } = await supabase
        .from('symbol_correlation_matrix')
        .select('*')
        .eq('user_id', userId)
        .or(`symbol_a.eq.${symbol},symbol_b.eq.${symbol}`)
        .gte('correlation_coefficient', 0.5) // Only moderate+ correlations
        .order('correlation_coefficient', { ascending: false });

      if (error || !data) {
        return [];
      }

      return data.map(d => ({
        symbolA: d.symbol_a,
        symbolB: d.symbol_b,
        correlation: parseFloat(d.correlation_coefficient),
        strength: d.correlation_strength,
        lastCalculated: new Date(d.last_calculated_at)
      }));
    } catch (error) {
      console.error('[Cross-Symbol] Error getting correlations:', error);
      return [];
    }
  }

  /**
   * Calculate and update correlation matrix
   */
  async updateCorrelationMatrix(userId: string): Promise<void> {
    try {
      console.log('[Cross-Symbol] Updating correlation matrix...');

      const { error } = await supabase.rpc('update_correlation_matrix', {
        p_user_id: userId
      });

      if (error) {
        console.error('[Cross-Symbol] Error updating matrix:', error);
        return;
      }

      console.log('[Cross-Symbol] Correlation matrix updated successfully');
    } catch (error) {
      console.error('[Cross-Symbol] Error in updateCorrelationMatrix:', error);
    }
  }

  /**
   * Get all active clusters for user
   */
  async getClusters(userId: string): Promise<SymbolCluster[]> {
    try {
      const { data, error } = await supabase
        .from('symbol_clusters')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('cluster_name', { ascending: true });

      if (error || !data) {
        return [];
      }

      return data.map(d => ({
        id: d.id,
        clusterName: d.cluster_name,
        symbols: d.symbols,
        primarySymbol: d.primary_symbol,
        avgCorrelation: parseFloat(d.avg_correlation || 0),
        minCorrelation: parseFloat(d.min_correlation || 0),
        sharedInsightsCount: d.shared_insights_count || 0,
        clusterWinRate: parseFloat(d.cluster_win_rate || 0),
        isActive: d.is_active
      }));
    } catch (error) {
      console.error('[Cross-Symbol] Error getting clusters:', error);
      return [];
    }
  }

  /**
   * Get cluster for a specific symbol
   */
  async getClusterForSymbol(userId: string, symbol: string): Promise<SymbolCluster | null> {
    try {
      const { data, error } = await supabase
        .from('symbol_clusters')
        .select('*')
        .eq('user_id', userId)
        .eq('is_active', true)
        .contains('symbols', [symbol])
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        clusterName: data.cluster_name,
        symbols: data.symbols,
        primarySymbol: data.primary_symbol,
        avgCorrelation: parseFloat(data.avg_correlation || 0),
        minCorrelation: parseFloat(data.min_correlation || 0),
        sharedInsightsCount: data.shared_insights_count || 0,
        clusterWinRate: parseFloat(data.cluster_win_rate || 0),
        isActive: data.is_active
      };
    } catch (error) {
      console.error('[Cross-Symbol] Error getting cluster for symbol:', error);
      return null;
    }
  }

  /**
   * Create default clusters
   */
  async createDefaultClusters(userId: string): Promise<void> {
    try {
      console.log('[Cross-Symbol] Creating default clusters...');

      const { error } = await supabase.rpc('create_correlation_clusters', {
        p_user_id: userId
      });

      if (error) {
        console.error('[Cross-Symbol] Error creating clusters:', error);
        return;
      }

      console.log('[Cross-Symbol] Default clusters created successfully');
    } catch (error) {
      console.error('[Cross-Symbol] Error in createDefaultClusters:', error);
    }
  }

  /**
   * Get transferable insights for a symbol
   * These are insights from correlated symbols that might apply
   */
  async getTransferableInsights(
    userId: string,
    targetSymbol: string
  ): Promise<TransferableInsight[]> {
    try {
      // Get the cluster this symbol belongs to
      const cluster = await this.getClusterForSymbol(userId, targetSymbol);
      if (!cluster) {
        return [];
      }

      // Get insights from other symbols in the cluster
      const { data, error } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .in('symbol', cluster.symbols.filter(s => s !== targetSymbol))
        .gte('confidence_score', 70)
        .order('confidence_score', { ascending: false })
        .limit(20);

      if (error || !data) {
        return [];
      }

      // Check if these insights have been shared before
      const insights: TransferableInsight[] = [];

      for (const insight of data) {
        const { data: shared } = await supabase
          .from('cluster_shared_insights')
          .select('*')
          .eq('user_id', userId)
          .eq('source_insight_id', insight.id)
          .eq('cluster_id', cluster.id)
          .maybeSingle();

        const successRate = shared
          ? (shared.times_correct_cross_symbol / Math.max(1, shared.times_used_cross_symbol)) * 100
          : 0;

        const adjustmentFactor = shared?.confidence_adjustment_factor || 0.8; // Default 80% confidence when transferring

        insights.push({
          insightId: insight.id,
          sourceSymbol: insight.symbol,
          clusterName: cluster.clusterName,
          targetSymbols: cluster.symbols.filter(s => s !== insight.symbol),
          originalConfidence: insight.confidence_score,
          transferSuccessRate: successRate,
          adjustmentFactor
        });
      }

      return insights;
    } catch (error) {
      console.error('[Cross-Symbol] Error getting transferable insights:', error);
      return [];
    }
  }

  /**
   * Apply insight from one symbol to another (transfer learning)
   */
  async transferInsight(
    userId: string,
    sourceInsightId: string,
    targetSymbol: string,
    adjustmentFactor: number = 0.8
  ): Promise<string | null> {
    try {
      // Get source insight
      const { data: sourceInsight, error: insightError } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('id', sourceInsightId)
        .maybeSingle();

      if (insightError || !sourceInsight) {
        console.error('[Cross-Symbol] Source insight not found');
        return null;
      }

      // Get cluster
      const cluster = await this.getClusterForSymbol(userId, sourceInsight.symbol);
      if (!cluster || !cluster.symbols.includes(targetSymbol)) {
        console.error('[Cross-Symbol] Target symbol not in same cluster');
        return null;
      }

      // Create transferred insight with adjusted confidence
      const { data: newInsight, error: createError } = await supabase
        .from('ai_learning_insights')
        .insert({
          user_id: userId,
          symbol: targetSymbol,
          insight_type: sourceInsight.insight_type,
          insight_title: `[Transferred] ${sourceInsight.insight_title}`,
          insight_description: `${sourceInsight.insight_description}\n\n🔄 Transferred from ${sourceInsight.symbol} via ${cluster.clusterName} cluster`,
          confidence_score: Math.round(sourceInsight.confidence_score * adjustmentFactor),
          learning_weight: sourceInsight.learning_weight * 0.7, // Reduce weight for transferred insights
          learned_from_live_trading: false, // Mark as not from live trading
          pattern_details: {
            ...sourceInsight.pattern_details,
            transferred_from: sourceInsight.symbol,
            transfer_cluster: cluster.clusterName,
            adjustment_factor: adjustmentFactor
          }
        })
        .select()
        .single();

      if (createError || !newInsight) {
        console.error('[Cross-Symbol] Error creating transferred insight:', createError);
        return null;
      }

      // Track in cluster_shared_insights
      await supabase
        .from('cluster_shared_insights')
        .upsert({
          user_id: userId,
          source_insight_id: sourceInsightId,
          source_symbol: sourceInsight.symbol,
          cluster_id: cluster.id,
          applied_to_symbols: [targetSymbol],
          original_confidence: sourceInsight.confidence_score,
          confidence_adjustment_factor: adjustmentFactor,
          first_transfer_at: new Date().toISOString(),
          last_transfer_at: new Date().toISOString()
        });

      console.log(`[Cross-Symbol] ✅ Transferred insight from ${sourceInsight.symbol} to ${targetSymbol}`);
      return newInsight.id;
    } catch (error) {
      console.error('[Cross-Symbol] Error in transferInsight:', error);
      return null;
    }
  }

  /**
   * Get cluster performance summary
   */
  async getClusterPerformance(userId: string, clusterName: string): Promise<any> {
    try {
      const cluster = await this.getClusters(userId);
      const targetCluster = cluster.find(c => c.clusterName === clusterName);

      if (!targetCluster) {
        return null;
      }

      // Get insights for all symbols in cluster
      const { data: insights } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .in('symbol', targetCluster.symbols);

      const totalInsights = insights?.length || 0;
      const transferredInsights = insights?.filter(i =>
        i.pattern_details?.transferred_from
      ).length || 0;

      // Get shared insights
      const { data: shared } = await supabase
        .from('cluster_shared_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('cluster_id', targetCluster.id);

      const avgTransferSuccess = shared && shared.length > 0
        ? shared.reduce((sum, s) => sum + (s.transfer_success_rate || 0), 0) / shared.length
        : 0;

      return {
        clusterName: targetCluster.clusterName,
        symbols: targetCluster.symbols,
        primarySymbol: targetCluster.primarySymbol,
        avgCorrelation: targetCluster.avgCorrelation,
        totalInsights,
        transferredInsights,
        sharedInsights: shared?.length || 0,
        avgTransferSuccessRate: avgTransferSuccess.toFixed(1),
        clusterWinRate: targetCluster.clusterWinRate,
        transferLearningActive: transferredInsights > 0
      };
    } catch (error) {
      console.error('[Cross-Symbol] Error getting cluster performance:', error);
      return null;
    }
  }

  /**
   * Auto-transfer highly successful insights across cluster
   */
  async autoTransferTopInsights(userId: string, minConfidence: number = 80): Promise<number> {
    try {
      let transferCount = 0;
      const clusters = await this.getClusters(userId);

      for (const cluster of clusters) {
        // Get top insights for each symbol in cluster
        for (const symbol of cluster.symbols) {
          const { data: topInsights } = await supabase
            .from('ai_learning_insights')
            .select('*')
            .eq('user_id', userId)
            .eq('symbol', symbol)
            .gte('confidence_score', minConfidence)
            .is('pattern_details->>transferred_from', null) // Only original insights
            .order('confidence_score', { ascending: false })
            .limit(3);

          if (!topInsights || topInsights.length === 0) continue;

          // Transfer to other symbols in cluster
          for (const insight of topInsights) {
            for (const targetSymbol of cluster.symbols) {
              if (targetSymbol === symbol) continue;

              // Check if already transferred
              const { data: existing } = await supabase
                .from('ai_learning_insights')
                .select('id')
                .eq('user_id', userId)
                .eq('symbol', targetSymbol)
                .eq('pattern_details->>transferred_from', symbol)
                .eq('insight_type', insight.insight_type)
                .maybeSingle();

              if (!existing) {
                const result = await this.transferInsight(userId, insight.id, targetSymbol, 0.85);
                if (result) transferCount++;
              }
            }
          }
        }
      }

      console.log(`[Cross-Symbol] 🔄 Auto-transferred ${transferCount} insights`);
      return transferCount;
    } catch (error) {
      console.error('[Cross-Symbol] Error in autoTransferTopInsights:', error);
      return 0;
    }
  }
}

export const crossSymbolClustering = new CrossSymbolClustering();
export type { SymbolCorrelation, SymbolCluster, TransferableInsight };
