/**
 * Position Sizing Test Suite
 *
 * Tests the corrected position sizing formula across all major currency pairs,
 * metals, and indices to ensure proper risk calculation.
 */

import { calculatePositionSize, getCurrencyPipInfo, calculateDollarPerPip, calculatePipDistance } from './currencyHelpers';

interface TestCase {
  symbol: string;
  accountBalance: number;
  riskPercent: number;
  entryPrice: number;
  stopLoss: number;
  expectedLotRange: { min: number; max: number };
  description: string;
}

const testCases: TestCase[] = [
  // XAUUSD (Gold) - The critical fix
  {
    symbol: 'XAUUSD',
    accountBalance: 10000,
    riskPercent: 2,
    entryPrice: 4157.75,
    stopLoss: 4161.67,
    expectedLotRange: { min: 0.04, max: 0.06 },
    description: 'XAUUSD with 3.92 pip stop should risk $200 (2%)'
  },
  {
    symbol: 'XAUUSD',
    accountBalance: 10000,
    riskPercent: 5,
    entryPrice: 2000.00,
    stopLoss: 1990.00,
    expectedLotRange: { min: 0.04, max: 0.06 },
    description: 'XAUUSD with 10 point (1000 pip) stop should risk $500 (5%)'
  },

  // Standard Forex Pairs (EURUSD, GBPUSD, etc.)
  {
    symbol: 'EURUSD',
    accountBalance: 10000,
    riskPercent: 2,
    entryPrice: 1.1000,
    stopLoss: 1.0980,
    expectedLotRange: { min: 0.09, max: 0.11 },
    description: 'EURUSD with 20 pip stop should risk $200 (2%)'
  },
  {
    symbol: 'GBPUSD',
    accountBalance: 10000,
    riskPercent: 3,
    entryPrice: 1.2500,
    stopLoss: 1.2470,
    expectedLotRange: { min: 0.09, max: 0.11 },
    description: 'GBPUSD with 30 pip stop should risk $300 (3%)'
  },

  // JPY Pairs
  {
    symbol: 'USDJPY',
    accountBalance: 10000,
    riskPercent: 2,
    entryPrice: 149.50,
    stopLoss: 149.20,
    expectedLotRange: { min: 0.06, max: 0.08 },
    description: 'USDJPY with 30 pip stop should risk $200 (2%)'
  },
  {
    symbol: 'EURJPY',
    accountBalance: 10000,
    riskPercent: 5,
    entryPrice: 162.00,
    stopLoss: 161.50,
    expectedLotRange: { min: 0.09, max: 0.11 },
    description: 'EURJPY with 50 pip stop should risk $500 (5%)'
  },

  // Indices
  {
    symbol: 'US30',
    accountBalance: 10000,
    riskPercent: 2,
    entryPrice: 42000,
    stopLoss: 41950,
    expectedLotRange: { min: 0.03, max: 0.05 },
    description: 'US30 with 50 point stop should risk $200 (2%)'
  },

  // Crypto pairs
  {
    symbol: 'BTCUSD',
    accountBalance: 10000,
    riskPercent: 2,
    entryPrice: 87800,
    stopLoss: 87700,
    expectedLotRange: { min: 1.90, max: 2.10 },
    description: 'BTCUSD with 100 pip stop should risk $200 (2%)'
  },
  {
    symbol: 'ETHUSD',
    accountBalance: 10000,
    riskPercent: 3,
    entryPrice: 3200,
    stopLoss: 3180,
    expectedLotRange: { min: 1.40, max: 1.60 },
    description: 'ETHUSD with 20 point (200 pip) stop should risk $300 (3%)'
  },

  // Edge Cases
  {
    symbol: 'XAUUSD',
    accountBalance: 10000,
    riskPercent: 5,
    entryPrice: 2000.00,
    stopLoss: 2005.00,
    expectedLotRange: { min: 0.09, max: 0.11 },
    description: 'XAUUSD with tiny 5 point stop should still respect 5% max risk'
  },
  {
    symbol: 'EURUSD',
    accountBalance: 1000,
    riskPercent: 1,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    expectedLotRange: { min: 0.01, max: 0.03 },
    description: 'Small account with tight stop should use minimum lot size'
  }
];

