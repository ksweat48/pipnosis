import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Activity, AlertCircle, CheckCircle, Clock } from 'lucide-react';

interface AggregatorHealth {
  isActive: boolean;
  lastCandleTime: Date | null;
  minutesSinceLastCandle: number;
  status: 'healthy' | 'warning' | 'error';
  message: string;
}

export function ServerSideAggregatorStatus() {
  const [health, setHealth] = useState<AggregatorHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAggregatorHealth = async () => {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('data_source', 'netlify_aggregator')
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error checking aggregator health:', error);
        setHealth({
          isActive: false,
          lastCandleTime: null,
          minutesSinceLastCandle: Infinity,
          status: 'error',
          message: 'Unable to check server status'
        });
        return;
      }

      if (!data) {
        setHealth({
          isActive: false,
          lastCandleTime: null,
          minutesSinceLastCandle: Infinity,
          status: 'warning',
          message: 'No candles found from server aggregator'
        });
        return;
      }

      const lastCandleTime = new Date(data.open_time);
      const minutesSinceLastCandle = (Date.now() - lastCandleTime.getTime()) / (1000 * 60);

      let status: 'healthy' | 'warning' | 'error';
      let message: string;

      if (minutesSinceLastCandle < 10) {
        status = 'healthy';
        message = 'Server-side collection active';
      } else if (minutesSinceLastCandle < 30) {
        status = 'warning';
        message = 'Server collection delayed';
      } else {
        status = 'error';
        message = 'Server collection stalled';
      }

      setHealth({
        isActive: status === 'healthy',
        lastCandleTime,
        minutesSinceLastCandle,
        status,
        message
      });
    } catch (error) {
      console.error('Error checking aggregator health:', error);
      setHealth({
        isActive: false,
        lastCandleTime: null,
        minutesSinceLastCandle: Infinity,
        status: 'error',
        message: 'Health check failed'
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    checkAggregatorHealth();
    const interval = setInterval(checkAggregatorHealth, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, []);

  if (isLoading) {
    return null;
  }

  if (!health) {
    return null;
  }

  const getStatusIcon = () => {
    switch (health.status) {
      case 'healthy':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'warning':
        return <Clock className="w-4 h-4 text-yellow-500" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
    }
  };

  const getStatusColor = () => {
    switch (health.status) {
      case 'healthy':
        return 'text-green-400 border-green-500/30 bg-green-500/10';
      case 'warning':
        return 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10';
      case 'error':
        return 'text-red-400 border-red-500/30 bg-red-500/10';
    }
  };

  const formatTimeSince = (minutes: number): string => {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${Math.round(minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);
    return `${hours}h ${remainingMinutes}m ago`;
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${getStatusColor()}`}>
      <Activity className="w-4 h-4" />
      <div className="flex items-center gap-2 text-xs">
        {getStatusIcon()}
        <span className="font-medium">{health.message}</span>
        {health.lastCandleTime && (
          <span className="opacity-70">
            {formatTimeSince(health.minutesSinceLastCandle)}
          </span>
        )}
      </div>
      {health.status === 'healthy' && (
        <div className="ml-1 text-xs opacity-70">
          Candles persist when browser closed
        </div>
      )}
    </div>
  );
}
