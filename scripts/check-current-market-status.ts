/**
 * Quick check of current market status
 */

import { marketHoursService } from '../src/services/market-hours';

const now = new Date();

console.log('🕐 Current Market Status Check\n');
console.log('='.repeat(80));
console.log(`\nCurrent Time:`);
console.log(`  Local: ${now.toString()}`);
console.log(`  UTC: ${now.toUTCString()}`);
console.log(`  ISO: ${now.toISOString()}`);

const isOpen = marketHoursService.isMarketOpen(now);
const statusMessage = marketHoursService.getMarketStatusMessage(now);

console.log(`\nMarket Status: ${isOpen ? '🟢 OPEN' : '🔴 CLOSED'}`);
console.log(`Status Message: "${statusMessage}"`);

console.log('\n' + '='.repeat(80));
console.log('\nDone!\n');
