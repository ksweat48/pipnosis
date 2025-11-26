# Auto-Backtest Troubleshooting Quick Reference

## ✅ Fixes Applied

1. **Database Schema** - Added 30-day system columns + error tracking
2. **Error Handling** - Comprehensive try-catch blocks throughout service
3. **Error Display** - Red error card shows specific error messages in UI
4. **Detailed Logging** - Console logs at every step for debugging

## 🔍 How to Debug When It Fails

### Step 1: Click the Button
- Click "Start Auto-Backtest"
- Keep browser console open (Press F12)

### Step 2: Read the Error
You'll now see errors in 3 places:

1. **Alert Dialog** - Shows specific error with details
2. **Red Error Card** (in UI) - Shows persistent error message
3. **Browser Console** - Shows detailed logs with `[Auto-Backtest]` prefix

### Step 3: Common Errors & Solutions

| Error Message | Likely Cause | Solution |
|--------------|--------------|----------|
| "database sync error" | RLS policy blocking write | Check Supabase permissions |
| "column X does not exist" | Missing migration | Run SQL migration to add columns |
| "No candles found for EURUSD" | No synthetic data | Check `synthetic_candles` table |
| "Cannot read property of undefined" | Missing data in backtest | Check data generator service |
| "No user ID available" | Auth issue | Re-login, check auth state |

### Step 4: Run Diagnostic
```bash
node scripts/diagnostics/test-auto-backtest-startup.cjs
```

This checks:
- ✅ Database schema complete
- ✅ No stale sessions
- ✅ Recent errors logged
- ✅ System health

## 🎯 What Changed

### Before
```javascript
// Generic error - no details
alert('Failed to start auto-backtest. Please try again.');
```

### After
```javascript
// Specific error with details
alert(`Failed to start auto-backtest:

Day 1 failed: Cannot read property 'open_time' of undefined

Please check the console for more details.`);
```

**Plus** a red error card in UI showing the full error message with timestamp.

## 📊 Console Log Examples

### Successful Start
```
[Auto-Backtest] Starting auto-backtest...
[Auto-Backtest] Syncing state to database...
[Auto-Backtest] Verifying database state...
[Auto-Backtest] ✅ Database state confirmed - auto-backtest is running
[Auto-Backtest] 🚀 Starting 30-day progressive learning system
```

### Failed Start (with new error handling)
```
[Auto-Backtest] Starting auto-backtest...
[Auto-Backtest] Syncing state to database...
[Auto-Backtest] ERROR in runDailySession (Day 1): Cannot read property 'open_time' of undefined
[Auto-Backtest] Error details: TypeError: Cannot read property...
[Auto-Backtest] Fatal error in run loop: TypeError...
```

## 🔧 Emergency Fixes

### Clear Stale Session
```sql
UPDATE auto_backtest_global_state
SET is_running = false,
    stopped_at = now()
WHERE user_id = 'YOUR_USER_ID';
```

### Check Current State
```sql
SELECT is_running, last_error_message, last_error_at
FROM auto_backtest_global_state
WHERE user_id = 'YOUR_USER_ID';
```

### Clear Error
```sql
UPDATE auto_backtest_global_state
SET last_error_message = NULL,
    last_error_at = NULL
WHERE user_id = 'YOUR_USER_ID';
```

## 📱 UI Features Added

1. **Error Card** (Red) - Shows when `lastErrorMessage` exists
   - Displays full error text
   - Shows error timestamp
   - Has "Dismiss" button

2. **Enhanced Alerts** - Show multi-line detailed errors instead of generic messages

3. **Console Logging** - Every step logs progress for debugging

## ✨ Next Steps

1. Click "Start Auto-Backtest" again
2. If it fails, you'll now see **exactly why**
3. Share the specific error message for targeted help
4. Check console for full details
5. Run diagnostic script for system health check

---

**The system will now tell you exactly what's wrong instead of showing generic errors!**
