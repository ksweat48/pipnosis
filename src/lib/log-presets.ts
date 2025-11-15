import { logger, LogLevel, LogCategory } from './logger';

/**
 * Pre-configured logging presets for common scenarios
 */
export const logPresets = {
  /**
   * Production mode: Only show errors
   */
  production: () => {
    logger.setGlobalLevel(LogLevel.ERROR);
    console.log('✅ Logging preset: PRODUCTION (errors only)');
  },

  /**
   * Quiet mode: Show errors and warnings
   */
  quiet: () => {
    logger.setGlobalLevel(LogLevel.WARN);
    console.log('✅ Logging preset: QUIET (errors + warnings)');
  },

  /**
   * Normal mode: Show errors, warnings, and info
   */
  normal: () => {
    logger.setGlobalLevel(LogLevel.INFO);
    console.log('✅ Logging preset: NORMAL (errors + warnings + info)');
  },

  /**
   * Debug mode: Show everything except trace
   */
  debug: () => {
    logger.setGlobalLevel(LogLevel.DEBUG);
    console.log('✅ Logging preset: DEBUG (errors + warnings + info + debug)');
  },

  /**
   * Verbose mode: Show everything
   */
  verbose: () => {
    logger.setGlobalLevel(LogLevel.TRACE);
    console.log('✅ Logging preset: VERBOSE (all logs)');
  },

  /**
   * Chart debugging: Only show chart-related logs
   */
  chartDebug: () => {
    logger.setGlobalLevel(LogLevel.WARN);
    logger.setCategoryLevel(LogCategory.CHART, LogLevel.DEBUG);
    logger.setCategoryLevel(LogCategory.CHART_INIT, LogLevel.DEBUG);
    logger.setCategoryLevel(LogCategory.CHART_DATA, LogLevel.DEBUG);
    logger.setCategoryLevel(LogCategory.CHART_POLLER, LogLevel.DEBUG);
    logger.setCategoryLevel(LogCategory.BULK_LOADER, LogLevel.DEBUG);
    console.log('✅ Logging preset: CHART_DEBUG (chart systems detailed)');
  },

  /**
   * Price data debugging: Only show price polling and tick buffer
   */
  priceDebug: () => {
    logger.setGlobalLevel(LogLevel.WARN);
    logger.setCategoryLevel(LogCategory.BROWSER_POLLER, LogLevel.DEBUG);
    logger.setCategoryLevel(LogCategory.TICK_BUFFER, LogLevel.DEBUG);
    logger.setCategoryLevel(LogCategory.BACKGROUND_AGGREGATOR, LogLevel.DEBUG);
    console.log('✅ Logging preset: PRICE_DEBUG (price polling detailed)');
  },

  /**
   * Silent mode: No logs at all
   */
  silent: () => {
    logger.setGlobalLevel(LogLevel.SILENT);
    console.log('✅ Logging preset: SILENT (all logs disabled)');
  },

  /**
   * Reset to defaults
   */
  reset: () => {
    logger.setGlobalLevel(LogLevel.INFO);
    Object.values(LogCategory).forEach(cat => {
      logger.resetCategoryLevel(cat);
    });
    console.log('✅ Logging preset: RESET (back to defaults)');
  },

  /**
   * Show help
   */
  help: () => {
    console.log(`
=== Logging Presets ===

Quick presets (call from console):
  logPresets.production()  - Only errors
  logPresets.quiet()       - Errors + warnings
  logPresets.normal()      - Errors + warnings + info (default)
  logPresets.debug()       - Errors + warnings + info + debug
  logPresets.verbose()     - All logs including trace
  logPresets.silent()      - No logs at all

Specialized presets:
  logPresets.chartDebug()  - Only chart system logs
  logPresets.priceDebug()  - Only price polling logs
  logPresets.reset()       - Reset to defaults

Advanced configuration:
  logger.showHelp()        - Show advanced logger help
  logger.getSettings()     - View current settings

Example:
  > logPresets.quiet()
  > logger.setCategoryLevel(LogCategory.CHART, LogLevel.DEBUG)
    `);
  }
};

// Make available globally for console access
if (typeof window !== 'undefined') {
  (window as any).logPresets = logPresets;
}
