import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://nzisgxdlydihlwsvonfy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1OTU1NDAsImV4cCI6MjA3NTE3MTU0MH0.ZK6iWNbmb0BR5ZhzWQrTaZR_09Z0ls5Og9dFpmcuh7M'
);

async function investigateTrade() {
  try {
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  FORENSIC TRADE INVESTIGATION');
    console.log('  User: ksweat48@gmail.com');
    console.log('  Symbol: GBPUSD SELL');
    console.log('  Date: January 13, 2025 (~8:56 PM - 10:18 PM)');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    // Step 1: Get user (first check if exists)
    const { data: users, error: userErr } = await supabase
      .from('user_profiles')
      .select('id, email, account_balance')
      .eq('email', 'ksweat48@gmail.com');

    if (userErr) throw new Error('User query failed: ' + userErr.message);
    if (!users || users.length === 0) {
      console.log('❌ User not found in database');
      console.log('Checking auth.users table...\n');
      
      // Try alternate approach - search all user profiles
      const { data: allProfiles } = await supabase
        .from('user_profiles')
        .select('id, email')
        .ilike('email', '%ksweat%');
      
      if (allProfiles && allProfiles.length > 0) {
        console.log('Found similar users:');
        allProfiles.forEach(p => console.log('  -', p.email));
      } else {
        console.log('No similar email addresses found');
      }
      return;
    }

    const user = users[0];

    console.log('STEP 1: USER IDENTIFICATION');
    console.log('─────────────────────────────────────────────────────────────────────────\n');
    console.log('✓ User ID:', user.id);
    console.log('✓ Email:', user.email);
    console.log('✓ Current Balance: $' + user.account_balance);
    console.log('');

    const userId = user.id;

    // Step 2: Find the specific trade
    console.log('STEP 2: TRADE SEARCH');
    console.log('─────────────────────────────────────────────────────────────────────────\n');
    
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
      console.log('⚠️ Query error:', tradeErr.message);
    }

    if (trades && trades.length > 0) {
      console.log('✓ Found ' + trades.length + ' matching trade(s)\n');
      console.log('═══════════════════════════════════════════════════════════════════════════');
      console.log('  TRADE EXECUTION DETAILS');
      console.log('═══════════════════════════════════════════════════════════════════════════\n');
      
      for (const [i, t] of trades.entries()) {
        console.log('══ Trade #' + (i+1) + ' ══════════════════════════════════════════════════════════════════\n');
        console.log('  🆔 Trade ID:', t.id);
        console.log('  📊 Symbol:', t.symbol);
        console.log('  📈 Direction:', t.direction.toUpperCase());
        console.log('  💰 Entry Price:', t.entry_price);
        console.log('  💰 Exit Price:', t.exit_price || 'N/A');
        console.log('  ⏰ Entry Time:', t.entry_time);
        console.log('  ⏰ Exit Time:', t.exit_time || t.closed_at || 'N/A');
        console.log('  💵 Profit/Loss: $' + (t.profit_loss || 0));
        console.log('  📦 Position Size:', t.position_size);
        console.log('  🛑 Stop Loss:', t.stop_loss || 'N/A');
        console.log('  🎯 Take Profit:', t.take_profit || 'N/A');
        console.log('  📌 Status:', t.status);
        console.log('  🚪 Close Reason:', t.close_reason || 'N/A');
        console.log('  🔍 Pattern:', t.pattern || 'N/A');
        console.log('  💯 Conviction:', t.conviction_pct ? t.conviction_pct + '%' : 'N/A');
        console.log('  🎯 Session ID:', t.goal_session_id);
        console.log('');
        
        if (t.trade_metadata && Object.keys(t.trade_metadata).length > 0) {
          console.log('  📋 Trade Metadata:');
          console.log('  ' + JSON.stringify(t.trade_metadata, null, 2).split('\n').join('\n  '));
          console.log('');
        }
        
        const tradeId = t.id;
        const sessionId = t.goal_session_id;

        // Get AI journal entry
        console.log('  ═══════════════════════════════════════════════════════════════════════');
        console.log('  ALPHA AI REASONING & ANALYSIS');
        console.log('  ═══════════════════════════════════════════════════════════════════════\n');
        
        const { data: journals } = await supabase
          .from('ai_trade_journal')
          .select('*')
          .eq('trade_id', tradeId);

        if (journals && journals.length > 0) {
          const journal = journals[0];
          console.log('  ✓ Journal Entry Found\n');
          if (journal.llm_reasoning) {
            console.log('  📝 LLM Reasoning:');
            console.log('  ' + String(journal.llm_reasoning).split('\n').join('\n  '));
            console.log('');
          }
          if (journal.market_read) {
            console.log('  📊 Market Read:');
            console.log('  ' + String(journal.market_read).split('\n').join('\n  '));
            console.log('');
          }
          if (journal.expected_outcome) {
            console.log('  🎯 Expected Outcome:');
            console.log('  ' + String(journal.expected_outcome).split('\n').join('\n  '));
            console.log('');
          }
          if (journal.rank) {
            console.log('  🏆 Rank:', journal.rank);
          }
          if (journal.outcome) {
            console.log('  📊 Actual Outcome:', journal.outcome);
          }
          if (journal.pnl) {
            console.log('  💵 Journal P&L: $' + journal.pnl);
          }
          console.log('');
          
          // Show full journal as JSON
          console.log('  📄 Full Journal Entry:');
          console.log('  ' + JSON.stringify(journal, null, 2).split('\n').join('\n  '));
          console.log('');
        } else {
          console.log('  ⚠️ No journal entry found for this trade\n');
        }

        // Get session info
        if (sessionId) {
          console.log('  ═══════════════════════════════════════════════════════════════════════');
          console.log('  GOAL SESSION CONTEXT');
          console.log('  ═══════════════════════════════════════════════════════════════════════\n');
          
          const { data: sessions } = await supabase
            .from('goal_sessions')
            .select('*')
            .eq('id', sessionId);

          if (sessions && sessions.length > 0) {
            const session = sessions[0];
            console.log('  ✓ Session Found\n');
            console.log('  Session ID:', session.id);
            console.log('  Status:', session.status);
            console.log('  Target: $' + session.target_value);
            console.log('  Progress: $' + (session.current_progress || 0));
            console.log('  Created:', session.created_at);
            console.log('  Updated:', session.updated_at);
            if (session.completed_at) {
              console.log('  Completed:', session.completed_at);
            }
            console.log('');
          } else {
            console.log('  ⚠️ Session not found\n');
          }
        }

        console.log('');
      }
    } else {
      console.log('❌ No trades found matching exact criteria\n');
      
      // Broader search
      console.log('ATTEMPTING BROADER SEARCH (All GBPUSD trades)...\n');
      const { data: allTrades } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, direction, entry_time, exit_time, profit_loss, status, pattern, conviction_pct, close_reason')
        .eq('user_id', userId)
        .eq('symbol', 'GBPUSD')
        .order('entry_time', { ascending: false })
        .limit(20);

      if (allTrades && allTrades.length > 0) {
        console.log('Found ' + allTrades.length + ' GBPUSD trades (most recent):\n');
        allTrades.forEach((t, i) => {
          const pnl = t.profit_loss || 0;
          const pnlSymbol = pnl >= 0 ? '+' : '';
          const statusIcon = t.status === 'closed' ? '✓' : '○';
          console.log((i+1) + '. [' + statusIcon + '] ' + t.direction.toUpperCase() + ' | ' + t.entry_time + ' → ' + (t.exit_time || 'Open') + ' | ' + pnlSymbol + '$' + pnl.toFixed(2));
          if (t.close_reason) {
            console.log('     Close Reason: ' + t.close_reason);
          }
        });
        console.log('');
        
        // Check if any match our loss amount
        const matchingLoss = allTrades.find(t => Math.abs(t.profit_loss - (-297.78)) < 1);
        if (matchingLoss) {
          console.log('🎯 FOUND POTENTIAL MATCH by P&L amount: -$297.78\n');
          console.log('Trade ID:', matchingLoss.id);
          console.log('Entry:', matchingLoss.entry_time);
          console.log('Exit:', matchingLoss.exit_time);
          console.log('P&L: $' + matchingLoss.profit_loss);
          console.log('');
        }
      } else {
        console.log('No GBPUSD trades found for this user\n');
      }
    }

    // Search for AI decisions
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  AI DECISION LOGS (Jan 13, 2025)');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

    const { data: decisions } = await supabase
      .from('ai_trade_decisions')
      .select('*')
      .eq('user_id', userId)
      .eq('symbol', 'GBPUSD')
      .gte('created_at', '2025-01-13 00:00:00')
      .lte('created_at', '2025-01-14 23:59:59')
      .order('created_at', { ascending: false });

    if (decisions && decisions.length > 0) {
      console.log('✓ Found ' + decisions.length + ' AI decision record(s)\n');
      decisions.forEach((d, i) => {
        console.log('══ Decision #' + (i+1) + ' ═══════════════════════════════════════════════════════════\n');
        console.log('  Decision ID:', d.id);
        console.log('  Symbol:', d.symbol);
        console.log('  Direction:', d.trade_direction);
        console.log('  Confidence:', d.confidence_score + '%');
        console.log('  Strategy:', d.strategy_used);
        console.log('  Decision Type:', d.decision_type);
        console.log('  Approved:', d.approved ? 'Yes' : 'No');
        console.log('  Executed:', d.executed ? 'Yes' : 'No');
        console.log('  Created:', d.created_at);
        console.log('');
        if (d.reasoning) {
          console.log('  Reasoning:');
          console.log('  ' + String(d.reasoning).split('\n').join('\n  '));
          console.log('');
        }
      });
    } else {
      console.log('⚠️ No AI decisions found\n');
    }

    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log('  INVESTIGATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ Investigation Error:', err.message);
    if (err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
    }
  }
}

investigateTrade().catch(console.error);
