import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigate() {
  const emails = ['oratio89@gmail.com', 'amanda9ellis@gmail.com'];
  
  console.log('='.repeat(80));
  console.log('INVESTIGATING USERS WITH INCORRECT TRADE DATA');
  console.log('='.repeat(80));
  console.log('');
  
  for (const email of emails) {
    console.log('\n' + '-'.repeat(80));
    console.log('USER:', email);
    console.log('-'.repeat(80));
    
    // Get user ID
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('id, email, account_balance, created_at')
      .eq('email', email)
      .single();
    
    if (profileError) {
      console.error('Error fetching profile:', profileError);
      continue;
    }
    
    console.log('\nUser ID:', profile.id);
    console.log('Account Balance:', profile.account_balance);
    console.log('Joined:', profile.created_at);
    
    // Check goal_session_trades
    console.log('\n--- GOAL SESSION TRADES ---');
    const { data: trades, error: tradesError } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    
    if (tradesError) {
      console.error('Error fetching trades:', tradesError);
    } else {
      console.log('Total trades:', trades.length);
      
      const openTrades = trades.filter(t => t.status === 'open');
      const closedTrades = trades.filter(t => t.status === 'closed');
      const pendingTrades = trades.filter(t => t.status === 'pending');
      
      console.log('Open trades:', openTrades.length);
      console.log('Closed trades:', closedTrades.length);
      console.log('Pending trades:', pendingTrades.length);
      
      if (openTrades.length > 0) {
        console.log('\nOPEN TRADES:');
        openTrades.forEach(t => {
          console.log('  - Trade ID:', t.id);
          console.log('    Symbol:', t.symbol);
          console.log('    Direction:', t.direction);
          console.log('    Status:', t.status);
          console.log('    Entry Price:', t.entry_price);
          console.log('    Position Size:', t.position_size);
          console.log('    Profit/Loss:', t.profit_loss);
          console.log('    Current P&L:', t.current_pnl);
          console.log('    Opened At:', t.opened_at);
          console.log('    Created At:', t.created_at);
          console.log('    Goal Session ID:', t.goal_session_id);
          console.log('');
        });
      }
      
      if (closedTrades.length > 0) {
        console.log('\nCLOSED TRADES (Last 3):');
        closedTrades.slice(0, 3).forEach(t => {
          console.log('  - Trade ID:', t.id);
          console.log('    Symbol:', t.symbol);
          console.log('    Direction:', t.direction);
          console.log('    Status:', t.status);
          console.log('    Profit/Loss:', t.profit_loss);
          console.log('    Closed At:', t.closed_at);
          console.log('');
        });
      }
    }
    
    // Check goal_sessions
    console.log('\n--- GOAL SESSIONS ---');
    const { data: sessions, error: sessionsError } = await supabase
      .from('goal_sessions')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: false });
    
    if (sessionsError) {
      console.error('Error fetching sessions:', sessionsError);
    } else {
      console.log('Total sessions:', sessions.length);
      
      const activeSessions = sessions.filter(s => ['scanning', 'awaiting_response', 'entry_pending'].includes(s.status));
      const completedSessions = sessions.filter(s => ['completed', 'stopped'].includes(s.status));
      
      console.log('Active sessions:', activeSessions.length);
      console.log('Completed sessions:', completedSessions.length);
      
      if (activeSessions.length > 0) {
        console.log('\nACTIVE SESSIONS:');
        activeSessions.forEach(s => {
          console.log('  - Session ID:', s.id);
          console.log('    Status:', s.status);
          console.log('    Target Value:', s.target_value);
          console.log('    Current Progress:', s.current_progress);
          console.log('    Created At:', s.created_at);
          console.log('    Updated At:', s.updated_at);
          console.log('');
        });
      }
      
      if (completedSessions.length > 0) {
        console.log('\nRECENT COMPLETED SESSIONS (Last 2):');
        completedSessions.slice(0, 2).forEach(s => {
          console.log('  - Session ID:', s.id);
          console.log('    Status:', s.status);
          console.log('    Target Value:', s.target_value);
          console.log('    Current Progress:', s.current_progress);
          console.log('    Created At:', s.created_at);
          console.log('    Completed At:', s.completed_at || s.updated_at);
          console.log('');
        });
      }
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('INVESTIGATION COMPLETE');
  console.log('='.repeat(80));
}

investigate().catch(console.error);
