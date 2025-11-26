# Zero Trades Issue - Quick Fix Guide

**ISSUE**: Every backtest shows 0 trades, month number cycling #1 → #7

**STATUS**: ✅ FIXED

---

## 🎯 What Was Wrong

1. **Date window too short**: 1 day → not enough candles
2. **Requirements too strict**: Needed 50+ candles, had <24
3. **Silent failures**: System didn't report problems
4. **No validation**: Didn't check if trades generated

---

## ✅ What Was Fixed

### Main Changes:
1. **7-day data window** (was 1 day)
2. **Reduced candle requirements** (50→20)
3. **Error detection** (stops on 0 trades)
4. **Better logging** (shows what's failing)

### Files Modified:
- `src/services/simple-auto-backtest-service.ts`
- `src/services/synthetic-backtesting-engine.ts`

---

## 🚀 How to Test

### Step 1: Run Diagnostic
```sql
-- In Supabase SQL Editor:
-- Run DIAGNOSE_ZERO_TRADES_ISSUE.sql
```

**Check**: Do you have synthetic candles?

### Step 2: Clear Old Data (Optional)
```sql
-- Remove failed 0-trade sessions
DELETE FROM synthetic_backtest_sessions
WHERE total_trades = 0;

-- Reset month counter
UPDATE auto_backtest_global_state
SET current_month_number = 0;
```

### Step 3: Restart Auto-Backtest
1. Go to AI Training page
2. Click "Start Auto-Backtest"
3. Watch console logs
4. Look for: "✅ Verified X candles available"

### Step 4: Verify Success
After ~2 minutes:
- Console should show: "Day 1 ✅ ... Trades: 5" (or similar)
- UI should show trades > 0
- Win rate should be real % (not 0.0%)

---

## ✅ Expected Output

### Good Console Logs:
```
[Auto-Backtest] ========== DAY 1/30 ==========
[Synthetic Backtest] ✅ Verified 5,234 candles
[Synthetic Backtest] ✅ Processing 168 H1 candles
[Synthetic Backtest] Signal #1 - BUY (85%)
[Synthetic Backtest] ✓ Trade executed
[Auto-Backtest] Day 1 ✅ Trades: 5, Win Rate: 60%
```

### Bad Console Logs:
```
❌ CRITICAL: No candles found
⚠️ WARNING: ZERO trades generated
```

If you see ❌ or ⚠️:
1. Run `DIAGNOSE_ZERO_TRADES_ISSUE.sql`
2. Check synthetic_candles table
3. Verify data generation is working

---

## 🔍 If Still Broken

### No Candles Found?
```sql
-- Check if ANY synthetic data exists
SELECT COUNT(*) FROM synthetic_candles;
```

**If 0**: Data generation is failing
**If >0**: Date range mismatch - check query logic

### Candles Exist But 0 Trades?
- Lower confidence threshold further
- Check signal generation logic
- Add debug logging to generateSignalAtTime()

---

## 📊 Success Indicators

- ✅ Trades > 0 each session
- ✅ Month number stays stable
- ✅ Calendar boxes populate
- ✅ Win rates show real % (40-70%)
- ✅ No rapid cycling

---

## 📞 Quick Support

**Problem**: Still seeing 0 trades
**Action**: Run `DIAGNOSE_ZERO_TRADES_ISSUE.sql`

**Problem**: Month cycling fast
**Action**: Check error logs, system is stopping properly now

**Problem**: Database errors
**Action**: Check Supabase logs, may need rate limiting

---

**Full details**: See `ZERO_TRADES_FIX_COMPLETE.md`

**Diagnostic SQL**: `DIAGNOSE_ZERO_TRADES_ISSUE.sql`

---

*Fixed: 2025-11-22*
*Ready to Test*
