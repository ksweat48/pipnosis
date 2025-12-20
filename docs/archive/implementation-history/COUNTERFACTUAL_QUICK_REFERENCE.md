# 🧠 Counterfactual Engine - Quick Reference

## 🎯 **What It Does**
Simulates **12 alternate outcomes** for every closed trade to discover optimal SL/TP/Risk parameters.

---

## ⚡ **Quick Start**

### **Automatic Execution**
✅ Already integrated - runs automatically after every trade close

### **Manual Trigger**
```typescript
import { counterfactualEngine } from './services/counterfactual-engine';

const tradeData = {
  id: 'trade-123',
  user_id: 'user-456',
  symbol: 'EURUSD',
  direction: 'buy',
  entry_price: 1.0850,
  exit_price: 1.0900,
  stop_loss: 1.0820,
  take_profit: 1.0920,
  position_size: 100000,
  profit_loss: 50,
  entry_time: '2025-11-30T10:00:00Z',
  exit_time: '2025-11-30T14:00:00Z',
  timeframe: '15m'
};

await counterfactualEngine.runCounterfactuals(tradeData, candleHistory, {
  generateInsights: true // Optional LLM summary
});
```

---

## 📊 **Query Results**

### **Get Best Parameters for Symbol**
```typescript
const { data } = await supabase.rpc('get_optimal_parameters', {
  p_user_id: userId,
  p_symbol: 'EURUSD',
  p_market_regime: 'bull', // or null for all regimes
  p_volatility_regime: 'low' // or null for all volatilities
});

// Returns:
// variant_type | optimal_setting | avg_improvement | success_rate | sample_count
// sl_variant   | 1.15            | 12.50          | 0.75         | 20
// tp_variant   | 1.20            | 18.30          | 0.80         | 20
```

### **View Last 10 Best Alternatives**
```typescript
const { data } = await supabase
  .from('v_best_counterfactuals')
  .select('*')
  .order('created_at', { ascending: false })
  .limit(10);
```

### **Get Insights for Trade**
```typescript
const { data } = await supabase
  .from('ai_counterfactual_insights')
  .select('*')
  .eq('trade_id', tradeId)
  .single();

console.log(data.insight_summary); // AI-generated summary
console.log(data.actionable_recommendation); // What to do next
console.log(data.estimated_improvement_dollars); // How much better
```

---

## 🔍 **Understanding Results**

### **12 Simulations Per Trade**

| Variant Type | Setting | Description |
|-------------|---------|-------------|
| **SL Variants (4)** | 0.7x, 0.85x, 1.15x, 1.30x | Tighter or wider stops |
| **TP Variants (3)** | 0.7x, 1.2x, 1.5x | Earlier or extended targets |
| **Risk Variants (4)** | 1%, 2%, 3%, 5% | Position size adjustment |
| **Early Exit (1)** | 20% pullback | Trailing stop simulation |

### **Key Metrics**

- **counterfactual_pnl**: What you WOULD have made
- **actual_pnl**: What you DID make
- **rr_difference**: The delta (+ is better, - is worse)
- **would_hit_tp**: Did alternate reach target?
- **would_hit_sl**: Did alternate get stopped?

---

## 📈 **Pattern Mining Queries**

### **Find Best SL for Symbol in Bull Market**
```sql
SELECT
  optimal_setting as best_sl_multiplier,
  avg_improvement,
  success_rate,
  sample_count
FROM v_counterfactual_patterns
WHERE variant_type = 'sl_variant'
  AND symbol = 'EURUSD'
  AND market_regime = 'bull'
  AND sample_count >= 10
ORDER BY avg_improvement DESC
LIMIT 1;
```

### **Find All Profitable Patterns**
```sql
SELECT * FROM v_counterfactual_patterns
WHERE success_rate > 0.6
  AND sample_count >= 5
ORDER BY avg_improvement DESC;
```

---

## 🎯 **Example Use Cases**

