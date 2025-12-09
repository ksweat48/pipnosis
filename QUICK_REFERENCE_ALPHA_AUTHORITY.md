# Alpha Authority System - Quick Reference

## What Changed?

### Before
- Risk Omega blocks trades → Alpha never sees them
- Fixed 1.5x ATR stops → Too tight for volatile markets
- Adversarial blocks trades up to 5 candles after stop runs
- Generic UI: "No high-quality setups detected"

### After
- All Omegas advisory → Alpha makes final decision
- Dynamic stops (1.5x - 2.5x ATR) based on volatility
- Adversarial only blocks within 2 candles + extreme conditions
- Detailed UI: Shows exactly why each symbol was rejected

## Decision Flow

```
1. Evaluate 5 symbols (EURUSD, USDJPY, GBPUSD, XAUUSD, US30)

2. Filter out hard blocks:
   ❌ EURUSD: Active stop run 0 candles ago
   ❌ USDJPY: Extreme manipulation spike

3. Remaining symbols go to Omega Council:
   ✅ GBPUSD: Omegas vote → Alpha decides
   ✅ XAUUSD: Omegas vote → Alpha decides
   ✅ US30: Omegas vote → Alpha decides

4. Alpha sees weighted consensus:
   XAUUSD: 4 BUY votes @ 80% weighted score
   Risk advisory: "SL too close to support"

5. Alpha decision:
   "Strong agreement from 4 Omegas. Risk concern valid but
   can be addressed with dynamic SL adjustment to 2.0x ATR.
   Taking trade with 85% confidence."
```

## Weighted Voting

**Weights** (Total: 100%):
- Trend: 20%
- Swing: 20%
- Scalper: 15%
- Reversal: 15%
- Risk: 10% (advisory)
- Volatility: 10%
- OrderFlow: 10%

**Strong Agreement**: 4+ Omegas with 65%+ weighted score → Alpha can override concerns

## Hard Blocks (Critical Only)

### 1. Active Stop Run
- **Condition**: Within 2 candles
- **Why**: Too recent, market unstable
- **Duration**: 3 candles

### 2. Extreme Manipulation Spike
- **Condition**: Within 2 candles AND >3.5x ATR
- **Why**: Extreme volatility, unreliable price action
- **Duration**: 3 candles

### 3. Hard Directional Conflict
- **Condition**: 2+ Omegas from opposing domains disagree at 70%+ confidence
- **Why**: Fundamental disagreement on market direction
- **Resolution**: Wait for clarity

## Dynamic Stop Loss

**Base**: 1.8x ATR

**Adjustments**:
| Condition | Multiplier | Example |
|-----------|-----------|---------|
| Low volatility | 0.83x | 1.5x ATR |
| High volatility | 1.39x | 2.5x ATR |
| High risk regime | 1.30x | 2.3x ATR |
| Moderate adversarial | 1.15x | 2.1x ATR |
| Severe adversarial | 1.30x | 2.3x ATR |

**Minimum R:R**: Always maintains 1.5:1

## UI Messages

### Before
```
All symbols evaluated. No high-quality setups detected. Continuing scan.
```

### After
```
Evaluated 5 symbols: EURUSD, USDJPY, GBPUSD, XAUUSD, US30

❌ EURUSD: BLOCKED - active_stop_run
   → Stop run occurred 0 candle(s) ago - too recent to trust

❌ USDJPY: BLOCKED - severe_manipulation
   → Extreme volatility spike (3.8x ATR, 1 candles ago)

⚠️ GBPUSD: Alpha declined - mixed signals from Omega Council
   → Omega Council: 2 BUY, 2 SELL, 3 NO_TRADE
   → Risk Advisory: SL placement too close to resistance

✅ XAUUSD: Alpha approved - strong bullish consensus
   → Omega Council: 4 BUY, 0 SELL, 3 NO_TRADE
   → Dynamic SL: 2.1x ATR (adjusted for volatility)
   → Entering BUY @ 1.16460 | SL: 1.16380 | TP: 1.16560

No high-quality setups found on remaining symbols. Continuing scan...
```

## Expected Impact

### Trades Taken
- **Before**: 0-1 per hour (overly cautious)
- **After**: 2-4 per hour (balanced approach)

### Win Rate
- **Target**: Maintain 55-65% (quality over quantity)
- **Confidence**: Higher average (Alpha only takes high-conviction setups)

### Risk Management
- **Improved**: Dynamic stops reduce premature stop-outs
- **Maintained**: Hard safety blocks for critical conditions

## Monitoring

Watch for:
1. **Alpha override rate**: Should be 20-30% when strong consensus exists
2. **Dynamic SL effectiveness**: Fewer stop-outs in volatile markets
3. **UI clarity**: Users understand why trades are skipped
4. **Trade frequency**: Should increase by 2-3x while maintaining quality

## Quick Test

To verify system working:
1. Watch for multi-symbol evaluation cycles
2. Check UI for detailed reasoning
3. Verify Alpha makes decisions even when Risk says NO_TRADE
4. Confirm dynamic SL adjustments in logs

---

**Status**: ✅ Deployed to production
**Build**: Successful
**Verification**: Monitor first 24 hours of trading
