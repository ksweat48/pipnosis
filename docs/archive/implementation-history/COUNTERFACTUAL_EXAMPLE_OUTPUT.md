# 🧠 Counterfactual Engine - Example Console Output

## 📊 **Example 1: Winning Trade That Could Have Been Better**

```
[Trade Lifecycle] Closing trade e7f3a8d2 on EURUSD: Take profit hit
[Trade Lifecycle] 🧠 Starting counterfactual analysis for EURUSD...

[Counterfactual] 🧠 Replaying trade e7f3a8d2 in 12 alternate timelines...
[Counterfactual] Analyzing 87 candles between 2025-11-30 10:15:00 and 2025-11-30 14:45:00
[Counterfactual] Market regime: bull | Volatility: low

[Counterfactual] Simulating 4 SL variants...
  - SL tighter by 30% (0.7x): Would hit SL → -$30 (worse by $150)
  - SL tighter by 15% (0.85x): Would hit SL → -$30 (worse by $150)
  - SL wider by 15% (1.15x): Would hit TP → +$120 (same as actual)
  - SL wider by 30% (1.30x): Would hit TP → +$120 (same as actual)

[Counterfactual] Simulating 3 TP variants...
  - TP earlier by 30% (0.7x): Would hit TP → +$84 (worse by $36)
  - TP extended by 20% (1.2x): Would hit TP → +$185 (BETTER by $65) ⭐
  - TP extended by 50% (1.5x): Would reverse → +$95 (worse by $25)

[Counterfactual] Simulating 4 risk variants...
  - Risk 1%: Would yield +$60 (worse by $60)
  - Risk 2%: Would yield +$120 (same as actual)
  - Risk 3%: Would yield +$180 (BETTER by $60) ⭐
  - Risk 5%: Would yield +$300 (BETTER by $180) ⭐⭐⭐

[Counterfactual] Simulating early exit on 20% pullback...
  - Early exit: Would exit at +$108 (worse by $12)

[Counterfactual] ✅ Best alternate: Risk 5% (5x position size)
  would yield $300.00 vs actual $120.00 (+$180.00)

[Counterfactual] ✅ Saved 12 counterfactual simulations to database

[Counterfactual Insights] Generating AI summary for trade e7f3a8d2...
[Counterfactual Insights] LLM analysis:
  "Your $120 win could have been $185 with TP extended by 20%.
   In bull trends with low volatility, price often continues past initial targets.
   Recommendation: Extend TP by 20% when EMA50 rising and volatility < 0.15%."

[Counterfactual Insights] ✅ Insights generated and saved

[Trade Lifecycle] ✅ Counterfactual analysis complete for EURUSD
```

---

## 📊 **Example 2: Losing Trade Due to Tight Stop**

```
[Trade Lifecycle] Closing trade b2c4d9a1 on GBPUSD: Stop loss hit
[Trade Lifecycle] 🧠 Starting counterfactual analysis for GBPUSD...

[Counterfactual] 🧠 Replaying trade b2c4d9a1 in 12 alternate timelines...
[Counterfactual] Analyzing 45 candles between 2025-11-30 09:00:00 and 2025-11-30 10:30:00
[Counterfactual] Market regime: sideways | Volatility: high

[Counterfactual] Simulating 4 SL variants...
  - SL tighter by 30% (0.7x): Would hit SL → -$40 (worse by $10)
  - SL tighter by 15% (0.85x): Would hit SL → -$30 (same as actual)
  - SL wider by 15% (1.15x): Would hit TP → +$60 (BETTER by $90) ⭐⭐⭐
  - SL wider by 30% (1.30x): Would hit TP → +$60 (BETTER by $90) ⭐⭐⭐

[Counterfactual] Simulating 3 TP variants...
  - TP earlier by 30% (0.7x): Would hit SL → -$30 (same as actual)
  - TP extended by 20% (1.2x): Would hit SL → -$30 (same as actual)
  - TP extended by 50% (1.5x): Would hit SL → -$30 (same as actual)

[Counterfactual] Simulating 4 risk variants...
  - Risk 1%: Would yield -$15 (better by $15)
  - Risk 2%: Would yield -$30 (same as actual)
  - Risk 3%: Would yield -$45 (worse by $15)
  - Risk 5%: Would yield -$75 (worse by $45)

[Counterfactual] Simulating early exit on 20% pullback...
  - Early exit: Would hit SL → -$30 (same as actual)

[Counterfactual] ✅ Best alternate: SL wider by 15% (1.15x)
  would yield $60.00 vs actual -$30.00 (+$90.00)

[Counterfactual] ⚠️  CRITICAL FINDING: Stop was TOO TIGHT
  - In 2 of 4 SL simulations, wider stop would have won
  - Price reversed and hit TP just after stop out
  - This is the 7th "unlucky stop" in your last 10 trades

[Counterfactual] ✅ Saved 12 counterfactual simulations to database

[Counterfactual Insights] Generating AI summary for trade b2c4d9a1...
[Counterfactual Insights] LLM analysis:
  "Your -$30 loss would have been +$60 with SL 1.15x wider.
   You've had 7 unnecessary stops in last 10 trades.
   In high volatility sideways markets, widen stops by 15-30%.
   Recommendation: Use SL 1.15x minimum when ATR > 0.0025"

[Counterfactual Insights] ✅ Insights generated and saved

[Trade Lifecycle] ✅ Counterfactual analysis complete for GBPUSD
```

