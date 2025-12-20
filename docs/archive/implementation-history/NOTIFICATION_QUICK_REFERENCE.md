# Notification System - Quick Reference

## What Was Fixed

The notification system was completely broken. Now it works perfectly!

### The Problem
- Database had field `notification_type`, code used `type` → **MISMATCH**
- Mid-trade notifications were blocked by CHECK constraint → **REJECTED**
- Badge always showed 0 → **BROKEN QUERIES**
- Panel showed infinite loading → **NO DATA**

### The Solution
✅ Database column renamed to match code
✅ CHECK constraint expanded to allow all notification types
✅ All queries fixed to use correct field name
✅ Pulsing red badge added to both desktop and mobile
✅ Comprehensive logging for debugging

## How to Use

### Desktop
Look for the **bell icon** in the top-right header:
- Red pulsing badge = unread notifications
- Click bell → see all notifications
- Notifications auto-mark as viewed

### Mobile
Look for **"Alerts"** button in bottom navigation:
- 6th button with bell icon
- Pulsing red badge when notifications exist
- Tap to view notification history

## Notification Types

**Goal Mode:**
- 🎯 Trade signals
- 📊 Progress updates
- ⚠️ Alerts
- 🎉 Goal achievements

**Mid-Trade:**
- ⚡ Trigger detected
- 🤖 AI evaluation
- ✅ Action taken

## Where Notifications Appear

1. **Real-time badge** in header/navigation
2. **Notification panel** when you click bell
3. **Console logs** for debugging

## Console Commands (Debug)

```javascript
// Check if notifications are being created
// Look for: [Goal Live Engine] ✓ Inserted mid_trade_trigger notification

// Check if realtime is working
// Look for: [App] Notification received: { type: '...', id: '...' }

// Check badge count loading
// Look for: [Notification Queue] Unviewed count loaded: X
```

## Common Issues

### Badge shows 0 but notifications exist
- Check console for errors
- Verify active goal session exists
- Refresh page

### Notifications not appearing in panel
- Check console for loading errors
- Verify you have an active session
- Check if notifications exist in database

### Infinite loading in panel
- Fixed! No longer happens
- If it does occur, check console for query errors

## Quick Test

1. Start a goal session
2. Wait for a trade signal or trigger
3. Look for pulsing red badge
4. Click bell icon
5. See notification details

## Files to Check If Issues Occur

- `src/App.tsx` - Realtime subscription
- `src/services/mid-trade-notification-queue.ts` - Badge logic
- `src/components/NotificationHistoryPanel.tsx` - Panel display
- `src/services/goal-session-live-engine.ts` - Notification creation

## Success Indicators

✅ Red pulsing badge appears
✅ Badge shows correct number
✅ Clicking bell shows notifications
✅ Console logs show notification events
✅ Notifications marked as viewed when opened

---

**Everything should just work now!**
