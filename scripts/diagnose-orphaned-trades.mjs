import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function diagnoseOrphanedTrades() {
  console.log('='.repeat(100));
  console.log('ORPHANED TRADES DIAGNOSTIC REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(100));
  console.log('');

  // 1. Check summary view
  console.log('📊 ORPHANED TRADES SUMMARY');
  console.log('━'.repeat(100));

  const { data: summary, error: summaryError } = await supabase
    .from('admin_orphaned_trades_summary')
    .select('*')
    .single();

  if (summaryError) {
    console.error('❌ Error fetching summary:', summaryError.message);
  } else if (summary && summary.total_orphaned_trades > 0) {
    console.log(`   Total Orphaned Trades: ${summary.total_orphaned_trades}`);
    console.log(`   Affected Users: ${summary.affected_users}`);
    console.log(`   Trades with Deleted Sessions: ${summary.trades_with_deleted_sessions}`);
    console.log(`   Trades with Completed Sessions: ${summary.trades_with_completed_sessions}`);
    console.log(`   Trades with Stopped Sessions: ${summary.trades_with_stopped_sessions}`);
    console.log(`   Stale Trades (>24h): ${summary.stale_trades_over_24h}`);
    console.log(`   Oldest Open Trade: ${new Date(summary.oldest_open_trade).toLocaleString()}`);
    console.log(`   Oldest Trade Age: ${Number(summary.oldest_trade_hours).toFixed(1)} hours`);
  } else {
    console.log('   ✅ No orphaned trades found!');
  }

  // 2. Check specific orphaned trades using RPC
  console.log('\n\n🔍 DETAILED ORPHANED TRADES');
  console.log('━'.repeat(100));

  const { data: orphanedTrades, error: orphanedError } = await supabase
    .rpc('admin_find_orphaned_trades');

  if (orphanedError) {
    console.error('❌ Error finding orphaned trades:', orphanedError.message);
    if (orphanedError.message.includes('Admin access required')) {
      console.log('\n⚠️  This function requires admin authentication.');
      console.log('   Please run this script while logged in as an admin user.');
    }
  } else if (orphanedTrades && orphanedTrades.length > 0) {
    console.log(`Found ${orphanedTrades.length} orphaned trades:\n`);

    orphanedTrades.forEach((trade, idx) => {
      console.log(`${idx + 1}. Trade ${trade.trade_id}`);
      console.log(`   User: ${trade.user_email}`);
      console.log(`   Symbol: ${trade.symbol} ${trade.direction.toUpperCase()}`);
      console.log(`   Entry Price: ${trade.entry_price}`);
      console.log(`   Position Size: ${trade.position_size}`);
      console.log(`   Hours Open: ${Number(trade.hours_open).toFixed(1)}`);
      console.log(`   Session Status: ${trade.session_status}`);
      console.log(`   Issue Type: ${trade.issue_type}`);
      console.log('');
    });
  } else {
    console.log('   ✅ No orphaned trades found!');
  }

  // 3. Check price data coverage
  console.log('\n💹 PRICE DATA COVERAGE');
  console.log('━'.repeat(100));

  const { data: priceCoverage, error: priceError } = await supabase
    .rpc('admin_check_price_data_coverage');

  if (priceError) {
    console.error('❌ Error checking price coverage:', priceError.message);
  } else if (priceCoverage && priceCoverage.length > 0) {
    console.log(`Checking price data for ${priceCoverage.length} actively traded symbols:\n`);

    priceCoverage.forEach(coverage => {
      const icon = coverage.issue === 'OK' ? '✅' : '⚠️';
      console.log(`${icon} ${coverage.symbol}`);
      console.log(`   Active Trades: ${coverage.active_trades_count}`);
      console.log(`   Latest Price: ${coverage.latest_price_timestamp ? new Date(coverage.latest_price_timestamp).toLocaleString() : 'NEVER'}`);
      console.log(`   Minutes Since Update: ${coverage.minutes_since_last_price ? Number(coverage.minutes_since_last_price).toFixed(1) : 'N/A'}`);
      console.log(`   Status: ${coverage.issue}`);
      console.log('');
    });
  } else {
    console.log('   ℹ️  No active trades to check');
  }

  // 4. Provide recommendations
  console.log('\n' + '='.repeat(100));
  console.log('RECOMMENDATIONS');
  console.log('='.repeat(100));

  if (orphanedTrades && orphanedTrades.length > 0) {
    console.log('\n⚠️  ACTION REQUIRED: Orphaned trades detected!');
    console.log('\nTo preview what would be closed:');
    console.log('   SELECT * FROM admin_close_orphaned_trades(true);');
    console.log('\nTo actually close the orphaned trades:');
    console.log('   SELECT * FROM admin_close_orphaned_trades(false);');
  }

  if (priceCoverage && priceCoverage.some(c => c.issue !== 'OK')) {
    console.log('\n⚠️  PRICE DATA ISSUES DETECTED:');
    priceCoverage
      .filter(c => c.issue !== 'OK')
      .forEach(coverage => {
        if (coverage.issue === 'NO_PRICE_DATA') {
          console.log(`\n   ${coverage.symbol}: No price data available`);
          console.log('   → Enable realtime price polling for this symbol');
          console.log('   → Or manually insert price data');
        } else if (coverage.issue === 'STALE_PRICES') {
          console.log(`\n   ${coverage.symbol}: Price data is stale (${Number(coverage.minutes_since_last_price).toFixed(0)} minutes old)`);
          console.log('   → Check if price polling service is running');
          console.log('   → Verify API keys and rate limits');
        }
      });
  }

  console.log('\n✅ PREVENTION:');
  console.log('   A new trigger has been installed that will automatically close trades');
  console.log('   when their sessions complete/stop, preventing future orphans.');

  console.log('\n');
}

diagnoseOrphanedTrades().catch(console.error);
