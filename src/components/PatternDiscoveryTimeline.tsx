import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Activity,
  BarChart2,
  Filter
} from 'lucide-react';

interface PatternEvent {
  id: string;
  date: Date;
  type: 'discovered' | 'degraded' | 'archived';
  patternName: string;
  symbol: string;
  ev: number;
  winRate: number;
  sampleSize: number;
  confidence: string;
  status: string;
}

export default function PatternDiscoveryTimeline() {
  const { user } = useAuth();
  const [patterns, setPatterns] = useState<any[]>([]);
  const [events, setEvents] = useState<PatternEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterSymbol, setFilterSymbol] = useState<string>('all');

  useEffect(() => {
    if (user) {
      loadPatterns();
    }
  }, [user]);

  const loadPatterns = async () => {
    if (!user) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('ai_pattern_ev_tracking')
        .select('*')
        .eq('user_id', user.id)
        .order('last_updated_at', { ascending: false });

      if (error) throw error;

      setPatterns(data || []);
      generateEvents(data || []);
    } catch (error) {
      console.error('[Pattern Timeline] Error loading patterns:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateEvents = (patternsData: any[]) => {
    const eventList: PatternEvent[] = [];

    patternsData.forEach((pattern) => {
      const firstSeen = new Date(pattern.first_seen_at);
      const lastUpdated = new Date(pattern.last_updated_at);

      if (pattern.pattern_status === 'active' && pattern.is_statistically_significant) {
        eventList.push({
          id: `${pattern.id}-discovered`,
          date: firstSeen,
          type: 'discovered',
          patternName: pattern.pattern_name,
          symbol: pattern.symbol,
          ev: parseFloat(pattern.expected_value),
          winRate: parseFloat(pattern.win_probability),
          sampleSize: pattern.sample_size,
          confidence: pattern.ev_confidence_level,
          status: pattern.pattern_status
        });
      }

      if (pattern.pattern_status === 'degraded') {
        eventList.push({
          id: `${pattern.id}-degraded`,
          date: lastUpdated,
          type: 'degraded',
          patternName: pattern.pattern_name,
          symbol: pattern.symbol,
          ev: parseFloat(pattern.expected_value),
          winRate: parseFloat(pattern.win_probability),
          sampleSize: pattern.sample_size,
          confidence: pattern.ev_confidence_level,
          status: pattern.pattern_status
        });
      }

      if (pattern.pattern_status === 'archived') {
        eventList.push({
          id: `${pattern.id}-archived`,
          date: lastUpdated,
          type: 'archived',
          patternName: pattern.pattern_name,
          symbol: pattern.symbol,
          ev: parseFloat(pattern.expected_value),
          winRate: parseFloat(pattern.win_probability),
          sampleSize: pattern.sample_size,
          confidence: pattern.ev_confidence_level,
          status: pattern.pattern_status
        });
      }
    });

    eventList.sort((a, b) => b.date.getTime() - a.date.getTime());
    setEvents(eventList);
  };

  const filteredPatterns = patterns.filter((pattern) => {
    if (filterStatus !== 'all' && pattern.pattern_status !== filterStatus) return false;
    if (filterSymbol !== 'all' && pattern.symbol !== filterSymbol) return false;
    return true;
  });

  const filteredEvents = events.filter((event) => {
    if (filterStatus !== 'all' && event.status !== filterStatus) return false;
    if (filterSymbol !== 'all' && event.symbol !== filterSymbol) return false;
    return true;
  });

  const symbols = [...new Set(patterns.map(p => p.symbol))];
  const activePatterns = patterns.filter(p => p.pattern_status === 'active').length;
  const degradedPatterns = patterns.filter(p => p.pattern_status === 'degraded').length;
  const avgEV = patterns.length > 0
    ? patterns.reduce((sum, p) => sum + parseFloat(p.expected_value || 0), 0) / patterns.length
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-br from-purple-900/30 to-pink-900/30 backdrop-blur-sm border-2 border-purple-500/30 rounded-lg shadow-md p-6">
        <div className="flex items-center gap-3 mb-2">
          <Sparkles className="w-8 h-8 text-purple-400" />
          <h2 className="text-2xl font-bold text-white">Pattern Discovery Timeline</h2>
        </div>
        <p className="text-gray-400">
          Track how the AI discovers and evolves trading patterns over time
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={<CheckCircle className="w-6 h-6 text-green-500" />}
          label="Active Patterns"
          value={activePatterns}
          color="green"
        />
        <StatCard
          icon={<AlertTriangle className="w-6 h-6 text-yellow-500" />}
          label="Degraded Patterns"
          value={degradedPatterns}
          color="yellow"
        />
        <StatCard
          icon={<BarChart2 className="w-6 h-6 text-blue-500" />}
          label="Total Patterns"
          value={patterns.length}
          color="blue"
        />
        <StatCard
          icon={<TrendingUp className="w-6 h-6 text-emerald-500" />}
          label="Avg Expected Value"
          value={avgEV.toFixed(2)}
          color="emerald"
        />
      </div>

      {/* Filters */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-4">
        <div className="flex items-center gap-4">
          <Filter className="w-5 h-5 text-gray-400" />
          <div className="flex-1 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Status:</label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-1 bg-gray-700 border border-gray-600 text-white rounded text-sm"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="degraded">Degraded</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-400">Symbol:</label>
              <select
                value={filterSymbol}
                onChange={(e) => setFilterSymbol(e.target.value)}
                className="px-3 py-1 bg-gray-700 border border-gray-600 text-white rounded text-sm"
              >
                <option value="all">All</option>
                {symbols.map(symbol => (
                  <option key={symbol} value={symbol}>{symbol}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Current Patterns */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Current Pattern Status</h3>
        {filteredPatterns.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No patterns found. Complete more backtests to discover patterns.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredPatterns.map((pattern) => (
              <div
                key={pattern.id}
                className={`p-4 rounded-lg border-2 ${
                  pattern.pattern_status === 'active'
                    ? 'border-green-500/30 bg-green-900/10'
                    : pattern.pattern_status === 'degraded'
                    ? 'border-yellow-500/30 bg-yellow-900/10'
                    : 'border-gray-700 bg-gray-900/20'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {pattern.pattern_status === 'active' && (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    )}
                    {pattern.pattern_status === 'degraded' && (
                      <AlertTriangle className="w-5 h-5 text-yellow-500" />
                    )}
                    {pattern.pattern_status === 'archived' && (
                      <XCircle className="w-5 h-5 text-gray-500" />
                    )}
                    <div>
                      <h4 className="font-semibold text-white">{pattern.pattern_name}</h4>
                      <p className="text-sm text-gray-400">{pattern.symbol}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-sm text-gray-400">Expected Value</div>
                      <div className={`text-lg font-bold ${
                        parseFloat(pattern.expected_value) > 0 ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {parseFloat(pattern.expected_value).toFixed(2)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-400">Win Rate</div>
                      <div className="text-lg font-bold text-white">
                        {parseFloat(pattern.win_probability).toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-400">Sample Size</div>
                      <div className="text-lg font-bold text-white">
                        {pattern.sample_size}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-gray-700">
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>Avg R:R: {parseFloat(pattern.avg_rr || 0).toFixed(2)}</span>
                    <span>•</span>
                    <span>PF: {parseFloat(pattern.profit_factor || 0).toFixed(2)}</span>
                    <span>•</span>
                    <span>Confidence: {pattern.ev_confidence_level}</span>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    pattern.pattern_status === 'active'
                      ? 'bg-green-600 text-white'
                      : pattern.pattern_status === 'degraded'
                      ? 'bg-yellow-600 text-white'
                      : 'bg-gray-600 text-white'
                  }`}>
                    {pattern.pattern_status.toUpperCase()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline of Events */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Discovery Timeline</h3>
        {filteredEvents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No pattern events to display.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-4">
                <div className="flex flex-col items-center">
                  <div className={`rounded-full p-2 ${
                    event.type === 'discovered'
                      ? 'bg-green-600'
                      : event.type === 'degraded'
                      ? 'bg-yellow-600'
                      : 'bg-gray-600'
                  }`}>
                    {event.type === 'discovered' && <Sparkles className="w-4 h-4 text-white" />}
                    {event.type === 'degraded' && <TrendingDown className="w-4 h-4 text-white" />}
                    {event.type === 'archived' && <XCircle className="w-4 h-4 text-white" />}
                  </div>
                  {filteredEvents.indexOf(event) !== filteredEvents.length - 1 && (
                    <div className="w-0.5 h-full bg-gray-700 mt-2"></div>
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="font-semibold text-white">
                      {event.type === 'discovered' && '✨ Pattern Discovered'}
                      {event.type === 'degraded' && '⚠️ Pattern Degraded'}
                      {event.type === 'archived' && '📦 Pattern Archived'}
                    </h4>
                    <span className="text-sm text-gray-400">
                      {event.date.toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-gray-300 mb-2">
                    <span className="font-semibold">{event.patternName}</span> on <span className="font-semibold">{event.symbol}</span>
                  </p>
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>EV: <span className={event.ev > 0 ? 'text-green-400' : 'text-red-400'}>{event.ev.toFixed(2)}</span></span>
                    <span>WR: {event.winRate.toFixed(1)}%</span>
                    <span>Sample: {event.sampleSize}</span>
                    <span>Confidence: {event.confidence}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: any) {
  const colorClasses = {
    green: 'border-green-500/30 bg-green-900/10',
    yellow: 'border-yellow-500/30 bg-yellow-900/10',
    blue: 'border-blue-500/30 bg-blue-900/10',
    emerald: 'border-emerald-500/30 bg-emerald-900/10'
  };

  return (
    <div className={`p-4 rounded-lg border-2 ${colorClasses[color as keyof typeof colorClasses]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
