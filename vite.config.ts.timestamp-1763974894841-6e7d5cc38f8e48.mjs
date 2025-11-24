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
    include: ["react", "react-dom", "@supabase/supabase-js"],
    entries: ["./src/main.tsx"]
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
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) {
              return "vendor-react";
            }
            if (id.includes("react-router")) {
              return "vendor-router";
            }
            if (id.includes("@supabase")) {
              return "vendor-supabase";
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
            if (id.includes("lightweight-charts")) {
              return "vendor-charts";
            }
            return "vendor-misc";
          }
          if (id.includes("/src/services/")) {
            if (id.includes("polling") || id.includes("candle")) {
              return "services-data";
            }
            if (id.includes("ai-") || id.includes("learning")) {
              return "services-ai";
            }
            if (id.includes("backtest")) {
              return "services-backtest";
            }
            return "services-core";
          }
          if (id.includes("/src/pages/")) {
            if (id.includes("Admin") || id.includes("KPIs") || id.includes("Diagnostics")) {
              return "pages-admin";
            }
            if (id.includes("AITrade") || id.includes("AITraining")) {
              return "pages-ai";
            }
            return "pages-main";
          }
          if (id.includes("/src/components/")) {
            if (id.includes("Chart") || id.includes("Market")) {
              return "components-charts";
            }
            return "components-ui";
          }
        },
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    },
    // Increase chunk size warning limit and set target size
    chunkSizeWarningLimit: 500,
    target: "es2020",
    // Enable build analysis
    reportCompressedSize: true,
    // Ensure proper asset handling
    assetsDir: "assets",
    // Handle large assets
    assetsInlineLimit: 4096,
    // Ignore TypeScript errors during build
    emptyOutDir: true,
    // Optimized terser options for production
    // TEMPORARILY DISABLED console log stripping for debugging
    terserOptions: {
      compress: {
        drop_console: false,
        // KEEP console logs for debugging
        drop_debugger: false,
        // KEEP debugger statements
        pure_funcs: [],
        // Don't remove any console methods
        passes: 2,
        unsafe_arrows: true,
        unsafe_methods: true,
        toplevel: true
      },
      mangle: {
        safari10: true,
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
    legalComments: "none",
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    treeShaking: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gICAgaW5jbHVkZTogWydyZWFjdCcsICdyZWFjdC1kb20nLCAnQHN1cGFiYXNlL3N1cGFiYXNlLWpzJ10sXG4gICAgZW50cmllczogWycuL3NyYy9tYWluLnRzeCddLFxuICB9LFxuICBidWlsZDoge1xuICAgIC8vIFByb2R1Y3Rpb24gb3B0aW1pemF0aW9uc1xuICAgIG1pbmlmeTogJ3RlcnNlcicsXG4gICAgc291cmNlbWFwOiBmYWxzZSxcbiAgICBjb21tb25qc09wdGlvbnM6IHtcbiAgICAgIHRyYW5zZm9ybU1peGVkRXNNb2R1bGVzOiB0cnVlLFxuICAgICAgaW5jbHVkZTogWy9ub2RlX21vZHVsZXMvXSxcbiAgICAgIGV4Y2x1ZGU6IFtdLFxuICAgIH0sXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgb3V0cHV0OiB7XG4gICAgICAgIG1hbnVhbENodW5rcyhpZCkge1xuICAgICAgICAgIC8vIENvcmUgdmVuZG9yIGJ1bmRsZVxuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbm9kZV9tb2R1bGVzJykpIHtcbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncmVhY3QnKSB8fCBpZC5pbmNsdWRlcygncmVhY3QtZG9tJykpIHtcbiAgICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItcmVhY3QnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdyZWFjdC1yb3V0ZXInKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1yb3V0ZXInO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdAc3VwYWJhc2UnKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3ZlbmRvci1zdXBhYmFzZSc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ2x1Y2lkZS1yZWFjdCcpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAndmVuZG9yLWljb25zJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnbGlnaHR3ZWlnaHQtY2hhcnRzJykpIHtcbiAgICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItY2hhcnRzJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEFsbCBvdGhlciB2ZW5kb3IgY29kZVxuICAgICAgICAgICAgcmV0dXJuICd2ZW5kb3ItbWlzYyc7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gU3BsaXQgc2VydmljZXMgaW50byBzZXBhcmF0ZSBjaHVua3NcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJy9zcmMvc2VydmljZXMvJykpIHtcbiAgICAgICAgICAgIC8vIEdyb3VwIHJlbGF0ZWQgc2VydmljZXNcbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygncG9sbGluZycpIHx8IGlkLmluY2x1ZGVzKCdjYW5kbGUnKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3NlcnZpY2VzLWRhdGEnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdhaS0nKSB8fCBpZC5pbmNsdWRlcygnbGVhcm5pbmcnKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3NlcnZpY2VzLWFpJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnYmFja3Rlc3QnKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3NlcnZpY2VzLWJhY2t0ZXN0JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiAnc2VydmljZXMtY29yZSc7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gU3BsaXQgcGFnZXNcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJy9zcmMvcGFnZXMvJykpIHtcbiAgICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnQWRtaW4nKSB8fCBpZC5pbmNsdWRlcygnS1BJcycpIHx8IGlkLmluY2x1ZGVzKCdEaWFnbm9zdGljcycpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAncGFnZXMtYWRtaW4nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGlkLmluY2x1ZGVzKCdBSVRyYWRlJykgfHwgaWQuaW5jbHVkZXMoJ0FJVHJhaW5pbmcnKSkge1xuICAgICAgICAgICAgICByZXR1cm4gJ3BhZ2VzLWFpJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiAncGFnZXMtbWFpbic7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgLy8gQ29tcG9uZW50c1xuICAgICAgICAgIGlmIChpZC5pbmNsdWRlcygnL3NyYy9jb21wb25lbnRzLycpKSB7XG4gICAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ0NoYXJ0JykgfHwgaWQuaW5jbHVkZXMoJ01hcmtldCcpKSB7XG4gICAgICAgICAgICAgIHJldHVybiAnY29tcG9uZW50cy1jaGFydHMnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuICdjb21wb25lbnRzLXVpJztcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGVudHJ5RmlsZU5hbWVzOiBgYXNzZXRzL1tuYW1lXS1baGFzaF0uanNgLFxuICAgICAgICBjaHVua0ZpbGVOYW1lczogYGFzc2V0cy9bbmFtZV0tW2hhc2hdLmpzYCxcbiAgICAgICAgYXNzZXRGaWxlTmFtZXM6IGBhc3NldHMvW25hbWVdLVtoYXNoXS5bZXh0XWBcbiAgICAgIH1cbiAgICB9LFxuICAgIC8vIEluY3JlYXNlIGNodW5rIHNpemUgd2FybmluZyBsaW1pdCBhbmQgc2V0IHRhcmdldCBzaXplXG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiA1MDAsXG4gICAgdGFyZ2V0OiAnZXMyMDIwJyxcbiAgICAvLyBFbmFibGUgYnVpbGQgYW5hbHlzaXNcbiAgICByZXBvcnRDb21wcmVzc2VkU2l6ZTogdHJ1ZSxcbiAgICAvLyBFbnN1cmUgcHJvcGVyIGFzc2V0IGhhbmRsaW5nXG4gICAgYXNzZXRzRGlyOiAnYXNzZXRzJyxcbiAgICAvLyBIYW5kbGUgbGFyZ2UgYXNzZXRzXG4gICAgYXNzZXRzSW5saW5lTGltaXQ6IDQwOTYsXG4gICAgLy8gSWdub3JlIFR5cGVTY3JpcHQgZXJyb3JzIGR1cmluZyBidWlsZFxuICAgIGVtcHR5T3V0RGlyOiB0cnVlLFxuICAgIC8vIE9wdGltaXplZCB0ZXJzZXIgb3B0aW9ucyBmb3IgcHJvZHVjdGlvblxuICAgIC8vIFRFTVBPUkFSSUxZIERJU0FCTEVEIGNvbnNvbGUgbG9nIHN0cmlwcGluZyBmb3IgZGVidWdnaW5nXG4gICAgdGVyc2VyT3B0aW9uczoge1xuICAgICAgY29tcHJlc3M6IHtcbiAgICAgICAgZHJvcF9jb25zb2xlOiBmYWxzZSwgLy8gS0VFUCBjb25zb2xlIGxvZ3MgZm9yIGRlYnVnZ2luZ1xuICAgICAgICBkcm9wX2RlYnVnZ2VyOiBmYWxzZSwgLy8gS0VFUCBkZWJ1Z2dlciBzdGF0ZW1lbnRzXG4gICAgICAgIHB1cmVfZnVuY3M6IFtdLCAvLyBEb24ndCByZW1vdmUgYW55IGNvbnNvbGUgbWV0aG9kc1xuICAgICAgICBwYXNzZXM6IDIsXG4gICAgICAgIHVuc2FmZV9hcnJvd3M6IHRydWUsXG4gICAgICAgIHVuc2FmZV9tZXRob2RzOiB0cnVlLFxuICAgICAgICB0b3BsZXZlbDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgICBtYW5nbGU6IHtcbiAgICAgICAgc2FmYXJpMTA6IHRydWUsXG4gICAgICAgIHByb3BlcnRpZXM6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIGZvcm1hdDoge1xuICAgICAgICBjb21tZW50czogZmFsc2UsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IHRydWUsXG4gICAgcG9ydDogNTE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSxcbiAgICBjb3JzOiB0cnVlLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJyonLFxuICAgICAgJ0NvbnRlbnQtU2VjdXJpdHktUG9saWN5JzogXCJkZWZhdWx0LXNyYyAnc2VsZic7IHNjcmlwdC1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyAndW5zYWZlLWV2YWwnOyBzdHlsZS1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyBodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tOyBmb250LXNyYyAnc2VsZicgZGF0YTogaHR0cHM6Ly9mb250cy5nc3RhdGljLmNvbTsgaW1nLXNyYyAnc2VsZicgZGF0YTogaHR0cHM6IGJsb2I6OyBjb25uZWN0LXNyYyAnc2VsZicgaHR0cDovL2xvY2FsaG9zdDoqIHdzOi8vbG9jYWxob3N0Oiogd3NzOi8vbG9jYWxob3N0OiogaHR0cHM6Ly8qLnN1cGFiYXNlLmNvIHdzczovLyouc3VwYWJhc2UuY28gaHR0cHM6Ly8qLm1ldGFhcGkuY2xvdWQgd3NzOi8vKi5tZXRhYXBpLmNsb3VkIGh0dHBzOi8vKi5hZ2lsaXVtdHJhZGUuYWkgd3NzOi8vKi5hZ2lsaXVtdHJhZGUuYWkgaHR0cHM6Ly9hcGkub3BlbmFpLmNvbTsgd29ya2VyLXNyYyAnc2VsZicgYmxvYjo7IGNoaWxkLXNyYyAnc2VsZicgYmxvYjo7XCJcbiAgICB9LFxuICAgIGhtcjoge1xuICAgICAgb3ZlcmxheTogdHJ1ZSxcbiAgICAgIGNsaWVudFBvcnQ6IDUxNzNcbiAgICB9LFxuICAgIHdhdGNoOiB7XG4gICAgICB1c2VQb2xsaW5nOiBmYWxzZSxcbiAgICAgIGludGVydmFsOiAxMDBcbiAgICB9LFxuICAgIHByb3h5OiB7XG4gICAgICAnL21ldGFhcGknOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHBzOi8vbXQtY2xpZW50LWFwaS12MS5uZXcteW9yay5hZ2lsaXVtdHJhZGUuYWknLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC9tZXRhYXBpLywgJycpLFxuICAgICAgICB3czogdHJ1ZSxcbiAgICAgICAgc2VjdXJlOiB0cnVlXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAvLyBQcmV2aWV3IGNvbmZpZ3VyYXRpb24gZm9yIHByb2R1Y3Rpb24gYnVpbGRzXG4gIHByZXZpZXc6IHtcbiAgICBob3N0OiAnbG9jYWxob3N0JyxcbiAgICBwb3J0OiA0MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLFxuICAgIGNvcnM6IHRydWUsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnKidcbiAgICB9XG4gIH0sXG4gIGRlZmluZToge1xuICAgIC8vIEJ1aWxkIHZlcnNpb24gZm9yIGVycm9yIHRyYWNraW5nXG4gICAgX19CVUlMRF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzIuMC4wJyksXG4gICAgX19CVUlMRF9USU1FX186IEpTT04uc3RyaW5naWZ5KG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSlcbiAgfSxcbiAgLy8gRW5zdXJlIHByb3BlciBlbnZpcm9ubWVudCB2YXJpYWJsZSBoYW5kbGluZ1xuICBlbnZQcmVmaXg6IFsnVklURV8nXSxcbiAgLy8gQ1JJVElDQUwgRklYOiBIYW5kbGUgVHlwZVNjcmlwdCBwcm9wZXJseSBhbmQgcHJldmVudCBldmFsIHVzYWdlXG4gIGVzYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICAgIGxvZ092ZXJyaWRlOiB7ICd0aGlzLWlzLXVuZGVmaW5lZC1pbi1lc20nOiAnc2lsZW50JyB9LFxuICAgIGxlZ2FsQ29tbWVudHM6ICdub25lJyxcbiAgICBtaW5pZnlJZGVudGlmaWVyczogdHJ1ZSxcbiAgICBtaW5pZnlTeW50YXg6IHRydWUsXG4gICAgbWluaWZ5V2hpdGVzcGFjZTogdHJ1ZSxcbiAgICB0cmVlU2hha2luZzogdHJ1ZSxcbiAgfVxufSk7Il0sCiAgIm1hcHBpbmdzIjogIjtBQUF5TixTQUFTLG9CQUFvQjtBQUN0UCxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMs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
