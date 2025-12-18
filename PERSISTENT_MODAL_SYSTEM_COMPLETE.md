# Persistent Modal System - Implementation Complete

## Overview

The persistent modal system ensures users never miss important trade decisions, even if they're away from the site when trades close. Modals now persist in the database and display when users return, regardless of how much time has passed.

## Problem Solved

**Before:**
- Trade closes while user's browser is closed/hidden
- Real-time listener only fires if user is actively watching
- User returns to site and sees nothing - no way to make "Continue/Close Session" decision
- Celebration for goal achievement never shown

**After:**
- Trade closes → Modal data saved to database
- User away → Modal waits indefinitely (up to 7 days)
- User returns → Modal appears immediately with "Trade closed X time ago"
- User decides → Modal dismissed, action taken
- Multiple modals → Shown sequentially

## Architecture

### 1. Database Layer

**New Table: `pending_user_modals`**

```sql
CREATE TABLE pending_user_modals (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  goal_session_id UUID,
  modal_type TEXT NOT NULL, -- 'trade_closed', 'goal_achieved', 'session_update'
  modal_data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  dismissed_at TIMESTAMPTZ,
  user_action TEXT -- 'continue', 'close', 'acknowledged'
);
```

**Key Features:**
- Stores complete modal state (symbol, prices, P&L, session info)
- Automatic expiration after 7 days
- Tracks user action when dismissed
- Real-time subscriptions for cross-device sync

**RLS Security:**
- Users can only view their own modals
- Service role can insert (position monitor creates them)
- Users can update/dismiss their own modals

### 2. Modal Queue Manager Service

**File:** `src/services/modal-queue-manager.ts`

**Core Functions:**

```typescript
// Create persistent modal when trade closes
await modalQueueManager.createPendingModal(
  userId,
  goalSessionId,
  'trade_closed',
  {
    symbol: 'GBPUSD',
    profit_loss: -79.93,
    close_reason: 'stop_loss',
    // ... complete trade data
  }
);

// Get all pending modals for user (oldest first)
const modals = await modalQueueManager.getPendingModals(userId);

// Dismiss modal after user interaction
await modalQueueManager.dismissModal(modalId, 'continue');

// Get count for badge display
const count = await modalQueueManager.getPendingModalCount(userId);
```

**Real-time Subscriptions:**
- Subscribes to modal updates per user
- Syncs across multiple devices/tabs
- Auto-refreshes when new modals created

### 3. Position Monitor Integration

**File:** `src/services/position-monitor.ts`

**When trade closes automatically (SL/TP/Goal):**

```typescript
private async autoClosePosition(position, closePrice, reason) {
  // 1. Close trade via RPC
  const result = await positionService.closePosition(...);

  // 2. Send notifications (existing)
  await supabase.from('goal_notifications').insert(...);

  // 3. Create AI conversation message (existing)
  await supabase.from('goal_ai_conversations').insert(...);

  // 4. NEW: Create persistent modal
  await modalQueueManager.createPendingModal(
    position.user_id,
    position.goal_session_id,
    modalType,
    {
      symbol: position.symbol,
      profit_loss: result.pnl,
      close_reason: reason,
      current_progress: cumulativeProfit,
      target_value: session?.target_value,
      // ... all data needed to render modal
    }
  );
}
```

**Modal Types Created:**
- `goal_achieved` - Goal reached (celebration modal)
- `trade_closed` - SL/TP hit (requires user decision)

### 4. App.tsx Integration

**File:** `src/App.tsx`

**On App Load:**

```typescript
useEffect(() => {
  if (!user) return;

  // Check for pending modals immediately
  const checkPendingModals = async () => {
    const modals = await modalQueueManager.getPendingModals(user.id);

    if (modals.length > 0) {
      const modal = modals[0]; // Show oldest first

      if (modal.modal_type === 'trade_closed') {
        globalDialogManager.showTradeClosed({
          ...modal.modal_data,
          timestamp: modal.created_at, // Shows "Trade closed X time ago"
          onContinueSession: async () => {
            await modalQueueManager.dismissModal(modal.id, 'continue');
            checkPendingModals(); // Check for more
          }
        });
      }
    }
  };

  checkPendingModals();

  // Subscribe to real-time updates
  modalQueueManager.subscribeToModalUpdates(user.id, checkPendingModals);
}, [user]);
```

