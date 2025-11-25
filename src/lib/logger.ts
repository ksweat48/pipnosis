export enum LogLevel {
  SILENT = 0,
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
  TRACE = 5
}

export enum LogCategory {
  BROWSER_POLLER = 'BrowserPoller',
  TICK_BUFFER = 'TickBuffer',
  BACKGROUND_AGGREGATOR = 'BackgroundAggregator',
  CHART_POLLER = 'ChartPoller',
  CHART = 'Chart',
  CHART_INIT = 'Chart Init',
  CHART_DATA = 'ChartData',
  BULK_LOADER = 'BulkLoader',
  CANDLE_VALIDATION = 'CandleValidation',
  LOAD_MONITOR = 'LoadMonitor',
  BACKFILL = 'Backfill',
  POLLING_COORDINATOR = 'GlobalPolling',
  AUTH = 'Auth',
  AI_TRADING = 'AI Trading',
  POSITION_MONITOR = 'PositionMonitor',
  TRADE_LIFECYCLE = 'Trade Lifecycle',
  LIVE_TRADE_LEARNING = 'LiveTradeLearningTrigger',
  AUTO_REFRESH = 'AutoRefresh',
  SYSTEM = 'System'
}

class Logger {
  private globalLevel: LogLevel;
  private categoryLevels: Map<string, LogLevel> = new Map();
  private isDev: boolean;

  constructor() {
    this.isDev = import.meta.env.DEV;
    // Default: WARN (only warnings and errors, no verbose polling/tick logs)
    this.globalLevel = LogLevel.WARN;
    this.loadSettings();
  }

  private loadSettings(): void {
    try {
      const stored = localStorage.getItem('log_settings');
      if (stored) {
        const settings = JSON.parse(stored);
        this.globalLevel = settings.globalLevel ?? this.globalLevel;
        if (settings.categoryLevels) {
          this.categoryLevels = new Map(Object.entries(settings.categoryLevels));
        }
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  private saveSettings(): void {
    try {
      const settings = {
        globalLevel: this.globalLevel,
        categoryLevels: Object.fromEntries(this.categoryLevels)
      };
      localStorage.setItem('log_settings', JSON.stringify(settings));
    } catch (e) {
      // Ignore storage errors
    }
  }

  setGlobalLevel(level: LogLevel): void {
    this.globalLevel = level;
    this.saveSettings();
    console.log(`[Logger] Global log level set to ${LogLevel[level]}`);
  }

  setCategoryLevel(category: LogCategory | string, level: LogLevel): void {
    this.categoryLevels.set(category, level);
    this.saveSettings();
    console.log(`[Logger] Log level for ${category} set to ${LogLevel[level]}`);
  }

  resetCategoryLevel(category: LogCategory | string): void {
    this.categoryLevels.delete(category);
    this.saveSettings();
    console.log(`[Logger] Log level for ${category} reset to global`);
  }

  private shouldLog(level: LogLevel, category?: string): boolean {
    if (category && this.categoryLevels.has(category)) {
      return level <= this.categoryLevels.get(category)!;
    }
    return level <= this.globalLevel;
  }

  private formatMessage(category: string | undefined, ...args: any[]): any[] {
    if (category) {
      return [`[${category}]`, ...args];
    }
    return args;
  }

  error(category: LogCategory | string | undefined, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR, category as string)) {
      console.error(...this.formatMessage(category as string, ...args));
    }
  }

  warn(category: LogCategory | string | undefined, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN, category as string)) {
      console.warn(...this.formatMessage(category as string, ...args));
    }
  }

  info(category: LogCategory | string | undefined, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO, category as string)) {
      console.log(...this.formatMessage(category as string, ...args));
    }
  }

  debug(category: LogCategory | string | undefined, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG, category as string)) {
      console.log(...this.formatMessage(category as string, ...args));
    }
  }

  trace(category: LogCategory | string | undefined, ...args: any[]): void {
    if (this.shouldLog(LogLevel.TRACE, category as string)) {
      console.log(...this.formatMessage(category as string, ...args));
    }
  }

  getSettings() {
    return {
      globalLevel: LogLevel[this.globalLevel],
      categoryLevels: Object.fromEntries(
        Array.from(this.categoryLevels.entries()).map(([k, v]) => [k, LogLevel[v]])
      )
    };
  }

  showHelp(): void {
    console.log(`
=== Logger Configuration ===

Current Settings:
  Global Level: ${LogLevel[this.globalLevel]}
  Category Levels: ${this.categoryLevels.size > 0 ? '\n' + Array.from(this.categoryLevels.entries()).map(([k, v]) => `    ${k}: ${LogLevel[v]}`).join('\n') : 'None'}

Log Levels (in order):
  0 = SILENT (no logs)
  1 = ERROR (only errors)
  2 = WARN (errors + warnings)
  3 = INFO (errors + warnings + info) [default dev]
  4 = DEBUG (errors + warnings + info + debug)
  5 = TRACE (all logs)

Usage:
  logger.setGlobalLevel(LogLevel.WARN)  - Set global level
  logger.setCategoryLevel(LogCategory.BROWSER_POLLER, LogLevel.DEBUG)  - Set category
  logger.resetCategoryLevel(LogCategory.BROWSER_POLLER)  - Reset category
  logger.getSettings()  - View current settings
  logger.showHelp()  - Show this help

Available Categories:
  ${Object.values(LogCategory).join('\n  ')}
    `);
  }
}

export const logger = new Logger();

// Make available globally for console access
if (typeof window !== 'undefined') {
  (window as any).logger = logger;
  (window as any).LogLevel = LogLevel;
  (window as any).LogCategory = LogCategory;
}
