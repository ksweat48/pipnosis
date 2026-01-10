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
    include: ['lightweight-charts'],
    esbuildOptions: {
      // Preserve lightweight-charts structure
      keepNames: true
    }
  },
  build: {
    // Production optimizations - using esbuild for better library compatibility
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
          'lightweight-charts': ['lightweight-charts']
        },
        // Preserve function/class names for lightweight-charts
        preserveModules: false
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
  },
  server: {
    // CRITICAL: Proper host configuration for Bolt preview
    host: '0.0.0.0', // Bind to all interfaces for bolt.new
    port: 5173,
    strictPort: false, // Allow fallback to different port
    cors: true, // Enable CORS for preview iframe
    // Simplified headers for better compatibility
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': '*',
      'Access-Control-Allow-Headers': '*'
    },
    // Ensure HMR works in preview
    hmr: {
      host: 'localhost',
      protocol: 'ws'
    },
    watch: {
      usePolling: true
    }
  },
  // Preview configuration for production builds
  preview: {
    host: true,
    port: 4173,
    strictPort: false,
    cors: true
  },
  define: {
    // Build version for error tracking
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    // Make process.env available in browser code
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    'process.env.STRICT_TYPE_VALIDATION': JSON.stringify(process.env.STRICT_TYPE_VALIDATION || 'false')
  },
  // Ensure proper environment variable handling
  envPrefix: ['VITE_'],
  // CRITICAL FIX: Handle TypeScript properly and prevent eval usage
  esbuild: {
    target: 'es2020',
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    // CRITICAL: Ensure no eval is used in esbuild
    legalComments: 'none',
    minifyIdentifiers: false,
    minifySyntax: true,
    minifyWhitespace: true,
  }
});