# US30 P&L Bug - Quick Reference

## The Problem
Your US30 trade showed **$93,551.68** profit instead of **$93.55** - a 1000× error!

## Root Cause
```typescript
// ❌ WRONG (was causing the bug):
const pnl = (exitPrice - entryPrice) * positionSize;

// ✅ CORRECT (now fixed):
const pipDistance = calculatePipDistance(symbol, entryPrice, exitPrice);
const dollarPerPip = calculateDollarPerPip(symbol, positionSize);
const pnl = direction === 'buy' ? pipDistance * dollarPerPip : -pipDistance * dollarPerPip;
```

## Files Changed
1. `src/services/trade-lifecycle-manager.ts` (3 locations)
2. `src/services/local-memory-layer.ts` (1 location)
3. **NEW:** `src/services/pnl-validator.ts` (validation service)
4. **NEW:** `scripts/fix-corrupted-pnl-values.js` (correction script)
5. **NEW:** `src/tests/pnl-calculation-comprehensive.test.ts` (tests)

## Fix Your Account (3 Commands)

```bash
# 1. See what will be fixed (dry run)
node scripts/fix-corrupted-pnl-values.js --dry-run

# 2. Apply the fix
node scripts/fix-corrupted-pnl-values.js

# 3. Verify tests pass
npm test pnl-calculation-comprehensive
```

## Expected Result
- Your corrupted trade: $93,551.68 → $93.55
- Account balance: Corrected automatically
- All future trades: Use correct formula

## Deployment
```bash
npm run build  # ✅ Already passed
# Deploy to production with confidence
```

## Status: 🟢 FIXED
All P&L calculations now use proper currency-aware formulas. Your account will be restored to the correct balance after running the correction script.
