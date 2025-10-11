/**
 * Analyze Market Endpoint
 * Manually triggers market analysis for a specific symbol and timeframe
 */

import { Handler, HandlerEvent, HandlerContext } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface Candle {
  time: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const handler: Handler = async (event: HandlerEvent, context: HandlerContext) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { symbol, timeframe, candleCount = 100 } = JSON.parse(event.body || '{}');

    if (!symbol || !timeframe) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: 'Missing required parameters: symbol and timeframe'
        })
      };
    }

    const validSymbols = ['EURUSD', 'GBPUSD', 'XAUUSD'];
    const validTimeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

    if (!validSymbols.includes(symbol)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: `Invalid symbol. Must be one of: ${validSymbols.join(', ')}`
        })
      };
    }

    if (!validTimeframes.includes(timeframe)) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: `Invalid timeframe. Must be one of: ${validTimeframes.join(', ')}`
        })
      };
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Supabase configuration missing' })
      };
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`📊 Fetching ${candleCount} candles for ${symbol} ${timeframe}...`);

    const { data: candles, error: fetchError } = await supabase
      .from('historical_candles')
      .select('time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('time', { ascending: false })
      .limit(candleCount);

    if (fetchError) {
      console.error('❌ Failed to fetch candles:', fetchError);
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Failed to fetch candle data' })
      };
    }

    if (!candles || candles.length < 20) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: `Insufficient candle data for ${symbol} ${timeframe}. Found ${candles?.length || 0}, need at least 20.`
        })
      };
    }

    const sortedCandles = [...candles].reverse();

    const { analyzeMarket } = await import('../../src/lib/aiMarketEngine');

    console.log(`🤖 Analyzing ${sortedCandles.length} candles for ${symbol} ${timeframe}...`);

    const analysis = await analyzeMarket(sortedCandles);

    const { saveMarketAnalysis } = await import('../../src/services/marketAnalysisService');

    const saveResult = await saveMarketAnalysis(symbol, timeframe, analysis);

    if (!saveResult.success) {
      console.error('❌ Failed to save analysis:', saveResult.error);
    }

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        success: true,
        symbol,
        timeframe,
        analysis,
        saved: saveResult.success
      })
    };

  } catch (error) {
    console.error('❌ Analysis error:', error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      })
    };
  }
};

export { handler };
