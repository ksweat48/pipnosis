// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.js";
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
    include: ["lightweight-charts"],
    esbuildOptions: {
      // Preserve lightweight-charts structure
      keepNames: true
    }
  },
  build: {
    // Production optimizations - using esbuild for better library compatibility
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "vendor";
          }
          if (id.includes("node_modules/react-router-dom") || id.includes("node_modules/@remix-run")) {
            return "router";
          }
          if (id.includes("node_modules/lucide-react")) {
            return "ui";
          }
          if (id.includes("node_modules/@supabase")) {
            return "supabase";
          }
          if (id.includes("node_modules/lightweight-charts")) {
            return "lightweight-charts";
          }
          if (id.includes("node_modules/html2canvas")) {
            return "html2canvas";
          }
          if (id.includes("node_modules/openai")) {
            return "openai";
          }
          if (id.includes("node_modules/metaapi") || id.includes("node_modules/socket.io")) {
            return "metaapi";
          }
          if (id.includes("node_modules/stripe")) {
            return "stripe";
          }
        },
        // Preserve function/class names for lightweight-charts
        preserveModules: false
      }
    },
    chunkSizeWarningLimit: 1e3,
    // Enable build analysis
    reportCompressedSize: true,
    // Ensure proper asset handling
    assetsDir: "assets",
    // Handle large assets
    assetsInlineLimit: 4096,
    // Ignore TypeScript errors during build
    emptyOutDir: true
  },
  server: {
    // CRITICAL: Proper host configuration for Bolt preview
    host: "0.0.0.0",
    // Bind to all interfaces for bolt.new
    port: 5173,
    strictPort: false,
    // Allow fallback to different port
    cors: true,
    // Enable CORS for preview iframe
    // Simplified headers for better compatibility
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
      "Access-Control-Allow-Headers": "*"
    },
    // Ensure HMR works in preview
    hmr: {
      host: "localhost",
      protocol: "ws"
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
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || "2.0.0"),
    __BUILD_TIME__: JSON.stringify((/* @__PURE__ */ new Date()).toISOString()),
    __BUILD_HASH__: JSON.stringify(Date.now().toString(36)),
    // Unique hash for each build
    // Make process.env available in browser code
    "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV || "development"),
    "process.env.STRICT_TYPE_VALIDATION": JSON.stringify(process.env.STRICT_TYPE_VALIDATION || "false")
  },
  // Ensure proper environment variable handling
  envPrefix: ["VITE_"],
  // CRITICAL FIX: Handle TypeScript properly and prevent eval usage
  esbuild: {
    target: "es2020",
    logOverride: { "this-is-undefined-in-esm": "silent" },
    // CRITICAL: Ensure no eval is used in esbuild
    legalComments: "none",
    minifyIdentifiers: false,
    minifySyntax: true,
    minifyWhitespace: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWydsaWdodHdlaWdodC1jaGFydHMnXSxcbiAgICBlc2J1aWxkT3B0aW9uczoge1xuICAgICAgLy8gUHJlc2VydmUgbGlnaHR3ZWlnaHQtY2hhcnRzIHN0cnVjdHVyZVxuICAgICAga2VlcE5hbWVzOiB0cnVlXG4gICAgfVxuICB9LFxuICBidWlsZDoge1xuICAgIC8vIFByb2R1Y3Rpb24gb3B0aW1pemF0aW9ucyAtIHVzaW5nIGVzYnVpbGQgZm9yIGJldHRlciBsaWJyYXJ5IGNvbXBhdGliaWxpdHlcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcbiAgICAgICAgICAvLyBcdTI1MDBcdTI1MDAgVmVuZG9yIHNwbGl0czogc2VsZi1jb250YWluZWQgbm9kZV9tb2R1bGVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL3JlYWN0JykgfHwgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9yZWFjdC1kb20nKSkge1xuICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3InO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9yZWFjdC1yb3V0ZXItZG9tJykgfHwgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9AcmVtaXgtcnVuJykpIHtcbiAgICAgICAgICAgIHJldHVybiAncm91dGVyJztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvbHVjaWRlLXJlYWN0JykpIHtcbiAgICAgICAgICAgIHJldHVybiAndWknO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9Ac3VwYWJhc2UnKSkge1xuICAgICAgICAgICAgcmV0dXJuICdzdXBhYmFzZSc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL2xpZ2h0d2VpZ2h0LWNoYXJ0cycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2xpZ2h0d2VpZ2h0LWNoYXJ0cyc7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL2h0bWwyY2FudmFzJykpIHtcbiAgICAgICAgICAgIHJldHVybiAnaHRtbDJjYW52YXMnO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9vcGVuYWknKSkge1xuICAgICAgICAgICAgcmV0dXJuICdvcGVuYWknO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9tZXRhYXBpJykgfHwgaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9zb2NrZXQuaW8nKSkge1xuICAgICAgICAgICAgcmV0dXJuICdtZXRhYXBpJztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvc3RyaXBlJykpIHtcbiAgICAgICAgICAgIHJldHVybiAnc3RyaXBlJztcbiAgICAgICAgICB9XG5cbiAgICAgICAgfSxcbiAgICAgICAgLy8gUHJlc2VydmUgZnVuY3Rpb24vY2xhc3MgbmFtZXMgZm9yIGxpZ2h0d2VpZ2h0LWNoYXJ0c1xuICAgICAgICBwcmVzZXJ2ZU1vZHVsZXM6IGZhbHNlXG4gICAgICB9XG4gICAgfSxcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgLy8gRW5hYmxlIGJ1aWxkIGFuYWx5c2lzXG4gICAgcmVwb3J0Q29tcHJlc3NlZFNpemU6IHRydWUsXG4gICAgLy8gRW5zdXJlIHByb3BlciBhc3NldCBoYW5kbGluZ1xuICAgIGFzc2V0c0RpcjogJ2Fzc2V0cycsXG4gICAgLy8gSGFuZGxlIGxhcmdlIGFzc2V0c1xuICAgIGFzc2V0c0lubGluZUxpbWl0OiA0MDk2LFxuICAgIC8vIElnbm9yZSBUeXBlU2NyaXB0IGVycm9ycyBkdXJpbmcgYnVpbGRcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgLy8gQ1JJVElDQUw6IFByb3BlciBob3N0IGNvbmZpZ3VyYXRpb24gZm9yIEJvbHQgcHJldmlld1xuICAgIGhvc3Q6ICcwLjAuMC4wJywgLy8gQmluZCB0byBhbGwgaW50ZXJmYWNlcyBmb3IgYm9sdC5uZXdcbiAgICBwb3J0OiA1MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLCAvLyBBbGxvdyBmYWxsYmFjayB0byBkaWZmZXJlbnQgcG9ydFxuICAgIGNvcnM6IHRydWUsIC8vIEVuYWJsZSBDT1JTIGZvciBwcmV2aWV3IGlmcmFtZVxuICAgIC8vIFNpbXBsaWZpZWQgaGVhZGVycyBmb3IgYmV0dGVyIGNvbXBhdGliaWxpdHlcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICcqJ1xuICAgIH0sXG4gICAgLy8gRW5zdXJlIEhNUiB3b3JrcyBpbiBwcmV2aWV3XG4gICAgaG1yOiB7XG4gICAgICBob3N0OiAnbG9jYWxob3N0JyxcbiAgICAgIHByb3RvY29sOiAnd3MnXG4gICAgfSxcbiAgICB3YXRjaDoge1xuICAgICAgdXNlUG9sbGluZzogdHJ1ZVxuICAgIH1cbiAgfSxcbiAgLy8gUHJldmlldyBjb25maWd1cmF0aW9uIGZvciBwcm9kdWN0aW9uIGJ1aWxkc1xuICBwcmV2aWV3OiB7XG4gICAgaG9zdDogdHJ1ZSxcbiAgICBwb3J0OiA0MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLFxuICAgIGNvcnM6IHRydWVcbiAgfSxcbiAgZGVmaW5lOiB7XG4gICAgLy8gQnVpbGQgdmVyc2lvbiBmb3IgZXJyb3IgdHJhY2tpbmdcbiAgICBfX0JVSUxEX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkocHJvY2Vzcy5lbnYubnBtX3BhY2thZ2VfdmVyc2lvbiB8fCAnMi4wLjAnKSxcbiAgICBfX0JVSUxEX1RJTUVfXzogSlNPTi5zdHJpbmdpZnkobmV3IERhdGUoKS50b0lTT1N0cmluZygpKSxcbiAgICBfX0JVSUxEX0hBU0hfXzogSlNPTi5zdHJpbmdpZnkoRGF0ZS5ub3coKS50b1N0cmluZygzNikpLCAvLyBVbmlxdWUgaGFzaCBmb3IgZWFjaCBidWlsZFxuICAgIC8vIE1ha2UgcHJvY2Vzcy5lbnYgYXZhaWxhYmxlIGluIGJyb3dzZXIgY29kZVxuICAgICdwcm9jZXNzLmVudi5OT0RFX0VOVic6IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52Lk5PREVfRU5WIHx8ICdkZXZlbG9wbWVudCcpLFxuICAgICdwcm9jZXNzLmVudi5TVFJJQ1RfVFlQRV9WQUxJREFUSU9OJzogSlNPTi5zdHJpbmdpZnkocHJvY2Vzcy5lbnYuU1RSSUNUX1RZUEVfVkFMSURBVElPTiB8fCAnZmFsc2UnKVxuICB9LFxuICAvLyBFbnN1cmUgcHJvcGVyIGVudmlyb25tZW50IHZhcmlhYmxlIGhhbmRsaW5nXG4gIGVudlByZWZpeDogWydWSVRFXyddLFxuICAvLyBDUklUSUNBTCBGSVg6IEhhbmRsZSBUeXBlU2NyaXB0IHByb3Blcmx5IGFuZCBwcmV2ZW50IGV2YWwgdXNhZ2VcbiAgZXNidWlsZDoge1xuICAgIHRhcmdldDogJ2VzMjAyMCcsXG4gICAgbG9nT3ZlcnJpZGU6IHsgJ3RoaXMtaXMtdW5kZWZpbmVkLWluLWVzbSc6ICdzaWxlbnQnIH0sXG4gICAgLy8gQ1JJVElDQUw6IEVuc3VyZSBubyBldmFsIGlzIHVzZWQgaW4gZXNidWlsZFxuICAgIGxlZ2FsQ29tbWVudHM6ICdub25lJyxcbiAgICBtaW5pZnlJZGVudGlmaWVyczogZmFsc2UsXG4gICAgbWluaWZ5U3ludGF4OiB0cnVlLFxuICAgIG1pbmlmeVdoaXRlc3BhY2U6IHRydWUsXG4gIH1cbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBeU4sU0FBUyxvQkFBb0I7QUFDdFAsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUZqQixJQUFNLG1DQUFtQztBQUt6QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMs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
