# Regime-to-Zone Integration Fix

**Date**: 2026-01-11
**Priority**: P0 - Critical Bug Fix
**Status**: Deployed

## Critical Bug Identified

**Location**: `src/brains/coordinator-alpha.ts:1939`

### The Problem

MicroRegime classification was being calculated correctly but **NOT passed** to the Entry Intent Classifier, breaking the entire adaptive zone system.

**Before (Broken)**:
```typescript
const entryIntent = await EntryIntentClassifier.classifyEntryIntent(
  decision,
  marketContext,
  votes,
  vwap,
  recentCandles  // ❌ WRONG - passing candles instead of regime
);
```

**After (Fixed)**:
```typescript
const entryIntent = await EntryIntentClassifier.classifyEntryIntent(
  decision,
  marketContext,
  votes,
  vwap,
  microRegime?.regime  // ✅ CORRECT - passing regime string
);
```

## Impact Analysis

### What Was Happening (Broken State)

1. **Regime Detection**: ✅ Working correctly
   - 8 micro-regimes properly classified
   - Confidence modifiers calculated
   - Indicators analyzed (ATR, EMA, RSI, volume, compression)

2. **Zone Selection**: ❌ COMPLETELY BROKEN
   - Regime not passed to classifier
   - Fallback to legacy zone calculation
   - Result: Generic zones not optimized for market behavior

3. **Observable Symptoms**:
   - Extremely wide entry zones (6,000+ pips for BTC)
   - All trades defaulting to "wait for pullback" behavior
   - No differentiation between acceleration vs exhaustion
   - Position sizing not adjusted by reachability

### What Happens Now (Fixed State)

1. **Regime Detection**: ✅ Still working
2. **Zone Selection**: ✅ NOW WORKING
   - Regime properly passed through
   - Adaptive zone system activated
   - Zone type selected based on market behavior

3. **Expected Results**:
   - **Momentum zones**: 2-5 pips (tight, chase price)
   - **Hybrid zones**: 15-25 pips (balanced)
   - **Limit zones**: 20-40 pips (asymmetric around VWAP)
   - Position sizing adjusted by reachability (40%-100%)
   - Auto-downgrade if zones unreachable

## 8 Micro-Regime to Zone Mappings

### MOMENTUM ZONES (Tight, Immediate Execution)

**1. Trend Acceleration → Momentum (90% conf)**
- Strong momentum with expanding ATR
- Very tight zones (max 5 pips)
- Near current price
- Reasoning: "Strong momentum - use tight zones near current price for quick entry"

**2. Stop-Hunt Expansion → Momentum (95% conf)**
- Post-sweep expansion with violent directional move
- Tightest possible zones
- Enter on momentum before cascade completes
- Reasoning: "Post-sweep expansion - enter on momentum before cascade completes"

### LIMIT ZONES (Wait for Pullback to Value)

**3. Trend Exhaustion → Limit (85% conf)**
- Weakening momentum with volume declining
- Wait for pullback to VWAP or EMA50
- Asymmetric zones (wider below anchor for BUY)
- Reasoning: "Weakening momentum - wait for pullback to VWAP or key levels"

**4. Mean Reversion Pocket → Limit (90% conf)**
- Extreme stretch from EMA with RSI extreme
- Enter at mean reversion levels (VWAP, EMA50)
- Price MUST return to value
- Reasoning: "Extreme stretch - enter at mean reversion levels (VWAP, EMA50)"

### HYBRID ZONES (Balanced Approach)

**5. Pre-Break Compression → Hybrid (80% conf)**
- Range tightening before structural break
- Balanced zone for breakout entry
- Reasoning: "Compression before break - balanced zone for breakout entry"

**6. Post-Break Retest → Hybrid (85% conf)**
- Return to broken level for continuation
- Structured entry at support/resistance flip
- Reasoning: "Retest of broken level - structured entry at support/resistance"

**7. Liquidity Vacuum → Hybrid (75% conf)**
- Low volume compression before breakout
- Balanced approach until direction confirmed
- Reasoning: "Low volume compression - balanced approach until direction confirmed"

**8. Neutral Ranging → Hybrid (70% conf)**
- No clear pattern detected
- Default balanced approach
- Reasoning: "No clear pattern - use balanced Hybrid zones for flexibility"

## Reachability System

Once zones are calculated, the reachability gate validates execution feasibility:

### Distance Thresholds
- **< 1.2 ATR**: Zone is reachable, full position size (100%)
- **0.6 - 1.0 ATR**: Zone reachable, reduced size (40%) - "chase cap"
- **> 1.0 ATR**: Zone unreachable, WAIT status (no execution)

