import { supabase } from '@/lib/supabase';
import { AIMarketAnalysis } from '@/lib/aiMarketEngine';

export interface SavedMarketAnalysis {
  id: string;
  symbol: string;
  timeframe: string;
  trend: string;
  confidence: number;
  recommendation: string;
  reasoning: string;
  key_levels: {
    support: number[];
    resistance: number[];
  };
  risk_assessment: string;
  time_horizon: string;
  entry_strategy: string | null;
  exit_strategy: string | null;
  analysis_data: any;
  created_at: string;
}

export async function saveMarketAnalysis(
  symbol: string,
  timeframe: string,
  analysis: AIMarketAnalysis
): Promise<{ success: boolean; id?: string; error?: any }> {
  try {
    const existingAnalysis = await getRecentAnalysis(symbol, timeframe, 15);
    if (existingAnalysis) {
      console.log(`[Market Analysis Service] Using cached analysis for ${symbol} ${timeframe}`);
      return { success: true, id: existingAnalysis.id };
    }

    const { data, error } = await supabase
      .from('market_analysis')
      .insert({
        symbol,
        timeframe,
        trend: analysis.trend,
        confidence: analysis.confidence,
        recommendation: analysis.recommendation,
        reasoning: analysis.reasoning,
        key_levels: analysis.keyLevels,
        risk_assessment: analysis.riskAssessment,
        time_horizon: analysis.timeHorizon,
        entry_strategy: analysis.entryStrategy || null,
        exit_strategy: analysis.exitStrategy || null,
        analysis_data: {
          timestamp: analysis.timestamp,
          raw_analysis: analysis
        }
      })
      .select()
      .single();

    if (error) {
      console.error('[Market Analysis Service] Save failed:', error);
      return { success: false, error };
    }

    console.log(`[Market Analysis Service] Analysis saved for ${symbol} ${timeframe}`);
    return { success: true, id: data.id };

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return { success: false, error };
  }
}

export async function getRecentAnalysis(
  symbol: string,
  timeframe: string,
  maxAgeMinutes: number = 15
): Promise<SavedMarketAnalysis | null> {
  try {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('created_at', cutoffTime)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Market Analysis Service] Query failed:', error);
      return null;
    }

    return data;

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return null;
  }
}

export async function getAnalysisHistory(
  symbol: string,
  timeframe: string,
  limit: number = 10
): Promise<SavedMarketAnalysis[]> {
  try {
    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[Market Analysis Service] History query failed:', error);
      return [];
    }

    return data || [];

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return [];
  }
}

export async function getLatestAnalysis(symbol: string): Promise<SavedMarketAnalysis | null> {
  try {
    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .eq('symbol', symbol)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Market Analysis Service] Latest query failed:', error);
      return null;
    }

    return data;

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return null;
  }
}

export async function getAllRecentAnalyses(
  maxAgeMinutes: number = 30
): Promise<SavedMarketAnalysis[]> {
  try {
    const cutoffTime = new Date(Date.now() - maxAgeMinutes * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('market_analysis')
      .select('*')
      .gte('created_at', cutoffTime)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[Market Analysis Service] Bulk query failed:', error);
      return [];
    }

    return data || [];

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return [];
  }
}

export async function deleteOldAnalyses(daysOld: number = 7): Promise<{ success: boolean; deletedCount: number }> {
  try {
    const cutoffTime = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('market_analysis')
      .delete()
      .lt('created_at', cutoffTime)
      .select();

    if (error) {
      console.error('[Market Analysis Service] Cleanup failed:', error);
      return { success: false, deletedCount: 0 };
    }

    const deletedCount = data?.length || 0;
    console.log(`[Market Analysis Service] Cleaned up ${deletedCount} old analyses`);
    return { success: true, deletedCount };

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return { success: false, deletedCount: 0 };
  }
}

export async function getAnalysisStats(): Promise<{
  totalAnalyses: number;
  symbolBreakdown: Record<string, number>;
  avgConfidence: number;
  recommendationBreakdown: Record<string, number>;
}> {
  try {
    const { data, error } = await supabase
      .from('market_analysis')
      .select('symbol, confidence, recommendation');

    if (error) {
      console.error('[Market Analysis Service] Stats query failed:', error);
      return {
        totalAnalyses: 0,
        symbolBreakdown: {},
        avgConfidence: 0,
        recommendationBreakdown: {}
      };
    }

    if (!data || data.length === 0) {
      return {
        totalAnalyses: 0,
        symbolBreakdown: {},
        avgConfidence: 0,
        recommendationBreakdown: {}
      };
    }

    const symbolBreakdown: Record<string, number> = {};
    const recommendationBreakdown: Record<string, number> = {};
    let totalConfidence = 0;

    for (const analysis of data) {
      symbolBreakdown[analysis.symbol] = (symbolBreakdown[analysis.symbol] || 0) + 1;
      recommendationBreakdown[analysis.recommendation] = (recommendationBreakdown[analysis.recommendation] || 0) + 1;
      totalConfidence += analysis.confidence || 0;
    }

    return {
      totalAnalyses: data.length,
      symbolBreakdown,
      avgConfidence: totalConfidence / data.length,
      recommendationBreakdown
    };

  } catch (error) {
    console.error('[Market Analysis Service] Unexpected error:', error);
    return {
      totalAnalyses: 0,
      symbolBreakdown: {},
      avgConfidence: 0,
      recommendationBreakdown: {}
    };
  }
}
