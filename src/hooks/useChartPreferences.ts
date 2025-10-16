import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './useAuth';

export interface ChartPreferences {
  theme: 'dark' | 'light';
  show_volume: boolean;
  show_grid: boolean;
  show_ai_analysis: boolean;
  candlestick_up_color: string;
  candlestick_down_color: string;
  background_color: string;
  show_all_emas: boolean;
  show_ema_9: boolean;
  show_ema_21: boolean;
  show_ema_50: boolean;
  show_ema_100: boolean;
  show_ema_200: boolean;
  ema_5_color: string;
  ema_9_color: string;
  ema_21_color: string;
  ema_50_color: string;
  ema_200_color: string;
  analysis_view_mode: 'technical' | 'autotrading';
}

const DEFAULT_PREFERENCES: ChartPreferences = {
  theme: 'dark',
  show_volume: true,
  show_grid: true,
  show_ai_analysis: true,
  candlestick_up_color: '#10b981',
  candlestick_down_color: '#ef4444',
  background_color: 'rgba(15, 23, 42, 0.5)',
  show_all_emas: false,
  show_ema_9: true,
  show_ema_21: true,
  show_ema_50: false,
  show_ema_100: false,
  show_ema_200: true,
  ema_5_color: '#00ff95',
  ema_9_color: '#facc15',
  ema_21_color: '#44c0ff',
  ema_50_color: '#ff6b6b',
  ema_200_color: '#aa44ff',
  analysis_view_mode: 'technical',
};

export function useChartPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<ChartPreferences>(DEFAULT_PREFERENCES);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      setPreferences(DEFAULT_PREFERENCES);
      setIsLoading(false);
      return;
    }

    loadPreferences();
  }, [user]);

  async function loadPreferences() {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await supabase
        .from('chart_preferences')
        .select('*')
        .eq('user_id', user?.id)
        .maybeSingle();

      if (fetchError) throw fetchError;

      if (data) {
        setPreferences({
          theme: data.theme as 'dark' | 'light',
          show_volume: data.show_volume,
          show_grid: data.show_grid,
          show_ai_analysis: data.show_ai_analysis,
          candlestick_up_color: data.candlestick_up_color,
          candlestick_down_color: data.candlestick_down_color,
          background_color: data.background_color,
          show_all_emas: data.show_all_emas ?? DEFAULT_PREFERENCES.show_all_emas,
          show_ema_9: data.show_ema_9 ?? DEFAULT_PREFERENCES.show_ema_9,
          show_ema_21: data.show_ema_21 ?? DEFAULT_PREFERENCES.show_ema_21,
          show_ema_50: data.show_ema_50 ?? DEFAULT_PREFERENCES.show_ema_50,
          show_ema_100: data.show_ema_100 ?? DEFAULT_PREFERENCES.show_ema_100,
          show_ema_200: data.show_ema_200 ?? DEFAULT_PREFERENCES.show_ema_200,
          ema_5_color: data.ema_5_color ?? DEFAULT_PREFERENCES.ema_5_color,
          ema_9_color: data.ema_9_color ?? DEFAULT_PREFERENCES.ema_9_color,
          ema_21_color: data.ema_21_color ?? DEFAULT_PREFERENCES.ema_21_color,
          ema_50_color: data.ema_50_color ?? DEFAULT_PREFERENCES.ema_50_color,
          ema_200_color: data.ema_200_color ?? DEFAULT_PREFERENCES.ema_200_color,
          analysis_view_mode: (data.analysis_view_mode as 'technical' | 'autotrading') ?? DEFAULT_PREFERENCES.analysis_view_mode,
        });
      } else {
        setPreferences(DEFAULT_PREFERENCES);
      }
    } catch (err) {
      console.error('Error loading chart preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to load preferences');
      setPreferences(DEFAULT_PREFERENCES);
    } finally {
      setIsLoading(false);
    }
  }

  async function updatePreferences(updates: Partial<ChartPreferences>) {
    if (!user) {
      setPreferences(prev => ({ ...prev, ...updates }));
      return;
    }

    try {
      setError(null);
      const newPreferences = { ...preferences, ...updates };

      const { data: existing } = await supabase
        .from('chart_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        const { error: updateError } = await supabase
          .from('chart_preferences')
          .update({
            theme: newPreferences.theme,
            show_volume: newPreferences.show_volume,
            show_grid: newPreferences.show_grid,
            show_ai_analysis: newPreferences.show_ai_analysis,
            candlestick_up_color: newPreferences.candlestick_up_color,
            candlestick_down_color: newPreferences.candlestick_down_color,
            background_color: newPreferences.background_color,
            show_all_emas: newPreferences.show_all_emas,
            show_ema_9: newPreferences.show_ema_9,
            show_ema_21: newPreferences.show_ema_21,
            show_ema_50: newPreferences.show_ema_50,
            show_ema_100: newPreferences.show_ema_100,
            show_ema_200: newPreferences.show_ema_200,
            ema_5_color: newPreferences.ema_5_color,
            ema_9_color: newPreferences.ema_9_color,
            ema_21_color: newPreferences.ema_21_color,
            ema_50_color: newPreferences.ema_50_color,
            ema_200_color: newPreferences.ema_200_color,
            analysis_view_mode: newPreferences.analysis_view_mode,
          })
          .eq('user_id', user.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from('chart_preferences')
          .insert({
            user_id: user.id,
            theme: newPreferences.theme,
            show_volume: newPreferences.show_volume,
            show_grid: newPreferences.show_grid,
            show_ai_analysis: newPreferences.show_ai_analysis,
            candlestick_up_color: newPreferences.candlestick_up_color,
            candlestick_down_color: newPreferences.candlestick_down_color,
            background_color: newPreferences.background_color,
            show_all_emas: newPreferences.show_all_emas,
            show_ema_9: newPreferences.show_ema_9,
            show_ema_21: newPreferences.show_ema_21,
            show_ema_50: newPreferences.show_ema_50,
            show_ema_100: newPreferences.show_ema_100,
            show_ema_200: newPreferences.show_ema_200,
            ema_5_color: newPreferences.ema_5_color,
            ema_9_color: newPreferences.ema_9_color,
            ema_21_color: newPreferences.ema_21_color,
            ema_50_color: newPreferences.ema_50_color,
            ema_200_color: newPreferences.ema_200_color,
            analysis_view_mode: newPreferences.analysis_view_mode,
          });

        if (insertError) throw insertError;
      }

      setPreferences(newPreferences);
    } catch (err) {
      console.error('Error updating chart preferences:', err);
      setError(err instanceof Error ? err.message : 'Failed to update preferences');
    }
  }

  return {
    preferences,
    updatePreferences,
    isLoading,
    error,
  };
}
