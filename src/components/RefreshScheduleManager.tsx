import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Play, Pause, Trash2, Plus, RefreshCw, Clock, CheckCircle, XCircle } from 'lucide-react';

interface RefreshSchedule {
  id: string;
  symbol: string;
  timeframe: '5m' | '15m' | '1h';
  days_back: number;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

interface RefreshHistory {
  id: string;
  symbol: string;
  timeframe: string;
  started_at: string;
  completed_at: string | null;
  candles_fetched: number;
  candles_saved: number;
  status: 'running' | 'completed' | 'failed';
  error_message: string | null;
  duration_ms: number | null;
  triggered_by: string;
}

export const RefreshScheduleManager: React.FC = () => {
  const [schedules, setSchedules] = useState<RefreshSchedule[]>([]);
  const [history, setHistory] = useState<RefreshHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newSchedule, setNewSchedule] = useState({
    symbol: 'EURUSD',
    timeframe: '5m' as '5m' | '15m' | '1h',
    days_back: 3
  });

  useEffect(() => {
    loadSchedules();
    loadHistory();
  }, []);

  const loadSchedules = async () => {
    try {
      const { data, error } = await supabase
        .from('refresh_schedules')
        .select('*')
        .order('symbol', { ascending: true })
        .order('timeframe', { ascending: true });

      if (error) throw error;
      setSchedules(data || []);
    } catch (error) {
      console.error('Error loading schedules:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_refresh_history', {
          p_symbol: null,
          p_timeframe: null,
          p_status: null,
          p_limit: 50
        });

      if (error) throw error;
      setHistory(data || []);
    } catch (error) {
      console.error('Error loading history:', error);
    }
  };

  const toggleSchedule = async (id: string, enabled: boolean) => {
    try {
      const { error } = await supabase
        .from('refresh_schedules')
        .update({ enabled: !enabled })
        .eq('id', id);

      if (error) throw error;
      loadSchedules();
    } catch (error) {
      console.error('Error toggling schedule:', error);
    }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Are you sure you want to delete this schedule?')) return;

    try {
      const { error } = await supabase
        .from('refresh_schedules')
        .delete()
        .eq('id', id);

      if (error) throw error;
      loadSchedules();
    } catch (error) {
      console.error('Error deleting schedule:', error);
    }
  };

  const addSchedule = async () => {
    try {
      const { error } = await supabase
        .from('refresh_schedules')
        .insert([{
          ...newSchedule,
          enabled: true,
          next_run_at: new Date().toISOString()
        }]);

      if (error) throw error;
      setShowAddForm(false);
      setNewSchedule({ symbol: 'EURUSD', timeframe: '5m', days_back: 3 });
      loadSchedules();
    } catch (error) {
      console.error('Error adding schedule:', error);
      alert('Failed to add schedule. It may already exist.');
    }
  };

