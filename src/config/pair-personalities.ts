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
    characterContext: `I am trading Gold (XAUUSD). Gold is a macro-reactive, high-volatility instrument. Its character: sharp, explosive wick movements that frequently pierce structural levels before reversing — this is normal Gold behavior, not invalidation. In the NY session Gold reaches peak volatility, often printing wicks of 50–150 points through obvious S/R before snapping back. London open can produce strong directional moves driven by macro sentiment and geopolitical flow. Asian session ranges are narrower but can set the day's high or low without warning.

SL awareness: Gold requires breathing room. Stops placed at obvious structural levels (equal highs/lows, session pivots) are routinely swept before the real move begins. A tight stop on Gold is a gift to the market. Give SL 1.5–2x normal pip distance to account for wick noise. When the regime is volatile, extend further.

TP awareness: Gold can run hard once a level clears — targets should respect the explosive nature of confirmed breakouts. Named structural levels (NY high/low, London high/low, daily high/low) are reliable targets. Partial liquidity sweeps are common — a confirmed close beyond a level carries more weight than a wick through it.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, Gold's M5 wicks are aggressive. Expect M5 candles with long wicks relative to body. Prefer entries that have already seen the wick-hunt complete (a wick through a level followed by a close back inside) rather than entering mid-wick. A tight scalp stop on Gold will be swept — build your SL from the wick extreme, not the body boundary.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, Gold's M15 structure is more reliable than M5. Wait for M15 body confirmation — wicks alone are noise on this instrument. TP1 should target the near structural zone; Gold often reaches TP1 cleanly before reversing.`,
      INTRADAY: `On INTRADAY, Gold's H1 structural moves are driven by macro sentiment sessions. NY session often sees the largest H1 directional commitment. Give SL extra room — H1 moves frequently wick through prior H1 levels before continuing.`,
    },
  },

  // ── EUR/USD (EURUSD) ────────────────────────────────────────────────────────
  {
    group: 'EURUSD',
    symbols: ['EURUSD'],
    characterContext: `I am trading EUR/USD (EURUSD). This is the world's most liquid Forex pair. Its character: clean, structured price action with well-defined S/R levels. London session drives the majority of the daily range — the strongest moves typically occur 08:00–12:00 UTC. NY session continuation or reversal of the London move is common at the London/NY overlap. Asian session is slow and often consolidates in a tight range (30–50 pips).

SL awareness: EURUSD respects structural levels more consistently than Gold or Yen pairs. Stops 10–15 pips beyond a clear structural level are usually sufficient. Spread is tight, so entry precision matters. Avoid stops inside consolidation zones — place beyond the swing point.

TP awareness: EURUSD moves in clean measured waves. Named daily/session highs and lows are reliable targets. Avoid overstretching TP in slow Asian sessions — the range is naturally compressed.`,
  },

  // ── GBP/USD (GBPUSD) ───────────────────────────────────────────────────────
  {
    group: 'GBPUSD',
    symbols: ['GBPUSD'],
    characterContext: `I am trading GBP/USD (GBPUSD). Cable is a London-dominant pair with higher volatility than EURUSD. Its character: strong directional impulses during London open and London/NY overlap, with frequent liquidity sweeps at obvious highs/lows before the true direction resolves. GBP reacts sharply to UK economic data and BOE sentiment shifts.

SL awareness: GBP/USD is prone to sharp wicks at session opens — especially London open 08:00 UTC. Stops should account for a 5–10 pip sweep beyond structural levels during high-impact news windows. In clean trend conditions, structural stops are reliable. In choppy conditions, give extra breathing room.

TP awareness: Cable can produce strong impulsive legs of 50–100 pips from London open. Named prior session highs/lows and key 00/50 psychological levels are reliable targets. Post-NY open reversals of the London move are common — factor direction accordingly.`,
  },

  // ── YEN PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'YEN_PAIRS',
    symbols: ['USDJPY', 'GBPJPY', 'EURJPY', 'AUDJPY'],
    characterContext: `I am trading a Yen pair. Yen crosses share a distinctive behavioral character: fast, momentum-driven moves with sharp reversals. These pairs react strongly to risk sentiment — in risk-off environments they appreciate rapidly; in risk-on they sell off sharply. Asian session (Tokyo) produces genuine directional movement on Yen pairs, unlike most Forex crosses. London open often generates a liquidity sweep of the Asian session range before establishing the London direction.

SL awareness: Yen pairs can spike aggressively — especially GBPJPY which has the widest typical range. Stops placed too close to recent S/R will be swept. GBP/JPY in particular can wick 20–30 pips through a structural level before reversing. Give SL 1.25–1.5x the pip distance you would use on EURUSD. USDJPY is tighter behaving than the crosses.

TP awareness: When Yen pairs move, they move hard. Confirmed momentum in one direction often extends further than structure suggests. Named session levels (Tokyo high/low, London high/low) and key psychological round numbers (150.00, 155.00 on USDJPY) are powerful targets.`,
    styleNotes: {
      SCALP: `On SCALP, Yen pairs have fast M5 candles with real pip velocity. A confirmed M5 close in direction is a strong signal. Wicks on M5 are common but usually smaller than on Gold. Entry precision matters — a few pips of slippage on Yen pairs changes the R:R meaningfully.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, use the Tokyo session range as a reference frame. A London break of the Asian range (with M15 body confirmation) is a high-probability setup on Yen pairs. TP at the Asian range extension or prior session high/low.`,
    },
  },

  // ── US INDICES ─────────────────────────────────────────────────────────────
  {
    group: 'US_INDICES',
    symbols: ['US30', 'NAS100', 'SPX500'],
    characterContext: `I am trading a US equity index. US indices (Dow Jones, NASDAQ, S&P 500) are session-gated instruments — they reach peak volatility at the NY open (13:30 UTC) and NY close (20:00 UTC). Pre-market (08:00–13:30 UTC) can show directional intent through futures pricing but with lower volume. The indices follow a common macro bias driven by US economic data, Fed sentiment, and broader risk appetite.

SL awareness: US indices print wide-ranging gap candles at NY open and can spike aggressively through obvious structural levels (previous day high/low, psychological round numbers like 40,000 on US30 or 20,000 on NAS100) before reversing. Stops placed at these obvious levels are frequently swept during the opening 15 minutes. Give SL adequate room beyond the nearest structural extreme. NAS100 has the highest intraday volatility of the three — it needs more SL room than SPX500 or US30 in equivalent setups.

TP awareness: When these indices trend, they trend cleanly. Pre-NY consolidation followed by a clean NY break is a reliable setup. Named prior session highs/lows, yesterday's close, and round psychological numbers are the most reliable TP targets. Avoid holding through major US economic releases (CPI, NFP) without accounting for spike risk.`,
    styleNotes: {
      SCALP: `On SCALP, trade the first 30 minutes after NY open cautiously — the opening spike frequently sweeps both sides before direction is established. After the initial 15-minute range is set, scalp breaks of that range with tight SL just inside it.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the NY session opening move is your primary setup. An M15 confirmation close in the direction of pre-market bias after the initial spike is absorbed gives a cleaner entry. TP1 at the prior session high/low.`,
      INTRADAY: `On INTRADAY, the daily trend is driven by the NY session. H1 candles from the NY session carry the most weight. Pre-market direction often reverses at NY open before the true daily direction emerges — read H1 structure from NY open forward.`,
    },
  },

  // ── EUROPEAN INDICES ───────────────────────────────────────────────────────
  {
    group: 'EUROPEAN_INDICES',
    symbols: ['UK100', 'GER40'],
    characterContext: `I am trading a European equity index (FTSE or DAX). European indices are London-session dominant — their peak activity and directional moves occur between 07:00–12:00 UTC. They often extend or reverse at the London/NY overlap (13:00–17:00 UTC) when US futures begin active trading. Post-NY open, European indices frequently fade their morning move or consolidate.

SL awareness: European indices have wide daily ranges driven by London open momentum. GER40 (DAX) is typically more volatile than UK100 (FTSE). Stops at obvious day-high or day-low will be swept during London open momentum. Give SL adequate room, especially for GER40 which can spike 50–80 points through structure.

TP awareness: London open breakouts are the primary setup. Prior day close, prior session high/low, and round numbers (e.g., 22,000 on GER40, 8,500 on UK100) are reliable targets. Fade trades at the London/NY overlap (NY open often reverses the London morning move) can produce clean setups.`,
    styleNotes: {
      SCALP: `On SCALP, the first 30 minutes of London open (07:00–07:30 UTC) are aggressive — wicks are wide. Cleaner scalp setups emerge after the initial spike has been absorbed (07:30–09:00 UTC).`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the best setups are London open breaks of the Asian session range confirmed on M15. TP1 at the prior session high/low is typically reached within the London morning.`,
    },
  },

  // ── CRYPTO (BTC, ETH) ──────────────────────────────────────────────────────
  {
    group: 'CRYPTO',
    symbols: ['BTCUSD', 'ETHUSD'],
    characterContext: `I am trading a cryptocurrency (Bitcoin or Ethereum). Crypto markets operate 24/7 with no session gaps — there is no session anchor like London open or NY open. However, US trading hours (13:00–22:00 UTC) typically produce the highest volume and most directional moves, as institutional crypto trading concentrates here. Weekend sessions are lower volume and prone to thin-liquidity sweeps.

SL awareness: Crypto has wide ATR and aggressive wick behavior at round-number levels (e.g., $100,000 on BTC, $3,000 on ETH) and obvious structural levels. False breaks through key levels followed by sharp reversals are common — especially in thin Asian/weekend sessions. Give SL 1.5–2x the pip distance of equivalent Forex stops. The spread on crypto is wider than Forex, which must be factored into net R:R calculation.

TP awareness: Crypto can trend persistently in one direction for hours once momentum is established. Momentum-continuation setups work well — look for pullbacks to broken structure (BOS retest) as entry, with TP at the next major round number or prior swing. Volume-confirmed breaks of psychological levels are powerful directional signals.`,
    styleNotes: {
      SCALP: `On SCALP, crypto M5 wicks at round numbers are extreme — do not place SL at the obvious level. After a wick-hunt sweep (a wick through a level followed by a close back above/below), this is often the cleanest scalp entry. Wait for the body confirmation, not the wick extreme.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the US session (13:00–22:00 UTC) is where the cleanest M15 structural moves occur. Asian session M15 moves are less reliable due to lower volume and wider spreads.`,
      INTRADAY: `On INTRADAY, use the prior day's high/low and weekly levels as H1 structural targets. Crypto trends can extend 3–5 H1 ATRs in a single session — give campaigns room to run if the H1 trend is clear.`,
    },
  },

  // ── COMMODITY CURRENCIES (AUD, NZD, CAD) ───────────────────────────────────
  {
    group: 'COMMODITY_FX',
    symbols: ['AUDUSD', 'NZDUSD', 'USDCAD'],
    characterContext: `I am trading a commodity-linked currency pair. AUD/USD, NZD/USD, and USD/CAD are influenced by commodity prices (iron ore, agriculture, oil) and have a strong correlation to global risk sentiment. Asian session (Sydney/Tokyo) produces the most activity on AUD and NZD pairs. USD/CAD is US-session dominant due to its North American nature and correlation to oil prices.

SL awareness: These pairs generally have clean, well-structured price action with tighter wick behavior than Gold or Yen crosses. Standard structural stops (8–15 pips beyond the structural level) are usually sufficient. USD/CAD can spike aggressively during CAD economic data releases and oil price shocks.

TP awareness: Session highs/lows are reliable targets. AUDUSD and NZDUSD tend to reverse strongly at multi-month range boundaries. USDCAD correlation with oil: when oil drops sharply, USD/CAD rises — factor macro context.`,
  },

  // ── CHF PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'CHF_PAIRS',
    symbols: ['USDCHF', 'EURCHF'],
    characterContext: `I am trading a Swiss Franc pair. CHF is a safe-haven currency that can move sharply and erratically during risk-off events (financial stress, geopolitical tension). In normal conditions, CHF pairs are slower-moving with moderate daily ranges. However, they are prone to violent, unexpected spikes during macro events — historical SNB interventions have moved these pairs 300–1000+ pips in minutes.

SL awareness: In normal conditions, standard structural stops are sufficient. In volatile macro environments (risk-off sentiment, SNB news), give extra SL room — CHF pairs can gap through structural levels without warning.

TP awareness: CHF pairs trend cleanly during sustained risk-off or risk-on periods. Named structural levels and psychological round numbers are reliable in trending conditions. Avoid tight TP targets during choppy, range-bound conditions.`,
  },

  // ── EUR CROSSES ────────────────────────────────────────────────────────────
  {
    group: 'EUR_CROSSES',
    symbols: ['EURGBP', 'EURAUD', 'EURNZD', 'EURCAD'],
    characterContext: `I am trading a EUR cross pair. EUR crosses (EURGBP, EURAUD, EURNZD, EURCAD) are driven by the relative strength of the EUR against the counter currency. These pairs often move more slowly and in a more range-bound fashion than majors, with breakouts that can produce extended directional moves when they occur. Spread on cross pairs is typically wider than majors — factor this into R:R calculations explicitly.

SL awareness: EUR crosses are generally less wick-aggressive than Yen crosses or Gold. Standard structural stops are usually sufficient, but give 2–3 pips extra to account for the wider spread. EURAUD and EURNZD can have sharp moves driven by commodity sentiment alongside EUR weakness/strength.

TP awareness: Range boundaries are powerful levels on these pairs. A confirmed break of a multi-day range boundary (with a closed body beyond it) can produce a measured move equal to the prior range. Named structural levels from H4 and D1 are most reliable.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY FALLBACK PERSONALITIES
// Used when no explicit pair or group match is found
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FALLBACK: Record<SymbolCategory, string> = {
  forex: `I am trading a Forex pair. Forex markets are session-driven — London and NY sessions carry the highest volume and most reliable directional moves. Structural price action with well-defined S/R levels governs my read. Give SL adequate room beyond the structural anchor, accounting for session-specific volatility.`,

  metal: `I am trading a precious metal. Metals are macro-reactive with aggressive wick behavior, especially during NY session. Structural levels are frequently swept before the real move begins — give SL extra room beyond the obvious structural point.`,

  index: `I am trading an equity index. Indices are session-gated with peak volatility at market open. Opening spikes frequently sweep obvious structural levels — give SL room beyond the session open range. Named prior session highs/lows and psychological round numbers are reliable targets.`,

  crypto: `I am trading a cryptocurrency. Crypto operates 24/7 with no session anchor. Aggressive wick behavior at round-number and structural levels is the norm — give SL 1.5x the room you would give a Forex pair. US trading hours (13:00–22:00 UTC) produce the most reliable directional moves.`,

  energy: `I am trading an energy instrument. Energy markets react sharply to supply/demand news, OPEC decisions, and geopolitical events. Volatility can spike without warning — give SL extra room and be aware that intraday moves may not reflect the longer-term structural trend.`,
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
