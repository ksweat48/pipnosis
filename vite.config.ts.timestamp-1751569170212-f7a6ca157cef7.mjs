// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.mjs";
var vite_config_default = defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["lucide-react"]
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
          supabase: ["@supabase/supabase-js"]
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
    host: "0.0.0.0",
    // Allow external connections
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
      host: "0.0.0.0"
    }
  },
  // Preview configuration for production builds
  preview: {
    host: "0.0.0.0",
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5cbi8vIGh0dHBzOi8vdml0ZWpzLmRldi9jb25maWcvXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICBwbHVnaW5zOiBbcmVhY3QoKV0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgLy8gUHJvZHVjdGlvbiBvcHRpbWl6YXRpb25zXG4gICAgbWluaWZ5OiAndGVyc2VyJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICB2ZW5kb3I6IFsncmVhY3QnLCAncmVhY3QtZG9tJ10sXG4gICAgICAgICAgcm91dGVyOiBbJ3JlYWN0LXJvdXRlci1kb20nXSxcbiAgICAgICAgICB1aTogWydsdWNpZGUtcmVhY3QnXSxcbiAgICAgICAgICBzdXBhYmFzZTogWydAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcbiAgICAvLyBJbmNyZWFzZSBjaHVuayBzaXplIHdhcm5pbmcgbGltaXRcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgLy8gRW5hYmxlIGJ1aWxkIGFuYWx5c2lzXG4gICAgcmVwb3J0Q29tcHJlc3NlZFNpemU6IHRydWUsXG4gICAgLy8gRW5zdXJlIHByb3BlciBhc3NldCBoYW5kbGluZ1xuICAgIGFzc2V0c0RpcjogJ2Fzc2V0cycsXG4gICAgLy8gSGFuZGxlIGxhcmdlIGFzc2V0c1xuICAgIGFzc2V0c0lubGluZUxpbWl0OiA0MDk2LFxuICAgIC8vIElnbm9yZSBUeXBlU2NyaXB0IGVycm9ycyBkdXJpbmcgYnVpbGRcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICAvLyBDUklUSUNBTCBGSVg6IENTUC1jb21wYXRpYmxlIHRlcnNlciBvcHRpb25zIHRvIHByZXZlbnQgZXZhbCB1c2FnZVxuICAgIHRlcnNlck9wdGlvbnM6IHtcbiAgICAgIGNvbXByZXNzOiB7XG4gICAgICAgIGRyb3BfY29uc29sZTogZmFsc2UsXG4gICAgICAgIGRyb3BfZGVidWdnZXI6IHRydWUsXG4gICAgICAgIC8vIENSSVRJQ0FMOiBEaXNhYmxlIGV2YWwtYmFzZWQgb3B0aW1pemF0aW9uc1xuICAgICAgICB1bnNhZmU6IGZhbHNlLFxuICAgICAgICB1bnNhZmVfY29tcHM6IGZhbHNlLFxuICAgICAgICB1bnNhZmVfRnVuY3Rpb246IGZhbHNlLFxuICAgICAgICB1bnNhZmVfbWF0aDogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9zeW1ib2xzOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX21ldGhvZHM6IGZhbHNlLFxuICAgICAgICB1bnNhZmVfcHJvdG86IGZhbHNlLFxuICAgICAgICB1bnNhZmVfcmVnZXhwOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX3VuZGVmaW5lZDogZmFsc2UsXG4gICAgICB9LFxuICAgICAgbWFuZ2xlOiB7XG4gICAgICAgIHNhZmFyaTEwOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIC8vIENSSVRJQ0FMOiBFbnN1cmUgbm8gZXZhbCBpcyBnZW5lcmF0ZWRcbiAgICAgIGZvcm1hdDoge1xuICAgICAgICBjb21tZW50czogZmFsc2UsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIC8vIENSSVRJQ0FMOiBQcm9wZXIgaG9zdCBjb25maWd1cmF0aW9uIGZvciBCb2x0IHByZXZpZXdcbiAgICBob3N0OiAnMC4wLjAuMCcsIC8vIEFsbG93IGV4dGVybmFsIGNvbm5lY3Rpb25zXG4gICAgcG9ydDogNTE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSwgLy8gQWxsb3cgcG9ydCBmYWxsYmFja1xuICAgIC8vIEVuc3VyZSBwcm9wZXIgQ09SUyBmb3IgQm9sdCBwcmV2aWV3XG4gICAgY29yczogdHJ1ZSxcbiAgICAvLyBBZGQgaGVhZGVycyBmb3IgQm9sdCBjb21wYXRpYmlsaXR5XG4gICAgaGVhZGVyczoge1xuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnKidcbiAgICB9LFxuICAgIC8vIENSSVRJQ0FMOiBFbmFibGUgSE1SIGZvciBleHRlcm5hbCBhY2Nlc3NcbiAgICBobXI6IHtcbiAgICAgIHBvcnQ6IDUxNzMsXG4gICAgICBob3N0OiAnMC4wLjAuMCdcbiAgICB9XG4gIH0sXG4gIC8vIFByZXZpZXcgY29uZmlndXJhdGlvbiBmb3IgcHJvZHVjdGlvbiBidWlsZHNcbiAgcHJldmlldzoge1xuICAgIGhvc3Q6ICcwLjAuMC4wJyxcbiAgICBwb3J0OiA0MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLFxuICAgIGNvcnM6IHRydWUsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnKidcbiAgICB9XG4gIH0sXG4gIGRlZmluZToge1xuICAgIC8vIEJ1aWxkIHZlcnNpb24gZm9yIGVycm9yIHRyYWNraW5nXG4gICAgX19CVUlMRF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzIuMC4wJyksXG4gICAgX19CVUlMRF9USU1FX186IEpTT04uc3RyaW5naWZ5KG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSlcbiAgfSxcbiAgLy8gRW5zdXJlIHByb3BlciBlbnZpcm9ubWVudCB2YXJpYWJsZSBoYW5kbGluZ1xuICBlbnZQcmVmaXg6IFsnVklURV8nXSxcbiAgLy8gQ1JJVElDQUwgRklYOiBIYW5kbGUgVHlwZVNjcmlwdCBwcm9wZXJseSBhbmQgcHJldmVudCBldmFsIHVzYWdlXG4gIGVzYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICAgIGxvZ092ZXJyaWRlOiB7ICd0aGlzLWlzLXVuZGVmaW5lZC1pbi1lc20nOiAnc2lsZW50JyB9LFxuICAgIC8vIENSSVRJQ0FMOiBFbnN1cmUgbm8gZXZhbCBpcyB1c2VkIGluIGVzYnVpbGRcbiAgICBsZWdhbENvbW1lbnRzOiAnbm9uZScsXG4gICAgbWluaWZ5SWRlbnRpZmllcnM6IHRydWUsXG4gICAgbWluaWZ5U3ludGF4OiB0cnVlLFxuICAgIG1pbmlmeVdoaXRlc3BhY2U6IHRydWUsXG4gIH1cbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBeU4sU0FBUyxvQkFBb0I7QUFDdFAsT0FBTyxXQUFXO0FBR2xCLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixjQUFjO0FBQUEsSUFDWixTQUFTLENBQUMsY0FBYztBQUFBLEVBQzFCO0FBQUEsRUFDQSxPQUFPO0FBQUE7QUFBQSxJQUVMLFFBQVE7QUFBQSxJQUNSLFdBQVc7QUFBQSxJQUNYLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQSxRQUNOLGNBQWM7QUFBQSxVQUNaLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFBQSxVQUM3QixRQUFRLENBQUMsa0JBQWtCO0FBQUEsVUFDM0IsSUFBSSxDQUFDLGNBQWM7QUFBQSxVQUNuQixVQUFVLENBQUMsdUJBQXVCO0FBQUEsUUFDcEM7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSx1QkFBdUI7QUFBQTtBQUFBLElBRXZCLHNCQUFzQjtBQUFBO0FBQUEsSUFFdEIsV0FBVztBQUFBO0FBQUEsSUFFWCxtQkFBbUI7QUFBQTtBQUFBLElBRW5CLGFBQWE7QUFBQTtBQUFBLElBRWIsZUFBZTtBQUFBLE1BQ2IsVUFBVTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsZUFBZTtBQUFBO0FBQUEsUUFFZixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxpQkFBaUI7QUFBQSxRQUNqQixhQUFhO0FBQUEsUUFDYixnQkFBZ0I7QUFBQSxRQUNoQixnQkFBZ0I7QUFBQSxRQUNoQixjQUFjO0FBQUEsUUFDZCxlQUFlO0FBQUEsUUFDZixrQkFBa0I7QUFBQSxNQUNwQjtBQUFBLE1BQ0EsUUFBUTtBQUFBLFFBQ04sVUFBVTtBQUFBLE1BQ1o7QUFBQTtBQUFBLE1BRUEsUUFBUTtBQUFBLFFBQ04sVUFBVTtBQUFBLE1BQ1o7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBO0FBQUEsSUFFTixNQUFNO0FBQUE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQTtBQUFBO0FBQUEsSUFFWixNQUFNO0FBQUE7QUFBQSxJQUVOLFNBQVM7QUFBQSxNQUNQLCtCQUErQjtBQUFBLE1BQy9CLGdDQUFnQztBQUFBLE1BQ2hDLGdDQUFnQztBQUFBLElBQ2xDO0FBQUE7QUFBQSxJQUVBLEtBQUs7QUFBQSxNQUNILE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFFQSxTQUFTO0FBQUEsSUFDUCxNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsTUFDUCwrQkFBK0I7QUFBQSxNQUMvQixnQ0FBZ0M7QUFBQSxNQUNoQyxnQ0FBZ0M7QUFBQSxJQUNsQztBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQTtBQUFBLElBRU4sbUJBQW1CLEtBQUssVUFBVSxRQUFRLElBQUksdUJBQXVCLE9BQU87QUFBQSxJQUM1RSxnQkFBZ0IsS0FBSyxXQUFVLG9CQUFJLEtBQUssR0FBRSxZQUFZLENBQUM7QUFBQSxFQUN6RDtBQUFBO0FBQUEsRUFFQSxXQUFXLENBQUMsT0FBTztBQUFBO0FBQUEsRUFFbkIsU0FBUztBQUFBLElBQ1AsUUFBUTtBQUFBLElBQ1IsYUFBYSxFQUFFLDRCQUE0QixTQUFTO0FBQUE7QUFBQSxJQUVwRCxlQUFlO0FBQUEsSUFDZixtQkFBbUI7QUFBQSxJQUNuQixjQUFjO0FBQUEsSUFDZCxrQkFBa0I7QUFBQSxFQUNwQjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