---

## 📊 **Example 3: Perfect Trade (No Improvements Found)**

```
[Trade Lifecycle] Closing trade f4a9c7e3 on USDJPY: Take profit hit
[Trade Lifecycle] 🧠 Starting counterfactual analysis for USDJPY...

[Counterfactual] 🧠 Replaying trade f4a9c7e3 in 12 alternate timelines...
[Counterfactual] Analyzing 62 candles between 2025-11-30 11:00:00 and 2025-11-30 13:30:00
[Counterfactual] Market regime: bull | Volatility: medium

[Counterfactual] Simulating 4 SL variants...
  - SL tighter by 30% (0.7x): Would hit SL → -$25 (worse by $220)
  - SL tighter by 15% (0.85x): Would hit SL → -$25 (worse by $220)
  - SL wider by 15% (1.15x): Would hit TP → +$195 (same as actual)
  - SL wider by 30% (1.30x): Would hit TP → +$195 (same as actual)

[Counterfactual] Simulating 3 TP variants...
  - TP earlier by 30% (0.7x): Would hit TP → +$137 (worse by $58)
  - TP extended by 20% (1.2x): Would reverse → +$180 (worse by $15)
  - TP extended by 50% (1.5x): Would reverse → +$165 (worse by $30)

[Counterfactual] Simulating 4 risk variants...
  - Risk 1%: Would yield +$98 (worse by $97)
  - Risk 2%: Would yield +$195 (same as actual)
  - Risk 3%: Would yield +$293 (better by $98)
  - Risk 5%: Would yield +$488 (better by $293)

[Counterfactual] Simulating early exit on 20% pullback...
  - Early exit: Would exit at +$195 (same as actual)

[Counterfactual] ✅ Best alternate: Risk 5% (5x position size)
  would yield $488.00 vs actual $195.00 (+$293.00)

[Counterfactual] ✅ EXCELLENT EXECUTION
  - SL placement was optimal (tighter would have failed)
  - TP placement was optimal (extending would have given back profit)
  - Only improvement: Higher risk % (but that's strategy decision)

[Counterfactual] ✅ Saved 12 counterfactual simulations to database

[Counterfactual Insights] Generating AI summary for trade f4a9c7e3...
[Counterfactual Insights] LLM analysis:
  "Near-perfect execution. SL and TP placement optimal for this setup.
   Extending TP would have cost profit due to reversal.
   Current parameters are well-calibrated for this regime.
   Recommendation: Continue with current SL/TP strategy in bull trends."

[Counterfactual Insights] ✅ Insights generated and saved

[Trade Lifecycle] ✅ Counterfactual analysis complete for USDJPY
```

---

## 📊 **Example 4: Early Exit Would Have Helped**

