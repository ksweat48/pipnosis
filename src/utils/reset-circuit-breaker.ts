/**
 * Circuit Breaker Reset Utility
 *
 * Use this to manually reset the circuit breaker after fixing contamination issues.
 * This is available in the browser console for emergency use.
 */

import { chartCircuitBreaker } from '@/services/chart-circuit-breaker';
import { logger, LogCategory } from '@/lib/logger';

export function resetCircuitBreaker(symbol?: string): void {
  if (symbol) {
    chartCircuitBreaker.closeCircuit(symbol as any);
    logger.info(LogCategory.CHART, `✅ Circuit breaker reset for ${symbol}`);
    console.log(`✅ Circuit breaker reset for ${symbol} - Chart updates resumed`);
  } else {
    chartCircuitBreaker.reset();
    logger.info(LogCategory.CHART, '✅ All circuit breakers reset');
    console.log('✅ All circuit breakers reset - All chart updates resumed');
  }
}

export function getCircuitBreakerStatus(): any {
  const status = chartCircuitBreaker.getStatus();
  console.log('🔍 Circuit Breaker Status:', status);
  return status;
}

export function clearCircuitBreakerEvents(symbol?: string): void {
  if (symbol) {
    const events = chartCircuitBreaker.getEvents(symbol as any);
    console.log(`🗑️ Clearing ${events.length} events for ${symbol}`);
  }
  chartCircuitBreaker.reset();
  console.log('✅ All events cleared');
}

// Make available in console for emergency use
if (typeof window !== 'undefined') {
  (window as any).resetCircuitBreaker = resetCircuitBreaker;
  (window as any).getCircuitBreakerStatus = getCircuitBreakerStatus;
  (window as any).clearCircuitBreakerEvents = clearCircuitBreakerEvents;

  console.log('🛠️ Circuit breaker utilities loaded:');
  console.log('  - resetCircuitBreaker(symbol?)  - Reset circuit breaker');
  console.log('  - getCircuitBreakerStatus()     - Check status');
  console.log('  - clearCircuitBreakerEvents()   - Clear all events');
}
