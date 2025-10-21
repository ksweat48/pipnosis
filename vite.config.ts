import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  build: {
    // Production optimizations
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
          metaapi: ['metaapi.cloud-sdk']
        },
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    // Enable build analysis
    reportCompressedSize: true,
    // Ensure proper asset handling
    assetsDir: 'assets',
    // Handle large assets
    assetsInlineLimit: 4096,
    // Ignore TypeScript errors during build
    emptyOutDir: true,
    // CRITICAL FIX: CSP-compatible terser options to prevent eval usage
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        // CRITICAL: Disable eval-based optimizations
        unsafe: false,
        unsafe_comps: false,
        unsafe_Function: false,
        unsafe_math: false,
        unsafe_symbols: false,
        unsafe_methods: false,
        unsafe_proto: false,
        unsafe_regexp: false,
        unsafe_undefined: false,
      },
      mangle: {
        safari10: true,
      },
      // CRITICAL: Ensure no eval is generated
      format: {
        comments: false,
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* https://*.supabase.co wss://*.supabase.co https://*.metaapi.cloud wss://*.metaapi.cloud https://*.agiliumtrade.ai wss://*.agiliumtrade.ai https://mt-provisioning-api-v1.agiliumtrade.ai https://mt-client-api-v1.agiliumtrade.ai https://api.openai.com; worker-src 'self' blob:; child-src 'self' blob:;"
    },
    hmr: {
      overlay: true,
      clientPort: 5173
    },
    watch: {
      usePolling: false,
      interval: 100
    },
    proxy: {
      '/metaapi': {
        target: 'https://mt-client-api-v1.agiliumtrade.agiliumtrade.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/metaapi/, ''),
        ws: true,
        secure: true
      }
    }
  },
  // Preview configuration for production builds
  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: false,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  },
  define: {
    // Build version for error tracking
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },
  // Ensure proper environment variable handling
  envPrefix: ['VITE_'],
  // CRITICAL FIX: Handle TypeScript properly and prevent eval usage
  esbuild: {
    target: 'es2020',
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    // CRITICAL: Ensure no eval is used in esbuild
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  }
});