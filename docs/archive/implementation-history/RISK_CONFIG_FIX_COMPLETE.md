# Risk Configuration Fix - Complete

## Executive Summary

Fixed critical hardcoded risk values that were preventing goal-based trading from working correctly. The system now properly uses centralized risk configuration with **high risk at 10%**, medium at 5%, and low at 3%.

## What Was Broken

Previously, multiple files had hardcoded risk values that didn't match the centralized config:
- **goal-session-live-engine.ts**: Used 2%, 1%, 0.5% instead of 10%, 5%, 3%
- **currencyHelpers.ts**: Used 2%, 1%, 0.5% instead of 10%, 5%, 3%
- **Pip estimate**: Used hardcoded $1/pip (0.1 lot) instead of actual risk-based sizing

This meant goal-based trades were using tiny lot sizes that would never reach the goal target!

## What Was Fixed

### Fix 1: goal-session-live-engine.ts (Line 2476)
**Before:**
```typescript
const riskPercent = riskMode === 'high' ? 2.0 : riskMode === 'medium' ? 1.0 : 0.5;
```

**After:**
```typescript
const riskPercent = getRiskPercentage(riskMode);
```

### Fix 2: currencyHelpers.ts (Line 437)
**Before:**
```typescript
const riskPercent = riskMode === 'high' ? 2.0 : riskMode === 'medium' ? 1.0 : 0.5;
```

**After:**
```typescript
const riskPercent = getRiskPercentage(riskMode);
```

### Fix 3: Pip Estimate Accuracy (goal-session-live-engine.ts)
**Before:**
```typescript
// Estimate pips needed for typical lot size (0.1 for forex)
const estimatedDollarPerPip = 1.0; // 0.1 lot on forex = $1/pip
const pipsNeededEstimate = Math.abs(remainingGoal / estimatedDollarPerPip);
```

**After:**
```typescript
// Calculate realistic pip estimate based on actual risk-based position sizing
const riskPercent = getRiskPercentage(this.config.riskMode);
const typicalStopLossPips = 30;
const typicalEntryPrice = 1.1000;
const typicalStopLoss = typicalEntryPrice - (typicalStopLossPips * 0.0001);

const estimatedLotSize = calculatePositionSize(
  this.config.symbol || 'EURUSD',
  this.config.initialBalance,
  riskPercent,
  typicalEntryPrice,
  typicalStopLoss
);

const estimatedDollarPerPip = calculateDollarPerPip(this.config.symbol || 'EURUSD', estimatedLotSize);
const pipsNeededEstimate = Math.abs(remainingGoal / estimatedDollarPerPip);
```

### Fix 4: Centralized Risk Config (risk-levels.ts)
Confirmed high risk is set to **10%**:
```typescript
export const RISK_PERCENTAGES = {
  low: 3,      // Conservative: 3% per trade
  medium: 5,   // Moderate: 5% per trade
  high: 10,    // Aggressive: 10% per trade
} as const;
```

## Impact

### Before (with 1% medium risk):
- $5,000 balance with 30-pip SL = 0.17 lots
- Each trade risking only $50 (1%)
- Would need 4 winning trades at 30 pips each to make $200 goal

### After (with 5% medium risk):
- $5,000 balance with 30-pip SL = 0.83 lots
- Each trade risking $250 (5%)
- Would need 1 winning trade at 24 pips to make $200 goal

### With High Risk at 10%:
- $5,000 balance with 30-pip SL = 1.67 lots
- Each trade risking $500 (10%)
- Would need 1 winning trade at 12 pips to make $200 goal

## Files Modified

1. **src/config/risk-levels.ts** - Verified high: 10%
2. **src/services/goal-session-live-engine.ts** - Fixed hardcoded risk, improved pip estimate
3. **src/utils/currencyHelpers.ts** - Fixed hardcoded risk

## Testing

Build successful with no errors:
```
✓ built in 15.04s
```

## Next Steps

1. Deploy to production
2. Monitor goal-based trades to ensure proper lot sizing
3. Verify pip estimates are accurate in UI
4. Check that $200 goals are achievable with realistic pip targets

## Deployment

Ready to deploy:
```bash
curl -X POST -d '{}' https://api.netlify.com/build_hooks/68965660f2a0a7d94873ccca
```
