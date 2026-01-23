#!/usr/bin/env node
/**
 * Verify Floating-Point Validation Fix
 *
 * Tests that boundary values (1% and 10%) pass validation
 * after rounding to cents.
 */

const TRADING_CONSTANTS = {
  RISK_PERCENTAGES: {
    MIN_PER_TRADE: 0.01,
    MAX_PER_TRADE: 0.10,
  }
};

function validateDollarAmount(amount, accountBalance) {
  if (amount <= 0) {
    return { valid: false, error: 'Risk amount must be greater than $0' };
  }

  if (accountBalance <= 0) {
    return { valid: false, error: 'Invalid account balance' };
  }

  const percentOfAccount = (amount / accountBalance) * 100;
  const maxRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE * 100;
  const minRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE * 100;

  // FLOATING-POINT TOLERANCE: Allow 0.01% epsilon for rounding errors
  const EPSILON = 0.01;

  if (percentOfAccount > maxRiskPercent + EPSILON) {
    return {
      valid: false,
      error: `Risk amount cannot exceed ${maxRiskPercent}% of account balance`,
    };
  }

  if (percentOfAccount < minRiskPercent - EPSILON) {
    return {
      valid: false,
      error: `Risk amount must be at least ${minRiskPercent}% of account balance`,
    };
  }

  return { valid: true };
}

console.log('\n🧪 Testing Floating-Point Validation Fix\n');
console.log('=' .repeat(60));

const testCases = [
  {
    name: 'SCALP Conservative (1%)',
    amount: 55.29,
    balance: 5529.47,
    expectedValid: true,
    actualPercent: (55.29 / 5529.47 * 100).toFixed(6)
  },
  {
    name: 'SCALP Balanced (2%)',
    amount: 110.59,
    balance: 5529.47,
    expectedValid: true,
    actualPercent: (110.59 / 5529.47 * 100).toFixed(6)
  },
  {
    name: 'INTRADAY Aggressive (10%)',
    amount: 552.95,
    balance: 5529.47,
    expectedValid: true,
    actualPercent: (552.95 / 5529.47 * 100).toFixed(6)
  },
  {
    name: 'Below minimum (0.98%)',
    amount: 54.00,
    balance: 5529.47,
    expectedValid: false,
    actualPercent: (54.00 / 5529.47 * 100).toFixed(6)
  },
  {
    name: 'Above maximum (10.05%)',
    amount: 556.00,
    balance: 5529.47,
    expectedValid: false,
    actualPercent: (556.00 / 5529.47 * 100).toFixed(6)
  },
  {
    name: 'Exact 1%',
    amount: 100.00,
    balance: 10000.00,
    expectedValid: true,
    actualPercent: (100.00 / 10000.00 * 100).toFixed(6)
  },
  {
    name: 'Exact 10%',
    amount: 1000.00,
    balance: 10000.00,
    expectedValid: true,
    actualPercent: (1000.00 / 10000.00 * 100).toFixed(6)
  }
];

let passed = 0;
let failed = 0;

testCases.forEach((testCase, index) => {
  const result = validateDollarAmount(testCase.amount, testCase.balance);
  const success = result.valid === testCase.expectedValid;

  if (success) {
    passed++;
    console.log(`\n✅ Test ${index + 1}: ${testCase.name}`);
  } else {
    failed++;
    console.log(`\n❌ Test ${index + 1}: ${testCase.name}`);
  }

  console.log(`   Amount: $${testCase.amount}`);
  console.log(`   Balance: $${testCase.balance}`);
  console.log(`   Actual %: ${testCase.actualPercent}%`);
  console.log(`   Expected: ${testCase.expectedValid ? 'VALID' : 'INVALID'}`);
  console.log(`   Got: ${result.valid ? 'VALID' : 'INVALID'}`);

  if (result.error) {
    console.log(`   Error: ${result.error}`);
  }
});

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('✅ All tests passed! Validation fix is working correctly.\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Fix needs review.\n');
  process.exit(1);
}
