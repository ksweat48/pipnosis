/**
 * Asset-Class-Aware Risk Profiles
 *
 * Provides asset-class-specific risk configurations to prevent
 * applying forex assumptions to crypto, indices, and metals.
 *
 * CRITICAL: Never reuse forex commonMovePips for BTC, NAS, SPX, etc.
 */

import { getSymbolConfig, type SymbolCategory } from './symbol-registry';

export interface AssetClassRiskProfile {
  category: SymbolCategory;
  displayName: string;

  typicalStopRange: {
    min: number;
    max: number;
    unit: 'pips' | 'points' | 'atr' | 'percent';
  };

  commonMove: {
    min: number;
    max: number;
    unit: 'pips' | 'points' | 'atr' | 'percent';
  };

  sessionMoveBudget: {
    min: number;
    max: number;
    description: string;
  };

  atrMultiplierForStop: {
    min: number;
    max: number;
  };

  atrMultiplierForMove: {
    min: number;
    max: number;
  };
}

const FOREX_PROFILE: AssetClassRiskProfile = {
  category: 'forex',
  displayName: 'Forex Pairs',

  typicalStopRange: {
    min: 10,
    max: 25,
    unit: 'pips'
  },

  commonMove: {
    min: 15,
    max: 40,
    unit: 'pips'
  },

  sessionMoveBudget: {
    min: 30,
    max: 50,
    description: 'Typical 4-hour session range'
  },

  atrMultiplierForStop: {
    min: 1.0,
    max: 1.5
  },

  atrMultiplierForMove: {
    min: 0.5,
    max: 1.0
  }
};

const METALS_PROFILE: AssetClassRiskProfile = {
  category: 'metal',
  displayName: 'Precious Metals (Gold, Silver)',

  typicalStopRange: {
    min: 1.0,
    max: 2.5,
    unit: 'atr'
  },

  commonMove: {
    min: 0.5,
    max: 1.5,
    unit: 'atr'
  },

  sessionMoveBudget: {
    min: 100,
    max: 200,
    description: 'XAUUSD typical 4-hour range in points'
  },

  atrMultiplierForStop: {
    min: 1.0,
    max: 2.0
  },

  atrMultiplierForMove: {
    min: 0.5,
    max: 1.5
  }
};

const INDICES_PROFILE: AssetClassRiskProfile = {
  category: 'index',
  displayName: 'Stock Indices (US30, NAS100, SPX500)',

  typicalStopRange: {
    min: 1.0,
    max: 2.0,
    unit: 'atr'
  },

  commonMove: {
    min: 0.5,
    max: 1.2,
    unit: 'atr'
  },

  sessionMoveBudget: {
    min: 100,
    max: 300,
    description: 'Typical 4-hour session range in points'
  },

  atrMultiplierForStop: {
    min: 1.0,
    max: 1.8
  },

  atrMultiplierForMove: {
    min: 0.5,
    max: 1.2
  }
};

const CRYPTO_PROFILE: AssetClassRiskProfile = {
  category: 'crypto',
  displayName: 'Cryptocurrencies (BTC, ETH)',

  typicalStopRange: {
    min: 200,
    max: 500,
    unit: 'points'
  },

  commonMove: {
    min: 300,
    max: 800,
    unit: 'points'
  },

  sessionMoveBudget: {
    min: 500,
    max: 1500,
    description: 'BTCUSD typical 4-hour range in points'
  },

  atrMultiplierForStop: {
    min: 1.0,
    max: 2.0
  },

  atrMultiplierForMove: {
    min: 0.5,
    max: 1.0
  }
};

const ENERGY_PROFILE: AssetClassRiskProfile = {
  category: 'energy',
  displayName: 'Energy (Oil, Gas)',

  typicalStopRange: {
    min: 1.0,
    max: 2.0,
    unit: 'atr'
  },

  commonMove: {
    min: 0.5,
    max: 1.2,
    unit: 'atr'
  },

  sessionMoveBudget: {
    min: 50,
    max: 150,
    description: 'Typical 4-hour session range in points'
  },

  atrMultiplierForStop: {
    min: 1.0,
    max: 1.8
  },

  atrMultiplierForMove: {
    min: 0.5,
    max: 1.2
  }
};

const ASSET_CLASS_PROFILES: Record<SymbolCategory, AssetClassRiskProfile> = {
  forex: FOREX_PROFILE,
  metal: METALS_PROFILE,
  index: INDICES_PROFILE,
  crypto: CRYPTO_PROFILE,
  energy: ENERGY_PROFILE
};

export function getAssetClassRiskProfile(symbol: string): AssetClassRiskProfile {
  const config = getSymbolConfig(symbol);

  if (!config) {
    console.warn(`[Asset Class Profile] Unknown symbol: ${symbol}, defaulting to forex profile`);
    return FOREX_PROFILE;
  }

  return ASSET_CLASS_PROFILES[config.category] || FOREX_PROFILE;
}

export function getTypicalStopRange(symbol: string): { min: number; max: number; unit: string } {
  const profile = getAssetClassRiskProfile(symbol);
  return profile.typicalStopRange;
}

export function getCommonMoveRange(symbol: string): { min: number; max: number; unit: string } {
  const profile = getAssetClassRiskProfile(symbol);
  return profile.commonMove;
}

export function getSessionMoveBudget(symbol: string): { min: number; max: number; description: string } {
  const profile = getAssetClassRiskProfile(symbol);
  return profile.sessionMoveBudget;
}

export function calculateExpectedMove(
  symbol: string,
  tpDistance: number,
  sessionMoveBudget: number,
  atr: number
): number {
  const profile = getAssetClassRiskProfile(symbol);
  const config = getSymbolConfig(symbol);

  if (!config) {
    return Math.min(tpDistance, sessionMoveBudget);
  }

  const atrBasedMove = atr * profile.atrMultiplierForMove.max;

  return Math.min(
    tpDistance,
    sessionMoveBudget,
    atrBasedMove
  );
}

export function formatAssetClassProfileForLLM(symbol: string): string {
  const profile = getAssetClassRiskProfile(symbol);
  const config = getSymbolConfig(symbol);

  return `
📊 ASSET CLASS: ${profile.displayName}
Symbol: ${symbol} (${config?.displayName || 'Unknown'})
Typical Stop: ${profile.typicalStopRange.min}-${profile.typicalStopRange.max} ${profile.typicalStopRange.unit}
Common Move: ${profile.commonMove.min}-${profile.commonMove.max} ${profile.commonMove.unit}
Session Budget: ${profile.sessionMoveBudget.min}-${profile.sessionMoveBudget.max} (${profile.sessionMoveBudget.description})
`.trim();
}
