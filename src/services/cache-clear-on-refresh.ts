/**
 * Cache Clear on Page Refresh Service
 *
 * Automatically clears stale cache on hard refresh (Ctrl+R, F5, Cmd+R)
 * This ensures users always see fresh data from the database after refreshing
 */

import { candleCacheManager } from './candle-cache-manager';

class CacheClearOnRefreshService {
  private readonly CACHE_KEY = 'pipnosis_last_session';
  private readonly MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes

  async checkAndClearStaleCache(): Promise<boolean> {
    try {
      const lastSessionStr = sessionStorage.getItem(this.CACHE_KEY);
      const now = Date.now();

      if (!lastSessionStr) {
        console.log('[CacheClear] 🆕 First load in this session - clearing cache');
        await candleCacheManager.clearAllCache();
        sessionStorage.setItem(this.CACHE_KEY, now.toString());
        return true;
      }

      const lastSession = parseInt(lastSessionStr, 10);
      const sessionAge = now - lastSession;

      if (sessionAge > this.MAX_SESSION_AGE_MS) {
        console.log(`[CacheClear] 🔄 Session expired (${Math.round(sessionAge / 60000)}min) - clearing cache`);
        await candleCacheManager.clearAllCache();
        sessionStorage.setItem(this.CACHE_KEY, now.toString());
        return true;
      }

      console.log(`[CacheClear] ✅ Session active (${Math.round(sessionAge / 60000)}min) - cache retained`);
      sessionStorage.setItem(this.CACHE_KEY, now.toString());
      return false;

    } catch (error) {
      console.error('[CacheClear] Error checking cache:', error);
      return false;
    }
  }

  async forceClearOnHardRefresh(): Promise<void> {
    const perfEntries = performance.getEntriesByType('navigation');

    if (perfEntries.length > 0) {
      const navEntry = perfEntries[0] as PerformanceNavigationTiming;

      if (navEntry.type === 'reload') {
        console.log('[CacheClear] 🔄 Hard refresh detected - clearing all cache');
        await candleCacheManager.clearAllCache();
        sessionStorage.removeItem(this.CACHE_KEY);
      }
    }
  }

  updateLastAccess(): void {
    sessionStorage.setItem(this.CACHE_KEY, Date.now().toString());
  }
}

export const cacheClearOnRefresh = new CacheClearOnRefreshService();
