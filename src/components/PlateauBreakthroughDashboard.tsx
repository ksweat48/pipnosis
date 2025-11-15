import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Zap, Target, Activity } from 'lucide-react';
import { plateauDetector, PlateauAnalysis } from '../services/plateau-detector';
import { breakthroughEngine } from '../services/breakthrough-engine';
import { supabase } from '../lib/supabase';

interface Props {
  userId: string;
}

export default function PlateauBreakthroughDashboard({ userId }: Props) {
  const [plateauStatus, setPlateauStatus] = useState<PlateauAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [breakthroughRunning, setBreakthroughRunning] = useState(false);

  useEffect(() => {
    loadPlateauStatus();
    const interval = setInterval(loadPlateauStatus, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  // Realtime subscription for plateau status updates
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`plateau-status-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ai_skill_progression',
          filter: `user_id=eq.${userId}`
        },
        () => {
          console.log('[Plateau Dashboard] Skill progression updated, reloading...');
          loadPlateauStatus();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'backtest_sessions',
          filter: `user_id=eq.${userId}`
        },
        () => {
          console.log('[Plateau Dashboard] New backtest session detected, reloading...');
          loadPlateauStatus();
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'synthetic_backtest_sessions',
          filter: `user_id=eq.${userId}`
        },
        () => {
          console.log('[Plateau Dashboard] New synthetic backtest detected, reloading...');
          loadPlateauStatus();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const loadPlateauStatus = async () => {
    try {
      const analysis = await plateauDetector.detectPlateau(userId);
      setPlateauStatus(analysis);
      setBreakthroughRunning(breakthroughEngine.isBreakthroughRunning());
    } catch (error) {
      console.error('Error loading plateau status:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerBreakthrough = async () => {
    setBreakthroughRunning(true);
    try {
      const result = await breakthroughEngine.runFullBreakthroughCycle(userId);
      alert(`Breakthrough cycle complete!\n\nBest Strategy: ${result.bestStrategy?.strategyName}\nImprovement: ${result.bestStrategy?.improvement.toFixed(1)}%\n\n${result.recommendation}`);
      loadPlateauStatus();
    } catch (error) {
      console.error('Error running breakthrough:', error);
      alert('Failed to run breakthrough cycle');
    } finally {
      setBreakthroughRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center space-x-2">
          <Activity className="w-5 h-5 text-blue-400 animate-pulse" />
          <span className="text-gray-400">Analyzing performance...</span>
        </div>
      </div>
    );
  }

  if (!plateauStatus) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center space-x-2">
          <AlertTriangle className="w-5 h-5 text-yellow-400" />
          <span className="text-gray-400">Insufficient data for plateau detection</span>
        </div>
        <p className="text-sm text-gray-500 mt-2">
          Run at least 10 backtests to enable plateau detection
        </p>
      </div>
    );
  }

  const statusColor = plateauStatus.isPlateaued ? 'red' : 'green';
  const statusIcon = plateauStatus.isPlateaued ? AlertTriangle : TrendingUp;
  const StatusIcon = statusIcon;

  return (
    <div className="space-y-4">
      <div className={`bg-gray-800 rounded-lg p-6 border-2 ${
        plateauStatus.isPlateaued ? 'border-red-500' : 'border-green-500'
      }`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <StatusIcon className={`w-6 h-6 text-${statusColor}-400`} />
            <div>
              <h3 className="text-lg font-semibold text-white">
                {plateauStatus.isPlateaued ? 'Performance Plateau Detected' : 'Performance Progressing'}
              </h3>
              <p className="text-sm text-gray-400">
                {plateauStatus.isPlateaued ? 'AI is stuck - breakthrough recommended' : 'AI continues to improve'}
              </p>
            </div>
          </div>

          {plateauStatus.isPlateaued && plateauStatus.shouldTriggerExploration && (
            <button
              onClick={handleTriggerBreakthrough}
              disabled={breakthroughRunning}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                breakthroughRunning
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600'
              }`}
            >
              <Zap className="w-4 h-4" />
              <span>{breakthroughRunning ? 'Running...' : 'Trigger Breakthrough'}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">Current Win Rate</div>
            <div className="text-2xl font-bold text-white">
              {plateauStatus.currentWinRate.toFixed(1)}%
            </div>
          </div>

          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">Win Rate Range</div>
            <div className="text-lg font-semibold text-white">
              {plateauStatus.winRateRange.min.toFixed(1)}% - {plateauStatus.winRateRange.max.toFixed(1)}%
            </div>
            <div className={`text-xs ${
              (plateauStatus.winRateRange.max - plateauStatus.winRateRange.min) <= 5 ? 'text-red-400' : 'text-green-400'
            }`}>
              {(plateauStatus.winRateRange.max - plateauStatus.winRateRange.min).toFixed(1)}% spread
            </div>
          </div>

          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">Plateau Duration</div>
            <div className="text-2xl font-bold text-white">
              {plateauStatus.plateauDuration}
            </div>
            <div className="text-xs text-gray-400">sessions</div>
          </div>

          <div className="bg-gray-700 rounded-lg p-3">
            <div className="text-xs text-gray-400 mb-1">Last Breakthrough</div>
            <div className="text-sm font-medium text-white">
              {plateauStatus.lastBreakthrough
                ? new Date(plateauStatus.lastBreakthrough).toLocaleDateString()
                : 'Never'
              }
            </div>
            <div className="text-xs text-gray-400">
              {plateauStatus.lastBreakthrough
                ? `${Math.floor((Date.now() - new Date(plateauStatus.lastBreakthrough).getTime()) / (1000 * 60 * 60 * 24))}d ago`
                : 'No breakthroughs yet'
              }
            </div>
          </div>
        </div>

        <div className={`p-4 rounded-lg ${
          plateauStatus.isPlateaued ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'
        }`}>
          <div className="flex items-start space-x-2">
            <Target className={`w-5 h-5 mt-0.5 ${plateauStatus.isPlateaued ? 'text-red-400' : 'text-green-400'}`} />
            <div>
              <h4 className="font-semibold text-white mb-1">Recommendation</h4>
              <p className={`text-sm ${plateauStatus.isPlateaued ? 'text-red-200' : 'text-green-200'}`}>
                {plateauStatus.recommendation}
              </p>
            </div>
          </div>
        </div>

        {breakthroughRunning && (
          <div className="mt-4 p-4 bg-purple-500/10 border border-purple-500/30 rounded-lg">
            <div className="flex items-center space-x-2">
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-purple-400 border-t-transparent" />
              <span className="text-purple-200 text-sm font-medium">
                Breakthrough mode active - testing experimental strategies...
              </span>
            </div>
          </div>
        )}
      </div>

      {plateauStatus.isPlateaued && (
        <div className="bg-gradient-to-r from-purple-900/50 to-pink-900/50 rounded-lg p-6 border border-purple-500/30">
          <h4 className="text-lg font-semibold text-white mb-3 flex items-center space-x-2">
            <Zap className="w-5 h-5 text-yellow-400" />
            <span>How Breakthrough Mode Works</span>
          </h4>
          <div className="space-y-2 text-sm text-gray-300">
            <p>1. Tests multiple experimental strategies with different parameters</p>
            <p>2. Runs full backtests for each approach (confidence sweeps, symbol focus, time filters)</p>
            <p>3. Compares results against your current baseline</p>
            <p>4. Identifies which approach yields the highest improvement</p>
            <p>5. Automatically adopts the best strategy if it improves win rate by 5%+</p>
          </div>
          <div className="mt-4 p-3 bg-purple-500/20 rounded-lg">
            <p className="text-xs text-purple-200">
              <strong>Note:</strong> Breakthrough mode takes 5-10 minutes to complete as it runs multiple backtests sequentially. Your AI will automatically apply the best strategy found.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
