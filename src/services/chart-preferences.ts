import { supabase } from '@/lib/supabase';

type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'D1' | 'W1';

interface ChartPreferences {
  [symbol: string]: Timeframe;
}

interface IndicatorVisibility {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
}

interface IndicatorPreferencesCache {
  [symbol: string]: IndicatorVisibility;
}

const STORAGE_KEY = 'pipnosis_chart_preferences';
const INDICATOR_STORAGE_KEY = 'pipnosis_indicator_preferences';

class ChartPreferencesService {
  private preferences: ChartPreferences = {};
  private indicatorCache: IndicatorPreferencesCache = {};
  private userId: string | null = null;

  constructor() {
    this.loadPreferences();
    this.loadIndicatorPreferencesFromLocalStorage();
    this.initializeUser();
  }

  private async initializeUser(): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      this.userId = user?.id || null;
    } catch (error) {
      console.error('Failed to get user for chart preferences:', error);
    }
  }

  private loadPreferences(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.preferences = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load chart preferences:', error);
      this.preferences = {};
    }
  }

  private savePreferences(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.preferences));
    } catch (error) {
      console.error('Failed to save chart preferences:', error);
    }
  }

  getTimeframe(symbol: string): Timeframe {
    return this.preferences[symbol] || 'M1';
  }

  setTimeframe(symbol: string, timeframe: Timeframe): void {
    this.preferences[symbol] = timeframe;
    this.savePreferences();
  }

  getAllPreferences(): ChartPreferences {
    return { ...this.preferences };
  }

  clearPreferences(): void {
    this.preferences = {};
    localStorage.removeItem(STORAGE_KEY);
  }

  getTimeframeMinutes(timeframe: Timeframe): number {
    const timeframeMap: Record<Timeframe, number> = {
      'M1': 1,
      'M5': 5,
      'M15': 15,
      'M30': 30,
      'H1': 60,
      'D1': 1440,
      'W1': 10080
    };
    return timeframeMap[timeframe];
  }

  getDataLimit(timeframe: Timeframe): number {
    const limitMap: Record<Timeframe, number> = {
      'M1': 500,
      'M5': 500,
      'M15': 500,
      'M30': 500,
      'H1': 500,
      'D1': 365,
      'W1': 200
    };
    return limitMap[timeframe];
  }

  getPollInterval(timeframe: Timeframe): number {
    const intervalMap: Record<Timeframe, number> = {
      'M1': 5000,
      'M5': 15000,
      'M15': 30000,
      'M30': 60000,
      'H1': 120000,
      'D1': 300000,
      'W1': 600000
    };
    return intervalMap[timeframe];
  }

  private loadIndicatorPreferencesFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem(INDICATOR_STORAGE_KEY);
      if (stored) {
        this.indicatorCache = JSON.parse(stored);
      }
    } catch (error) {
      console.error('Failed to load indicator preferences from localStorage:', error);
      this.indicatorCache = {};
    }
  }

  private saveIndicatorPreferencesToLocalStorage(): void {
    try {
      localStorage.setItem(INDICATOR_STORAGE_KEY, JSON.stringify(this.indicatorCache));
    } catch (error) {
      console.error('Failed to save indicator preferences to localStorage:', error);
    }
  }

  private getDefaultIndicatorVisibility(): IndicatorVisibility {
    return {
      vwap: true,
      ema20: true,
      ema50: true,
      ema200: true
    };
  }

  async getIndicatorVisibility(symbol: string): Promise<IndicatorVisibility> {
    if (this.indicatorCache[symbol]) {
      return this.indicatorCache[symbol];
    }

    if (!this.userId) {
      await this.initializeUser();
    }

    if (!this.userId) {
      const defaults = this.getDefaultIndicatorVisibility();
      this.indicatorCache[symbol] = defaults;
      return defaults;
    }

    try {
      const { data, error } = await supabase
        .from('chart_indicator_preferences')
        .select('vwap_visible, ema20_visible, ema50_visible, ema200_visible')
        .eq('user_id', this.userId)
        .eq('symbol', symbol)
        .maybeSingle();

      if (error) {
        console.error('Error fetching indicator preferences:', error);
        const defaults = this.getDefaultIndicatorVisibility();
        this.indicatorCache[symbol] = defaults;
        return defaults;
      }

      if (data) {
        const visibility: IndicatorVisibility = {
          vwap: data.vwap_visible,
          ema20: data.ema20_visible,
          ema50: data.ema50_visible,
          ema200: data.ema200_visible
        };
        this.indicatorCache[symbol] = visibility;
        this.saveIndicatorPreferencesToLocalStorage();
        return visibility;
      }

      const defaults = this.getDefaultIndicatorVisibility();
      this.indicatorCache[symbol] = defaults;
      return defaults;
    } catch (error) {
      console.error('Error in getIndicatorVisibility:', error);
      const defaults = this.getDefaultIndicatorVisibility();
      this.indicatorCache[symbol] = defaults;
      return defaults;
    }
  }

  async setIndicatorVisibility(symbol: string, visibility: IndicatorVisibility): Promise<void> {
    this.indicatorCache[symbol] = visibility;
    this.saveIndicatorPreferencesToLocalStorage();

    if (!this.userId) {
      await this.initializeUser();
    }

    if (!this.userId) {
      console.warn('No user ID available, indicator preferences saved to localStorage only');
      return;
    }

    try {
      const { error } = await supabase
        .from('chart_indicator_preferences')
        .upsert({
          user_id: this.userId,
          symbol: symbol,
          vwap_visible: visibility.vwap,
          ema20_visible: visibility.ema20,
          ema50_visible: visibility.ema50,
          ema200_visible: visibility.ema200,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,symbol'
        });

      if (error) {
        console.error('Error saving indicator preferences to database:', error);
      }
    } catch (error) {
      console.error('Error in setIndicatorVisibility:', error);
    }
  }

  async getAllIndicatorPreferences(): Promise<Record<string, IndicatorVisibility>> {
    if (!this.userId) {
      await this.initializeUser();
    }

    if (!this.userId) {
      return this.indicatorCache;
    }

    try {
      const { data, error } = await supabase
        .from('chart_indicator_preferences')
        .select('symbol, vwap_visible, ema20_visible, ema50_visible, ema200_visible')
        .eq('user_id', this.userId);

      if (error) {
        console.error('Error fetching all indicator preferences:', error);
        return this.indicatorCache;
      }

      if (data) {
        const preferences: Record<string, IndicatorVisibility> = {};
        data.forEach(row => {
          preferences[row.symbol] = {
            vwap: row.vwap_visible,
            ema20: row.ema20_visible,
            ema50: row.ema50_visible,
            ema200: row.ema200_visible
          };
        });
        this.indicatorCache = { ...this.indicatorCache, ...preferences };
        this.saveIndicatorPreferencesToLocalStorage();
        return this.indicatorCache;
      }

      return this.indicatorCache;
    } catch (error) {
      console.error('Error in getAllIndicatorPreferences:', error);
      return this.indicatorCache;
    }
  }

  clearIndicatorCache(): void {
    this.indicatorCache = {};
    localStorage.removeItem(INDICATOR_STORAGE_KEY);
  }
}

export const chartPreferencesService = new ChartPreferencesService();
export type { Timeframe, IndicatorVisibility };
