# OMEGA-8 HYBRID QUICK REFERENCE

## 🎯 One-Line Summary
Deterministic orderflow pattern detection with conditional LLM refinement (20-30% usage).

## 🏗️ Architecture
```
Layer 1: Detect Patterns (deterministic, 0ms)
Layer 2: Score & Bias (deterministic, 0ms)
Layer 3: LLM Refinement (conditional, ~250ms)
```

## 📊 Patterns Detected
```
✅ Equal Highs/Lows (ATR-relative)
✅ Liquidity Sweeps (wick rejection)
✅ Fair Value Gaps (FVG)
✅ Volume Spikes (directional)
✅ Accumulation/Distribution Zones
```

## ⚙️ LLM Trigger Logic
```typescript
✅ Confidence 35-65 → Use LLM
✅ Conflicting patterns → Use LLM
❌ Confidence >= 75 → Skip LLM (certain)
❌ Confidence <= 25 → Skip LLM (weak)
```

## 💰 Expected Savings
```
Cost:  70-80% reduction
Speed: 10x faster (deterministic cases)
LLM:   ~25% usage rate
```

## 📍 Key Files
```
Implementation: src/brains/omega8-hybrid-orderflow.ts
Tests:         src/tests/omega8-hybrid.test.ts
Integration:   src/services/alpha-omega-orchestrator.ts
Migration:     supabase/migrations/*omega8_hybrid*
```

## 🔍 Monitoring Queries
```sql
-- LLM Usage Rate
SELECT COUNT(*) FILTER (WHERE used_llm)::float / COUNT(*) * 100
FROM omega8_hybrid_usage WHERE created_at > NOW() - INTERVAL '7d';

-- Performance by LLM Usage
SELECT omega8_used_llm, AVG(pnl), COUNT(*)
FROM trade_history WHERE omega8_confidence IS NOT NULL
GROUP BY omega8_used_llm;
```

## 🎛️ Tuning Parameters
```typescript
LLM_CONFIDENCE_LOWER = 35  // Lower bound
LLM_CONFIDENCE_UPPER = 65  // Upper bound
VOL_SPIKE_THRESHOLD = 1.5  // Volume multiplier
ATR_TOLERANCE = 0.1        // Equal highs/lows tolerance
```

## 🚀 Usage
```typescript
const result = await omega8Hybrid.runOmega8(snapshot);
console.log(result.bias, result.confidence, result.usedLLM);
```

## 🧪 Test
```bash
npm run test omega8-hybrid
```

## ✅ Status
**PRODUCTION READY** - Build passes, tests pass, integration complete.
