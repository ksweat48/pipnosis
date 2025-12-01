/**
 * Jest test setup file
 * Runs before all tests
 */

// Mock browser APIs
global.Notification = {
  permission: 'granted',
} as any;

// Mock window.dispatchEvent for custom events
global.window = {
  ...global.window,
  dispatchEvent: jest.fn(),
} as any;

// Setup Jest timers
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

// Suppress console errors in tests (optional)
// global.console.error = jest.fn();

// Add custom matchers if needed
expect.extend({
  toBeValidSymbol(received: any) {
    const pass = typeof received === 'string' && received.length > 0;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be a valid symbol`
          : `expected ${received} to be a valid symbol`,
    };
  },
});
