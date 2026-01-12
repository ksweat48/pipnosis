/**
 * Trading Units - Type-Safe Branded Types for Financial Mathematics
 *
 * This module provides compile-time and runtime type safety to prevent unit mixing errors.
 * Using TypeScript's branded types pattern, we ensure that dollars cannot be accidentally
 * treated as pips, lots as prices, etc.
 *
 * ARCHITECTURE PRINCIPLE:
 * All trade-related calculations must use these branded types. Raw numbers are only
 * permitted within the SSOT tradeMath module. Business logic, Omegas, and execution
 * layers MUST use branded types to ensure correctness.
 */

// Branded type declarations
declare const __brand: unique symbol;

type Brand<T, TBrand> = T & { [__brand]: TBrand };

/**
 * Dollars - USD currency amounts
 * Use for: P&L, risk amounts, account balance
 */
export type Dollars = Brand<number, 'Dollars'>;

/**
 * Pips - Standardized market movement units
 * Use for: Stop loss distances, take profit targets, ATR measurements
 */
export type Pips = Brand<number, 'Pips'>;

/**
 * Lots - Position size in standard lots
 * Use for: Order quantities, position sizing
 */
export type Lots = Brand<number, 'Lots'>;

/**
 * Price - Absolute price levels
 * Use for: Entry prices, current market prices, SL/TP levels
 */
export type Price = Brand<number, 'Price'>;

// Validation ranges
const MAX_REASONABLE_LOTS = 100;
const MIN_LOTS = 0.0001;
const MAX_REASONABLE_DOLLARS = 1000000;
const MAX_REASONABLE_PIPS = 10000;

// Constructor functions with validation
export function dollars(value: number): Dollars {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid dollar amount: ${value} (must be finite)`);
  }
  if (value < -MAX_REASONABLE_DOLLARS || value > MAX_REASONABLE_DOLLARS) {
    throw new Error(`Dollar amount out of range: ${value} (max ±${MAX_REASONABLE_DOLLARS})`);
  }
  return value as Dollars;
}

export function pips(value: number): Pips {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid pip value: ${value} (must be finite)`);
  }
  if (Math.abs(value) > MAX_REASONABLE_PIPS) {
    throw new Error(`Pip value out of range: ${value} (max ±${MAX_REASONABLE_PIPS})`);
  }
  return value as Pips;
}

export function lots(value: number): Lots {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid lot size: ${value} (must be finite)`);
  }
  if (value < 0) {
    throw new Error(`Lot size must be positive: ${value}`);
  }
  if (value < MIN_LOTS) {
    throw new Error(`Lot size too small: ${value} (min ${MIN_LOTS})`);
  }
  if (value > MAX_REASONABLE_LOTS) {
    throw new Error(`Lot size out of range: ${value} (max ${MAX_REASONABLE_LOTS})`);
  }
  return value as Lots;
}

export function price(value: number): Price {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid price: ${value} (must be finite)`);
  }
  if (value <= 0) {
    throw new Error(`Price must be positive: ${value}`);
  }
  return value as Price;
}

// Safe unwrap functions for interop with untyped code
export function unwrapDollars(value: Dollars): number {
  return value as number;
}

export function unwrapPips(value: Pips): number {
  return value as number;
}

export function unwrapLots(value: Lots): number {
  return value as number;
}

export function unwrapPrice(value: Price): number {
  return value as number;
}

// Type guards for runtime validation
export function isDollars(value: unknown): value is Dollars {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isPips(value: unknown): value is Pips {
  return typeof value === 'number' && Number.isFinite(value);
}

export function isLots(value: unknown): value is Lots {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function isPrice(value: unknown): value is Price {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

// Arithmetic operations that preserve types
export const DollarsOps = {
  add: (a: Dollars, b: Dollars): Dollars => dollars(unwrapDollars(a) + unwrapDollars(b)),
  subtract: (a: Dollars, b: Dollars): Dollars => dollars(unwrapDollars(a) - unwrapDollars(b)),
  multiply: (a: Dollars, scalar: number): Dollars => dollars(unwrapDollars(a) * scalar),
  divide: (a: Dollars, scalar: number): Dollars => dollars(unwrapDollars(a) / scalar),
  abs: (a: Dollars): Dollars => dollars(Math.abs(unwrapDollars(a))),
  negate: (a: Dollars): Dollars => dollars(-unwrapDollars(a)),
};

export const PipsOps = {
  add: (a: Pips, b: Pips): Pips => pips(unwrapPips(a) + unwrapPips(b)),
  subtract: (a: Pips, b: Pips): Pips => pips(unwrapPips(a) - unwrapPips(b)),
  multiply: (a: Pips, scalar: number): Pips => pips(unwrapPips(a) * scalar),
  divide: (a: Pips, scalar: number): Pips => pips(unwrapPips(a) / scalar),
  abs: (a: Pips): Pips => pips(Math.abs(unwrapPips(a))),
};

export const LotsOps = {
  add: (a: Lots, b: Lots): Lots => lots(unwrapLots(a) + unwrapLots(b)),
  multiply: (a: Lots, scalar: number): Lots => lots(unwrapLots(a) * scalar),
  divide: (a: Lots, scalar: number): Lots => lots(unwrapLots(a) / scalar),
};

export const PriceOps = {
  subtract: (a: Price, b: Price): number => unwrapPrice(a) - unwrapPrice(b),
  abs: (a: Price): Price => price(Math.abs(unwrapPrice(a))),
};

// Formatting utilities
export function formatDollars(value: Dollars, decimals: number = 2): string {
  return `$${unwrapDollars(value).toFixed(decimals)}`;
}

export function formatPips(value: Pips, decimals: number = 1): string {
  return `${unwrapPips(value).toFixed(decimals)} pips`;
}

export function formatLots(value: Lots, decimals: number = 2): string {
  return `${unwrapLots(value).toFixed(decimals)} lots`;
}

export function formatPrice(value: Price, decimals: number): string {
  return unwrapPrice(value).toFixed(decimals);
}
