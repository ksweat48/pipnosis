/**
 * AI Indicator Tracker - Type Definitions
 *
 * This file provides stub implementations for AI indicator tracking.
 * The actual functionality would need to be implemented based on requirements.
 */

export interface IndicatorExperiment {
  id: string;
  indicator_name: string;
  status: 'testing' | 'validated' | 'rejected';
  confidence_score: number;
  win_rate: number;
  sample_size: number;
  created_at: string;
}

export interface IndicatorEffectiveness {
  indicator_name: string;
  total_signals: number;
  profitable_signals: number;
  win_rate: number;
  avg_profit_factor: number;
}

export const aiIndicatorTracker = {
  getAdoptedIndicators: async () => {
    console.warn('[ai-indicator-tracker] getAdoptedIndicators called but not implemented');
    return [];
  },

  getActiveExperiments: async () => {
    console.warn('[ai-indicator-tracker] getActiveExperiments called but not implemented');
    return [];
  },

  getIndicatorEffectiveness: async (indicatorName: string) => {
    console.warn('[ai-indicator-tracker] getIndicatorEffectiveness called but not implemented');
    return null;
  }
};
