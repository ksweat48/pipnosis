import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
);

async function diagnoseSSOTViolations() {
  console.log('🔍 Diagnosing SSOT Violations...\n');

  // 1. Check ksweat48's US30 trade
  console.log('📊 Issue #1: ksweat48 US30 P&L Display');
  console.log('=====================================');

  const { data: ksweatUser } = await supabase
    .from('user_profiles')
    .select('id, email')
    .eq('email', 'ksweat48@gmail.com')
    .single();

  if (ksweatUser) {
    const { data: trades } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('user_id', ksweatUser.id)
      .eq('symbol', 'US30')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (trades && trades.length > 0) {
      console.log(`Found ${trades.length} open US30 trade(s):`);
      trades.forEach((trade, i) => {
        console.log(`\nTrade ${i + 1}:`);
        console.log(`  ID: ${trade.id}`);
        console.log(`  Direction: ${trade.direction}`);
        console.log(`  Entry Price: ${trade.entry_price}`);
        console.log(`  Current Price: ${trade.current_price}`);
        console.log(`  Position Size: ${trade.position_size}`);
        console.log(`  Lot Size: ${trade.lot_size}`);
        console.log(`  Profit Loss: $${trade.profit_loss}`);
        console.log(`  Current P&L: $${trade.current_pnl}`);
      });
    } else {
      console.log('No open US30 trades found.');
    }
  }

  // 2. Check markrobja1925's stuck session
  console.log('\n\n📊 Issue #2: markrobja1925 Stuck Session');
  console.log('========================================');

  const { data: markUser } = await supabase
    .from('user_profiles')
    .select('id, email')
    .eq('email', 'markrobja1925@gmail.com')
    .single();

  if (markUser) {
    const { data: sessions } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('user_id', markUser.id)
      .in('status', ['scanning', 'trade_pending', 'awaiting_response'])
      .order('scanning_started_at', { ascending: false });

    if (sessions && sessions.length > 0) {
      console.log(`Found ${sessions.length} active session(s):`);
      sessions.forEach((session, i) => {
        const minutesScanning = session.scanning_started_at
          ? (Date.now() - new Date(session.scanning_started_at).getTime()) / 60000
          : 0;
        console.log(`\nSession ${i + 1}:`);
        console.log(`  ID: ${session.id}`);
        console.log(`  Status: ${session.status}`);
        console.log(`  Scanning Started: ${session.scanning_started_at}`);
        console.log(`  Minutes Scanning: ${minutesScanning.toFixed(1)}`);
      });
    } else {
      console.log('No stuck sessions found.');
    }
  }

  // 3. Check force_close function permissions
  console.log('\n\n📊 Issue #3: Function Permissions');
  console.log('==================================');

  const { data: funcPerms, error: funcError } = await supabase.rpc('force_close_stale_scanning_sessions');

  if (funcError) {
    console.log('❌ Error calling force_close_stale_scanning_sessions:');
    console.log(`   ${funcError.message}`);
    console.log('   This confirms permissions issue - function exists but not callable by authenticated users');
  } else {
    console.log('✅ Function is callable (returned', funcPerms?.length || 0, 'results)');
  }

  // 4. Check lot_size vs position_size usage
  console.log('\n\n📊 Issue #4: Lot Size Column Analysis');
  console.log('======================================');

  const { data: columnCheck } = await supabase
    .from('goal_session_trades')
    .select('symbol, position_size, lot_size, profit_loss')
    .eq('status', 'open')
    .limit(10);

  if (columnCheck) {
    console.log('Sample of open trades:');
    columnCheck.forEach((trade, i) => {
      console.log(`\nTrade ${i + 1}:`);
      console.log(`  Symbol: ${trade.symbol}`);
      console.log(`  position_size: ${trade.position_size}`);
      console.log(`  lot_size: ${trade.lot_size}`);
      console.log(`  P&L: $${trade.profit_loss}`);
    });
  }

  console.log('\n\n✅ Diagnosis Complete');
}

diagnoseSSOTViolations().catch(console.error);
