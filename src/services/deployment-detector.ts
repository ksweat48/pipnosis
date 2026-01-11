/**
 * Deployment Detector Service
 *
 * SSOT for version checking and deployment mismatch detection
 * Monitors for new deployments and triggers cache invalidation when needed
 */

import { cacheManager } from './cache-manager';

interface VersionManifest {
  version: string;
  buildTime: string;
}

class DeploymentDetectorService {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MANIFEST_URL = '/version.json';
  private currentVersion: string | null = null;
  private isChecking = false;

  /**
   * Initialize deployment detection
   */
  async initialize(): Promise<void> {
    try {
      // Get current version from server
      const manifest = await this.fetchVersionManifest();
      if (manifest) {
        this.currentVersion = manifest.version;
        console.log(`[DeploymentDetector] Current version: ${this.currentVersion}`);

        // Check if this is a new version compared to cache
        const versionChanged = await cacheManager.checkVersionMismatch(manifest.version);
        if (versionChanged) {
          console.log('[DeploymentDetector] New version detected - clearing cache');
          await cacheManager.clearAllApplicationCache();
        }
      }

      // Start periodic checking
      this.startPeriodicCheck();

      // Check on visibility change (when user returns to tab)
      this.setupVisibilityListener();
    } catch (error) {
      console.error('[DeploymentDetector] Initialization error:', error);
    }
  }

  /**
   * Fetch version manifest from server
   */
  private async fetchVersionManifest(): Promise<VersionManifest | null> {
    try {
      // Add cache-busting timestamp
      const response = await fetch(`${this.MANIFEST_URL}?t=${Date.now()}`, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });

      if (!response.ok) {
        console.warn('[DeploymentDetector] Version manifest not found');
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[DeploymentDetector] Error fetching version:', error);
      return null;
    }
  }

  /**
   * Check for new deployment
   */
  async checkForNewDeployment(): Promise<boolean> {
    if (this.isChecking) {
      return false;
    }

    this.isChecking = true;

    try {
      const manifest = await this.fetchVersionManifest();
      if (!manifest) {
        return false;
      }

      // Compare versions
      if (this.currentVersion && manifest.version !== this.currentVersion) {
        console.log(`[DeploymentDetector] 🚀 NEW DEPLOYMENT DETECTED!`);
        console.log(`[DeploymentDetector] Old: ${this.currentVersion}`);
        console.log(`[DeploymentDetector] New: ${manifest.version}`);

        // Update stored version
        this.currentVersion = manifest.version;
        await cacheManager.checkVersionMismatch(manifest.version);

        return true; // New deployment found!
      }

      return false; // Same version
    } catch (error) {
      console.error('[DeploymentDetector] Error checking deployment:', error);
      return false;
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Start periodic version checking
   */
  private startPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      const newDeployment = await this.checkForNewDeployment();
      if (newDeployment) {
        this.handleNewDeployment();
      }
    }, this.CHECK_INTERVAL_MS);

    console.log('[DeploymentDetector] Periodic checking started (5 min interval)');
  }

  /**
   * Setup visibility change listener
   */
  private setupVisibilityListener(): void {
    document.addEventListener('visibilitychange', async () => {
      if (!document.hidden) {
        // User returned to tab - check for updates
        console.log('[DeploymentDetector] Tab visible - checking for updates...');
        const newDeployment = await this.checkForNewDeployment();
        if (newDeployment) {
          this.handleNewDeployment();
        }
      }
    });
  }

  /**
   * Handle new deployment detection
   */
  private handleNewDeployment(): void {
    console.log('[DeploymentDetector] Triggering cache clear and reload...');

    // Show user notification
    this.showReloadNotification();
  }

  /**
   * Show reload notification to user
   */
  private showReloadNotification(): void {
    // Check if we can show a notification
    if (typeof window !== 'undefined') {
      // Try to use the global toast manager if available
      const showToast = async () => {
        try {
          const { globalToastManager } = await import('./global-toast-manager');
          globalToastManager.showToast(
            'info',
            'New Version Available',
            'Refreshing to update...',
            3000
          );
        } catch (error) {
          console.log('[DeploymentDetector] Toast manager not available');
        }
      };

      showToast();

      // Auto-reload after 3 seconds
      setTimeout(async () => {
        await cacheManager.emergencyClearAndReload();
      }, 3000);
    }
  }

  /**
   * Stop periodic checking
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[DeploymentDetector] Periodic checking stopped');
    }
  }

  /**
   * Get current version
   */
  getCurrentVersion(): string | null {
    return this.currentVersion;
  }

  /**
   * Manual check for updates (triggered by user)
   */
  async manualCheck(): Promise<{
    hasUpdate: boolean;
    currentVersion: string | null;
    newVersion: string | null;
  }> {
    const manifest = await this.fetchVersionManifest();
    const hasUpdate = manifest ? manifest.version !== this.currentVersion : false;

    return {
      hasUpdate,
      currentVersion: this.currentVersion,
      newVersion: manifest?.version || null
    };
  }
}

export const deploymentDetector = new DeploymentDetectorService();
