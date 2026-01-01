import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateOrphanedTrades() {
  const emails = ['oratio89@gmail.com', 'amanda9ellis@gmail.com'];

  console.log('='.repeat(100));
  console.log('ORPHANED TRADES INVESTIGATION REPORT');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(100));
  console.log('');

  for (const email of emails) {
    console.log('\n' + '━'.repeat(100));
    console.log(`USER: ${email}`);
    console.log('━'.repeat(100));

    // Get user profile
    const { data: profiles, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, account_balance, created_at')
      .eq('email', email);

    if (profileError) {
      console.error('❌ Error fetching profile:', profileError);
      continue;
    }

    if (!profiles || profiles.length === 0) {
      console.log('❌ User not found in user_profiles table');
      continue;
    }

    const profile = profiles[0];
    console.log('\n📊 USER PROFILE');
    console.log('   User ID:', profile.id);
    console.log('   Account Balance:', `$${profile.account_balance}`);
    console.log('   Joined:', new Date(profile.created_at).toLocaleString());

    // Get all trades
    console.log('\n📈 TRADES ANALYSIS');
    const { data: trades, error: tradesError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (tradesError) {
      console.error('   ❌ Error fetching trades:', tradesError);
    } else if (!trades || trades.length === 0) {
      console.log('   ℹ️  No trades found');
    } else {
      const openTrades = trades.filter(t => t.status === 'open');
      const closedTrades = trades.filter(t => t.status === 'closed');
      const pendingTrades = trades.filter(t => t.status === 'pending');

      console.log(`   Total: ${trades.length} | Open: ${openTrades.length} | Closed: ${closedTrades.length} | Pending: ${pendingTrades.length}`);

      if (openTrades.length > 0) {
        console.log('\n   🔴 OPEN TRADES (POTENTIALLY ORPHANED):');
        for (const trade of openTrades) {
          const openDuration = (new Date() - new Date(trade.opened_at || trade.created_at)) / (1000 * 60 * 60);
          console.log(`\n      Trade ID: ${trade.id}`);
          console.log(`      Symbol: ${trade.symbol}`);
          console.log(`      Direction: ${trade.direction}`);
          console.log(`      Entry Price: ${trade.entry_price}`);
          console.log(`      Position Size: ${trade.position_size}`);
          console.log(`      Current P&L: $${trade.current_pnl || 0}`);
          console.log(`      Profit/Loss: $${trade.profit_loss || 0}`);
          console.log(`      Opened At: ${new Date(trade.opened_at || trade.created_at).toLocaleString()}`);
          console.log(`      ⏱️  Open Duration: ${openDuration.toFixed(1)} hours`);
          console.log(`      Goal Session ID: ${trade.goal_session_id || 'NULL'}`);

          if (openDuration > 24) {
            console.log(`      ⚠️  WARNING: Trade open for more than 24 hours!`);
          }

          if (trade.current_pnl === 0 && openDuration > 1) {
            console.log(`      ⚠️  WARNING: $0 P&L for ${openDuration.toFixed(1)} hours - likely missing price data!`);
          }
        }
      }

      if (closedTrades.length > 0) {
        console.log('\n   ✅ RECENT CLOSED TRADES (Last 3):');
        closedTrades.slice(0, 3).forEach(t => {
          console.log(`\n      Trade ID: ${t.id}`);
          console.log(`      Symbol: ${t.symbol} | Direction: ${t.direction}`);
          console.log(`      P&L: $${t.profit_loss || 0}`);
          console.log(`      Closed At: ${new Date(t.closed_at).toLocaleString()}`);
          console.log(`      Close Reason: ${t.close_reason || 'unknown'}`);
        });
      }
    }

    // Get all sessions
    console.log('\n🎯 SESSIONS ANALYSIS');
    const { data: sessions, error: sessionsError } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });

    if (sessionsError) {
      console.error('   ❌ Error fetching sessions:', sessionsError);
    } else if (!sessions || sessions.length === 0) {
      console.log('   ℹ️  No sessions found');
    } else {
      const activeStatuses = ['scanning', 'awaiting_response', 'entry_pending'];
      const activeSessions = sessions.filter(s => activeStatuses.includes(s.status));
      const completedSessions = sessions.filter(s => ['completed', 'stopped'].includes(s.status));

      console.log(`   Total: ${sessions.length} | Active: ${activeSessions.length} | Completed: ${completedSessions.length}`);

      if (activeSessions.length > 0) {
        console.log('\n   🟢 ACTIVE SESSIONS:');
        activeSessions.forEach(s => {
          const duration = (new Date() - new Date(s.updated_at)) / (1000 * 60);
          console.log(`\n      Session ID: ${s.id}`);
          console.log(`      Status: ${s.status}`);
          console.log(`      Target: $${s.target_value || 0} | Progress: $${s.current_progress || 0}`);
          console.log(`      Created: ${new Date(s.created_at).toLocaleString()}`);
          console.log(`      Last Update: ${new Date(s.updated_at).toLocaleString()}`);
          console.log(`      ⏱️  Idle for: ${duration.toFixed(1)} minutes`);

          if (duration > 15) {
            console.log(`      ⚠️  WARNING: Session idle for more than 15 minutes - likely stuck!`);
          }
        });
      }

      if (completedSessions.length > 0) {
        console.log('\n   ✅ RECENT COMPLETED SESSIONS (Last 2):');
        completedSessions.slice(0, 2).forEach(s => {
          console.log(`\n      Session ID: ${s.id}`);
          console.log(`      Status: ${s.status}`);
          console.log(`      Target: $${s.target_value || 0} | Final Progress: $${s.current_progress || 0}`);
          console.log(`      Created: ${new Date(s.created_at).toLocaleString()}`);
          console.log(`      Completed: ${new Date(s.completed_at || s.updated_at).toLocaleString()}`);
        });
      }
    }

    // Check for orphaned trades (trades without valid sessions or with completed sessions)
    if (trades && trades.length > 0 && sessions && sessions.length > 0) {
      console.log('\n🔍 ORPHAN DETECTION');
      const openTrades = trades.filter(t => t.status === 'open');

      for (const trade of openTrades) {
        if (!trade.goal_session_id) {
          console.log(`   ⚠️  Trade ${trade.id} has NO session reference - ORPHANED!`);
          continue;
        }

        const session = sessions.find(s => s.id === trade.goal_session_id);
        if (!session) {
          console.log(`   ⚠️  Trade ${trade.id} references non-existent session ${trade.goal_session_id} - ORPHANED!`);
        } else if (['completed', 'stopped'].includes(session.status)) {
          console.log(`   ⚠️  Trade ${trade.id} belongs to ${session.status} session - SHOULD BE CLOSED!`);
        } else {
          console.log(`   ✅ Trade ${trade.id} belongs to active session ${session.id} (${session.status})`);
        }
      }
    }

    // Check BTCUSD price data
    console.log('\n💹 BTCUSD PRICE DATA CHECK');
    const { data: prices, error: pricesError } = await supabase
      .from('realtime_prices')
      .select('*')
      .eq('symbol', 'BTCUSD')
      .order('created_at', { ascending: false })
      .limit(5);

    if (pricesError) {
      console.error('   ❌ Error fetching prices:', pricesError);
    } else if (!prices || prices.length === 0) {
      console.log('   ⚠️  NO BTCUSD PRICE DATA FOUND - This explains $0 P&L!');
    } else {
      const latestPrice = prices[0];
      const priceAge = (new Date() - new Date(latestPrice.created_at)) / (1000 * 60);
      console.log(`   Latest Price: Bid: ${latestPrice.bid} | Ask: ${latestPrice.ask}`);
      console.log(`   Price Timestamp: ${new Date(latestPrice.created_at).toLocaleString()}`);
      console.log(`   Price Age: ${priceAge.toFixed(1)} minutes`);

      if (priceAge > 5) {
        console.log(`   ⚠️  WARNING: Price data is stale (older than 5 minutes)!`);
      }

      console.log(`\n   Recent Price History (Last 5):`);
      prices.forEach((p, i) => {
        console.log(`      ${i + 1}. ${new Date(p.created_at).toLocaleTimeString()} - Bid: ${p.bid}, Ask: ${p.ask}`);
      });
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(100));
  console.log('\nRECOMMENDATIONS:');
  console.log('1. Check if trades belong to completed/stopped sessions → Force close them');
  console.log('2. Check if BTCUSD price polling is working → Restart price collector');
  console.log('3. Check if trades are stuck open > 24 hours → Force close with last known price');
  console.log('4. Review trade closure triggers to prevent future orphans');
  console.log('');
}

investigateOrphanedTrades().catch(console.error);
