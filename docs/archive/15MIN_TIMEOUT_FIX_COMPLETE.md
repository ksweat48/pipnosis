# 15-Minute Timeout Enforcement Fix - COMPLETE

## Problem Summary

User was still scanning past 15 minutes (22h 39m shown in admin panel), wasting resources even though the market was closed. The 15-minute auto-close mechanism was completely broken.

## Root Causes Identified

### 1. **Fatal Logic Flaw in Server Processing**
- Sessions with status `awaiting_continuation` were EXCLUDED from `get_sessions_for_server_processing()`
- This meant the autonomous monitor never checked these sessions for timeout
- Result: Once a session entered `awaiting_continuation`, it was stuck forever

### 2. **Misleading Admin Dashboard**
- Admin panel calculated scanning duration from session `start_time` (total session time)
- Should have used `scanning_started_at` (current 15-minute period start)
- Made it look like users were scanning for 22+ hours when they may have clicked "Continue" multiple times

### 3. **No Client-Side Backup**
- Browser had no timeout check, relying entirely on server
- If server processing was delayed, timeout wouldn't be enforced

## Fixes Applied

### 1. **Database Migration: fix_15min_timeout_enforcement.sql**

#### Emergency Cleanup
- Closed all sessions stuck in `awaiting_continuation` with expired timeout
- Closed any session scanning for over 2 hours (safety net)

#### Fixed `get_sessions_for_server_processing()`
```sql
WHERE
  gs.status IN ('scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing', 'awaiting_continuation')
  -- ^ CRITICAL: Must include 'awaiting_continuation' so timeout check can run
```

**Why this matters:** This ensures sessions awaiting user response are still processed by the autonomous monitor, allowing the timeout check to execute and auto-close expired sessions.

#### Fixed `admin_get_all_users()`
```sql
-- Calculate duration from current scanning period start (scanning_started_at)
-- This resets each time user clicks "Continue", showing accurate current period
EXTRACT(EPOCH FROM (NOW() - COALESCE(gs.scanning_started_at, gs.start_time)))/60
```

**Why this matters:** Shows actual current scanning period (e.g., "13m") instead of total session time (e.g., "22h 39m")

### 2. **Client-Side Timeout Check**

Added timeout verification in `GoalSessionDashboard.tsx`:

```typescript
// CRITICAL: Check if continuation modal has timed out (client-side safety check)
if (sessionData?.awaiting_continuation_confirmation && sessionData?.continuation_confirmation_expires_at) {
  const expiresAt = new Date(sessionData.continuation_confirmation_expires_at);
  const now = new Date();

  if (now > expiresAt) {
    console.log('[GoalSessionDashboard] ⏰ Continuation modal timeout detected - auto-closing session');
    await simpleScanningTimer.checkModalTimeout(session.sessionId);
    await loadSessionData();
    return;
  }
}
```

**Why this matters:** Provides instant feedback if user has browser tab open, doesn't wait for server processing. Acts as backup protection.

### 3. **Documentation in Autonomous Monitor**

Added comprehensive comments in `autonomous-goal-monitor.ts` explaining:
- Why `awaiting_continuation` must be in processing queue
- The exact order of timeout enforcement checks
- Consequences of removing this status from the query

**Why this matters:** Prevents future developers from accidentally breaking this mechanism again.

## How It Works Now

### Happy Path (User Responds)
1. User starts scanning
2. After 15 minutes, modal shows: "Continue scanning?"
3. User clicks "Continue" within 1 minute
4. Timer resets, scan continues for another 15 minutes
5. Repeat as many times as user wants

### Timeout Path (User Doesn't Respond)
1. User starts scanning
2. After 15 minutes, modal shows: "Continue scanning?"
3. User doesn't respond
4. After 1 minute, session auto-closes
5. Resources freed immediately

### Enforcement Layers

**Layer 1: Server-Side (Primary)**
- Autonomous monitor runs every minute
- Checks all sessions including `awaiting_continuation` status
- Auto-closes if timeout expired

**Layer 2: Client-Side (Backup)**
- Dashboard checks every 3 seconds
- If timeout detected while user has tab open, closes immediately
- Provides instant visual feedback

**Layer 3: Admin Visibility**
- Admin panel shows accurate current period duration
- Can immediately see which sessions are in their 15-minute window
- No more misleading "22h 39m" displays

## Testing

### Verify Fix is Working

1. **Check Admin Panel**
   - Scanning duration should show minutes in current period (e.g., "13m")
   - Not total session time

2. **Test Timeout Enforcement**
   - Start a goal session
   - Wait 15 minutes → modal should appear
   - Don't respond → after 1 minute, session should auto-close

3. **Test Continuation**
   - Start a goal session
   - Wait 15 minutes → modal appears
   - Click "Continue" → timer resets
   - Can repeat indefinitely

### Confirm Database Fix

```sql
-- Verify get_sessions_for_server_processing includes awaiting_continuation
SELECT * FROM get_sessions_for_server_processing();

-- Should return sessions with these statuses:
-- 'scanning', 'initializing', 'trade_pending', 'in_trade', 'soft_closing', 'awaiting_continuation'
```

## User Requirements Met

✅ **15-minute limit enforced:** Users must respond every 15 minutes
✅ **1-minute timeout:** Sessions auto-close if no response
✅ **Unlimited continuations:** Users can click "Continue" as many times as they want
✅ **Accurate visibility:** Admin panel shows current period duration
✅ **No resource waste:** Stuck sessions are immediately cleaned up

## Deployment

1. Database migration applied ✅
2. Client code updated ✅
3. Server function documented ✅

**Next Step:** Deploy to Netlify to activate the fixes in production

```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```

## Prevention

To prevent this bug from reoccurring:
1. Comprehensive code comments explain why `awaiting_continuation` must be included
2. Admin panel now shows accurate duration for visibility
3. Client-side backup check provides redundancy
4. This document explains the architecture for future reference
