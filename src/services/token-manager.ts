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
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '') || ''}/functions/v1/get-metaapi-token`;
      const netlifyUrl = '/.netlify/functions/get-metaapi-token';

      const url = import.meta.env.PROD ? netlifyUrl : netlifyUrl;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accountId })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error ||
          errorData.message ||
          `Failed to fetch token: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();

      if (!data.token) {
        throw new Error('Invalid response: missing token');
      }

      const expiresIn = data.expiresIn || 3600;
      const expiresAt = Date.now() + (expiresIn * 1000);

      const tokenData: TokenData = {
        token: data.token,
        expiresAt,
        accountId
      };

      this.tokenCache.set(accountId, tokenData);

      console.log(`✓ Received new token for account ${accountId} (valid for ${Math.round(expiresIn / 60)} minutes)`);

      return data.token;

    } catch (error) {
      console.error(`Failed to fetch MetaAPI token for account ${accountId}:`, error);
      throw new Error(
        `Token fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
        `Ensure backend token service is running and METAAPI_ADMIN_TOKEN is configured.`
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
