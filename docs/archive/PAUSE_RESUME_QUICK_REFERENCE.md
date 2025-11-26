# Auto-Backtest Pause/Resume - Quick Reference

## Three-Button System

### When RUNNING
```
[Pause] [Stop & Reset]
```
- **Pause**: Yellow button - saves position
- **Stop & Reset**: Red button - clears everything

### When PAUSED
```
[Resume] [Stop & Reset]
```
- **Resume**: Green button - continues from saved position
- **Stop & Reset**: Red button - clears everything

### When STOPPED
```
[Start Auto-Backtest]
```
- **Start**: Green button - begins from Month 1 Day 1

## What Each Button Does

### Pause Button
- ⏸️ Stops processing
- 💾 Saves current position (Month X, Day Y)
- 🔒 Preserves all progress
- ⏰ Can resume anytime (hours/days/weeks later)
- 🌐 Works across devices

### Resume Button
- ▶️ Continues from saved position
- 📍 Picks up at exact month/day
- 🚀 No data lost
- ✅ Same progress continues

### Stop & Reset Button
- ⏹️ Stops processing
- 🗑️ Clears ALL progress
- 🔄 Resets to Month 1 Day 1
- ⚠️ Requires confirmation
- ❌ Cannot be undone

## Visual Indicators

| State | Icon | Color | Message |
|-------|------|-------|---------|
| Running | 🟢 Activity (pulsing) | Green | "Running: Month X - Day Y/30" |
| Paused | 🟡 Pause | Yellow | "Paused at Month X - Day Y/30" |
| Stopped | ⚫ None | Gray | "Auto-backtest is not running" |

## Common Workflows

### Pause for Break
```
1. Click [Pause]
2. Close browser
3. Come back later
4. Click [Resume]
5. Continues exactly where you left off
```

### Start Fresh
```
1. Click [Stop & Reset]
2. Confirm "Yes, clear progress"
3. Click [Start Auto-Backtest]
4. Begins from Month 1 Day 1
```

### Switch Devices
```
1. Desktop: Click [Pause]
2. Close desktop
3. Mobile: Open app
4. See "Paused at Month X Day Y"
5. Click [Resume]
6. Continues on mobile
```

## Database State

| State | is_running | is_paused | month | day | Meaning |
|-------|-----------|-----------|-------|-----|---------|
| Running | true | false | X | Y | Active processing |
| Paused | false | true | X | Y | Saved position |
| Stopped | false | false | 0 | 0 | Ready for fresh start |

## Key Differences

### Pause vs Stop & Reset

| Feature | Pause | Stop & Reset |
|---------|-------|-------------|
| Saves position | ✅ Yes | ❌ No |
| Can resume | ✅ Yes | ❌ No (starts from beginning) |
| Keeps progress | ✅ Yes | ❌ No |
| Requires confirmation | ❌ No | ✅ Yes |
| Use when | Taking a break | Want to start over |

## Confirmation Dialogs

### Stop & Reset Confirmation
```
"Are you sure you want to STOP and RESET?

This will clear all progress and start from Month 1 Day 1 next time.

(Use PAUSE to keep your progress instead)"

[Cancel] [Confirm]
```

## Console Messages

### Pause
```
[Auto-Backtest] ⏸️ Pausing at Month 2, Day 15
[Auto-Backtest] ✅ Paused - position saved
```

### Resume
```
[Auto-Backtest] ▶️ Resuming from paused state...
[Auto-Backtest] Resuming from Month 2, Day 15
```

### Stop & Reset
```
[Auto-Backtest] 🛑 Stopping and resetting
[Auto-Backtest] Clearing all progress
[Auto-Backtest] ✅ Progress cleared
```

## Tips

💡 **Use Pause when:**
- Taking a lunch break
- Closing for the day
- Switching devices
- Testing other features
- Monitoring progress

💡 **Use Stop & Reset when:**
- Want to start completely fresh
- Testing new strategies
- Clearing old data
- Changing approach

💡 **Best Practices:**
- Always pause instead of stop if you want to keep progress
- Check the "Paused at" message to confirm saved position
- Use Stop & Reset only when you're sure (it's permanent!)

## Troubleshooting

**Q: I paused but can't find resume button**
A: Refresh the page - state is saved in database

**Q: Resume button doesn't work**
A: Check console for errors, may need to stop & start fresh

**Q: Lost my progress after stopping**
A: Stop & Reset clears progress - use Pause next time

**Q: Can I resume on different device?**
A: Yes! State is saved to database, works across devices

**Q: How long can I stay paused?**
A: Indefinitely - position saved until you resume or reset

---

**Status:** ✅ Production Ready
**Build:** ✅ Successful
**Migration:** ✅ Applied

**Quick Test:**
1. Start auto-backtest
2. Wait for Day 3
3. Click Pause
4. Refresh page
5. Click Resume
6. Should continue from Day 3
