# SYSTEM STATE SNAPSHOT
## Pipnosis AI Trading Platform - Working Configuration

**Document Created:** October 30, 2025
**System Version:** 1.0.0
**Status:** ✅ FULLY OPERATIONAL
**Purpose:** Master reference for current working state - USE THIS FOR QUICK RECOVERY

---

## 🎯 QUICK STATUS CHECK

### System Health Indicators
- ✅ Frontend: React 18 + TypeScript + Vite (WORKING)
- ✅ Database: Supabase PostgreSQL with RLS (WORKING)
- ✅ Backend: 12 Netlify Functions (WORKING)
- ✅ MetaAPI: Live forex data integration (WORKING)
- ✅ Real-time Polling: 10 forex pairs @ 5s intervals (WORKING)
- ✅ Demo Trading: Simulated positions & P&L (WORKING)
- ✅ Authentication: Supabase Auth with role-based access (WORKING)
- ✅ Build System: Vite production builds (WORKING)

### Critical Metrics
- **Total TypeScript/React Code:** 3,844 lines
- **Database Tables:** 20+ tables with full RLS
- **SQL Migrations:** 36 migration files
- **Netlify Functions:** 12 serverless functions
- **React Components:** 25 components
- **Forex Pairs Tracked:** 10 major pairs
- **Polling Interval:** 5 seconds per pair
- **Demo Trading Account:** $10,000 starting balance

---

## 🔑 CRITICAL CONFIGURATION VALUES

### Environment Variables (Required)

#### Supabase (Database)
```
VITE_SUPABASE_URL=<your_supabase_project_url>
VITE_SUPABASE_ANON_KEY=<public_anon_key>
SUPABASE_SERVICE_ROLE_KEY=<sensitive_service_role_key>
```

#### MetaAPI (Live Data - Frontend)
```
VITE_METAAPI_ACCOUNT_ID=<your_account_id>
VITE_METAAPI_REGION=london
```

#### MetaAPI (Backend - Netlify Functions)
```
METAAPI_ADMIN_TOKEN=<sensitive_admin_token>
METAAPI_ACCOUNT_ID=<same_as_vite_version>
METAAPI_REGION=london
```

#### Admin
```
ADMIN_REFRESH_KEY=<your_secure_admin_key>
```

**CRITICAL:** Both VITE_ and non-VITE_ versions of MetaAPI vars must be set!
- VITE_ = Compiled into frontend at build time
- Non-prefixed = Available to Netlify functions at runtime

---

## 📊 SYSTEM ARCHITECTURE SUMMARY

### Frontend Stack
- **Framework:** React 18.3.1 with TypeScript 5.5.3
- **Build Tool:** Vite 5.4.2
- **Styling:** Tailwind CSS 3.4.1 with custom glass-morphism
- **Charts:** Lightweight Charts 5.0.8
- **Icons:** Lucide React 0.344.0
- **Routing:** React Router DOM 6.20.1

### Backend Stack
- **Database:** Supabase (PostgreSQL 15)
- **Functions:** Netlify Edge Functions (Node 20)
- **Trading API:** MetaAPI Cloud SDK
- **Real-time:** Supabase subscriptions + custom polling

### Database Tables (20+)
```
Core Tables:
├── user_profiles (authentication & balance)
├── simulated_positions (demo trades)
├── trade_history (closed trades)
├── balance_transactions (account ledger)
├── realtime_prices (live forex data cache)
├── trading_prompts (AI analysis requests)
├── journal_entries (trade notes)
├── market_data (historical candles)
├── trading_sessions (user sessions)
├── auto_trading_status (AI trading state)
├── ai_trading_decisions (AI decision log)
├── ai_trade_options (generated strategies)
├── ai_learning_metrics (ML performance)
├── extended_search_sessions (background search)
├── metaapi_token_cache (token caching)
├── function_logs (serverless function monitoring)
├── connection_health_status (system health)
├── refresh_schedules (data refresh config)
├── refresh_history (refresh execution log)
└── chart_preferences (user chart settings)
```

