/**
 * Error Handler Service
 *
 * SSOT for all error detection and recovery logic
 * Handles chunk load errors, network errors, and other application errors
 */

class ErrorHandler {
  private isRecovering = false;
  private recoveryAttempts = 0;
  private readonly MAX_RECOVERY_ATTEMPTS = 2;

  isWebContainerError(error: any): boolean {
    if (!error) return false;
    const message = error.message || error.toString();
    return message.includes('WebContainer') ||
           message.includes('ERR_NETWORK_CHANGED') ||
           message.includes('ERR_CONNECTION_RESET');
  }

  isMetaApiError(error: any): boolean {
    if (!error) return false;
    const message = error.message || error.toString();
    return message.includes('mt-provisioning-api') ||
           message.includes('agiliumtrade.ai') ||
           message.includes('MetaApi');
  }

  /**
   * Detect if error is a chunk load failure (404 on dynamic import)
   */
  isChunkLoadError(error: any): boolean {
    if (!error) return false;

    const message = error.message || error.toString();

    // Match various chunk load error patterns
    return (
      message.includes('Failed to fetch dynamically imported module') ||
      message.includes('ChunkLoadError') ||
      message.includes('Loading chunk') ||
      message.includes('ERR_ABORTED') ||
      (message.includes('404') && message.includes('assets/'))
    );
  }

  /**
   * Handle chunk load errors with automatic cache clear and reload
   */
  async handleChunkLoadError(error: any): Promise<void> {
    // Prevent multiple simultaneous recovery attempts
    if (this.isRecovering) {
      console.log('[ErrorHandler] Recovery already in progress, skipping...');
      return;
    }

    // Check if we've exceeded max attempts
    if (this.recoveryAttempts >= this.MAX_RECOVERY_ATTEMPTS) {
      console.error('[ErrorHandler] Max recovery attempts reached. Manual intervention needed.');
      this.showFatalError();
      return;
    }

    this.isRecovering = true;
    this.recoveryAttempts++;

    console.error('🚨 [ErrorHandler] CHUNK LOAD ERROR DETECTED', {
      error: error.message,
      attempt: this.recoveryAttempts,
      stack: error.stack
    });

    try {
      // Show user notification
      this.showRecoveryNotification();

      // Dynamic import to avoid circular dependencies
      const { cacheManager } = await import('../services/cache-manager');

      console.log('[ErrorHandler] Clearing all caches and reloading...');

      // Emergency cache clear and reload
      await cacheManager.emergencyClearAndReload();
    } catch (recoveryError) {
      console.error('[ErrorHandler] Recovery failed:', recoveryError);
      // Force reload anyway
      window.location.reload();
    }
  }

  /**
   * Show recovery notification to user
   */
  private showRecoveryNotification(): void {
    // Create a simple notification overlay
    const overlay = document.createElement('div');
    overlay.id = 'chunk-error-recovery';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    overlay.innerHTML = `
      <div style="
        background: #1a1a1a;
        border: 2px solid #10b981;
        border-radius: 12px;
        padding: 32px;
        max-width: 400px;
        text-align: center;
      ">
        <div style="
          width: 48px;
          height: 48px;
          margin: 0 auto 16px;
          border: 3px solid #10b981;
          border-top-color: transparent;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
        <h2 style="color: #10b981; margin: 0 0 8px; font-size: 20px;">
          New Version Available
        </h2>
        <p style="color: #9ca3af; margin: 0; font-size: 14px;">
          Updating to the latest version...
        </p>
      </div>
      <style>
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;

    document.body.appendChild(overlay);
  }

  /**
   * Show fatal error when recovery fails
   */
  private showFatalError(): void {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.95);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    overlay.innerHTML = `
      <div style="background: #1a1a1a; border: 2px solid #ef4444; border-radius: 12px; padding: 32px; max-width: 400px; text-align: center;">
        <h2 style="color: #ef4444; margin: 0 0 16px; font-size: 20px;">Update Failed</h2>
        <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px;">
          Please close all tabs and reopen the app, or clear your browser cache.
        </p>
        <button onclick="window.location.reload(true)" style="
          background: #ef4444;
          color: white;
          border: none;
          padding: 12px 24px;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
        ">
          Try Again
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
  }

  handleWebContainerTimeout(error: any): void {
    console.warn('WebContainer timeout (non-critical):', error?.message);
  }

  handleMetaApiError(error: any): void {
    console.warn('MetaApi error (handled):', error?.message);
  }

  handleNetworkError(error: any): void {
    console.warn('Network error (handled):', error?.message);
  }

  handleResourcePreloadWarning(filename: string): void {
    console.warn('Resource preload warning:', filename);
  }

  /**
   * Reset recovery state (call after successful load)
   */
  resetRecoveryState(): void {
    this.recoveryAttempts = 0;
    this.isRecovering = false;
  }
}

export const errorHandler = new ErrorHandler();
