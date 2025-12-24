# Critical Level Detection System

## Overview

The Critical Level Detection System enables Pipnosis Alpha to intelligently identify and monitor support/resistance levels during active trades. This helps Alpha provide early warnings when price approaches rejection zones and recommend early exits to secure profits.

## System Components

### 1. Critical Level Detector (`critical-level-detector.ts`)

Analyzes historical candles to detect support and resistance levels:

- **Swing Level Detection**: Identifies swing highs and lows from recent price action
- **Level Clustering**: Groups nearby levels into strong zones
- **Strength Scoring**: Ranks levels by touches, recency, and proximity
- **Level Prioritization**: Selects THE most critical level to watch based on urgency

### 2. Trade Level Integration (`trade-level-integration.ts`)

Connects level detection to active trades:

- **Auto-Detection**: Detects levels when trades are opened
- **Database Storage**: Stores levels in `goal_session_trades` table
- **Level Fetching**: Retrieves stored levels for active trades

### 3. LLM Mid-Trade Evaluator (Updated)

Enhanced with critical level awareness:

- **Level Context**: Includes watched level in LLM prompts
- **Early Exit Logic**: Recommends exits before hitting resistance/support
- **Actionable Advice**: Provides specific guidance on critical levels

### 4. Chart Visualization (Updated)

Visual indicators on price charts:

- **Orange Dashed Line**: Critical level (resistance/support to watch)
- **Green Dotted Line**: Early exit target (5 pips before critical level)

## Database Schema

### New Columns in `goal_session_trades`

```sql
critical_levels JSONB    -- Array of all detected S/R levels
watched_level JSONB      -- The single most important level
early_exit_level NUMERIC -- Pre-calculated early exit price
```

### Example Data

```json
{
  "critical_levels": [
    {
      "price": 1.08450,
      "type": "resistance",
      "strength": 0.85,
      "touches": 4,
      "reason": "Swing high rejection zone"
    }
  ],
  "watched_level": {
    "price": 1.08450,
    "type": "resistance",
    "distance": 12.5,
    "urgency": 85,
    "actionable": "CRITICAL: resistance only 12.5 pips away..."
  },
  "early_exit_level": 1.08400
}
```

## Integration Points

### When Opening a Trade

```typescript
import { tradeLevelIntegration } from '@/services/trade-level-integration';
import { fetchCompleteChartData } from '@/services/candle-data-service';

// After trade is created in database
const candles = await fetchCompleteChartData(symbol, timeframe, limit);

await tradeLevelIntegration.detectAndStoreLevels(
  tradeId,
  symbol,
  direction,
  entryPrice,
  stopLoss,
  takeProfit,
  candles
);
```

### During Mid-Trade Evaluation

The `llm-mid-trade-evaluator` automatically includes watched levels in LLM prompts:

```typescript
import { llmMidTradeEvaluator } from '@/services/llm-mid-trade-evaluator';
import { tradeLevelIntegration } from '@/services/trade-level-integration';

const { watchedLevel } = await tradeLevelIntegration.fetchLevelsForTrade(tradeId);
const criticalLevel = tradeLevelIntegration.parseCriticalLevelsFromDb(watchedLevel);

const evaluation = await llmMidTradeEvaluator.evaluateTrade(
  {
    trade,
    marketConditions,
    trigger,
    criticalLevel,  // <-- Included in LLM prompt
    goalContext
  },
  userId
);
```

### On Chart Display

```typescript
<MarketChart
  symbol={symbol}
  onSymbolChange={setSymbol}
  tradeLines={{
    entry: trade.entryPrice,
    stopLoss: trade.stopLoss,
    takeProfit: trade.takeProfit,
    watchedLevel: trade.watched_level?.price,      // Orange dashed line
    earlyExitLevel: trade.early_exit_level          // Green dotted line
  }}
/>
```

## Example Output

### Level Detection Log

```
[CriticalLevelDetector] Detected critical levels
  direction: long
  currentPrice: 1.08350
  totalLevels: 3
  supportLevels: 1
  resistanceLevels: 2

[CriticalLevelDetector] Prioritized most critical level
  level: 1.08450
  type: resistance
  distance: 10.0 pips
  urgency: 88.5
  actionable: CRITICAL: resistance at 1.08450 only 10.0 pips away. Consider exit immediately.
```

### LLM Evaluation with Critical Level

```
⚠️ CRITICAL LEVEL DETECTED:
- RESISTANCE: 1.08450
- Distance: 10.0 pips
- Strength: 85%
- Urgency: CRITICAL (88/100)
- Analysis: CRITICAL: resistance at 1.08450 only 10.0 pips away...

RECOMMENDATION: TAKE_PROFIT_EARLY
CONFIDENCE: 85%
REASONING: Strong resistance at 1.08450 is only 10 pips away. This level has rejected price 4 times historically. Recommend securing +8 pips profit now rather than risk rejection.
```

## Configuration

### Detection Parameters

In `critical-level-detector.ts`:

```typescript
private readonly MIN_TOUCHES = 2;                 // Minimum touches to qualify as level
private readonly PRICE_TOLERANCE_PERCENT = 0.15; // Clustering tolerance
private readonly LOOKBACK_CANDLES = 50;          // Historical lookback period
```

### Safety Margin

Early exit levels are calculated with a 5-pip safety margin before the critical level.

## Benefits

1. **Proactive Protection**: Warns before hitting rejection zones
2. **Intelligent Exits**: Secures profits before reversals
3. **Specific Guidance**: References actual price levels in recommendations
4. **Visual Clarity**: Chart indicators show exactly where risks lie
5. **Learning Data**: Stores level data for post-trade analysis

## Future Enhancements

- Multi-level tracking (monitor 2-3 levels simultaneously)
- Dynamic level updates as price action evolves
- Level confidence degradation over time
- Integration with order flow data for enhanced level validation
