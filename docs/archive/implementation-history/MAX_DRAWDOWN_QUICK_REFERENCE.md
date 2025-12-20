# Max Drawdown & Peak Profit - Quick Reference

## What You'll See

### Recent Closures Display

Each closed position now shows:

```
✓ USDJPY  SELL  0.4 lots
  Closed Dec 15, 01:44 AM • stop_loss

  Final P&L: -$19.83

  Entry → Exit           Max Drawdown    Peak Profit    Pips
  155.085 → 155.135      -$19.83         +$50.00        +0.0
```

## Metrics Explained

### Max Drawdown (Red) 📉
**Definition:** The worst unrealized loss during the trade

**Example:**
- You open USDJPY SELL at 155.085
- Price goes against you to 155.135 (-$19.83 loss)
- That's your max drawdown: **-$19.83**

**Why It Matters:**
- Shows true risk exposure
- Helps evaluate if stop loss placement is adequate
- Identifies if you're comfortable with the drawdown levels

### Peak Profit (Green) 📈
**Definition:** The best unrealized profit reached during the trade

**Example:**
- After opening, price moves in your favor
- At peak, you're up +$50.00
- That's your peak profit: **+$50.00**

**Why It Matters:**
- Shows missed opportunities
- Helps evaluate if you're exiting too late
- Identifies if trailing stops would help

### Your Example Trade Analysis

**USDJPY SELL 0.4 lots**
- Entry: 155.085
- Exit: 155.135
- **Final P&L: -$19.83** (hit stop loss)
- **Max Drawdown: -$19.83** (same as final)
- **Peak Profit: +$50.00** (reached during trade)

**What This Tells You:**
1. At one point, you were up **+$50.00** ✅
2. Price reversed and hit your stop loss at **-$19.83** ❌
3. You had a **$69.83 swing** from peak to final ($50 to -$19.83)
4. This suggests:
   - Consider taking partial profits at +$50
   - Consider tighter take-profit targets
   - Consider trailing stop loss
   - Price reversed sharply after reaching your favor

## Real-Time Tracking

While position is **OPEN**, the system tracks:
- Every 2-3 seconds, checks current P&L
- If worse than previous max drawdown → updates max drawdown
- If better than previous peak profit → updates peak profit

**Console Logs:**
```
[PositionMonitor] 📈 New peak profit: 50.00 (was 45.23)
[PositionMonitor] 📉 New max drawdown: -19.83 (was -15.42)
```

## Display Rules

### Max Drawdown
- **Always shown** when trade is closed
- **Red color** (`text-red-400`)
- Format: `-$19.83`
- Shows "N/A" for old trades (before this update)

### Peak Profit
- **Only shown if > 0** (conditionally displayed)
- **Emerald green** (`text-emerald-400`)
- Format: `+$50.00`
- Hidden if trade never went into profit

### Total Pips
- Shown if tracked and ≠ 0
- Green (positive) or Red (negative)
- Format: `+0.0` or `-5.2`

## Understanding Trade Outcomes

### Scenario 1: Hit Take Profit
```
Final P&L: +$100.00
Max Drawdown: -$15.00
Peak Profit: +$100.00
```
**Interpretation:** Trade went smoothly, small drawdown, reached target

### Scenario 2: Hit Stop Loss (Your Case)
```
Final P&L: -$19.83
Max Drawdown: -$19.83
Peak Profit: +$50.00
```
**Interpretation:** Trade was profitable (+$50) but reversed and hit SL

### Scenario 3: Manual Close in Profit
```
Final P&L: +$45.00
Max Drawdown: -$8.50
Peak Profit: +$75.00
```
**Interpretation:** Exited early, left +$30 on the table (peak was $75)

### Scenario 4: Manual Close at Loss
```
Final P&L: -$25.00
Max Drawdown: -$45.00
Peak Profit: +$20.00
```
**Interpretation:** Trade went to +$20, reversed to -$45, cut loss at -$25

## Files Changed

1. **Position Monitor** (`src/services/position-monitor.ts`)
   - Tracks max values in real-time

2. **Positions Page** (`src/pages/PositionsPage.tsx`)
   - Displays metrics in Recent Closures

## Database Columns

**Table:** `goal_session_trades`
- `max_drawdown` - Numeric, defaults to 0
- `max_profit` - Numeric, defaults to 0
- `total_pips` - Numeric, defaults to 0

## How to Test

1. **Open a new position**
   - Watch it move in and out of profit
   - Check console for tracking logs

2. **Close the position**
   - Go to Positions page
   - Scroll to Recent Closures
   - Verify metrics display

3. **Look for:**
   - Max Drawdown in red
   - Peak Profit in green (if it went into profit)
   - Entry → Exit prices
   - Final P&L

## Quick Tips

### Use This Data To:
1. **Optimize Take Profit:** If peak profit >> final P&L, tighten TP
2. **Adjust Stop Loss:** If max drawdown is uncomfortable, widen SL or reduce lot size
3. **Evaluate Exits:** Compare peak to final to see if exit timing is good
4. **Train AI Better:** System learns from these metrics for future trades

### What Good Trades Look Like:
- **Max Drawdown:** Small (< $20)
- **Peak Profit:** Close to Final P&L (didn't give back much)
- **Final P&L:** Positive

### What to Improve When:
- **Peak Profit >> Final P&L:** Exit too late, consider take profit rules
- **Max Drawdown is large:** Stop loss too wide, or position size too big
- **Never reached profit (no peak profit):** Entry timing needs work

## Color Guide

| Metric | Color | Meaning |
|--------|-------|---------|
| Final P&L (positive) | Green | Trade won |
| Final P&L (negative) | Red | Trade lost |
| Max Drawdown | Red/Orange | Risk exposure |
| Peak Profit | Emerald | Best opportunity |
| Entry/Exit | White | Price levels |

## Next Steps

After deployment completes:
1. Open a new position
2. Watch it for a few minutes as price moves
3. Close it (or let it hit SL/TP)
4. Check Recent Closures section
5. Analyze your max drawdown and peak profit

## Questions?

**Q: Why don't I see peak profit on some trades?**
A: It only shows if the trade went into profit (> $0)

**Q: Why do old trades show "N/A"?**
A: Trades closed before this update don't have these metrics tracked

**Q: Can I see this on open positions?**
A: Not yet in UI, but it's being tracked in real-time (check console logs)

**Q: What if max drawdown equals final P&L?**
A: Trade closed at its worst point (likely hit stop loss without recovery)

---

**Deployed:** December 16, 2025
**Status:** ✅ Live in Production