### Netlify Functions (12)
```
1. get-live-price.ts       - Fetch live forex prices
2. get-metaapi-token.js     - Generate MetaAPI tokens
3. forex-price.js           - Price data endpoint
4. forex-candles.js         - Historical candle data
5. refresh-candles.ts       - Manual data refresh
6. scheduled-refresh.ts     - Automated refresh (2 AM daily)
7. analyze-market.ts        - AI market analysis
8. verify-metaapi-account.ts - Account verification
9. verify-metaapi-connection.ts - Connection health check
10. function-logger.js/ts   - Centralized logging
11. error-handler.js        - Error processing
```

### React Components (25)
```
Main Layout:
├── App.tsx (Main app router)
├── Header.tsx (Top navigation)
└── ErrorBoundary.tsx (Error handling)

Trading Interface:
├── TradingDashboard.tsx (Main dashboard)
├── MarketChart.tsx (Live price charts)
├── ManualTradePanel.tsx (Manual order entry)
├── ActivePositions.tsx (Open trades display)
├── TradeHistory.tsx (Closed trades)
├── StrategyOptions.tsx (AI-generated strategies)
├── TradeConfirmationModal.tsx (Order confirmation)
└── AITradingConsole.tsx (AI assistant)

Data & Status:
├── TradingKPIs.tsx (Performance metrics)
├── BalanceDisplay.tsx (Account balance)
├── NotificationCenter.tsx (System alerts)
├── ConfigurationStatus.tsx (System config display)
├── GlobalPollingStatus.tsx (Polling monitor)
├── SearchStatusPanel.tsx (Extended search UI)
└── PromptInput.tsx (User input)

Pages:
├── AdminDashboard.tsx (Admin panel)
├── AuthPage.tsx (Login/signup)
├── ResetPasswordPage.tsx (Password reset)
├── LandingPage.tsx (Waitlist page)
└── PublicLandingPage.tsx (Marketing page)

Utilities:
├── ProtectedRoute.tsx (Auth guard)
├── DatabaseSetupWizard.tsx (DB setup)
└── DatabaseErrorBoundary.tsx (DB error handling)
```

### Core Services (8)
```
1. global-polling-coordinator.ts  - Manages live price polling
2. simulated-trading.ts           - Demo trading engine
3. extended-search.ts             - Background opportunity scanner
4. position-monitor.ts            - Real-time position tracking
5. prompt-validation.ts           - User input validation
6. db-health-monitor.ts          - Database health checks
7. refresh-service.ts            - Data refresh orchestration
8. chart-preferences.ts          - Chart settings management
```

---

## 🚀 KEY FEATURES IN OPERATION

### 1. Real-Time Price Polling
- **Status:** ACTIVE
- **Pairs:** EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, EURGBP, EURJPY, GBPJPY
- **Interval:** 5 seconds per pair
- **Storage:** realtime_prices table (30-second cache)
- **Fallback:** Cached data on MetaAPI failure

### 2. Demo Trading System
- **Starting Balance:** $10,000
- **Position Types:** Market orders (buy/sell)
- **Risk Management:** Stop loss & take profit required
- **P&L Calculation:** Real-time with pip-based computation
- **Order Types:** Market execution only (no pending orders yet)
- **Tracking:** All trades logged in trade_history table

### 3. AI Trade Signal Generation
- **Method:** Multi-symbol scanner
- **Analysis:** Prompt-based opportunity detection
- **Symbols Scanned:** Top 3 forex pairs per request
- **Output:** Entry, SL, TP with risk/reward ratio
- **Confidence Scoring:** 0-100% scale
- **Fallback:** Extended search (up to 1 hour)

### 4. Extended Search Capability
- **Trigger:** When no immediate trades found
- **Duration:** Up to 1 hour background scanning
- **Frequency:** Continuous symbol rotation
- **Notification:** User alerted when opportunity found
- **Cancellation:** User can cancel anytime

### 5. Position Monitoring
- **Real-time Updates:** Every 5 seconds via polling
- **Auto SL/TP:** Automatic position closure on hit
- **P&L Tracking:** Live profit/loss display
- **Balance Updates:** Automatic on position close
- **Transaction Log:** Complete audit trail

---

## 📁 CRITICAL FILE LOCATIONS

