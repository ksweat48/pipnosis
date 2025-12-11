// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";
import path from "path";
var __vite_injected_original_dirname = "/home/project";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  optimizeDeps: {
    exclude: ["lucide-react"],
    include: ["lightweight-charts"]
  },
  build: {
    // Production optimizations
    minify: "terser",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["react-router-dom"],
          ui: ["lucide-react"],
          supabase: ["@supabase/supabase-js"],
          "lightweight-charts": ["lightweight-charts"]
        }
      }
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1e3,
    // Enable build analysis
    reportCompressedSize: true,
    // Ensure proper asset handling
    assetsDir: "assets",
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
        unsafe_undefined: false
      },
      mangle: {
        safari10: true
      },
      // CRITICAL: Ensure no eval is generated
      format: {
        comments: false
      }
    }
  },
  server: {
    // CRITICAL: Proper host configuration for Bolt preview
    host: "localhost",
    // Changed from 0.0.0.0 to localhost
    port: 5173,
    strictPort: false,
    // Allow port fallback
    // Ensure proper CORS for Bolt preview
    cors: true,
    // Add headers for Bolt compatibility
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    },
    // CRITICAL: Enable HMR for external access
    hmr: {
      port: 5173,
      host: "localhost"
      // Changed from 0.0.0.0 to localhost
    }
  },
  // Preview configuration for production builds
  preview: {
    host: "localhost",
    // Changed from 0.0.0.0 to localhost
    port: 4173,
    strictPort: false,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  },
  define: {
    // Build version for error tracking
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || "2.0.0"),
    __BUILD_TIME__: JSON.stringify((/* @__PURE__ */ new Date()).toISOString())
  },
  // Ensure proper environment variable handling
  envPrefix: ["VITE_"],
  // CRITICAL FIX: Handle TypeScript properly and prevent eval usage
  esbuild: {
    target: "es2020",
    logOverride: { "this-is-undefined-in-esm": "silent" },
    // CRITICAL: Ensure no eval is used in esbuild
    legalComments: "none",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWydsaWdodHdlaWdodC1jaGFydHMnXSxcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICAvLyBQcm9kdWN0aW9uIG9wdGltaXphdGlvbnNcbiAgICBtaW5pZnk6ICd0ZXJzZXInLFxuICAgIHNvdXJjZW1hcDogZmFsc2UsXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIG1hbnVhbENodW5rczoge1xuICAgICAgICAgIHZlbmRvcjogWydyZWFjdCcsICdyZWFjdC1kb20nXSxcbiAgICAgICAgICByb3V0ZXI6IFsncmVhY3Qtcm91dGVyLWRvbSddLFxuICAgICAgICAgIHVpOiBbJ2x1Y2lkZS1yZWFjdCddLFxuICAgICAgICAgIHN1cGFiYXNlOiBbJ0BzdXBhYmFzZS9zdXBhYmFzZS1qcyddLFxuICAgICAgICAgICdsaWdodHdlaWdodC1jaGFydHMnOiBbJ2xpZ2h0d2VpZ2h0LWNoYXJ0cyddXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIEluY3JlYXNlIGNodW5rIHNpemUgd2FybmluZyBsaW1pdFxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTAwMCxcbiAgICAvLyBFbmFibGUgYnVpbGQgYW5hbHlzaXNcbiAgICByZXBvcnRDb21wcmVzc2VkU2l6ZTogdHJ1ZSxcbiAgICAvLyBFbnN1cmUgcHJvcGVyIGFzc2V0IGhhbmRsaW5nXG4gICAgYXNzZXRzRGlyOiAnYXNzZXRzJyxcbiAgICAvLyBIYW5kbGUgbGFyZ2UgYXNzZXRzXG4gICAgYXNzZXRzSW5saW5lTGltaXQ6IDQwOTYsXG4gICAgLy8gSWdub3JlIFR5cGVTY3JpcHQgZXJyb3JzIGR1cmluZyBidWlsZFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICAgIC8vIENSSVRJQ0FMIEZJWDogQ1NQLWNvbXBhdGlibGUgdGVyc2VyIG9wdGlvbnMgdG8gcHJldmVudCBldmFsIHVzYWdlXG4gICAgdGVyc2VyT3B0aW9uczoge1xuICAgICAgY29tcHJlc3M6IHtcbiAgICAgICAgZHJvcF9jb25zb2xlOiBmYWxzZSxcbiAgICAgICAgZHJvcF9kZWJ1Z2dlcjogdHJ1ZSxcbiAgICAgICAgLy8gQ1JJVElDQUw6IERpc2FibGUgZXZhbC1iYXNlZCBvcHRpbWl6YXRpb25zXG4gICAgICAgIHVuc2FmZTogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9jb21wczogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9GdW5jdGlvbjogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9tYXRoOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX3N5bWJvbHM6IGZhbHNlLFxuICAgICAgICB1bnNhZmVfbWV0aG9kczogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9wcm90bzogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9yZWdleHA6IGZhbHNlLFxuICAgICAgICB1bnNhZmVfdW5kZWZpbmVkOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgICBtYW5nbGU6IHtcbiAgICAgICAgc2FmYXJpMTA6IHRydWUsXG4gICAgICB9LFxuICAgICAgLy8gQ1JJVElDQUw6IEVuc3VyZSBubyBldmFsIGlzIGdlbmVyYXRlZFxuICAgICAgZm9ybWF0OiB7XG4gICAgICAgIGNvbW1lbnRzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgLy8gQ1JJVElDQUw6IFByb3BlciBob3N0IGNvbmZpZ3VyYXRpb24gZm9yIEJvbHQgcHJldmlld1xuICAgIGhvc3Q6ICdsb2NhbGhvc3QnLCAvLyBDaGFuZ2VkIGZyb20gMC4wLjAuMCB0byBsb2NhbGhvc3RcbiAgICBwb3J0OiA1MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLCAvLyBBbGxvdyBwb3J0IGZhbGxiYWNrXG4gICAgLy8gRW5zdXJlIHByb3BlciBDT1JTIGZvciBCb2x0IHByZXZpZXdcbiAgICBjb3JzOiB0cnVlLFxuICAgIC8vIEFkZCBoZWFkZXJzIGZvciBCb2x0IGNvbXBhdGliaWxpdHlcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICcqJ1xuICAgIH0sXG4gICAgLy8gQ1JJVElDQUw6IEVuYWJsZSBITVIgZm9yIGV4dGVybmFsIGFjY2Vzc1xuICAgIGhtcjoge1xuICAgICAgcG9ydDogNTE3MyxcbiAgICAgIGhvc3Q6ICdsb2NhbGhvc3QnIC8vIENoYW5nZWQgZnJvbSAwLjAuMC4wIHRvIGxvY2FsaG9zdFxuICAgIH1cbiAgfSxcbiAgLy8gUHJldmlldyBjb25maWd1cmF0aW9uIGZvciBwcm9kdWN0aW9uIGJ1aWxkc1xuICBwcmV2aWV3OiB7XG4gICAgaG9zdDogJ2xvY2FsaG9zdCcsIC8vIENoYW5nZWQgZnJvbSAwLjAuMC4wIHRvIGxvY2FsaG9zdFxuICAgIHBvcnQ6IDQxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsXG4gICAgY29yczogdHJ1ZSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICcqJ1xuICAgIH1cbiAgfSxcbiAgZGVmaW5lOiB7XG4gICAgLy8gQnVpbGQgdmVyc2lvbiBmb3IgZXJyb3IgdHJhY2tpbmdcbiAgICBfX0JVSUxEX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkocHJvY2Vzcy5lbnYubnBtX3BhY2thZ2VfdmVyc2lvbiB8fCAnMi4wLjAnKSxcbiAgICBfX0JVSUxEX1RJTUVfXzogSlNPTi5zdHJpbmdpZnkobmV3IERhdGUoKS50b0lTT1N0cmluZygpKVxuICB9LFxuICAvLyBFbnN1cmUgcHJvcGVyIGVudmlyb25tZW50IHZhcmlhYmxlIGhhbmRsaW5nXG4gIGVudlByZWZpeDogWydWSVRFXyddLFxuICAvLyBDUklUSUNBTCBGSVg6IEhhbmRsZSBUeXBlU2NyaXB0IHByb3Blcmx5IGFuZCBwcmV2ZW50IGV2YWwgdXNhZ2VcbiAgZXNidWlsZDoge1xuICAgIHRhcmdldDogJ2VzMjAyMCcsXG4gICAgbG9nT3ZlcnJpZGU6IHsgJ3RoaXMtaXMtdW5kZWZpbmVkLWluLWVzbSc6ICdzaWxlbnQnIH0sXG4gICAgLy8gQ1JJVElDQUw6IEVuc3VyZSBubyBldmFsIGlzIHVzZWQgaW4gZXNidWlsZFxuICAgIGxlZ2FsQ29tbWVudHM6ICdub25lJyxcbiAgICBtaW5pZnlJZGVudGlmaWVyczogdHJ1ZSxcbiAgICBtaW5pZnlTeW50YXg6IHRydWUsXG4gICAgbWluaWZ5V2hpdGVzcGFjZTogdHJ1ZSxcbiAgfVxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTLENBQUMsY0FBYztBQUFBLElBQ3hCLFNBQVMsQ0FBQyxvQkFBb0I7QUFBQSxFQUNoQztBQUFBLEVBQ0EsT0FBTztBQUFBO0FBQUEsSUFFTCxRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsSUFDWCxlQUFlO0FBQUEsTUFDYixRQUFRO0FBQUEsUUFDTixjQUFjO0FBQUEsVUFDWixRQUFRLENBQUMsU0FBUyxXQUFXO0FBQUEsVUFDN0IsUUFBUSxDQUFDLGtCQUFrQjtBQUFBLFVBQzNCLElBQUksQ0FBQyxjQUFjO0FBQUEsVUFDbkIsVUFBVSxDQUFDLHVCQUF1QjtBQUFBLFVBQ2xDLHNCQUFzQixDQUFDLG9CQUFvQjtBQUFBLFFBQzdDO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQTtBQUFBLElBRUEsdUJBQXVCO0FBQUE7QUFBQSxJQUV2QixzQkFBc0I7QUFBQTtBQUFBLElBRXRCLFdBQVc7QUFBQTtBQUFBLElBRVgsbUJBQW1CO0FBQUE7QUFBQSxJQUVuQixhQUFhO0FBQUE7QUFBQSxJQUViLGVBQWU7QUFBQSxNQUNiLFVBQVU7QUFBQSxRQUNSLGNBQWM7QUFBQSxRQUNkLGVBQWU7QUFBQTtBQUFBLFFBRWYsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsaUJBQWlCO0FBQUEsUUFDakIsYUFBYTtBQUFBLFFBQ2IsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsUUFDaEIsY0FBYztBQUFBLFFBQ2QsZUFBZTtBQUFBLFFBQ2Ysa0JBQWtCO0FBQUEsTUFDcEI7QUFBQSxNQUNBLFFBQVE7QUFBQSxRQUNOLFVBQVU7QUFBQSxNQUNaO0FBQUE7QUFBQSxNQUVBLFFBQVE7QUFBQSxRQUNOLFVBQVU7QUFBQSxNQUNaO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQTtBQUFBLElBRU4sTUFBTTtBQUFBO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUE7QUFBQTtBQUFBLElBRVosTUFBTTtBQUFBO0FBQUEsSUFFTixTQUFTO0FBQUEsTUFDUCwrQkFBK0I7QUFBQSxNQUMvQixnQ0FBZ0M7QUFBQSxNQUNoQyxnQ0FBZ0M7QUFBQSxJQUNsQztBQUFBO0FBQUEsSUFFQSxLQUFLO0FBQUEsTUFDSCxNQUFNO0FBQUEsTUFDTixNQUFNO0FBQUE7QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFFQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLE1BQU07QUFBQSxJQUNOLFNBQVM7QUFBQSxNQUNQLCtCQUErQjtBQUFBLE1BQy9CLGdDQUFnQztBQUFBLE1BQ2hDLGdDQUFnQztBQUFBLElBQ2xDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBO0FBQUEsSUFFTixtQkFBbUIsS0FBSyxVQUFVLFFBQVEsSUFBSSx1QkFBdUIsT0FBTztBQUFBLElBQzVFLGdCQUFnQixLQUFLLFdBQVUsb0JBQUksS0FBSyxHQUFFLFlBQVksQ0FBQztBQUFBLEVBQ3pEO0FBQUE7QUFBQSxFQUVBLFdBQVcsQ0FBQyxPQUFPO0FBQUE7QUFBQSxFQUVuQixTQUFTO0FBQUEsSUFDUCxRQUFRO0FBQUEsSUFDUixhQUFhLEVBQUUsNEJBQTRCLFNBQVM7QUFBQTtBQUFBLElBRXBELGVBQWU7QUFBQSxJQUNmLG1CQUFtQjtBQUFBLElBQ25CLGNBQWM7QUFBQSxJQUNkLGtCQUFrQjtBQUFBLEVBQ3BCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
