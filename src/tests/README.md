# Chart Protection System - Test Suite

## Overview

This test suite provides comprehensive automated testing for the chart protection system's cross-contamination detection and prevention capabilities.

## Test Files

### 1. `symbol-validation.test.ts`
**Layer 1: Type System Protection**

Tests the branded symbol type system and validation:
- Valid symbol acceptance
- Invalid symbol rejection
- Type safety enforcement
- Typo detection
- Symbol categorization
- Cross-contamination prevention at type level

**Coverage:**
- `validateSymbol()`
- `createValidatedSymbol()`
- `assertValidSymbol()`
- `isPrimarySymbol()`
- `getSymbolCategory()`

### 2. `candle-immutable.test.ts`
**Layer 2: Data Integrity Protection**

Tests immutable candle data structures:
- Candle creation and validation
- Immutability enforcement (Object.freeze)
- Checksum verification
- Symbol mismatch detection
- Array validation
- Clone and update operations

**Coverage:**
- `createImmutableCandle()`
- `validateCandle()`
- `verifyCandle()`
- `mergeCandles()`
- `validateCandleArray()`

### 3. `price-validation.test.ts`
**Layer 3: Range & Velocity Protection**

Tests price validation service:
- Symbol-specific price ranges
- Velocity validation (1%/sec max)
- Cross-contamination detection
- Candle structure validation
- Edge cases (NaN, Infinity, negatives)

**Coverage:**
- `validatePrice()`
- `validatePriceVelocity()`
- `detectPossibleSymbolMismatch()`
- `validateCandle()`

### 4. `circuit-breaker.test.ts`
**Layer 4: Automatic Shutdown Protection**

Tests circuit breaker system:
- Contamination event recording
- Circuit opening/closing
- Threshold enforcement
- Symbol-specific circuits
- Alert callbacks
- Recovery mechanisms

**Coverage:**
- `recordContamination()`
- `isUpdateAllowed()`
- `closeCircuit()`
- `onContamination()`
- `getStatus()`

### 5. `integration-contamination-detection.test.ts`
**End-to-End Integration Tests**

Tests the complete protection stack:
- Multi-layer validation
- Real-world contamination scenarios
- Cascade effects
- Symbol isolation
- Recovery workflows

**Scenarios Tested:**
- XAUUSD → EURUSD contamination
- US30 → EURUSD contamination
- Mixed symbol arrays
- Gradual buildup
- Burst contamination
- Recovery verification

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Specific Test File
```bash
npm test symbol-validation.test.ts
npm test candle-immutable.test.ts
npm test price-validation.test.ts
npm test circuit-breaker.test.ts
npm test integration-contamination-detection.test.ts
```

### Run with Coverage
```bash
npm test -- --coverage
```

### Watch Mode
```bash
npm test -- --watch
```

## Test Coverage Goals

| Layer | Component | Target Coverage |
|-------|-----------|----------------|
| Layer 1 | Symbol Validation | 100% |
| Layer 2 | Immutable Candles | 100% |
| Layer 3 | Price Validation | 100% |
| Layer 4 | Circuit Breaker | 95% |
| Integration | Full Stack | 90% |

## Key Test Scenarios

### 1. Cross-Contamination Detection
Tests verify that the system detects when:
- XAUUSD prices (1800-3500) appear in EURUSD context (0.90-1.40)
- US30 prices (30000-50000) appear in EURUSD context
- USDJPY prices (90-180) appear in EURUSD context
- Any symbol's data leaks into another symbol's processing

### 2. Protection Layer Cascade
Tests verify that contamination is caught at multiple layers:
1. Type system prevents symbol mixing
2. Price validation rejects out-of-range values
3. Circuit breaker stops repeated contamination
4. Database constraints block invalid data

### 3. Circuit Breaker Behavior
Tests verify circuit breaker operates correctly:
- Opens after 3 events in 60 seconds
- Isolates problems per symbol
- Blocks updates when open
- Requires manual recovery
- Triggers alerts

### 4. Data Integrity
Tests verify data cannot be corrupted:
- Candles are immutable (Object.freeze)
- Checksums detect tampering
- Updates create new objects
- Symbol tags prevent mixing

## Contamination Test Patterns

### Pattern 1: Direct Price Mismatch
```typescript
// XAUUSD price in EURUSD - should be detected
validatePrice('EURUSD', 2600) // ❌ REJECTED
detectPossibleSymbolMismatch('EURUSD', 2600) // Returns 'XAUUSD'
```

### Pattern 2: Candle Contamination
```typescript
// XAUUSD candle with EURUSD symbol - should fail
createImmutableCandle(
  EURUSD,
  timestamp,
  2600, 2610, 2590, 2605, // XAUUSD prices
  'database'
) // ❌ THROWS ERROR
```

### Pattern 3: Array Mixing
```typescript
// Mixed symbol array - should be detected
validateCandleArray(
  [eurusdCandle, xauusdCandle],
  EURUSD
) // ❌ INVALID
```

### Pattern 4: Circuit Breaker Trigger
```typescript
// 3 contamination events - circuit opens
for (let i = 0; i < 3; i++) {
  recordContamination(XAUUSD, EURUSD, 'Source', data);
}
isUpdateAllowed(EURUSD) // false - circuit open
```

## Expected Test Results

All tests should pass with these expectations:

✅ **Type System**: 100% of symbol validation tests pass
✅ **Immutable Data**: 100% of candle integrity tests pass
✅ **Price Validation**: 100% of range/velocity tests pass
✅ **Circuit Breaker**: 95%+ of shutdown tests pass
✅ **Integration**: 90%+ of end-to-end tests pass

## Debugging Failed Tests

If tests fail:

1. Check symbol validation first
2. Verify price ranges are correct
3. Ensure circuit breaker threshold settings
4. Review test data for typos
5. Check for timing issues in velocity tests

## Adding New Tests

When adding new protection features:

1. Add unit tests to appropriate file
2. Add integration test for full stack
3. Update this README
4. Ensure >90% coverage
5. Test real contamination scenarios

## Mock Data

Tests use these standardized values:

| Symbol | Valid Range | Test Price | Contamination Price |
|--------|-------------|------------|-------------------|
| EURUSD | 0.90-1.40 | 1.1050 | 2600 (XAUUSD) |
| XAUUSD | 1800-3500 | 2600 | 1.1050 (EURUSD) |
| US30 | 30000-50000 | 39500 | 1.1050 (EURUSD) |
| GBPUSD | 1.00-1.60 | 1.2750 | N/A |
| USDJPY | 90-180 | 149.50 | 1.1050 (EURUSD) |

## Continuous Integration

Tests run automatically on:
- Every commit
- Pull requests
- Pre-deployment
- Scheduled nightly builds

## Test Maintenance

Update tests when:
- Adding new symbols
- Changing price ranges
- Modifying circuit breaker thresholds
- Enhancing validation logic
- Fixing contamination bugs

## Support

For test failures or questions:
1. Review test output for specific assertion failures
2. Check `CHART_PROTECTION_QUICK_REFERENCE.md` for system behavior
3. Review `CHART_PROTECTION_ARCHITECTURE.md` for design
4. Check contamination event logs in database

---

**The test suite ensures the chart protection system remains bulletproof against cross-contamination at all times.**
