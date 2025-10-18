import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '@/hooks/useAuth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import '@/utils/metaapi-diagnostics';
import App from './App.tsx';
import './index.css';

console.log('Application initializing...');
console.log('Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
console.log('Supabase Key present:', !!import.meta.env.VITE_SUPABASE_ANON_KEY);
console.log('MetaAPI Token present:', !!import.meta.env.VITE_METAAPI_TOKEN);
console.log('MetaAPI Account ID present:', !!import.meta.env.VITE_METAAPI_ACCOUNT_ID);

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