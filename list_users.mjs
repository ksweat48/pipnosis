import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://nzisgxdlydihlwsvonfy.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56aXNneGRseWRpaGx3c3ZvbmZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk1OTU1NDAsImV4cCI6MjA3NTE3MTU0MH0.ZK6iWNbmb0BR5ZhzWQrTaZR_09Z0ls5Og9dFpmcuh7M'
);

async function listUsers() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  DATABASE USER LIST');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  const { data: profiles, error } = await supabase
    .from('user_profiles')
    .select('id, email, account_balance, created_at')
    .order('created_at', { ascending: false})
    .limit(50);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.log('No users found in database');
    return;
  }

  console.log('Found ' + profiles.length + ' users:\n');
  profiles.forEach((p, i) => {
    console.log((i+1) + '. ' + p.email + ' | Balance: $' + p.account_balance + ' | Joined: ' + p.created_at.substring(0, 10));
  });
  
  console.log('\n\nSearching for users with GBPUSD trades on Jan 13, 2025...\n');
  
  const { data: trades } = await supabase
    .from('goal_session_trades')
    .select('user_id, symbol, direction, entry_time, profit_loss, status')
    .eq('symbol', 'GBPUSD')
    .gte('entry_time', '2025-01-13 00:00:00')
    .lte('entry_time', '2025-01-14 00:00:00')
    .order('entry_time', { ascending: false});

  if (trades && trades.length > 0) {
    console.log('Found ' + trades.length + ' GBPUSD trades on Jan 13:\n');
    
    for (const trade of trades) {
      const { data: user } = await supabase
        .from('user_profiles')
        .select('email')
        .eq('id', trade.user_id)
        .single();
      
      console.log('- ' + (user ? user.email : 'Unknown') + ' | ' + trade.direction.toUpperCase() + ' | ' + trade.entry_time + ' | $' + (trade.profit_loss || 0) + ' | ' + trade.status);
    }
  } else {
    console.log('No GBPUSD trades found on Jan 13, 2025');
  }
  
  console.log('\n\nSearching for trades with P&L close to -$297.78...\n');
  
  const { data: lossTradesAll } = await supabase
    .from('goal_session_trades')
    .select('user_id, symbol, direction, entry_time, exit_time, profit_loss, status, entry_price, exit_price')
    .lt('profit_loss', -290)
    .gt('profit_loss', -305)
    .order('entry_time', { ascending: false})
    .limit(20);

  if (lossTradesAll && lossTradesAll.length > 0) {
    console.log('Found ' + lossTradesAll.length + ' trades with similar P&L:\n');
    
    for (const trade of lossTradesAll) {
      const { data: user } = await supabase
        .from('user_profiles')
        .select('email')
        .eq('id', trade.user_id)
        .single();
      
      console.log('- ' + (user ? user.email : 'Unknown'));
      console.log('  ' + trade.symbol + ' ' + trade.direction.toUpperCase() + ' | Entry: ' + trade.entry_time + ' | Exit: ' + (trade.exit_time || 'N/A'));
      console.log('  Entry Price: ' + trade.entry_price + ' | Exit Price: ' + (trade.exit_price || 'N/A'));
      console.log('  P&L: $' + trade.profit_loss);
      console.log('');
    }
  } else {
    console.log('No trades found with P&L near -$297.78');
  }
}

listUsers().catch(console.error);
