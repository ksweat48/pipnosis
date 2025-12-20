import { supabase } from '../lib/supabase';

export type UpdateContext = 'app-open' | 'app-resume';

interface UpdateListener {
  (updateAvailable: boolean, context: UpdateContext): void;
}

class PWAUpdateManager {
  private registration: ServiceWorkerRegistration | null = null;
  private wasHidden = false;
  private updateListeners: Set<UpdateListener> = new Set();
  private isCheckingForUpdate = false;
  private lastCheckTime: number = 0;
  private readonly CHECK_COOLDOWN = 30000; // Increased from 5s to 30s to reduce conflicts

  async initialize(registration: ServiceWorkerRegistration | null) {
    this.registration = registration;

    if (!registration) {
      console.log('[PWA Update] No service worker registration available');
      return;
    }

    this.setupVisibilityListener();
    this.setupServiceWorkerListeners();

    await this.checkForUpdatesOnOpen();
  }

  private setupVisibilityListener() {
    // Debounced visibility change to prevent conflicts with IDE auto-save
    let visibilityTimeout: NodeJS.Timeout | null = null;

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.wasHidden = true;
        // Clear any pending checks when tab becomes hidden
        if (visibilityTimeout) {
          clearTimeout(visibilityTimeout);
          visibilityTimeout = null;
        }
      } else {
        if (this.wasHidden) {
          // Debounce the check to avoid conflicts with IDE mechanisms
          if (visibilityTimeout) {
            clearTimeout(visibilityTimeout);
          }

          visibilityTimeout = setTimeout(() => {
            console.log('[PWA Update] App resumed from background (debounced)');
            this.checkForUpdatesOnResume();
            visibilityTimeout = null;
          }, 3000); // 3 second debounce
        }
        this.wasHidden = false;
      }
    });
  }

  private setupServiceWorkerListeners() {
    if (!this.registration) return;

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data.type === 'UPDATE_AVAILABLE') {
        console.log('[PWA Update] Service worker reports update available');
        this.notifyListeners(true, 'app-resume');
      }
    });

    this.registration.addEventListener('updatefound', () => {
      console.log('[PWA Update] Update found by service worker');
      const newWorker = this.registration?.installing;

      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[PWA Update] New service worker installed');
            const context: UpdateContext = this.wasHidden ? 'app-resume' : 'app-open';
            this.notifyListeners(true, context);
          }
        });
      }
    });
  }

  private async checkForUpdatesOnOpen() {
    if (!this.registration) return;

    const now = Date.now();
    if (this.isCheckingForUpdate || now - this.lastCheckTime < this.CHECK_COOLDOWN) {
      console.log('[PWA Update] Skipping check - cooldown active');
      return;
    }

    this.isCheckingForUpdate = true;
    this.lastCheckTime = now;

    try {
      console.log('[PWA Update] Checking for updates on app open...');

      // Only check, don't auto-reload to avoid conflicts with IDE
      await this.registration.update();

      const hasUpdate = await this.hasWaitingServiceWorker();

      if (hasUpdate) {
        console.log('[PWA Update] Update available - notifying listeners');
        this.notifyListeners(true, 'app-open');
      } else {
        console.log('[PWA Update] No updates available');
      }
    } catch (error) {
      console.error('[PWA Update] Error checking for updates:', error);
    } finally {
      this.isCheckingForUpdate = false;
    }
  }

  private async checkForUpdatesOnResume() {
    if (!this.registration) return;

    const now = Date.now();
    if (this.isCheckingForUpdate || now - this.lastCheckTime < this.CHECK_COOLDOWN) {
      return;
    }

    this.isCheckingForUpdate = true;
    this.lastCheckTime = now;

    try {
      console.log('[PWA Update] Checking for updates on app resume...');
      await this.registration.update();

      const hasUpdate = await this.hasWaitingServiceWorker();

      if (hasUpdate) {
        console.log('[PWA Update] Update available on resume - showing banner...');
        this.notifyListeners(true, 'app-resume');
      } else {
        console.log('[PWA Update] No updates available');
      }
    } catch (error) {
      console.error('[PWA Update] Error checking for updates:', error);
    } finally {
      this.isCheckingForUpdate = false;
    }
  }

  async manualCheckForUpdates(): Promise<boolean> {
    if (!this.registration) {
      console.log('[PWA Update] No service worker registration for manual check');
      return false;
    }

    try {
      console.log('[PWA Update] Manual update check initiated...');
      await this.registration.update();
      const hasUpdate = await this.hasWaitingServiceWorker();

      if (hasUpdate) {
        console.log('[PWA Update] Manual check found update');
        this.notifyListeners(true, 'app-resume');
      } else {
        console.log('[PWA Update] Manual check - no updates');
      }

      return hasUpdate;
    } catch (error) {
      console.error('[PWA Update] Error in manual update check:', error);
      return false;
    }
  }

  private async hasWaitingServiceWorker(): Promise<boolean> {
    if (!this.registration) return false;

    return !!(
      this.registration.waiting ||
      (this.registration.installing && navigator.serviceWorker.controller)
    );
  }

  skipWaitingAndReload() {
    if (!this.registration) return;

    const waitingWorker = this.registration.waiting;
    if (waitingWorker) {
      console.log('[PWA Update] Activating new service worker and reloading...');
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        console.log('[PWA Update] Controller changed - reloading page');
        window.location.reload();
      }, { once: true });
    } else {
      console.log('[PWA Update] No waiting worker - reloading anyway');
      window.location.reload();
    }
  }

  onUpdateAvailable(listener: UpdateListener) {
    this.updateListeners.add(listener);
    return () => {
      this.updateListeners.delete(listener);
    };
  }

  private notifyListeners(updateAvailable: boolean, context: UpdateContext) {
    this.updateListeners.forEach(listener => {
      try {
        listener(updateAvailable, context);
      } catch (error) {
        console.error('[PWA Update] Error in update listener:', error);
      }
    });
  }

  async getCurrentVersion(): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('app_versions')
        .select('version')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (error) {
        console.error('[PWA Update] Error fetching version:', error);
        return 'Unknown';
      }

      return data?.version || 'Unknown';
    } catch (error) {
      console.error('[PWA Update] Error getting current version:', error);
      return 'Unknown';
    }
  }
}

export const pwaUpdateManager = new PWAUpdateManager();
