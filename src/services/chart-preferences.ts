import { supabase } from '@/lib/supabase';
import {
  type Timeframe,
  formatTimeframeForDb,
  normalizeTimeframe,
  TIMEFRAME_MINUTES,
  TIMEFRAME_POLL_INTERVALS,
  TIMEFRAME_LIMITS,
} from '@/config/timeframe-hierarchy';

interface ChartPreferences {
  [symbol: string]: Timeframe;
}

export function appTimeframeToDb(timeframe: Timeframe): string {
  return formatTimeframeForDb(timeframe);
}

export function dbTimeframeToApp(dbTimeframe: string): Timeframe {
  return normalizeTimeframe(dbTimeframe);
}

export function normalizeTimeframeToDb(timeframe: string): string {
  return formatTimeframeForDb(normalizeTimeframe(timeframe));
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
const SELECTED_SYMBOL_KEY = 'pipnosis_selected_symbol';
const SESSION_BANDS_KEY = 'pipnosis_session_bands';
const DAY_SEPARATORS_KEY = 'pipnosis_day_separators';

class ChartPreferencesService {
  private preferences: ChartPreferences = {};
  private indicatorCache: IndicatorPreferencesCache = { global: null };
  private userId: string | null = null;
  private selectedSymbol: string = 'EURUSD';

  constructor() {
    this.loadPreferences();
    this.loadIndicatorPreferencesFromLocalStorage();
    this.loadSelectedSymbol();
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
    return this.preferences[symbol] || 'H1';
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
    return TIMEFRAME_MINUTES[timeframe];
  }

  getDataLimit(timeframe: Timeframe): number {
    return TIMEFRAME_LIMITS[timeframe].displayLimit;
  }

  getPollInterval(timeframe: Timeframe): number {
    return TIMEFRAME_POLL_INTERVALS[timeframe];
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

  private loadSelectedSymbol(): void {
    try {
      const stored = localStorage.getItem(SELECTED_SYMBOL_KEY);
      if (stored) {
        this.selectedSymbol = stored;
      }
    } catch (error) {
      console.error('Failed to load selected symbol:', error);
      this.selectedSymbol = 'EURUSD';
    }
  }

  getSelectedSymbol(): string {
    return this.selectedSymbol;
  }

  setSelectedSymbol(symbol: string): void {
    this.selectedSymbol = symbol;
    try {
      localStorage.setItem(SELECTED_SYMBOL_KEY, symbol);
    } catch (error) {
      console.error('Failed to save selected symbol:', error);
    }
  }

  clearSelectedSymbol(): void {
    this.selectedSymbol = 'EURUSD';
    localStorage.removeItem(SELECTED_SYMBOL_KEY);
  }

  getShowSessionBands(): boolean {
    try {
      const stored = localStorage.getItem(SESSION_BANDS_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  }

  setShowSessionBands(value: boolean): void {
    try {
      localStorage.setItem(SESSION_BANDS_KEY, String(value));
      window.dispatchEvent(new CustomEvent('session-bands-changed', { detail: value }));
    } catch {
      // ignore
    }
  }

  getShowDaySeparators(): boolean {
    try {
      const stored = localStorage.getItem(DAY_SEPARATORS_KEY);
      return stored !== null ? stored === 'true' : true;
    } catch {
      return true;
    }
  }

  setShowDaySeparators(value: boolean): void {
    try {
      localStorage.setItem(DAY_SEPARATORS_KEY, String(value));
      window.dispatchEvent(new CustomEvent('day-separators-changed', { detail: value }));
    } catch {
      // ignore
    }
  }
}

export const chartPreferencesService = new ChartPreferencesService();
export type { Timeframe, IndicatorVisibility };
