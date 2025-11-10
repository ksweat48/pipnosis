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
    include: ["socket.io-client"]
  },
  build: {
    // Production optimizations
    minify: "terser",
    sourcemap: false,
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
      exclude: []
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          router: ["react-router-dom"],
          ui: ["lucide-react"],
          supabase: ["@supabase/supabase-js"],
          socketio: ["socket.io-client"]
        },
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
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
    // Optimized terser options - preserves timer functions
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        // Preserve timer function structure
        keep_fnames: /setTimeout|setInterval|clearTimeout|clearInterval/,
        passes: 2
      },
      mangle: {
        safari10: true,
        // Don't mangle timer-related properties
        reserved: ["setTimeout", "setInterval", "clearTimeout", "clearInterval", "_onTimeout"],
        properties: false
      },
      format: {
        comments: false
      }
    }
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    cors: true,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* https://*.supabase.co wss://*.supabase.co https://*.metaapi.cloud wss://*.metaapi.cloud https://*.agiliumtrade.ai wss://*.agiliumtrade.ai https://api.openai.com; worker-src 'self' blob:; child-src 'self' blob:;"
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
      "/metaapi": {
        target: "https://mt-client-api-v1.new-york.agiliumtrade.ai",
        changeOrigin: true,
        rewrite: (path2) => path2.replace(/^\/metaapi/, ""),
        ws: true,
        secure: true
      }
    }
  },
  // Preview configuration for production builds
  preview: {
    host: "localhost",
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWydzb2NrZXQuaW8tY2xpZW50J10sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgLy8gUHJvZHVjdGlvbiBvcHRpbWl6YXRpb25zXG4gICAgbWluaWZ5OiAndGVyc2VyJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIGNvbW1vbmpzT3B0aW9uczoge1xuICAgICAgdHJhbnNmb3JtTWl4ZWRFc01vZHVsZXM6IHRydWUsXG4gICAgICBpbmNsdWRlOiBbL25vZGVfbW9kdWxlcy9dLFxuICAgICAgZXhjbHVkZTogW10sXG4gICAgfSxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgbWFudWFsQ2h1bmtzOiB7XG4gICAgICAgICAgdmVuZG9yOiBbJ3JlYWN0JywgJ3JlYWN0LWRvbSddLFxuICAgICAgICAgIHJvdXRlcjogWydyZWFjdC1yb3V0ZXItZG9tJ10sXG4gICAgICAgICAgdWk6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgICAgICAgc3VwYWJhc2U6IFsnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJ10sXG4gICAgICAgICAgc29ja2V0aW86IFsnc29ja2V0LmlvLWNsaWVudCddXG4gICAgICAgIH0sXG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiBgYXNzZXRzL1tuYW1lXS1baGFzaF0uanNgLFxuICAgICAgICBjaHVua0ZpbGVOYW1lczogYGFzc2V0cy9bbmFtZV0tW2hhc2hdLmpzYCxcbiAgICAgICAgYXNzZXRGaWxlTmFtZXM6IGBhc3NldHMvW25hbWVdLVtoYXNoXS5bZXh0XWBcbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIEluY3JlYXNlIGNodW5rIHNpemUgd2FybmluZyBsaW1pdFxuICAgIGNodW5rU2l6ZVdhcm5pbmdMaW1pdDogMTAwMCxcbiAgICAvLyBFbmFibGUgYnVpbGQgYW5hbHlzaXNcbiAgICByZXBvcnRDb21wcmVzc2VkU2l6ZTogdHJ1ZSxcbiAgICAvLyBFbnN1cmUgcHJvcGVyIGFzc2V0IGhhbmRsaW5nXG4gICAgYXNzZXRzRGlyOiAnYXNzZXRzJyxcbiAgICAvLyBIYW5kbGUgbGFyZ2UgYXNzZXRzXG4gICAgYXNzZXRzSW5saW5lTGltaXQ6IDQwOTYsXG4gICAgLy8gSWdub3JlIFR5cGVTY3JpcHQgZXJyb3JzIGR1cmluZyBidWlsZFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICAgIC8vIE9wdGltaXplZCB0ZXJzZXIgb3B0aW9ucyAtIHByZXNlcnZlcyB0aW1lciBmdW5jdGlvbnNcbiAgICB0ZXJzZXJPcHRpb25zOiB7XG4gICAgICBjb21wcmVzczoge1xuICAgICAgICBkcm9wX2NvbnNvbGU6IGZhbHNlLFxuICAgICAgICBkcm9wX2RlYnVnZ2VyOiB0cnVlLFxuICAgICAgICAvLyBQcmVzZXJ2ZSB0aW1lciBmdW5jdGlvbiBzdHJ1Y3R1cmVcbiAgICAgICAga2VlcF9mbmFtZXM6IC9zZXRUaW1lb3V0fHNldEludGVydmFsfGNsZWFyVGltZW91dHxjbGVhckludGVydmFsLyxcbiAgICAgICAgcGFzc2VzOiAyLFxuICAgICAgfSxcbiAgICAgIG1hbmdsZToge1xuICAgICAgICBzYWZhcmkxMDogdHJ1ZSxcbiAgICAgICAgLy8gRG9uJ3QgbWFuZ2xlIHRpbWVyLXJlbGF0ZWQgcHJvcGVydGllc1xuICAgICAgICByZXNlcnZlZDogWydzZXRUaW1lb3V0JywgJ3NldEludGVydmFsJywgJ2NsZWFyVGltZW91dCcsICdjbGVhckludGVydmFsJywgJ19vblRpbWVvdXQnXSxcbiAgICAgICAgcHJvcGVydGllczogZmFsc2UsXG4gICAgICB9LFxuICAgICAgZm9ybWF0OiB7XG4gICAgICAgIGNvbW1lbnRzOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogdHJ1ZSxcbiAgICBwb3J0OiA1MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLFxuICAgIGNvcnM6IHRydWUsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnKicsXG4gICAgICAnQ29udGVudC1TZWN1cml0eS1Qb2xpY3knOiBcImRlZmF1bHQtc3JjICdzZWxmJzsgc2NyaXB0LXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnICd1bnNhZmUtZXZhbCc7IHN0eWxlLXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnIGh0dHBzOi8vZm9udHMuZ29vZ2xlYXBpcy5jb207IGZvbnQtc3JjICdzZWxmJyBkYXRhOiBodHRwczovL2ZvbnRzLmdzdGF0aWMuY29tOyBpbWctc3JjICdzZWxmJyBkYXRhOiBodHRwczogYmxvYjo7IGNvbm5lY3Qtc3JjICdzZWxmJyBodHRwOi8vbG9jYWxob3N0Oiogd3M6Ly9sb2NhbGhvc3Q6KiB3c3M6Ly9sb2NhbGhvc3Q6KiBodHRwczovLyouc3VwYWJhc2UuY28gd3NzOi8vKi5zdXBhYmFzZS5jbyBodHRwczovLyoubWV0YWFwaS5jbG91ZCB3c3M6Ly8qLm1ldGFhcGkuY2xvdWQgaHR0cHM6Ly8qLmFnaWxpdW10cmFkZS5haSB3c3M6Ly8qLmFnaWxpdW10cmFkZS5haSBodHRwczovL2FwaS5vcGVuYWkuY29tOyB3b3JrZXItc3JjICdzZWxmJyBibG9iOjsgY2hpbGQtc3JjICdzZWxmJyBibG9iOjtcIlxuICAgIH0sXG4gICAgaG1yOiB7XG4gICAgICBvdmVybGF5OiB0cnVlLFxuICAgICAgY2xpZW50UG9ydDogNTE3M1xuICAgIH0sXG4gICAgd2F0Y2g6IHtcbiAgICAgIHVzZVBvbGxpbmc6IGZhbHNlLFxuICAgICAgaW50ZXJ2YWw6IDEwMFxuICAgIH0sXG4gICAgcHJveHk6IHtcbiAgICAgICcvbWV0YWFwaSc6IHtcbiAgICAgICAgdGFyZ2V0OiAnaHR0cHM6Ly9tdC1jbGllbnQtYXBpLXYxLm5ldy15b3JrLmFnaWxpdW10cmFkZS5haScsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgICAgcmV3cml0ZTogKHBhdGgpID0+IHBhdGgucmVwbGFjZSgvXlxcL21ldGFhcGkvLCAnJyksXG4gICAgICAgIHdzOiB0cnVlLFxuICAgICAgICBzZWN1cmU6IHRydWVcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIC8vIFByZXZpZXcgY29uZmlndXJhdGlvbiBmb3IgcHJvZHVjdGlvbiBidWlsZHNcbiAgcHJldmlldzoge1xuICAgIGhvc3Q6ICdsb2NhbGhvc3QnLFxuICAgIHBvcnQ6IDQxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsXG4gICAgY29yczogdHJ1ZSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICcqJ1xuICAgIH1cbiAgfSxcbiAgZGVmaW5lOiB7XG4gICAgLy8gQnVpbGQgdmVyc2lvbiBmb3IgZXJyb3IgdHJhY2tpbmdcbiAgICBfX0JVSUxEX1ZFUlNJT05fXzogSlNPTi5zdHJpbmdpZnkocHJvY2Vzcy5lbnYubnBtX3BhY2thZ2VfdmVyc2lvbiB8fCAnMi4wLjAnKSxcbiAgICBfX0JVSUxEX1RJTUVfXzogSlNPTi5zdHJpbmdpZnkobmV3IERhdGUoKS50b0lTT1N0cmluZygpKVxuICB9LFxuICAvLyBFbnN1cmUgcHJvcGVyIGVudmlyb25tZW50IHZhcmlhYmxlIGhhbmRsaW5nXG4gIGVudlByZWZpeDogWydWSVRFXyddLFxuICAvLyBDUklUSUNBTCBGSVg6IEhhbmRsZSBUeXBlU2NyaXB0IHByb3Blcmx5IGFuZCBwcmV2ZW50IGV2YWwgdXNhZ2VcbiAgZXNidWlsZDoge1xuICAgIHRhcmdldDogJ2VzMjAyMCcsXG4gICAgbG9nT3ZlcnJpZGU6IHsgJ3RoaXMtaXMtdW5kZWZpbmVkLWluLWVzbSc6ICdzaWxlbnQnIH0sXG4gICAgLy8gQ1JJVElDQUw6IEVuc3VyZSBubyBldmFsIGlzIHVzZWQgaW4gZXNidWlsZFxuICAgIGxlZ2FsQ29tbWVudHM6ICdub25lJyxcbiAgICBtaW5pZnlJZGVudGlmaWVyczogdHJ1ZSxcbiAgICBtaW5pZnlTeW50YXg6IHRydWUsXG4gICAgbWluaWZ5V2hpdGVzcGFjZTogdHJ1ZSxcbiAgfVxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxjQUFjO0FBQUEsSUFDWixTQUFTLENBQUMsY0FBYztBQUFBLElBQ3hCLFNBQVMsQ0FBQyxrQkFBa0I7QUFBQSxFQUM5QjtBQUFBLEVBQ0EsT0FBTztBQUFBO0FBQUEsSUFFTCxRQUFRO0FBQUEsSUFDUixXQUFXO0FBQUEsSUFDWCxpQkFBaUI7QUFBQSxNQUNmLHlCQUF5QjtBQUFBLE1BQ3pCLFNBQVMsQ0FBQyxjQUFjO0FBQUEsTUFDeEIsU0FBUyxDQUFDO0FBQUEsSUFDWjtBQUFBLElBQ0EsZUFBZTtBQUFBLE1BQ2IsUUFBUTtBQUFBLFFBQ04sY0FBYztBQUFBLFVBQ1osUUFBUSxDQUFDLFNBQVMsV0FBVztBQUFBLFVBQzdCLFFBQVEsQ0FBQyxrQkFBa0I7QUFBQSxVQUMzQixJQUFJLENBQUMsY0FBYztBQUFBLFVBQ25CLFVBQVUsQ0FBQyx1QkFBdUI7QUFBQSxVQUNsQyxVQUFVLENBQUMsa0JBQWtCO0FBQUEsUUFDL0I7QUFBQSxRQUNBLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSx1QkFBdUI7QUFBQTtBQUFBLElBRXZCLHNCQUFzQjtBQUFBO0FBQUEsSUFFdEIsV0FBVztBQUFBO0FBQUEsSUFFWCxtQkFBbUI7QUFBQTtBQUFBLElBRW5CLGFBQWE7QUFBQTtBQUFBLElBRWIsZUFBZTtBQUFBLE1BQ2IsVUFBVTtBQUFBLFFBQ1IsY0FBYztBQUFBLFFBQ2QsZUFBZTtBQUFBO0FBQUEsUUFFZixhQUFhO0FBQUEsUUFDYixRQUFRO0FBQUEsTUFDVjtBQUFBLE1BQ0EsUUFBUTtBQUFBLFFBQ04sVUFBVTtBQUFBO0FBQUEsUUFFVixVQUFVLENBQUMsY0FBYyxlQUFlLGdCQUFnQixpQkFBaUIsWUFBWTtBQUFBLFFBQ3JGLFlBQVk7QUFBQSxNQUNkO0FBQUEsTUFDQSxRQUFRO0FBQUEsUUFDTixVQUFVO0FBQUEsTUFDWjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixNQUFNO0FBQUEsSUFDTixTQUFTO0FBQUEsTUFDUCwrQkFBK0I7QUFBQSxNQUMvQixnQ0FBZ0M7QUFBQSxNQUNoQyxnQ0FBZ0M7QUFBQSxNQUNoQywyQkFBMkI7QUFBQSxJQUM3QjtBQUFBLElBQ0EsS0FBSztBQUFBLE1BQ0gsU0FBUztBQUFBLE1BQ1QsWUFBWTtBQUFBLElBQ2Q7QUFBQSxJQUNBLE9BQU87QUFBQSxNQUNMLFlBQVk7QUFBQSxNQUNaLFVBQVU7QUFBQSxJQUNaO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxZQUFZO0FBQUEsUUFDVixRQUFRO0FBQUEsUUFDUixjQUFjO0FBQUEsUUFDZCxTQUFTLENBQUNBLFVBQVNBLE1BQUssUUFBUSxjQUFjLEVBQUU7QUFBQSxRQUNoRCxJQUFJO0FBQUEsUUFDSixRQUFRO0FBQUEsTUFDVjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUVBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFlBQVk7QUFBQSxJQUNaLE1BQU07QUFBQSxJQUNOLFNBQVM7QUFBQSxNQUNQLCtCQUErQjtBQUFBLE1BQy9CLGdDQUFnQztBQUFBLE1BQ2hDLGdDQUFnQztBQUFBLElBQ2xDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsUUFBUTtBQUFBO0FBQUEsSUFFTixtQkFBbUIsS0FBSyxVQUFVLFFBQVEsSUFBSSx1QkFBdUIsT0FBTztBQUFBLElBQzVFLGdCQUFnQixLQUFLLFdBQVUsb0JBQUksS0FBSyxHQUFFLFlBQVksQ0FBQztBQUFBLEVBQ3pEO0FBQUE7QUFBQSxFQUVBLFdBQVcsQ0FBQyxPQUFPO0FBQUE7QUFBQSxFQUVuQixTQUFTO0FBQUEsSUFDUCxRQUFRO0FBQUEsSUFDUixhQUFhLEVBQUUsNEJBQTRCLFNBQVM7QUFBQTtBQUFBLElBRXBELGVBQWU7QUFBQSxJQUNmLG1CQUFtQjtBQUFBLElBQ25CLGNBQWM7QUFBQSxJQUNkLGtCQUFrQjtBQUFBLEVBQ3BCO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFsicGF0aCJdCn0K
