import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { errorHandler } from '@/lib/error-handler';
import { initializeAutomatedRefresh, automatedRefreshService } from '@/services/automated-refresh-service';
import { positionMonitorService } from '@/services/position-monitor';
import { tradeLifecycleManager } from '@/services/trade-lifecycle-manager';
import { logger, LogLevel } from '@/lib/logger';
import { logPresets } from '@/lib/log-presets';
import App from './App.tsx';
import './index.css';
import './utils/scanner-test';

// Initialize logger with appropriate level for environment
if (import.meta.env.PROD) {
  logger.setGlobalLevel(LogLevel.WARN);
} else {
  logger.setGlobalLevel(LogLevel.INFO);
}

// Show logging help on startup
console.log('\n%c💡 Logging System Available', 'color: #4CAF50; font-weight: bold; font-size: 14px');
console.log('%cType logPresets.help() for quick log configuration', 'color: #2196F3; font-size: 12px');
console.log('%cType logger.showHelp() for advanced configuration\n', 'color: #2196F3; font-size: 12px');

const cleanupStaleLocalStorage = () => {
  const version = localStorage.getItem('app-config-version');
  if (version !== '3.0') {
    console.log('[Startup] Cleaning up stale localStorage configurations...');
    localStorage.removeItem('auto-refresh-config');

    // Clear all chart-related cache data
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

    keysToRemove.forEach(key => {
      console.log(`[Startup] Clearing cached data: ${key}`);
      localStorage.removeItem(key);
    });

    localStorage.setItem('app-config-version', '3.0');
    console.log('[Startup] All cached candle data cleared - starting fresh');
  }
};

cleanupStaleLocalStorage();
initializeAutomatedRefresh();

if (typeof window !== 'undefined') {
  (window as any).refreshSymbols = async () => {
    const { symbolValidator } = await import('@/services/symbol-validator');
    const { cleanupStaleSymbolConfigurations } = await import('@/services/automated-refresh-service');
    console.log('🔄 Refreshing symbol availability...');
    symbolValidator.clearCache();
    await cleanupStaleSymbolConfigurations();
    console.log('✅ Symbol refresh complete. Reload the page to apply changes.');
  };
  console.log('💡 Debug utility available: Run refreshSymbols() in console to update symbol list');
}

console.log('[AI Trading] Starting position monitoring services...');
positionMonitorService.start();
tradeLifecycleManager.startMonitoring(5000);
console.log('[AI Trading] Monitoring services started successfully');

console.log('Application initializing...');
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('Supabase Key present:', !!import.meta.env.VITE_SUPABASE_ANON_KEY);

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason?.message || event.reason?.toString() || '';

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