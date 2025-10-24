import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";
import { refreshBatchSchedules } from '../../src/services/refresh-service';
import { createLogger } from './function-logger';

/**
 * Netlify Scheduled Function for Daily Automatic Refresh
 *
 * This function runs automatically on a daily schedule (configured in netlify.toml)
 * and refreshes all active schedules in the database.
 *
 * Configuration:
 * - Runs daily at 2:00 AM UTC (off-peak hours)
 * - Processes all enabled schedules from the refresh_schedules table
 * - Logs results to refresh_history table
 * - Automatically updates next_run_at for each schedule
 *
 * The schedule is configured in netlify.toml:
 * [functions."scheduled-refresh"]
 *   schedule = "0 2 * * *"
 *
 * Manual Trigger (for testing):
 * POST /.netlify/functions/scheduled-refresh
 * (No authentication required as this is an internal scheduled function)
 */

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const logger = createLogger('scheduled-refresh');
  const startTime = new Date();

  logger.info('Scheduled candle refresh starting', { time: startTime.toISOString() });

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║           SCHEDULED CANDLE REFRESH - STARTING                   ║
║           Time: ${startTime.toISOString()}                    ║
╚════════════════════════════════════════════════════════════════╝
  `);

  try {
    // Execute batch refresh
    const result = await refreshBatchSchedules();

    const endTime = new Date();
    const durationSeconds = (result.duration / 1000).toFixed(2);

    logger.success('Scheduled refresh completed', {
      totalSchedules: result.totalSchedules,
      successful: result.successful,
      failed: result.failed,
      durationSeconds
    });

    await logger.saveToDatabase(200, result.duration, {}, { result });

    console.log(`
╔════════════════════════════════════════════════════════════════╗
║           SCHEDULED CANDLE REFRESH - COMPLETED                  ║
║                                                                 ║
║  Total Schedules:  ${String(result.totalSchedules).padEnd(3)} ║
║  Successful:       ${String(result.successful).padEnd(3)} ║
║  Failed:           ${String(result.failed).padEnd(3)} ║
║  Duration:         ${durationSeconds}s                         ║
║  End Time:         ${endTime.toISOString()}                    ║
╚════════════════════════════════════════════════════════════════╝
    `);

    // Log individual results
    if (result.results.length > 0) {
      console.log('\nDetailed Results:');
      result.results.forEach((r, i) => {
        const status = r.success ? '✓' : '✗';
        const duration = (r.duration / 1000).toFixed(2);
        console.log(`  ${status} ${r.symbol} ${r.timeframe}: ${r.candlesSaved} candles saved (${duration}s)`);
        if (r.error) {
          console.log(`     Error: ${r.error}`);
        }
      });
    }

    // Return success response
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'completed',
        timestamp: endTime.toISOString(),
        totalSchedules: result.totalSchedules,
        successful: result.successful,
        failed: result.failed,
        duration: result.duration,
        results: result.results.map(r => ({
          symbol: r.symbol,
          timeframe: r.timeframe,
          success: r.success,
          candlesSaved: r.candlesSaved,
          error: r.error
        })),
        message: `Daily refresh completed: ${result.successful} successful, ${result.failed} failed`
      })
    };

  } catch (error: any) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Scheduled refresh failed', { error: errorMessage, stack: error?.stack });
    await logger.saveToDatabase(500, Date.now() - startTime.getTime(), {}, null, error);

    console.error(`
╔════════════════════════════════════════════════════════════════╗
║           SCHEDULED CANDLE REFRESH - FAILED                     ║
║           Error: ${errorMessage.substring(0, 44).padEnd(44)} ║
╚════════════════════════════════════════════════════════════════╝
    `);

    // Return error response but still with 200 status
    // (scheduled functions should not throw to avoid retries)
    return {
      statusCode: 200,
      body: JSON.stringify({
        status: 'failed',
        timestamp: new Date().toISOString(),
        error: errorMessage,
        message: 'Scheduled refresh encountered an error'
      })
    };
  }
};

export { handler };
