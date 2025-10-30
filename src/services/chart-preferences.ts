type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'D1' | 'W1';

interface ChartPreferences {
  [symbol: string]: Timeframe;
}

const STORAGE_KEY = 'pipnosis_chart_preferences';

class ChartPreferencesService {
  private preferences: ChartPreferences = {};

  constructor() {
    this.loadPreferences();
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
}

export const chartPreferencesService = new ChartPreferencesService();
export type { Timeframe };
