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
    include: ['react', 'react-dom', '@supabase/supabase-js'],
    entries: ['./src/main.tsx'],
  },
  build: {
    // Production optimizations
    minify: 'terser',
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
      exclude: [],
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Core vendor bundle
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('react-router')) {
              return 'vendor-router';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('lightweight-charts')) {
              return 'vendor-charts';
            }
            // All other vendor code
            return 'vendor-misc';
          }

          // Split services into separate chunks
          if (id.includes('/src/services/')) {
            // Group related services
            if (id.includes('polling') || id.includes('candle')) {
              return 'services-data';
            }
            if (id.includes('ai-') || id.includes('learning')) {
              return 'services-ai';
            }
            if (id.includes('backtest')) {
              return 'services-backtest';
            }
            return 'services-core';
          }

          // Split pages
          if (id.includes('/src/pages/')) {
            if (id.includes('Admin') || id.includes('KPIs') || id.includes('Diagnostics')) {
              return 'pages-admin';
            }
            if (id.includes('AITrade') || id.includes('AITraining')) {
              return 'pages-ai';
            }
            return 'pages-main';
          }

          // Components
          if (id.includes('/src/components/')) {
            if (id.includes('Chart') || id.includes('Market')) {
              return 'components-charts';
            }
            return 'components-ui';
          }
        },
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    },
    // Increase chunk size warning limit and set target size
    chunkSizeWarningLimit: 500,
    target: 'es2020',
    // Enable build analysis
    reportCompressedSize: true,
    // Ensure proper asset handling
    assetsDir: 'assets',
    // Handle large assets
    assetsInlineLimit: 4096,
    // Ignore TypeScript errors during build
    emptyOutDir: true,
    // Optimized terser options for production
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        passes: 3,
        unsafe_arrows: true,
        unsafe_methods: true,
        toplevel: true,
      },
      mangle: {
        safari10: true,
        properties: false,
      },
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
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* https://*.supabase.co wss://*.supabase.co https://*.metaapi.cloud wss://*.metaapi.cloud https://*.agiliumtrade.ai wss://*.agiliumtrade.ai https://api.openai.com; worker-src 'self' blob:; child-src 'self' blob:;"
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
        target: 'https://mt-client-api-v1.new-york.agiliumtrade.ai',
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
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    treeShaking: true,
  }
});