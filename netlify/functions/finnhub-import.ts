import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { createFinnhubClient } from './_shared/finnhub-client';

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface ImportRequest {
  symbol: string;
  timeframe: string;
  startDate: string;
  endDate: string;
  overwrite?: boolean;
  adminKey?: string;
}

interface ImportResult {
  success: boolean;
  symbol: string;
  timeframe: string;
  candlesFetched: number;
  candlesInserted: number;
  candlesSkipped: number;
  candlesDeleted: number;
  error?: string;
  executionId?: string;
  duration: number;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  const startTime = Date.now();

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const request: ImportRequest = JSON.parse(event.body || '{}');
    const { symbol, timeframe, startDate, endDate, overwrite = false, adminKey } = request;

    if (adminKey !== process.env.ADMIN_REFRESH_KEY) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized: Invalid admin key' })
      };
    }

    if (!symbol || !timeframe || !startDate || !endDate) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Missing required parameters',
          required: ['symbol', 'timeframe', 'startDate', 'endDate']
        })
      };
    }

    console.log(`Starting Finnhub import for ${symbol} ${timeframe}`, {
      startDate,
      endDate,
      overwrite
    });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const finnhubClient = createFinnhubClient();

    const fromTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(endDate).getTime() / 1000);

    if (fromTimestamp >= toTimestamp) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'startDate must be before endDate' })
      };
    }

    let executionId: string | null = null;
    let candlesDeleted = 0;

    try {
      const { data: execution, error: execError } = await supabase
        .from('backfill_executions')
        .insert({
          symbol,
          timeframe,
          start_time: new Date(fromTimestamp * 1000).toISOString(),
          end_time: new Date(toTimestamp * 1000).toISOString(),
          status: 'in_progress',
          candles_requested: 0,
          candles_filled: 0
        })
        .select('id')
        .single();

      if (execError) {
        console.error('Failed to create execution record:', execError);
      } else {
        executionId = execution.id;
      }

      if (overwrite) {
        console.log(`Deleting existing candles for ${symbol} ${timeframe} in date range`);

        const { error: deleteError, count } = await supabase
          .from('forex_candles')
          .delete({ count: 'exact' })
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .gte('open_time', new Date(fromTimestamp * 1000).toISOString())
          .lte('open_time', new Date(toTimestamp * 1000).toISOString());

        if (deleteError) {
          console.error('Error deleting candles:', deleteError);
        } else {
          candlesDeleted = count || 0;
          console.log(`Deleted ${candlesDeleted} existing candles`);
        }
      }

      console.log(`Fetching candles from Finnhub...`);
      const candles = await finnhubClient.fetchMultipleRanges(
        symbol,
        timeframe,
        fromTimestamp,
        toTimestamp,
        7
      );

      console.log(`Received ${candles.length} candles from Finnhub`);

      if (candles.length === 0) {
        const result: ImportResult = {
          success: true,
          symbol,
          timeframe,
          candlesFetched: 0,
          candlesInserted: 0,
          candlesSkipped: 0,
          candlesDeleted,
          executionId: executionId || undefined,
          duration: Date.now() - startTime
        };

        if (executionId) {
          await supabase
            .from('backfill_executions')
            .update({
              status: 'completed',
              candles_requested: 0,
              candles_filled: 0,
              completed_at: new Date().toISOString()
            })
            .eq('id', executionId);
        }

        return {
          statusCode: 200,
          body: JSON.stringify(result)
        };
      }

      console.log(`Inserting ${candles.length} candles into database...`);

      const BATCH_SIZE = 500;
      let candlesInserted = 0;
      let candlesSkipped = 0;

      for (let i = 0; i < candles.length; i += BATCH_SIZE) {
        const batch = candles.slice(i, i + BATCH_SIZE);

        const { data: insertedData, error: insertError } = await supabase
          .from('forex_candles')
          .upsert(batch, {
            onConflict: 'symbol,timeframe,open_time',
            ignoreDuplicates: false
          })
          .select('id');

        if (insertError) {
          console.error(`Error inserting batch ${i / BATCH_SIZE + 1}:`, insertError);
          candlesSkipped += batch.length;
        } else {
          const inserted = insertedData?.length || 0;
          candlesInserted += inserted;
          console.log(`Batch ${i / BATCH_SIZE + 1}: Inserted ${inserted} candles`);
        }
      }

      if (executionId) {
        await supabase
          .from('backfill_executions')
          .update({
            status: 'completed',
            candles_requested: candles.length,
            candles_filled: candlesInserted,
            completed_at: new Date().toISOString()
          })
          .eq('id', executionId);
      }

      const result: ImportResult = {
        success: true,
        symbol,
        timeframe,
        candlesFetched: candles.length,
        candlesInserted,
        candlesSkipped,
        candlesDeleted,
        executionId: executionId || undefined,
        duration: Date.now() - startTime
      };

      console.log('Import completed:', result);

      return {
        statusCode: 200,
        body: JSON.stringify(result),
        headers: {
          'Content-Type': 'application/json'
        }
      };

    } catch (error: any) {
      console.error('Import error:', error);

      if (executionId) {
        await supabase
          .from('backfill_executions')
          .update({
            status: 'failed',
            error_message: error.message,
            completed_at: new Date().toISOString()
          })
          .eq('id', executionId);
      }

      const result: ImportResult = {
        success: false,
        symbol,
        timeframe,
        candlesFetched: 0,
        candlesInserted: 0,
        candlesSkipped: 0,
        candlesDeleted,
        error: error.message,
        executionId: executionId || undefined,
        duration: Date.now() - startTime
      };

      return {
        statusCode: 500,
        body: JSON.stringify(result),
        headers: {
          'Content-Type': 'application/json'
        }
      };
    }

  } catch (error: any) {
    console.error('Request error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    };
  }
};

export { handler };
