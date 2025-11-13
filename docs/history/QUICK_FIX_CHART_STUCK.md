# Quick Fix Guide - Chart Stuck at Same Price

## Symptoms
- Chart shows price but doesn't update
- Price stays frozen at same value
- No new ticks appearing

## Instant Fix (30 seconds)

### Step 1: Open Diagnostics
1. Look for **"Diagnostics"** button in bottom-right corner of chart
2. Click to open the diagnostics panel

### Step 2: Check Status
Look at these indicators:

- 🟢 **Green** = Working properly
- 🟡 **Yellow** = Warning, may need attention
- 🔴 **Red** = Problem detected

### Step 3: Emergency Restart
If you see red indicators or "Stale Data Detected":

1. Click the **"Emergency Restart"** button
2. Wait 5-10 seconds
3. Chart should start updating

## What the Fix Does

The emergency restart:
1. Stops all price polling
2. Activates direct API polling (bypasses database)
3. Restarts candle aggregation
4. Forces fresh data fetch

This works **even if the server-side cron job is broken**.

## Understanding the Diagnostics Panel

### Realtime Connection
- Shows if browser is connected to database
- Should say "CONNECTED" in green

### Database Status
- Shows total records and age of last price
- **Last update should be < 10 seconds**
- If > 30 seconds, data is stale

### Emergency Poller
- **DATABASE mode** = Normal (reading from DB)
- **DIRECT mode** = Using direct API (DB is stale)
- **EMERGENCY mode** = No DB data, using direct API

### Candle States
- Shows how many active candles are being built
- Should be 40 (5 pairs × 8 timeframes)

## If Emergency Restart Doesn't Work

1. **Refresh the entire page** (F5 or Ctrl+R)
2. **Clear browser cache** and reload
3. **Check console for errors** (F12 → Console tab)
4. **Wait 60 seconds** - server polling may restart automatically

## Technical Details

The system has 3 layers of redundancy:

1. **Layer 1:** Server-side cron job (polls MetaAPI every 3 seconds)
2. **Layer 2:** Emergency poller (auto-activates if Layer 1 fails)
3. **Layer 3:** Manual restart (user-triggered recovery)

If Layer 1 fails, Layer 2 automatically kicks in. You should rarely need Layer 3.

## Preventing Future Issues

The system now auto-detects and recovers from:
- Empty database
- Stale data (> 10 seconds old)
- Connection failures
- Server-side polling failures

**The chart should never stay stuck** because the emergency poller will automatically activate.

## When to Contact Support

Contact support if:
- Emergency restart doesn't work after 2 tries
- Diagnostics panel shows errors repeatedly
- Chart remains frozen after page refresh
- Emergency poller shows high error count (> 10)

## Migration Note

If you're a system admin, ensure this migration has been run:
```
supabase/migrations/20251110030000_enable_realtime_and_fix_polling.sql
```

This enables realtime on the `realtime_prices` table and adds monitoring functions.

---

**Quick Action Summary:**
1. Click "Diagnostics" button
2. Click "Emergency Restart"
3. Wait 10 seconds
4. Chart should update

That's it! 🚀
