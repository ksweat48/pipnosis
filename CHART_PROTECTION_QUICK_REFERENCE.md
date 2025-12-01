# Chart Protection System - Quick Reference

## 🛡️ At a Glance

The chart protection system provides **5 layers of defense** to prevent cross-contamination and ensure data integrity:

1. **Type System** → Branded types prevent mixing at compile-time
2. **Price Validation** → Range and velocity checks reject bad data
3. **Circuit Breaker** → Automatic shutdown on contamination detection
4. **Database Layer** → Triggers validate all writes
5. **Integration** → Components enforce protection end-to-end

---

## 🚨 Emergency Response

### Chart Shows Wrong Symbol Data
```typescript
// 1. Check circuit breaker status
import { chartCircuitBreaker } from '@/services/chart-circuit-breaker';
const status = chartCircuitBreaker.getStatus();
console.log('Circuit breaker:', status);

// 2. Check for contamination events
const events = chartCircuitBreaker.getEvents('EURUSD');
console.log('Contamination events:', events);
```

### Database Query
```sql
-- See what's happening
SELECT * FROM v_circuit_breaker_status;
SELECT * FROM v_contamination_summary;

-- Reset after fixing root cause
SELECT reset_circuit_breaker('EURUSD');
```

---

## 📋 Common Tasks

### Validate a Symbol
```typescript
import { validateSymbol } from '@/types/symbol';

const result = validateSymbol(userInput);
if (!result.isValid) {
  console.error(result.error);
  if (result.suggestion) {
    console.log(`Did you mean ${result.suggestion}?`);
  }
  return;
}

// Now safe to use
const validatedSymbol = result.symbol;
```

### Check Price Validity
```typescript
import { priceValidationService } from '@/services/price-validation-service';

const validation = priceValidationService.validatePrice('EURUSD', price);
if (!validation.isValid) {
  console.error('Invalid price:', validation.reason);

  // Check if cross-contamination
  const mismatch = priceValidationService.detectPossibleSymbolMismatch('EURUSD', price);
  if (mismatch) {
    console.error(`This looks like ${mismatch} data!`);
  }
}
```

### Create Immutable Candle
```typescript
import { createImmutableCandle } from '@/types/candle-immutable';

try {
  const candle = createImmutableCandle(
    validatedSymbol,
    timestamp,
    open, high, low, close,
    'database',
    volume
  );
  // candle is frozen and validated
} catch (error) {
  console.error('Invalid candle:', error.message);
}
```

---

## 🔍 Monitoring

### Real-Time Status
```sql
-- Circuit breaker status
SELECT * FROM v_circuit_breaker_status;

-- Recent contamination (last 24h)
SELECT * FROM v_contamination_summary;

-- Validation failures (last hour)
SELECT * FROM v_validation_failures_recent;
```

### Browser Console
```typescript
// Check circuit breaker from browser
import { chartCircuitBreaker } from '@/services/chart-circuit-breaker';

chartCircuitBreaker.getStatus();
// {
//   state: 'closed',
//   events: 0,
//   symbolStates: { EURUSD: 'closed', XAUUSD: 'closed' },
//   uptime: 3600000,
//   recoveryAttempts: 0
// }
```

---

## ⚙️ Protection Thresholds

| Protection | Threshold | Action |
|------------|-----------|--------|
| Price Range | Symbol-specific (e.g., EURUSD: 0.90-1.40) | Reject candle |
| Velocity | 1% per second | Reject candle |
| Circuit Breaker | 3 events in 60s | Open circuit |
| Structure | high < low | Reject candle |
| Checksum | Mismatch | Reject candle |

---

## 🔧 Manual Recovery

### Reset Circuit Breaker
```sql
-- For specific symbol
SELECT reset_circuit_breaker('EURUSD');

-- Verify state
SELECT * FROM chart_circuit_breaker_state WHERE symbol = 'EURUSD';
```

### TypeScript Reset
```typescript
import { chartCircuitBreaker } from '@/services/chart-circuit-breaker';

// Reset specific symbol
chartCircuitBreaker.closeCircuit('EURUSD');

// Reset all circuits (emergency)
chartCircuitBreaker.reset();
```

---

## 📊 Key Metrics

### Price Ranges (Current)
- **EURUSD**: 0.90 - 1.40 (typical: 1.10)
- **XAUUSD**: 1800 - 3500 (typical: 2600)
- **US30**: 30000 - 50000 (typical: 39500)
- **GBPUSD**: 1.00 - 1.60 (typical: 1.27)
- **USDJPY**: 90 - 180 (typical: 149)

### Circuit Breaker Settings
- **Threshold**: 3 contamination events
- **Window**: 60 seconds
- **Cooldown**: 5 minutes
- **Auto-Recovery**: Disabled (manual only)

---

## 🎯 Protection Guarantees

✅ **No cross-symbol contamination** - Multiple validation layers prevent symbol mixing

✅ **No invalid prices** - Range and velocity checks reject impossible prices

✅ **No data corruption** - Immutable structures prevent accidental modifications

✅ **Automatic shutdown** - Circuit breaker stops bad data from spreading

✅ **Complete audit trail** - Every issue is logged and traceable

✅ **Defense in depth** - Failure in one layer won't compromise system

---

## 📁 Key Files

| File | Purpose |
|------|---------|
| `/src/types/symbol.ts` | Symbol validation & branded types |
| `/src/types/candle-immutable.ts` | Immutable candle structures |
| `/src/services/price-validation-service.ts` | Price range & velocity validation |
| `/src/services/chart-circuit-breaker.ts` | Circuit breaker system |
| `/src/services/chart-candle-poller.ts` | Protected polling service |
| `/src/components/MarketChart.tsx` | Protected chart component |

---

## 🆘 Support

**Issue**: Chart contamination detected
1. Check `v_contamination_summary` for details
2. Review stack traces in `chart_contamination_events`
3. Fix root cause
4. Reset circuit breaker

**Issue**: Circuit breaker won't close
1. Verify contamination source is fixed
2. Check `recovery_attempts` count
3. Clear contamination events
4. Manual reset: `reset_circuit_breaker(symbol)`

**Issue**: Valid prices being rejected
1. Check price ranges in `price-validation-service.ts`
2. Review velocity limits (1%/sec)
3. Check `candle_validation_failures` table
4. Adjust ranges if needed for symbol

---

## 🔗 Related Systems

- **Global Polling Coordinator**: Uses validated symbols
- **Chart Candle Poller**: Integrates circuit breaker
- **Market Chart Component**: Enforces type safety
- **Database Triggers**: Validates all writes
- **Price Validation Service**: Pre-database validation

---

**The chart is now bulletproof.** Multiple independent layers ensure that even if one protection fails, others will catch contamination before it reaches users. No more days of debugging cross-contamination issues!
