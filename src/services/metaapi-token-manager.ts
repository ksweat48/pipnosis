import { supabase } from '@/lib/supabase';

interface TokenData {
  token: string;
  expiresAt: string;
  region: string;
  isAdminToken?: boolean;
  warning?: string;
}

class MetaApiTokenManager {
  private currentToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private isAdminToken: boolean = false;
  private region: string = 'new-york';
  private isRefreshing: boolean = false;

  async getToken(accountId: string, region: string = 'new-york'): Promise<string> {
    this.region = region;

    if (this.currentToken && this.isTokenValid()) {
      return this.currentToken;
    }

    if (this.isRefreshing) {
      await this.waitForRefresh();
      if (this.currentToken && this.isTokenValid()) {
        return this.currentToken;
      }
    }

    return await this.refreshToken(accountId);
  }

  private isTokenValid(): boolean {
    if (!this.tokenExpiry) {
      return false;
    }

    const bufferMinutes = 5;
    const expiryWithBuffer = new Date(this.tokenExpiry.getTime() - bufferMinutes * 60 * 1000);
    return new Date() < expiryWithBuffer;
  }

  private async waitForRefresh(): Promise<void> {
    const maxWait = 10000;
    const startTime = Date.now();

    while (this.isRefreshing && (Date.now() - startTime) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  private async refreshToken(accountId: string): Promise<string> {
    this.isRefreshing = true;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const tokenUrl = `${supabaseUrl}/functions/v1/metaapi-token`;

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.warn('No active session - falling back to environment token');
        return this.getFallbackToken();
      }

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          accountId,
          region: this.region,
        }),
      });

      if (!response.ok) {
        console.warn('Failed to fetch secure token - falling back to environment token');
        return this.getFallbackToken();
      }

      const tokenData: TokenData = await response.json();

      this.currentToken = tokenData.token;
      this.tokenExpiry = new Date(tokenData.expiresAt);
      this.isAdminToken = tokenData.isAdminToken || false;

      if (tokenData.warning) {
        console.warn(`⚠️ Token warning: ${tokenData.warning}`);
      }

      if (this.isAdminToken) {
        console.warn('⚠️ Using admin token - Token Management API unavailable');
      } else {
        console.log('✅ Secure temporary token acquired');
      }

      return this.currentToken;
    } catch (error) {
      console.error('Error refreshing token:', error);
      return this.getFallbackToken();
    } finally {
      this.isRefreshing = false;
    }
  }

  private getFallbackToken(): string {
    const envToken = import.meta.env.VITE_METAAPI_TOKEN || '';

    if (!envToken) {
      throw new Error('No MetaAPI token available');
    }

    console.warn('⚠️ Using environment token directly (not recommended for production)');

    this.currentToken = envToken;
    this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    this.isAdminToken = true;

    return envToken;
  }

  clearToken(): void {
    this.currentToken = null;
    this.tokenExpiry = null;
    this.isAdminToken = false;
  }

  isUsingAdminToken(): boolean {
    return this.isAdminToken;
  }
}

export const metaApiTokenManager = new MetaApiTokenManager();
