import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { errorHandler } from '@/lib/error-handler';
import App from './App.tsx';
import './index.css';

// Application startup (debug info available via logger if needed)

// Initialize logging and utilities only in development
if (!import.meta.env.PROD) {
  // Load logger and utilities only in dev mode
  import('@/lib/logger').then(({ logger, LogLevel }) => {
    logger.setGlobalLevel(LogLevel.INFO);
  });

  // Load debug utilities only in dev
  import('./utils/scanner-test');
  import('@/lib/log-presets').then(({ logPresets }) => {
    console.log('\n%c💡 Logging System Available', 'color: #4CAF50; font-weight: bold; font-size: 14px');
    console.log('%cType logPresets.help() for quick log configuration', 'color: #2196F3; font-size: 12px');
    console.log('%cType logger.showHelp() for advanced configuration\n', 'color: #2196F3; font-size: 12px');
  });
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

  // Initialize automated refresh service lazily
  setTimeout(async () => {
    const { initializeAutomatedRefresh } = await import('@/services/automated-refresh-service');
    initializeAutomatedRefresh();
  }, 3000);

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
      const { cleanupStaleSymbolConfigurations } = await import('@/services/automated-refresh-service');
      symbolValidator.clearCache();
      await cleanupStaleSymbolConfigurations();
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