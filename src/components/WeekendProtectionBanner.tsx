import React, { useState, useEffect } from 'react';
import { Shield, AlertTriangle, Clock, Calendar } from 'lucide-react';

interface WeekendStatus {
  isActive: boolean;
  message: string;
  hoursUntilClose?: number;
  minutesUntilClose?: number;
  holidayName?: string;
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
        const currentStatus = await weekendProtectionService.getStatusForDisplay();
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
    // Holiday-specific styling (blue/teal for informational)
    if (status.holidayName || status.message.includes('holiday') || status.message.includes('Holiday')) {
      return 'bg-blue-600 border-blue-700';
    }
    // System shutdown (gray)
    if (status.message.includes('paused') || status.message.includes('Shutdown')) {
      return 'bg-gray-600 border-gray-700';
    }
    // Imminent closure warning (orange)
    if (status.message.includes('closes in') || status.message.includes('close in')) {
      return 'bg-orange-500 border-orange-600';
    }
    // Default warning (yellow)
    return 'bg-yellow-500 border-yellow-600';
  };

  const getIcon = () => {
    // Holiday icon
    if (status.holidayName || status.message.includes('holiday') || status.message.includes('Holiday')) {
      return <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
    }
    // System shutdown icon
    if (status.message.includes('paused') || status.message.includes('Shutdown')) {
      return <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
    }
    // Imminent closure icon
    if (status.message.includes('closes in') || status.message.includes('close in')) {
      return <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
    }
    // Default warning icon
    return <AlertTriangle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />;
  };

  return (
    <div className={`${getSeverityStyle()} border text-white px-2 sm:px-3 py-1.5 shadow-md`}>
      <div className="max-w-7xl mx-auto flex items-center justify-center gap-1.5 sm:gap-2">
        <span className="flex-shrink-0">{getIcon()}</span>
        <span className="text-xs sm:text-sm font-semibold whitespace-nowrap truncate">{status.message}</span>
      </div>
    </div>
  );
}
