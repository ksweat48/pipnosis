class MetaApiTokenManager {
  private currentToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private region: string = 'new-york';
  private isInitialized: boolean = false;
  private isFetching: boolean = false;

  async getToken(accountId: string, region: string = 'new-york'): Promise<string> {
    this.region = region;

    if (this.currentToken && this.isTokenValid()) {
      return this.currentToken;
    }

    if (this.isFetching) {
      await this.waitForFetch();
      if (this.currentToken && this.isTokenValid()) {
        return this.currentToken;
      }
    }

    return this.fetchTokenFromEdgeFunction(accountId, region);
  }

  private async waitForFetch(): Promise<void> {
    let attempts = 0;
    while (this.isFetching && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
  }

  private isTokenValid(): boolean {
    if (!this.tokenExpiry) {
      return false;
    }

    const bufferMinutes = 5;
    const expiryWithBuffer = new Date(this.tokenExpiry.getTime() - bufferMinutes * 60 * 1000);
    return new Date() < expiryWithBuffer;
  }

  private async fetchTokenFromEdgeFunction(accountId: string, region: string): Promise<string> {
    this.isFetching = true;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase configuration not found');
      }

      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/metaapi-token`;

      if (!this.isInitialized) {
        console.log('🔑 Fetching secure MetaAPI token from edge function...');
        this.isInitialized = true;
      }

      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
          'apikey': supabaseKey
        },
        body: JSON.stringify({ accountId, region })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Token fetch failed:', errorData);

        throw new Error(
          `Failed to fetch secure token from edge function: ${errorData.message || errorData.error || response.statusText}\n` +
          `Status: ${response.status}\n` +
          (errorData.troubleshooting ? `\nTroubleshooting:\n- ${errorData.troubleshooting.join('\n- ')}` : '') +
          `\n\nThe edge function could not generate a secure token. This may be due to:\n` +
          `- SSL certificate validation issues\n` +
          `- MetaAPI service connectivity problems\n` +
          `- Invalid admin token configuration\n\n` +
          `Please check the Supabase edge function logs for more details.`
        );
      }

      const data = await response.json();

      if (!data.token) {
        throw new Error('No token received from edge function');
      }

      this.currentToken = data.token;
      this.tokenExpiry = new Date(data.expiresAt);

      console.log('✅ Secure MetaAPI token obtained successfully');

      return data.token;
    } catch (error) {
      this.currentToken = null;
      this.tokenExpiry = null;
      throw error;
    } finally {
      this.isFetching = false;
    }
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
}

export const metaApiTokenManager = new MetaApiTokenManager();
