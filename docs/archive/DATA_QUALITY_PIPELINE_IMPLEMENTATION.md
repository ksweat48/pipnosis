# Data Quality Pipeline Implementation

## Summary

Fixed the root cause of EQS failing with "0 consecutive closes" for crypto pairs (BTCUSD, ETHUSD). The issue was NOT data gaps in the chart, but poor quality M5 candles in the database containing DOJI patterns (open === close) caused by incomplete real-time data collection.

## What Was Wrong

### The Discovery
- **Chart looked perfect**: Because it uses `candleQualityEnhancer` to fill gaps and reconstruct missing data
- **EQS was failing**: Because it uses raw database candles without enhancement
- **Root cause**: Database contained DOJI candles where `open === close`, causing the EQS loop to break immediately

### Why DOJI Candles Existed
1. WebSocket not consistently connected/receiving ticks
2. Background candle aggregator not running or not aggregating properly
3. Network/connection issues during data collection
4. Gap-filled synthetic data being used for trading decisions

## What Was Implemented

### 1. Candle Quality Validator (`candle-quality-validator.ts`)
**Purpose**: Pre-flight validation that database candles are real, high-quality data

**Features**:
- Validates candle body size (not all DOJIs)
- Detects time gaps between consecutive candles
- Calculates quality score (0-100) based on valid candles
- Checks percentage of DOJI candles vs real candles
- Provides detailed rejection reasons

**Thresholds**:
- Minimum quality score: 60%
- Minimum valid candles: 5 out of 10
- Maximum gap tolerance: 10 minutes (2x M5 candle)

### 2. WebSocket Health Check
**Purpose**: Verify Kraken WebSocket is connected and receiving recent data

**Features**:
- Checks `realtime_prices` table for recent updates (within 60 seconds)
- Only applies to crypto pairs (BTCUSD, ETHUSD)
- Returns false if data is stale, preventing trading on old data

### 3. Aggregator Health Monitor (`aggregator-health-monitor.ts`)
**Purpose**: Monitor background candle aggregator health

**Features**:
- Checks if aggregator is receiving price ticks
- Verifies last M5 candle creation time
- Detects if aggregator has stalled
- Provides detailed statistics (total candles, candles last 24h, average interval)

**Health Criteria**:
- Recent ticks within 60 seconds
- Last M5 candle within 10 minutes
- No gaps in candle generation

### 4. Unified Entry Monitor Integration
**Purpose**: Gate EQS execution on data quality

**Implementation**:
Added Step 5.5 (Data Quality Validation) in `unified-entry-monitor.ts`:
1. Validates candle quality first
2. Checks aggregator health
3. Verifies WebSocket connectivity (crypto only)
4. Rejects monitoring if any check fails
5. Logs detailed metrics for debugging

**Console Output Example**:
```
[UnifiedMonitor] Step 5.5/8: Validating candle data quality...
[UnifiedMonitor] ✓ Data quality validated: {
  qualityScore: '85%',
  validCandles: '8/10',
  aggregatorHealthy: true,
  lastCandleAge: '3min'
}
```

**Rejection Example**:
```
[UnifiedMonitor] ❌ Data quality check failed: Only 2 valid candles found (need 5) {
  qualityScore: '30%',
  validCandles: '2/10',
  dojiCount: 8,
  gapCount: 3
}
```

### 5. Enhanced EQS Error Messaging
**Purpose**: Clear visibility into why candles are rejected

**Features**:
- Detects DOJI candles explicitly (open === close)
- Shows body size and percentage for each candle
- Logs rejection reason (DOJI vs wrong direction)
- Displays detailed candle breakdown in console

**Debug Output Example**:
```
[EQS] 🔍 CANDLE ACCEPTANCE CHECK: {
  direction: 'SELL',
  candleOrder: [
    {
      index: 0,
      open: '3083.40',
      close: '3083.40',
      isDOJI: true,
      bodySize: '0.0000',
      bodyPercent: '0.0%',
      movement: '⚪ DOJI',
      matchesDirection: '⚪ DOJI (skipped)'
    },
    ...
  ]
}
[EQS] ⚪ DOJI detected at index 4 - stopping consecutive count
[EQS] ✅ CANDLE ACCEPTANCE RESULT: {
  accepted: '❌ NO',
  consecutiveCloses: 0,
  rejectionReason: 'Stopped at DOJI candle (open=3083.4000, close=3083.4000, bodySize=0)'
}
```

## Benefits

### For Users
1. **Clear error messages**: Know exactly why signals are rejected
2. **Data quality visibility**: See when WebSocket is disconnected or aggregator is stalled
3. **No false signals**: System won't trade on synthetic/low-quality data

### For Developers
1. **Comprehensive logging**: Full visibility into data quality metrics
2. **Early detection**: Catch data collection issues before they affect trading
3. **Diagnostic tools**: Multiple health checks to isolate problems

### For System Reliability
1. **Data-driven decisions**: Only trade when real, high-quality data exists
2. **Automatic gating**: Prevents EQS from running on bad data
3. **Health monitoring**: Continuous validation of data pipeline

## Testing Strategy

### When EQS Fails with "0 consecutive closes"
1. Check console for data quality validation results
2. Look for DOJI indicators in candle breakdown
3. Verify WebSocket connection status
4. Check aggregator health metrics
5. Review `realtime_prices` table for recent updates

### Expected Behaviors
- **Healthy system**: Quality score >60%, no DOJIs, aggregator receiving ticks
- **WebSocket down**: "WebSocket not receiving recent data" error
- **Stale data**: "Last M5 candle is X minutes old" error
- **DOJI candles**: Detailed breakdown showing open === close

## Files Modified

### New Files Created
1. `src/services/candle-quality-validator.ts` - Quality validation logic
2. `src/services/aggregator-health-monitor.ts` - Aggregator health checks
3. `DATA_QUALITY_PIPELINE_IMPLEMENTATION.md` - This documentation

### Files Modified
1. `src/services/unified-entry-monitor.ts` - Added Step 5.5 validation gate
2. `src/services/entry-qualification-engine.ts` - Enhanced DOJI detection and logging

## Next Steps (Optional Future Enhancements)

### Automatic Recovery
- Auto-restart WebSocket on connection loss
- Trigger manual backfill when gaps detected
- Alert system for prolonged data quality issues

### UI Indicators
- Data quality status badge
- WebSocket connection indicator
- Last candle age display
- Quality score visualization

### Database Cleanup
- Mark synthetic candles with `is_synthetic` flag
- Automatic cleanup of old gap-filled data
- Data quality reports in admin dashboard

## Conclusion

The system now has **three layers of protection**:
1. **Candle Quality Validator**: Checks database candle integrity
2. **WebSocket Health Check**: Ensures real-time data is fresh
3. **Aggregator Health Monitor**: Verifies data pipeline is functioning

**Result**: EQS will only run when high-quality, real market data is available, preventing trades based on synthetic or stale data.
