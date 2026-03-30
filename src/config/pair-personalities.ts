/**
 * Pair Personalities — Instrument Character Injections
 *
 * ═══════════════════════════════════════════════════════════════════
 * CCIP-2026-0330-PAIR-PERSONALITY
 * ═══════════════════════════════════════════════════════════════════
 *
 * PURPOSE:
 * Each trading instrument has a distinct behavioral character — its own
 * volatility signature, wick tendencies, session dominance, and SL
 * noise profile. This file provides a natural-language context injection
 * for each pair or behavioral group so that Alpha can self-apply the
 * correct read when interpreting candle data and placing SL/TP.
 *
 * PHILOSOPHY:
 * These are NOT rules or gates. They are awareness injections — the same
 * awareness a professional trader has internalized about each instrument
 * before looking at a single candle. Alpha receives this context and
 * reasons about what it means for the current setup himself.
 *
 * DESIGN:
 * - Pairs with similar behavioral character share a group personality
 * - Per-symbol overrides exist where behavior diverges meaningfully
 * - A category-level fallback covers any symbol not explicitly mapped
 * - All injections are natural language — no rules, no arithmetic
 *
 * SSOT COMPLIANCE:
 * - This file is the ONLY authority for pair personality context
 * - symbol-registry.ts owns pip values, lot sizes, and data providers
 * - asset-class-risk-profiles.ts owns numeric risk parameters
 * - This file owns behavioral character descriptions for Alpha's awareness
 *
 * CCIP GOVERNANCE:
 * - Any change to personality text is a CCIP event
 * - Personality groups may not be duplicated across files
 * - getPairPersonalityContext() is the only public interface
 * ═══════════════════════════════════════════════════════════════════
 */

import { getSymbolConfig, type SymbolCategory } from './symbol-registry';
import type { StyleDisplayName } from './trade-styles';

export interface PairPersonality {
  group: string;
  symbols: string[];
  characterContext: string;
  styleNotes?: Partial<Record<StyleDisplayName, string>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERSONALITY DEFINITIONS — grouped by behavioral character
// ─────────────────────────────────────────────────────────────────────────────

const PAIR_PERSONALITIES: PairPersonality[] = [

  // ── GOLD (XAUUSD) ──────────────────────────────────────────────────────────
  {
    group: 'GOLD',
    symbols: ['XAUUSD'],
    characterContext: `I am trading Gold (XAUUSD). Gold is a macro-reactive, high-volatility instrument. Its character: sharp, explosive wick movements that frequently pierce structural levels before reversing — this is normal Gold behavior, not invalidation.

SL awareness: Gold requires breathing room. Stops placed at obvious structural levels (equal highs/lows, session pivots) are routinely swept before the real move begins. A tight stop on Gold is a gift to the market.

TP awareness: Gold can run hard once a level clears. Named structural levels (prior session highs/lows, daily high/low) are observed reference points. Partial liquidity sweeps are common — a confirmed close beyond a level carries more weight than a wick through it. Do not tell Alpha where to place his TP.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, Gold's M5 wicks are aggressive. M5 candles with long wicks relative to body are routine on this instrument. Wick-hunt completions — a wick through a level followed by a close back inside — frequently precede the directional move. Stops placed at body boundaries rather than wick extremes are commonly swept on Gold.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, Gold's M15 structure is more reliable than M5. M15 body closes carry more informational weight than wicks on this instrument. Gold frequently reaches the near structural zone before reversing.`,
      INTRADAY: `On INTRADAY, Gold's H1 structural moves are driven by macro sentiment. H1 moves on Gold frequently wick through prior H1 levels before continuing — wick penetration of structure is not itself a signal of invalidation on this timeframe.`,
    },
  },

  // ── EUR/USD (EURUSD) ────────────────────────────────────────────────────────
  {
    group: 'EURUSD',
    symbols: ['EURUSD'],
    characterContext: `I am trading EUR/USD (EURUSD). This is the world's most liquid Forex pair. Its character: clean, structured price action with well-defined S/R levels. EURUSD respects structural levels more consistently than Gold or Yen pairs — wick penetration of structure is less common here than on high-volatility instruments.

SL awareness: Structural levels on EURUSD are more often respected than swept. Tight spreads on this pair mean entry precision has a direct impact on the realized R:R of any given setup.

TP awareness: EURUSD moves in clean measured waves. Named daily and session highs/lows are observed structural reference points. The range during low-volume periods is naturally compressed compared to London and NY sessions.`,
  },

