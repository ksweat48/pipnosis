/**
 * Asset Class Mapper - SSOT for Symbol Category Filtering
 *
 * Maps asset class selections to specific symbols using SYMBOL_REGISTRY.
 * Ensures consistent categorization across the platform.
 */

import { SYMBOL_REGISTRY, SymbolCategory } from '../config/symbol-registry';
import { DEFAULT_WATCHLIST } from '../config/watchlist';

export type AssetClass = 'forex' | 'indices' | 'gold';

const CATEGORY_TO_ASSET_CLASS: Record<SymbolCategory, AssetClass> = {
  'forex': 'forex',
  'index': 'indices',
  'metal': 'gold',
  'energy': 'forex'
};

const ASSET_CLASS_TO_CATEGORY: Record<AssetClass, SymbolCategory[]> = {
  'forex': ['forex'],
  'indices': ['index'],
  'gold': ['metal']
};

export interface AssetClassInfo {
  assetClass: AssetClass;
  displayName: string;
  symbols: string[];
  description: string;
  emoji: string;
}

export function getAssetClassInfo(): AssetClassInfo[] {
  const info: AssetClassInfo[] = [
    {
      assetClass: 'forex',
      displayName: 'Forex',
      symbols: getSymbolsByAssetClass(['forex']),
      description: 'Major currency pairs',
      emoji: '💱'
    },
    {
      assetClass: 'indices',
      displayName: 'Indices',
      symbols: getSymbolsByAssetClass(['indices']),
      description: 'Stock market indices',
      emoji: '📊'
    },
    {
      assetClass: 'gold',
      displayName: 'Gold',
      symbols: getSymbolsByAssetClass(['gold']),
      description: 'Precious metals',
      emoji: '🥇'
    }
  ];

  return info;
}

export function getSymbolsByAssetClass(assetClasses: AssetClass[]): string[] {
  const categories = assetClasses.flatMap(ac => ASSET_CLASS_TO_CATEGORY[ac] || []);

  return DEFAULT_WATCHLIST.filter(symbol => {
    const config = SYMBOL_REGISTRY[symbol];
    return config && categories.includes(config.category);
  });
}

export function getAssetClassForSymbol(symbol: string): AssetClass | null {
  const config = SYMBOL_REGISTRY[symbol];
  if (!config) return null;

  return CATEGORY_TO_ASSET_CLASS[config.category] || null;
}

export function filterWatchlistByAssetClass(
  watchlist: string[],
  assetClasses: AssetClass[]
): string[] {
  const allowedSymbols = getSymbolsByAssetClass(assetClasses);
  return watchlist.filter(symbol => allowedSymbols.includes(symbol));
}

export function validateAssetClassSelection(assetClasses: AssetClass[]): {
  valid: boolean;
  error?: string;
  symbolCount: number;
} {
  if (!assetClasses || assetClasses.length === 0) {
    return {
      valid: false,
      error: 'At least one asset class must be selected',
      symbolCount: 0
    };
  }

  const symbols = getSymbolsByAssetClass(assetClasses);

  if (symbols.length === 0) {
    return {
      valid: false,
      error: 'No symbols available for selected asset classes',
      symbolCount: 0
    };
  }

  return {
    valid: true,
    symbolCount: symbols.length
  };
}
