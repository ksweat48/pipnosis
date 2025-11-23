# LLM Trading Diagnostic - Quick Start

## The Issue
Auto-backtest shows **0 trades** consistently.

## The Fix
We've added comprehensive diagnostic logging to identify exactly where trades are being blocked.

---

## How to Diagnose (2 Minutes)

### 1. Open Browser Console
- Press **F12** in Chrome/Edge
- Click **Console** tab
- Keep it visible

### 2. Run Backtest
- Go to `/admin/ai-training`
- Click **Stop & Reset**
- Click **Start**
- Watch console output

### 3. Look for These Patterns

#### ✅ GOOD - Triggers Being Detected
```
[Event Engine] 🎯 5 trigger(s) detected! Top: momentum_breakout (72%)
[Event Engine] ✅ Trigger validated: momentum_breakout (72%)
[Event Engine] 🚀 Calling 5-Layer LLM Pipeline...
```

#### ❌ BAD - No Triggers Found
```
[Event Engine] 📊 No triggers detected (EURUSD @ ...)
[Event Engine] 📊 No triggers detected (EURUSD @ ...)
[Event Engine] 📊 No triggers detected (EURUSD @ ...)
```
**→ Problem**: Trigger detection too strict OR no market data

---

#### ✅ GOOD - LLM Pipeline Executing
```
[LAYER 1] 🔍 Regime Validation...
[LAYER 1] ✅ PASSED - bullish/medium
[LAYER 2] 📊 Setup Quality Scoring...
[LAYER 2] ✅ PASSED - Quality 75/100
[LAYER 3] ⚠️ Mistake Prevention...
[LAYER 3] ✅ PASSED - Risk: MEDIUM
[LAYER 5] ✅ BUY
```

#### ❌ BAD - Rejected at Layer 1
```
[LAYER 1] ❌ REJECTED: Market regime is sideways
```
**→ Problem**: Regime validator too strict

#### ❌ BAD - Rejected at Layer 2
```
[LAYER 2] ❌ REJECTED: Quality 58/100
```
**→ Problem**: Setup quality threshold too high

#### ❌ BAD - Rejected at Layer 3
```
[LAYER 3] ❌ HIGH RISK - Mistake prevention triggered
```
**→ Problem**: Historical pattern blocking trades

---

#### ✅ GOOD - Trade Executed
```
[LLM Backtest] ✅ TRADE #1 EXECUTED
  Direction: BUY
  Entry: 1.08456
  Confidence: 68%
  Trigger Type: momentum_breakout
```

---

## Quick Diagnosis Checklist

After running ONE backtest day, check:

- [ ] **Triggers detected?** → Look for "🎯 trigger(s) detected"
  - **YES**: Good, proceed to next check
  - **NO**: Trigger detection is the problem

- [ ] **LLM pipeline called?** → Look for "🚀 Calling 5-Layer LLM Pipeline"
  - **YES**: Good, proceed to next check
  - **NO**: Check if LLM is enabled or API key is missing

- [ ] **Which layer is rejecting?** → Look for first "❌ REJECTED"
  - **Layer 1**: Regime validator issue
  - **Layer 2**: Setup quality issue
  - **Layer 3**: Mistake prevention issue
  - **Layer 5**: Execution brain too conservative

- [ ] **Any trades executed?** → Look for "✅ TRADE #X EXECUTED"
  - **YES**: System working! May just need more triggers
  - **NO**: Apply fix for the blocking layer

---

## Common Fixes

### Problem: No Triggers Detected
```
[Event Engine] 📊 No triggers detected
```
**Quick Fix**: Lower trigger confidence thresholds
- Check market data exists for the symbol/timeframe
- Verify candles are being loaded

---

### Problem: All Rejected at Layer 1 (Regime)
```
[LAYER 1] ❌ REJECTED: Sideways regime
```
**Quick Fix**: Check if LLM is actually being called
- Look for "LLM disabled or no API key" message
- Verify OPENAI_API_KEY is set in Netlify

---

### Problem: All Rejected at Layer 2 (Quality)
```
[LAYER 2] ❌ REJECTED: Quality 58/100
```
**Quick Fix**: Lower quality threshold
- Default is 65, may be too high for learning phase
- Consider starting at 55-60

---

### Problem: All Rejected at Layer 3 (Mistakes)
```
[LAYER 3] ❌ HIGH RISK - Pattern matches losses
```
**Quick Fix**: Clear historical pattern data
- Historical losses may be blocking all trades
- System needs fresh data to learn

---

## Database Diagnostic (Optional)

If console doesn't show the issue clearly, run this query in Supabase SQL Editor:

```sql
-- Shows where trades are failing
SELECT
  abort_layer,
  abort_reason,
  COUNT(*) as occurrences
FROM llm_pipeline_execution_log
WHERE created_at > NOW() - INTERVAL '1 hour'
  AND abort_layer IS NOT NULL
GROUP BY abort_layer, abort_reason
ORDER BY occurrences DESC;
```

Result shows:
- **Layer 1**: Regime issues
- **Layer 2**: Quality issues
- **Layer 3**: Mistake prevention issues
- **abort_reason**: Exact explanation

---

## What to Report

If still stuck, provide:

1. **Console output** from one backtest (copy/paste or screenshot)
2. **First "❌ REJECTED" message** you see
3. **Progress line** showing trigger/trade counts:
   ```
   [LLM Backtest] Progress: 950/950 candles | Triggers: 42 | LLM Calls: 38 | Trades: 0
   ```

The issue will be immediately obvious from these logs!

---

## Expected Healthy Output

```
[LLM Backtest] === EVENT-BASED LLM BACKTEST STARTING ===
[LLM Backtest] ✓ Developer mode enabled for diagnostic logging
[LLM Backtest] ✓ Event engine initialized with 5-layer pipeline
[LLM Backtest] Starting candle processing loop (950 candles)...

[Event Engine] 🎯 2 trigger(s) detected! Top: vwap_bounce (68%)
[Event Engine] 🚀 Calling 5-Layer LLM Pipeline...
[LAYER 1] ✅ PASSED - bullish/medium
[LAYER 2] ✅ PASSED - Quality 72/100
[LAYER 3] ✅ PASSED - Risk: MEDIUM
[LAYER 4] ✅ 68% → 65% (-3.0%)
[LAYER 5] ✅ SELL

[LLM Backtest] ✅ TRADE #1 EXECUTED
  Direction: SELL
  Entry: 1.08456
  Confidence: 65%

[LLM Backtest] Progress: 100/950 | Triggers: 8 | LLM Calls: 6 | Trades: 1
[LLM Backtest] Progress: 200/950 | Triggers: 15 | LLM Calls: 11 | Trades: 2
...
[LLM Backtest] Progress: 950/950 | Triggers: 78 | LLM Calls: 62 | Trades: 12

[LLM Backtest] === EVENT-BASED LLM BACKTEST COMPLETE ===
[LLM Backtest] Trades Executed: 12
[LLM Backtest] Win Rate: 58.33%
[LLM Backtest] Profit Factor: 1.85
```

---

## Next Steps

1. ✅ **Run one backtest with console open**
2. ✅ **Find first rejection message**
3. ✅ **Apply appropriate fix**
4. ✅ **Re-test**

The diagnostic logging will make the issue crystal clear!
