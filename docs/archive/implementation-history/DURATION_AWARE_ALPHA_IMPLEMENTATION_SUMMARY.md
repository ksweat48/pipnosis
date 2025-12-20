# Duration-Aware Alpha Implementation Summary

## Status: Foundation Complete ✅

### Completed Components

#### 1. Core Rules Update ✅
**File:** `src/lib/pipnosis-core-rules.ts`

**Changes:**
- Extended max trade duration from 6h → 10h
- Added min trade duration: 1h
- Added preferred trade duration: 4h
- **FIXED VOLATILITY MAPPING** (was backwards):
  - Low volatility: 2-10h (slow markets need more time)
  - Medium volatility: 1-8h (standard intraday)
  - High volatility: 1-6h (fast markets fill quickly)
- Added session liquidity multipliers:
  - London/NY overlap: 0.8x (fastest fills)
  - London: 1.0x (standard)
  - New York: 1.0x (standard)
  - Asian: 1.5x (slower fills)
- Added duration progress alert thresholds:
  - 50%: Warning
  - 75%: Consider action
  - 85%: Trailing stop recommended
  - 100%: Force close
- Updated system identity prompt with duration awareness

#### 2. Duration Calculator Service ✅
**File:** `src/services/duration-calculator.ts`

**Features:**
- Intelligent time-to-TP estimation based on:
  - ATR and current volatility
  - Market regime (trending vs ranging)
  - Trade direction (with-trend vs counter-trend)
  - Trading session (liquidity context)
  - Historical TP fill rates
- Provides confidence bands (best/expected/worst case)
- Generates warnings when duration exceeds limits
- Recommends TP adjustments for unrealistic setups
- Session-aware multipliers
- Regime-aware multipliers (with-trend 40% faster, counter-trend 150% slower)
- Volatility-aware factors (high vol = fast fills, low vol = slow fills)

**Key Methods:**
```typescript
estimateTimeToTP(input: DurationEstimateInput): DurationEstimate
getHistoricalFillTimes(userId, symbol, regime): Promise<{avgHours, sampleSize}>
suggestMaxTPForDuration(entry, sl, allowedHours, atr, direction): {maxTP, maxRR, reasoning}
```

#### 3. LLM Snapshot Builder Update ✅
**File:** `src/services/llm-snapshot-builder.ts`

**Changes:**
- Added `durationContext` optional field to `MarketSnapshot` interface
- Updated prompt formatter to include duration context when available
- Shows expected fill time, allowed max, session multiplier, warnings, and recommendations

### Remaining Integration Tasks

#### 4. Alpha Coordinator Integration (TODO)
**File:** `src/brains/coordinator-alpha.ts`

**Integration Points:**

1. **Import duration calculator:**
```typescript
import { durationCalculator } from '../services/duration-calculator';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
```

2. **In main decision method (around line 500-600), after receiving Omega votes:**
```typescript
// Calculate duration estimate BEFORE calling Alpha
const volatilityDurationProfile =
  marketContext.volatility === 'low'
    ? PIPNOSIS_CORE_RULES.TRADE_DURATION_VOLATILITY_MAP.low
    : marketContext.volatility === 'high'
    ? PIPNOSIS_CORE_RULES.TRADE_DURATION_VOLATILITY_MAP.high
    : PIPNOSIS_CORE_RULES.TRADE_DURATION_VOLATILITY_MAP.medium;

// Provide guidance to Alpha on realistic TP ranges
const suggestedMaxTP = durationCalculator.suggestMaxTPForDuration(
  marketContext.price,
  marketContext.price - (marketContext.atr * 2), // Example SL
  volatilityDurationProfile.max,
  marketContext.atr,
  'buy', // Will vary based on consensus
  4 // Candles per hour for M15
);

console.log(`[Alpha Duration] Max realistic TP: ${suggestedMaxTP.maxTP.toFixed(5)} (${suggestedMaxTP.maxRR.toFixed(1)}:1 R:R)`);
```

3. **Add duration context to Alpha's system prompt:**
```typescript
const durationGuidance = `
DURATION CONSTRAINTS (CRITICAL):
- Maximum allowed: ${volatilityDurationProfile.max} hours (${marketContext.volatility} volatility)
- Preferred target: ${volatilityDurationProfile.preferred} hours
- Current session: ${currentSession} (liquidity multiplier: ${sessionMultiplier}x)
- Suggested max TP: ${suggestedMaxTP.maxTP.toFixed(5)} (${suggestedMaxTP.maxRR.toFixed(1)}:1 R:R)
- ${suggestedMaxTP.reasoning}

RULES:
- Choose TPs that can fill within ${volatilityDurationProfile.max}h
- Low volatility = wider time window needed
- High volatility = faster fills, can use tighter TPs
- Asian session = slower fills, tighten TPs
- London/NY = faster fills, can extend TPs slightly
`;
```

