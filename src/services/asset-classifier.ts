/**
 * Asset Classifier - Query Interface for Symbol Registry (SSOT)
 *
 * RESPONSIBILITY:
 * Provides a clean interface to query the SYMBOL_REGISTRY for asset properties.
 * This is the ONLY way to query asset classification - NO duplicate logic allowed.
 *
 * AUTHORITY:
 * Single source of truth for ALL asset property queries.
 *
 * PRINCIPLE:
 * If you need to know ANYTHING about a symbol's properties, ask this service.
 * NEVER hardcode symbol checks elsewhere.
 */

import {
  SYMBOL_REGISTRY,
  getSymbolConfig,
  type SymbolCategory,
  type MarketSchedule
} from '../config/symbol-registry';

class AssetClassifier {
  /**
   * Get asset category (forex, metal, index, energy)
   *
   * @throws Error if symbol not in registry (fail loudly, not silently)
   */
  getAssetCategory(symbol: string): SymbolCategory {
    const config = getSymbolConfig(symbol);
    if (!config) {
      throw new Error(`[Asset Classifier] Unknown symbol: ${symbol}. Symbol must be registered in SYMBOL_REGISTRY.`);
    }
    return config.category;
  }

  /**
   * Get market schedule
   *
   * @throws Error if symbol not in registry
   */
  getMarketSchedule(symbol: string): MarketSchedule {
    const config = getSymbolConfig(symbol);
    if (!config) {
      throw new Error(`[Asset Classifier] Unknown symbol: ${symbol}. Symbol must be registered in SYMBOL_REGISTRY.`);
    }
    return config.marketSchedule;
  }

  /**
   * Check if asset requires session-based trading logic
   *
   * Returns TRUE for all supported markets (forex, metals, indices, energy)
   */
  requiresSessions(_symbol: string): boolean {
    return true;
  }

  /**
   * Check if symbol is forex
   */
  isForex(symbol: string): boolean {
    const category = this.getAssetCategory(symbol);
    return category === 'forex';
  }

  /**
   * Check if symbol is metal
   */
  isMetal(symbol: string): boolean {
    const category = this.getAssetCategory(symbol);
    return category === 'metal';
  }

  /**
   * Check if symbol is index
   */
  isIndex(symbol: string): boolean {
    const category = this.getAssetCategory(symbol);
    return category === 'index';
  }

  /**
   * Check if symbol is energy
   */
  isEnergy(symbol: string): boolean {
    const category = this.getAssetCategory(symbol);
    return category === 'energy';
  }

  /**
   * Get full symbol configuration
   * Passthrough to registry with error handling
   */
  getSymbolConfig(symbol: string) {
    const config = getSymbolConfig(symbol);
    if (!config) {
      throw new Error(`[Asset Classifier] Unknown symbol: ${symbol}. Symbol must be registered in SYMBOL_REGISTRY.`);
    }
    return config;
  }

  /**
   * Validate symbol exists in registry
   */
  isKnownSymbol(symbol: string): boolean {
    return !!getSymbolConfig(symbol);
  }

  /**
   * Get all symbols by category
   */
  getSymbolsByCategory(category: SymbolCategory): string[] {
    return Object.keys(SYMBOL_REGISTRY).filter(
      symbol => SYMBOL_REGISTRY[symbol].category === category
    );
  }

  /**
   * Get all forex-hours symbols
   */
  getForexHoursSymbols(): string[] {
    return Object.keys(SYMBOL_REGISTRY).filter(
      symbol => SYMBOL_REGISTRY[symbol].marketSchedule === 'forex'
    );
  }
}

export const assetClassifier = new AssetClassifier();
