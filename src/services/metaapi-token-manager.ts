class MetaApiTokenManager {
  private currentToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private region: string = 'new-york';
  private isInitialized: boolean = false;

  async getToken(accountId: string, region: string = 'new-york'): Promise<string> {
    this.region = region;

    if (this.currentToken && this.isTokenValid()) {
      return this.currentToken;
    }

    return this.loadToken();
  }

  private isTokenValid(): boolean {
    if (!this.tokenExpiry) {
      return false;
    }

    const bufferMinutes = 5;
    const expiryWithBuffer = new Date(this.tokenExpiry.getTime() - bufferMinutes * 60 * 1000);
    return new Date() < expiryWithBuffer;
  }

  private loadToken(): string {
    const envToken = import.meta.env.VITE_METAAPI_TOKEN || '';

    if (!envToken) {
      throw new Error('MetaAPI token not configured in environment');
    }

    if (!this.isInitialized) {
      console.log('🔑 MetaAPI secure token loaded');
      this.isInitialized = true;
    }

    this.currentToken = envToken;
    this.tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    return envToken;
  }

  clearToken(): void {
    this.currentToken = null;
    this.tokenExpiry = null;
    this.isInitialized = false;
  }

  getTokenInfo() {
    return {
      hasToken: !!this.currentToken,
      tokenPrefix: this.currentToken?.substring(0, 8) || null,
      tokenSuffix: this.currentToken?.substring(this.currentToken.length - 8) || null,
      expiresAt: this.tokenExpiry?.toISOString() || null,
      expiresInMinutes: this.tokenExpiry ? Math.floor((this.tokenExpiry.getTime() - Date.now()) / 1000 / 60) : null,
      isValid: this.isTokenValid(),
      region: this.region,
    };
  }

  async testConnection(accountId: string): Promise<any> {
    console.log('🧪 Testing MetaAPI connection...');
    try {
      const token = await this.getToken(accountId, this.region);
      console.log('✅ Token loaded successfully');
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