  // ── GBP/USD (GBPUSD) ───────────────────────────────────────────────────────
  {
    group: 'GBPUSD',
    symbols: ['GBPUSD'],
    characterContext: `I am trading GBP/USD (GBPUSD). Cable is a London-dominant pair with higher volatility than EURUSD. Its character: strong directional impulses with frequent liquidity sweeps at obvious highs/lows before the true direction resolves. GBP reacts sharply to UK economic data and BOE sentiment shifts.

SL awareness: GBP/USD is prone to sharp wicks at session opens. Stops placed at structural levels during high-impact news windows are frequently swept. In clean trend conditions, structural levels hold more often. In choppy conditions, wick behavior is more erratic.

TP awareness: Cable is capable of strong impulsive legs from session open. Named prior session highs/lows and key psychological levels (round numbers ending in 00 and 50) are observed structural reference points. Post-London-move reversals during the NY session are a recognized behavioral pattern on this pair.`,
  },

  // ── YEN PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'YEN_PAIRS',
    symbols: ['USDJPY', 'GBPJPY', 'EURJPY', 'AUDJPY'],
    characterContext: `I am trading a Yen pair. Yen crosses share a distinctive behavioral character: fast, momentum-driven moves with sharp reversals. These pairs react strongly to risk sentiment — risk-off and risk-on flows move Yen crosses aggressively. Tokyo session produces genuine directional movement on Yen pairs. London open frequently generates a liquidity sweep of the Asian session range before the London direction is established.

SL awareness: Yen pairs spike aggressively at structural levels. GBPJPY has the widest typical daily range of the group — structural levels on this pair are pierced more deeply and more frequently than on USDJPY. USDJPY is tighter-behaving than the crosses.

TP awareness: When Yen pairs move, they extend further than structure alone suggests. Named session levels (Tokyo high/low, London high/low) and key psychological round numbers are observed reference points.`,
    styleNotes: {
      SCALP: `On SCALP, Yen pairs have fast M5 candles with real pip velocity. A confirmed M5 body close in direction carries weight on this instrument. A few pips of difference in entry changes the R:R meaningfully on Yen pairs given their pip velocity.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the Tokyo session range is an observable reference frame for Yen pairs. A London break of the Asian range accompanied by an M15 body confirmation is a recognized behavioral pattern on these instruments.`,
    },
  },

  // ── US INDICES ─────────────────────────────────────────────────────────────
  {
    group: 'US_INDICES',
    symbols: ['US30', 'NAS100', 'SPX500'],
    characterContext: `I am trading a US equity index. US indices (Dow Jones, NASDAQ, S&P 500) are session-gated instruments. They follow a common macro bias driven by US economic data, Fed sentiment, and broader risk appetite. Pre-market pricing can show directional intent but with lower volume than the active session.

SL awareness: US indices print wide-ranging candles at the NY open and frequently spike through obvious structural levels (previous day high/low, psychological round numbers) before the session direction is established. Stops placed at these obvious levels are commonly swept in the early session minutes. NAS100 carries the highest intraday volatility of the three — structural sweeps on NAS100 are deeper than equivalent moves on SPX500 or US30. Major economic data releases (CPI, NFP) produce aggressive spike candles that frequently exceed intraday structural anchors.

TP awareness: When these indices trend from the NY session, they trend cleanly. Named prior session highs/lows, the prior day's close, and round psychological numbers are observed structural reference points.`,
    styleNotes: {
      SCALP: `On SCALP, the NY open on US indices frequently sweeps both the prior high and prior low before direction is established. The initial opening range, once set, tends to act as a boundary — breaks of that range after the initial volatility has resolved carry more directional weight.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the NY session opening move is the dominant event. M15 body confirmation after the initial spike has resolved tends to produce cleaner reads on these instruments than attempting to read direction during the opening spike itself.`,
      INTRADAY: `On INTRADAY, H1 candles from the NY session carry the dominant directional information on US indices. Pre-market directional bias often reverses at NY open before the true daily direction emerges — H1 structure built after the NY open is more reliable than pre-market positioning.`,
    },
  },

  // ── EUROPEAN INDICES ───────────────────────────────────────────────────────
  {
    group: 'EUROPEAN_INDICES',
    symbols: ['UK100', 'GER40'],
    characterContext: `I am trading a European equity index (FTSE or DAX). European indices are London-session dominant. The London/NY overlap is a recognized inflection zone where European indices frequently extend or reverse their morning moves as US futures become active. Post-NY open, European indices commonly fade their morning move or consolidate.

SL awareness: European indices have wide daily ranges during London session momentum. GER40 (DAX) is typically more volatile than UK100 (FTSE) — structural levels on GER40 are pierced more aggressively. Stops at obvious day-high or day-low during London open momentum are frequently swept. London open is a known high-wick-activity window on both instruments.

TP awareness: Prior day close, prior session high/low, and round numbers are observed structural reference points on these instruments. The London/NY overlap is a recognized reversal zone where the morning London move is commonly challenged.`,
    styleNotes: {
      SCALP: `On SCALP, the London open window on European indices is characterized by wide, aggressive wicks. The M5 wick behavior during the initial opening minutes is more erratic than after the opening momentum has been absorbed.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, a London break of the prior Asian range confirmed on M15 is a recognized behavioral pattern on European indices. Prior session high/low is an observed structural reference for the London morning move.`,
    },
  },

  // ── CRYPTO (BTC, ETH) ──────────────────────────────────────────────────────
  {
    group: 'CRYPTO',
    symbols: ['BTCUSD', 'ETHUSD'],
    characterContext: `I am trading a cryptocurrency (Bitcoin or Ethereum). Crypto markets operate 24/7 with no session gaps. US trading hours typically produce the highest volume and most directional moves on these instruments. Weekend and Asian sessions are characterized by lower volume — thin-liquidity sweeps of structural levels and round numbers are more common during these windows.

SL awareness: Crypto carries wide ATR and aggressive wick behavior at round-number levels and obvious structural zones. False breaks through key levels followed by sharp reversals are a recognized pattern — particularly in low-volume windows. The spread on crypto is wider than on Forex pairs, which affects realized R:R directly.

TP awareness: Crypto is capable of extended trending moves once momentum is established. Volume-confirmed breaks of psychological levels carry directional weight. Prior day and prior week high/low are observed structural reference points.`,
    styleNotes: {
      SCALP: `On SCALP, crypto M5 wicks at round numbers and structural levels are extreme relative to the candle body. Wick-hunt completions — a wick through a level followed by a body close back on the other side — are a recognized pre-move pattern on this instrument. M5 body closes carry more directional weight than wick extremes.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, US session hours produce the cleanest M15 structural moves on crypto. Asian session M15 moves carry less structural weight due to lower volume and wider spreads during that window.`,
      INTRADAY: `On INTRADAY, prior day and weekly high/low are the dominant H1 structural reference points on crypto. Crypto H1 trends are capable of extending multiple ATR units within a single session once momentum is confirmed.`,
    },
  },

  // ── COMMODITY CURRENCIES (AUD, NZD, CAD) ───────────────────────────────────
  {
    group: 'COMMODITY_FX',
    symbols: ['AUDUSD', 'NZDUSD', 'USDCAD'],
    characterContext: `I am trading a commodity-linked currency pair. AUD/USD, NZD/USD, and USD/CAD are influenced by commodity prices (iron ore, agriculture, oil) and carry a correlation to global risk sentiment. AUD and NZD pairs see their highest activity during Sydney/Tokyo session hours. USD/CAD is US-session dominant and carries a recognized correlation to oil prices — sharp oil price moves frequently transmit into USD/CAD intraday.

SL awareness: These pairs generally exhibit cleaner, less wick-aggressive price action than Gold or Yen crosses. USD/CAD is an exception during CAD data releases and oil price shocks — spike behavior on USDCAD during these events can exceed typical structural anchors.

TP awareness: Session highs/lows are observed structural reference points. AUDUSD and NZDUSD have a history of strong reversals at multi-month range boundaries. USDCAD's commodity correlation means its directional moves are sometimes driven by oil rather than pure technical structure.`,
  },

  // ── CHF PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'CHF_PAIRS',
    symbols: ['USDCHF', 'EURCHF'],
    characterContext: `I am trading a Swiss Franc pair. CHF is a safe-haven currency. In normal market conditions, CHF pairs move at a moderate pace with defined daily ranges. During risk-off events (financial stress, geopolitical tension) and SNB intervention windows, CHF pairs are capable of violent, sudden moves that exceed any structural anchor — historical SNB events have produced moves of 300–1000+ pips in minutes with no warning.

SL awareness: In normal conditions, structural levels on CHF pairs are respected with reasonable consistency. During volatile macro environments or SNB event risk, gap behavior through structural levels is a recognized feature of this pair — structural stops do not provide guaranteed containment when SNB-style events occur.

TP awareness: CHF pairs trend cleanly during sustained risk-on or risk-off periods. Named structural levels and psychological round numbers are reliable references in trending conditions. During choppy, range-bound conditions the pair lacks sustained follow-through.`,
  },

  // ── EUR CROSSES ────────────────────────────────────────────────────────────
  {
    group: 'EUR_CROSSES',
    symbols: ['EURGBP', 'EURAUD', 'EURNZD', 'EURCAD'],
    characterContext: `I am trading a EUR cross pair. EUR crosses (EURGBP, EURAUD, EURNZD, EURCAD) are driven by the relative strength of EUR against the counter currency — moves on these pairs reflect dual-currency flows rather than a single macro driver. These pairs tend to move more slowly and spend more time in range-bound conditions than the majors, with breakouts that extend when they occur. Spread on cross pairs is typically wider than on majors, which has a direct effect on realized R:R.

SL awareness: EUR crosses are generally less wick-aggressive than Yen crosses or Gold. EURAUD and EURNZD are exceptions — commodity sentiment on the counter currency can produce sharper-than-expected moves on these two pairs when commodity flows are strong.

TP awareness: Range boundaries are powerful reference points on these pairs. A confirmed body close beyond a multi-day range boundary on EUR crosses has historically been followed by a measured move. H4 and D1 structural levels carry more observable weight on these instruments than shorter-timeframe anchors.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY FALLBACK PERSONALITIES
// Used when no explicit pair or group match is found
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FALLBACK: Record<SymbolCategory, string> = {
  forex: `I am trading a Forex pair. Forex markets are session-driven — London and NY sessions carry the highest volume and most observable directional structure. Structural price action with well-defined S/R levels is the primary read on Forex instruments. Session-specific volatility affects how reliably structural levels are respected versus swept.`,

  metal: `I am trading a precious metal. Metals are macro-reactive with aggressive wick behavior. Structural levels are frequently swept before the real move begins — wick penetration of obvious structural anchors is a recognized behavioral pattern on this instrument class, not necessarily an invalidation signal.`,

  index: `I am trading an equity index. Indices are session-gated with peak volatility at market open. Opening spikes on indices frequently sweep obvious structural levels. Named prior session highs/lows and psychological round numbers are observed structural reference points.`,

  crypto: `I am trading a cryptocurrency. Crypto operates 24/7 with no session anchor. Aggressive wick behavior at round-number and structural levels is the norm on this instrument class. US trading hours (13:00–22:00 UTC) produce the most observable directional structure. Stops placed at obvious round-number and structural levels are routinely swept on crypto.`,

  energy: `I am trading an energy instrument. Energy markets react sharply to supply/demand news, OPEC decisions, and geopolitical events. Volatility spikes on energy instruments frequently exceed structural anchors without prior warning. Intraday moves do not always reflect the longer-term structural trend on this instrument class.`,
};

// ─────────────────────────────────────────────────────────────────────────────
// INDEX: symbol → personality, built at module load
// ─────────────────────────────────────────────────────────────────────────────

const SYMBOL_TO_PERSONALITY_INDEX: Map<string, PairPersonality> = new Map();

for (const personality of PAIR_PERSONALITIES) {
  for (const symbol of personality.symbols) {
    SYMBOL_TO_PERSONALITY_INDEX.set(symbol.toUpperCase(), personality);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC INTERFACE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a natural-language pair personality injection for Alpha.
 *
 * This is NOT a rule or a gate. It is an awareness context — Alpha reads
 * this and self-applies the appropriate behavioral adjustments for the
 * instrument and session he is analyzing.
 *
 * CCIP-2026-0330-PAIR-PERSONALITY — SSOT authority for this function.
 */
export function getPairPersonalityContext(
  symbol: string,
  tradeStyle: StyleDisplayName
): string {
  const upperSymbol = symbol.toUpperCase();
  const personality = SYMBOL_TO_PERSONALITY_INDEX.get(upperSymbol);

  let baseContext: string;
  let styleNote: string = '';

  if (personality) {
    baseContext = personality.characterContext;
    if (personality.styleNotes?.[tradeStyle]) {
      styleNote = `\n${tradeStyle} NOTE: ${personality.styleNotes[tradeStyle]}`;
    }
  } else {
    const config = getSymbolConfig(upperSymbol);
    const category: SymbolCategory = config?.category ?? 'forex';
    baseContext = CATEGORY_FALLBACK[category];
  }

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUMENT AWARENESS — ${upperSymbol} (${tradeStyle})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${baseContext}${styleNote}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}

/**
 * Returns the base instrument character context without style-specific notes.
 *
 * Used in mid-trade analysis where the trade style is not the focus —
 * Alpha needs instrument character awareness to correctly evaluate
 * drawdown severity, wick noise, and SL validity for this specific pair.
 *
 * CCIP-2026-0330-PAIR-PERSONALITY — SSOT authority for this function.
 */
export function getPairCharacterContext(symbol: string): string {
  const upperSymbol = symbol.toUpperCase();
  const personality = SYMBOL_TO_PERSONALITY_INDEX.get(upperSymbol);

  let baseContext: string;

  if (personality) {
    baseContext = personality.characterContext;
  } else {
    const config = getSymbolConfig(upperSymbol);
    const category: SymbolCategory = config?.category ?? 'forex';
    baseContext = CATEGORY_FALLBACK[category];
  }

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUMENT AWARENESS — ${upperSymbol}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${baseContext}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
}
