# Global Notifications Quick Start Guide

## TL;DR - What Changed

**Before**: Dialogs and notifications only appeared on the AI Trade page.

**After**: All critical notifications appear on **EVERY page** - Charts, Settings, Positions, Admin, anywhere.

---

## Three Types of Global Notifications

### 1. Goal Achievement Dialog (Celebration)
- **Trigger**: When user achieves their goal
- **Appearance**: Full-screen overlay with trophy icon and glow effect
- **Actions**: Start New Session, View Achievements
- **Visibility**: Shows on ANY page user is viewing

### 2. Trade Closed Dialog (Action Required)
- **Trigger**: When a trade closes (SL/TP/Manual)
- **Appearance**: Full-screen overlay with trade results
- **Actions**: Continue Session, Start New Session, Close
- **Visibility**: Shows on ANY page user is viewing

### 3. Trade Signal Notification Bar (Urgent)
- **Trigger**: When Alpha decides to enter a trade
- **Appearance**: Slides in from top of screen
- **Priority Levels**:
  - **RED (High)**: Execute NOW (market order)
  - **YELLOW (Medium)**: Execute within 1 minute
  - **BLUE (Low)**: Execute within 5 minutes
- **Actions**: View Trade (goes to AI Trade page), Dismiss
- **Visibility**: Shows on ANY page user is viewing

---

## How to Test

### Quick Test: Trigger a Trade Signal

1. Open the app on the **Settings page** (not AI Trade)
2. In your database, run:

```sql
INSERT INTO goal_notifications (
  user_id,
  goal_session_id,
  notification_type,
  priority,
  execution_urgency,
  message,
  notification_data
) VALUES (
  '[your-user-id]',
  '[any-session-id]',
  'signal',
  'high',
  NOW() + INTERVAL '1 minute',
  'Test trade signal on EURUSD',
  '{"symbol": "EURUSD", "direction": "BUY", "entry_price": 1.0850, "stop_loss": 1.0820, "take_profit": 1.0910, "confidence": 85, "setup_type": "Breakout", "reasoning": "Test signal for global notifications"}'::jsonb
);
```

3. **Expected Result**: Red notification bar slides in from top, even though you're on Settings page
4. Shows: Symbol, direction, entry, SL, TP, countdown timer
5. Click "View Trade" to navigate to AI Trade page

### Test Goal Achievement

1. Be on **Positions page** or **Charts page**
2. Insert a goal achievement:

```sql
INSERT INTO goal_achievements (
  user_id,
  goal_session_id,
  goal_amount,
  achieved_pnl,
  symbol
) VALUES (
  '[your-user-id]',
  '[session-id]',
  100,
  105,
  'EURUSD'
);
```

3. **Expected Result**: Celebration dialog appears with trophy, even on Positions/Charts page

### Test Trade Closure

1. Be on **Admin Dashboard** or **Settings**
2. Update a trade to closed status:

```sql
UPDATE goal_session_trades
SET status = 'closed',
    exit_price = 1.0910,
    profit_loss = 60,
    close_reason = 'take_profit',
    closed_at = NOW()
WHERE id = '[trade-id]'
AND user_id = '[your-user-id]';
```

3. **Expected Result**: Trade closed dialog appears on Admin page

---

## Priority Levels Explained

### HIGH (Red - Market Execution)
- **When**: Critical opportunities, high confidence setups
- **Urgency**: Execute immediately
- **Behavior**:
  - Pulsing red glow
  - Plays sound
  - Stays until dismissed
  - Cannot auto-dismiss
- **Use Case**: Strong momentum breakout, news-driven move

### MEDIUM (Yellow - 1 Minute)
- **When**: Good setups, moderate confidence
- **Urgency**: Execute within 60 seconds
- **Behavior**:
  - Yellow/orange border
  - Shows countdown timer
  - Dismissible
  - Does not auto-dismiss
- **Use Case**: Standard technical setup, support/resistance bounce

### LOW (Blue - 5 Minutes)
- **When**: Optional trades, exploratory setups
- **Urgency**: Execute within 5 minutes
- **Behavior**:
  - Blue/teal border
  - Shows countdown
  - Auto-dismisses after 30 seconds
  - Easily dismissible
- **Use Case**: Lower conviction trades, training opportunities

---

## For Developers: Integration

### Backend (Edge Functions / Autonomous Systems)

When Alpha decides to enter a trade, write to `goal_notifications`:

```typescript
// In your trading logic
await supabase.from('goal_notifications').insert({
  user_id: userId,
  goal_session_id: sessionId,
  notification_type: 'signal',
  priority: calculatePriority(), // 'low' | 'medium' | 'high'
  execution_urgency: new Date(Date.now() + urgencyMs),
  message: `Trade signal on ${symbol}`,
  notification_data: {
    symbol: 'EURUSD',
    direction: 'BUY',
    entry_price: 1.0850,
    stop_loss: 1.0820,
    take_profit: 1.0910,
    confidence: 85,
    setup_type: 'Breakout',
    reasoning: 'Strong bullish momentum with volume confirmation',
    expected_profit: 150,
    risk_reward: 2.0
  }
});
```