### Auto-Downgrade Feature
If `adaptive_zones_enabled` AND `auto_downgrade_enabled`:
1. Momentum zone unreachable → Downgrade to Hybrid
2. Hybrid zone unreachable → Downgrade to Limit
3. Limit zone unreachable → WAIT status

Position size automatically adjusts: 100% → 40% → 0%

## Enhanced Logging

Added comprehensive adaptive zone logging:

```
[Alpha Coordinator] 🎯 Micro-Regime: trend_exhaustion | Direction: bearish | Confidence: 70% | Modifier: -10%
[Alpha Coordinator] 🎯 Adaptive Zones: LIMIT zone for trend_exhaustion regime
[Alpha Coordinator]    Primary Zone: 96500.00000 - 97200.00000
[Alpha Coordinator]    Secondary Zone: 95800.00000 - 96400.00000
[Alpha Coordinator]    Reachability: 107.50 pips from current price
[Alpha Coordinator]    Position Size: 100% of standard size
[Alpha Coordinator]    ⚠️ Zone downgraded due to reachability constraints
```

## Database Fields Populated

The `entry_intents` table now properly populates:

- `micro_regime_used`: The regime string (e.g., "trend_exhaustion")
- `zone_type`: The selected zone type ("momentum", "hybrid", or "limit")
- `primary_zone_min/max`: Primary entry zone boundaries
- `secondary_zone_min/max`: Secondary entry zone boundaries (wider zone, 65% size)
- `zone_reachability_distance_pips`: Distance from current price to zone
- `zone_downgrade_applied`: Boolean if auto-downgrade occurred
- `position_size_multiplier`: 1.0 (full), 0.65 (secondary), or 0.40 (chase)

## Expected User Experience Changes

### Before Fix
- **All trades**: Generic "wait for pullback" behavior
- **Zone widths**: Extremely wide (6,000+ pips)
- **No adaptation**: Same behavior in acceleration vs exhaustion
- **Console logs**: Regime detected but not used

### After Fix
- **Momentum trades**: Tight zones, immediate execution bias
- **Exhaustion trades**: Wait for pullback to VWAP/EMA
- **Zone widths**: Regime-appropriate (2-40 pips)
- **Smart adaptation**: Behavior matches market regime
- **Console logs**: Full transparency of regime → zone → reachability

## Verification Checklist

To verify the fix is working:

1. **Check Console Logs**:
   - ✅ "Micro-Regime: [regime] | Direction: [dir] | Confidence: [%]"
   - ✅ "Adaptive Zones: [zone_type] zone for [regime] regime"
   - ✅ "Primary Zone: [min] - [max]"
   - ✅ "Reachability: [pips] pips from current price"

2. **Inspect Entry Intent Record**:
   ```sql
   SELECT
     micro_regime_used,
     zone_type,
     primary_zone_min,
     primary_zone_max,
     zone_reachability_distance_pips,
     position_size_multiplier
   FROM entry_intents
   ORDER BY created_at DESC
   LIMIT 1;
   ```
   - Should see regime populated
   - Zone type should match expected mapping
   - Zone width should be reasonable (not 6,000 pips)

3. **Monitor Trade Behavior**:
   - Acceleration regimes → Immediate execution or tight chase
   - Exhaustion regimes → Wait for pullback to levels
   - Compression regimes → Balanced approach

## Files Modified

1. **src/brains/coordinator-alpha.ts**
   - Line 1939: Fixed parameter passing to `classifyEntryIntent()`
   - Lines 1947-1956: Added adaptive zone logging

## SSOT Architecture Confirmed

This fix restores the Single Source of Truth for regime-to-zone mapping:

```
MicroRegimeClassifier (SSOT for regime detection)
          ↓
RegimeZoneTypeSelector (SSOT for regime → zone type)
          ↓
AdaptiveEntryZoneCalculator (SSOT for zone math)
          ↓
ZoneReachabilityValidator (SSOT for execution gate)
```

All components were working correctly EXCEPT the connection between Phase 1 (regime detection) and Phase 2 (zone calculation).

## Next Steps

1. **Monitor Production**: Watch for proper regime→zone mapping in logs
2. **Validate Execution**: Verify momentum trades execute quickly, exhaustion trades wait appropriately
3. **Collect Analytics**: Track zone hit rates by regime type for meta-learning
4. **User Feedback**: Ensure zone behavior matches user expectations

## Conclusion

This was a **critical integration bug** that prevented the entire adaptive zone system from functioning. The regime classifier was working perfectly but its output was never connected to the zone calculator.

**Expected Outcome**: Trades will now behave radically different based on detected market regime, with zone widths, entry timing, and position sizing all adapting to market behavior.
