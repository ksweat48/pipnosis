# Continuation Dialog Flow - Quick Reference

## What Changed?

### OLD (Wrong):
❌ Trade opens → Dialog appears immediately
❌ User clicks "Continue" just to monitor the position
❌ Confusing and annoying

### NEW (Correct):
✅ Trade opens → System monitors silently
✅ Trade closes → Check if goal met
✅ Goal met? Celebrate! No dialog needed
✅ Goal not met? Show dialog asking what to do next

---

## Single-Trade Mode Flow

```
Step 1: Trade Execution
├─ Trade opens
├─ System monitors position
└─ No interruption!

Step 2: Trade Closure
├─ Trade hits TP or SL
├─ Check goal progress
└─ Decision point:
    ├─ Goal MET? → 🎉 Celebrate → Stop session
    └─ Goal NOT met? → Show dialog

Step 3: User Decision (if goal not met)
├─ Continue → Resume scanning for next trade
├─ Wait → Stop scanning, just monitor
└─ Stop → End session completely
```

---

## Dialog Appears Only When:

1. ✅ Trade has CLOSED (not opening)
2. ✅ Single-trade mode is enabled (toggle OFF)
3. ✅ Goal is NOT yet achieved
4. ✅ User needs to decide next action

## Dialog NEVER Appears When:

1. ❌ Trade just opened (monitor it first!)
2. ❌ Multi-trade mode enabled (auto-continues)
3. ❌ Goal already achieved (celebrate instead!)

---

## Example Scenarios

### Scenario A: Winning Trade, Goal Not Met

```
💰 Your Trade:
   Entry: 1.2500 → Exit: 1.2550 (TP hit)
   P&L: +$45.00

📊 Session:
   Progress: $145 / $500
   Remaining: $355 to goal

❓ Dialog appears:
   "✅ Trade #3 closed with WIN
    Continue scanning for another trade?"
```

### Scenario B: Losing Trade, Goal Not Met

```
💰 Your Trade:
   Entry: 1.2500 → Exit: 1.2475 (SL hit)
   P&L: -$25.00

📊 Session:
   Progress: $75 / $500
   Remaining: $425 to goal

❓ Dialog appears:
   "❌ Trade #2 closed with LOSS
    Continue scanning for another trade?"
```

### Scenario C: Goal Achieved!

```
💰 Your Trade:
   Entry: 1.2500 → Exit: 1.2600 (TP hit)
   P&L: +$175.00

📊 Session:
   Progress: $525 / $500 ← Goal exceeded!

🎉 NO DIALOG! Instead:
   "🎉🎉🎉 GOAL ACHIEVED! 🎉🎉🎉
    Target: $500
    Achieved: $525
    Congratulations!"

   Session automatically stops
```

---

## Button Actions

### Continue Scanning
- Clears the dialog
- Resumes autonomous scanning
- Looks for next trade opportunity
- Open positions still monitored

### Wait & Watch
- Closes the dialog
- Stops scanning for new trades
- Only monitors existing positions
- Conservative choice

### Stop Session
- Ends the entire goal session
- Closes all positions
- Saves all data
- You're done!

---

## Multi-Trade Mode (No Dialog)

When multi-trade toggle is ON:
- Trades open and close automatically
- No user intervention needed
- Fully autonomous
- Dialog never appears

---

## Key Takeaway

**The dialog is your decision point AFTER seeing the trade result.**

Not before! You need to see if the trade won or lost before deciding whether to continue.

---

**Updated:** 2025-12-10
