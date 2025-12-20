/**
 * Fix Corrupted P&L Values in Database
 *
 * This script recalculates P&L for all closed trades using the correct formula
 * and updates any trades with corrupted P&L values.
 *
 * Usage: node scripts/fix-corrupted-pnl-values.js
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Helper functions from currencyHelpers.ts (replicated here for script use)
function isIndex(symbol) {
  return /^(US30|NAS100|SPX500|DJ30|NDX|SP500|DAX|FTSE)/.test(symbol);
}

function isXAUUSD(symbol) {
  return symbol.toUpperCase().includes('XAU') || symbol.toUpperCase().includes('GOLD');
}

function getCurrencyPipInfo(symbol) {
  if (isXAUUSD(symbol)) {
    return { pipValue: 0.01, symbolType: 'gold' };
  }
  if (isIndex(symbol)) {
    return { pipValue: 1.0, symbolType: 'index' };
  }
  if (symbol.includes('JPY')) {
    return { pipValue: 0.01, symbolType: 'forex' };
  }
  return { pipValue: 0.0001, symbolType: 'forex' };
}

function calculatePipDistance(symbol, price1, price2) {
  const pipInfo = getCurrencyPipInfo(symbol);
  return (price2 - price1) / pipInfo.pipValue;
}

function calculateDollarPerPip(symbol, positionSize) {
  if (isXAUUSD(symbol) || isIndex(symbol)) {
    return positionSize * 100;
  }
  return positionSize * 10;
}

function recalculatePnL(trade) {
  const pipDistance = calculatePipDistance(trade.symbol, trade.entry_price, trade.exit_price);
  const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.position_size);
  const correctedPnL = trade.direction === 'buy'
    ? pipDistance * dollarPerPip
    : -pipDistance * dollarPerPip;

  return correctedPnL;
}

async function fixCorruptedPnL() {
  console.log('🔍 Scanning for trades with corrupted P&L values...\n');

  // Fetch all closed trades
  const { data: trades, error } = await supabase
    .from('goal_session_trades')
    .select('*')
    .eq('status', 'closed')
    .not('exit_price', 'is', null)
    .order('closed_at', { ascending: false });

  if (error) {
    console.error('❌ Error fetching trades:', error);
    return;
  }

  console.log(`📊 Found ${trades.length} closed trades to analyze\n`);

  const corruptedTrades = [];
  const corrections = [];

  for (const trade of trades) {
    const originalPnL = trade.profit_loss || 0;
    const correctedPnL = recalculatePnL(trade);

    const pnlDifference = Math.abs(originalPnL - correctedPnL);
    const percentageDiff = correctedPnL !== 0 ? Math.abs(pnlDifference / correctedPnL) * 100 : 0;

    // Flag as corrupted if difference is > 10% and > $10
    if (pnlDifference > 10 && percentageDiff > 10) {
      corruptedTrades.push({
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction,
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        position_size: trade.position_size,
        originalPnL,
        correctedPnL,
        difference: pnlDifference,
        percentageDiff
      });

      corrections.push({
        id: trade.id,
        correctedPnL
      });
    }
  }

  if (corruptedTrades.length === 0) {
    console.log('✅ No corrupted P&L values found. All trades look good!\n');
    return;
  }

  console.log(`⚠️  Found ${corruptedTrades.length} trades with corrupted P&L values:\n`);

  // Display top 10 most corrupted trades
  const topCorrupted = corruptedTrades
    .sort((a, b) => b.difference - a.difference)
    .slice(0, 10);

  console.log('Top 10 Most Corrupted Trades:');
  console.log('─'.repeat(120));
  console.log(
    'Symbol'.padEnd(12) +
    'Direction'.padEnd(10) +
    'Lots'.padEnd(10) +
    'Original P&L'.padEnd(18) +
    'Correct P&L'.padEnd(18) +
    'Difference'.padEnd(18) +
    'Error %'
  );
  console.log('─'.repeat(120));

  for (const trade of topCorrupted) {
    console.log(
      trade.symbol.padEnd(12) +
      trade.direction.toUpperCase().padEnd(10) +
      trade.position_size.toFixed(2).padEnd(10) +
      `$${trade.originalPnL.toFixed(2)}`.padEnd(18) +
      `$${trade.correctedPnL.toFixed(2)}`.padEnd(18) +
      `$${trade.difference.toFixed(2)}`.padEnd(18) +
      `${trade.percentageDiff.toFixed(1)}%`
    );
  }

  console.log('─'.repeat(120));
  console.log();

  // Calculate total balance correction needed
  const totalOriginalPnL = corruptedTrades.reduce((sum, t) => sum + t.originalPnL, 0);
  const totalCorrectedPnL = corruptedTrades.reduce((sum, t) => sum + t.correctedPnL, 0);
  const totalBalanceCorrection = totalCorrectedPnL - totalOriginalPnL;

  console.log(`📊 Summary:`);
  console.log(`  • Corrupted trades: ${corruptedTrades.length}`);
  console.log(`  • Total original P&L: $${totalOriginalPnL.toFixed(2)}`);
  console.log(`  • Total corrected P&L: $${totalCorrectedPnL.toFixed(2)}`);
  console.log(`  • Balance correction: ${totalBalanceCorrection >= 0 ? '+' : ''}$${totalBalanceCorrection.toFixed(2)}`);
  console.log();

  // Ask for confirmation
  console.log('⚠️  This will update P&L values in the database.');
  console.log('   Affected users will see their account balances adjusted.\n');

  // In a real deployment, you'd want to prompt for confirmation here
  // For now, we'll add a dry-run flag

  const DRY_RUN = process.argv.includes('--dry-run');

  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to database\n');
    return;
  }

  console.log('🔧 Applying corrections...\n');

  let successCount = 0;
  let errorCount = 0;

  for (const correction of corrections) {
    const { error: updateError } = await supabase
      .from('goal_session_trades')
      .update({
        profit_loss: correction.correctedPnL
      })
      .eq('id', correction.id);

    if (updateError) {
      console.error(`❌ Failed to update trade ${correction.id}:`, updateError.message);
      errorCount++;
    } else {
      successCount++;
    }
  }

  console.log(`✅ Corrections applied:`);
  console.log(`  • Successful: ${successCount}`);
  console.log(`  • Failed: ${errorCount}`);
  console.log();

  console.log('📝 Next steps:');
  console.log('  1. Manually verify a few corrected trades in the database');
  console.log('  2. Check user account balances have been adjusted correctly');
  console.log('  3. Notify affected users about the balance adjustment');
  console.log('  4. Monitor for any new P&L calculation errors');
  console.log();
}

// Run the script
fixCorruptedPnL()
  .then(() => {
    console.log('✅ Script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
