# Session Recovery System - Implementation Complete

## Problem Fixed

Sessions were getting permanently stuck in "awaiting_continuation" status due to database functions referencing columns that don't exist in the `goal_sessions` table.

### Root Cause

Three critical database functions were trying to access non-existent columns:
- `gs.current_pnl` → Column does NOT exist (should calculate from trades)
- `gs.goal_amount` → Column does NOT exist (actual column is `target_value`)
- `gs.end_time` → Column does NOT exist (actual column is `completed_at`)

When these functions failed, sessions couldn't transition out of stuck states, leaving users unable to start new sessions.

## What Was Fixed

### 1. Database Function Repairs (Migration: `fix_session_functions_schema_mismatches`)

Fixed three critical functions:

#### `check_continuation_modal_timeout()`
- **Before**: Referenced `gs.current_pnl` (non-existent)
- **After**: Calculates PnL dynamically from `goal_session_trades` table
- **Impact**: Timeout detection now works correctly

#### `force_close_stale_session()`
- **Before**: Referenced `gs.current_pnl` (non-existent)
- **After**: Calculates PnL dynamically from `goal_session_trades` table
- **Impact**: Manual force close now succeeds

#### `create_session_ended_modal()`
- **Before**: Referenced `gs.current_pnl` and `gs.goal_amount` (non-existent)
- **After**: Uses `target_value` and calculates PnL from trades
- **Impact**: Session ended modals display correctly

### 2. New Recovery Functions (Migration: `create_unstick_session_recovery_system`)

Added two powerful recovery tools:

#### `get_session_health(p_session_id uuid)`
**Purpose**: Diagnostic function to check if a session is stuck

**Returns**:
```json
{
  "session_id": "uuid",
  "status": "awaiting_continuation",
  "is_stuck": true,
  "stuck_reason": "Session stuck in awaiting_continuation for over 5 minutes",
  "can_unstick": true,
  "open_trades": 0,
  "minutes_in_state": 12.5,
  "awaiting_continuation": true,
  "last_updated": "2025-12-28T10:00:00Z"
}
```

**Stuck Detection Logic**:
- Status "awaiting_continuation" for >5 minutes
- Continuation modal expired for >5 minutes
- Status "scanning" or "trade_pending" for >30 minutes

#### `unstick_session(p_session_id uuid)`
**Purpose**: Manually recovers a stuck session

**Safety Features**:
- Only works if no open trades
- Validates session ownership (auth.uid())
- Dismisses all pending modals
- Creates notification for user
- Comprehensive error handling

**Returns**:
```json
{
  "success": true,
  "message": "Session successfully unstuck",
  "session_id": "uuid",
  "previous_status": "awaiting_continuation",
  "new_status": "user_stopped",
  "trades_count": 3,
  "final_pnl": 45.50
}
```

### 3. UI Recovery Button

Added "Force Close" button to `GoalSessionDashboard.tsx`:

**Features**:
- Only visible when session is stuck
- Shows warning banner with stuck details
- Requires confirmation before unsticking
- Displays helpful error messages
- Prevents unsticking with open trades

**Visual Indicators**:
- Orange warning banner when session is stuck
- Button shows stuck reason on hover
- Loading state while recovering
- Toast notifications for success/failure

## How to Use

### For Users

1. **When Your Session is Stuck**:
   - You'll see an orange warning banner at the top of your session dashboard
   - The banner shows why the session is stuck and how long it's been stuck
   - An orange "Force Close" button appears next to "Stop Session"

2. **To Recover**:
   - Click the "Force Close" button
   - Read the confirmation dialog carefully
   - Confirm to unstick the session
   - Wait for success notification
   - Your session will be closed and you can start a new one

3. **Important Notes**:
   - You CANNOT unstick a session with open trades (close them first)
   - All session progress is preserved
   - Trade history remains intact
   - No data loss occurs

### For Developers

#### Check Session Health
```typescript
const { data } = await supabase.rpc('get_session_health', {
  p_session_id: 'session-uuid'
});

if (data?.is_stuck) {
  console.log('Reason:', data.stuck_reason);
  console.log('Can unstick:', data.can_unstick);
}
```

#### Unstick a Session
```typescript
const { data, error } = await supabase.rpc('unstick_session', {
  p_session_id: 'session-uuid'
});

if (data?.success) {
  console.log('Session recovered!');
} else {
  console.error('Failed:', data?.error);
}
```

## Testing Checklist

- [x] Database functions no longer reference non-existent columns
- [x] Sessions can successfully transition out of stuck states
- [x] Manual unstick button appears when session is stuck
- [x] Unstick function validates ownership
- [x] Unstick function prevents action with open trades
- [x] Toast notifications work correctly
- [x] Warning banner displays stuck information
- [x] Build completes without errors
- [x] No TypeScript compilation errors

## Migration Files

1. **20251228111027_fix_session_functions_schema_mismatches.sql**
   - Fixes column references in timeout/force-close functions
   - Adds dynamic PnL calculation

2. **20251228111442_create_unstick_session_recovery_system.sql**
   - Creates `get_session_health()` function
   - Creates `unstick_session()` function
   - Adds monitoring index for stuck sessions

## Impact

### Before
- Sessions stuck in "awaiting_continuation" permanently
- Database errors prevented automatic recovery
- Users couldn't start new sessions
- Manual database intervention required

### After
- Automatic timeout works correctly
- Manual recovery button available
- Clear visual indicators of stuck sessions
- Users can self-recover without support
- No more database intervention needed

## Future Enhancements

Potential improvements for the recovery system:

1. **Automatic Recovery**: Background job to auto-unstick sessions after certain time
2. **Admin Dashboard**: View all stuck sessions across users
3. **Analytics**: Track frequency of stuck sessions to identify patterns
4. **Prevention**: Additional validation to prevent sessions from getting stuck
5. **Notifications**: Push notifications when session gets stuck

## Monitoring

New index added for monitoring:
```sql
CREATE INDEX idx_goal_sessions_stuck_detection
  ON goal_sessions(status, awaiting_continuation_confirmation, updated_at)
  WHERE status IN ('awaiting_continuation', 'scanning', 'trade_pending');
```

This allows efficient queries to find potentially stuck sessions:
```sql
SELECT id, status, updated_at,
       EXTRACT(EPOCH FROM (now() - updated_at))/60 as minutes_stuck
FROM goal_sessions
WHERE status IN ('awaiting_continuation', 'scanning', 'trade_pending')
  AND updated_at < now() - interval '10 minutes'
ORDER BY updated_at ASC;
```

## Summary

The session recovery system is now complete and production-ready. Users have both automatic and manual recovery options, with clear visual feedback and comprehensive error handling. The underlying database functions have been repaired to reference correct columns, eliminating the root cause of stuck sessions.
