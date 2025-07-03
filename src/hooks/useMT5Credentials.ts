import { useState, useEffect, useCallback } from 'react';
import { mt5CredentialsService, MT5Credentials, MT5AccountData } from '../services/mt5CredentialsService';

/**
 * Hook for managing MT5 credentials
 */
export const useMT5Credentials = () => {
  const [credentials, setCredentials] = useState<MT5Credentials | null>(null);
  const [accountData, setAccountData] = useState<MT5AccountData | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load credentials and connection status
  const loadCredentials = useCallback(() => {
    setIsLoading(true);
    setError(null);
    
    try {
      const creds = mt5CredentialsService.getCurrentCredentials();
      const account = mt5CredentialsService.getAccountData();
      const connected = mt5CredentialsService.isConnected();
      
      setCredentials(creds);
      setAccountData(account);
      setIsConnected(connected);
    } catch (err) {
      setError('Failed to load MT5 credentials');
      console.error('Error loading MT5 credentials:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Update credentials
  const updateCredentials = useCallback(async (newCredentials: MT5Credentials): Promise<boolean> => {
    setIsLoading(true);
    setError(null);
    
    try {
      const success = mt5CredentialsService.saveCredentials(newCredentials);
      
      if (success) {
        setCredentials(newCredentials);
        loadCredentials(); // Reload to get updated account data
      } else {
        setError('Failed to update MT5 credentials');
      }
      
      return success;
    } catch (err) {
      setError('Failed to update MT5 credentials');
      console.error('Error updating MT5 credentials:', err);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [loadCredentials]);

  // Connect to MT5
  const connect = useCallback(() => {
    try {
      mt5CredentialsService.connect();
      setIsConnected(true);
      return true;
    } catch (err) {
      console.error('Error connecting to MT5:', err);
      return false;
    }
  }, []);

  // Disconnect from MT5
  const disconnect = useCallback(() => {
    try {
      mt5CredentialsService.disconnect();
      setIsConnected(false);
      return true;
    } catch (err) {
      console.error('Error disconnecting from MT5:', err);
      return false;
    }
  }, []);

  // Load credentials on mount
  useEffect(() => {
    loadCredentials();
    
    // Set up interval to check connection status
    const interval = setInterval(() => {
      const connected = mt5CredentialsService.isConnected();
      setIsConnected(connected);
      
      // If connected, also refresh account data
      if (connected) {
        const account = mt5CredentialsService.getAccountData();
        setAccountData(account);
      }
    }, 5000);
    
    return () => clearInterval(interval);
  }, [loadCredentials]);

  return {
    credentials,
    accountData,
    isConnected,
    isLoading,
    error,
    updateCredentials,
    loadCredentials,
    connect,
    disconnect
  };
};