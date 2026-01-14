import { createClient } from '@supabase/supabase-js';

// Use service role key for full access
const supabase = createClient(
  'https://nzisgxdlydihlwsvonfy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1OTU5NTU0MCwiZXhwIjoyMDc1MTcxNTQwfQ.Bas3dKkvMSzBPAK4zUJ24JC-T0-bcLQeJ458KYv-X5U'
);

async function investigateTrade() {
  try {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  FORENSIC TRADE INVESTIGATION - FULL DATABASE ACCESS');
    console.log('  Target: ksweat48@gmail.com - GBPUSD SELL - Jan 13, 2025');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    // Step 1: Find the user
    const { data: users, error: userErr } = await supabase
      .from('user_profiles')
      .select('id, email, account_balance, created_at')
      .eq('email', 'ksweat48@gmail.com');

    if (userErr) {
      console.log('⚠️ User query error:', userErr.message);
      console.log('\nTrying broader search...\n');
      
      // List all users
      const { data: allUsers } = await supabase
        .from('user_profiles')
        .select('id, email, created_at')
        .order('created_at', { ascending: false})
        .limit(10);
      
      if (allUsers && allUsers.length > 0) {
        console.log('Recent users in database:\n');
        allUsers.forEach((u, i) => {
          console.log((i+1) + '. ' + u.email + ' | ' + u.created_at);
        });
      } else {
        console.log('Database appears empty or inaccessible');
      }
      return;
    }

    if (!users || users.length === 0) {
      console.log('❌ User ksweat48@gmail.com not found\n');
      
      // Search for similar
      const { data: similar } = await supabase
        .from('user_profiles')
        .select('email')
        .ilike('email', '%ksweat%');
      
      if (similar && similar.length > 0) {
        console.log('Similar email addresses found:');
        similar.forEach(u => console.log('  - ' + u.email));
      }
      
      // List all users
      console.log('\nAll users in database:\n');
      const { data: allUsers } = await supabase
        .from('user_profiles')
        .select('id, email, created_at')
        .order('created_at', { ascending: false});
      
      if (allUsers && allUsers.length > 0) {
        allUsers.slice(0, 20).forEach((u, i) => {
          console.log((i+1) + '. ' + u.email);
        });
        console.log('\nTotal users: ' + allUsers.length);
      }
      return;
    }

    const user = users[0];
    console.log('✓ USER FOUND\n');
    console.log('  ID:', user.id);
    console.log('  Email:', user.email);
    console.log('  Balance: $' + user.account_balance);
    console.log('  Joined:', user.created_at);
    console.log('');

    const userId = user.id;

    // Find the trade
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  SEARCHING FOR TRADE');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    const { data: trades, error: tradeErr } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', 'GBPUSD')
      .eq('direction', 'sell')
      .gte('entry_time', '2025-01-13 20:00:00')
      .lte('entry_time', '2025-01-14 00:00:00')
      .order('entry_time', { ascending: false});

    if (tradeErr) {
      console.log('⚠️ Trade query error:', tradeErr.message);
    }

    if (!trades || trades.length === 0) {
      console.log('❌ No matching trades found for exact criteria\n');
      console.log('Searching for all GBPUSD trades...\n');
      
      const { data: allTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', 'GBPUSD')
        .order('entry_time', { ascending: false})
        .limit(20);

      if (allTrades && allTrades.length > 0) {
        console.log('Found ' + allTrades.length + ' GBPUSD trades:\n');
        allTrades.forEach((t, i) => {
          const pnl = t.profit_loss || 0;
          console.log((i+1) + '. ' + t.direction.toUpperCase() + ' | ' + t.entry_time + ' | $' + pnl.toFixed(2) + ' | ' + t.status);
        });
        
        // Find by P&L
        const byPnl = allTrades.find(t => Math.abs((t.profit_loss || 0) - (-297.78)) < 2);
        if (byPnl) {
          console.log('\n🎯 MATCH FOUND by P&L amount!\n');
          trades = [byPnl];
        }
      } else {
        console.log('No GBPUSD trades found for this user');
        return;
      }
    }

    if (trades && trades.length > 0) {
      console.log('\n✓ Found ' + trades.length + ' matching trade(s)\n');
      console.log('═══════════════════════════════════════════════════════════════════════════');
      console.log('  COMPLETE TRADE DATA');
      console.log('═══════════════════════════════════════════════════════════════════════════\n');

      for (const trade of trades) {
        console.log('TRADE ID:', trade.id);
        console.log('');
        console.log('EXECUTION DETAILS:');
        console.log('  Symbol:', trade.symbol);
        console.log('  Direction:', trade.direction.toUpperCase());
        console.log('  Entry Price:', trade.entry_price);
        console.log('  Exit Price:', trade.exit_price);
        console.log('  Entry Time:', trade.entry_time);
        console.log('  Exit Time:', trade.exit_time || trade.closed_at);
        console.log('  Position Size:', trade.position_size);
        console.log('  Stop Loss:', trade.stop_loss);
        console.log('  Take Profit:', trade.take_profit);
        console.log('');
        console.log('OUTCOME:');
        console.log('  Profit/Loss: $' + (trade.profit_loss || 0));
        console.log('  Status:', trade.status);
        console.log('  Close Reason:', trade.close_reason || 'N/A');
        console.log('');
        console.log('STRATEGY:');
        console.log('  Pattern:', trade.pattern || 'N/A');
        console.log('  Conviction:', trade.conviction_pct ? trade.conviction_pct + '%' : 'N/A');
        console.log('  Session ID:', trade.goal_session_id);
        console.log('');

        // Get journal
        const { data: journals } = await supabase
          .from('ai_trade_journal')
          .select('*')
          .eq('trade_id', trade.id);

        if (journals && journals.length > 0) {
          const journal = journals[0];
          console.log('═══════════════════════════════════════════════════════════════════════════');
          console.log('  ALPHA AI REASONING');
          console.log('═══════════════════════════════════════════════════════════════════════════\n');
          
          console.log('COMPLETE JOURNAL ENTRY:');
          console.log(JSON.stringify(journal, null, 2));
          console.log('');
        }

        // Get session
        if (trade.goal_session_id) {
          const { data: sessions } = await supabase
            .from('goal_sessions')
            .select('*')
            .eq('id', trade.goal_session_id);

          if (sessions && sessions.length > 0) {
            console.log('═══════════════════════════════════════════════════════════════════════════');
            console.log('  GOAL SESSION');
            console.log('═══════════════════════════════════════════════════════════════════════════\n');
            console.log(JSON.stringify(sessions[0], null, 2));
            console.log('');
          }
        }

        // Get AI decisions
        const { data: decisions } = await supabase
          .from('ai_trade_decisions')
          .select('*')
          .eq('user_id', userId)
          .eq('symbol', 'GBPUSD')
          .gte('created_at', '2025-01-13 20:00:00')
          .lte('created_at', '2025-01-14 00:00:00');

        if (decisions && decisions.length > 0) {
          console.log('═══════════════════════════════════════════════════════════════════════════');
          console.log('  AI DECISIONS');
          console.log('═══════════════════════════════════════════════════════════════════════════\n');
          decisions.forEach((d, i) => {
            console.log('Decision #' + (i+1) + ':');
            console.log(JSON.stringify(d, null, 2));
            console.log('');
          });
        }

        // Get learning metrics
        const { data: metrics } = await supabase
          .from('ai_learning_metrics')
          .select('*')
          .eq('trade_id', trade.id);

        if (metrics && metrics.length > 0) {
          console.log('═══════════════════════════════════════════════════════════════════════════');
          console.log('  LEARNING METRICS');
          console.log('═══════════════════════════════════════════════════════════════════════════\n');
          console.log(JSON.stringify(metrics[0], null, 2));
          console.log('');
        }
      }
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  INVESTIGATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error(err.stack);
  }
}

investigateTrade().catch(console.error);
