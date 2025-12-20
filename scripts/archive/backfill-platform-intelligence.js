/**
 * Backfill Platform Intelligence from Existing Trade Analyses
 *
 * This script populates the platform intelligence tables (ai_global_patterns,
 * ai_global_symbol_intelligence) from existing trade analyses that were created
 * before the RLS policies were fixed.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * Main backfill function
 */
async function backfillPlatformIntelligence() {
  console.log('🚀 Starting Platform Intelligence Backfill...\n');

  try {
    // Step 1: Fetch all trade analyses marked for contribution
    console.log('📊 Fetching trade analyses...');
    const { data: analyses, error: analysesError } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('contributed_to_global_learning', true)
      .not('live_trade_id', 'is', null);

    if (analysesError) {
      console.error('❌ Error fetching analyses:', analysesError);
      return;
    }

    console.log(`✅ Found ${analyses.length} trade analyses to process`);

    // Fetch corresponding trades
    console.log('📊 Fetching corresponding trade data...');
    const tradeIds = analyses.map(a => a.live_trade_id);
    const { data: trades, error: tradesError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .in('id', tradeIds);

    if (tradesError) {
      console.error('❌ Error fetching trades:', tradesError);
      return;
    }

    console.log(`✅ Found ${trades.length} corresponding trades`);

    // Create a map for quick lookup
    const tradeMap = new Map(trades.map(t => [t.id, t]));

    // Attach trade data to analyses
    for (const analysis of analyses) {
      analysis.live_trade = tradeMap.get(analysis.live_trade_id);
    }

    console.log(`✅ ${analyses.length} trade analyses ready to process\n`);

    // Step 2: Aggregate by pattern
    console.log('🔍 Aggregating patterns...');
    const patternMap = new Map();

    for (const analysis of analyses) {
      if (!analysis.live_trade) continue;

      const trade = analysis.live_trade;
      const setupType = analysis.entry_indicators_alignment?.setup || 'Unknown';
      const patternId = `${trade.symbol}_${setupType}_${trade.direction}`;

      if (!patternMap.has(patternId)) {
        patternMap.set(patternId, {
          pattern_id: patternId,
          pattern_name: `${setupType} ${trade.direction.toUpperCase()}`,
          symbol: trade.symbol,
          setup_type: setupType,
          direction: trade.direction,
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

      if (analysis.outcome === 'win') {
        pattern.wins++;
      } else if (analysis.outcome === 'loss') {
        pattern.losses++;
      } else {
        pattern.breakevens++;
      }

      pattern.total_pnl += analysis.pnl || 0;
      pattern.total_rr += analysis.risk_reward_at_entry || 0;
    }

    console.log(`✅ Found ${patternMap.size} unique patterns\n`);

    // Step 3: Insert or update patterns
    console.log('📝 Updating ai_global_patterns...');
    let patternsCreated = 0;
    let patternsUpdated = 0;

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
        const { error: updateError } = await supabase
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

        if (updateError) {
          console.error(`❌ Error updating pattern ${patternId}:`, updateError);
        } else {
          patternsUpdated++;
        }
      } else {
        // Create new pattern
        const { error: insertError } = await supabase
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

        if (insertError) {
          console.error(`❌ Error inserting pattern ${patternId}:`, insertError);
        } else {
          patternsCreated++;
        }
      }
    }

    console.log(`✅ Patterns created: ${patternsCreated}`);
    console.log(`✅ Patterns updated: ${patternsUpdated}\n`);

    // Step 4: Aggregate by symbol
    console.log('🔍 Aggregating symbols...');
    const symbolMap = new Map();

    for (const analysis of analyses) {
      if (!analysis.live_trade) continue;

      const trade = analysis.live_trade;
      const symbol = trade.symbol;

      if (!symbolMap.has(symbol)) {
        symbolMap.set(symbol, {
          symbol: symbol,
          trades: [],
          wins: 0,
          losses: 0,
          total_pnl: 0
        });
      }

      const symbolData = symbolMap.get(symbol);
      symbolData.trades.push(analysis);

      if (analysis.outcome === 'win') {
        symbolData.wins++;
      } else if (analysis.outcome === 'loss') {
        symbolData.losses++;
      }

      symbolData.total_pnl += analysis.pnl || 0;
    }

    console.log(`✅ Found ${symbolMap.size} unique symbols\n`);

    // Step 5: Insert or update symbol intelligence
    console.log('📝 Updating ai_global_symbol_intelligence...');
    let symbolsCreated = 0;
    let symbolsUpdated = 0;

    for (const [symbol, symbolData] of symbolMap) {
      const totalTrades = symbolData.trades.length;
      const winRate = totalTrades > 0 ? (symbolData.wins / totalTrades) * 100 : 0;
      const avgProfit = totalTrades > 0 ? symbolData.total_pnl / totalTrades : 0;
      const grossProfit = symbolData.wins > 0 ? symbolData.total_pnl / symbolData.wins : 0;
      const grossLoss = symbolData.losses > 0 ? Math.abs(symbolData.total_pnl) / symbolData.losses : 0;
      const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

      // Check if symbol exists
      const { data: existing } = await supabase
        .from('ai_global_symbol_intelligence')
        .select('*')
        .eq('symbol', symbol)
        .maybeSingle();

      if (existing) {
        // Update existing symbol
        const { error: updateError } = await supabase
          .from('ai_global_symbol_intelligence')
          .update({
            total_trades_platform_wide: existing.total_trades_platform_wide + totalTrades,
            platform_win_rate: ((existing.platform_win_rate * existing.total_trades_platform_wide) + (winRate * totalTrades)) / (existing.total_trades_platform_wide + totalTrades),
            platform_profit_factor: profitFactor,
            intelligence_quality_score: Math.min(100, (existing.total_trades_platform_wide + totalTrades) * 0.5),
            updated_at: new Date().toISOString()
          })
          .eq('symbol', symbol);

        if (updateError) {
          console.error(`❌ Error updating symbol ${symbol}:`, updateError);
        } else {
          symbolsUpdated++;
        }
      } else {
        // Create new symbol
        const { error: insertError } = await supabase
          .from('ai_global_symbol_intelligence')
          .insert({
            symbol: symbol,
            total_trades_platform_wide: totalTrades,
            platform_win_rate: winRate,
            platform_profit_factor: profitFactor,
            best_timeframes: ['H1', 'H4'],
            best_session_times: ['London', 'NewYork'],
            intelligence_quality_score: Math.min(100, totalTrades * 0.5)
          });

        if (insertError) {
          console.error(`❌ Error inserting symbol ${symbol}:`, insertError);
        } else {
          symbolsCreated++;
        }
      }
    }

    console.log(`✅ Symbols created: ${symbolsCreated}`);
    console.log(`✅ Symbols updated: ${symbolsUpdated}\n`);

    // Step 6: Update platform stats
    console.log('📝 Updating ai_platform_learning_stats...');

    const totalTrades = analyses.length;
    const totalWins = analyses.filter(a => a.outcome === 'win').length;
    const platformWinRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const totalPnl = analyses.reduce((sum, a) => sum + (a.pnl || 0), 0);
    const totalProfitTrades = analyses.filter(a => (a.pnl || 0) > 0);
    const totalLossTrades = analyses.filter(a => (a.pnl || 0) < 0);
    const grossProfit = totalProfitTrades.reduce((sum, a) => sum + (a.pnl || 0), 0);
    const grossLoss = Math.abs(totalLossTrades.reduce((sum, a) => sum + (a.pnl || 0), 0));
    const platformProfitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

    const { data: statsData } = await supabase
      .from('ai_platform_learning_stats')
      .select('*')
      .eq('stat_date', new Date().toISOString().split('T')[0])
      .maybeSingle();

    if (statsData) {
      await supabase
        .from('ai_platform_learning_stats')
        .update({
          total_trades_analyzed: statsData.total_trades_analyzed + totalTrades,
          total_patterns_discovered: statsData.total_patterns_discovered + patternsCreated,
          total_symbols_tracked: symbolMap.size,
          platform_win_rate: platformWinRate,
          platform_profit_factor: platformProfitFactor,
          unique_users_contributing: new Set(analyses.map(a => a.user_id)).size,
          updated_at: new Date().toISOString()
        })
        .eq('stat_date', new Date().toISOString().split('T')[0]);
    }

    console.log('✅ Platform stats updated\n');

    // Summary
    console.log('═══════════════════════════════════════');
    console.log('📊 BACKFILL COMPLETE!');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Processed ${totalTrades} trade analyses`);
    console.log(`✅ Created ${patternsCreated} new patterns`);
    console.log(`✅ Updated ${patternsUpdated} existing patterns`);
    console.log(`✅ Created ${symbolsCreated} new symbols`);
    console.log(`✅ Updated ${symbolsUpdated} existing symbols`);
    console.log(`✅ Platform Win Rate: ${platformWinRate.toFixed(2)}%`);
    console.log(`✅ Platform Profit Factor: ${platformProfitFactor.toFixed(2)}`);
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    process.exit(1);
  }
}

// Run the backfill
backfillPlatformIntelligence()
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
