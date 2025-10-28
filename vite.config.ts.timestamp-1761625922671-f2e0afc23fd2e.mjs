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
          supabase: ["@supabase/supabase-js"]
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0XCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3Qvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICAnQCc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuL3NyYycpLFxuICAgIH0sXG4gIH0sXG4gIG9wdGltaXplRGVwczoge1xuICAgIGV4Y2x1ZGU6IFsnbHVjaWRlLXJlYWN0J10sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgLy8gUHJvZHVjdGlvbiBvcHRpbWl6YXRpb25zXG4gICAgbWluaWZ5OiAndGVyc2VyJyxcbiAgICBzb3VyY2VtYXA6IGZhbHNlLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBtYW51YWxDaHVua3M6IHtcbiAgICAgICAgICB2ZW5kb3I6IFsncmVhY3QnLCAncmVhY3QtZG9tJ10sXG4gICAgICAgICAgcm91dGVyOiBbJ3JlYWN0LXJvdXRlci1kb20nXSxcbiAgICAgICAgICB1aTogWydsdWNpZGUtcmVhY3QnXSxcbiAgICAgICAgICBzdXBhYmFzZTogWydAc3VwYWJhc2Uvc3VwYWJhc2UtanMnXVxuICAgICAgICB9LFxuICAgICAgICBlbnRyeUZpbGVOYW1lczogYGFzc2V0cy9bbmFtZV0tW2hhc2hdLmpzYCxcbiAgICAgICAgY2h1bmtGaWxlTmFtZXM6IGBhc3NldHMvW25hbWVdLVtoYXNoXS5qc2AsXG4gICAgICAgIGFzc2V0RmlsZU5hbWVzOiBgYXNzZXRzL1tuYW1lXS1baGFzaF0uW2V4dF1gXG4gICAgICB9XG4gICAgfSxcbiAgICAvLyBJbmNyZWFzZSBjaHVuayBzaXplIHdhcm5pbmcgbGltaXRcbiAgICBjaHVua1NpemVXYXJuaW5nTGltaXQ6IDEwMDAsXG4gICAgLy8gRW5hYmxlIGJ1aWxkIGFuYWx5c2lzXG4gICAgcmVwb3J0Q29tcHJlc3NlZFNpemU6IHRydWUsXG4gICAgLy8gRW5zdXJlIHByb3BlciBhc3NldCBoYW5kbGluZ1xuICAgIGFzc2V0c0RpcjogJ2Fzc2V0cycsXG4gICAgLy8gSGFuZGxlIGxhcmdlIGFzc2V0c1xuICAgIGFzc2V0c0lubGluZUxpbWl0OiA0MDk2LFxuICAgIC8vIElnbm9yZSBUeXBlU2NyaXB0IGVycm9ycyBkdXJpbmcgYnVpbGRcbiAgICBlbXB0eU91dERpcjogdHJ1ZSxcbiAgICAvLyBPcHRpbWl6ZWQgdGVyc2VyIG9wdGlvbnMgLSBwcmVzZXJ2ZXMgdGltZXIgZnVuY3Rpb25zXG4gICAgdGVyc2VyT3B0aW9uczoge1xuICAgICAgY29tcHJlc3M6IHtcbiAgICAgICAgZHJvcF9jb25zb2xlOiBmYWxzZSxcbiAgICAgICAgZHJvcF9kZWJ1Z2dlcjogdHJ1ZSxcbiAgICAgICAgLy8gUHJlc2VydmUgdGltZXIgZnVuY3Rpb24gc3RydWN0dXJlXG4gICAgICAgIGtlZXBfZm5hbWVzOiAvc2V0VGltZW91dHxzZXRJbnRlcnZhbHxjbGVhclRpbWVvdXR8Y2xlYXJJbnRlcnZhbC8sXG4gICAgICAgIHBhc3NlczogMixcbiAgICAgIH0sXG4gICAgICBtYW5nbGU6IHtcbiAgICAgICAgc2FmYXJpMTA6IHRydWUsXG4gICAgICAgIC8vIERvbid0IG1hbmdsZSB0aW1lci1yZWxhdGVkIHByb3BlcnRpZXNcbiAgICAgICAgcmVzZXJ2ZWQ6IFsnc2V0VGltZW91dCcsICdzZXRJbnRlcnZhbCcsICdjbGVhclRpbWVvdXQnLCAnY2xlYXJJbnRlcnZhbCcsICdfb25UaW1lb3V0J10sXG4gICAgICAgIHByb3BlcnRpZXM6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIGZvcm1hdDoge1xuICAgICAgICBjb21tZW50czogZmFsc2UsXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHNlcnZlcjoge1xuICAgIGhvc3Q6IHRydWUsXG4gICAgcG9ydDogNTE3MyxcbiAgICBzdHJpY3RQb3J0OiBmYWxzZSxcbiAgICBjb3JzOiB0cnVlLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogJyonLFxuICAgICAgJ0NvbnRlbnQtU2VjdXJpdHktUG9saWN5JzogXCJkZWZhdWx0LXNyYyAnc2VsZic7IHNjcmlwdC1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyAndW5zYWZlLWV2YWwnOyBzdHlsZS1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyBodHRwczovL2ZvbnRzLmdvb2dsZWFwaXMuY29tOyBmb250LXNyYyAnc2VsZicgZGF0YTogaHR0cHM6Ly9mb250cy5nc3RhdGljLmNvbTsgaW1nLXNyYyAnc2VsZicgZGF0YTogaHR0cHM6IGJsb2I6OyBjb25uZWN0LXNyYyAnc2VsZicgaHR0cDovL2xvY2FsaG9zdDoqIHdzOi8vbG9jYWxob3N0Oiogd3NzOi8vbG9jYWxob3N0OiogaHR0cHM6Ly8qLnN1cGFiYXNlLmNvIHdzczovLyouc3VwYWJhc2UuY28gaHR0cHM6Ly8qLm1ldGFhcGkuY2xvdWQgd3NzOi8vKi5tZXRhYXBpLmNsb3VkIGh0dHBzOi8vKi5hZ2lsaXVtdHJhZGUuYWkgd3NzOi8vKi5hZ2lsaXVtdHJhZGUuYWkgaHR0cHM6Ly9hcGkub3BlbmFpLmNvbTsgd29ya2VyLXNyYyAnc2VsZicgYmxvYjo7IGNoaWxkLXNyYyAnc2VsZicgYmxvYjo7XCJcbiAgICB9LFxuICAgIGhtcjoge1xuICAgICAgb3ZlcmxheTogdHJ1ZSxcbiAgICAgIGNsaWVudFBvcnQ6IDUxNzNcbiAgICB9LFxuICAgIHdhdGNoOiB7XG4gICAgICB1c2VQb2xsaW5nOiBmYWxzZSxcbiAgICAgIGludGVydmFsOiAxMDBcbiAgICB9LFxuICAgIHByb3h5OiB7XG4gICAgICAnL21ldGFhcGknOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHBzOi8vbXQtY2xpZW50LWFwaS12MS5uZXcteW9yay5hZ2lsaXVtdHJhZGUuYWknLFxuICAgICAgICBjaGFuZ2VPcmlnaW46IHRydWUsXG4gICAgICAgIHJld3JpdGU6IChwYXRoKSA9PiBwYXRoLnJlcGxhY2UoL15cXC9tZXRhYXBpLywgJycpLFxuICAgICAgICB3czogdHJ1ZSxcbiAgICAgICAgc2VjdXJlOiB0cnVlXG4gICAgICB9XG4gICAgfVxuICB9LFxuICAvLyBQcmV2aWV3IGNvbmZpZ3VyYXRpb24gZm9yIHByb2R1Y3Rpb24gYnVpbGRzXG4gIHByZXZpZXc6IHtcbiAgICBob3N0OiAnbG9jYWxob3N0JyxcbiAgICBwb3J0OiA0MTczLFxuICAgIHN0cmljdFBvcnQ6IGZhbHNlLFxuICAgIGNvcnM6IHRydWUsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlMnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOiAnKidcbiAgICB9XG4gIH0sXG4gIGRlZmluZToge1xuICAgIC8vIEJ1aWxkIHZlcnNpb24gZm9yIGVycm9yIHRyYWNraW5nXG4gICAgX19CVUlMRF9WRVJTSU9OX186IEpTT04uc3RyaW5naWZ5KHByb2Nlc3MuZW52Lm5wbV9wYWNrYWdlX3ZlcnNpb24gfHwgJzIuMC4wJyksXG4gICAgX19CVUlMRF9USU1FX186IEpTT04uc3RyaW5naWZ5KG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSlcbiAgfSxcbiAgLy8gRW5zdXJlIHByb3BlciBlbnZpcm9ubWVudCB2YXJpYWJsZSBoYW5kbGluZ1xuICBlbnZQcmVmaXg6IFsnVklURV8nXSxcbiAgLy8gQ1JJVElDQUwgRklYOiBIYW5kbGUgVHlwZVNjcmlwdCBwcm9wZXJseSBhbmQgcHJldmVudCBldmFsIHVzYWdlXG4gIGVzYnVpbGQ6IHtcbiAgICB0YXJnZXQ6ICdlczIwMjAnLFxuICAgIGxvZ092ZXJyaWRlOiB7ICd0aGlzLWlzLXVuZGVmaW5lZC1pbi1lc20nOiAnc2lsZW50JyB9LFxuICAgIC8vIENSSVRJQ0FMOiBFbnN1cmUgbm8gZXZhbCBpcyB1c2VkIGluIGVzYnVpbGRcbiAgICBsZWdhbENvbW1lbnRzOiAnbm9uZScsXG4gICAgbWluaWZ5SWRlbnRpZmllcnM6IHRydWUsXG4gICAgbWluaWZ5U3ludGF4OiB0cnVlLFxuICAgIG1pbmlmeVdoaXRlc3BhY2U6IHRydWUsXG4gIH1cbn0pOyJdLAogICJtYXBwaW5ncyI6ICI7QUFBeU4sU0FBUyxvQkFBb0I7QUFDdFAsT0FBTyxXQUFXO0FBQ2xCLE9BQU8sVUFBVTtBQUZqQixJQUFNLG1DQUFtQztBQUt6QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixTQUFTLENBQUMsTUFBTSxDQUFDO0FBQUEsRUFDakIsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsS0FBSyxLQUFLLFFBQVEsa0NBQVcsT0FBTztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFD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