**Real-time Listener Update:**

```typescript
// Only show modal if user is WATCHING
if (document.visibilityState === 'visible') {
  globalDialogManager.showTradeClosed(...);
} else {
  console.log('User away - modal persisted for later');
}
```

### 5. UI Component Updates

**TradeClosedActionDialog Component**

**New Props:**
- `timestamp?: string` - If provided, disables countdown timer

**Behavior:**
- **With timestamp (pending modal):**
  - Shows "Trade closed 2 hours ago" with amber badge
  - No countdown timer (user can take their time)
  - All decision buttons remain active

- **Without timestamp (real-time):**
  - Shows countdown timer "Auto-continue in 5:00"
  - Auto-executes action when timer expires
  - Current behavior unchanged

**Visual Indicator:**

```tsx
{isPendingModal ? (
  <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg py-2 px-3">
    <Clock className="w-4 h-4 text-amber-400" />
    <span className="text-amber-300">
      Trade closed {formatTimeElapsed(timestamp)}
    </span>
  </div>
) : (
  <div>
    Auto-continue in {formatTime(timeRemaining)}
  </div>
)}
```

### 6. Pending Modals Badge

**Component:** `src/components/PendingModalsBadge.tsx`

```tsx
<PendingModalsBadge userId={user.id} />
```

**Features:**
- Shows count of unresolved modals
- Red badge with number (9+ if more than 9)
- Animated bell icon
- Real-time updates via subscription
- Hides when count is 0

## User Experience Flow

### Scenario 1: User Watching Trade

1. Trade hits SL/TP
2. Position monitor closes trade
3. Creates persistent modal (backup)
4. Real-time event fires
5. User sees modal immediately
6. User makes decision
7. Modal dismissed from database

### Scenario 2: User Away During Trade Close

1. Trade hits SL/TP
2. Position monitor closes trade
3. Creates persistent modal
4. Real-time event fires (but user not visible)
5. **User returns 2 hours later**
6. App.tsx checks for pending modals on load
7. Shows modal: "Trade closed 2 hours ago"
8. User makes decision
9. Modal dismissed from database

### Scenario 3: Multiple Trades Closed While Away

1. User away for 8 hours
2. 3 trades close during that time
3. 3 persistent modals created
4. **User returns**
5. Shows modal 1 (oldest): "Trade closed 8 hours ago"
6. User clicks "Continue"
7. Modal 1 dismissed
8. Shows modal 2: "Trade closed 6 hours ago"
9. User clicks "Continue"
10. Modal 2 dismissed
11. Shows modal 3: "Trade closed 2 hours ago"
12. User makes final decision
13. All modals cleared

### Scenario 4: Cross-Device Sync

1. User on Device A: Opens app, sees pending modal
2. User on Device B: Also opens app, sees same modal
3. Device A: Clicks "Continue Session"
4. Modal dismissed from database
5. Device B: Real-time update removes modal
6. Both devices in sync

## Modal Types & Behavior

### Trade Closed (SL/TP)

**Type:** `trade_closed`

**When Created:**
- Stop loss hit
- Take profit hit
- Manual close (future)

**User Actions:**
- "Continue Session" → Dismisses modal, returns to scanning
- "Close Session" → Dismisses modal, stops scanning
- "Close for Now" → Dismisses modal, pauses session

**Persistence:** Required - user must decide next steps

### Goal Achieved

**Type:** `goal_achieved`

**When Created:**
- Goal target reached
- Auto-close executed

**User Actions:**
- "Acknowledge" → Dismisses modal, shows celebration

**Persistence:** Required - user should see celebration even if away

### Session Update (Future)

**Type:** `session_update`

**When Created:**
- Important session changes
- Risk adjustments
- Strategy updates

**Persistence:** Optional based on importance

## Modal Expiration

**Expiration Period:** 7 days

**Behavior:**
- After 7 days, modal expires automatically
- Session auto-closes if no user interaction
- Cleanup function runs periodically

