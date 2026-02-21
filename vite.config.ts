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
          // Shared lib singletons — MUST resolve before all app chunks to prevent TDZ
          if (
            id.includes('/src/lib/logger') ||
            id.includes('/src/lib/supabase') ||
            id.includes('/src/lib/pipnosis-core-rules') ||
            id.includes('/src/lib/environment') ||
            id.includes('/src/lib/error-handler')
          ) {
            return 'shared-lib';
          }

          // Third-party vendor splits
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

          // AI brain / Omega council — heaviest chunk drivers
          if (
            id.includes('/src/brains/') ||
            id.includes('/src/services/alpha-omega-orchestrator') ||
            id.includes('/src/services/coordinator-alpha') ||
            id.includes('/src/services/event-based-llm-engine') ||
            id.includes('/src/services/llm-strategy-brain') ||
            id.includes('/src/services/llm-execution-brain') ||
            id.includes('/src/services/llm-mid-trade-evaluator') ||
            id.includes('/src/services/llm-snapshot-builder') ||
            id.includes('/src/services/llm-reasoning-logger') ||
            id.includes('/src/services/llm-post-session-analyzer') ||
            id.includes('/src/services/openai-client') ||
            id.includes('/src/services/openai-proxy-client')
          ) {
            return 'ai-brains';
          }

          // Trade execution core
          if (
            id.includes('/src/services/alpha-trade-executor') ||
            id.includes('/src/services/alpha-execution-planner') ||
            id.includes('/src/services/alpha-execution-analyzer') ||
            id.includes('/src/services/trade-lifecycle-manager') ||
            id.includes('/src/services/trade-validation-service') ||
            id.includes('/src/services/trade-feasibility-resolver') ||
            id.includes('/src/services/trade-closure-event-processor') ||
            id.includes('/src/services/trade-context-retriever') ||
            id.includes('/src/services/ccip-trade-execution-tracker') ||
            id.includes('/src/services/pcpe-execution-governor') ||
            id.includes('/src/services/safety-enforcer') ||
            id.includes('/src/services/mandatory-safety-validator') ||
            id.includes('/src/services/core-validation-gate')
          ) {
            return 'trade-execution';
          }

          // Risk and sizing
          if (
            id.includes('/src/services/professional-risk-manager') ||
            id.includes('/src/services/adaptive-risk-manager') ||
            id.includes('/src/services/unified-risk-authority') ||
            id.includes('/src/services/goal-aware-lot-sizing-coordinator') ||
            id.includes('/src/services/kelly-criterion-sizer') ||
            id.includes('/src/services/ev-calculator') ||
            id.includes('/src/services/ev-gating-system') ||
            id.includes('/src/services/risk-preflight-gate') ||
            id.includes('/src/services/risk-negotiation-auditor') ||
            id.includes('/src/services/correlation-risk-manager') ||
            id.includes('/src/services/volatility-adjusted-risk') ||
            id.includes('/src/services/progressive-risk-scaling')
          ) {
            return 'risk-engine';
          }

          // Goal session management
          if (
            id.includes('/src/services/goal-session-live-engine') ||
            id.includes('/src/services/goal-session-core-engine') ||
            id.includes('/src/services/goal-session-manager') ||
            id.includes('/src/services/smart-goal-session-manager') ||
            id.includes('/src/services/goal-scanner') ||
            id.includes('/src/services/goal-feasibility-resolver') ||
            id.includes('/src/services/goal-advisory-coordinator') ||
            id.includes('/src/services/goal-intelligence-classifier') ||
            id.includes('/src/services/session-constraint-coordinator') ||
            id.includes('/src/services/scanning-state-machine') ||
            id.includes('/src/services/multi-symbol-scanner') ||
            id.includes('/src/services/multi-symbol-ranker') ||
            id.includes('/src/services/multi-symbol-snapshot-builder') ||
            id.includes('/src/services/best-symbol-selector')
          ) {
            return 'goal-session';
          }

          // Market data and candles
          if (
            id.includes('/src/services/candle-') ||
            id.includes('/src/services/market-data-service') ||
            id.includes('/src/services/market-briefing-builder') ||
            id.includes('/src/services/market-condition-risk-adjuster') ||
            id.includes('/src/services/market-snapshot-cache') ||
            id.includes('/src/services/chart-') ||
            id.includes('/src/services/price-') ||
            id.includes('/src/services/tick-buffer-service') ||
            id.includes('/src/services/background-candle-aggregator') ||
            id.includes('/src/services/current-candle-reconstructor') ||
            id.includes('/src/services/wick-reconstruction-service')
          ) {
            return 'market-data';
          }

          // Pattern and regime intelligence
          if (
            id.includes('/src/services/pattern-') ||
            id.includes('/src/services/regime-') ||
            id.includes('/src/services/micro-regime-classifier') ||
            id.includes('/src/services/multi-timeframe-pattern-intelligence') ||
            id.includes('/src/services/sentiment-') ||
            id.includes('/src/services/omega-sensors') ||
            id.includes('/src/services/omega-weight-resolver') ||
            id.includes('/src/services/omega-consensus-advisory') ||
            id.includes('/src/services/adaptive-entry-zone-calculator') ||
            id.includes('/src/services/zone-')
          ) {
            return 'intelligence';
          }

          // Alpha learning and analytics
          if (
            id.includes('/src/services/alpha-learning') ||
            id.includes('/src/services/alpha-meta-learning') ||
            id.includes('/src/services/alpha-revision-handler') ||
            id.includes('/src/services/alpha-thesis-parser') ||
            id.includes('/src/services/alpha-thought-stream') ||
            id.includes('/src/services/continuous-learning-loop') ||
            id.includes('/src/services/counterfactual-') ||
            id.includes('/src/services/post-trade-analyzer') ||
            id.includes('/src/services/performance-analyzer') ||
            id.includes('/src/services/strategy-') ||
            id.includes('/src/services/ai-learning-engine') ||
            id.includes('/src/services/ai-skill-tracker') ||
            id.includes('/src/services/session-learning-generator') ||
            id.includes('/src/services/alpha-intelligence-aggregator')
          ) {
            return 'learning-analytics';
          }
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