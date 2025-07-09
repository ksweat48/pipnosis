import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for checking backend connection status
 */
export const useBackendConnection = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const checkConnection = useCallback(async () => {
    setIsChecking(true);
    try {
      // Simulate a backend connection check
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // For demo purposes, randomly determine if connected
      // In a real app, you would make an actual API call to your backend
      const connected = Math.random() > 0.3; // 70% chance of being connected
      setIsConnected(connected);
      setLastChecked(new Date());
    } catch (error) {
      setIsConnected(false);
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkConnection();
    
    // Check connection status periodically
    const interval = setInterval(checkConnection, 30000);
    
    return () => clearInterval(interval);
  }, [checkConnection]);

  return {
    isConnected,
    isChecking,
    lastChecked,
    checkConnection
  };
};