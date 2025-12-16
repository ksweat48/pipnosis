# R:R Debugging Quick Reference

## When You See RR Discrepancy

### What to Do

1. **Open Browser Console** (F12)
2. **Look for these two logs** when trade is created:

---

### Log 1: RR Validation (Green)

```
[RR Validation] EURUSD
  Direction: buy
  Entry:  1.05432
  SL:     1.05232
  TP:     1.06632
  Risk Pips:   20.0
  Reward Pips: 120.0
  R:R Ratio: 1:6.00    <-- This is the MODAL R:R
```

---

### Log 2: Chart Lines (Blue)

```
[Chart Lines] Creating trade lines for EURUSD
  Entry Price: 1.05432
  Stop Loss:   1.05232
  Take Profit: 1.06632
  Chart calculated R:R: 1:5.98    <-- This is the CHART R:R
```

---

## Compare the Two

If modal shows **1:5.97** but chart shows **1:5.23**:

1. **Check Entry Prices** - Are they exactly the same?
2. **Check SL Prices** - Are they exactly the same?
3. **Check TP Prices** - Are they exactly the same?

If prices are different → **Problem: Chart receiving wrong data**

If prices are same but RR different → **Problem: Calculation precision error**

---

## Common Issues

### Issue 1: Precision Loss
```
Modal: TP = 1.06632
Chart: TP = 1.06630  <-- Lost precision!
```
**Solution:** Chart needs to preserve exact database values

### Issue 2: Rounding Errors
```
Risk Pips:   20.0
Reward Pips: 119.4  <-- Should be 120.0
```
**Solution:** Check pip calculation formula

### Issue 3: Wrong Direction
```
⚠️ Warning: Buy trade has SL >= entry (SL should be below entry)
```
**Solution:** Direction or SL price is incorrect

---

## Validation Warnings

If you see warnings in console:

```
[RR Validation] Warnings:
  - Poor R:R (0.85 - risk exceeds reward)
```

This means the validation system caught an issue.

Check the warnings and investigate the root cause.

---

## Screenshot Instructions

If reporting RR discrepancy:

1. Take screenshot of **Modal** showing RR
2. Take screenshot of **Chart** showing lines
3. Take screenshot of **Console logs** showing both RR calculations
4. Send all 3 screenshots

This gives complete visibility into the issue.