4. **After Alpha returns decision, validate duration:**
```typescript
// Estimate duration for Alpha's chosen TP
const durationEstimate = durationCalculator.estimateTimeToTP({
  entryPrice: alphaDecision.entry,
  takeProfit: alphaDecision.takeProfit,
  stopLoss: alphaDecision.stopLoss,
  symbol: marketContext.symbol,
  direction: alphaDecision.decision === 'BUY' ? 'buy' : 'sell',
  currentATR: marketContext.atr,
  volatilityLevel: marketContext.volatility as any,
  marketRegime: marketContext.regime as any,
  currentSession: currentSession,
  trendStrength: traderScore.current_score,
  timeframe: 'M15'
});

console.log(`[Alpha Duration] Expected: ${durationEstimate.expectedHours.toFixed(1)}h | Allowed: ${durationEstimate.allowedMaxHours}h | Confidence: ${durationEstimate.confidence}%`);

// Warn Alpha but don't block (preserves Alpha's final authority)
if (durationEstimate.exceedsAllowedDuration) {
  console.warn(`[Alpha Duration] ⚠️ ADVISORY: ${durationEstimate.warnings.join(', ')}`);
  console.warn(`[Alpha Duration] ⚠️ Recommendation: ${durationEstimate.recommendation}`);

  // Add to Alpha's reasoning for audit trail
  alphaDecision.reasoning += `\n[Duration Advisory: ${durationEstimate.recommendation}]`;
}

// Store duration estimate with decision for analytics
alphaDecision.duration_estimate = durationEstimate;
```

#### 5. Progressive Duration Manager (TODO)
**File:** `src/services/progressive-duration-manager.ts` (NEW)

**Purpose:**
- Monitor trade duration progress
- Alert at 50%, 75%, 85% of max duration
- Recommend actions (tighten TP, add trailing stop, exit)
- Integrate with mid-trade evaluator

**Key Features:**
```typescript
class ProgressiveDurationManager {
  async checkDurationProgress(tradeId: string, userId: string): Promise<DurationAlert | null>
  async recommendAction(trade, durationPercent): Promise<ActionRecommendation>
  async logDurationMilestone(tradeId, milestone, action): Promise<void>
}
```

**Alert Thresholds:**
- 50%: Informational alert, log progress
- 75%: Warning alert, suggest TP tightening if no significant progress
- 85%: Urgent alert, recommend trailing stop or consider exit
- 100%: Force close (existing system handles this)

#### 6. Mid-Trade Evaluator Integration (TODO)
**File:** `src/services/llm-mid-trade-evaluator.ts`

**Changes needed:**

1. **Update prompt (line 188) to include duration context:**
```typescript
const timeInTradeHours = timeInTrade / 60;
const durationPercent = (timeInTradeHours / 10) * 100; // 10h max

prompt += `
- Time in trade: ${timeInTradeHours.toFixed(1)}h / 10h max (${durationPercent.toFixed(0)}% of allowed duration)
`;

if (durationPercent > 75) {
  prompt += `- ⚠️ Duration Alert: Trade has used ${durationPercent.toFixed(0)}% of allowed time. Consider tightening TP or exiting if insufficient progress.`;
}
```

2. **Update validation (line 311) to check duration:**
```typescript
if (timeInTradeHours > 10 && result.recommendation === 'HOLD') {
  violations.push('Cannot hold past 10 hours - must close position');
}
```

#### 7. Database Migration (TODO)
**File:** `supabase/migrations/YYYYMMDD_HHMMSS_add_duration_tracking.sql`

