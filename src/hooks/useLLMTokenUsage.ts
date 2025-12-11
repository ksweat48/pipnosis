import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './useAuth';

export interface BrainCostData {
  brainName: string;
  totalCalls: number;
  avgTokens: number;
  totalCost: number;
  percentage: number;
}

export interface DailyTrendData {
  date: string;
  totalCost: number;
  totalCalls: number;
}

export interface LLMTokenUsageData {
  todayCost: number;
  weekCost: number;
  monthCost: number;
  allTimeCost: number;
  todayCallCount: number;
  costByBrain: BrainCostData[];
  dailyTrend: DailyTrendData[];
  avgCostPerSession: number;
  loading: boolean;
  error: string | null;
}

export function useLLMTokenUsage(): LLMTokenUsageData {
  const { user } = useAuth();
  const [data, setData] = useState<LLMTokenUsageData>({
    todayCost: 0,
    weekCost: 0,
    monthCost: 0,
    allTimeCost: 0,
    todayCallCount: 0,
    costByBrain: [],
    dailyTrend: [],
    avgCostPerSession: 0,
    loading: true,
    error: null
  });

  useEffect(() => {
    if (!user) {
      setData(prev => ({ ...prev, loading: false }));
      return;
    }

    loadUsageData();

    // Refresh every 30 seconds
    const interval = setInterval(loadUsageData, 30000);
    return () => clearInterval(interval);
  }, [user]);

  const loadUsageData = async () => {
    if (!user) return;

    try {
      setData(prev => ({ ...prev, loading: true, error: null }));

      // Get today's date range
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

      // Get week start (7 days ago)
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekStart = weekAgo.toISOString();

      // Get month start (30 days ago)
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      const monthStart = monthAgo.toISOString();

      // Fetch today's cost and call count (ALL USERS)
      const { data: todayData, error: todayError } = await supabase
        .from('llm_token_usage')
        .select('estimated_cost_usd')
        .gte('timestamp', todayStart);

      if (todayError) throw todayError;

      const todayCost = todayData?.reduce((sum, row) => sum + (row.estimated_cost_usd || 0), 0) || 0;
      const todayCallCount = todayData?.length || 0;

      // Fetch week cost (ALL USERS)
      const { data: weekData, error: weekError } = await supabase
        .from('llm_token_usage')
        .select('estimated_cost_usd')
        .gte('timestamp', weekStart);

      if (weekError) throw weekError;

      const weekCost = weekData?.reduce((sum, row) => sum + (row.estimated_cost_usd || 0), 0) || 0;

      // Fetch month cost (ALL USERS)
      const { data: monthData, error: monthError } = await supabase
        .from('llm_token_usage')
        .select('estimated_cost_usd')
        .gte('timestamp', monthStart);

      if (monthError) throw monthError;

      const monthCost = monthData?.reduce((sum, row) => sum + (row.estimated_cost_usd || 0), 0) || 0;

      // Fetch all-time cost (ALL USERS)
      const { data: allTimeData, error: allTimeError } = await supabase
        .from('llm_token_usage')
        .select('estimated_cost_usd');

      if (allTimeError) throw allTimeError;

      const allTimeCost = allTimeData?.reduce((sum, row) => sum + (row.estimated_cost_usd || 0), 0) || 0;

      // Fetch cost by brain (last 30 days, ALL USERS)
      const { data: brainData, error: brainError } = await supabase
        .from('llm_token_usage')
        .select('brain_name, estimated_cost_usd, total_tokens')
        .gte('timestamp', monthStart);

      if (brainError) throw brainError;

      // Aggregate by brain
      const brainMap = new Map<string, { totalCalls: number; totalTokens: number; totalCost: number }>();

      brainData?.forEach(row => {
        const brain = row.brain_name || 'Unknown';
        const existing = brainMap.get(brain) || { totalCalls: 0, totalTokens: 0, totalCost: 0 };
        brainMap.set(brain, {
          totalCalls: existing.totalCalls + 1,
          totalTokens: existing.totalTokens + (row.total_tokens || 0),
          totalCost: existing.totalCost + (row.estimated_cost_usd || 0)
        });
      });

      const totalCost = Array.from(brainMap.values()).reduce((sum, b) => sum + b.totalCost, 0);

      const costByBrain: BrainCostData[] = Array.from(brainMap.entries())
        .map(([brainName, stats]) => ({
          brainName,
          totalCalls: stats.totalCalls,
          avgTokens: stats.totalCalls > 0 ? Math.round(stats.totalTokens / stats.totalCalls) : 0,
          totalCost: stats.totalCost,
          percentage: totalCost > 0 ? (stats.totalCost / totalCost) * 100 : 0
        }))
        .sort((a, b) => b.totalCost - a.totalCost);

      // Fetch daily trend (last 30 days, ALL USERS)
      const { data: dailySummary, error: dailyError } = await supabase
        .from('llm_daily_token_summary')
        .select('date, total_cost_usd, total_calls')
        .gte('date', monthStart.split('T')[0])
        .order('date', { ascending: true });

      if (dailyError) throw dailyError;

      const dailyTrend: DailyTrendData[] = dailySummary?.map(row => ({
        date: row.date,
        totalCost: row.total_cost_usd || 0,
        totalCalls: row.total_calls || 0
      })) || [];

      // Calculate avg cost per session (if we have session tracking)
      const avgCostPerSession = 0; // TODO: Implement if session tracking is added

      setData({
        todayCost,
        weekCost,
        monthCost,
        allTimeCost,
        todayCallCount,
        costByBrain,
        dailyTrend,
        avgCostPerSession,
        loading: false,
        error: null
      });

    } catch (error) {
      console.error('[useLLMTokenUsage] Error loading data:', error);
      setData(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to load token usage data'
      }));
    }
  };

  return data;
}
