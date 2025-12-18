# Persistent Modal System - Quick Start Guide

## What Changed?

Trade closure modals now persist in the database. If a trade closes while you're away, the modal will appear when you return - even hours or days later.

## Key Features

### 1. Modals That Persist
- Stop Loss hit
- Take Profit hit
- Goal achieved
- Manual close (future)

### 2. Modals That Don't Persist
- Trade execution countdowns (auto-execute)
- Scanning notifications with timers
- Auto-actions that don't need user input

## How It Works

### When User is Watching
```
Trade closes → Modal appears immediately → User decides → Done
```

### When User is Away
```
Trade closes → Modal saved to database → User returns later →
Modal appears with timestamp → User decides → Done
```

## Visual Differences

### Real-time Modal (user watching)
```
┌────────────────────────────────┐
│   Stop Loss Hit                │
│                                │
│ Auto-continue in 5:00          │
│                                │
│ [Continue] [Close Session]     │
└────────────────────────────────┘
```

### Persistent Modal (user away)
```
┌────────────────────────────────┐
│   Stop Loss Hit                │
│                                │
│ ⏰ Trade closed 2 hours ago    │
│                                │
│ [Continue] [Close Session]     │
└────────────────────────────────┘
```

## Database

### Check Pending Modals
```sql
SELECT * FROM pending_user_modals
WHERE user_id = 'user-uuid'
AND dismissed_at IS NULL;
```

### Get Count
```sql
SELECT get_pending_modal_count('user-uuid');
```

### Cleanup Expired
```sql
SELECT cleanup_expired_pending_modals();
```

## Code Usage

### Create Modal (Position Monitor)
```typescript
import { modalQueueManager } from '@/services/modal-queue-manager';

await modalQueueManager.createPendingModal(
  userId,
  goalSessionId,
  'trade_closed',
  {
    symbol: 'GBPUSD',
    profit_loss: -79.93,
    close_reason: 'stop_loss',
    // ... other data
  }
);
```

### Check for Pending Modals (App)
```typescript
const modals = await modalQueueManager.getPendingModals(user.id);

if (modals.length > 0) {
  // Show oldest modal first
  showModal(modals[0]);
}
```

### Dismiss Modal
```typescript
await modalQueueManager.dismissModal(modalId, 'continue');
```

### Get Badge Count
```typescript
const count = await modalQueueManager.getPendingModalCount(userId);
```

## Testing

### Test 1: Basic Flow
1. Start a trade
2. Close browser completely
3. Wait for SL to hit (or manually close in database)
4. Open browser
5. Should see modal with "Trade closed X time ago"

### Test 2: Multiple Modals
1. Close 3 trades while browser closed
2. Open browser
3. Should see modals one at a time, oldest first
4. Each decision shows next modal

### Test 3: Real-time vs Persistent
1. Keep browser open
2. Trade closes
3. Should see modal immediately with countdown
4. Close and reopen browser
5. Should see persisted modal without countdown

## Important Notes

1. **No Countdown for Old Modals:** Persistent modals don't have countdown timers. User can take their time deciding.

2. **Sequential Display:** Multiple pending modals show one at a time, oldest first.

3. **Cross-Device Sync:** Dismissing on one device removes modal on all devices.

4. **Auto-Expiration:** Modals expire after 7 days. Session auto-closes if expired.

5. **No Duplicates:** Real-time listener checks if user is visible before showing modal to avoid duplicates.

## Troubleshooting

### Modal Not Appearing
- Check `pending_user_modals` table
- Verify `dismissed_at` is NULL
- Check console for errors
- Verify user_id matches

### Duplicate Modals
- Should not happen - real-time checks `document.visibilityState`
- If occurs, check browser visibility API support

### Modal Queue Stuck
- Check for JavaScript errors in console
- Verify real-time subscription connected
- Try refreshing browser

### Old Modals Not Cleaning Up
- Run cleanup function manually:
  ```sql
  SELECT cleanup_expired_pending_modals();
  ```

## Architecture Files

### Core Service
- `src/services/modal-queue-manager.ts` - Main service

### Components
- `src/components/TradeClosedActionDialog.tsx` - Modal UI
- `src/components/PendingModalsBadge.tsx` - Badge display

### Integration Points
- `src/services/position-monitor.ts` - Creates modals
- `src/App.tsx` - Displays pending modals

### Database
- `pending_user_modals` table
- `cleanup_expired_pending_modals()` function
- `get_pending_modal_count()` function

## Quick Commands

### Check for User's Pending Modals
```sql
SELECT
  modal_type,
  created_at,
  modal_data->>'symbol' as symbol,
  modal_data->>'close_reason' as reason,
  modal_data->>'profit_loss' as pnl
FROM pending_user_modals
WHERE user_id = 'user-uuid'
AND dismissed_at IS NULL
ORDER BY created_at ASC;
```

### Manually Dismiss All User Modals (Testing)
```sql
UPDATE pending_user_modals
SET dismissed_at = NOW(), user_action = 'test'
WHERE user_id = 'user-uuid'
AND dismissed_at IS NULL;
```

### Count Pending by User
```sql
SELECT user_id, COUNT(*) as pending
FROM pending_user_modals
WHERE dismissed_at IS NULL
GROUP BY user_id
ORDER BY pending DESC;
```

### Check Expiring Soon
```sql
SELECT
  user_id,
  modal_type,
  created_at,
  expires_at
FROM pending_user_modals
WHERE dismissed_at IS NULL
AND expires_at < NOW() + INTERVAL '1 day'
ORDER BY expires_at ASC;
```

## Success Criteria

- [x] Build passes without errors
- [x] TypeScript compilation successful
- [x] Database migration applied
- [x] Modal queue manager service created
- [x] Position monitor creates modals on close
- [x] App.tsx checks for pending modals on load
- [x] TradeClosedActionDialog shows timestamp
- [x] Real-time listener checks visibility
- [x] Pending badge component created

**Status:** ✅ READY FOR DEPLOYMENT
