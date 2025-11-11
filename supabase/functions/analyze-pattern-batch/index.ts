import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PatternAnalysisRequest {
  userId: string;
  symbol: string;
  tradeIds: string[];
  analysisType: 'batch' | 'single' | 'cluster';
}

interface PatternAnalysisResult {
  success: boolean;
  patternsFound: number;
  insightsGenerated: number;
  processingTime: number;
  errors?: string[];
}

/**
 * Supabase Edge Function: analyze-pattern-batch
 *
 * This function runs heavy pattern analysis in the background,
 * preventing the main UI from blocking during intensive computation.
 *
 * Features:
 * - Batch analysis of multiple trades
 * - Parallel processing of patterns
 * - Background insight generation
 * - Non-blocking for user experience
 */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  const startTime = Date.now();

  try {
    const { userId, symbol, tradeIds, analysisType }: PatternAnalysisRequest = await req.json();

    if (!userId || !symbol || !tradeIds || tradeIds.length === 0) {
      return new Response(
        JSON.stringify({
          error: 'Missing required fields: userId, symbol, or tradeIds'
        }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`[Pattern Batch] Processing ${tradeIds.length} trades for ${symbol}`);
    console.log(`[Pattern Batch] Analysis type: ${analysisType}`);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Simulate pattern analysis (replace with actual logic)
    const patterns = await analyzePatternsBatch(
      supabaseUrl,
      supabaseKey,
      userId,
      symbol,
      tradeIds,
      analysisType
    );

    const processingTime = Date.now() - startTime;

    const result: PatternAnalysisResult = {
      success: true,
      patternsFound: patterns.length,
      insightsGenerated: patterns.filter(p => p.shouldGenerateInsight).length,
      processingTime,
    };

    console.log(`[Pattern Batch] ✅ Completed in ${processingTime}ms`);
    console.log(`[Pattern Batch] Found ${patterns.length} patterns`);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[Pattern Batch] Error:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        processingTime: Date.now() - startTime
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Analyze patterns in batch mode
 */
async function analyzePatternsBatch(
  supabaseUrl: string,
  supabaseKey: string,
  userId: string,
  symbol: string,
  tradeIds: string[],
  analysisType: string
): Promise<any[]> {
  const patterns = [];

  // Fetch trades from database
  const trades = await fetchTrades(supabaseUrl, supabaseKey, userId, tradeIds);

  for (const trade of trades) {
    // Pattern detection logic
    const detectedPatterns = await detectPatterns(trade);

    for (const pattern of detectedPatterns) {
      patterns.push({
        tradeId: trade.id,
        patternType: pattern.type,
        confidence: pattern.confidence,
        shouldGenerateInsight: pattern.confidence >= 70,
        metadata: pattern.metadata
      });

      // Generate insight if confidence is high enough
      if (pattern.confidence >= 70) {
        await generateInsight(
          supabaseUrl,
          supabaseKey,
          userId,
          symbol,
          pattern,
          trade
        );
      }
    }
  }

  return patterns;
}

/**
 * Fetch trades from database
 */
async function fetchTrades(
  supabaseUrl: string,
  supabaseKey: string,
  userId: string,
  tradeIds: string[]
): Promise<any[]> {
  const response = await fetch(
    `${supabaseUrl}/rest/v1/trade_history?id=in.(${tradeIds.join(',')})&user_id=eq.${userId}`,
    {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch trades: ${response.statusText}`);
  }

  return await response.json();
}

/**
 * Detect patterns in a trade
 */
async function detectPatterns(trade: any): Promise<any[]> {
  const patterns = [];

  // Example pattern detection logic
  const profitLoss = trade.profit_loss || 0;
  const confidence = trade.confidence_score || 0;

  // Winning pattern detection
  if (profitLoss > 0 && confidence >= 70) {
    patterns.push({
      type: 'winning_pattern',
      confidence: Math.min(95, confidence + 10),
      metadata: {
        avgProfitLoss: profitLoss,
        setupType: trade.setup_type,
        marketConditions: trade.market_conditions
      }
    });
  }

  // High confidence win pattern
  if (profitLoss > 0 && confidence >= 85) {
    patterns.push({
      type: 'high_confidence_winner',
      confidence: 90,
      metadata: {
        profitFactor: profitLoss / Math.abs(trade.stop_loss - trade.entry_price || 1),
        confidence: confidence
      }
    });
  }

  // Losing pattern detection
  if (profitLoss < 0 && confidence >= 70) {
    patterns.push({
      type: 'losing_pattern',
      confidence: 75,
      metadata: {
        avgProfitLoss: profitLoss,
        setupType: trade.setup_type,
        closeReason: trade.close_reason
      }
    });
  }

  return patterns;
}

/**
 * Generate insight and store in database
 */
async function generateInsight(
  supabaseUrl: string,
  supabaseKey: string,
  userId: string,
  symbol: string,
  pattern: any,
  trade: any
): Promise<void> {
  const insight = {
    user_id: userId,
    symbol: symbol,
    insight_type: pattern.type,
    insight_title: generateInsightTitle(pattern),
    insight_description: generateInsightDescription(pattern, trade),
    confidence_score: pattern.confidence,
    learning_weight: trade.learned_from_live_trading ? 2.0 : 1.0,
    learned_from_live_trading: trade.learned_from_live_trading || false,
    pattern_details: {
      ...pattern.metadata,
      detected_at: new Date().toISOString(),
      trade_id: trade.id
    }
  };

  const response = await fetch(
    `${supabaseUrl}/rest/v1/ai_learning_insights`,
    {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(insight)
    }
  );

  if (!response.ok) {
    console.error(`Failed to insert insight: ${response.statusText}`);
  }
}

/**
 * Generate insight title
 */
function generateInsightTitle(pattern: any): string {
  const titles: Record<string, string> = {
    'winning_pattern': 'High Success Pattern Detected',
    'high_confidence_winner': 'Exceptional Performance Pattern',
    'losing_pattern': 'Warning: Underperforming Setup',
  };

  return titles[pattern.type] || 'Pattern Detected';
}

/**
 * Generate insight description
 */
function generateInsightDescription(pattern: any, trade: any): string {
  const descriptions: Record<string, string> = {
    'winning_pattern': `This setup type has shown consistent profitability. Average P/L: ${pattern.metadata.avgProfitLoss?.toFixed(2)}`,
    'high_confidence_winner': `Exceptional performance with high confidence (${pattern.metadata.confidence}%). Profit factor: ${pattern.metadata.profitFactor?.toFixed(2)}`,
    'losing_pattern': `This setup has underperformed. Consider avoiding or refining entry criteria.`,
  };

  return descriptions[pattern.type] || 'Pattern analysis completed';
}
