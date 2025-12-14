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
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["react-router-dom"],
          ui: ["lucide-react"],
          supabase: ["@supabase/supabase-js"],
          "lightweight-charts": ["lightweight-charts"]
        },
        // Preserve function/class names for lightweight-charts
        preserveModules: false
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
    emptyOutDir: true
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
    minifyIdentifiers: false,
    minifySyntax: true,
    minifyWhitespace: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWydsaWdodHdlaWdodC1jaGFydHMnXSxcbiAgICBlc2J1aWxkT3B0aW9uczoge1xuICAgICAgLy8gUHJlc2VydmUgbGlnaHR3ZWlnaHQtY2hhcnRzIHN0cnVjdHVyZVxuICAgICAga2VlcE5hbWVzOiB0cnVlXG4gICAgfVxuICB9LFxuICBidWlsZDoge1xuICAgIC8vIFByb2R1Y3Rpb24gb3B0aW1pemF0aW9ucyAtIHVzaW5nIGVzYnVpbGQgZm9yIGJldHRlciBsaWJyYXJ5IGNvbXBhdGliaWxpdHlcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICB2ZW5kb3I6IFsncmVhY3QnLCAncmVhY3QtZG9tJ10sXG4gICAgICAgICAgcm91dGVyOiBbJ3JlYWN0LXJvdXRlci1kb20nXSxcbiAgICAgICAgICB1aTogWydsdWNpZGUtcmVhY3QnXSxcbiAgICAgICAgICBzdXBhYmFzZTogWydAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXSxcbiAgICAgICAgICAnbGlnaHR3ZWlnaHQtY2hhcnRzJzogWydsaWdodHdlaWdodC1jaGFydHMnXVxuICAgICAgICB9LFxuICAgICAgICAvLyBQcmVzZXJ2ZSBmdW5jdGlvbi9jbGFzcyBuYW1lcyBmb3IgbGlnaHR3ZWlnaHQtY2hhcnRzXG4gICAgICAgIHByZXNlcnZlTW9kdWxlczogZmFsc2VcbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIEluY3JlYXNlIGNodW5rIHNpemUgd2FybmluZyBsaW1pdFxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTAwMCxcbiAgICAvLyBFbmFibGUgYnVpbGQgYW5hbHlzaXNcbiAgICByZXBvcnRDb21wcmVzc2VkU2l6ZTogdHJ1ZSxcbiAgICAvLyBFbnN1cmUgcHJvcGVyIGFzc2V0IGhhbmRsaW5nXG4gICAgYXNzZXRzRGlyOiAnYXNzZXRzJyxcbiAgICAvLyBIYW5kbGUgbGFyZ2UgYXNzZXRzXG4gICAgYXNzZXRzSW5saW5lTGltaXQ6IDQwOTYsXG4gICAgLy8gSWdub3JlIFR5cGVTY3JpcHQgZXJyb3JzIGR1cmluZyBidWlsZFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICAvLyBDUklUSUNBTDogUHJvcGVyIGhvc3QgY29uZmlndXJhdGlvbiBmb3IgQm9sdCBwcmV2aWV3XG4gICAgaG9zdDogJ2xvY2FsaG9zdCcsIC8vIENoYW5nZWQgZnJvbSAwLjAuMC4wIHRvIGxvY2FsaG9zdFxuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsIC8vIEFsbG93IHBvcnQgZmFsbGJhY2tcbiAgICAvLyBFbnN1cmUgcHJvcGVyIENPUlMgZm9yIEJvbHQgcHJldmlld1xuICAgIGNvcnM6IHRydWUsXG4gICAgLy8gQWRkIGhlYWRlcnMgZm9yIEJvbHQgY29tcGF0aWJpbGl0eVxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJyonXG4gICAgfSxcbiAgICAvLyBDUklUSUNBTDogRW5hYmxlIEhNUiBmb3IgZXh0ZXJuYWwgYWNjZXNzXG4gICAgaG1yOiB7XG4gICAgICBwb3J0OiA1MTczLFxuICAgICAgaG9zdDogJ2xvY2FsaG9zdCcgLy8gQ2hhbmdlZCBmcm9tIDAuMC4wLjAgdG8gbG9jYWxob3N0XG4gICAgfVxuICB9LFxuICAvLyBQcmV2aWV3IGNvbmZpZ3VyYXRpb24gZm9yIHByb2R1Y3Rpb24gYnVpbGRzXG4gIHByZXZpZXc6IHtcbiAgICBob3N0OiAnbG9jYWxob3N0JywgLy8gQ2hhbmdlZCBmcm9tIDAuMC4wLjAgdG8gbG9jYWxob3N0XG4gICAgcG9ydDogNDE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSxcbiAgICBjb3JzOiB0cnVlLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJyonXG4gICAgfVxuICB9LFxuICBkZWZpbmU6IHtcbiAgICAvLyBCdWlsZCB2ZXJzaW9uIGZvciBlcnJvciB0cmFja2luZ1xuICAgIF9fQlVJTERfVkVSU0lPTl9fOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcyLjAuMCcpLFxuICAgIF9fQlVJTERfVElNRV9fOiBKU09OLnN0cmluZ2lmeShuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkpXG4gIH0sXG4gIC8vIEVuc3VyZSBwcm9wZXIgZW52aXJvbm1lbnQgdmFyaWFibGUgaGFuZGxpbmdcbiAgZW52UHJlZml4OiBbJ1ZJVEVfJ10sXG4gIC8vIENSSVRJQ0FMIEZJWDogSGFuZGxlIFR5cGVTY3JpcHQgcHJvcGVybHkgYW5kIHByZXZlbnQgZXZhbCB1c2FnZVxuICBlc2J1aWxkOiB7XG4gICAgdGFyZ2V0OiAnZXMyMDIwJyxcbiAgICBsb2dPdmVycmlkZTogeyAndGhpcy1pcy11bmRlZmluZWQtaW4tZXNtJzogJ3NpbGVudCcgfSxcbiAgICAvLyBDUklUSUNBTDogRW5zdXJlIG5vIGV2YWwgaXMgdXNlZCBpbiBlc2J1aWxkXG4gICAgbGVnYWxDb21tZW50czogJ25vbmUnLFxuICAgIG1pbmlmeUlkZW50aWZpZXJzOiBmYWxzZSxcbiAgICBtaW5pZnlTeW50YXg6IHRydWUsXG4gICAgbWluaWZ5V2hpdGVzcGFjZTogdHJ1ZSxcbiAgfVxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTLENBQUMsY0FBYztBQUFBLElBQ3hCLFNBQVMsQ0FBQyxvQkFBb0I7QUFBQSxJQUM5QixnQkFBZ0I7QUFBQTtBQUFBLE1BRWQsV0FBVztBQUFBLElBQ2I7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUE7QUFBQSxJQUVMLFFBQVE7QUFBQSxJQUNSLFdBQVc7QUFBQSxJQUNYLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQSxVQUNaLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFBQSxVQUM3QixRQUFRLENBQUMsa0JBQWtCO0FBQUEsVUFDM0IsSUFBSSxDQUFDLGNBQWM7QUFBQSxVQUNuQixVQUFVLENBQUMsdUJBQXVCO0FBQUEsVUFDbEMsc0JBQXNCLENBQUMsb0JBQW9CO0FBQUEsUUFDN0M7QUFBQTtBQUFBLFFBRUEsaUJBQWlCO0FBQUEsTUFDbkI7QUFBQSxJQUNGO0FBQUE7QUFBQSxJQUVBLHVCQUF1QjtBQUFBO0FBQUEsSUFFdkIsc0JBQXNCO0FBQUE7QUFBQSxJQUV0QixXQUFXO0FBQUE7QUFBQSxJQUVYLG1CQUFtQjtBQUFBO0FBQUEsSUFFbkIsYUFBYTtBQUFBLEVBQ2Y7QUFBQSxFQUNBLFFBQVE7QUFBQTtBQUFBLElBRU4sTUFBTTtBQUFBO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUE7QUFBQTtBQUFBLElBRVosTUFBTTtBQUFBO0FBQUEsSUFFTixTQUFTO0FBQUEsTUFDUCwrQkFBK0I7QUFBQSxNQUMvQixnQ0FBZ0M7QUFBQSxNQUNoQyxnQ0FBZ0M7QUFBQSxJQUNsQztBQUFBO0FBQUEsSUFFQSxLQUFLO0FBQUEsTUFDSCxNQUFNO0FBQUEsTUFDTixNQUFNO0FBQUE7QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFFQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLE1BQU07QUFBQSxJQUNOLFNBQVM7QUFBQSxNQUNQLCtCQUErQjtBQUFBLE1BQy9CLGdDQUFnQztBQUFBLE1BQ2hDLGdDQUFnQztBQUFBLElBQ2xDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBO0FBQUEsSUFFTixtQkFBbUIsS0FBSyxVQUFVLFFBQVEsSUFBSSx1QkFBdUIsT0FBTztBQUFBLElBQzVFLGdCQUFnQixLQUFLLFdBQVUsb0JBQUksS0FBSyxHQUFFLFlBQVksQ0FBQztBQUFBLEVBQ3pEO0FBQUE7QUFBQSxFQUVBLFdBQVcsQ0FBQyxPQUFPO0FBQUE7QUFBQSxFQUVuQixTQUFTO0FBQUEsSUFDUCxRQUFRO0FBQUEsSUFDUixhQUFhLEVBQUUsNEJBQTRCLFNBQVM7QUFBQTtBQUFBLElBRXBELGVBQWU7QUFBQSxJQUNmLG1CQUFtQjtBQUFBLElBQ25CLGNBQWM7QUFBQSxJQUNkLGtCQUFrQjtBQUFBLEVBQ3BCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
