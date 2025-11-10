import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface GapFillResult {
  symbol: string;
  timeframe: string;
  gaps_filled: number;
  candles_created: number;
}

export const handler: Handler = async (event, context) => {
  console.log('[FillCandleGaps] Starting automatic gap detection and filling...');

  try {
    const lookbackHours = 24; // Check last 24 hours for gaps

    // Call the database function to automatically fill all gaps
    const { data, error } = await supabase.rpc('auto_fill_all_gaps', {
      p_lookback_hours: lookbackHours
    });

    if (error) {
      console.error('[FillCandleGaps] Error calling gap fill function:', error);
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        })
      };
    }

    const results = data as GapFillResult[];
    const totalGaps = results.reduce((sum, r) => sum + r.gaps_filled, 0);
    const totalCandles = results.reduce((sum, r) => sum + r.candles_created, 0);

    console.log(`[FillCandleGaps] ✅ Completed: ${totalGaps} gaps filled, ${totalCandles} candles created`);

    if (results.length > 0) {
      console.log('[FillCandleGaps] Gap fill summary:');
      results.forEach(r => {
        console.log(`  - ${r.symbol} ${r.timeframe}: ${r.gaps_filled} gaps, ${r.candles_created} candles`);
      });
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        totalGapsFilled: totalGaps,
        totalCandlesCreated: totalCandles,
        details: results,
        lookbackHours,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    console.error('[FillCandleGaps] Unexpected error:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })
    };
  }
};
