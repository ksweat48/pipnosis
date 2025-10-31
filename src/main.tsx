import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { errorHandler } from '@/lib/error-handler';
import App from './App.tsx';
import './index.css';
import './utils/scanner-test';

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