### Configuration Files
```
/package.json                 - Dependencies & scripts
/vite.config.ts              - Build configuration
/netlify.toml                - Deployment settings
/tailwind.config.js          - Styling configuration
/.env                        - Environment variables (LOCAL ONLY)
/.env.example                - Environment template
/.env.production             - Production env template
```

### Core Application Files
```
/src/App.tsx                 - Main application component
/src/main.tsx                - Application entry point
/src/index.css               - Global styles
/src/lib/supabase.ts         - Supabase client initialization
/src/lib/error-handler.ts    - Global error handling
```

### Database Files
```
/supabase/migrations/        - All SQL migrations
/CONSOLIDATED_MIGRATION.sql  - Complete DB schema
/supabase/FIX_AI_PREDICTION_TABLES.sql - AI table fixes
```

### Deployment Files
```
/netlify/functions/          - Serverless functions
/public/_headers             - HTTP headers
/public/_redirects           - URL redirects
/netlify-cli.sh             - Netlify CLI setup script
/setup-netlify-env.sh       - Environment setup script
```

---

## 🔒 SECURITY CONFIGURATION

### Row Level Security (RLS)
- **Status:** ENABLED on all tables
- **Policy Type:** Restrictive (deny by default)
- **Authentication:** Required for all operations
- **Ownership:** Users can only access their own data
- **Admin Override:** is_admin flag grants full access

### API Security
- **Frontend:** Anonymous key (safe to expose)
- **Backend:** Service role key (sensitive, Netlify only)
- **MetaAPI:** Admin token (sensitive, Netlify only)
- **CORS:** Configured for Supabase + MetaAPI domains

### Content Security Policy
```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:
connect-src 'self' https://*.supabase.co wss://*.supabase.co
            https://*.agiliumtrade.ai wss://*.agiliumtrade.ai
```

---

## ⚡ BUILD & DEPLOYMENT

### Build Command
```bash
npm run build
```

### Production Build Settings
- **Minification:** Terser
- **Source Maps:** Disabled
- **Code Splitting:** Vendor, router, UI, Supabase, Socket.io
- **Target:** ES2020
- **Chunk Size Limit:** 1000 KB

### Netlify Configuration
- **Node Version:** 20
- **Build Command:** npm run build
- **Publish Directory:** dist
- **Functions Directory:** netlify/functions
- **Function Timeout:** 600s (refresh functions), 26s (connection health)

### Scheduled Functions
- **scheduled-refresh.ts:** Runs daily at 2 AM UTC
- **Purpose:** Refresh historical candle data
- **Timeout:** 600 seconds

---

## 📈 PERFORMANCE METRICS

### Database Indexes
```sql
- realtime_prices: (symbol, created_at DESC)
- simulated_positions: (user_id, status)
- trade_history: (user_id, closed_at DESC)
- balance_transactions: (user_id, created_at DESC)
- trading_prompts: (user_id, created_at DESC)
```

### Caching Strategy
- **Price Cache:** 30-second window in realtime_prices
- **Token Cache:** 1-hour MetaAPI tokens in metaapi_token_cache
- **Chart Data:** User preferences cached locally

### Error Handling
- **Network Errors:** Graceful fallback to cache
- **MetaAPI Timeout:** 8-second limit with abort controller
- **Database Errors:** Non-blocking with user notification
- **Build Errors:** Comprehensive error boundaries

---

## 🎨 DESIGN SYSTEM

### Color Scheme
- **Primary:** Emerald/Green (success, positive P&L)
- **Secondary:** Red (losses, warnings)
- **Neutral:** Gray scale (backgrounds, text)
- **Accent:** Blue (links, info)

### Typography
- **Font:** System font stack
- **Sizes:** Responsive with sm:, md:, lg: breakpoints
- **Line Height:** 150% for body, 120% for headings

### Layout
- **Style:** Glass-morphism with backdrop blur
- **Grid:** Responsive grid with Tailwind
- **Spacing:** 8px base unit
- **Breakpoints:** sm (640px), md (768px), lg (1024px), xl (1280px)

---

## 🔄 DATA FLOW

### Live Price Updates
```
MetaAPI → get-live-price.ts → realtime_prices table →
MarketChart.tsx → Real-time display
```

