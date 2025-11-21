import React, { useEffect, useState } from 'react';
import { Clock, AlertCircle } from 'lucide-react';
import { getForexMarketStatus, getTimeUntilMarketChange, type MarketStatus } from '@/utils/marketHours';

interface MarketStatusBannerProps {
  className?: string;
}

export function MarketStatusBanner({ className = '' }: MarketStatusBannerProps) {
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(() => getForexMarketStatus());
  const [timeUntilChange, setTimeUntilChange] = useState(() => getTimeUntilMarketChange());

  useEffect(() => {
    const updateStatus = () => {
      setMarketStatus(getForexMarketStatus());
      setTimeUntilChange(getTimeUntilMarketChange());
    };

    updateStatus();
    const interval = setInterval(updateStatus, 30000);

    return () => clearInterval(interval);
  }, []);

  if (marketStatus.isOpen) {
    return null;
  }

  const formatTime = () => {
    const { hours, minutes } = timeUntilChange;
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    return `${hours}h ${minutes}m`;
  };

  return (
    <div className={`bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertCircle className="text-amber-500 flex-shrink-0 mt-0.5" size={20} />
        <div className="flex-1">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-amber-500 font-semibold text-sm">Forex Market Closed</p>
              <p className="text-amber-400/80 text-xs mt-1">
                Market reopens Sunday 5:00 PM EST
              </p>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
              <Clock size={16} className="text-amber-400" />
              <div className="text-right">
                <p className="text-xs text-amber-400/70">Opens in</p>
                <p className="text-amber-400 font-bold text-lg leading-none">{formatTime()}</p>
              </div>
            </div>
          </div>
          <p className="text-amber-400/60 text-xs mt-2">
            Chart updates are paused. Last price shown from Friday market close.
          </p>
        </div>
      </div>
    </div>
  );
}