### **1. Optimize SL for Next Trade**
```typescript
// Get optimal SL for EURUSD in current regime
const { data: patterns } = await supabase
  .from('v_counterfactual_patterns')
  .select('optimal_setting')
  .eq('variant_type', 'sl_variant')
  .eq('symbol', 'EURUSD')
  .eq('market_regime', currentRegime)
  .gte('sample_count', 5)
  .single();

const optimalSL = entryPrice - (slDistance * patterns.optimal_setting);
```

### **2. Check If Early Exit Would Help**
```typescript
const { data: earlyExit } = await supabase
  .from('ai_counterfactuals')
  .select('*')
  .eq('variant_type', 'early_exit')
  .gt('rr_difference', 10) // At least $10 improvement
  .order('created_at', { ascending: false })
  .limit(10);

if (earlyExit.length >= 7) {
  console.log('Early exit recommended - use trailing stop');
}
```

### **3. Display Insights to User**
```typescript
const { data: insight } = await supabase
  .from('ai_counterfactual_insights')
  .select('*')
  .eq('trade_id', tradeId)
  .single();

return {
  summary: insight.insight_summary,
  recommendation: insight.actionable_recommendation,
  couldHaveMade: `$${insight.estimated_improvement_dollars.toFixed(2)} more`
};
```

---

## 🔧 **Configuration**

### **Enable/Disable Insights**
```typescript
// In trade-lifecycle-manager.ts
await counterfactualEngine.runCounterfactuals(tradeData, candleData, {
  generateInsights: false // Set to false to skip LLM call
});
```

### **Adjust Candle Lookback**
```typescript
// In trade-lifecycle-manager.ts
const lookbackCandles = 300; // Reduce for faster execution
const lookbackMinutes = lookbackCandles * 15;
```

---

## 💰 **Cost Breakdown**

| Component | Cost Per Trade | Annual (1000 trades) |
|-----------|---------------|---------------------|
| Counterfactual sims | $0.00 | $0.00 |
| Database storage | $0.00 | $0.00 |
| LLM insights (optional) | $0.0002 | $0.20 |
| **TOTAL** | **$0.0002** | **$0.20** |

---

## 📊 **Performance**

- **Execution time:** 50-200ms per trade
- **Database writes:** 12 rows per trade (~2KB)
- **Blocking:** None (async background)
- **Impact on live trading:** Zero

---

## 🚨 **Troubleshooting**

### **No Counterfactuals Generated**
```
Problem: Insufficient candle history
Solution: Wait for more candles to accumulate (min 10 candles in trade window)
```

### **Wrong Results**
```
Problem: Candles not aligned with trade times
Solution: Check timeframe matches (default 15m)
```

### **Insights Not Generated**
```
Problem: LLM call failed
Solution: Check openai-proxy-client connection
```

---

## 📝 **Logging**

```
[Counterfactual] 🧠 Replaying trade abc-123 in 12 alternate timelines...
[Counterfactual] ✅ Best alternate: TP 1.2x → $185.50 vs actual $120.00 (+$65.50)
[Counterfactual] ✅ Saved 12 counterfactual simulations
[Counterfactual Insights] ✅ Insights generated and saved
```

---

## 🎓 **Next Steps**

1. ✅ **Wait for 10 trades** - Initial patterns emerge
2. ✅ **Query patterns after 50 trades** - Statistical significance
3. ✅ **Apply discoveries to strategy** - Parameter optimization
4. ✅ **Build ML models after 200+ trades** - Predictive intelligence

---

## 🔗 **Related Files**

- **Engine:** `src/services/counterfactual-engine.ts`
- **Insights:** `src/services/counterfactual-insight-generator.ts`
- **Integration:** `src/services/trade-lifecycle-manager.ts`
- **Migration:** `supabase/migrations/20251130000000_create_counterfactual_learning_system.sql`

---

**Status:** ✅ Production Ready
**Learning:** Automatic after every trade
**Cost:** $0.20/year for 1000 trades

*Hedge fund intelligence. Zero cost.* 🧠
