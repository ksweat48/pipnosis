import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, Clock } from 'lucide-react';

interface WeekendStatus {
  isActive: boolean;
  message: string;
  hoursUntilClose?: number;
  minutesUntilClose?: number;
}

export function WeekendProtectionBanner() {
  const [status, setStatus] = useState<WeekendStatus>({
    isActive: false,
    message: ''
  });

  useEffect(() => {
    const updateStatus = async () => {
      try {
        const { weekendProtectionService } = await import('../services/weekend-protection-service');
        const currentStatus = weekendProtectionService.getStatusForDisplay();
        setStatus(currentStatus);
      } catch (error) {
        console.error('Failed to get weekend protection status:', error);
      }
    };

    // Update immediately
    updateStatus();

    // Update every minute
    const interval = setInterval(updateStatus, 60000);

    return () => clearInterval(interval);
  }, []);

  if (!status.isActive) {
    return null;
  }

  // Determine banner style based on severity
  const getSeverityStyle = () => {
    if (status.message.includes('Auto-closing')) {
      return 'bg-red-500 border-red-600';
    } else if (status.message.includes('No new trades')) {
      return 'bg-orange-500 border-orange-600';
    } else if (status.message.includes('Market Closed')) {
      return 'bg-gray-500 border-gray-600';
    } else {
      return 'bg-yellow-500 border-yellow-600';
    }
  };

  const getIcon = () => {
    if (status.message.includes('Market Closed')) {
      return <Shield className="w-4 h-4" />;
    } else if (status.message.includes('Auto-closing')) {
      return <AlertTriangle className="w-4 h-4" />;
    } else {
      return <Clock className="w-4 h-4" />;
    }
  };

  return (
    <div className={`${getSeverityStyle()} border text-white px-3 py-1.5 shadow-md`}>
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-2">
        {getIcon()}
        <span className="text-sm font-semibold">{status.message}</span>
        {status.hoursUntilClose !== undefined && status.minutesUntilClose !== undefined && (
          <span className="text-xs opacity-90">
            ({status.hoursUntilClose}h {status.minutesUntilClose}m remaining)
          </span>
        )}
      </div>
    </div>
  );
}
