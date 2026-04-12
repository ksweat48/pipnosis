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
        manualChunks(id) {
          // ── Vendor splits: self-contained node_modules ──────────────────────
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor';
          }
          if (id.includes('node_modules/react-router-dom') || id.includes('node_modules/@remix-run')) {
            return 'router';
          }
          if (id.includes('node_modules/lucide-react')) {
            return 'ui';
          }
          if (id.includes('node_modules/@supabase')) {
            return 'supabase';
          }
          if (id.includes('node_modules/lightweight-charts')) {
            return 'lightweight-charts';
          }
          if (id.includes('node_modules/html2canvas')) {
            return 'html2canvas';
          }
          if (id.includes('node_modules/openai')) {
            return 'openai';
          }
          if (id.includes('node_modules/metaapi') || id.includes('node_modules/socket.io')) {
            return 'metaapi';
          }
          if (id.includes('node_modules/stripe')) {
            return 'stripe';
          }

          // ── App-code splits: group by responsibility domain ─────────────────
          //
          // Note: The trading service graph contains deep circular dependencies
          // (brains ↔ risk ↔ engine ↔ analysis). Rollup emits "Circular chunk"
          // advisories for these but still produces valid, working output — the
          // modules are correctly de-duplicated across the affected chunks.
          // These advisories cannot be eliminated without restructuring the
          // service architecture itself (removing the circular imports at the
          // source level), which is a separate architectural task.

          // AI brains and LLM orchestration
          if (
            id.includes('/src/brains/') ||
            id.includes('/src/services/coordinator-alpha') ||
            id.includes('/src/services/alpha-omega-orchestrator') ||
            id.includes('/src/services/alpha-trade-executor') ||
            id.includes('/src/services/llm-strategy-brain') ||
            id.includes('/src/services/llm-execution-brain') ||
            id.includes('/src/services/llm-mid-trade-evaluator') ||
            id.includes('/src/services/event-based-llm-engine') ||
            id.includes('/src/services/openai-proxy-client') ||
            id.includes('/src/services/openai-client')
          ) {
            return 'ai-engine';
          }

          // Trading engine — goal session, scanning, and execution pipeline
          if (
            id.includes('/src/services/goal-session-live-engine') ||
            id.includes('/src/services/goal-session-manager') ||
            id.includes('/src/services/goal-scanner') ||
            id.includes('/src/services/smart-goal-session-manager') ||
            id.includes('/src/services/scanning-state-machine') ||
            id.includes('/src/services/platform-scan-manager') ||
            id.includes('/src/services/multi-symbol-scanner') ||
            id.includes('/src/services/multi-symbol-ranker') ||
            id.includes('/src/services/trade-lifecycle-manager') ||
            id.includes('/src/services/trade-validation-service') ||
            id.includes('/src/services/trade-feasibility-resolver') ||
            id.includes('/src/services/alpha-execution-planner') ||
            id.includes('/src/services/alpha-execution-analyzer') ||
            id.includes('/src/services/alpha-preview-scanner') ||
            id.includes('/src/services/ev-gating-system') ||
            id.includes('/src/services/ev-calculator')
          ) {
            return 'trading-engine';
          }

          // Risk management services
          if (
            id.includes('/src/services/professional-risk-manager') ||
            id.includes('/src/services/adaptive-risk-manager') ||
            id.includes('/src/services/unified-risk-authority') ||
            id.includes('/src/services/risk-') ||
            id.includes('/src/services/kelly-criterion-sizer') ||
            id.includes('/src/services/goal-aware-lot-sizing') ||
            id.includes('/src/services/correlation-risk-manager') ||
            id.includes('/src/services/volatility-adjusted-risk') ||
            id.includes('/src/services/progressive-risk-scaling') ||
            id.includes('/src/services/mandatory-safety-validator') ||
            id.includes('/src/services/safety-enforcer')
          ) {
            return 'risk-engine';
          }

          // Market data and candle services
          if (
            id.includes('/src/services/candle-') ||
            id.includes('/src/services/market-data-service') ||
            id.includes('/src/services/market-snapshot-cache') ||
            id.includes('/src/services/market-briefing-builder') ||
            id.includes('/src/services/chart-') ||
            id.includes('/src/services/tick-buffer-service') ||
            id.includes('/src/services/pattern-detection-service') ||
            id.includes('/src/lib/technical-math/') ||
            id.includes('/src/strategies/indicators')
          ) {
            return 'market-data';
          }

          // Technical analysis and indicators
          if (
            id.includes('/src/services/omega-sensors') ||
            id.includes('/src/services/regime-') ||
            id.includes('/src/services/micro-regime') ||
            id.includes('/src/services/sentiment-') ||
            id.includes('/src/services/m5-swing-analyzer') ||
            id.includes('/src/services/forecast-engine') ||
            id.includes('/src/services/confidence-calculation-engine') ||
            id.includes('/src/services/pattern-') ||
            id.includes('/src/services/liquidity-intent-analyzer') ||
            id.includes('/src/lib/technicalScanEngine') ||
            id.includes('/src/lib/aiMarketEngine')
          ) {
            return 'analysis-engine';
          }

          // Club and tokenomics services — only loaded on /club/* routes.
          // These services have minimal static overlap with the trading graph.
          if (
            id.includes('/src/services/club-') ||
            id.includes('/src/services/token-lifecycle') ||
            id.includes('/src/services/token-pool') ||
            id.includes('/src/services/reward-engine') ||
            id.includes('/src/services/pip-utility-index-engine') ||
            id.includes('/src/services/cashout-request-service')
          ) {
            return 'club-engine';
          }
        },
        // Preserve function/class names for lightweight-charts
        preserveModules: false
      }
    },
    // Warn at 500 KB (Vite default) — keep pressure on bundle discipline
    chunkSizeWarningLimit: 500,
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
    __BUILD_HASH__: JSON.stringify(Date.now().toString(36)), // Unique hash for each build
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