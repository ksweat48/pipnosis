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
}

const DEFAULT_PREFERENCES: ChartPreferences = {
  theme: 'dark',
  show_volume: true,
  show_grid: true,
  show_ai_analysis: true,
  candlestick_up_color: '#10b981',
  candlestick_down_color: '#ef4444',
  background_color: 'rgba(15, 23, 42, 0.5)',
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
