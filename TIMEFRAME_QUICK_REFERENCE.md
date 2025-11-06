# Timeframe Quick Reference

## All Supported Timeframes

| Timeframe | Name | Minutes | Candles/Day | Best For |
|-----------|------|---------|-------------|----------|
| **M1** | 1 Minute | 1 | 1,440 | Scalping, high-frequency trading |
| **M5** | 5 Minutes | 5 | 288 | Day trading, quick entries |
| **M15** | 15 Minutes | 15 | 96 | Intraday trading, short-term |
| **M30** | 30 Minutes | 30 | 48 | Intraday swing trades |
| **H1** | 1 Hour | 60 | 24 | Day trading, medium-term |
| **H4** | 4 Hours | 240 | 6 | Swing trading, trend following |
| **D1** | Daily | 1,440 | 1 | Swing trading, position trading |
| **W1** | Weekly | 10,080 | 1/5 | Position trading, macro trends |

## Timeframe Selection Guide

### For Scalping (Minutes to Hours)
- **Primary**: M1, M5
- **Secondary**: M15
- **Confirmation**: M30, H1

### For Day Trading (Hours to 1 Day)
- **Primary**: M15, M30, H1
- **Secondary**: H4
- **Confirmation**: D1

### For Swing Trading (Days to Weeks)
- **Primary**: H4, D1
- **Secondary**: W1
- **Confirmation**: Monthly trends

### For Position Trading (Weeks to Months)
- **Primary**: D1, W1
- **Secondary**: Monthly
- **Confirmation**: Fundamental analysis

## Data Retention & Limits

| Timeframe | Candles Stored | Time Coverage | Update Interval |
|-----------|----------------|---------------|-----------------|
| M1 | 500 | ~8 hours | 5 seconds |
| M5 | 500 | ~42 hours | 15 seconds |
| M15 | 500 | ~5 days | 30 seconds |
| M30 | 500 | ~10 days | 1 minute |
| H1 | 500 | ~21 days | 2 minutes |
| H4 | 500 | ~83 days | 4 minutes |
| D1 | 365 | ~1 year | 10 minutes |
| W1 | 260 | ~5 years | 30 minutes |

## Multi-Timeframe Analysis Strategy

### Top-Down Analysis (Recommended)
1. **W1** - Identify major trend and market structure
2. **D1** - Find key support/resistance and trend
3. **H4** - Look for entry patterns and setups
4. **H1/M15** - Time your entry precisely

### Bottom-Up Analysis
1. **M15/H1** - Spot immediate opportunities
2. **H4** - Confirm short-term trend
3. **D1** - Check alignment with daily trend
4. **W1** - Verify long-term market direction

## Chart Display Settings

### Optimal Candle Display
- **M1-M15**: 100-200 candles for pattern recognition
- **M30-H1**: 200-300 candles for trend analysis
- **H4**: 300-400 candles for swing setups
- **D1**: 200-365 candles for long-term trends
- **W1**: 100-260 candles for macro analysis

## Quick Commands

### Backfill Historical Data
```bash
# All longer timeframes (H4, D1, W1)
node scripts/backfill-daily-weekly-candles.js

# All timeframes (complete historical data)
node scripts/backfill-all-candles.js
```

### Check Data Coverage
```sql
-- See available data per timeframe
SELECT
  symbol,
  timeframe,
  COUNT(*) as candle_count,
  MIN(open_time) as earliest,
  MAX(open_time) as latest,
  MAX(open_time) - MIN(open_time) as coverage
FROM forex_candles
WHERE timeframe IN ('H4', 'D1', 'W1')
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;
```

## Trading Time Considerations

### Session Times (UTC)
- **Sydney**: 22:00 - 07:00
- **Tokyo**: 00:00 - 09:00
- **London**: 08:00 - 17:00
- **New York**: 13:00 - 22:00

### Best Timeframes by Session
- **Asian Session**: D1, W1 for trend, H4 for entries
- **London Session**: H1, H4 for volatility
- **New York Session**: M30, H1 for active trading
- **Overlap (London+NY)**: M15, M30 for scalping

## Indicator Settings by Timeframe

### RSI
- **M1-M15**: 14 period
- **M30-H1**: 14 period
- **H4-D1**: 14-21 period
- **W1**: 21-28 period

### EMA
- **Short-term (M1-M30)**: 9, 20, 50
- **Medium-term (H1-H4)**: 20, 50, 100
- **Long-term (D1-W1)**: 50, 100, 200

### ATR
- **All timeframes**: 14 period
- **For stop loss**: 2-3 × ATR
- **For take profit**: 3-5 × ATR

## Performance Tips

1. **Start with Higher Timeframes**: Load W1 or D1 first for context
2. **Cache Aggressively**: Browser caches longer timeframe data efficiently
3. **Limit Active Charts**: Don't open multiple D1/W1 charts simultaneously
4. **Use Background Aggregation**: Let the system build candles automatically
5. **Regular Backfills**: Run weekly backfills to ensure complete data

## Common Patterns by Timeframe

### Daily (D1)
- Swing highs/lows (support/resistance)
- Head and shoulders
- Double tops/bottoms
- Triangle patterns
- Trend channels

### Weekly (W1)
- Major trend reversals
- Long-term support/resistance zones
- Macro trend identification
- Market structure shifts
- Major breakout levels

## Risk Management by Timeframe

| Timeframe | Typical Stop Loss | Typical Take Profit | Position Duration |
|-----------|-------------------|---------------------|-------------------|
| M1 | 5-10 pips | 10-20 pips | Minutes |
| M5 | 10-20 pips | 20-40 pips | 5-30 minutes |
| M15 | 15-30 pips | 30-60 pips | 15-120 minutes |
| M30 | 20-40 pips | 40-80 pips | 30-240 minutes |
| H1 | 30-50 pips | 60-100 pips | 1-8 hours |
| H4 | 50-100 pips | 100-200 pips | 4-48 hours |
| D1 | 80-150 pips | 150-300 pips | 1-7 days |
| W1 | 150-300 pips | 300-600 pips | 1-8 weeks |

## Keyboard Shortcuts (Coming Soon)

- `1` - Switch to M1
- `5` - Switch to M5
- `Shift+1` - Switch to M15
- `Shift+3` - Switch to M30
- `H` - Switch to H1
- `Shift+H` - Switch to H4
- `D` - Switch to D1
- `W` - Switch to W1

---

**Pro Tip**: Always align your trading timeframe with your available time and trading style. Don't force scalping strategies on daily charts or position trading on minute charts!
