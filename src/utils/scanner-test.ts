import { supabase } from '../lib/supabase';
import { goalScannerTrigger } from '../services/goal-scanner-trigger';

export async function testScannerSetup() {
  console.log('===== SCANNER SETUP TEST =====');

  console.log('\n1. Testing Supabase Connection...');
  const { data: healthCheck, error: healthError } = await supabase
    .from('goal_sessions')
    .select('count', { count: 'exact', head: true });

  if (healthError) {
    console.error('❌ Supabase connection failed:', healthError);
    return false;
  }
  console.log('✅ Supabase connected successfully');

  console.log('\n2. Checking Market Data...');
  const symbols = ['XAUUSD', 'EURUSD', 'GBPUSD'];
  const marketStatus = await goalScannerTrigger.getMarketDataStatus(symbols);

  for (const status of marketStatus) {
    const icon = status.available ? '✅' : '❌';
    console.log(`${icon} ${status.symbol}: ${status.candleCount} candles (${status.status})`);
    if (status.error) {
      console.error(`   Error: ${status.error}`);
    }
  }

  console.log('\n3. Testing Scanner Function Invocation...');
  try {
    const result = await goalScannerTrigger.triggerScan();
    if (result.success) {
      console.log('✅ Scanner function invoked successfully');
      console.log(`   Scanned: ${result.scannedSessions} sessions`);
      console.log(`   Message: ${result.message}`);
    } else {
      console.error('❌ Scanner function failed:', result.error);
      return false;
    }
  } catch (error) {
    console.error('❌ Scanner invocation error:', error);
    return false;
  }

  console.log('\n4. Checking Active Sessions...');
  const { data: sessions, error: sessionError } = await supabase
    .from('goal_sessions')
    .select('id, status, next_scan_time, last_scan_time')
    .in('status', ['scanning', 'trade_pending', 'in_trade'])
    .order('created_at', { ascending: false })
    .limit(5);

  if (sessionError) {
    console.error('❌ Failed to fetch sessions:', sessionError);
    return false;
  }

  if (!sessions || sessions.length === 0) {
    console.log('⚠️  No active sessions found');
  } else {
    console.log(`✅ Found ${sessions.length} active session(s):`);
    sessions.forEach((session, idx) => {
      console.log(`   ${idx + 1}. Session ${session.id.substring(0, 8)}...`);
      console.log(`      Status: ${session.status}`);
      console.log(`      Last Scan: ${session.last_scan_time || 'Never'}`);
      console.log(`      Next Scan: ${session.next_scan_time || 'Not scheduled'}`);
    });
  }

  console.log('\n===== TEST COMPLETE =====\n');
  return true;
}

export async function testEdgeFunctionDirectly() {
  console.log('===== EDGE FUNCTION DIRECT TEST =====\n');

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('❌ Environment variables not configured');
    return false;
  }

  console.log('Supabase URL:', supabaseUrl);
  console.log('Edge Function URL:', `${supabaseUrl}/functions/v1/goal-session-scanner`);

  try {
    console.log('\nInvoking Edge Function...');
    const response = await fetch(
      `${supabaseUrl}/functions/v1/goal-session-scanner`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({}),
      }
    );

    console.log('Response Status:', response.status, response.statusText);

    const text = await response.text();
    console.log('Response Body:', text);

    if (response.ok) {
      console.log('✅ Edge Function responded successfully');
      try {
        const json = JSON.parse(text);
        console.log('Parsed Response:', JSON.stringify(json, null, 2));
      } catch (e) {
        console.log('Response is not JSON');
      }
      return true;
    } else {
      console.error('❌ Edge Function returned error status');
      return false;
    }
  } catch (error) {
    console.error('❌ Edge Function invocation failed:', error);
    return false;
  }
}

if (typeof window !== 'undefined') {
  (window as any).testScanner = testScannerSetup;
  (window as any).testEdgeFunction = testEdgeFunctionDirectly;
  console.log('Scanner test utilities loaded. Run in console:');
  console.log('  testScanner() - Full scanner setup test');
  console.log('  testEdgeFunction() - Direct Edge Function test');
}
