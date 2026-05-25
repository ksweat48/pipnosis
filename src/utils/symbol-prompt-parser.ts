/**
 * Symbol Prompt Parser - SSOT for Natural Language Symbol Detection
 *
 * Parses user prompts to detect specific trading symbols.
 * Examples:
 * - "make me $100 with EURUSD" -> [EURUSD]
 * - "scalp Gold for $200" -> [XAUUSD]
 * - "trade the Dow" -> [US30]
 *
 * Uses SYMBOL_REGISTRY as single source of truth for valid symbols.
 */

import { SYMBOL_REGISTRY } from '../config/symbol-registry';

export interface DetectedSymbol {
  symbol: string;
  matchedText: string;
  category: string;
  displayName: string;
}

const SYMBOL_ALIASES: Record<string, string> = {
  'gold': 'XAUUSD',
  'xau': 'XAUUSD',
  'euro': 'EURUSD',
  'eur': 'EURUSD',
  'pound': 'GBPUSD',
  'gbp': 'GBPUSD',
  'cable': 'GBPUSD',
  'yen': 'USDJPY',
  'jpy': 'USDJPY',
  'dow': 'US30',
  'dow jones': 'US30',
  'nasdaq': 'NAS100',
  'nas': 'NAS100',
};

const NOISE_WORDS = new Set([
  'make', 'trade', 'scalp', 'with', 'using', 'on', 'for', 'me', 'money',
  'dollars', 'aggressive', 'conservative', 'opportunity', 'opportunities',
  'scan', 'scanning', 'find', 'search', 'looking', 'focus', 'prefer'
]);

export function parseSymbolsFromPrompt(prompt: string): DetectedSymbol[] {
  const detected: DetectedSymbol[] = [];
  const lower = prompt.toLowerCase();
  const words = lower.split(/\s+/);

  // 1. Check for exact symbol matches (case-insensitive)
  for (const [symbol, config] of Object.entries(SYMBOL_REGISTRY)) {
    const symbolLower = symbol.toLowerCase();
    const regex = new RegExp(`\\b${symbolLower}\\b`, 'i');

    if (regex.test(lower)) {
      detected.push({
        symbol,
        matchedText: symbol,
        category: config.category,
        displayName: config.displayName
      });
    }
  }

  // 2. Check for display name matches
  for (const [symbol, config] of Object.entries(SYMBOL_REGISTRY)) {
    const displayNameLower = config.displayName.toLowerCase();
    const regex = new RegExp(`\\b${displayNameLower}\\b`, 'i');

    if (regex.test(lower) && !detected.find(d => d.symbol === symbol)) {
      detected.push({
        symbol,
        matchedText: config.displayName,
        category: config.category,
        displayName: config.displayName
      });
    }
  }

  // 3. Check for aliases
  for (const [alias, symbol] of Object.entries(SYMBOL_ALIASES)) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');

    if (regex.test(lower) && !detected.find(d => d.symbol === symbol)) {
      const config = SYMBOL_REGISTRY[symbol];
      if (config) {
        detected.push({
          symbol,
          matchedText: alias,
          category: config.category,
          displayName: config.displayName
        });
      }
    }
  }

  return detected;
}

export function extractSymbolsFromPrompt(prompt: string): string[] {
  const detected = parseSymbolsFromPrompt(prompt);
  return detected.map(d => d.symbol);
}

export function hasSymbolMention(prompt: string): boolean {
  return parseSymbolsFromPrompt(prompt).length > 0;
}

export function getSymbolSelectionSource(
  promptSymbols: string[],
  uiSymbols: string[] | null,
  assetClassFilter: string[] | null
): 'prompt' | 'ui' | 'asset_filter' | 'default' {
  if (promptSymbols.length > 0) return 'prompt';
  if (uiSymbols && uiSymbols.length > 0) return 'ui';
  if (assetClassFilter && assetClassFilter.length > 0) return 'asset_filter';
  return 'default';
}