export function runPositionSizingTests(): void {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  POSITION SIZING TEST SUITE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  let passed = 0;
  let failed = 0;

  for (const test of testCases) {
    console.log(`\n📋 Test: ${test.description}`);
    console.log(`   Symbol: ${test.symbol}`);
    console.log(`   Account: $${test.accountBalance.toFixed(2)}`);
    console.log(`   Risk: ${test.riskPercent}% = $${(test.accountBalance * test.riskPercent / 100).toFixed(2)}`);
    console.log(`   Entry: ${test.entryPrice} | SL: ${test.stopLoss}`);

    try {
      // Calculate position size
      const positionSize = calculatePositionSize(
        test.symbol,
        test.accountBalance,
        test.riskPercent,
        test.entryPrice,
        test.stopLoss
      );

      // Get pip info
      const pipInfo = getCurrencyPipInfo(test.symbol);
      const stopDistancePips = calculatePipDistance(test.symbol, test.entryPrice, test.stopLoss);
      const dollarPerPip = calculateDollarPerPip(test.symbol, positionSize);

      // Calculate actual risk
      const actualRiskDollars = stopDistancePips * dollarPerPip;
      const actualRiskPercent = (actualRiskDollars / test.accountBalance) * 100;
      const targetRiskDollars = test.accountBalance * (test.riskPercent / 100);
      const riskError = Math.abs(actualRiskDollars - targetRiskDollars);
      const riskErrorPercent = (riskError / targetRiskDollars) * 100;

      console.log(`\n   📊 Results:`);
      console.log(`      Position Size: ${positionSize.toFixed(3)} lots`);
      console.log(`      Stop Distance: ${stopDistancePips.toFixed(1)} pips`);
      console.log(`      Dollar/Pip: $${dollarPerPip.toFixed(2)}`);
      console.log(`      Target Risk: $${targetRiskDollars.toFixed(2)}`);
      console.log(`      Actual Risk: $${actualRiskDollars.toFixed(2)} (${actualRiskPercent.toFixed(2)}%)`);
      console.log(`      Error: $${riskError.toFixed(2)} (${riskErrorPercent.toFixed(1)}%)`);

      // Validate results
      const isWithinRange = positionSize >= test.expectedLotRange.min &&
                           positionSize <= test.expectedLotRange.max;
      const isRiskAccurate = riskErrorPercent < 10; // Allow 10% error margin
      const isRiskSafe = actualRiskPercent <= 5.5; // Hard 5.5% maximum

      if (isWithinRange && isRiskAccurate && isRiskSafe) {
        console.log(`   ✅ PASS - Position size and risk calculation correct`);
        passed++;
      } else {
        console.log(`   ❌ FAIL - Validation failed:`);
        if (!isWithinRange) {
          console.log(`      - Position size ${positionSize.toFixed(3)} outside expected range [${test.expectedLotRange.min}, ${test.expectedLotRange.max}]`);
        }
        if (!isRiskAccurate) {
          console.log(`      - Risk error ${riskErrorPercent.toFixed(1)}% exceeds 10% tolerance`);
        }
        if (!isRiskSafe) {
          console.log(`      - Risk ${actualRiskPercent.toFixed(2)}% exceeds 5.5% safety limit!`);
        }
        failed++;
      }
    } catch (error) {
      console.log(`   ❌ FAIL - Exception: ${error instanceof Error ? error.message : 'Unknown error'}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  TEST RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.error('⚠️  CRITICAL: Some tests failed! Position sizing may be incorrect.');
  } else {
    console.log('✅ SUCCESS: All position sizing tests passed!');
  }
}

// Run tests if executed directly
if (typeof window === 'undefined') {
  runPositionSizingTests();
}