  const triggerManualRefresh = async (symbol: string, timeframe: string, daysBack: number) => {
    if (!confirm(`Manually trigger refresh for ${symbol} ${timeframe}?`)) return;

    setRefreshing(true);
    try {
      const adminKey = import.meta.env.VITE_ADMIN_REFRESH_KEY || 'pipnosis-admin-refresh-2024';
      const url = `/.netlify/functions/refresh-candles?symbol=${symbol}&timeframe=${timeframe}&daysBack=${daysBack}&adminKey=${adminKey}`;

      const response = await fetch(url, { method: 'POST' });
      const result = await response.json();

      if (response.ok) {
        alert(`Refresh completed: ${result.candlesSaved} candles saved`);
        loadHistory();
        loadSchedules();
      } else {
        alert(`Refresh failed: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Error triggering refresh:', error);
      alert('Failed to trigger refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const triggerBatchRefresh = async () => {
    if (!confirm('Trigger batch refresh for all enabled schedules?')) return;

    setRefreshing(true);
    try {
      const adminKey = import.meta.env.VITE_ADMIN_REFRESH_KEY || 'pipnosis-admin-refresh-2024';
      const url = `/.netlify/functions/refresh-candles?mode=batch&adminKey=${adminKey}`;

      const response = await fetch(url, { method: 'POST' });
      const result = await response.json();

      if (response.ok) {
        alert(`Batch refresh completed: ${result.successful} successful, ${result.failed} failed`);
        loadHistory();
        loadSchedules();
      } else {
        alert(`Batch refresh failed: ${result.error || result.message}`);
      }
    } catch (error) {
      console.error('Error triggering batch refresh:', error);
      alert('Failed to trigger batch refresh');
    } finally {
      setRefreshing(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '-';
    const seconds = (ms / 1000).toFixed(2);
    return `${seconds}s`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Refresh Schedule Manager</h2>
        <div className="flex gap-2">
          <button
            onClick={triggerBatchRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Batch Refresh All
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Schedule
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Add New Schedule</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Symbol</label>
              <input
                type="text"
                value={newSchedule.symbol}
                onChange={(e) => setNewSchedule({ ...newSchedule, symbol: e.target.value.toUpperCase() })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                placeholder="EURUSD"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Timeframe</label>
              <select
                value={newSchedule.timeframe}
                onChange={(e) => setNewSchedule({ ...newSchedule, timeframe: e.target.value as '5m' | '15m' | '1h' })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              >
                <option value="5m">5 minutes</option>
                <option value="15m">15 minutes</option>
                <option value="1h">1 hour</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">Days Back</label>
              <input
                type="number"
                value={newSchedule.days_back}
                onChange={(e) => setNewSchedule({ ...newSchedule, days_back: parseInt(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                min="1"
                max="365"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={addSchedule}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded transition-colors"
            >
              Add Schedule
            </button>
            <button
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Active Schedules</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Symbol</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Timeframe</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Days Back</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Last Run</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Next Run</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {schedules.map((schedule) => (
                <tr key={schedule.id} className="hover:bg-gray-750">
                  <td className="px-6 py-4 text-sm font-medium text-white">{schedule.symbol}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{schedule.timeframe}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{schedule.days_back}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{formatDate(schedule.last_run_at)}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{formatDate(schedule.next_run_at)}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      schedule.enabled ? 'bg-green-900 text-green-200' : 'bg-gray-700 text-gray-300'
                    }`}>
                      {schedule.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex gap-2">
                      <button
                        onClick={() => triggerManualRefresh(schedule.symbol, schedule.timeframe, schedule.days_back)}
                        disabled={refreshing}
                        className="text-blue-400 hover:text-blue-300 disabled:text-gray-600"
                        title="Trigger manual refresh"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => toggleSchedule(schedule.id, schedule.enabled)}
                        className="text-yellow-400 hover:text-yellow-300"
                        title={schedule.enabled ? 'Disable' : 'Enable'}
                      >
                        {schedule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => deleteSchedule(schedule.id)}
                        className="text-red-400 hover:text-red-300"
                        title="Delete schedule"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg overflow-hidden border border-gray-700">
        <div className="px-6 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Refresh History</h3>
          <button
            onClick={loadHistory}
            className="text-sm text-blue-400 hover:text-blue-300"
          >
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Symbol</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Timeframe</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Started</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Candles</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Duration</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">Trigger</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {history.map((item) => (
                <tr key={item.id} className="hover:bg-gray-750">
                  <td className="px-6 py-4 text-sm font-medium text-white">{item.symbol}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{item.timeframe}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{formatDate(item.started_at)}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      item.status === 'completed' ? 'bg-green-900 text-green-200' :
                      item.status === 'failed' ? 'bg-red-900 text-red-200' :
                      'bg-yellow-900 text-yellow-200'
                    }`}>
                      {item.status === 'completed' && <CheckCircle className="w-3 h-3" />}
                      {item.status === 'failed' && <XCircle className="w-3 h-3" />}
                      {item.status === 'running' && <Clock className="w-3 h-3 animate-spin" />}
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-300">
                    {item.candles_saved > 0 ? `${item.candles_saved} saved` : '-'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-300">{formatDuration(item.duration_ms)}</td>
                  <td className="px-6 py-4 text-sm text-gray-300">{item.triggered_by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
