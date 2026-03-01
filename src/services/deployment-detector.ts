class DeploymentDetector {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    try {
      const response = await fetch('/version.json', { cache: 'no-store' });
      if (response.ok) {
        const data = await response.json();
        const storedVersion = localStorage.getItem('app_version');
        const currentVersion = data.version?.toString();

        if (storedVersion && currentVersion && storedVersion !== currentVersion) {
          console.log('[DeploymentDetector] New deployment detected, refreshing...');
          localStorage.setItem('app_version', currentVersion);
          window.location.reload();
          return;
        }

        if (currentVersion) {
          localStorage.setItem('app_version', currentVersion);
        }
      }
    } catch {
      // Non-critical — silently ignore
    }
  }
}

export const deploymentDetector = new DeploymentDetector();
