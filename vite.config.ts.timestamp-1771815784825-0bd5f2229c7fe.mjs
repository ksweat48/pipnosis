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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWydsaWdodHdlaWdodC1jaGFydHMnXSxcbiAgICBlc2J1aWxkT3B0aW9uczoge1xuICAgICAgLy8gUHJlc2VydmUgbGlnaHR3ZWlnaHQtY2hhcnRzIHN0cnVjdHVyZVxuICAgICAga2VlcE5hbWVzOiB0cnVlXG4gICAgfVxuICB9LFxuICBidWlsZDoge1xuICAgIC8vIFByb2R1Y3Rpb24gb3B0aW1pemF0aW9ucyAtIHVzaW5nIGVzYnVpbGQgZm9yIGJldHRlciBsaWJyYXJ5IGNvbXBhdGliaWxpdHlcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcbiAgICAgICAgICAvLyBWZW5kb3Itb25seSBzcGxpdHMgXHUyMDE0IHNlbGYtY29udGFpbmVkIGxpYnJhcmllcyB3aXRoIG5vIGFwcC1jb2RlIGltcG9ydHNcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9yZWFjdCcpIHx8IGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvcmVhY3QtZG9tJykpIHtcbiAgICAgICAgICAgIHJldHVybiAndmVuZG9yJztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvcmVhY3Qtcm91dGVyLWRvbScpIHx8IGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvQHJlbWl4LXJ1bicpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3JvdXRlcic7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzL2x1Y2lkZS1yZWFjdCcpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3VpJztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdub2RlX21vZHVsZXMvQHN1cGFiYXNlJykpIHtcbiAgICAgICAgICAgIHJldHVybiAnc3VwYWJhc2UnO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9saWdodHdlaWdodC1jaGFydHMnKSkge1xuICAgICAgICAgICAgcmV0dXJuICdsaWdodHdlaWdodC1jaGFydHMnO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcy9odG1sMmNhbnZhcycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ2h0bWwyY2FudmFzJztcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIC8vIFByZXNlcnZlIGZ1bmN0aW9uL2NsYXNzIG5hbWVzIGZvciBsaWdodHdlaWdodC1jaGFydHNcbiAgICAgICAgcHJlc2VydmVNb2R1bGVzOiBmYWxzZVxuICAgICAgfVxuICAgIH0sXG4gICAgLy8gSW5jcmVhc2UgY2h1bmsgc2l6ZSB3YXJuaW5nIGxpbWl0XG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwLFxuICAgIC8vIEVuYWJsZSBidWlsZCBhbmFseXNpc1xuICAgIHJlcG9ydENvbXByZXNzZWRTaXplOiB0cnVlLFxuICAgIC8vIEVuc3VyZSBwcm9wZXIgYXNzZXQgaGFuZGxpbmdcbiAgICBhc3NldHNEaXI6ICdhc3NldHMnLFxuICAgIC8vIEhhbmRsZSBsYXJnZSBhc3NldHNcbiAgICBhc3NldHNJbmxpbmVMaW1pdDogNDA5NixcbiAgICAvLyBJZ25vcmUgVHlwZVNjcmlwdCBlcnJvcnMgZHVyaW5nIGJ1aWxkXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIC8vIENSSVRJQ0FMOiBQcm9wZXIgaG9zdCBjb25maWd1cmF0aW9uIGZvciBCb2x0IHByZXZpZXdcbiAgICBob3N0OiAnMC4wLjAuMCcsIC8vIEJpbmQgdG8gYWxsIGludGVyZmFjZXMgZm9yIGJvbHQubmV3XG4gICAgcG9ydDogNTE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSwgLy8gQWxsb3cgZmFsbGJhY2sgdG8gZGlmZmVyZW50IHBvcnRcbiAgICBjb3JzOiB0cnVlLCAvLyBFbmFibGUgQ09SUyBmb3IgcHJldmlldyBpZnJhbWVcbiAgICAvLyBTaW1wbGlmaWVkIGhlYWRlcnMgZm9yIGJldHRlciBjb21wYXRpYmlsaXR5XG4gICAgaGVhZGVyczoge1xuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnKidcbiAgICB9LFxuICAgIC8vIEVuc3VyZSBITVIgd29ya3MgaW4gcHJldmlld1xuICAgIGhtcjoge1xuICAgICAgaG9zdDogJ2xvY2FsaG9zdCcsXG4gICAgICBwcm90b2NvbDogJ3dzJ1xuICAgIH0sXG4gICAgd2F0Y2g6IHtcbiAgICAgIHVzZVBvbGxpbmc6IHRydWVcbiAgICB9XG4gIH0sXG4gIC8vIFByZXZpZXcgY29uZmlndXJhdGlvbiBmb3IgcHJvZHVjdGlvbiBidWlsZHNcbiAgcHJldmlldzoge1xuICAgIGhvc3Q6IHRydWUsXG4gICAgcG9ydDogNDE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSxcbiAgICBjb3JzOiB0cnVlXG4gIH0sXG4gIGRlZmluZToge1xuICAgIC8vIEJ1aWxkIHZlcnNpb24gZm9yIGVycm9yIHRyYWNraW5nXG4gICAgX19CVUlMRF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzIuMC4wJyksXG4gICAgX19CVUlMRF9USU1FX186IEpTT04uc3RyaW5naWZ5KG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSksXG4gICAgX19CVUlMRF9IQVNIX186IEpTT04uc3RyaW5naWZ5KERhdGUubm93KCkudG9TdHJpbmcoMzYpKSwgLy8gVW5pcXVlIGhhc2ggZm9yIGVhY2ggYnVpbGRcbiAgICAvLyBNYWtlIHByb2Nlc3MuZW52IGF2YWlsYWJsZSBpbiBicm93c2VyIGNvZGVcbiAgICAncHJvY2Vzcy5lbnYuTk9ERV9FTlYnOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5OT0RFX0VOViB8fCAnZGV2ZWxvcG1lbnQnKSxcbiAgICAncHJvY2Vzcy5lbnYuU1RSSUNUX1RZUEVfVkFMSURBVElPTic6IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52LlNUUklDVF9UWVBFX1ZBTElEQVRJT04gfHwgJ2ZhbHNlJylcbiAgfSxcbiAgLy8gRW5zdXJlIHByb3BlciBlbnZpcm9ubWVudCB2YXJpYWJsZSBoYW5kbGluZ1xuICBlbnZQcmVmaXg6IFsnVklURV8nXSxcbiAgLy8gQ1JJVElDQUwgRklYOiBIYW5kbGUgVHlwZVNjcmlwdCBwcm9wZXJseSBhbmQgcHJldmVudCBldmFsIHVzYWdlXG4gIGVzYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICAgIGxvZ092ZXJyaWRlOiB7ICd0aGlzLWlzLXVuZGVmaW5lZC1pbi1lc20nOiAnc2lsZW50JyB9LFxuICAgIC8vIENSSVRJQ0FMOiBFbnN1cmUgbm8gZXZhbCBpcyB1c2VkIGluIGVzYnVpbGRcbiAgICBsZWdhbENvbW1lbnRzOiAnbm9uZScsXG4gICAgbWluaWZ5SWRlbnRpZmllcnM6IGZhbHNlLFxuICAgIG1pbmlmeVN5bnRheDogdHJ1ZSxcbiAgICBtaW5pZnlXaGl0ZXNwYWNlOiB0cnVlLFxuICB9XG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQXlOLFNBQVMsb0JBQW9CO0FBQ3RQLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFGakIsSUFBTSxtQ0FBbUM7QUFLekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFBQSxFQUNBLGNBQWM7QUFBQSxJQUNaLFNBQVMsQ0FBQyxjQUFjO0FBQUEsSUFDeEIsU0FBUyxDQUFDLG9CQUFvQjtBQUFBLElBQzlCLGdCQUFnQjtBQUFBO0FBQUEsTUFFZCxXQUFXO0FBQUEsSUFDYjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE9BQU87QUFBQTtBQUFBLElBRUwsUUFBUTtBQUFBLElBQ1IsV0FBVztBQUFBLElBQ1gsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sYUFBYSxJQUFJO0FBRWYsY0FBSSxHQUFHLFNBQVMsb0JBQW9CLEtBQUssR0FBRyxTQUFTLHdCQUF3QixHQUFHO0FBQzlFLG1CQUFPO0FBQUEsVUFDVDtBQUNBLGNBQUksR0FBRyxTQUFTLCtCQUErQixLQUFLLEdBQUcsU0FBUyx5QkFBeUIsR0FBRztBQUMxRixtQkFBTztBQUFBLFVBQ1Q7QUFDQSxjQUFJLEdBQUcsU0FBUywyQkFBMkIsR0FBRztBQUM1QyxtQkFBTztBQUFBLFVBQ1Q7QUFDQSxjQUFJLEdBQUcsU0FBUyx3QkFBd0IsR0FBRztBQUN6QyxtQkFBTztBQUFBLFVBQ1Q7QUFDQSxjQUFJLEdBQUcsU0FBUyxpQ0FBaUMsR0FBRztBQUNsRCxtQkFBTztBQUFBLFVBQ1Q7QUFDQSxjQUFJLEdBQUcsU0FBUywwQkFBMEIsR0FBRztBQUMzQyxtQkFBTztBQUFBLFVBQ1Q7QUFBQSxRQUNGO0FBQUE7QUFBQSxRQUVBLGlCQUFpQjtBQUFBLE1BQ25CO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSx1QkFBdUI7QUFBQTtBQUFBLElBRXZCLHNCQUFzQjtBQUFBO0FBQUEsSUFFdEIsV0FBVztBQUFBO0FBQUEsSUFFWCxtQkFBbUI7QUFBQTtBQUFBLElBRW5CLGFBQWE7QUFBQSxFQUNmO0FBQUEsRUFDQSxRQUFRO0FBQUE7QUFBQSxJQUVOLE1BQU07QUFBQTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBO0FBQUEsSUFDWixNQUFNO0FBQUE7QUFBQTtBQUFBLElBRU4sU0FBUztBQUFBLE1BQ1AsK0JBQStCO0FBQUEsTUFDL0IsZ0NBQWdDO0FBQUEsTUFDaEMsZ0NBQWdDO0FBQUEsSUFDbEM7QUFBQTtBQUFBLElBRUEsS0FBSztBQUFBLE1BQ0gsTUFBTTtBQUFBLE1BQ04sVUFBVTtBQUFBLElBQ1o7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFlBQVk7QUFBQSxJQUNkO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFFQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixNQUFNO0FBQUEsRUFDUjtBQUFBLEVBQ0EsUUFBUTtBQUFBO0FBQUEsSUFFTixtQkFBbUIsS0FBSyxVQUFVLFFBQVEsSUFBSSx1QkFBdUIsT0FBTztBQUFBLElBQzVFLGdCQUFnQixLQUFLLFdBQVUsb0JBQUksS0FBSyxHQUFFLFlBQVksQ0FBQztBQUFBLElBQ3ZELGdCQUFnQixLQUFLLFVBQVUsS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUM7QUFBQTtBQUFBO0FBQUEsSUFFdEQsd0JBQXdCLEtBQUssVUFBVSxRQUFRLElBQUksWUFBWSxhQUFhO0FBQUEsSUFDNUUsc0NBQXNDLEtBQUssVUFBVSxRQUFRLElBQUksMEJBQTBCLE9BQU87QUFBQSxFQUNwRztBQUFBO0FBQUEsRUFFQSxXQUFXLENBQUMsT0FBTztBQUFBO0FBQUEsRUFFbkIsU0FBUztBQUFBLElBQ1AsUUFBUTtBQUFBLElBQ1IsYUFBYSxFQUFFLDRCQUE0QixTQUFTO0FBQUE7QUFBQSxJQUVwRCxlQUFlO0FBQUEsSUFDZixtQkFBbUI7QUFBQSxJQUNuQixjQUFjO0FBQUEsSUFDZCxrQkFBa0I7QUFBQSxFQUNwQjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
