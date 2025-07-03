/**
 * MT5 Credentials Service
 * 
 * This service provides methods to interact with the MT5 credentials
 * stored in localStorage. In a production environment, this would
 * communicate with the Python bridge to update the actual encrypted
 * credentials file.
 */

// Types
export interface MT5Credentials {
  login: string;
  password?: string; // Optional for security
  server: string;
  accountType: 'demo' | 'live';
  lastUpdated?: string;
}

export interface MT5AccountData {
  login: string;
  server: string;
  balance: number;
  equity: number;
  margin?: number;
  freeMargin?: number;
  marginLevel?: number;
  openPositions?: any[];
  lastUpdate: string;
  connectionStatus?: 'connected' | 'disconnected';
}

// Service
export const mt5CredentialsService = {
  /**
   * Get current MT5 credentials from localStorage
   */
  getCurrentCredentials(): MT5Credentials | null {
    try {
      const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');
      if (!mt5AccountData) return null;
      
      const accountData = JSON.parse(mt5AccountData);
      return {
        login: accountData.login || '',
        server: accountData.server || '',
        accountType: accountData.accountType || 'demo',
        lastUpdated: accountData.lastUpdate || new Date().toISOString()
      };
    } catch (error) {
      console.error('Error loading MT5 credentials:', error);
      return null;
    }
  },
  
  /**
   * Get current MT5 account data from localStorage
   */
  getAccountData(): MT5AccountData | null {
    try {
      const mt5AccountData = localStorage.getItem('pipnosis_mt5_account');
      if (!mt5AccountData) return null;
      
      return JSON.parse(mt5AccountData);
    } catch (error) {
      console.error('Error loading MT5 account data:', error);
      return null;
    }
  },
  
  /**
   * Save MT5 credentials to localStorage
   * In a production environment, this would call the Python bridge
   */
  saveCredentials(credentials: MT5Credentials): boolean {
    try {
      // Get existing account data if available
      const existingData = this.getAccountData() || {
        balance: 10000,
        equity: 10000,
        lastUpdate: new Date().toISOString()
      };
      
      // Update with new credentials
      const accountData = {
        ...existingData,
        login: credentials.login,
        server: credentials.server,
        accountType: credentials.accountType,
        lastUpdate: new Date().toISOString()
      };
      
      // Save to localStorage
      localStorage.setItem('pipnosis_mt5_account', JSON.stringify(accountData));
      
      // In a real implementation, this would call the Python bridge
      console.log('MT5 credentials updated:', {
        login: credentials.login,
        server: credentials.server,
        accountType: credentials.accountType
      });
      
      return true;
    } catch (error) {
      console.error('Error saving MT5 credentials:', error);
      return false;
    }
  },
  
  /**
   * Check if MT5 is connected
   */
  isConnected(): boolean {
    return localStorage.getItem('pipnosis_mt5_connected') === 'true';
  },
  
  /**
   * Disconnect MT5
   */
  disconnect(): void {
    localStorage.setItem('pipnosis_mt5_connected', 'false');
  },
  
  /**
   * Connect MT5 (simulated)
   */
  connect(): void {
    localStorage.setItem('pipnosis_mt5_connected', 'true');
  }
};