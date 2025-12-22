import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { errorHandler } from '@/lib/error-handler';
import App from './App.tsx';
import './index.css';

// Application startup (debug info available via logger if needed)

// Silence verbose logs in production
import('./lib/silence-verbose-logs');

// Initialize logging and utilities only in development
if (!import.meta.env.PROD) {
  // Load logger and utilities only in dev mode
  import('@/lib/logger').then(({ logger, LogLevel }) => {
    logger.setGlobalLevel(LogLevel.DEBUG);
  });

  // Load debug utilities only in dev
  import('./utils/scanner-test');
  import('@/lib/log-presets').then(({ logPresets }) => {
    console.log('\n%c💡 Logging System Available', 'color: #4CAF50; font-weight: bold; font-size: 14px');
    console.log('%cType logPresets.help() for quick log configuration', 'color: #2196F3; font-size: 12px');
    console.log('%cType logger.showHelp() for advanced configuration\n', 'color: #2196F3; font-size: 12px');
  });
}

// Dynamic viewport height for mobile - handles URL bar collapse
if (typeof window !== 'undefined') {
  function setAppHeight() {
    const vh = window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${vh}px`);
  }

  setAppHeight();
  window.addEventListener('resize', setAppHeight);
  window.addEventListener('orientationchange', setAppHeight);
  window.addEventListener('scroll', setAppHeight, { passive: true });

  // Also handle visualViewport for better mobile support
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppHeight);
    window.visualViewport.addEventListener('scroll', setAppHeight);
  }

  // Auto-hide browser address bar on load
  // This trick forces mobile browsers to collapse the address bar immediately
  setTimeout(() => {
    window.scrollTo(0, 1);
    setTimeout(() => {
      window.scrollTo(0, 0);
      setAppHeight();
    }, 10);
  }, 100);

  // Register service worker for PWA functionality with smart update management
  // Disabled in Bolt/StackBlitz environments to prevent preview issues
  const isBoltEnvironment = window.location.hostname.includes('bolt.new') ||
                            window.location.hostname.includes('stackblitz') ||
                            window.location.hostname.includes('webcontainer');

  if ('serviceWorker' in navigator && import.meta.env.PROD && !isBoltEnvironment) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          updateViaCache: 'none'
        });
        console.log('PWA: Service Worker registered successfully');

        await registration.update();
        console.log('PWA: Forced service worker update check');

        const { pwaUpdateManager } = await import('./services/pwa-update-manager');
        await pwaUpdateManager.initialize(registration);
      } catch (error) {
        console.log('PWA: Service Worker registration failed:', error);
      }
    });
  }

  // Unregister service worker in development or Bolt environments
  if ('serviceWorker' in navigator && (!import.meta.env.PROD || isBoltEnvironment)) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.unregister();
        console.log('PWA: Service Worker unregistered for development/Bolt');
      });
    });
  }
}

// Defer non-critical initialization
if (typeof window !== 'undefined') {
  // Clean up stale cache asynchronously
  setTimeout(() => {
    const version = localStorage.getItem('app-config-version');
    if (version !== '3.1') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (
          key.includes('chart-') ||
          key.includes('candle-') ||
          key.includes('indicators-') ||
          key.includes('historical-')
        )) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      localStorage.setItem('app-config-version', '3.1');
    }
  }, 2000);

  // Start position monitoring only when needed
  setTimeout(async () => {
    try {
      const [{ positionMonitorService }, { tradeLifecycleManager }] = await Promise.all([
        import('@/services/position-monitor'),
        import('@/services/trade-lifecycle-manager')
      ]);
      positionMonitorService.start();
      tradeLifecycleManager.startMonitoring(5000);
    } catch (error) {
      console.log('[Init] Deferred monitoring services:', error);
    }
  }, 5000);

  // Debug utilities only in dev mode
  if (!import.meta.env.PROD) {
    (window as any).refreshSymbols = async () => {
      const { symbolValidator } = await import('@/services/symbol-validator');
      symbolValidator.clearCache();
      console.log('✅ Symbol refresh complete. Reload the page to apply changes.');
    };
    console.log('💡 Debug utility available: Run refreshSymbols() in console');
  }
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message || event.reason?.toString() || '';

  // Log ALL unhandled rejections for debugging
  console.error('🔴 UNHANDLED PROMISE REJECTION:', {
    reason: event.reason,
    message: reason,
    stack: event.reason?.stack,
    timestamp: new Date().toISOString()
  });

  if (
    reason.includes('ERR_NETWORK_CHANGED') ||
    reason.includes('ERR_CONNECTION_RESET') ||
    reason.includes('mt-provisioning-api') ||
    reason.includes('/api/analytics')
  ) {
    event.preventDefault();
    return;
  }

  if (errorHandler.isWebContainerError(event.reason)) {
    event.preventDefault();
    errorHandler.handleWebContainerTimeout(event.reason);
    return;
  }

  if (errorHandler.isMetaApiError(event.reason)) {
    event.preventDefault();
    errorHandler.handleMetaApiError(event.reason);
    return;
  }

  if (
    event.reason?.message?.includes('Failed to fetch') ||
    event.reason?.message?.includes('WebSocket') ||
    event.reason?.message?.includes('ERR_INTERNET_DISCONNECTED')
  ) {
    event.preventDefault();
    errorHandler.handleNetworkError(event.reason);
  }
});

window.addEventListener('error', (event) => {
  // Log ALL errors for debugging
  console.error('🔴 GLOBAL ERROR:', {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    error: event.error,
    timestamp: new Date().toISOString()
  });

  if (errorHandler.isWebContainerError(event.error)) {
    event.preventDefault();
    errorHandler.handleWebContainerTimeout(event.error);
    return;
  }

  if (event.message?.includes('preload')) {
    event.preventDefault();
    errorHandler.handleResourcePreloadWarning(event.filename || 'unknown resource');
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);