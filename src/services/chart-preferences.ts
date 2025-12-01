import { supabase } from '@/lib/supabase';

type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1';
type DbTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1';

interface ChartPreferences {
  [symbol: string]: Timeframe;
}

export function appTimeframeToDb(timeframe: Timeframe): string {
  // Database uses UPPERCASE format: M1, M5, H1, etc. (same as app format)
  // Ensure timeframe is uppercase to handle any legacy lowercase variants
  return timeframe.toUpperCase();
}

export function dbTimeframeToApp(dbTimeframe: string): Timeframe {
  // Database format is the same as app format (both uppercase)
  // Support legacy lowercase formats by converting to uppercase
  const normalized = dbTimeframe.toUpperCase();

  // Validate and return
  const validTimeframes: Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  if (validTimeframes.includes(normalized as Timeframe)) {
    return normalized as Timeframe;
  }

  // Handle legacy numeric-first formats (1m, 5m, 1h, etc.)
  const legacyMapping: Record<string, Timeframe> = {
    '1M': 'M1',
    '5M': 'M5',
    '15M': 'M15',
    '30M': 'M30',
    '1H': 'H1',
    '4H': 'H4',
    '1D': 'D1',
    '1W': 'W1'
  };

  return legacyMapping[normalized] || 'M1';
}

export function normalizeTimeframeToDb(timeframe: string): string {
  const upper = timeframe.toUpperCase();

  // Already in correct format (M1, M5, M15, etc.)
  const validTimeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'];
  if (validTimeframes.includes(upper)) {
    return upper;
  }

  // Convert from shorthand format (1m, 5m, 15m, 1h, etc.) to MetaTrader format (M1, M5, M15, H1, etc.)
  const conversionMap: Record<string, string> = {
    '1M': 'M1',
    '5M': 'M5',
    '15M': 'M15',
    '30M': 'M30',
    '1H': 'H1',
    '4H': 'H4',
    '1D': 'D1',
    '1W': 'W1',
    // Support lowercase variants
    '1m': 'M1',
    '5m': 'M5',
    '15m': 'M15',
    '30m': 'M30',
    '1h': 'H1',
    '4h': 'H4',
    '1d': 'D1',
    '1w': 'W1'
  };

  return conversionMap[timeframe] || conversionMap[upper] || 'M15';
}

interface IndicatorVisibility {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
}

interface IndicatorPreferencesCache {
  global: IndicatorVisibility | null;
}

const STORAGE_KEY = 'pipnosis_chart_preferences';
const INDICATOR_STORAGE_KEY = 'pipnosis_indicator_preferences';

class ChartPreferencesService {
  private preferences: ChartPreferences = {};
  private indicatorCache: IndicatorPreferencesCache = { global: null };
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
    return this.preferences[symbol] || 'M5';
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
      'H4': 240,
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
      'H4': 500,
      'D1': 365,
      'W1': 260
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
      'H4': 240000,
      'D1': 600000,
      'W1': 1800000
    };
    return intervalMap[timeframe];
  }

  private loadIndicatorPreferencesFromLocalStorage(): void {
    try {
      const stored = localStorage.getItem(INDICATOR_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.indicatorCache.global = parsed.global || null;
      }
    } catch (error) {
      console.error('Failed to load indicator preferences from localStorage:', error);
      this.indicatorCache = { global: null };
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
      ema50: false,
      ema200: false
    };
  }

  async getIndicatorVisibility(): Promise<IndicatorVisibility> {
    if (this.indicatorCache.global) {
      return this.indicatorCache.global;
    }

    if (!this.userId) {
      await this.initializeUser();
    }

    if (!this.userId) {
      const defaults = this.getDefaultIndicatorVisibility();
      this.indicatorCache.global = defaults;
      return defaults;
    }

    try {
      const { data, error } = await supabase
        .from('chart_indicator_preferences')
        .select('vwap_visible, ema20_visible, ema50_visible, ema200_visible')
        .eq('user_id', this.userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching indicator preferences:', error);
        const defaults = this.getDefaultIndicatorVisibility();
        this.indicatorCache.global = defaults;
        return defaults;
      }

      if (data) {
        const visibility: IndicatorVisibility = {
          vwap: data.vwap_visible,
          ema20: data.ema20_visible,
          ema50: data.ema50_visible,
          ema200: data.ema200_visible
        };
        this.indicatorCache.global = visibility;
        this.saveIndicatorPreferencesToLocalStorage();
        return visibility;
      }

      const defaults = this.getDefaultIndicatorVisibility();
      this.indicatorCache.global = defaults;
      return defaults;
    } catch (error) {
      console.error('Error in getIndicatorVisibility:', error);
      const defaults = this.getDefaultIndicatorVisibility();
      this.indicatorCache.global = defaults;
      return defaults;
    }
  }

  async setIndicatorVisibility(visibility: IndicatorVisibility): Promise<void> {
    this.indicatorCache.global = visibility;
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
          vwap_visible: visibility.vwap,
          ema20_visible: visibility.ema20,
          ema50_visible: visibility.ema50,
          ema200_visible: visibility.ema200,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });

      if (error) {
        console.error('Error saving indicator preferences to database:', error);
      } else {
        window.dispatchEvent(new CustomEvent('indicator-preferences-changed', {
          detail: visibility
        }));
      }
    } catch (error) {
      console.error('Error in setIndicatorVisibility:', error);
    }
  }

  async getAllIndicatorPreferences(): Promise<IndicatorVisibility | null> {
    return await this.getIndicatorVisibility();
  }

  clearIndicatorCache(): void {
    this.indicatorCache = { global: null };
    localStorage.removeItem(INDICATOR_STORAGE_KEY);
  }
}

export const chartPreferencesService = new ChartPreferencesService();
export type { Timeframe, IndicatorVisibility };
