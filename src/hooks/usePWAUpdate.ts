import { useState, useEffect } from 'react';
import { pwaUpdateManager, UpdateContext } from '../services/pwa-update-manager';

export function usePWAUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateContext, setUpdateContext] = useState<UpdateContext>('app-open');
  const [isChecking, setIsChecking] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<string>('Loading...');

  useEffect(() => {
    const unsubscribe = pwaUpdateManager.onUpdateAvailable(
      (available, context) => {
        setUpdateAvailable(available);
        setUpdateContext(context);

        if (context === 'app-open' && available) {
          pwaUpdateManager.skipWaitingAndReload();
        }
      }
    );

    pwaUpdateManager.getCurrentVersion().then(version => {
      setCurrentVersion(version);
    });

    return unsubscribe;
  }, []);

  const checkForUpdates = async () => {
    setIsChecking(true);
    try {
      const hasUpdate = await pwaUpdateManager.manualCheckForUpdates();
      if (!hasUpdate) {
        setUpdateAvailable(false);
      }
      return hasUpdate;
    } catch (error) {
      console.error('Error checking for updates:', error);
      return false;
    } finally {
      setIsChecking(false);
    }
  };

  const applyUpdate = () => {
    pwaUpdateManager.skipWaitingAndReload();
  };

  const dismissUpdate = () => {
    setUpdateAvailable(false);
  };

  return {
    updateAvailable,
    updateContext,
    isChecking,
    currentVersion,
    checkForUpdates,
    applyUpdate,
    dismissUpdate,
  };
}