**Schema additions:**
```sql
-- Add duration tracking to goal_session_trades
ALTER TABLE goal_session_trades
ADD COLUMN IF NOT EXISTS expected_duration_hours DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS actual_duration_hours DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS duration_exceeded BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS duration_warnings TEXT[],
ADD COLUMN IF NOT EXISTS duration_alerts_sent INTEGER DEFAULT 0;

-- Add duration analytics table
CREATE TABLE IF NOT EXISTS trade_duration_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  trade_id UUID REFERENCES goal_session_trades(id),
  symbol TEXT NOT NULL,
  volatility_level TEXT NOT NULL,
  market_regime TEXT NOT NULL,
  trading_session TEXT NOT NULL,
  expected_hours DECIMAL(5,2) NOT NULL,
  actual_hours DECIMAL(5,2),
  variance_percent DECIMAL(5,2),
  tp_hit BOOLEAN,
  force_closed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Add indexes
CREATE INDEX idx_duration_analytics_symbol ON trade_duration_analytics(symbol, volatility_level);
CREATE INDEX idx_duration_analytics_user ON trade_duration_analytics(user_id, created_at DESC);

-- Enable RLS
ALTER TABLE trade_duration_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own duration analytics"
  ON trade_duration_analytics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own duration analytics"
  ON trade_duration_analytics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

#### 8. Logging and Analytics (TODO)
**File:** `src/services/duration-analytics.ts` (NEW)

**Features:**
- Track expected vs actual duration
- Calculate duration accuracy by regime/volatility
- Identify patterns (which setups take longer/shorter)
- Feed insights back to improve estimator
- Dashboard component showing duration statistics

#### 9. Trade Execution Engine Update (TODO)
**File:** `src/services/trade-execution-engine.ts`

**Changes:**
- Update force-close logic from 6h → 10h (line references to `TRADE_DURATION_MAX_HOURS`)
- Store expected duration with trade
- Log duration estimate at trade open

## Expected Impact

### Immediate Benefits
1. **Higher TP hit rate** - Alpha chooses realistic TPs that can fill
2. **Fewer force-closes** - Extended to 10h gives more time for quality setups
3. **Better risk-adjusted returns** - Trades reach intended targets more often
4. **Smarter decision-making** - Alpha understands time constraints

### Medium-Term Benefits
1. **Historical data improves estimates** - System learns actual fill times
2. **Regime-specific optimization** - Different duration strategies per regime
3. **Session-aware trading** - Adjust expectations based on liquidity
4. **User confidence increases** - System feels noticeably more intelligent

### Long-Term Benefits
1. **Continuous improvement** - Duration estimator gets more accurate over time
2. **Personalized duration profiles** - Learn each user's typical trade durations
3. **Symbol-specific patterns** - Some symbols fill faster/slower
4. **Volatility regime adaptation** - System adapts to changing market conditions

## Testing Strategy

### Unit Tests
- Duration calculator with various ATR/regime combinations
- Volatility mapping (verify inversion is correct)
- Session multiplier application
- Edge cases (zero ATR, extreme values)

### Integration Tests
- Alpha receives and uses duration context
- Mid-trade evaluator checks duration progress
- Force-close triggers at correct threshold
- Database records duration metrics

### Manual Testing Checklist
1. Start goal session in Asian session (low liquidity)
2. Verify Alpha chooses tighter TPs during Asian hours
3. Start goal session in London/NY overlap (high liquidity)
4. Verify Alpha can use wider TPs during peak hours
5. Check low volatility setup - should allow longer durations
6. Check high volatility setup - should expect faster fills
7. Monitor trade at 75% duration - should get alert
8. Verify force-close still works at 10h

## Rollout Plan

1. **Phase 1: Foundation** ✅ COMPLETE
   - Core rules update
   - Duration calculator service
   - Snapshot builder integration

2. **Phase 2: Alpha Integration** (NEXT)
   - Integrate duration calculator into Alpha coordinator
   - Add duration guidance to Alpha's prompts
   - Validate duration after Alpha's decision
   - Store duration estimates with trades

3. **Phase 3: Progressive Management**
   - Build progressive duration manager
   - Integrate with mid-trade evaluator
   - Add duration alert system
   - Test alert thresholds

4. **Phase 4: Analytics & Learning**
   - Database migration
   - Duration analytics service
   - Dashboard component
   - Historical feedback loop

5. **Phase 5: Optimization**
   - Tune multipliers based on real data
   - Personalize duration profiles
   - Symbol-specific adjustments
   - Continuous improvement

## Key Design Decisions

### Why Volatility Mapping is Inverted
**High volatility = FASTER fills:**
- High volatility means large, fast price swings
- TPs are reached quickly in volatile markets
- Therefore, max duration can be SHORTER

**Low volatility = SLOWER fills:**
- Low volatility means slow, grinding price action
- TPs take longer to reach in quiet markets
- Therefore, max duration must be LONGER

### Why Alpha Has Final Authority
- Duration calculator provides ADVISORY warnings, not hard blocks
- Alpha sees full context and can override if justified
- Preserves Alpha's intelligence and decision-making capability
- Better than rule-based rejection which can miss edge cases
- All overrides are logged for analysis

### Why Progressive Alerts, Not Immediate Action
- Markets are unpredictable - trades can accelerate late
- Premature exits leave profit on the table
- Alert system keeps user informed without forcing action
- Allows flexibility for high-confidence setups
- Maintains intraday discipline without being overly rigid

## Success Metrics

### Primary KPIs
- **TP hit rate:** Target 15-25% increase
- **Force-close rate:** Target 40-60% decrease
- **Average trade duration:** Should decrease (faster, more efficient trades)
- **Risk-adjusted returns:** Target 10-15% improvement

### Secondary KPIs
- **Duration estimate accuracy:** Track expected vs actual (target 80%+ within 20% variance)
- **Alert response rate:** % of duration alerts that led to action
- **User satisfaction:** Survey feedback on system intelligence
- **Alpha confidence:** Average confidence should remain high or improve

## Conclusion

This implementation transforms Pipnosis Alpha from a time-blind system into a duration-aware intelligent trader that:
- Understands realistic TP fill times
- Adapts to market volatility and session liquidity
- Provides progressive alerts as trades approach max duration
- Learns and improves from historical data
- Maintains Alpha's final authority while providing expert guidance

The system will feel noticeably smarter and more aligned with market realities, leading to better outcomes and increased user confidence.
