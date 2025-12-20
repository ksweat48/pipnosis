import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[Platform Intelligence Aggregator] Starting daily aggregation...');

    // Call the database function to update platform stats
    const { error: statsError } = await supabase.rpc('update_platform_stats');

    if (statsError) {
      console.error('[Platform Intelligence Aggregator] Error updating stats:', statsError);
      throw statsError;
    }

    console.log('[Platform Intelligence Aggregator] ✅ Platform stats updated');

    // Aggregate recent trades into global patterns
    await aggregateGlobalPatterns(supabase);

    // Update symbol intelligence
    await updateSymbolIntelligence(supabase);

    console.log('[Platform Intelligence Aggregator] ✅ Aggregation complete');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Platform intelligence aggregated successfully'
      }),
      {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('[Platform Intelligence Aggregator] Fatal error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      }
    );
  }
});

/**
 * Aggregate recent trade analyses into global patterns
 */
async function aggregateGlobalPatterns(supabase: any): Promise<void> {
  try {
    console.log('[Aggregator] Aggregating global patterns...');

    // Get recent trade analyses that haven't been aggregated yet
    const { data: analyses, error: fetchError } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('contributed_to_global_learning', true)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1000);

    if (fetchError) {
      console.error('[Aggregator] Error fetching analyses:', fetchError);
      return;
    }

    if (!analyses || analyses.length === 0) {
      console.log('[Aggregator] No new analyses to aggregate');
      return;
    }

    console.log(`[Aggregator] Processing ${analyses.length} analyses`);

    // Group by pattern
    const patternMap = new Map();

    for (const analysis of analyses) {
      const setupType = analysis.entry_indicators_alignment?.setup || 'unknown';
      const patternId = `${analysis.symbol}_${setupType}_${analysis.direction}`;

      if (!patternMap.has(patternId)) {
        patternMap.set(patternId, {
          pattern_id: patternId,
          pattern_name: `${setupType} ${analysis.direction.toUpperCase()}`,
          symbol: analysis.symbol,
          setup_type: setupType,
          direction: analysis.direction,
          trades: [],
          wins: 0,
          losses: 0,
          breakevens: 0,
          total_pnl: 0,
          total_rr: 0
        });
      }

      const pattern = patternMap.get(patternId);
      pattern.trades.push(analysis);

      if (analysis.outcome === 'win') pattern.wins++;
      else if (analysis.outcome === 'loss') pattern.losses++;
      else pattern.breakevens++;

      pattern.total_pnl += analysis.pnl || 0;
      pattern.total_rr += analysis.risk_reward_at_entry || 0;
    }

    // Update or insert patterns
    for (const [patternId, patternData] of patternMap) {
      const totalTrades = patternData.trades.length;
      const winRate = totalTrades > 0 ? (patternData.wins / totalTrades) * 100 : 0;
      const avgRR = totalTrades > 0 ? patternData.total_rr / totalTrades : 0;
      const grossProfit = patternData.wins > 0 ? patternData.total_pnl / patternData.wins : 0;
      const grossLoss = patternData.losses > 0 ? Math.abs(patternData.total_pnl) / patternData.losses : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

      // Check if pattern exists
      const { data: existing } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .eq('pattern_id', patternId)
        .maybeSingle();

      if (existing) {
        // Update existing pattern
        await supabase
          .from('ai_global_patterns')
          .update({
            total_occurrences: existing.total_occurrences + totalTrades,
            win_count: existing.win_count + patternData.wins,
            loss_count: existing.loss_count + patternData.losses,
            breakeven_count: existing.breakeven_count + patternData.breakevens,
            win_rate: ((existing.win_count + patternData.wins) / (existing.total_occurrences + totalTrades)) * 100,
            profit_factor: profitFactor,
            avg_rr: ((existing.avg_rr * existing.total_occurrences) + (avgRR * totalTrades)) / (existing.total_occurrences + totalTrades),
            last_occurrence_at: new Date().toISOString(),
            sample_size_adequate: (existing.total_occurrences + totalTrades) >= 10,
            statistical_significance: (existing.total_occurrences + totalTrades) >= 30 ? 0.95 : (existing.total_occurrences + totalTrades) >= 10 ? 0.80 : 0.50,
            updated_at: new Date().toISOString()
          })
          .eq('pattern_id', patternId);
      } else {
        // Create new pattern
        await supabase
          .from('ai_global_patterns')
          .insert({
            pattern_id: patternId,
            pattern_name: patternData.pattern_name,
            symbol: patternData.symbol,
            setup_type: patternData.setup_type,
            direction: patternData.direction,
            total_occurrences: totalTrades,
            win_count: patternData.wins,
            loss_count: patternData.losses,
            breakeven_count: patternData.breakevens,
            win_rate: winRate,
            profit_factor: profitFactor,
            avg_rr: avgRR,
            last_occurrence_at: new Date().toISOString(),
            discovery_date: new Date().toISOString(),
            sample_size_adequate: totalTrades >= 10,
            statistical_significance: totalTrades >= 30 ? 0.95 : totalTrades >= 10 ? 0.80 : 0.50
          });
      }
    }

    console.log(`[Aggregator] ✅ Updated ${patternMap.size} patterns`);
  } catch (error) {
    console.error('[Aggregator] Error aggregating patterns:', error);
  }
}