### Trade Execution
```
User Input → ManualTradePanel → simulated-trading.ts →
simulated_positions table → ActivePositions display →
Real-time P&L updates
```

### Balance Management
```
Position Close → Calculate P&L → Update demo_balance →
Log in balance_transactions → Refresh display
```

### AI Signal Generation
```
User Prompt → multiSymbolScanner → Market Analysis →
Strategy Generation → User Selection → Trade Execution
```

---

## 🛠️ MAINTENANCE COMMANDS

### Local Development
```bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run preview      # Preview production build
npm run lint         # Run ESLint
```

### Database
```bash
# Run migrations (in Supabase SQL Editor)
# Copy contents of CONSOLIDATED_MIGRATION.sql
# Execute in SQL Editor

# Verify schema
SELECT * FROM user_profiles LIMIT 1;
SELECT * FROM realtime_prices ORDER BY created_at DESC LIMIT 10;
```

### Netlify Deployment
```bash
# Deploy to production
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca

# Verify deployment
# Check Netlify dashboard for build status
```

---

## 🚨 CRITICAL WARNINGS

### DO NOT:
- ❌ Remove VITE_ environment variables (needed at build time)
- ❌ Remove non-prefixed MetaAPI vars (needed at runtime)
- ❌ Disable RLS on any table (security risk)
- ❌ Use DROP commands in migrations (data loss)
- ❌ Commit .env files to git (credential exposure)
- ❌ Use service role key in frontend (security risk)

### ALWAYS:
- ✅ Keep both VITE_ and non-VITE_ MetaAPI variables in sync
- ✅ Test migrations in development before production
- ✅ Verify RLS policies after schema changes
- ✅ Monitor Netlify function logs for errors
- ✅ Keep Supabase and Netlify environment variables identical
- ✅ Run `npm run build` after code changes to verify

---

## 📞 QUICK REFERENCE

### If System Breaks
1. Check this document first
2. Review RECOVERY_GUIDE.md for step-by-step restoration
3. Verify environment variables match this snapshot
4. Check database migrations are applied
5. Review recent git commits
6. Consult ARCHITECTURE_REFERENCE.md for technical details

### If Price Data Stops
1. Check global-polling-coordinator initialization
2. Verify MetaAPI credentials in Netlify
3. Check realtime_prices table for recent entries
4. Review get-live-price.ts function logs

### If Trades Fail
1. Verify simulated_positions table exists
2. Check user demo_balance is sufficient
3. Review simulated-trading.ts service
4. Verify RLS policies on simulated_positions

### If Build Fails
1. Run `npm install` to ensure dependencies
2. Check TypeScript errors with `npm run lint`
3. Verify vite.config.ts is intact
4. Check for missing environment variables
5. Review recent changes to package.json

---

## 📝 VERSION HISTORY

### Current Version: 1.0.0 (October 30, 2025)
- ✅ Complete system operational
- ✅ All 10 forex pairs polling
- ✅ Demo trading fully functional
- ✅ AI signal generation working
- ✅ Real-time position monitoring active
- ✅ Balance tracking accurate
- ✅ Admin dashboard accessible
- ✅ Extended search capability enabled

### Key Milestones
- October 28, 2025: Clean slate MetaAPI setup
- October 27, 2025: Critical schema fixes applied
- October 24, 2025: Function monitoring tables added
- October 23, 2025: MetaAPI token caching implemented
- October 17, 2025: AI prediction system added
- October 16, 2025: Extended search sessions created
- October 13, 2025: Auto-trading features added
- October 12, 2025: Historical candles implemented

---

## 🔗 RELATED DOCUMENTATION

For detailed information, refer to:
- **ARCHITECTURE_REFERENCE.md** - Complete technical architecture
- **CODE_REFERENCE.md** - Key code implementations
- **CONFIGURATION_MANIFEST.md** - All configuration details
- **RECOVERY_GUIDE.md** - Step-by-step restoration procedures

---

**END OF SYSTEM STATE SNAPSHOT**

*This document represents the exact working state of the Pipnosis AI Trading Platform as of October 30, 2025. Use this as the primary reference for system restoration and troubleshooting.*
