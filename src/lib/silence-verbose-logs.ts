/**
 * Silence Verbose Logs - Production Console Configuration
 *
 * Sets all verbose categories to SILENT by default.
 * Only important logs (errors, trades, AI decisions) will show.
 */

import { logger, LogCategory, LogLevel } from './logger';

// Silence all verbose polling and tick logs
logger.setCategoryLevel(LogCategory.BROWSER_POLLER, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.TICK_BUFFER, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.BACKGROUND_AGGREGATOR, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.CHART_POLLER, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.CHART_DATA, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.BULK_LOADER, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.CANDLE_VALIDATION, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.LOAD_MONITOR, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.BACKFILL, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.POLLING_COORDINATOR, LogLevel.SILENT);
logger.setCategoryLevel(LogCategory.AUTO_REFRESH, LogLevel.SILENT);

// Keep important logs visible (ERROR level for these)
logger.setCategoryLevel(LogCategory.AI_TRADING, LogLevel.INFO);
logger.setCategoryLevel(LogCategory.POSITION_MONITOR, LogLevel.INFO);
logger.setCategoryLevel(LogCategory.TRADE_LIFECYCLE, LogLevel.INFO);
logger.setCategoryLevel(LogCategory.CHART, LogLevel.WARN);
logger.setCategoryLevel(LogCategory.CHART_INIT, LogLevel.WARN);

console.log('%c[Logger] Production mode: Verbose logs silenced ✅', 'color: #10b981; font-weight: bold');
console.log('%cTo enable debug logs: logger.setGlobalLevel(LogLevel.DEBUG)', 'color: #6b7280');
