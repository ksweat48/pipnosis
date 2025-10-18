class MetaApiTokenManager {
  private currentToken: string | null = null;
  private tokenExpiry: Date | null = null;
  private region: string = 'new-york';
  private isInitialized: boolean = false;
  private isFetching: boolean = false;
  private useDirectToken: boolean = false;

  async getToken(accountId: string, region: string = 'new-york'): Promise<string> {
    this.region = region;

    // Check if we have admin token available for direct use
    const adminToken = import.meta.env.VITE_METAAPI_TOKEN;

    // Use admin token directly if edge function has failed before or if we're set to use direct token
    if (this.useDirectToken && adminToken) {
      if (!this.isInitialized) {
        console.log('🔑 Using MetaAPI admin token directly (edge function bypassed)');
        this.isInitialized = true;
      }
      this.currentToken = adminToken;
      // Set a far future expiry since admin tokens don't expire in the same way
      this.tokenExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      return adminToken;
    }

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
          `Failed to fetch secure token: ${errorData.message || errorData.error || response.statusText}\n` +
          `Status: ${response.status}\n` +
          (errorData.troubleshooting ? `\nTroubleshooting:\n- ${errorData.troubleshooting.join('\n- ')}` : '')
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

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Check if this is an SSL/certificate error
      const isSslError = errorMessage.includes('SSL') ||
                        errorMessage.includes('certificate') ||
                        errorMessage.includes('ERR_CERT') ||
                        errorMessage.includes('UnknownIssuer') ||
                        errorMessage.includes('invalid peer certificate');

      if (isSslError) {
        console.warn('⚠️ SSL Certificate Error detected in edge function. Attempting fallback to direct admin token...');

        // Switch to using direct admin token
        const adminToken = import.meta.env.VITE_METAAPI_TOKEN;
        if (adminToken) {
          this.useDirectToken = true;
          console.log('✅ Falling back to direct admin token due to edge function SSL issues');

          // Return the admin token directly
          this.currentToken = adminToken;
          this.tokenExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
          return adminToken;
        } else {
          throw new Error(
            'SSL Certificate Error: Unable to connect to MetaAPI Token Service.\n' +
            'No admin token available for fallback.\n' +
            'Please set VITE_METAAPI_TOKEN in your environment variables.'
          );
        }
      }

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

  forceDirectToken(): void {
    this.useDirectToken = true;
    this.clearToken();
    console.log('🔄 Forced direct admin token usage (bypassing edge function)');
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
      usingDirectToken: this.useDirectToken,
    };
  }
}

export const metaApiTokenManager = new MetaApiTokenManager();