**Expired Modal Message:**
```
"This session expired 7 days ago.
Your trade closed with [result].
The session has been automatically closed."
```

## Database Functions

### Cleanup Expired Modals

```sql
SELECT cleanup_expired_pending_modals();
-- Returns: count of deleted modals
```

**Run via:** Scheduled task or manual cleanup

### Get Pending Count

```sql
SELECT get_pending_modal_count('user-uuid');
-- Returns: integer count
```

**Used by:** Badge component for display

## Security Considerations

1. **RLS Policies:**
   - Users can only see their own modals
   - No cross-user data leakage
   - Service role can insert (position monitor)

2. **Data Validation:**
   - Modal type must be valid enum
   - All required data fields validated
   - Timestamps auto-managed

3. **Real-time Security:**
   - Channel filtered by user ID
   - No unauthorized subscriptions
   - Auto-cleanup on disconnect

## Performance Optimization

1. **Indexes:**
   - `user_id` - Fast user lookup
   - `user_id, dismissed_at` - Fast pending query
   - `goal_session_id` - Session grouping

2. **Query Efficiency:**
   - Single query for pending modals
   - Ordered by `created_at` (oldest first)
   - Filtered for non-expired only

3. **Real-time Subscriptions:**
   - Per-user channels (not global)
   - Auto-unsubscribe on component unmount
   - Debounced updates

## Testing Scenarios

### Test 1: Basic Persistence

1. Start trade
2. Close browser
3. Wait for SL to hit
4. Open browser
5. Verify modal appears with timestamp

### Test 2: Multiple Modals

1. Start multiple trades
2. Close browser
3. Wait for all trades to close
4. Open browser
5. Verify sequential display

### Test 3: Cross-Device Sync

1. Open on Device A
2. Open on Device B
3. Dismiss on Device A
4. Verify disappears on Device B

### Test 4: Expiration

1. Create test modal with 1-minute expiration
2. Wait 1 minute
3. Run cleanup function
4. Verify modal removed

## Files Modified/Created

### New Files
- `src/services/modal-queue-manager.ts` - Core service
- `src/components/PendingModalsBadge.tsx` - Badge UI
- Database migration: `create_persistent_modal_system.sql`

### Modified Files
- `src/services/position-monitor.ts` - Creates modals on close
- `src/App.tsx` - Checks and displays pending modals
- `src/components/TradeClosedActionDialog.tsx` - Timestamp support

### Dependencies
- No new dependencies required
- Uses existing Supabase client
- Uses existing TinyEmitter for events

## Benefits

1. **Never Miss Decisions:**
   - All trade closures captured
   - User always gets to decide next steps
   - No lost context

2. **Better User Experience:**
   - Clear timeline ("2 hours ago")
   - Sequential display of multiple events
   - No pressure from countdown timer

3. **Cross-Device Support:**
   - Same experience on all devices
   - Real-time synchronization
   - Consistent state management

4. **Reliable:**
   - Database-backed persistence
   - Survives app restarts
   - Auto-cleanup of old data

5. **Flexible:**
   - Easy to add new modal types
   - Configurable expiration
   - Extensible data structure

## Future Enhancements

1. **Modal Grouping:**
   - Combine related modals into summary
   - "3 trades closed while away"
   - Single decision for all

2. **Priority System:**
   - High-priority modals shown first
   - Visual priority indicators
   - Different expiration periods

3. **Email Notifications:**
   - Send email if modal pending > 24 hours
   - Include summary in email
   - Link back to site

4. **Analytics:**
   - Track modal response times
   - Identify patterns in away time
   - Optimize expiration periods

## Deployment Checklist

- [x] Database migration applied
- [x] Modal queue manager service created
- [x] Position monitor updated
- [x] App.tsx integration complete
- [x] UI component updates done
- [x] Build successful
- [x] TypeScript errors resolved

## Next Steps

1. Deploy to production
2. Monitor for pending modals in database
3. Collect user feedback on experience
4. Track modal dismissal patterns
5. Optimize expiration periods based on data

---

**Status:** ✅ COMPLETE AND READY FOR PRODUCTION

**Build:** ✅ Successful (no errors)

**Testing:** Ready for QA validation
