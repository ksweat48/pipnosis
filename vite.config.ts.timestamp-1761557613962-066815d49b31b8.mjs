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
          supabase: ["@supabase/supabase-js"],
          metaapi: ["metaapi.cloud-sdk"]
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgLy8gUHJvZHVjdGlvbiBvcHRpbWl6YXRpb25zXG4gICAgbWluaWZ5OiAndGVyc2VyJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICB2ZW5kb3I6IFsncmVhY3QnLCAncmVhY3QtZG9tJ10sXG4gICAgICAgICAgcm91dGVyOiBbJ3JlYWN0LXJvdXRlci1kb20nXSxcbiAgICAgICAgICB1aTogWydsdWNpZGUtcmVhY3QnXSxcbiAgICAgICAgICBzdXBhYmFzZTogWydAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXSxcbiAgICAgICAgICBtZXRhYXBpOiBbJ21ldGFhcGkuY2xvdWQtc2RrJ11cbiAgICAgICAgfSxcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6IGBhc3NldHMvW25hbWVdLVtoYXNoXS5qc2AsXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiBgYXNzZXRzL1tuYW1lXS1baGFzaF0uanNgLFxuICAgICAgICBhc3NldEZpbGVOYW1lczogYGFzc2V0cy9bbmFtZV0tW2hhc2hdLltleHRdYFxuICAgICAgfVxuICAgIH0sXG4gICAgLy8gSW5jcmVhc2UgY2h1bmsgc2l6ZSB3YXJuaW5nIGxpbWl0XG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwLFxuICAgIC8vIEVuYWJsZSBidWlsZCBhbmFseXNpc1xuICAgIHJlcG9ydENvbXByZXNzZWRTaXplOiB0cnVlLFxuICAgIC8vIEVuc3VyZSBwcm9wZXIgYXNzZXQgaGFuZGxpbmdcbiAgICBhc3NldHNEaXI6ICdhc3NldHMnLFxuICAgIC8vIEhhbmRsZSBsYXJnZSBhc3NldHNcbiAgICBhc3NldHNJbmxpbmVMaW1pdDogNDA5NixcbiAgICAvLyBJZ25vcmUgVHlwZVNjcmlwdCBlcnJvcnMgZHVyaW5nIGJ1aWxkXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gICAgLy8gQ1JJVElDQUwgRklYOiBDU1AtY29tcGF0aWJsZSB0ZXJzZXIgb3B0aW9ucyB0byBwcmV2ZW50IGV2YWwgdXNhZ2VcbiAgICB0ZXJzZXJPcHRpb25zOiB7XG4gICAgICBjb21wcmVzczoge1xuICAgICAgICBkcm9wX2NvbnNvbGU6IGZhbHNlLFxuICAgICAgICBkcm9wX2RlYnVnZ2VyOiB0cnVlLFxuICAgICAgICAvLyBDUklUSUNBTDogRGlzYWJsZSBldmFsLWJhc2VkIG9wdGltaXphdGlvbnNcbiAgICAgICAgdW5zYWZlOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX2NvbXBzOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX0Z1bmN0aW9uOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX21hdGg6IGZhbHNlLFxuICAgICAgICB1bnNhZmVfc3ltYm9sczogZmFsc2UsXG4gICAgICAgIHVuc2FmZV9tZXRob2RzOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX3Byb3RvOiBmYWxzZSxcbiAgICAgICAgdW5zYWZlX3JlZ2V4cDogZmFsc2UsXG4gICAgICAgIHVuc2FmZV91bmRlZmluZWQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIG1hbmdsZToge1xuICAgICAgICBzYWZhcmkxMDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICAvLyBDUklUSUNBTDogRW5zdXJlIG5vIGV2YWwgaXMgZ2VuZXJhdGVkXG4gICAgICBmb3JtYXQ6IHtcbiAgICAgICAgY29tbWVudHM6IGZhbHNlLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICBzZXJ2ZXI6IHtcbiAgICBob3N0OiB0cnVlLFxuICAgIHBvcnQ6IDUxNzMsXG4gICAgc3RyaWN0UG9ydDogZmFsc2UsXG4gICAgY29yczogdHJ1ZSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OUycsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6ICcqJyxcbiAgICAgICdDb250ZW50LVNlY3VyaXR5LVBvbGljeSc6IFwiZGVmYXVsdC1zcmMgJ3NlbGYnOyBzY3JpcHQtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgJ3Vuc2FmZS1ldmFsJzsgc3R5bGUtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgaHR0cHM6Ly9mb250cy5nb29nbGVhcGlzLmNvbTsgZm9udC1zcmMgJ3NlbGYnIGRhdGE6IGh0dHBzOi8vZm9udHMuZ3N0YXRpYy5jb207IGltZy1zcmMgJ3NlbGYnIGRhdGE6IGh0dHBzOiBibG9iOjsgY29ubmVjdC1zcmMgJ3NlbGYnIGh0dHA6Ly9sb2NhbGhvc3Q6KiB3czovL2xvY2FsaG9zdDoqIHdzczovL2xvY2FsaG9zdDoqIGh0dHBzOi8vKi5zdXBhYmFzZS5jbyB3c3M6Ly8qLnN1cGFiYXNlLmNvIGh0dHBzOi8vKi5tZXRhYXBpLmNsb3VkIHdzczovLyoubWV0YWFwaS5jbG91ZCBodHRwczovLyouYWdpbGl1bXRyYWRlLmFpIHdzczovLyouYWdpbGl1bXRyYWRlLmFpIGh0dHBzOi8vYXBpLm9wZW5haS5jb207IHdvcmtlci1zcmMgJ3NlbGYnIGJsb2I6OyBjaGlsZC1zcmMgJ3NlbGYnIGJsb2I6O1wiXG4gICAgfSxcbiAgICBobXI6IHtcbiAgICAgIG92ZXJsYXk6IHRydWUsXG4gICAgICBjbGllbnRQb3J0OiA1MTczXG4gICAgfSxcbiAgICB3YXRjaDoge1xuICAgICAgdXNlUG9sbGluZzogZmFsc2UsXG4gICAgICBpbnRlcnZhbDogMTAwXG4gICAgfSxcbiAgICBwcm94eToge1xuICAgICAgJy9tZXRhYXBpJzoge1xuICAgICAgICB0YXJnZXQ6ICdodHRwczovL210LWNsaWVudC1hcGktdjEubmV3LXlvcmsuYWdpbGl1bXRyYWRlLmFpJyxcbiAgICAgICAgY2hhbmdlT3JpZ2luOiB0cnVlLFxuICAgICAgICByZXdyaXRlOiAocGF0aCkgPT4gcGF0aC5yZXBsYWNlKC9eXFwvbWV0YWFwaS8sICcnKSxcbiAgICAgICAgd3M6IHRydWUsXG4gICAgICAgIHNlY3VyZTogdHJ1ZVxuICAgICAgfVxuICAgIH1cbiAgfSxcbiAgLy8gUHJldmlldyBjb25maWd1cmF0aW9uIGZvciBwcm9kdWN0aW9uIGJ1aWxkc1xuICBwcmV2aWV3OiB7XG4gICAgaG9zdDogJ2xvY2FsaG9zdCcsXG4gICAgcG9ydDogNDE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSxcbiAgICBjb3JzOiB0cnVlLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJyonXG4gICAgfVxuICB9LFxuICBkZWZpbmU6IHtcbiAgICAvLyBCdWlsZCB2ZXJzaW9uIGZvciBlcnJvciB0cmFja2luZ1xuICAgIF9fQlVJTERfVkVSU0lPTl9fOiBKU09OLnN0cmluZ2lmeShwcm9jZXNzLmVudi5ucG1fcGFja2FnZV92ZXJzaW9uIHx8ICcyLjAuMCcpLFxuICAgIF9fQlVJTERfVElNRV9fOiBKU09OLnN0cmluZ2lmeShuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkpXG4gIH0sXG4gIC8vIEVuc3VyZSBwcm9wZXIgZW52aXJvbm1lbnQgdmFyaWFibGUgaGFuZGxpbmdcbiAgZW52UHJlZml4OiBbJ1ZJVEVfJ10sXG4gIC8vIENSSVRJQ0FMIEZJWDogSGFuZGxlIFR5cGVTY3JpcHQgcHJvcGVybHkgYW5kIHByZXZlbnQgZXZhbCB1c2FnZVxuICBlc2J1aWxkOiB7XG4gICAgdGFyZ2V0OiAnZXMyMDIwJyxcbiAgICBsb2dPdmVycmlkZTogeyAndGhpcy1pcy11bmRlZmluZWQtaW4tZXNtJzogJ3NpbGVudCcgfSxcbiAgICAvLyBDUklUSUNBTDogRW5zdXJlIG5vIGV2YWwgaXMgdXNlZCBpbiBlc2J1aWxkXG4gICAgbGVnYWxDb21tZW50czogJ25vbmUnLFxuICAgIG1pbmlmeUlkZW50aWZpZXJzOiB0cnVlLFxuICAgIG1pbmlmeVN5bnRheDogdHJ1ZSxcbiAgICBtaW5pZnlXaGl0ZXNwYWNlOiB0cnVlLFxuICB9XG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQXlOLFNBQVMsb0JBQW9CO0FBQ3RQLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFGakIsSUFBTSxtQ0FBbUM7QUFLekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFB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