```
[Trade Lifecycle] Closing trade a8b3f2d9 on EURJPY: Take profit hit
[Trade Lifecycle] 🧠 Starting counterfactual analysis for EURJPY...

[Counterfactual] 🧠 Replaying trade a8b3f2d9 in 12 alternate timelines...
[Counterfactual] Analyzing 93 candles between 2025-11-30 08:00:00 and 2025-11-30 15:30:00
[Counterfactual] Market regime: sideways | Volatility: medium

[Counterfactual] Simulating 4 SL variants...
  - SL tighter by 30% (0.7x): Would hit SL → -$35 (worse by $105)
  - SL tighter by 15% (0.85x): Would hit TP → +$70 (same as actual)
  - SL wider by 15% (1.15x): Would hit TP → +$70 (same as actual)
  - SL wider by 30% (1.30x): Would hit TP → +$70 (same as actual)

[Counterfactual] Simulating 3 TP variants...
  - TP earlier by 30% (0.7x): Would hit TP → +$49 (worse by $21)
  - TP extended by 20% (1.2x): Would reverse → +$55 (worse by $15)
  - TP extended by 50% (1.5x): Would reverse → +$40 (worse by $30)

[Counterfactual] Simulating 4 risk variants...
  - Risk 1%: Would yield +$35 (worse by $35)
  - Risk 2%: Would yield +$70 (same as actual)
  - Risk 3%: Would yield +$105 (better by $35)
  - Risk 5%: Would yield +$175 (better by $105)

[Counterfactual] Simulating early exit on 20% pullback...
  - Early exit: Would exit at +$118 (BETTER by $48) ⭐⭐
  - Peak reached: +$147 → Pulled back 20% → Exit at +$118
  - Actual: Held to TP at +$70 (gave back $48)

[Counterfactual] ✅ Best alternate: Early exit on 20% pullback
  would yield $118.00 vs actual $70.00 (+$48.00)

[Counterfactual] ⚠️  PATTERN DETECTED: Profit Fade
  - Price peaked at +$147 (more than 2x TP)
  - Then reversed and hit TP at +$70
  - You gave back $77 in unrealized profit
  - This is the 3rd time this happened in last 8 trades

[Counterfactual] ✅ Saved 12 counterfactual simulations to database

[Counterfactual Insights] Generating AI summary for trade a8b3f2d9...
[Counterfactual Insights] LLM analysis:
  "Your +$70 win could have been +$118 with trailing stop.
   Price peaked at +$147 then reversed to +$70.
   You've given back profits in 3 of last 8 trades.
   Recommendation: Add trailing stop at 20% pullback from peak in sideways markets."

[Counterfactual Insights] ✅ Insights generated and saved

[Trade Lifecycle] ✅ Counterfactual analysis complete for EURJPY
```

---

## 📊 **Example 5: Aggregate Pattern After 50 Trades**

```
[Pattern Mining] Running aggregate analysis after 50 trades...

[Pattern Mining] Stop Loss Analysis (EURUSD)
  Bull market + low volatility:
    - Optimal SL: 1.15x (15% wider)
    - Success rate: 78% (14/18 trades)
    - Avg improvement: +$23.50 per trade
    - Sample size: 18 trades ✅ Significant

  Bear market + high volatility:
    - Optimal SL: 1.30x (30% wider)
    - Success rate: 82% (9/11 trades)
    - Avg improvement: +$31.20 per trade
    - Sample size: 11 trades ✅ Significant

[Pattern Mining] Take Profit Analysis (EURUSD)
  Bull trends (EMA50 > EMA200):
    - Optimal TP: 1.20x (20% further)
    - Success rate: 71% (12/17 trades)
    - Avg improvement: +$18.80 per trade
    - Sample size: 17 trades ✅ Significant

  Sideways markets:
    - Optimal TP: 1.0x (current target)
    - Extensions often reverse
    - Keep current strategy ✅

[Pattern Mining] Early Exit Analysis
  - 12 trades would have benefited from 20% trailing stop
  - Avg improvement: +$28.40 per trade
  - Total profit left on table: $340.80
  - Recommendation: Implement trailing stop system ⭐⭐⭐

[Pattern Mining] Risk Sizing Analysis
  Current win rate: 64%
  - Safe to increase to 3% risk
  - Would have added +$890 over 50 trades
  - Recommendation: Adjust risk from 2% → 3% ⭐⭐

[Pattern Mining] ✅ Pattern analysis complete
[Pattern Mining] 📊 Overall potential improvement: +$1,450 over last 50 trades (+29%)
```

---

## 🎯 **Key Takeaways from Examples**

### **Example 1:** Win that could be bigger
- Fixed TP left money on table
- Risk sizing too conservative
- **Learning:** Extend TP in bull trends

### **Example 2:** "Unlucky" stop that was actually wrong
- Stop was too tight for volatility
- Pattern of unnecessary stops
- **Learning:** Widen stops in high volatility

### **Example 3:** Perfect execution
- No meaningful improvements
- Parameters well-calibrated
- **Learning:** Keep doing what you're doing

### **Example 4:** Profit fade
- Gave back unrealized gains
- Trailing stop would help
- **Learning:** Protect profits dynamically

### **Example 5:** Aggregate insights
- Clear patterns emerge after 50 trades
- Statistical significance reached
- **Learning:** Apply discovered optimizations

---

**This is institutional-grade learning at $0.20/year.** 🧠✨
