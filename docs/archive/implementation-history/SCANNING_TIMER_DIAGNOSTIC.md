# Scanning Timer Diagnostic Guide

## Problem: 15-Minute Messages Stopped

The scanning system polls every **60 seconds** to check:
1. Has 15 minutes elapsed since last scan?
2. Should we show the continuation modal?
3. Has the modal timed out?

If you're not seeing these checks in console, it means **polling stopped**.

---

## Quick Check

Open browser console and paste:

```javascript
// Check if there's an active session
const { data: session } = await window.supabase
  .from('goal_sessions')
  .select('*')
  .eq('user_id', (await window.supabase.auth.getUser()).data.user.id)
  .eq('status', 'scanning')
  .maybeSingle();

console.log('Active Session:', session);

if (session) {
  const elapsed = (Date.now() - new Date(session.scanning_started_at).getTime()) / 60000;
  console.log(`Scanning for: ${elapsed.toFixed(1)} minutes`);
  console.log(`Status: ${session.status}`);
  console.log(`Awaiting confirmation: ${session.awaiting_continuation_confirmation}`);
}
```

---

## Common Causes

### 1. Session Status Changed
**Symptom:** Session exists but status is not 'scanning'

**Possible reasons:**
- Session was paused
- Session was stopped
- Session auto-closed due to timeout
- Trade was executed (session went to 'trading')

**Fix:** Start a new goal session from the Smart Goal Mode page

### 2. No Active Session
**Symptom:** Query returns null

**Possible reasons:**
- Session expired naturally (15-min + 1-min timeout)
- User clicked "Stop" on continuation modal
- Previous session wasn't cleaned up properly

**Fix:** Start a new goal session

### 3. Polling Never Started
**Symptom:** Session exists with status='scanning' but no logs

**Possible reasons:**
- Page was refreshed (browser state lost)
- Engine never initialized on this page load
- JavaScript error prevented initialization

**Fix:**
1. Go to Smart Goal Mode page
2. Stop the existing session
3. Start a new session

### 4. Session in 'Trading' State
**Symptom:** A trade is open, polling stopped

**This is NORMAL behavior:**
- When a trade is found and executed, polling stops
- The system switches to trade monitoring
- 15-minute messages won't appear during active trades

**No action needed:** Once trade closes, you can start a new goal session

---

## Expected Console Logs

When scanning is working correctly, you should see:

```
[Goal Live Engine] 🔄 Processing candle update...
[Scanning Timer] Checking if 15 minutes elapsed...
```

Every 60 seconds.

When 15 minutes elapse:

```
[Goal Live Engine] 🕐 15 minutes elapsed with no trades - triggering modal
[Scanning Timer] 🕐 15 minutes elapsed - triggering continuation modal
[Scanning Timer] ✅ Modal triggered - awaiting user response
```

---

## Manual Fix

If session is stuck, manually reset it:

```javascript
// Get your user ID
const { data: { user } } = await window.supabase.auth.getUser();

// Find stuck session
const { data: sessions } = await window.supabase
  .from('goal_sessions')
  .select('*')
  .eq('user_id', user.id)
  .in('status', ['scanning', 'awaiting_confirmation']);

console.log('Sessions:', sessions);

// If you find a stuck session, close it:
if (sessions && sessions.length > 0) {
  const sessionId = sessions[0].id;

  await window.supabase
    .from('goal_sessions')
    .update({ status: 'stopped' })
    .eq('id', sessionId);

  console.log('Session closed. Start a new one.');
}
```

---

## Verify System is Running

Check that the goal-session-live-engine is loaded:

```javascript
// This should log the engine status
console.log('[DIAGNOSTIC] Checking engine...');

// Look for these in your console logs when page loads:
// ✅ "[Goal Live Engine] Session started"
// ✅ "[Goal Live Engine] Polling every 15 seconds"
// ✅ "Autonomous trading session started"
```

---

## What Changed in Last Update?

**Nothing related to scanning timer!**

The recent changes only affected:
- Alpha's prompt (added risk profile context)
- Position sizing calculations
- Omega voting weights
- Stop loss width calculations

**The scanning system was NOT touched.**

If scanning stopped, it's due to:
1. Natural session expiration (15 + 1 min)
2. Manual stop
3. Trade execution (moved to 'trading' state)

---

## Action Plan

1. **Check session status** (run first diagnostic)
2. **If no session:** Start new goal session
3. **If session exists but stuck:** Close it manually, start new one
4. **If trade is open:** This is normal - wait for trade to close
5. **If still broken:** Check for JavaScript errors in console

---

## Prevention

The scanning timer will automatically stop after:
- 15 minutes with no trades → Shows modal
- User doesn't respond to modal within 1 minute → Auto-closes

This is **by design** to prevent wasted API calls.

To keep scanning indefinitely, you must click **"Continue Scanning"** when the modal appears.
