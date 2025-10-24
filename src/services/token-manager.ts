interface TokenData {
  token: string;
  expiresAt: number;
  accountId: string;
}

class TokenManager {
  private tokenCache: Map<string, TokenData> = new Map();
  private readonly TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

  async getToken(accountId: string): Promise<string> {
    const cached = this.tokenCache.get(accountId);

    if (cached && !this.isTokenExpiringSoon(cached)) {
      console.log(`Using cached token for account ${accountId} (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)`);
      return cached.token;
    }

    console.log(`Fetching new token for account ${accountId}${cached ? ' (cached token expiring soon)' : ''}`);
    return await this.fetchNewToken(accountId);
  }

  private isTokenExpiringSoon(tokenData: TokenData): boolean {
    const timeUntilExpiry = tokenData.expiresAt - Date.now();
    return timeUntilExpiry <= this.TOKEN_REFRESH_BUFFER_MS;
  }

  private async fetchNewToken(accountId: string): Promise<string> {
    try {
      const netlifyUrl = '/.netlify/functions/get-metaapi-token';

      const response = await fetch(netlifyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
          errorData.details ||
          `Failed to fetch token: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (!data.token) {
        throw new Error('Invalid response: missing token');
      }

      // Calculate expiration time from expiresAt if provided, otherwise default to 1 hour
      let expiresAt: number;
      if (data.expiresAt) {
        expiresAt = new Date(data.expiresAt).getTime();
      } else {
        const expiresIn = data.expiresIn || 3600;
        expiresAt = Date.now() + (expiresIn * 1000);
      }

      const tokenData: TokenData = {
        token: data.token,
        expiresAt,
        accountId
      };

      this.tokenCache.set(accountId, tokenData);

      const minutesValid = Math.round((expiresAt - Date.now()) / 1000 / 60);
      const source = data.source || (data.cached ? 'cache' : 'generated');

      console.log(`✓ Received ${source} token for account ${accountId} (valid for ${minutesValid} minutes)`);

      return data.token;

    } catch (error) {
      console.error(`Failed to fetch MetaAPI token for account ${accountId}:`, error);
      throw new Error(
        `Token fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `Ensure METAAPI_ADMIN_TOKEN and METAAPI_ACCOUNT_ID are configured in Netlify.`
      );
    }
  }

  clearCache(accountId?: string): void {
    if (accountId) {
      this.tokenCache.delete(accountId);
      console.log(`Cleared token cache for account ${accountId}`);
    } else {
      this.tokenCache.clear();
      console.log('Cleared all token cache');
    }
  }

  isTokenCached(accountId: string): boolean {
    const cached = this.tokenCache.get(accountId);
    return !!cached && !this.isTokenExpiringSoon(cached);
  }

  getTokenExpiryTime(accountId: string): number | null {
    const cached = this.tokenCache.get(accountId);
    return cached ? cached.expiresAt : null;
  }
}

export const tokenManager = new TokenManager();
