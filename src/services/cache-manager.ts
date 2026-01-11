/**
 * Cache Manager Service
 *
 * SSOT for ALL cache operations across the application
 * Manages service worker caches, localStorage, sessionStorage, and IndexedDB
 * Provides unified cache clearing and version management
 */

import { candleCacheManager } from './candle-cache-manager';

interface CacheMetadata {
  version: string;
  timestamp: number;
}

class CacheManagerService {
  private readonly CACHE_KEY = 'pipnosis_last_session';
  private readonly VERSION_KEY = 'pipnosis_cache_version';
  private readonly MAX_SESSION_AGE_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Check and clear stale cache on session start
   */
  async checkAndClearStaleCache(): Promise<boolean> {
    try {
      const lastSessionStr = sessionStorage.getItem(this.CACHE_KEY);
      const now = Date.now();

      if (!lastSessionStr) {
        console.log('[CacheManager] First load in this session - clearing cache');
        await this.clearAllApplicationCache();
        sessionStorage.setItem(this.CACHE_KEY, now.toString());
        return true;
      }

      const lastSession = parseInt(lastSessionStr, 10);
      const sessionAge = now - lastSession;

      if (sessionAge > this.MAX_SESSION_AGE_MS) {
        console.log(`[CacheManager] Session expired (${Math.round(sessionAge / 60000)}min) - clearing cache`);
        await this.clearAllApplicationCache();
        sessionStorage.setItem(this.CACHE_KEY, now.toString());
        return true;
      }

      console.log(`[CacheManager] Session active (${Math.round(sessionAge / 60000)}min) - cache retained`);
      sessionStorage.setItem(this.CACHE_KEY, now.toString());
      return false;

    } catch (error) {
      console.error('[CacheManager] Error checking cache:', error);
      return false;
    }
  }

  /**
   * Force clear all cache on hard refresh
   */
  async forceClearOnHardRefresh(): Promise<void> {
    const perfEntries = performance.getEntriesByType('navigation');

    if (perfEntries.length > 0) {
      const navEntry = perfEntries[0] as PerformanceNavigationTiming;

      if (navEntry.type === 'reload') {
        console.log('[CacheManager] Hard refresh detected - clearing all cache');
        await this.clearAllApplicationCache();
        sessionStorage.removeItem(this.CACHE_KEY);
      }
    }
  }

  /**
   * Clear ALL caches - service worker, localStorage, sessionStorage
   * This is the nuclear option for complete cache invalidation
   */
  async clearAllApplicationCache(): Promise<void> {
    console.log('[CacheManager] Starting comprehensive cache clear...');

    // 1. Clear candle cache (delegated to candle cache manager)
    await candleCacheManager.clearAllCache();

    // 2. Clear all service worker caches
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        if (cacheNames.length > 0) {
          console.log(`[CacheManager] Deleting ${cacheNames.length} service worker cache(s)...`);
          await Promise.all(cacheNames.map(name => caches.delete(name)));
          console.log('[CacheManager] ✅ Service worker caches cleared');
        }
      } catch (error) {
        console.error('[CacheManager] Error clearing service worker caches:', error);
      }
    }

    // 3. Clear version-tracked localStorage items
    this.clearVersionedLocalStorage();

    // 4. Clear session storage (except critical auth data)
    this.clearSessionStorage();

    console.log('[CacheManager] ✅ All application caches cleared');
  }

  /**
   * Clear only versioned localStorage items (preserve user settings)
   */
  private clearVersionedLocalStorage(): void {
    try {
      const keysToRemove: string[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && this.isVersionedCacheKey(key)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });

      if (keysToRemove.length > 0) {
        console.log(`[CacheManager] Cleared ${keysToRemove.length} localStorage items`);
      }
    } catch (error) {
      console.error('[CacheManager] Error clearing localStorage:', error);
    }
  }

  /**
   * Determine if a localStorage key should be cleared during cache invalidation
   */
  private isVersionedCacheKey(key: string): boolean {
    const cacheKeyPatterns = [
      'chart-',
      'candle-',
      'indicators-',
      'historical-',
      'price-',
      'snapshot-',
      'market-',
      'cache-'
    ];

    // Don't clear critical user data
    const preservePatterns = [
      'auth-',
      'user-',
      'settings-',
      'supabase',
      'sb-'
    ];

    // Check if it matches a cache pattern but not a preserve pattern
    const isCache = cacheKeyPatterns.some(pattern => key.includes(pattern));
    const shouldPreserve = preservePatterns.some(pattern => key.includes(pattern));

    return isCache && !shouldPreserve;
  }

  /**
   * Clear session storage (except critical items)
   */
  private clearSessionStorage(): void {
    try {
      // Preserve critical session data
      const authTokens = sessionStorage.getItem('auth-tokens');

      sessionStorage.clear();

      // Restore critical data
      if (authTokens) {
        sessionStorage.setItem('auth-tokens', authTokens);
      }

      console.log('[CacheManager] SessionStorage cleared (critical data preserved)');
    } catch (error) {
      console.error('[CacheManager] Error clearing sessionStorage:', error);
    }
  }

  /**
   * Update cache version and check if version changed
   */
  async checkVersionMismatch(newVersion: string): Promise<boolean> {
    const currentVersion = localStorage.getItem(this.VERSION_KEY);

    if (!currentVersion) {
      localStorage.setItem(this.VERSION_KEY, newVersion);
      return false; // First time, no mismatch
    }

    if (currentVersion !== newVersion) {
      console.log(`[CacheManager] Version mismatch detected: ${currentVersion} → ${newVersion}`);
      localStorage.setItem(this.VERSION_KEY, newVersion);
      return true; // Version changed!
    }

    return false; // Same version
  }

  /**
   * Get current cache version
   */
  getCurrentVersion(): string | null {
    return localStorage.getItem(this.VERSION_KEY);
  }

  /**
   * Force clear everything and reload
   * Used for emergency recovery from cache corruption
   */
  async emergencyClearAndReload(): Promise<void> {
    console.log('[CacheManager] 🚨 EMERGENCY CACHE CLEAR INITIATED');

    try {
      // Clear everything
      await this.clearAllApplicationCache();

      // Clear version tracking
      localStorage.removeItem(this.VERSION_KEY);
      sessionStorage.clear();

      // Unregister all service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
        console.log('[CacheManager] Service workers unregistered');
      }

      // Wait a moment for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Hard reload from server
      console.log('[CacheManager] Performing hard reload...');
      window.location.reload();
    } catch (error) {
      console.error('[CacheManager] Emergency clear failed:', error);
      // Force reload anyway
      window.location.reload();
    }
  }

  /**
   * Update last access timestamp
   */
  updateLastAccess(): void {
    sessionStorage.setItem(this.CACHE_KEY, Date.now().toString());
  }

  /**
   * Get cache statistics for diagnostics
   */
  async getCacheStatistics(): Promise<{
    serviceWorkerCaches: number;
    localStorageItems: number;
    sessionStorageItems: number;
    currentVersion: string | null;
  }> {
    let swCacheCount = 0;

    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        swCacheCount = cacheNames.length;
      } catch (error) {
        console.error('[CacheManager] Error getting cache stats:', error);
      }
    }

    return {
      serviceWorkerCaches: swCacheCount,
      localStorageItems: localStorage.length,
      sessionStorageItems: sessionStorage.length,
      currentVersion: this.getCurrentVersion()
    };
  }
}

export const cacheManager = new CacheManagerService();
