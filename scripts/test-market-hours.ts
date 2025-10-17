/**
 * Test script to verify market hours logic
 * Tests various day/time scenarios to ensure correct market open/close detection
 */

import { marketHoursService } from '../src/services/market-hours';

console.log('🕐 Testing Market Hours Detection\n');
console.log('=' .repeat(80));

// Test scenarios
const testCases = [
  // === DST PERIOD (EDT - October) ===
  // Saturday (all day closed)
  { date: new Date('2025-10-18T12:00:00Z'), expected: false, desc: '[EDT] Saturday 12:00 UTC' },

  // Sunday before market opens (21:00 UTC during EDT)
  { date: new Date('2025-10-19T10:00:00Z'), expected: false, desc: '[EDT] Sunday 10:00 UTC (before open)' },
  { date: new Date('2025-10-19T20:59:00Z'), expected: false, desc: '[EDT] Sunday 20:59 UTC (1 min before open)' },

  // Sunday market opens at 21:00 UTC during EDT (5:00 PM EDT)
  { date: new Date('2025-10-19T21:00:00Z'), expected: true, desc: '[EDT] Sunday 21:00 UTC (5:00 PM EDT - market opens!)' },
  { date: new Date('2025-10-19T23:30:00Z'), expected: true, desc: '[EDT] Sunday 23:30 UTC (after open)' },

  // Monday through Thursday (all day open)
  { date: new Date('2025-10-20T08:00:00Z'), expected: true, desc: '[EDT] Monday 08:00 UTC' },
  { date: new Date('2025-10-21T14:00:00Z'), expected: true, desc: '[EDT] Tuesday 14:00 UTC' },
  { date: new Date('2025-10-22T20:00:00Z'), expected: true, desc: '[EDT] Wednesday 20:00 UTC' },
  { date: new Date('2025-10-23T02:00:00Z'), expected: true, desc: '[EDT] Thursday 02:00 UTC' },

  // Friday before market closes (21:00 UTC during EDT)
  { date: new Date('2025-10-24T10:00:00Z'), expected: true, desc: '[EDT] Friday 10:00 UTC (before close)' },
  { date: new Date('2025-10-24T20:59:00Z'), expected: true, desc: '[EDT] Friday 20:59 UTC (1 min before close)' },

  // Friday market closes at 21:00 UTC during EDT (5:00 PM EDT)
  { date: new Date('2025-10-24T21:00:00Z'), expected: false, desc: '[EDT] Friday 21:00 UTC (5:00 PM EDT - market closes!)' },
  { date: new Date('2025-10-24T23:30:00Z'), expected: false, desc: '[EDT] Friday 23:30 UTC (after close)' },

  // === STANDARD TIME PERIOD (EST - January) ===
  // Saturday (all day closed)
  { date: new Date('2025-01-18T12:00:00Z'), expected: false, desc: '[EST] Saturday 12:00 UTC' },

  // Sunday before market opens (22:00 UTC during EST)
  { date: new Date('2025-01-19T10:00:00Z'), expected: false, desc: '[EST] Sunday 10:00 UTC (before open)' },
  { date: new Date('2025-01-19T21:59:00Z'), expected: false, desc: '[EST] Sunday 21:59 UTC (1 min before open)' },

  // Sunday market opens at 22:00 UTC during EST (5:00 PM EST)
  { date: new Date('2025-01-19T22:00:00Z'), expected: true, desc: '[EST] Sunday 22:00 UTC (5:00 PM EST - market opens!)' },
  { date: new Date('2025-01-19T23:30:00Z'), expected: true, desc: '[EST] Sunday 23:30 UTC (after open)' },

  // Friday before market closes (22:00 UTC during EST)
  { date: new Date('2025-01-24T10:00:00Z'), expected: true, desc: '[EST] Friday 10:00 UTC (before close)' },
  { date: new Date('2025-01-24T21:59:00Z'), expected: true, desc: '[EST] Friday 21:59 UTC (1 min before close)' },

  // Friday market closes at 22:00 UTC during EST (5:00 PM EST)
  { date: new Date('2025-01-24T22:00:00Z'), expected: false, desc: '[EST] Friday 22:00 UTC (5:00 PM EST - market closes!)' },
  { date: new Date('2025-01-24T23:30:00Z'), expected: false, desc: '[EST] Friday 23:30 UTC (after close)' },
];

let passed = 0;
let failed = 0;

console.log('\nRunning test cases:\n');

for (const testCase of testCases) {
  const result = marketHoursService.isMarketOpen(testCase.date);
  const status = result === testCase.expected ? '✅ PASS' : '❌ FAIL';
  const statusMessage = marketHoursService.getMarketStatusMessage(testCase.date);

  console.log(`${status} | ${testCase.desc}`);
  console.log(`         Expected: ${testCase.expected ? 'OPEN' : 'CLOSED'}, Got: ${result ? 'OPEN' : 'CLOSED'}`);
  console.log(`         Message: "${statusMessage}"`);
  console.log('');

  if (result === testCase.expected) {
    passed++;
  } else {
    failed++;
  }
}

console.log('=' .repeat(80));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${testCases.length} tests\n`);

if (failed === 0) {
  console.log('✨ All tests passed! Market hours logic is working correctly.\n');
} else {
  console.log('⚠️  Some tests failed. Please review the implementation.\n');
  process.exit(1);
}
