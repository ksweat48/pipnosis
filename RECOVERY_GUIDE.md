# RECOVERY GUIDE
## Pipnosis AI Trading Platform - Complete System Restoration

**Last Updated:** October 30, 2025
**System Version:** 1.0.0
**Purpose:** Step-by-step procedures to restore the system to this exact working state

---

## 🎯 QUICK RECOVERY CHECKLIST

If the system breaks, follow this priority order:

1. ✅ **Check SYSTEM_STATE_SNAPSHOT.md** - Verify current state matches expected
2. ✅ **Review Recent Changes** - What was modified before the break?
3. ✅ **Verify Environment Variables** - Are all required vars set correctly?
4. ✅ **Check Database Schema** - Run diagnostics on Supabase
5. ✅ **Review Function Logs** - Check Netlify function execution logs
6. ✅ **Test MetaAPI Connection** - Verify external API connectivity
7. ✅ **Rebuild and Deploy** - Fresh build may resolve issues

---

## 📋 TABLE OF CONTENTS

1. [Complete System Restoration](#complete-system-restoration)
2. [Database Recovery](#database-recovery)
3. [Environment Variable Setup](#environment-variable-setup)
4. [Code Restoration](#code-restoration)
5. [Deployment Recovery](#deployment-recovery)
6. [Troubleshooting Scenarios](#troubleshooting-scenarios)
7. [Verification Procedures](#verification-procedures)

---

## 🔄 COMPLETE SYSTEM RESTORATION

### Prerequisites

Before starting recovery, ensure you have:
- ✅ Git repository access
- ✅ Supabase dashboard access (nzisgxdlydihlwsvonfy)
- ✅ MetaAPI dashboard access
- ✅ Netlify dashboard access
- ✅ Local Node.js 20+ installed
- ✅ All credential values available

---

### Step 1: Clone Repository

```bash
# If repository exists
git clone <repository-url> pipnosis-trading
cd pipnosis-trading

# Checkout the working commit (October 30, 2025 state)
git log --oneline | head -20
# Find commit from "October 30, 2025"
git checkout <commit-hash>

# Or if recovering from this exact snapshot
git checkout main  # or your main branch
```

---

### Step 2: Install Dependencies

```bash
# Clean install (ensures fresh node_modules)
rm -rf node_modules package-lock.json
npm install

# Verify installation
npm list --depth=0

# Expected output should include:
# ├── @supabase/supabase-js@2.53.0
# ├── react@18.3.1
# ├── react-router-dom@6.20.1
# ├── vite@5.4.2
# └── ... (all other dependencies)
```

---

### Step 3: Configure Environment Variables

```bash
# Copy example file
cp .env.example .env

# Edit .env file
nano .env  # or use your preferred editor
```

**Required Variables (see .env.example for complete list):**

```bash
# Supabase
VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co
VITE_SUPABASE_ANON_KEY=<get_from_supabase_dashboard>
SUPABASE_SERVICE_ROLE_KEY=<get_from_supabase_dashboard>

# MetaAPI Frontend
VITE_METAAPI_ACCOUNT_ID=<your_account_id>
VITE_METAAPI_REGION=london

# MetaAPI Backend
METAAPI_ADMIN_TOKEN=<your_admin_token>
METAAPI_ACCOUNT_ID=<your_account_id>
METAAPI_REGION=london

# Admin
ADMIN_REFRESH_KEY=<create_secure_random_string>
```

**Where to get credentials:**

**Supabase:**
1. Go to https://supabase.com/dashboard/project/nzisgxdlydihlwsvonfy
2. Click "Settings" → "API"
3. Copy "URL" → VITE_SUPABASE_URL
4. Copy "anon public" → VITE_SUPABASE_ANON_KEY
5. Copy "service_role" → SUPABASE_SERVICE_ROLE_KEY ⚠️ KEEP SECRET!

**MetaAPI:**
1. Go to https://app.metaapi.cloud/
2. Click "Accounts" → Find your account → Copy Account ID
3. Click "API Tokens" → "Generate Admin Token" → Copy token ⚠️ KEEP SECRET!
4. Check account region (london, new-york, singapore, tokyo)

---

### Step 4: Verify Configuration

```bash
# Run environment validator
npm run dev

# Check console output for:
# ✅ VITE_SUPABASE_URL: (set)
# ✅ VITE_SUPABASE_ANON_KEY: (set)
# ✅ VITE_METAAPI_ACCOUNT_ID: (set)
# ✅ VITE_METAAPI_REGION: (set)

# Stop dev server (Ctrl+C)
```

---

### Step 5: Restore Database Schema

See [Database Recovery](#database-recovery) section below for complete instructions.

---

### Step 6: Test Build

```bash
# Run production build
npm run build

# Expected output:
# vite v5.4.2 building for production...
# ✓ built in 15-20 seconds
# dist/index.html                      X.XX kB │ gzip: X.XX kB
# dist/assets/vendor-[hash].js       XXX.XX kB │ gzip: XXX.XX kB
# dist/assets/index-[hash].js        XXX.XX kB │ gzip: XXX.XX kB
# ... (more chunks)

# Verify dist/ directory exists
ls -la dist/
```

---

### Step 7: Test Locally

```bash
# Start development server
npm run dev

# Open browser to http://localhost:5173

# Test checklist:
# ✅ Page loads without errors
# ✅ Can create account / login
# ✅ Market chart displays
# ✅ Can see live prices updating
# ✅ Can execute demo trade
# ✅ Position appears in ActivePositions
# ✅ Balance updates after trade
```

---

### Step 8: Deploy to Netlify

See [Deployment Recovery](#deployment-recovery) section below.

---

## 💾 DATABASE RECOVERY

### Full Database Schema Restoration

**⚠️ WARNING:** This will recreate all tables. Existing data will be preserved if tables exist, but policies will be reset.

#### Step 1: Access Supabase SQL Editor

1. Go to https://supabase.com/dashboard/project/nzisgxdlydihlwsvonfy
2. Click "SQL Editor" in left sidebar
3. Click "New query"

#### Step 2: Run Consolidated Migration

```sql
-- Copy entire contents of CONSOLIDATED_MIGRATION.sql
-- Paste into SQL Editor
-- Click "Run" or press Cmd/Ctrl+Enter
```

**FILE:** `CONSOLIDATED_MIGRATION.sql` (located in project root)

**Expected output:**
```
Success. No rows returned
```

**Time:** 10-15 seconds

#### Step 3: Verify Tables Created

```sql
-- Run this verification query
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

**Expected tables (20+):**
- ai_learning_metrics
- ai_trade_options
- ai_trading_decisions
- auto_trading_status
- balance_transactions
- chart_preferences
- connection_health_status
- extended_search_sessions
- function_logs
- journal_entries
- market_data
- metaapi_token_cache
- realtime_prices
- refresh_history
- refresh_schedules
- simulated_positions
- trade_history
- trading_prompts
- trading_sessions
- user_profiles

#### Step 4: Create Admin User

```sql
-- Find your user ID (after signing up in the app)
SELECT id, email FROM auth.users;

-- Set yourself as admin (replace USER_ID with your actual ID)
UPDATE user_profiles
SET is_admin = true
WHERE id = 'YOUR_USER_ID_HERE';

-- Verify
SELECT email, is_admin FROM user_profiles WHERE is_admin = true;
```

#### Step 5: Verify RLS Policies

```sql
-- Check RLS is enabled on all tables
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public';

-- All should show: rowsecurity = true

-- Count policies
SELECT schemaname, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public';

-- Should see multiple policies per table (SELECT, INSERT, UPDATE, DELETE)
```

---

### Database Backup Before Recovery

**Always backup before major changes!**

#### Export Data

```sql
-- Export user profiles
COPY (SELECT * FROM user_profiles) TO STDOUT WITH CSV HEADER;

-- Export trade history
COPY (SELECT * FROM trade_history) TO STDOUT WITH CSV HEADER;

-- Export simulated positions
COPY (SELECT * FROM simulated_positions WHERE status = 'open') TO STDOUT WITH CSV HEADER;
```

#### Download via Supabase Dashboard

1. Go to "Table Editor"
2. Select table
3. Click "Export" → "CSV"
4. Save to safe location

---

## 🔐 ENVIRONMENT VARIABLE SETUP

### Local Development (.env file)

Create `.env` in project root:

```bash
# === SUPABASE ===
VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# === METAAPI (Frontend - Build Time) ===
VITE_METAAPI_ACCOUNT_ID=your-account-id
VITE_METAAPI_REGION=london

# === METAAPI (Backend - Runtime) ===
METAAPI_ADMIN_TOKEN=your-admin-token
METAAPI_ACCOUNT_ID=your-account-id
METAAPI_REGION=london
METAAPI_TOKEN=your-admin-token

# === ADMIN ===
ADMIN_REFRESH_KEY=create-a-secure-random-key-here
```

### Netlify Production

**⚠️ CRITICAL:** Netlify environment variables MUST be set for functions to work!

#### Step 1: Access Netlify Dashboard

1. Go to https://app.netlify.com/
2. Select your site
3. Go to "Site settings" → "Environment variables"

#### Step 2: Add All Variables

Click "Add a variable" for each:

| Key | Value | Scopes |
|-----|-------|--------|
| VITE_SUPABASE_URL | https://nzisgxdlydihlwsvonfy.supabase.co | Builds, Functions |
| VITE_SUPABASE_ANON_KEY | eyJhbGci... | Builds, Functions |
| SUPABASE_SERVICE_ROLE_KEY | eyJhbGci... | Functions |
| VITE_METAAPI_ACCOUNT_ID | your-account-id | Builds, Functions |
| VITE_METAAPI_REGION | london | Builds, Functions |
| METAAPI_ADMIN_TOKEN | your-admin-token | Functions |
| METAAPI_ACCOUNT_ID | your-account-id | Functions |
| METAAPI_REGION | london | Functions |
| METAAPI_TOKEN | your-admin-token | Functions |
| ADMIN_REFRESH_KEY | your-admin-key | Functions |

**Important:**
- All VITE_ variables: Check "Builds" scope
- All non-VITE_ variables: Check "Functions" scope
- Service role and admin token: ONLY "Functions" scope

#### Step 3: Verify Variables

```bash
# Trigger a new build
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca

# Watch build logs in Netlify dashboard
# Check for: "Environment variables loaded successfully"
```

---

## 💻 CODE RESTORATION

### Restore from Git

```bash
# If you have uncommitted changes
git stash

# Pull latest working state
git fetch origin
git checkout main  # or your working branch
git pull origin main

# If you stashed changes
git stash list
git stash pop  # or git stash drop to discard
```

### Restore Specific Files

```bash
# Restore a single file to last known working version
git checkout HEAD -- src/services/simulated-trading.ts

# Restore entire directory
git checkout HEAD -- src/services/

# Restore to specific commit
git checkout <commit-hash> -- src/services/simulated-trading.ts
```

### Restore from Documentation

If git history is lost, use CODE_REFERENCE.md to manually restore key files:

1. Open CODE_REFERENCE.md
2. Find the algorithm/function you need
3. Copy code snippet
4. Paste into correct file location
5. Verify imports and types

---

## 🚀 DEPLOYMENT RECOVERY

### Netlify Deployment from Scratch

#### Step 1: Connect Repository

1. Go to https://app.netlify.com/
2. Click "Add new site" → "Import an existing project"
3. Choose Git provider (GitHub, GitLab, etc.)
4. Select repository
5. Configure build settings:
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`

#### Step 2: Set Environment Variables

See [Environment Variable Setup](#environment-variable-setup) section above.

#### Step 3: Deploy

Click "Deploy site"

**Expected timeline:**
- Install dependencies: 1-2 minutes
- Build: 15-20 seconds
- Deploy: 5-10 seconds
- **Total:** ~2-3 minutes

#### Step 4: Configure Domain (Optional)

1. Go to "Domain settings"
2. Add custom domain or use Netlify subdomain
3. Enable HTTPS (automatic)

#### Step 5: Enable Build Hook

1. Go to "Build & deploy" → "Build hooks"
2. Create new build hook: "Production Deploy"
3. Copy webhook URL
4. Test: `curl -X POST -d '{}' <webhook-url>`

---

### Manual Deployment (Alternative)

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Login to Netlify
netlify login

# Link to existing site
netlify link

# Set environment variables
netlify env:set VITE_SUPABASE_URL "https://nzisgxdlydihlwsvonfy.supabase.co"
netlify env:set VITE_SUPABASE_ANON_KEY "your-anon-key"
# ... repeat for all variables

# Deploy
netlify deploy --prod

# Or build and deploy separately
npm run build
netlify deploy --prod --dir=dist
```

---

## 🔍 TROUBLESHOOTING SCENARIOS

### Scenario 1: Prices Not Updating

**Symptoms:**
- Chart shows "No data available"
- Last price timestamp is old
- ActivePositions shows stale prices

**Diagnosis:**
```bash
# Check realtime_prices table
# Run in Supabase SQL Editor:
SELECT symbol, bid, ask, created_at, source
FROM realtime_prices
ORDER BY created_at DESC
LIMIT 20;

# If empty or old: polling not working
# If recent: frontend not reading correctly
```

**Solution:**

1. **Check global polling coordinator:**
```typescript
// In browser console
// Should see: "✅ Global polling coordinator initialized"
// Should see: "📊 Global Polling Status" every 60 seconds
```

2. **Verify MetaAPI connection:**
```bash
# Call verify function
curl https://your-site.netlify.app/.netlify/functions/verify-metaapi-connection

# Expected: {"healthy": true, "diagnostics": {...}}
```

3. **Check Netlify function logs:**
- Go to Netlify Dashboard → Functions
- Find `get-live-price`
- Check recent invocations
- Look for errors

4. **Verify environment variables:**
```bash
# In Netlify Dashboard → Environment variables
# Ensure these are set:
# - METAAPI_ADMIN_TOKEN
# - METAAPI_ACCOUNT_ID
# - METAAPI_REGION
```

---

### Scenario 2: Trades Not Executing

**Symptoms:**
- Click "Execute Trade" → nothing happens
- No position appears in ActivePositions
- No error message shown

**Diagnosis:**
```typescript
// Check browser console for errors
// Look for: Supabase errors, RLS policy errors, balance errors
```

**Solution:**

1. **Check simulated_positions table exists:**
```sql
-- In Supabase SQL Editor
SELECT * FROM simulated_positions LIMIT 1;
-- If error: table doesn't exist → run CONSOLIDATED_MIGRATION.sql
```

2. **Verify RLS policies:**
```sql
-- Check if RLS is enabled
SELECT tablename, rowsecurity
FROM pg_tables
WHERE tablename = 'simulated_positions';
-- Should show: rowsecurity = true

-- Check policies exist
SELECT policyname FROM pg_policies
WHERE tablename = 'simulated_positions';
-- Should show multiple policies
```

3. **Check user balance:**
```sql
-- Verify user has sufficient balance
SELECT demo_balance FROM user_profiles
WHERE id = 'YOUR_USER_ID';
-- Should be > 0 (default 10000)
```

4. **Test trade execution manually:**
```sql
-- Try inserting a position manually
INSERT INTO simulated_positions (
  user_id, symbol, position_type, order_type,
  lot_size, entry_price, stop_loss, take_profit,
  status, current_price, current_pnl
) VALUES (
  'YOUR_USER_ID', 'EURUSD', 'buy', 'market',
  0.1, 1.0850, 1.0800, 1.0950,
  'open', 1.0850, 0
);
-- If this works: frontend issue
-- If error: RLS or schema issue
```

---

### Scenario 3: Build Failures

**Symptoms:**
- `npm run build` fails
- TypeScript errors
- Missing dependencies

**Common Errors:**

**Error:** "Cannot find module '@/lib/supabase'"
```bash
# Solution: Verify tsconfig.json has path alias
# Check tsconfig.json:
"paths": {
  "@/*": ["./src/*"]
}
```

**Error:** "Module not found: axios" (or any dependency)
```bash
# Solution: Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

**Error:** "Type error: Property 'xxx' does not exist"
```bash
# Solution: Check types, ensure proper imports
npm run lint
# Fix reported issues
```

---

### Scenario 4: Authentication Not Working

**Symptoms:**
- Can't sign up or login
- "Invalid credentials" errors
- Session not persisting

**Solution:**

1. **Verify Supabase Auth is enabled:**
- Go to Supabase Dashboard → Authentication
- Ensure "Email" provider is enabled
- Check "Email confirmation" setting (should be DISABLED for dev)

2. **Check environment variables:**
```bash
# Verify these are set:
VITE_SUPABASE_URL=https://nzisgxdlydihlwsvonfy.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGci...
```

3. **Test auth manually:**
```sql
-- Check if user exists
SELECT id, email, created_at FROM auth.users;

-- Check if user_profile exists
SELECT * FROM user_profiles;
-- If users exist but no profiles: trigger issue
```

4. **Recreate user profile trigger:**
```sql
-- This trigger auto-creates user_profiles on signup
-- If missing, users can't login properly
-- Re-run CONSOLIDATED_MIGRATION.sql to restore
```

---

### Scenario 5: MetaAPI Timeout Errors

**Symptoms:**
- "MetaAPI request timeout after 8 seconds"
- get-live-price function fails frequently
- Cached prices being used

**Solution:**

1. **Check MetaAPI account status:**
- Go to https://app.metaapi.cloud/
- Verify account is "CONNECTED" and "DEPLOYED"
- Check subscription is active

2. **Verify region matches:**
```bash
# Ensure these match your account region
VITE_METAAPI_REGION=london  # or new-york, singapore, tokyo
METAAPI_REGION=london       # MUST be identical
```

3. **Test MetaAPI directly:**
```bash
curl -H "auth-token: YOUR_ADMIN_TOKEN" \
  https://mt-client-api-v1.london.agiliumtrade.ai/users/current/accounts/YOUR_ACCOUNT_ID/symbols/EURUSD/current-price
```

4. **Check function timeout:**
```toml
# In netlify.toml - increase if needed
[functions."get-live-price"]
  timeout = 15  # Increase from default 10s
```

---

## ✅ VERIFICATION PROCEDURES

### Post-Recovery Verification Checklist

Run through this checklist after any recovery procedure:

#### 1. Environment Check
```bash
# Verify all environment variables are set
node -e "
const env = process.env;
const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_METAAPI_ACCOUNT_ID',
  'VITE_METAAPI_REGION'
];
required.forEach(key => {
  console.log(key + ':', env[key] ? '✅' : '❌');
});
"
```

#### 2. Build Test
```bash
npm run build
# Should complete without errors
# Should create dist/ directory
ls -la dist/
```

#### 3. Database Schema Test
```sql
-- Run in Supabase SQL Editor

-- Test 1: All tables exist
SELECT COUNT(*) FROM information_schema.tables
WHERE table_schema = 'public';
-- Expected: 20+ tables

-- Test 2: RLS is enabled
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = false;
-- Expected: 0 rows (all should have RLS)

-- Test 3: User profiles accessible
SELECT COUNT(*) FROM user_profiles;
-- Should not error

-- Test 4: Realtime prices accessible
SELECT COUNT(*) FROM realtime_prices;
-- Should not error
```

#### 4. Frontend Functionality Test
```bash
# Start dev server
npm run dev

# Open http://localhost:5173
# Manual tests:
# ✅ Page loads without console errors
# ✅ Can navigate to /auth
# ✅ Can create new account (if email confirmation disabled)
# ✅ Can login with existing account
# ✅ Dashboard loads
# ✅ Market chart displays
# ✅ Can change symbol
# ✅ Live prices update every 5 seconds
```

#### 5. Backend Functionality Test
```bash
# Test get-live-price function
curl "https://your-site.netlify.app/.netlify/functions/get-live-price?symbol=EURUSD"

# Expected response:
# {"ok":true,"symbol":"EURUSD","bid":1.08234,"ask":1.08245,"timestamp":"...","source":"metaapi-live"}

# Test verify-metaapi-connection
curl "https://your-site.netlify.app/.netlify/functions/verify-metaapi-connection"

# Expected response:
# {"healthy":true,"diagnostics":{...}}
```

#### 6. Trading Functionality Test
```
Manual test in browser:

1. Login to dashboard
2. Open ManualTradePanel
3. Enter trade details:
   - Symbol: EURUSD
   - Action: BUY
   - Lot size: 0.1
   - Entry: (current price)
   - SL: (50 pips below)
   - TP: (100 pips above)
4. Click "Execute Trade"
5. Verify:
   ✅ Position appears in ActivePositions
   ✅ Balance shows reserved amount
   ✅ P&L updates in real-time
6. Click "Close Position"
7. Verify:
   ✅ Position closes
   ✅ Balance updates with P&L
   ✅ Trade appears in TradeHistory
```

#### 7. Global Polling Test
```
Browser console check:

1. Open browser DevTools → Console
2. Look for:
   ✅ "🚀 Initializing global polling coordinator..."
   ✅ "✅ Global polling coordinator initialized successfully"
   ✅ Every 60 seconds: "📊 Global Polling Status: [{...}]"

3. Check status array shows:
   - 10 symbols (EURUSD, GBPUSD, USDJPY, USDCHF, AUDUSD, USDCAD, NZDUSD, EURGBP, EURJPY, GBPJPY)
   - All with status: '🟢 ACTIVE'
   - All with recent prices
```

#### 8. Database Query Performance Test
```sql
-- Test query speed
EXPLAIN ANALYZE
SELECT * FROM realtime_prices
WHERE symbol = 'EURUSD'
ORDER BY created_at DESC
LIMIT 10;

-- Should complete in < 50ms
-- Should use index: idx_realtime_prices_symbol_created
```

---

## 🆘 EMERGENCY CONTACT

### If All Else Fails

**Last Resort Actions:**

1. **Nuclear Option: Complete Wipe and Restore**
```bash
# Delete everything
rm -rf node_modules dist .env

# Fresh start
git clone <repository-url> pipnosis-fresh
cd pipnosis-fresh
git checkout <last-known-good-commit>

# Follow complete restoration steps above
```

2. **Database Nuclear Option:**
```sql
-- ⚠️ WARNING: This deletes ALL data!
-- Only use if absolutely necessary and you have backups!

-- Drop all tables (in reverse dependency order)
DROP TABLE IF EXISTS balance_transactions CASCADE;
DROP TABLE IF EXISTS trade_history CASCADE;
DROP TABLE IF EXISTS simulated_positions CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS trading_prompts CASCADE;
DROP TABLE IF EXISTS extended_search_sessions CASCADE;
DROP TABLE IF EXISTS realtime_prices CASCADE;
DROP TABLE IF EXISTS metaapi_token_cache CASCADE;
DROP TABLE IF EXISTS function_logs CASCADE;
DROP TABLE IF EXISTS connection_health_status CASCADE;
DROP TABLE IF EXISTS market_data CASCADE;
DROP TABLE IF EXISTS refresh_history CASCADE;
DROP TABLE IF EXISTS refresh_schedules CASCADE;
DROP TABLE IF EXISTS chart_preferences CASCADE;
DROP TABLE IF EXISTS ai_learning_metrics CASCADE;
DROP TABLE IF EXISTS ai_trade_options CASCADE;
DROP TABLE IF EXISTS ai_trading_decisions CASCADE;
DROP TABLE IF EXISTS auto_trading_status CASCADE;
DROP TABLE IF EXISTS trading_sessions CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

-- Then re-run CONSOLIDATED_MIGRATION.sql
```

3. **Netlify Site Reset:**
```bash
# Delete site and recreate
# In Netlify Dashboard:
# Site settings → Advanced → Delete site

# Then follow "Netlify Deployment from Scratch" steps
```

---

## 📞 SUPPORT RESOURCES

### Documentation Files
- **SYSTEM_STATE_SNAPSHOT.md** - Current system state reference
- **ARCHITECTURE_REFERENCE.md** - Technical architecture details
- **CODE_REFERENCE.md** - Key code implementations
- **CONFIGURATION_MANIFEST.md** - All configuration settings

### External Resources
- **Supabase Docs:** https://supabase.com/docs
- **MetaAPI Docs:** https://metaapi.cloud/docs/
- **Netlify Docs:** https://docs.netlify.com/
- **Vite Docs:** https://vitejs.dev/
- **React Docs:** https://react.dev/

### Dashboard Links
- **Supabase:** https://supabase.com/dashboard/project/nzisgxdlydihlwsvonfy
- **MetaAPI:** https://app.metaapi.cloud/
- **Netlify:** https://app.netlify.com/

---

## 🎓 LESSONS LEARNED

### Common Mistakes to Avoid

1. **❌ Forgetting Non-VITE_ Environment Variables**
   - MetaAPI functions need both VITE_ and non-prefixed vars
   - Functions cannot access VITE_ vars at runtime

2. **❌ Disabling RLS Temporarily**
   - Never disable RLS "just to test"
   - Always fix policies, don't remove security

3. **❌ Using .single() Instead of .maybeSingle()**
   - .single() throws errors if no row found
   - Always use .maybeSingle() for safer queries

4. **❌ Not Testing After Environment Changes**
   - Always run `npm run build` after changing env vars
   - Verify changes in both dev and production

5. **❌ Ignoring Function Logs**
   - Check Netlify function logs regularly
   - Early warnings prevent big problems

---

**END OF RECOVERY GUIDE**

*For current system state, see SYSTEM_STATE_SNAPSHOT.md*
*For architecture details, see ARCHITECTURE_REFERENCE.md*
*For code examples, see CODE_REFERENCE.md*
*For configuration details, see CONFIGURATION_MANIFEST.md*

---

**Recovery Timestamp:** October 30, 2025
**Documentation Version:** 1.0.0
**System Status:** ✅ FULLY OPERATIONAL
