import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface RealtimeEvent {
  timestamp: string;
  eventType: string;
  payload: any;
  latencyMs?: number;
}

export function RealtimeDiagnosticsPage() {
  const { user } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<string>('disconnected');
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [testInsertTime, setTestInsertTime] = useState<number | null>(null);
  const [isInserting, setIsInserting] = useState(false);
  const [replicaIdentity, setReplicaIdentity] = useState<any>(null);

  useEffect(() => {
    if (!user) return;

    // Check database configuration
    const checkConfig = async () => {
      const { data, error } = await supabase
        .rpc('check_realtime_config', {})
        .maybeSingle();

      if (!error && data) {
        setReplicaIdentity(data);
      }
    };

    checkConfig();

    console.log('[Realtime Diagnostics] Setting up subscription...');

    const channel = supabase
      .channel('realtime_diagnostics_test')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices'
        },
        (payload) => {
          const now = Date.now();
          const rowData = payload.new as any;

          // Calculate true latency: time from when row was created to when we received the event
          const createdAtMs = new Date(rowData.created_at).getTime();
          const actualLatency = now - createdAtMs;

          // Check if this is our test insert
          const isTestInsert = rowData.source === 'diagnostic_test' && testInsertTime;
          const testLatency = isTestInsert ? now - testInsertTime : undefined;

          const event: RealtimeEvent = {
            timestamp: new Date().toISOString(),
            eventType: 'INSERT',
            payload: rowData,
            latencyMs: isTestInsert ? testLatency : actualLatency
          };

          console.log('[Realtime Diagnostics] ✅ EVENT RECEIVED!', event);
          console.log(`  Actual latency from DB insert: ${actualLatency}ms`);
          if (isTestInsert) {
            console.log(`  Test button latency: ${testLatency}ms`);
          }

          setEvents(prev => [event, ...prev].slice(0, 50));

          if (isTestInsert) {
            setTestInsertTime(null);
          }
        }
      )
      .subscribe((status, err) => {
        console.log(`[Realtime Diagnostics] Status: ${status}`, err);
        setConnectionStatus(status);
      });

    return () => {
      console.log('[Realtime Diagnostics] Unsubscribing...');
      channel.unsubscribe();
    };
  }, [user, testInsertTime]);

  const handleTestInsert = async () => {
    setIsInserting(true);
    setTestInsertTime(Date.now());

    try {
      const bid = 1.05000 + Math.random() * 0.0001;
      const ask = 1.05020 + Math.random() * 0.0001;
      const mid = (bid + ask) / 2;

      const testData = {
        symbol: 'EURUSD',
        bid,
        ask,
        mid,
        spread: ask - bid,
        source: 'diagnostic_test',
        broker_time: new Date().toISOString()
      };

      const { error } = await supabase
        .from('realtime_prices')
        .insert(testData);

      if (error) {
        console.error('[Realtime Diagnostics] Insert error:', error);
        alert(`Insert failed: ${error.message}`);
      } else {
        console.log('[Realtime Diagnostics] ✅ Test insert successful');
      }
    } catch (error) {
      console.error('[Realtime Diagnostics] Error:', error);
    } finally {
      setIsInserting(false);
    }
  };

  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'SUBSCRIBED': return 'text-green-500';
      case 'CHANNEL_ERROR': return 'text-red-500';
      case 'TIMED_OUT': return 'text-orange-500';
      case 'CLOSED': return 'text-gray-500';
      default: return 'text-yellow-500';
    }
  };

  const getStatusIcon = () => {
    switch (connectionStatus) {
      case 'SUBSCRIBED': return '✅';
      case 'CHANNEL_ERROR': return '❌';
      case 'TIMED_OUT': return '⏱️';
      case 'CLOSED': return '🔌';
      default: return '🔄';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">Supabase Realtime Diagnostics</h1>
          <p className="text-gray-400">Test and monitor realtime event broadcasting</p>
        </div>

        {/* Connection Status */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4">Connection Status</h2>
          <div className="flex items-center space-x-4">
            <div className={`text-4xl ${getStatusColor()}`}>
              {getStatusIcon()}
            </div>
            <div>
              <div className={`text-2xl font-bold ${getStatusColor()}`}>
                {connectionStatus}
              </div>
              <div className="text-sm text-gray-400">
                {connectionStatus === 'SUBSCRIBED' ? 'Connected and listening for events' : 'Waiting for connection...'}
              </div>
            </div>
          </div>

          {connectionStatus === 'SUBSCRIBED' && (
            <div className="mt-4 p-4 bg-green-900/20 border border-green-500/30 rounded">
              <p className="text-green-400 text-sm">
                ✅ Realtime subscription is active. Events should be received instantly.
              </p>
            </div>
          )}

          {(connectionStatus === 'CHANNEL_ERROR' || connectionStatus === 'TIMED_OUT') && (
            <div className="mt-4 p-4 bg-red-900/20 border border-red-500/30 rounded">
              <p className="text-red-400 text-sm font-semibold">
                ❌ Connection failed! This indicates a Supabase Realtime issue.
              </p>
              <p className="text-red-300 text-xs mt-2">
                Check: Browser console, Network tab (WSS connection), Supabase settings
              </p>
            </div>
          )}
        </div>

        {/* Database Configuration */}
        {replicaIdentity && (
          <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
            <h2 className="text-xl font-semibold text-white mb-4">Database Configuration</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Replica Identity:</span>
                <span className="text-green-400 font-mono">{replicaIdentity.replica_identity}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">In Publication:</span>
                <span className="text-green-400 font-mono">
                  {replicaIdentity.in_realtime_publication ? 'YES ✅' : 'NO ❌'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Test Controls */}
        <div className="bg-gray-800 rounded-lg p-6 mb-6 border border-gray-700">
          <h2 className="text-xl font-semibold text-white mb-4">Test Insert</h2>
          <p className="text-gray-400 mb-4 text-sm">
            Insert a test row into realtime_prices. If Realtime is working, you should see the event below within milliseconds.
          </p>
          <button
            onClick={handleTestInsert}
            disabled={isInserting || connectionStatus !== 'SUBSCRIBED'}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition-colors"
          >
            {isInserting ? '⏳ Inserting...' : '🧪 Insert Test Row'}
          </button>
          {testInsertTime && (
            <div className="mt-4 text-yellow-400 text-sm">
              ⏱️ Waiting for event... (inserted {Math.round((Date.now() - testInsertTime) / 1000)}s ago)
            </div>
          )}
        </div>

        {/* High Latency Warning */}
        {events.length > 0 && events[0].latencyMs && events[0].latencyMs > 1000 && (
          <div className="bg-orange-900/20 border border-orange-500/30 rounded-lg p-6 mb-6">
            <h3 className="text-lg font-semibold text-orange-400 mb-3">⚠️ High Latency Detected</h3>
            <p className="text-orange-300 text-sm mb-2">
              Realtime events are being received with <strong>{Math.round(events[0].latencyMs! / 1000)}+ seconds</strong> of delay.
            </p>
            <p className="text-orange-200 text-xs">
              This indicates Supabase Realtime server is overloaded or experiencing replication lag.
              Events ARE working, but delayed significantly.
            </p>
          </div>
        )}

        {/* Events Log */}
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-white">Events Received</h2>
            <div className="text-sm text-gray-400">
              Total: <span className="text-white font-semibold">{events.length}</span>
            </div>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <div className="text-4xl mb-4">📭</div>
              <p>No events received yet</p>
              <p className="text-sm mt-2">
                {connectionStatus === 'SUBSCRIBED'
                  ? 'Click "Insert Test Row" to test, or wait for live price updates'
                  : 'Waiting for connection...'}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {events.map((event, index) => (
                <div
                  key={index}
                  className="bg-gray-700/50 rounded p-4 border border-gray-600 hover:border-blue-500 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-green-400 text-xl">✅</span>
                      <span className="text-white font-semibold">{event.eventType}</span>
                      {event.latencyMs !== undefined && (
                        <span className={`text-xs px-2 py-1 rounded ${
                          event.latencyMs < 100 ? 'bg-green-900/50 text-green-400' :
                          event.latencyMs < 500 ? 'bg-yellow-900/50 text-yellow-400' :
                          'bg-red-900/50 text-red-400'
                        }`}>
                          {event.latencyMs}ms latency
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400 text-xs">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="bg-gray-900 rounded p-3 text-xs font-mono text-gray-300 overflow-x-auto">
                    <pre>{JSON.stringify(event.payload, null, 2)}</pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="mt-6 bg-blue-900/20 border border-blue-500/30 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-400 mb-3">💡 How to Use</h3>
          <ol className="space-y-2 text-sm text-gray-300">
            <li>1. Wait for connection status to show "SUBSCRIBED" ✅</li>
            <li>2. Click "Insert Test Row" to manually trigger an INSERT</li>
            <li>3. Watch the Events section - you should see the event within 50-100ms</li>
            <li>4. If no events appear, check browser console for errors</li>
            <li>5. Open Network tab and look for WebSocket connection (wss://)</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
