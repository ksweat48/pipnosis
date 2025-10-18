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
  private lastRefreshTime: Date | null = null;
  private tokenRefreshCount: number = 0;

  async getToken(accountId: string, region: string = 'new-york'): Promise<string> {
    this.region = region;

    if (this.currentToken && this.isTokenValid()) {
      const timeUntilExpiry = this.tokenExpiry ? Math.floor((this.tokenExpiry.getTime() - Date.now()) / 1000 / 60) : 0;
      console.log(`🔑 Using cached token (expires in ${timeUntilExpiry} minutes) | Type: ${this.isAdminToken ? 'Admin' : 'Temporary'}`);
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
    const startTime = Date.now();
    console.log(`🔄 Refreshing MetaAPI token for account ${accountId} in region ${this.region}...`);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const tokenUrl = `${supabaseUrl}/functions/v1/metaapi-token`;

      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        console.warn('⚠️ No active session - falling back to environment token');
        return this.getFallbackToken();
      }

      console.log(`📡 Calling edge function: ${tokenUrl}`);
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

      const responseTime = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Edge function failed (${response.status}) after ${responseTime}ms:`, errorText);
        console.warn('⚠️ Falling back to environment token');
        return this.getFallbackToken();
      }

      const tokenData: TokenData = await response.json();

      this.currentToken = tokenData.token;
      this.tokenExpiry = new Date(tokenData.expiresAt);
      this.isAdminToken = tokenData.isAdminToken || false;
      this.lastRefreshTime = new Date();
      this.tokenRefreshCount++;

      const tokenPrefix = this.currentToken.substring(0, 8);
      const tokenSuffix = this.currentToken.substring(this.currentToken.length - 8);
      const expiryTime = Math.floor((this.tokenExpiry.getTime() - Date.now()) / 1000 / 60);

      console.log(`✅ Token acquired in ${responseTime}ms | Prefix: ${tokenPrefix}... | Suffix: ...${tokenSuffix}`);
      console.log(`📅 Expires in ${expiryTime} minutes | Type: ${this.isAdminToken ? 'Admin (Fallback)' : 'Temporary (Secure)'} | Refresh #${this.tokenRefreshCount}`);

      if (tokenData.warning) {
        console.warn(`⚠️ Token warning: ${tokenData.warning}`);
      }

      if (this.isAdminToken) {
        console.warn('⚠️ Using admin token - Token Management API may be unavailable');
        console.warn('💡 Check edge function logs or test with: window.testMetaAPIConnection()');
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
      console.error('❌ No MetaAPI token available in environment');
      throw new Error('No MetaAPI token available');
    }

    const tokenPrefix = envToken.substring(0, 8);
    const tokenSuffix = envToken.substring(envToken.length - 8);
    const isJWT = envToken.startsWith('eyJ');

    console.warn('⚠️ Using environment token directly (not recommended for production)');
    console.log(`🔑 Fallback token | Prefix: ${tokenPrefix}... | Suffix: ...${tokenSuffix} | Format: ${isJWT ? 'JWT' : 'Unknown'}`);

    if (!isJWT) {
      console.error('❌ WARNING: Token does not appear to be a valid JWT (should start with "eyJ")');
      console.error('💡 Please verify VITE_METAAPI_TOKEN in your .env file');
    }

    this.currentToken = envToken;
    this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    this.isAdminToken = true;
    this.lastRefreshTime = new Date();
    this.tokenRefreshCount++;

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

  getTokenInfo() {
    return {
      hasToken: !!this.currentToken,
      tokenPrefix: this.currentToken?.substring(0, 8) || null,
      tokenSuffix: this.currentToken?.substring(this.currentToken.length - 8) || null,
      isAdminToken: this.isAdminToken,
      expiresAt: this.tokenExpiry?.toISOString() || null,
      expiresInMinutes: this.tokenExpiry ? Math.floor((this.tokenExpiry.getTime() - Date.now()) / 1000 / 60) : null,
      isValid: this.isTokenValid(),
      region: this.region,
      lastRefreshTime: this.lastRefreshTime?.toISOString() || null,
      refreshCount: this.tokenRefreshCount,
      isRefreshing: this.isRefreshing,
    };
  }

  async testConnection(accountId: string): Promise<any> {
    console.log('🧪 Testing MetaAPI connection...');
    try {
      const token = await this.getToken(accountId, this.region);
      console.log('✅ Token acquisition successful');
      return {
        success: true,
        tokenInfo: this.getTokenInfo(),
      };
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        tokenInfo: this.getTokenInfo(),
      };
    }
  }
}

export const metaApiTokenManager = new MetaApiTokenManager();
