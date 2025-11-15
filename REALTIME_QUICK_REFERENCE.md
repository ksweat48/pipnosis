# Real-Time Updates - Quick Reference

## What Was Fixed

### ✅ Past Backtest Sessions Now Update Automatically
- New backtests appear instantly without page refresh
- Works for both manual and auto-backtest modes
- Updates silently in the background

### ✅ Level Up Dashboard Now Updates Live
- Skill progression updates as backtests complete
- Win rate, profit factor, and trade counts refresh automatically
- Milestones appear instantly when achieved
- Indicator experiments show real-time progress

### ✅ Viewed Session Details Update in Real-Time
- When viewing a specific backtest session, updates are reflected live
- No need to close and reopen session details

## How It Works

The system now uses **Supabase Realtime subscriptions** to detect database changes:

1. When a backtest completes → Database INSERT event fires
2. Realtime subscription detects the event → Triggers data reload
3. UI updates automatically → You see the new data

All updates happen silently without notifications or page refreshes.

## Testing the Fix

### Test Past Backtest Sessions:
1. Go to AI Training page
2. Start an auto-backtest or run a manual backtest
3. Wait for completion
4. **No refresh needed** - the new session appears in "Past Backtest Sessions" automatically

### Test Level Up Dashboard:
1. Go to AI Training > "AI Learning Progress" tab
2. Run a backtest (manual or auto)
3. When it completes, watch the dashboard update:
   - Total trades increases
   - Win rate updates
   - Progress bar moves
   - Skill level may advance
4. **No refresh needed** - everything updates automatically

### Test Multi-Device Sync:
1. Open the app on two different devices/browsers
2. Start a backtest on one device
3. Watch both devices update when the backtest completes
4. Both stay in sync without any manual action

## Console Messages

You'll see these console messages when realtime events fire:

```
[AI Training] New backtest session detected, reloading...
[AI Training] Synthetic backtest session detected, reloading...
[AI Learning Dashboard] Skill progression updated, reloading...
[AI Learning Dashboard] New learning insight created, reloading...
[AI Learning Dashboard] New milestone achieved, reloading...
[Plateau Dashboard] Skill progression updated, reloading...
```

These are normal and indicate the system is working correctly.

## Troubleshooting

### Data Not Updating?

**Check 1:** Open browser console (F12)
- Look for realtime console messages
- If you see messages, realtime is working

**Check 2:** Wait 30 seconds
- Polling fallback will kick in if realtime fails
- Data should update after 30 seconds maximum

**Check 3:** Check internet connection
- Realtime requires stable connection
- Reconnects automatically when connection restores

**Check 4:** Refresh page as last resort
- Clears any stuck states
- Re-establishes realtime connections

### Still Not Working?

The system has a dual-update strategy:
1. **Realtime (primary):** Updates instantly
2. **Polling (fallback):** Updates every 30 seconds

Even if realtime fails, polling ensures data eventually updates.

## Technical Notes

### What Tables Have Realtime?
- `backtest_sessions`
- `synthetic_backtest_sessions`
- `ai_skill_progression`
- `ai_learning_insights`
- `ai_learning_milestones`
- `ai_indicator_experiments`
- `ai_pattern_ev_tracking`
- `ai_discovered_strategies`

### Security
- Realtime respects all Row Level Security policies
- You can only see your own data
- No security changes were made

### Performance
- Realtime subscriptions are filtered by user_id
- Only your events trigger updates
- Minimal performance impact
- Proper cleanup prevents memory leaks

## Summary

You no longer need to refresh the page to see:
- ✅ New backtest sessions
- ✅ Updated skill progression
- ✅ New milestones
- ✅ Learning insights
- ✅ Indicator experiments

Everything updates automatically in real-time across all your devices.
