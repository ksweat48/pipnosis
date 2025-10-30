# CONFIGURATION MANIFEST
## Pipnosis AI Trading Platform - Complete Configuration Reference

**Last Updated:** October 30, 2025
**System Version:** 1.0.0
**Purpose:** Comprehensive configuration documentation for all settings

---

## 📋 TABLE OF CONTENTS

1. [Environment Variables](#environment-variables)
2. [Vite Configuration](#vite-configuration)
3. [Netlify Configuration](#netlify-configuration)
4. [Tailwind CSS Configuration](#tailwind-css-configuration)
5. [TypeScript Configuration](#typescript-configuration)
6. [Package Dependencies](#package-dependencies)
7. [Build Settings](#build-settings)
8. [Security Headers](#security-headers)

---

## 🔐 ENVIRONMENT VARIABLES

### Complete Environment Variable List

#### Supabase Configuration

```bash
# Supabase Project URL
# Where: Supabase Dashboard > Project Settings > API
# Used by: Frontend and Backend
VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co

# Supabase Anonymous Key (Public - Safe to expose)
# Where: Supabase Dashboard > Project Settings > API > anon key
# Used by: Frontend (compiled into build)
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Supabase Service Role Key (SENSITIVE - Never expose!)
# Where: Supabase Dashboard > Project Settings > API > service_role key
# Used by: Netlify Functions ONLY
# Set in: Netlify Dashboard > Site settings > Environment variables
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Alternate name (some functions use this)
SUPABASE_SERVICE_ROLE=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### MetaAPI Configuration (Frontend)

```bash
# MetaAPI Account ID (Compiled into frontend at build time)
# Where: MetaAPI Dashboard > Accounts > Account ID
# Used by: Frontend components
VITE_METAAPI_ACCOUNT_ID=your-metaapi-account-id

# MetaAPI Region (Compiled into frontend at build time)
# Options: new-york, london, singapore, tokyo
# Must match where your MetaAPI account is deployed
VITE_METAAPI_REGION=london
```

#### MetaAPI Configuration (Backend - Runtime)

```bash
# MetaAPI Admin Token (HIGHLY SENSITIVE - Never expose!)
# Where: MetaAPI Dashboard > API Tokens > Admin Token
# Used by: Netlify Functions to generate temporary tokens
# Set in: Netlify Dashboard > Site settings > Environment variables
# CRITICAL: This is your master token with full account access
METAAPI_ADMIN_TOKEN=your-admin-token-here

# MetaAPI Account ID (Backend copy - same value as VITE_ version)
# Used by: Netlify Functions at runtime
# Must be identical to VITE_METAAPI_ACCOUNT_ID
METAAPI_ACCOUNT_ID=your-metaapi-account-id

# MetaAPI Region (Backend copy - same value as VITE_ version)
# Used by: Netlify Functions at runtime
# Must be identical to VITE_METAAPI_REGION
METAAPI_REGION=london

# Legacy variable (for backward compatibility)
# Can be same as METAAPI_ADMIN_TOKEN
METAAPI_TOKEN=your-admin-token-here
```

#### Admin Configuration

```bash
# Admin Refresh Key (Secret key for admin operations)
# Used by: refresh-candles and scheduled-refresh functions
# Set to: Any secure random string
ADMIN_REFRESH_KEY=your-secure-admin-key-here
```

### Environment Variable Prefix Rules

**VITE_ Prefix:**
- Available at BUILD TIME only
- Compiled into frontend JavaScript bundle
- Accessible via `import.meta.env.VITE_*`
- NOT available to Netlify Functions at runtime
- Safe to use public values (anon keys, URLs)

**No Prefix:**
- Available at RUNTIME to Netlify Functions
- NOT accessible to frontend code
- Must use sensitive values (service role, admin tokens)
- Accessed via `process.env.*`

### Critical Duplication Required

These variables MUST be set twice (both VITE_ and non-prefixed):

```bash
# Frontend (build time)
VITE_METAAPI_ACCOUNT_ID=abc123
VITE_METAAPI_REGION=london

# Backend (runtime)
METAAPI_ACCOUNT_ID=abc123    # ← Same value!
METAAPI_REGION=london         # ← Same value!
```

### Environment Variable Checklist

#### Local Development (.env file)
- ✅ VITE_SUPABASE_URL
- ✅ VITE_SUPABASE_ANON_KEY
- ✅ SUPABASE_SERVICE_ROLE_KEY (for testing functions locally)
- ✅ VITE_METAAPI_ACCOUNT_ID
- ✅ VITE_METAAPI_REGION
- ✅ METAAPI_ADMIN_TOKEN (for testing functions locally)
- ✅ METAAPI_ACCOUNT_ID
- ✅ METAAPI_REGION
- ✅ ADMIN_REFRESH_KEY

#### Netlify Production (Dashboard > Environment Variables)
- ✅ VITE_SUPABASE_URL
- ✅ VITE_SUPABASE_ANON_KEY
- ✅ SUPABASE_SERVICE_ROLE_KEY ← CRITICAL!
- ✅ VITE_METAAPI_ACCOUNT_ID
- ✅ VITE_METAAPI_REGION
- ✅ METAAPI_ADMIN_TOKEN ← CRITICAL!
- ✅ METAAPI_ACCOUNT_ID ← CRITICAL!
- ✅ METAAPI_REGION ← CRITICAL!
- ✅ ADMIN_REFRESH_KEY

---

## ⚡ VITE CONFIGURATION

**FILE:** `vite.config.ts`

### Complete Vite Configuration

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['socket.io-client'],
  },

  build: {
    // Minification
    minify: 'terser',
    sourcemap: false,

    // CommonJS compatibility
    commonjsOptions: {
      transformMixedEsModules: true,
      include: [/node_modules/],
      exclude: [],
    },

    // Code splitting strategy
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          router: ['react-router-dom'],
          ui: ['lucide-react'],
          supabase: ['@supabase/supabase-js'],
          socketio: ['socket.io-client']
        },
        entryFileNames: `assets/[name]-[hash].js`,
        chunkFileNames: `assets/[name]-[hash].js`,
        assetFileNames: `assets/[name]-[hash].[ext]`
      }
    },

    // Chunk size warning limit (KB)
    chunkSizeWarningLimit: 1000,

    // Build analysis
    reportCompressedSize: true,

    // Asset handling
    assetsDir: 'assets',
    assetsInlineLimit: 4096,

    // Clean output directory
    emptyOutDir: true,

    // Terser options (minification)
    terserOptions: {
      compress: {
        drop_console: false,      // Keep console.log in production
        drop_debugger: true,      // Remove debugger statements
        keep_fnames: /setTimeout|setInterval|clearTimeout|clearInterval/,
        passes: 2,
      },
      mangle: {
        safari10: true,
        reserved: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', '_onTimeout'],
        properties: false,
      },
      format: {
        comments: false,
      },
    },
  },

  server: {
    host: true,
    port: 5173,
    strictPort: false,
    cors: true,

    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' http://localhost:* ws://localhost:* wss://localhost:* https://*.supabase.co wss://*.supabase.co https://*.metaapi.cloud wss://*.metaapi.cloud https://*.agiliumtrade.ai wss://*.agiliumtrade.ai https://api.openai.com; worker-src 'self' blob:; child-src 'self' blob:;"
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
      '/metaapi': {
        target: 'https://mt-client-api-v1.new-york.agiliumtrade.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/metaapi/, ''),
        ws: true,
        secure: true
      }
    }
  },

  preview: {
    host: 'localhost',
    port: 4173,
    strictPort: false,
    cors: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    }
  },

  define: {
    __BUILD_VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString())
  },

  envPrefix: ['VITE_'],

  esbuild: {
    target: 'es2020',
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  }
});
```

### Key Configuration Explanations

#### Code Splitting
```typescript
manualChunks: {
  vendor: ['react', 'react-dom'],        // Core framework (220 KB)
  router: ['react-router-dom'],          // Routing (45 KB)
  ui: ['lucide-react'],                   // Icons (60 KB)
  supabase: ['@supabase/supabase-js'],   // Database client (85 KB)
  socketio: ['socket.io-client']         // WebSocket client (50 KB)
}
```

**Benefits:**
- Faster initial load (parallel download)
- Better caching (vendor rarely changes)
- Smaller update downloads

#### Terser Optimization
```typescript
keep_fnames: /setTimeout|setInterval|clearTimeout|clearInterval/
```
**Why:** Preserves timer function names to prevent polling coordinator bugs

```typescript
drop_console: false
```
**Why:** Keep console.log for production debugging via browser dev tools

---

## 🚀 NETLIFY CONFIGURATION

**FILE:** `netlify.toml`

### Complete Netlify Configuration

```toml
[build]
  publish = "dist"
  command = "npm run build"

[build.environment]
  NODE_VERSION = "20"
  SKIP_PREFLIGHT_CHECK = "true"

[functions]
  node_bundler = "esbuild"

# Function-specific timeout (10 minutes for data refresh)
[functions."refresh-candles"]
  timeout = 600

# Scheduled function (runs daily at 2 AM UTC)
[functions."scheduled-refresh"]
  timeout = 600
  schedule = "0 2 * * *"

# Connection health check (26 seconds)
[functions."connection-health"]
  timeout = 26

# SPA routing - serve index.html for all routes
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

# Cache static assets for 1 year
[[headers]]
  for = "/assets/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"

# No cache for JavaScript bundles (with hash in filename for versioning)
[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

# No cache for CSS
[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

# Security headers for index.html
[[headers]]
  for = "/index.html"
  [headers.values]
    Cache-Control = "no-cache, no-store, must-revalidate"
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "camera=(), microphone=(), geolocation=()"
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.openai.com https://*.agiliumtrade.ai wss://*.agiliumtrade.ai; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self' blob:; child-src 'self' blob:;"

# Default security headers for all routes
[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

### Netlify Function Timeouts

| Function | Timeout | Reason |
|----------|---------|--------|
| refresh-candles | 600s (10 min) | Fetches large historical datasets |
| scheduled-refresh | 600s (10 min) | Daily bulk data refresh |
| connection-health | 26s | Quick health check |
| All others | 10s (default) | Standard operations |

### Scheduled Function (Cron)

```toml
[functions."scheduled-refresh"]
  timeout = 600
  schedule = "0 2 * * *"
```

**Cron Expression:** `0 2 * * *`
- Minute: 0 (on the hour)
- Hour: 2 (2 AM)
- Day of month: * (every day)
- Month: * (every month)
- Day of week: * (every day of week)

**Result:** Runs daily at 2:00 AM UTC

### Content Security Policy (CSP)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;
  style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
  font-src 'self' data: https://fonts.gstatic.com;
  img-src 'self' data: https: blob:;
  connect-src 'self'
    https://*.supabase.co
    wss://*.supabase.co
    https://api.openai.com
    https://*.agiliumtrade.ai
    wss://*.agiliumtrade.ai;
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  worker-src 'self' blob:;
  child-src 'self' blob:;
```

**Allowed Domains:**
- `*.supabase.co` - Database and auth
- `*.agiliumtrade.ai` - MetaAPI live data
- `api.openai.com` - AI analysis (future)

---

## 🎨 TAILWIND CSS CONFIGURATION

**FILE:** `tailwind.config.js`

```javascript
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### Custom CSS Classes

**FILE:** `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Glass-morphism effect */
@layer components {
  .glass-card {
    @apply bg-white/5 backdrop-blur-lg border border-white/10 rounded-xl shadow-2xl;
  }

  .glass-card-hover {
    @apply glass-card hover:bg-white/10 transition-all duration-300;
  }
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: rgba(15, 23, 42, 0.5);
}

::-webkit-scrollbar-thumb {
  background: rgba(100, 116, 139, 0.5);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(148, 163, 184, 0.7);
}
```

### Color Palette

```css
/* Primary Colors */
emerald-500: #10b981  /* Success, buy orders, positive P&L */
emerald-600: #059669  /* Hover states */

red-400: #f87171      /* Danger, sell orders, losses */
red-500: #ef4444      /* Critical alerts */

/* Neutral Colors */
slate-800: #1e293b   /* Card backgrounds */
slate-900: #0f172a   /* Dark backgrounds */
gray-950: #030712    /* Darkest backgrounds */

/* Text Colors */
white: #ffffff       /* Primary text */
white/70: rgba(255, 255, 255, 0.7)  /* Secondary text */
white/50: rgba(255, 255, 255, 0.5)  /* Tertiary text */
```

---

## 📘 TYPESCRIPT CONFIGURATION

**FILE:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    /* Path aliases */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.app.json" }
  ]
}
```

### Key TypeScript Settings

**target: ES2020**
- Modern JavaScript features
- Async/await support
- Optional chaining (?.)
- Nullish coalescing (??)

**strict: true**
- Strict null checks
- Strict function types
- No implicit any
- Strict property initialization

**Path Aliases**
```typescript
// Instead of: import { supabase } from '../../../lib/supabase'
// Use: import { supabase } from '@/lib/supabase'
```

---

## 📦 PACKAGE DEPENDENCIES

**FILE:** `package.json`

### Production Dependencies

```json
{
  "@supabase/supabase-js": "^2.53.0",    // Database client
  "@types/uuid": "^10.0.0",               // UUID types
  "axios": "^1.6.0",                      // HTTP client
  "dotenv": "^16.3.1",                    // Environment variables
  "lightweight-charts": "^5.0.8",         // TradingView charts
  "lucide-react": "^0.344.0",             // Icon library
  "react": "^18.3.1",                     // UI framework
  "react-dom": "^18.3.1",                 // React DOM
  "react-router-dom": "^6.20.1",          // Routing
  "socket.io-client": "2.5.0",            // WebSocket (legacy)
  "tiny-emitter": "^2.1.0",               // Event emitter
  "uuid": "^11.1.0"                       // UUID generation
}
```

### Development Dependencies

```json
{
  "@eslint/js": "^9.9.1",                 // ESLint core
  "@types/react": "^18.3.5",              // React types
  "@types/react-dom": "^18.3.0",          // React DOM types
  "@vitejs/plugin-react": "^4.3.1",       // Vite React plugin
  "autoprefixer": "^10.4.18",             // CSS autoprefixer
  "eslint": "^9.9.1",                     // Linter
  "eslint-plugin-react-hooks": "^5.1.0-rc.0",  // React hooks linting
  "eslint-plugin-react-refresh": "^0.4.11",    // HMR linting
  "globals": "^15.9.0",                   // Global variables
  "postcss": "^8.4.35",                   // CSS processor
  "tailwindcss": "^3.4.1",                // Utility CSS
  "terser": "^5.44.0",                    // Minifier
  "typescript": "^5.5.3",                 // TypeScript compiler
  "typescript-eslint": "^8.3.0",          // TS linting
  "vite": "^5.4.2"                        // Build tool
}
```

### Version Compatibility

**React 18.3.1**
- Concurrent rendering
- Automatic batching
- Suspense improvements
- Strict mode enhancements

**Vite 5.4.2**
- Lightning-fast HMR
- Optimized production builds
- Native ESM support
- Rollup-powered bundling

**Supabase JS 2.53.0**
- Real-time subscriptions
- Auth helpers
- TypeScript support
- Automatic retries

---

## 🔨 BUILD SETTINGS

### NPM Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  }
}
```

### Build Process Breakdown

```bash
npm run build
```

**Step 1:** TypeScript Compilation
- Check types across all .ts/.tsx files
- Generate type declarations
- Validate imports/exports

**Step 2:** Code Transformation
- JSX → JavaScript
- Modern JS → ES2020
- Path aliases resolved (@/ → ./src/)

**Step 3:** Code Splitting
- Vendor chunk (React, React DOM)
- Router chunk (React Router)
- UI chunk (Lucide icons)
- Supabase chunk
- Socket.io chunk

**Step 4:** Minification (Terser)
- Remove whitespace
- Shorten variable names
- Remove comments
- Dead code elimination
- Preserve timer functions

**Step 5:** Asset Processing
- Tailwind CSS compilation
- PostCSS autoprefixer
- Image optimization
- Font subsetting

**Step 6:** Output Generation
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js         # Main bundle
│   ├── vendor-[hash].js         # React + React DOM
│   ├── router-[hash].js         # React Router
│   ├── ui-[hash].js             # Lucide icons
│   ├── supabase-[hash].js       # Supabase client
│   ├── socketio-[hash].js       # Socket.io
│   └── index-[hash].css         # Styles
└── public assets copied
```

### Build Size Targets

| Chunk | Target Size | Actual |
|-------|-------------|--------|
| Vendor | < 250 KB | ~220 KB |
| Main | < 150 KB | ~120 KB |
| Router | < 50 KB | ~45 KB |
| UI | < 70 KB | ~60 KB |
| Supabase | < 100 KB | ~85 KB |
| Socket.io | < 60 KB | ~50 KB |
| **Total** | **< 680 KB** | **~580 KB** |

---

## 🔒 SECURITY HEADERS

### HTTP Security Headers

#### X-Frame-Options
```
X-Frame-Options: DENY
```
**Purpose:** Prevent clickjacking attacks
**Effect:** Page cannot be embedded in iframe

#### X-Content-Type-Options
```
X-Content-Type-Options: nosniff
```
**Purpose:** Prevent MIME-type sniffing
**Effect:** Browser must respect declared content type

#### Referrer-Policy
```
Referrer-Policy: strict-origin-when-cross-origin
```
**Purpose:** Control referrer information
**Effect:** Send origin only for cross-origin requests

#### Permissions-Policy
```
Permissions-Policy: camera=(), microphone=(), geolocation=()
```
**Purpose:** Disable browser features
**Effect:** No access to camera, mic, or location

### Cache Control Strategy

```
/assets/*          → max-age=31536000, immutable (1 year)
/*.js, /*.css      → max-age=0, must-revalidate (always check)
/index.html        → no-cache, no-store (never cache)
```

**Why:**
- Assets have hash in filename → safe to cache forever
- JS/CSS without hash → always revalidate
- index.html → never cache (ensures latest version)

---

## 🧪 DEVELOPMENT SETTINGS

### Local Development Server

```bash
npm run dev
```

**Settings:**
- Port: 5173
- Host: localhost (or 0.0.0.0 if exposed)
- HMR: Enabled with overlay
- CORS: Enabled for all origins
- Proxy: MetaAPI requests through /metaapi

### Environment File (.env)

```bash
# Local development environment variables
# This file should NEVER be committed to git

VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

VITE_METAAPI_ACCOUNT_ID=your-account-id
VITE_METAAPI_REGION=london

METAAPI_ADMIN_TOKEN=your-admin-token
METAAPI_ACCOUNT_ID=your-account-id
METAAPI_REGION=london

ADMIN_REFRESH_KEY=your-admin-key
```

---

## 📊 PERFORMANCE BUDGETS

### JavaScript Bundle Sizes

```
Individual Chunk Limits:
- vendor.js: 250 KB (gzipped)
- main.js: 150 KB (gzipped)
- Other chunks: < 100 KB each

Total JS Size: < 700 KB (gzipped)
```

### Load Time Targets

```
First Contentful Paint (FCP): < 1.5s
Largest Contentful Paint (LCP): < 2.5s
Time to Interactive (TTI): < 3.5s
Cumulative Layout Shift (CLS): < 0.1
First Input Delay (FID): < 100ms
```

### Network Performance

```
API Response Times:
- get-live-price: < 1000ms (with 8s timeout)
- Database queries: < 500ms
- Supabase auth: < 1000ms

Polling Intervals:
- Price updates: 5000ms (5 seconds)
- Position updates: 3000ms (3 seconds)
- Balance refresh: 5000ms (5 seconds)
```

---

**END OF CONFIGURATION MANIFEST**

*For code implementations, see CODE_REFERENCE.md*
*For architecture details, see ARCHITECTURE_REFERENCE.md*
*For recovery procedures, see RECOVERY_GUIDE.md*
