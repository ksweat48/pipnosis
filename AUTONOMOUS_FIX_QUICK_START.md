# Autonomous Goal Sessions - Quick Start After Fix

## What Was Fixed

**Root Cause:** Field name mismatch - code read `initial_balance`, database has `starting_balance`

**Files Fixed:**
1. ✅ `goal-session-core-engine.ts` - Fixed field name
2. ✅ `goal-session-manager.ts` - Added explicit `server_enabled=true`
3. ✅ `smart-goal-session-manager.ts` - Added explicit `server_enabled=true`

---

## Test It Now (3 Steps)

### Step 1: Create Test Session (In UI)
1. Go to Smart Goal Mode
2. Set goal: "Make $50 today"
3. Click "Start Goal Session"
4. ✅ Session created with `server_enabled=true`

### Step 2: Verify Database (Supabase SQL Editor)
```sql
-- Should return your session with server_enabled=true
SELECT
  id,
  status,
  starting_balance,
  server_enabled,
  autonomous_enabled,
  execution_mode
FROM goal_sessions
WHERE user_id = auth.uid()
ORDER BY created_at DESC
LIMIT 1;
```

### Step 3: Check Netlify Logs (Wait ~1 minute)
```
Expected Output:
✅ [Autonomous Monitor] Processing 1 active sessions
✅ [Core] 🚀 Starting iteration for session...
✅ [Core] 🤖 Calling LLM to evaluate XAUUSD...
```

---

## Diagnostic Query

```sql
-- Run this to see ALL sessions and their processing status
SELECT * FROM get_sessions_for_server_processing();

-- If empty, check why:
SELECT
  id,
  status,
  server_enabled,
  autonomous_enabled,
  server_last_check,
  CASE
    WHEN status NOT IN ('scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing')
      THEN '❌ Wrong status: ' || status
    WHEN server_enabled = false
      THEN '❌ Server disabled'
    WHEN autonomous_enabled = false
      THEN '❌ Autonomous disabled'
    WHEN server_last_check > now() - INTERVAL '30 seconds'
      THEN '⏳ Too recent (wait ' || EXTRACT(EPOCH FROM (server_last_check + INTERVAL '30 seconds' - now()))::int || 's)'
    ELSE '✅ Should be processed!'
  END as reason
FROM goal_sessions
ORDER BY created_at DESC
LIMIT 5;
```

---

## Expected Flow

```
User Creates Session
    ↓
status: 'initializing'
server_enabled: true ✅
autonomous_enabled: true ✅
    ↓
Netlify Function (every 1 min)
    ↓
Calls get_sessions_for_server_processing()
    ↓
Returns sessions to process ✅
    ↓
Processes each session:
  - Fetches candles
  - Calls LLM for analysis
  - Opens trades if signals found
  - Closes trades at SL/TP
    ↓
Updates server_last_check ✅
    ↓
Repeats every 30 seconds
```

---

## If Still Not Working

Run full diagnostic:
```sql
\i scripts/diagnose-goal-sessions.sql
```

Check:
1. Does session exist? (Should show in first query)
2. Is `server_enabled=true`? (Should be)
3. Is `autonomous_enabled=true`? (Should be)
4. Is status valid? (Should be 'scanning' or 'initializing')
5. Is `server_last_check` NULL or > 30s ago? (Should be)

If ALL above = YES, then session WILL be processed on next function run (every 1 min).

---

## What Changed in Database

**OLD (BEFORE):**
```sql
-- Sessions created WITHOUT these fields:
server_enabled: NULL (defaults to true)
autonomous_enabled: NULL (defaults to true)
execution_mode: NULL (defaults to 'client')
```

**NEW (AFTER):**
```sql
-- Sessions created WITH explicit values:
server_enabled: true ✅
autonomous_enabled: true ✅
execution_mode: 'server' ✅
```

---

**Status:** ✅ DEPLOYED - Ready to test in ~2 minutes