/**
 * Update symbol intelligence
 */
async function updateSymbolIntelligence(supabase: any): Promise<void> {
  try {
    console.log('[Aggregator] Updating symbol intelligence...');

    // Get all symbols from recent trades
    const { data: analyses, error } = await supabase
      .from('ai_trade_analysis')
      .select('symbol, outcome, pnl')
      .eq('contributed_to_global_learning', true)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    if (error || !analyses) {
      console.error('[Aggregator] Error fetching symbol data:', error);
      return;
    }

    // Group by symbol
    const symbolMap = new Map();

    for (const analysis of analyses) {
      if (!symbolMap.has(analysis.symbol)) {
        symbolMap.set(analysis.symbol, {
          symbol: analysis.symbol,
          trades: [],
          wins: 0,
          losses: 0,
          total_pnl: 0
        });
      }

      const symbolData = symbolMap.get(analysis.symbol);
      symbolData.trades.push(analysis);

      if (analysis.outcome === 'win') symbolData.wins++;
      else if (analysis.outcome === 'loss') symbolData.losses++;

      symbolData.total_pnl += analysis.pnl || 0;
    }

    // Update or insert symbol intelligence
    for (const [symbol, symbolData] of symbolMap) {
      const totalTrades = symbolData.trades.length;
      const winRate = totalTrades > 0 ? (symbolData.wins / totalTrades) * 100 : 0;
      const grossProfit = symbolData.wins > 0 ? symbolData.total_pnl / symbolData.wins : 0;
      const grossLoss = symbolData.losses > 0 ? Math.abs(symbolData.total_pnl) / symbolData.losses : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

      const { data: existing } = await supabase
        .from('ai_global_symbol_intelligence')
        .select('*')
        .eq('symbol', symbol)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('ai_global_symbol_intelligence')
          .update({
            total_trades_platform_wide: existing.total_trades_platform_wide + totalTrades,
            platform_win_rate: ((existing.platform_win_rate * existing.total_trades_platform_wide) + (winRate * totalTrades)) / (existing.total_trades_platform_wide + totalTrades),
            platform_profit_factor: profitFactor,
            intelligence_quality_score: Math.min(100, (existing.total_trades_platform_wide + totalTrades) * 0.5),
            last_pattern_discovered_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('symbol', symbol);
      } else {
        await supabase
          .from('ai_global_symbol_intelligence')
          .insert({
            symbol: symbol,
            total_trades_platform_wide: totalTrades,
            platform_win_rate: winRate,
            platform_profit_factor: profitFactor,
            best_timeframes: ['H1', 'H4'],
            best_session_times: ['London', 'NewYork'],
            intelligence_quality_score: Math.min(100, totalTrades * 0.5),
            last_pattern_discovered_at: new Date().toISOString()
          });
      }
    }

    console.log(`[Aggregator] ✅ Updated ${symbolMap.size} symbols`);
  } catch (error) {
    console.error('[Aggregator] Error updating symbol intelligence:', error);
  }
}