### Frontend (React Components)

Any component can trigger dialogs:

```typescript
import { useGlobalDialog } from '@/hooks/useGlobalDialog';

function MyComponent() {
  const { showTradeSignal, showGoalAchieved } = useGlobalDialog();

  // Trigger trade signal
  const handleSignal = () => {
    showTradeSignal({
      symbol: 'EURUSD',
      direction: 'BUY',
      entryPrice: 1.0850,
      stopLoss: 1.0820,
      takeProfit: 1.0910,
      confidence: 85,
      setupType: 'Breakout',
      reasoning: 'Test signal',
      priority: 'high',
      executionUrgency: Date.now() + 60000
    }, 'high');
  };

  return <button onClick={handleSignal}>Test</button>;
}
```

---

## Database Schema Reference

### goal_notifications Table (Updated)

```sql
CREATE TABLE goal_notifications (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  goal_session_id uuid,
  notification_type text, -- 'signal' | 'forecast' | 'progress' | 'alert'
  priority text, -- 'low' | 'medium' | 'high' | 'urgent'
  execution_urgency timestamptz, -- When to execute by
  acknowledged_at timestamptz, -- When user dismissed
  message text,
  notification_data jsonb,
  created_at timestamptz
);
```

### notification_preferences Table (New)

```sql
CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY,
  user_id uuid UNIQUE REFERENCES auth.users(id),

  -- Sound settings
  enable_sounds boolean DEFAULT true,
  goal_achievement_sound boolean DEFAULT true,
  trade_signal_sound boolean DEFAULT true,

  -- Display settings
  notification_position text DEFAULT 'top', -- 'top' | 'bottom'

  -- Auto-dismiss
  auto_dismiss_low_priority boolean DEFAULT true,
  auto_dismiss_duration_seconds integer DEFAULT 30,

  -- Do Not Disturb
  dnd_enabled boolean DEFAULT false,
  dnd_start_time time,
  dnd_end_time time,

  created_at timestamptz,
  updated_at timestamptz
);
```

---

## Troubleshooting

### Notifications Not Appearing

1. **Check Realtime Connection**
   - Open browser console
   - Look for: `[App] Setting up global event listeners`
   - Should show your user ID

2. **Verify Database Trigger**
   - Insert test notification in database
   - Check if `created_at` timestamp is recent
   - Verify `user_id` matches logged-in user

3. **Check Browser Console**
   - Should see: `[App] Trade signal received!` or similar
   - No errors about Supabase connection

4. **Verify RLS Policies**
   - User must be authenticated
   - RLS policies allow read access to own notifications

### Sound Not Playing

- Browser autoplay policy may block sound
- User must interact with page first (click anywhere)
- Check browser console for audio errors
- Graceful fallback - notification still appears

### Notification Stuck

- Click dismiss button
- Refresh page if needed
- Check `acknowledged_at` in database - should update on dismiss

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  User on ANY Page               │
│            (Charts, Settings, Positions)        │
└─────────────────────────────────────────────────┘
                       ↑
                       │ Dialog/Notification appears
                       │
┌─────────────────────────────────────────────────┐
│          GlobalDialogProvider (App Root)        │
│  • Wraps entire application                     │
│  • Renders dialogs with z-index 9999            │
│  • Manages queue of multiple dialogs            │
└─────────────────────────────────────────────────┘
                       ↑
                       │ Event
                       │
┌─────────────────────────────────────────────────┐
│          Global Dialog Manager Service          │
│  • Event emitter pattern                        │
│  • Queue management                             │
│  • Priority sorting                             │
└─────────────────────────────────────────────────┘
                       ↑
                       │ Trigger
                       │
┌─────────────────────────────────────────────────┐
│         App.tsx Realtime Listeners              │
│  • goal_achievements (INSERT)                   │
│  • goal_session_trades (UPDATE)                 │
│  • goal_notifications (INSERT)                  │
└─────────────────────────────────────────────────┘
                       ↑
                       │ Database event
                       │
┌─────────────────────────────────────────────────┐
│            Supabase Realtime                    │
│  • postgres_changes subscriptions               │
│  • Filtered by user_id                          │
└─────────────────────────────────────────────────┘
```

---

## Next Steps

1. **Test the System**: Use the quick tests above to verify it works
2. **Integrate with Backend**: Update goal-session-scanner to write signals with priority
3. **User Preferences**: Add settings UI for notification preferences
4. **Monitor Performance**: Check console for event timing and queue behavior
5. **Gather Feedback**: See how users respond to different priority levels

---

## Support

- Full documentation: `GLOBAL_NOTIFICATION_SYSTEM_COMPLETE.md`
- Database migration: `add_notification_priorities_and_urgency.sql`
- Source code:
  - Service: `src/services/global-dialog-manager.ts`
  - UI: `src/components/TradeSignalNotificationBar.tsx`
  - Context: `src/hooks/useGlobalDialog.tsx`
  - Integration: `src/App.tsx` (lines 73-238)
