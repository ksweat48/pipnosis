import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export type AnalysisViewMode = 'technical' | 'autotrading';

export function useAnalysisViewMode() {
  const { user } = useAuth();
  const [viewMode, setViewMode] = useState<AnalysisViewMode>('technical');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setViewMode('technical');
      setIsLoading(false);
      return;
    }

    loadViewMode();

    const subscription = supabase
      .channel('chart_prefs_changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chart_preferences',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          if (payload.new && 'analysis_view_mode' in payload.new) {
            setViewMode(payload.new.analysis_view_mode as AnalysisViewMode);
          }
        }
      )
      .subscribe();

    return () => {
      subscription.unsubscribe();
    };
  }, [user]);

  const loadViewMode = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('chart_preferences')
        .select('analysis_view_mode')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('Error loading view mode:', error);
        setViewMode('technical');
      } else if (data) {
        setViewMode(data.analysis_view_mode as AnalysisViewMode);
      } else {
        setViewMode('technical');
      }
    } catch (error) {
      console.error('Error in loadViewMode:', error);
      setViewMode('technical');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleViewMode = useCallback(async () => {
    if (!user) return;

    const newMode: AnalysisViewMode = viewMode === 'technical' ? 'autotrading' : 'technical';

    setViewMode(newMode);

    try {
      const { data: existingPrefs } = await supabase
        .from('chart_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingPrefs) {
        await supabase
          .from('chart_preferences')
          .update({
            analysis_view_mode: newMode,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('chart_preferences')
          .insert({
            user_id: user.id,
            analysis_view_mode: newMode,
            chart_type: 'candlestick',
            show_grid: true,
            show_volume: true
          });
      }

      console.log(`View mode changed to: ${newMode}`);
    } catch (error) {
      console.error('Error saving view mode:', error);
      setViewMode(viewMode);
    }
  }, [user, viewMode]);

  const setMode = useCallback(async (mode: AnalysisViewMode) => {
    if (!user || viewMode === mode) return;

    setViewMode(mode);

    try {
      const { data: existingPrefs } = await supabase
        .from('chart_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingPrefs) {
        await supabase
          .from('chart_preferences')
          .update({
            analysis_view_mode: mode,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('chart_preferences')
          .insert({
            user_id: user.id,
            analysis_view_mode: mode,
            chart_type: 'candlestick',
            show_grid: true,
            show_volume: true
          });
      }

      console.log(`View mode set to: ${mode}`);
    } catch (error) {
      console.error('Error setting view mode:', error);
    }
  }, [user, viewMode]);

  return {
    viewMode,
    isLoading,
    toggleViewMode,
    setMode,
    isTechnical: viewMode === 'technical',
    isAutoTrading: viewMode === 'autotrading'
  };
}
