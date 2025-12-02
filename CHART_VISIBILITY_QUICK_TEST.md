# Quick Test Guide - Chart Visibility Fix

## 30-Second Test

1. **Open chart** on any pair (EURUSD recommended)
2. **Wait 10 seconds** - note current candle time
3. **Switch to another tab** (Gmail, YouTube, anything)
4. **Wait 6+ minutes** (time for 1-2 new M5 candles to complete)
5. **Return to Pipnosis tab**
6. **Watch console** - should see:
   ```
   [Chart] 👁️ Tab visible - resuming full hybrid mode
   [Chart] 🔄 Clearing stale current candle and fetching latest data...
   [Chart] ✅ Refreshed with latest data from DB
   [Chart] 🆕 Adding X new candles created while tab was hidden
   ```
7. **Check chart** - should show new completed candles ✅

---

## What You Should See

### ✅ Success Indicators
- New candles appear within 2 seconds
- Chart updates smoothly
- Current price updates with live ticks
- No incomplete/frozen candles
- No manual refresh needed

### ❌ If Still Broken
- Chart stays frozen
- Old incomplete candle persists
- No console logs appear
- Must refresh page manually

---

## Browser Console Check

Open DevTools (F12) and look for these logs:

### When You Leave Tab
```
[Chart] 🙈 Tab hidden - pausing live tick rendering
[Chart] 💾 DB polling continues (reduced frequency)
```

### When You Return
```
[Chart] 👁️ Tab visible - resuming full hybrid mode
[Chart] 🔄 Clearing stale current candle and fetching latest data...
[Chart] ✅ Refreshed with latest data from DB
[Chart] Latest candle: [timestamp]
[Chart] 🆕 Adding 2 new candles created while tab was hidden
[Chart] 📡 Live tick rendering resumed
[Chart] 💾 DB polling resumed at full frequency
[Chart] 👁️ Chart visible - resuming price polling
[Chart] 🔄 Fetching fresh prices to clear stale data
```

---

## Different Timeframes

Test across timeframes for comprehensive verification:

### M5 (5 minutes)
- Leave tab for 6+ minutes
- Expect 1-2 new candles on return

### M15 (15 minutes)
- Leave tab for 16+ minutes
- Expect 1-2 new candles on return

### H1 (1 hour)
- Leave tab for 65+ minutes
- Expect 1-2 new candles on return

---

## Edge Cases to Test

1. **Very Short Absence** (< 5 minutes)
   - Should still refresh
   - May show 0 new candles (expected)

2. **Very Long Absence** (hours)
   - Should catch up with all missed candles
   - May take 3-5 seconds to load

3. **Market Closed** (weekends)
   - Should handle gracefully
   - No errors, just no new candles

4. **Multiple Tabs**
   - Switch between different pairs
   - Each should refresh independently

---

## Quick Verification Checklist

- [ ] Chart loads initially
- [ ] Live prices update every 3 seconds
- [ ] Switch to another tab for 6+ minutes
- [ ] Return to Pipnosis tab
- [ ] See console logs for visibility change
- [ ] New candles appear automatically
- [ ] Current price updates immediately
- [ ] No manual refresh needed
- [ ] No incomplete candles visible

---

## If Fix Doesn't Work

1. **Hard refresh**: Ctrl+Shift+R (clear cache)
2. **Check deployment**: Wait 2-3 minutes for Netlify deploy
3. **Verify console**: Look for error messages
4. **Check network**: Ensure API calls succeeding
5. **Report**: Provide console logs and screenshot

---

## Deployment Status

**Build**: ✅ Completed
**Deploy**: ✅ In progress (~2-3 minutes)
**URL**: https://pipnosis.com

Wait for Netlify deployment to complete before testing!
