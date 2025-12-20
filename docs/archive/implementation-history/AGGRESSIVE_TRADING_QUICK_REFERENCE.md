# Aggressive Trading Mode - Quick Reference

## What Changed

**PROBLEM:** Alpha was blocking your trades even though 6 Omegas said BUY and only 1 said SELL.

**SOLUTION:** Alpha now respects your AGGRESSIVE personality and takes majority-consensus trades.

---

## How It Works Now

### Aggressive Mode Activation
```
✅ Personality: AGGRESSIVE
✅ Trader Score: ≥80
✅ Risk Mode: HIGH
```

### What Happens With Conflicts

**Scenario:** 6 Omegas say BUY (75%+), 1 says SELL (75%+)

#### Old Behavior (BLOCKED)
```
🚫 TRADE BLOCKED - HARD conflict
Result: NO_TRADE
```

#### New Behavior (TRADES WITH PENALTY)
```
🔥 AGGRESSIVE MODE OVERRIDE
✅ Takes BUY trade
📉 Confidence: 85% → 72% (-15% penalty)
```

---

## Confidence Penalties

### Overwhelming Majority (5+ vs 1)
- **Standard:** 🚫 BLOCKED
- **Aggressive:** ✅ -15% confidence

### Single Disagreement
- **Standard:** -20% confidence
- **Aggressive:** -12% confidence

### Similar Domain Disagreement
- **Standard:** -15% confidence
- **Aggressive:** -8% confidence

### Low Confidence Disagreement
- **Standard:** -10% confidence
- **Aggressive:** -5% confidence

---

## Real Example

### XAUUSD Today
```
BUY Votes:
✅ Trend (85%)
✅ Scalper (85%)
✅ Swing (75%)
✅ Volatility (75%)
✅ Risk (75%)
✅ OrderFlow (75%)

SELL Votes:
❌ Reversal (75%)

Old System: 🚫 BLOCKED
New System: ✅ BUY @ 72% confidence
```

---

## When Does It Still Block?

**HARD BLOCKS still happen when:**
1. ≥2 Omegas on each side with 70%+ confidence
2. From conflicting domains (Trend vs Reversal, etc.)
3. NOT an overwhelming majority

**Example that would STILL block:**
```
BUY: Trend (85%), Swing (80%)
SELL: Reversal (85%), OrderFlow (80%)
Result: 🚫 BLOCKED (evenly split)
```

---

## Console Output to Look For

### Aggressive Override Active
```
[Omega Conflict] 🔥 AGGRESSIVE MODE OVERRIDE: 6 vs 1
[Omega Conflict] Personality: AGGRESSIVE | Score: 100
[Omega Conflict] Taking BUY with reduced confidence
```

### Personality-Aware Soft Conflict
```
[Omega Conflict] SOFT conflict (AGGRESSIVE)
[Omega Conflict] Applying 0.88x confidence penalty
```

---

## Your Current Settings

Check in Settings page:
- Personality: AGGRESSIVE ✅
- Trader Score: 100/100 ✅
- Risk Mode: HIGH ✅

**All conditions met** - aggressive mode is ACTIVE.

---

## Next Steps

1. **Wait for next scan** (XAUUSD, US30, EURUSD)
2. **Watch for 5+ vs 1 vote scenarios**
3. **Verify trades execute** instead of being blocked
4. **Monitor confidence adjustments** in logs

Your Alpha Brain now **respects your risk tolerance** and **follows majority consensus** when appropriate.
