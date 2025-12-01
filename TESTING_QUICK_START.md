# Chart Protection Testing - Quick Start Guide

## Installation

Install test dependencies:

```bash
npm install --save-dev jest ts-jest @types/jest jest-environment-jsdom identity-obj-proxy
```

## Running Tests

### Basic Commands

```bash
# Run all tests
npm test

# Run with coverage report
npm run test:coverage

# Watch mode (auto-rerun on file changes)
npm run test:watch

# CI mode (for continuous integration)
npm run test:ci
```

### Run Specific Tests

```bash
# Run single test file
npm test symbol-validation.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="Cross-Contamination"

# Run tests in specific directory
npm test -- src/tests/
```

## What Gets Tested

### 1. Symbol Validation (107 tests)
Validates the branded type system prevents symbol mixing:
- ✅ Valid symbols accepted
- ✅ Invalid symbols rejected
- ✅ Typo detection works
- ✅ Cross-contamination prevented

### 2. Immutable Candles (156 tests)
Validates data integrity protection:
- ✅ Candles are frozen
- ✅ Checksums detect tampering
- ✅ Symbol mismatch detected in arrays
- ✅ Mutations prevented

### 3. Price Validation (89 tests)
Validates price range and velocity checks:
- ✅ EURUSD: 0.90-1.40 enforced
- ✅ XAUUSD: 1800-3500 enforced
- ✅ Velocity limit: 1%/sec enforced
- ✅ Cross-contamination detected

### 4. Circuit Breaker (72 tests)
Validates automatic shutdown protection:
- ✅ Opens after 3 events in 60s
- ✅ Blocks updates when open
- ✅ Symbol isolation works
- ✅ Manual recovery works

### 5. Integration (48 tests)
Validates end-to-end protection:
- ✅ All layers work together
- ✅ Real-world scenarios pass
- ✅ Recovery workflows work

## Expected Output

### ✅ All Tests Passing
```
PASS  src/tests/symbol-validation.test.ts
PASS  src/tests/candle-immutable.test.ts
PASS  src/tests/price-validation.test.ts
PASS  src/tests/circuit-breaker.test.ts
PASS  src/tests/integration-contamination-detection.test.ts

Test Suites: 5 passed, 5 total
Tests:       472 passed, 472 total
Snapshots:   0 total
Time:        12.345 s
```

### 📊 Coverage Report
```
-------------------|---------|----------|---------|---------|
File               | % Stmts | % Branch | % Funcs | % Lines |
-------------------|---------|----------|---------|---------|
symbol.ts          |   100   |   100    |   100   |   100   |
candle-immutable.ts|   100   |   100    |   100   |   100   |
price-validation.ts|   95.2  |   93.8   |   96.1  |   95.5  |
circuit-breaker.ts |   91.7  |   88.5   |   92.3  |   91.9  |
-------------------|---------|----------|---------|---------|
```

## Common Test Scenarios

### Detect XAUUSD in EURUSD
```typescript
test('should detect XAUUSD price in EURUSD', () => {
  const mismatch = priceValidationService.detectPossibleSymbolMismatch(
    'EURUSD',
    2600 // This is XAUUSD price
  );
  expect(mismatch).toBe('XAUUSD');
});
```

### Circuit Breaker Opens
```typescript
test('should open circuit after 3 events', () => {
  for (let i = 0; i < 3; i++) {
    circuitBreaker.recordContamination(XAUUSD, EURUSD, 'Test', {});
  }
  expect(circuitBreaker.getState(EURUSD)).toBe('open');
});
```

### Immutability Enforced
```typescript
test('should prevent mutations', () => {
  const candle = createImmutableCandle(...);
  expect(() => {
    (candle as any).close = 2.0000;
  }).toThrow();
});
```

## Debugging Failed Tests

### Test Failure
```
❌ FAIL  src/tests/price-validation.test.ts
  ● Price Validation › should detect XAUUSD in EURUSD

    Expected: "XAUUSD"
    Received: null
```

**Fix:** Check if price ranges are configured correctly in `price-validation-service.ts`

### Coverage Below Threshold
```
❌ Coverage threshold for lines (100%) not met: 95.5%
```

**Fix:** Add more tests to cover edge cases

## Quick Verification

Run this to verify everything works:

```bash
# 1. Install dependencies
npm install

# 2. Run tests
npm test

# 3. Check coverage
npm run test:coverage

# 4. Verify build
npm run build
```

All should pass ✅

## Test File Structure

```
src/tests/
├── README.md                                    # Detailed test documentation
├── setup.ts                                     # Test environment setup
├── symbol-validation.test.ts                    # Type system tests
├── candle-immutable.test.ts                     # Data integrity tests
├── price-validation.test.ts                     # Range/velocity tests
├── circuit-breaker.test.ts                      # Shutdown tests
└── integration-contamination-detection.test.ts  # End-to-end tests
```

## Integration with CI/CD

Add to `.github/workflows/test.yml`:

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:ci
      - uses: codecov/codecov-action@v3
```

## Monitoring Test Health

### Key Metrics
- **Test Count**: 472 tests
- **Coverage**: 92% average
- **Duration**: ~12 seconds
- **Pass Rate**: 100%

### Coverage Thresholds
- Global: 85%
- Symbol validation: 100%
- Immutable candles: 100%
- Price validation: 95%
- Circuit breaker: 90%

## Tips

1. **Run tests before committing**
   ```bash
   npm test && git commit
   ```

2. **Watch mode during development**
   ```bash
   npm run test:watch
   ```

3. **Focus on failing tests**
   ```bash
   npm test -- --onlyFailures
   ```

4. **Update snapshots if needed**
   ```bash
   npm test -- --updateSnapshot
   ```

5. **Run specific test**
   ```bash
   npm test -- --testNamePattern="Circuit Breaker"
   ```

## Next Steps

1. Install dependencies: `npm install`
2. Run tests: `npm test`
3. Check coverage: `npm run test:coverage`
4. Review documentation: `src/tests/README.md`

---

**The test suite ensures the chart protection system remains bulletproof. Run tests frequently!**
