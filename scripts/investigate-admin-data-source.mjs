import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateAdminDataSource() {
  console.log('='.repeat(100));
  console.log('ADMIN DASHBOARD DATA SOURCE INVESTIGATION');
  console.log('='.repeat(100));
  console.log('');

  // First, call the admin function directly to see what it returns
  console.log('📊 Calling admin_get_all_users RPC function...\n');

  const { data: adminUsers, error: adminError } = await supabase.rpc('admin_get_all_users', {
    search_email: null,
    limit_count: 100
  });

  if (adminError) {
    console.error('❌ Error calling admin_get_all_users:', adminError);
    console.log('\nThis explains why the admin dashboard might not be working!');
    return;
  }

  if (!adminUsers || adminUsers.length === 0) {
    console.log('ℹ️  No users returned from admin_get_all_users');
    return;
  }

  console.log(`✅ Found ${adminUsers.length} users from admin function\n`);

  // Find our target users
  const targetEmails = ['oratio89@gmail.com', 'amanda9ellis@gmail.com'];
  const targetUsers = adminUsers.filter(u => targetEmails.includes(u.email));

  if (targetUsers.length === 0) {
    console.log('⚠️  Target users NOT found in admin function results\n');
    console.log('This means the issue is NOT with these specific users.');
    console.log('The admin dashboard must be caching old data or using a different source.\n');

    // Show some sample users
    console.log('Sample users from admin function (first 5):');
    adminUsers.slice(0, 5).forEach(u => {
      console.log(`   - ${u.email}: ${u.active_trades} active trades`);
    });
  } else {
    console.log('✅ Target users FOUND in admin function results!\n');

    for (const user of targetUsers) {
      console.log('━'.repeat(100));
      console.log(`USER: ${user.email}`);
      console.log('━'.repeat(100));
      console.log('   User ID:', user.user_id);
      console.log('   Account Balance:', `$${user.account_balance}`);
      console.log('   Credit Balance:', user.credit_balance);
      console.log('   Total Trades:', user.total_trades);
      console.log('   Winning Trades:', user.winning_trades);
      console.log('   Losing Trades:', user.losing_trades);
      console.log('   Active Trades Count:', user.active_trades);
      console.log('   Active Trades Detail:', JSON.stringify(user.active_trades_detail, null, 2));
      console.log('   Scanning Sessions:', user.scanning_sessions);
      console.log('   Scanning Duration (mins):', user.scanning_duration_minutes);
      console.log('   Last Activity:', user.last_activity);
      console.log('');

      // Now query the actual tables with the user_id
      console.log('   🔍 Querying actual database tables with user_id:', user.user_id);

      // Check user_profiles
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', user.user_id)
        .single();

      if (profileError) {
        console.log('   ❌ user_profiles error:', profileError.message);
      } else if (profile) {
        console.log('   ✅ Found in user_profiles:', profile.email);
      } else {
        console.log('   ⚠️  Not found in user_profiles');
      }

      // Check goal_session_trades
      const { data: trades, error: tradesError } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, status, entry_price, current_pnl, profit_loss, opened_at, goal_session_id')
        .eq('user_id', user.user_id);

      if (tradesError) {
        console.log('   ❌ goal_session_trades error:', tradesError.message);
      } else {
        console.log(`   ✅ Found ${trades?.length || 0} trades in goal_session_trades`);
        const openTrades = trades?.filter(t => t.status === 'open') || [];
        if (openTrades.length > 0) {
          console.log(`      🔴 ${openTrades.length} OPEN trades:`);
          openTrades.forEach(t => {
            console.log(`         - ${t.symbol}: Entry ${t.entry_price}, Current P&L $${t.current_pnl || 0}`);
            console.log(`           Opened: ${new Date(t.opened_at).toLocaleString()}`);
            console.log(`           Session ID: ${t.goal_session_id}`);
          });
        }
      }

      // Check goal_sessions
      const { data: sessions, error: sessionsError } = await supabase
        .from('goal_sessions')
        .select('id, status, target_value, current_progress, created_at, updated_at')
        .eq('user_id', user.user_id);

      if (sessionsError) {
        console.log('   ❌ goal_sessions error:', sessionsError.message);
      } else {
        console.log(`   ✅ Found ${sessions?.length || 0} sessions in goal_sessions`);
        const activeSessions = sessions?.filter(s => ['scanning', 'awaiting_response', 'entry_pending'].includes(s.status)) || [];
        if (activeSessions.length > 0) {
          console.log(`      🟢 ${activeSessions.length} ACTIVE sessions:`);
          activeSessions.forEach(s => {
            console.log(`         - ${s.id}: ${s.status}`);
            console.log(`           Updated: ${new Date(s.updated_at).toLocaleString()}`);
          });
        }
        const completedSessions = sessions?.filter(s => ['completed', 'stopped'].includes(s.status)) || [];
        if (completedSessions.length > 0) {
          console.log(`      ✅ ${completedSessions.length} COMPLETED/STOPPED sessions`);
        }
      }

      // Check realtime_prices for their symbols
      if (user.active_trades_detail && user.active_trades_detail.length > 0) {
        const symbols = [...new Set(user.active_trades_detail.map(t => t.symbol))];
        console.log(`\n   💹 Checking realtime_prices for symbols: ${symbols.join(', ')}`);

        for (const symbol of symbols) {
          const { data: prices, error: pricesError } = await supabase
            .from('realtime_prices')
            .select('bid, ask, created_at')
            .eq('symbol', symbol)
            .order('created_at', { ascending: false })
            .limit(1);

          if (pricesError) {
            console.log(`      ❌ Error fetching ${symbol} prices:`, pricesError.message);
          } else if (!prices || prices.length === 0) {
            console.log(`      ⚠️  NO PRICE DATA for ${symbol} - This explains $0 P&L!`);
          } else {
            const price = prices[0];
            const ageMinutes = (new Date() - new Date(price.created_at)) / (1000 * 60);
            console.log(`      ✅ ${symbol}: Bid ${price.bid}, Ask ${price.ask}`);
            console.log(`         Age: ${ageMinutes.toFixed(1)} minutes`);
            if (ageMinutes > 5) {
              console.log(`         ⚠️  WARNING: Stale price data!`);
            }
          }
        }
      }

      console.log('');
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(100));
}

investigateAdminDataSource().catch(console.error);
