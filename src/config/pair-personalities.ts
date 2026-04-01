/**
 * Pair Personalities — Instrument Character Injections
 *
 * ═══════════════════════════════════════════════════════════════════
 * CCIP-2026-0401-PAIR-PERSONALITY-V2
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

SL awareness: Gold requires breathing room. Stops placed at obvious structural levels (equal highs/lows, session pivots) are routinely swept before the real move begins. A tight stop on Gold is a gift to the market. Named swing highs and lows on Gold are known to the market — a stop placed just beyond a named level is still at the level, not behind it.

TP awareness: Gold can run hard once a level clears. Named structural levels (prior session highs/lows, daily high/low) are observed reference points. Partial liquidity sweeps are common — a confirmed close beyond a level carries more weight than a wick through it.

Gold's character does not change by session, but its noise floor does. The same distance that represents structural breathing room during London is inside the noise during a dead session. The instrument is the same — the book depth is not.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, Gold's M5 wicks are aggressive and the book is thin. A single institutional order flow event moves Gold through several pips without touching a named structural level — what looks like a wick is often just normal candle mechanics on this instrument.

Wick-hunt completions — a wick through a level followed by a close back inside — frequently precede the directional move. The wick IS the hunt. The hunt is the level clearing before the real participants enter.

The most common way a Gold scalp dies is not a bad thesis — it is a structurally correct thesis with a stop that sits inside the noise. When liquidity is thin, the noise is wider. When the session is quiet, the noise is at its widest.

A sweep of lows without a confirmed break of structure is not a directional signal — it is a liquidity event. The market collected stops. That is different from the market choosing a direction. Bearish candles following a sweep, without a structural break, are noise — not continuation evidence.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, Gold's M15 structure is more reliable than M5. M15 body closes carry more informational weight than wicks on this instrument. The candle body is the vote — the wick is the noise. Gold frequently reaches the near structural zone before reversing, and that initial touch is rarely the entry.`,
      INTRADAY: `On INTRADAY, Gold's H1 structural moves are driven by macro sentiment. H1 moves on Gold frequently wick through prior H1 levels before continuing — wick penetration of structure is not itself a signal of invalidation on this timeframe. The H1 body close is the confirmation that the level has genuinely broken, not the wick.`,
    },
  },

  // ── EUR/USD (EURUSD) ────────────────────────────────────────────────────────
  {
    group: 'EURUSD',
    symbols: ['EURUSD'],
    characterContext: `I am trading EUR/USD (EURUSD). This is the world's most liquid Forex pair. Its character: clean, structured price action with well-defined levels that participants broadly agree on. Because EURUSD is the most watched pair on earth, its levels are also the most crowded — when obvious support and resistance is widely anticipated, liquidity pools form on both sides of those levels before the real move resolves.

SL awareness: Structural levels on EURUSD are generally respected more consistently than on high-volatility instruments, but crowded levels attract stop sweeps on this pair more than on thinner pairs. Tight spreads mean entry precision directly shapes the realized R:R of any setup — a poorly timed entry on EURUSD costs proportionally more because the spread is not covering for it.

TP awareness: EURUSD moves in measured, clean waves. Named daily and session highs/lows are observed structural reference points. The range during low-volume periods is naturally compressed compared to London and NY sessions — a move that looks like momentum in the Asian session may simply be drift without the volume to sustain it.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, EURUSD M5 price action is among the cleanest of any instrument — but that cleanliness means there is nowhere to hide. A thesis that is slightly wrong on EURUSD is immediately wrong, with no erratic wick behavior to obscure the diagnosis. Entry precision and structure clarity matter more on this pair than on any volatile instrument. The spread is narrow — the structure must be precise to justify it.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the London session produces EURUSD's most reliable M15 structural reads. London institutional participation is the engine that drives the cleanest directional moves on this pair. An M15 confirmation within London hours carries more informational weight than the same pattern during Asian session drift.`,
      INTRADAY: `On INTRADAY, the NY/London overlap is the highest-probability inflection window on EURUSD. Moves that begin during London open and are confirmed on H1 before the overlap frequently extend during NY participation. H1 moves initiated in Asian session hours are less likely to have the institutional volume behind them to sustain to structural targets.`,
    },
  },

  // ── GBP/USD (GBPUSD) ───────────────────────────────────────────────────────
  {
    group: 'GBPUSD',
    symbols: ['GBPUSD'],
    characterContext: `I am trading GBP/USD (GBPUSD). Cable is a London-dominant pair with a recognized behavioral pattern: strong directional impulses bookended by liquidity sweeps. Before Cable picks a direction, it frequently sweeps the obvious high or low — sometimes both — before committing. This is not randomness; it is how the pair distributes liquidity before a real move.

SL awareness: GBP/USD is particularly prone to sharp wicks at London open. The opening sweep is the pair's behavioral signature — a stop placed at the most obvious prior high or low during the London opening window is positioned exactly where the sweep targets it. In clean trending conditions structural levels hold more consistently. In choppy or news-reactive conditions, wick behavior on Cable becomes erratic and the prior level is routinely overshot.

TP awareness: Cable is capable of strong, extended impulsive legs from a confirmed London session open. Named prior session highs/lows and key psychological levels are observed structural reference points. Post-London-move reversals during the NY session are a recognized behavioral pattern — a London trend that has run without a meaningful pullback is more exposed to NY reversal pressure than a London move with normal consolidation.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, GBPUSD M5 candles at London open frequently produce the widest wicks of any major Forex pair. The opening sweep — a fast move through the obvious level before reversal — is not a random event on this instrument. When the opening wick has completed and the body has closed back on the other side, that is a different setup to entering before the sweep has resolved. Cable rewards patience at the open.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the M15 London open candle on Cable is one of the most recognizable patterns in Forex. A long wick through the prior day's high or low followed by an M15 body close back inside the prior range is the pair announcing its liquidity hunt. What follows that pattern carries more directional weight than a simple break of the prior range without the sweep.`,
      INTRADAY: `On INTRADAY, Cable's H1 daily range is shaped almost entirely by London session activity. A Cable H1 trend established during London that is still in motion at NY open has historically shown a meaningful tendency to be challenged at the NY open rather than continued — participants who were positioned for the London move take profit as US participation begins.`,
    },
  },

  // ── YEN PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'YEN_PAIRS',
    symbols: ['USDJPY', 'GBPJPY', 'EURJPY', 'AUDJPY'],
    characterContext: `I am trading a Yen pair. Yen crosses share a distinctive behavioral character: fast, momentum-driven moves with sharp reversals when risk sentiment shifts. These pairs react strongly to global risk appetite — risk-off flows (JPY strengthening) and risk-on flows (JPY weakening) move Yen crosses in a way that can override local technical structure. Tokyo session produces genuine, observable directional movement on Yen pairs that is not present on most other instruments at the same time. London open frequently generates a liquidity sweep of the entire Asian session range before the London direction is established — that sweep is the pair rebalancing liquidity, not a technical break.

SL awareness: Yen pairs spike aggressively at structural levels and at session transitions. GBPJPY has the widest typical daily range and deepest structural sweeps of the group — what constitutes a safe stop distance on USDJPY is frequently inside the noise on GBPJPY. USDJPY is tighter-behaving than the crosses, but it is also highly sensitive to sudden risk-off flows that can generate fast, uninterrupted moves in either direction without warning.

TP awareness: When Yen pairs move with momentum, they extend further than local structure alone suggests. Named session levels (Tokyo high/low, London high/low) and key psychological round numbers are observed reference points. A Yen pair breakout that occurs with genuine risk-flow behind it does not respect intermediate local structure the way a ranging Forex pair would.`,
    styleNotes: {
      SCALP: `On SCALP, Yen pairs have fast M5 candles with real pip velocity. A directional candle on GBPJPY covers the same distance in M5 that takes EURUSD several candles — the clock runs differently on this instrument. A confirmed M5 body close in direction carries genuine weight here. A few pips of entry precision changes the realized R:R meaningfully because the pip moves are large and the entry timing is what defines whether the stop is in front of or behind the structural anchor.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the Tokyo session range is an observable, structural reference frame for Yen pairs. A London break of the Asian range accompanied by an M15 body confirmation is a recognized behavioral pattern — the sweep of the Asian range is the hunt, and the M15 body close after that sweep is the tell. A wick through the Asian range that does not produce an M15 body confirmation is not yet a break; it is the hunt in progress.`,
      INTRADAY: `On INTRADAY, Yen pairs are driven by macro risk flows at the H1 level. An H1 structural move on a Yen cross that aligns with the prevailing risk sentiment (risk-on or risk-off) carries more conviction than an H1 move that runs against the macro tone. H1 moves on Yen pairs that lack macro alignment are more likely to stall at prior session boundaries.`,
    },
  },

  // ── US INDICES ─────────────────────────────────────────────────────────────
  {
    group: 'US_INDICES',
    symbols: ['US30', 'NAS100', 'SPX500'],
    characterContext: `I am trading a US equity index. US indices — Dow Jones, NASDAQ, S&P 500 — are session-gated instruments. They have a clear personality: everything before the NY open is positioning; everything at the NY open is reality. Pre-market pricing shows directional intent but on lower volume, meaning the levels established before the NY open are frequently swept during the opening minutes when full participant activity begins.

SL awareness: US indices print wide-ranging candles at the NY open and frequently spike through obvious structural levels — previous day high/low, psychological round numbers, pre-market highs/lows — before the session direction is established. Stops placed at the most obvious levels during the opening window are positioned where the opening spike targets them. NAS100 carries the highest intraday volatility of the three — structural sweeps on NAS100 are typically deeper and faster than equivalent moves on SPX500 or US30. Major economic data releases produce spike candles that move through intraday structural anchors as if they are not there.

TP awareness: When these indices trend from the NY session open with genuine momentum, they trend cleanly for extended periods. The prior session's close, prior day's range boundaries, and psychological round numbers are observed structural reference points. A NY session move that has absorbed the opening spike and established a confirmed body direction carries more reliability than an early-move position taken before the opening volatility has resolved.`,
    styleNotes: {
      SCALP: `On SCALP, the NY open on US indices is the single most dangerous window for tight stops. The opening range — typically the first 5–15 minutes of NY participation — frequently sweeps both the prior high and prior low before the session direction is chosen. An M5 stop placed at the obvious prior level during this window is inside the opening sweep zone. The opening range, once the initial volatility has been absorbed, tends to act as a boundary — a confirmed M5 body break of that boundary after the noise has resolved is a different trade to entering before the sweep has completed.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the NY session opening move is the dominant event on US indices. M15 body confirmation after the initial spike has resolved produces cleaner reads than attempting to read direction during the opening volatility itself. The opening spike is the instrument distributing liquidity — what happens after that distribution is the actual market view.`,
      INTRADAY: `On INTRADAY, H1 candles built after the NY open carry the dominant directional information on US indices. Pre-market directional bias often reverses at NY open before the true daily direction emerges — a position based on pre-market structure that has not been confirmed by an H1 body close after the NY open is holding a view before the actual session has spoken.`,
    },
  },

  // ── EUROPEAN INDICES ───────────────────────────────────────────────────────
  {
    group: 'EUROPEAN_INDICES',
    symbols: ['UK100', 'GER40'],
    characterContext: `I am trading a European equity index — FTSE (UK100) or DAX (GER40). European indices are London-session dominant instruments. They set their primary directional narrative during London hours, and that narrative is frequently challenged — and sometimes reversed — when US futures become active at the London/NY overlap. The London morning move is real; its survival to end-of-day is conditional on US alignment.

SL awareness: European indices carry wide daily ranges during London session momentum. GER40 (DAX) is typically more volatile than UK100 (FTSE) — structural levels on GER40 are pierced more aggressively and the stop distances required to absorb normal noise are proportionally wider. The London open is a high-wick-activity window on both instruments — stops placed at the most obvious prior levels during the first London candles are positioned in the opening sweep zone.

TP awareness: Prior day close, prior session high/low, and round numbers are observed structural reference points. The London/NY overlap is a recognized inflection zone — a European index move that has run strongly through London without a pullback faces the highest probability of reversal or consolidation at the point US participants arrive. A move confirmed by both London and NY participation is structurally sounder than a London-only move.`,
    styleNotes: {
      SCALP: `On SCALP, the London open window on European indices is characterized by aggressive wicks — particularly in the first 15–30 minutes before the opening volatility has been absorbed. M5 wicks during the opening window are wider relative to bodies than at any other time on these instruments. A confirmed M5 body close after the opening wick has completed carries more directional weight than a position taken during the wick itself.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, a London break of the prior Asian range confirmed on M15 is a recognized behavioral pattern on European indices. The Asian session establishes a range on these instruments because Asian participants are positioning — London then hunts that range before deciding direction. The M15 body close after the Asian range sweep is the signal; the sweep itself is not.`,
      INTRADAY: `On INTRADAY, H1 structural moves on European indices built during London hours are the primary reference. When a London H1 move stalls at the London/NY overlap and a reversal candle forms, that is not a random pullback — it is a recognized behavioral transition as US participants take a different view. H1 moves that survive the overlap with continuation volume are structurally more confirmed than those that pause exactly at the overlap.`,
    },
  },

  // ── CRYPTO (BTC, ETH) ──────────────────────────────────────────────────────
  {
    group: 'CRYPTO',
    symbols: ['BTCUSD', 'ETHUSD'],
    characterContext: `I am trading a cryptocurrency. Crypto markets operate 24/7 with no session gaps — but not all hours are equal. US trading hours produce the highest volume and most structurally meaningful moves on these instruments. Outside US hours, particularly during Asian and early European sessions, crypto operates with a thinner book. Thin-book conditions mean that stop clusters at obvious round numbers and structural levels are swept by proportionally smaller order flow than would be required during US hours.

SL awareness: Crypto carries wide ATR and aggressive wick behavior at round-number levels and obvious structural zones. False breaks through key levels followed by sharp reversals are a documented pattern — this is not failed structure, it is the instrument collecting liquidity from participants positioned at the obvious level before the true direction continues. The spread on crypto is wider than on Forex pairs — that spread must be factored into the true cost of any position, particularly for scalp timeframes where the profit distance is narrowest.

TP awareness: Crypto is capable of extended trending moves once momentum is confirmed by volume. Volume-confirmed breaks of psychological levels carry directional weight. Prior day and prior week high/low are the most observable structural reference points. A price level that has been respected across multiple days on crypto carries more structural weight than a level established in a single session.`,
    styleNotes: {
      SCALP: `On SCALP, crypto M5 wicks at round numbers and structural levels are among the most aggressive of any instrument. The combination of a thin book, a wide spread, and a well-known level creates conditions where the wick-hunt is the instrument's primary M5 behavior rather than the exception. A wick through a level followed by an M5 body close on the other side — with a close back inside the prior range — is the hunt completing. That completion is a different event from a genuine break. M5 body closes carry the directional vote; wick extremes carry the liquidity hunt.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, US session hours produce the cleanest M15 structural moves on crypto. An M15 move during Asian session hours reflects thinner participation — the same pattern that produces a sustained directional move during US hours may simply fade during Asian hours because the order flow supporting it is not present. Session context is part of the read on crypto in a way it is not on instruments with session anchors.`,
      INTRADAY: `On INTRADAY, prior day and weekly high/low are the dominant H1 structural reference points on crypto. Crypto H1 trends are capable of extending multiple ATR units within a single session once momentum is established and confirmed by volume. An H1 trend that begins during US hours with confirmed volume is a different trade to a drift trend that forms during low-volume Asian hours and has not been tested by US participants.`,
    },
  },

  // ── COMMODITY CURRENCIES (AUD, NZD, CAD) ───────────────────────────────────
  {
    group: 'COMMODITY_FX',
    symbols: ['AUDUSD', 'NZDUSD', 'USDCAD'],
    characterContext: `I am trading a commodity-linked currency pair. AUD/USD, NZD/USD, and USD/CAD are influenced by commodity prices and global risk sentiment — they do not move on Forex flows alone. AUD and NZD pairs see their highest directional activity during Sydney and Tokyo session hours; those sessions are their natural environment in a way that London is not. USD/CAD is US-session dominant and carries a real-time correlation to oil prices — a sudden oil price move during the session is a direct input to USDCAD, not just a contextual factor.

SL awareness: These pairs generally exhibit less wick-aggressive price action than Gold, Yen crosses, or Indices. The structural levels they form tend to be respected with more consistency than on high-volatility instruments. USD/CAD is the exception during CAD data releases and oil price shocks — USDCAD in these moments behaves more like an index or commodity than a Forex pair, with spike behavior that can exceed any prior technical anchor. Treating USDCAD as a calm pair during active oil or CAD news events is a misread of the instrument's current character.

TP awareness: Session highs/lows and multi-day range boundaries are strong reference points on these instruments. AUDUSD and NZDUSD have historically shown strong reversals at multi-month range boundaries. USDCAD's commodity correlation means its directional moves are sometimes driven entirely by oil — a move with oil behind it has different extension characteristics than a purely technical USDCAD move.`,
    styleNotes: {
      SCALP: `On SCALP, AUD and NZD pairs offer some of the cleanest M5 structure during their native sessions — Sydney and Tokyo. The same pairs during London hours, when their native session participation has ended, are moving on lower volume from their primary participant base. M5 structure built during Asian hours on AUDUSD and NZDUSD carries more reliability than structure built during London or NY hours when the domestic drivers are less active.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the Sydney and Tokyo transitions are the natural inflection points for AUD and NZD pairs. An M15 structural move initiated during these sessions reflects domestic and regional participation. A USDCAD M15 move initiated during a CAD news window is a different instrument in that moment — the normal M15 structure reads do not apply when the fundamental driver is overriding the technical one.`,
    },
  },

  // ── CHF PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'CHF_PAIRS',
    symbols: ['USDCHF', 'EURCHF'],
    characterContext: `I am trading a Swiss Franc pair. CHF has a split character: in normal conditions it is a moderate-pace, well-structured pair that respects technical levels with reasonable consistency. Under conditions of financial stress, geopolitical tension, or SNB intervention, CHF pairs become a completely different instrument — the SNB has a documented history of interventions that produced moves of hundreds to over a thousand pips in minutes with no prior warning and no technical setup that predicted them.

SL awareness: In normal conditions, structural levels on CHF pairs are respected with reasonable consistency — the instrument does not have the wick-hunt aggression of Gold or Yen crosses. The risk on CHF pairs is not the normal day-to-day wick — it is the tail event. A structural stop on USDCHF or EURCHF provides containment under normal conditions and provides no containment at all if an SNB event or major risk-off flow occurs. That is the instrument's character. It cannot be read out of the setup — it is simply what CHF pairs are.

TP awareness: CHF pairs trend cleanly during sustained macro environments. Named structural levels and psychological round numbers are reliable references in trending conditions. During choppy, range-bound conditions CHF pairs lack directional follow-through and produce more false breaks per unit of move than they do in trending environments.`,
    styleNotes: {
      SCALP: `On SCALP, USDCHF and EURCHF M5 candles in normal conditions are relatively orderly. The wick behavior is not as aggressive as Gold or Yen crosses during normal sessions. The SNB tail risk on CHF pairs is not a scalp concern — it is a position-level concern. For M5 timeframe purposes, these pairs behave like moderate-volatility instruments in the absence of macro stress events.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, CHF pairs see their most reliable structural moves during London hours when European participation is highest. Swiss economic data and SNB commentary are the primary discretionary inputs that can override technical structure on these instruments — their presence changes the instrument's character for the duration of the event.`,
    },
  },

  // ── EUR CROSSES ────────────────────────────────────────────────────────────
  {
    group: 'EUR_CROSSES',
    symbols: ['EURGBP', 'EURAUD', 'EURNZD', 'EURCAD'],
    characterContext: `I am trading a EUR cross pair. EUR crosses are driven by relative strength between two currencies rather than a single macro driver — they reflect the simultaneous view on EUR and on the counter currency. This dual-currency character means EUR crosses can move in the opposite direction to what the Euro alone would suggest, because the counter currency is moving faster. The wider spread on cross pairs compared to majors is a real cost that directly affects the minimum viable R:R on these instruments — a setup that is marginally positive on a major may be marginally negative on a cross once spread is accounted for.

SL awareness: EUR crosses generally exhibit less wick-aggressive behavior than Yen crosses or Gold. EURAUD and EURNZD are exceptions — when commodity sentiment on AUD or NZD is strong, these two pairs can move sharply and non-technically, driven by the counter currency rather than by EUR. A EUR cross setup that looks technically clean can be overridden by a commodity-flow event on the counter side that has nothing to do with the technical pattern being read.

TP awareness: Range boundaries are powerful reference points on these instruments. Confirmed body closes beyond multi-day range boundaries on EUR crosses have historically been followed by measured continuation moves. H4 and D1 structural levels carry more observable weight on these instruments than shorter-timeframe anchors — the pairs move slowly enough that the meaningful context lives at higher timeframes.`,
    styleNotes: {
      SCALP: `On SCALP, EUR cross pairs are among the most challenging instruments for M5 setups. The wider spread means the noise-to-profit ratio on a short scalp target is less favorable than on a major. The slower pace of these pairs means M5 setups can look technically complete but then simply stall because there is no participant urgency to move price to the target within a scalp timeframe. A setup that is clean on EURUSD may be technically identical on EURGBP but not carry the same execution quality because the market does not need to go there quickly.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the most reliable structural reads on EUR crosses come from periods when both constituent currencies have active participants. EURGBP's highest-quality M15 structure occurs during London hours when both EUR and GBP flows are present. EURAUD and EURNZD produce their most directional M15 moves during periods of cross-currency flow — when commodity sentiment is moving AUD or NZD with conviction, the EUR cross inherits that movement regardless of what the technical setup suggests.`,
      INTRADAY: `On INTRADAY, H4 and D1 structure is the dominant read on EUR crosses. H1 setups on EUR crosses that align with the H4 directional narrative carry more weight than H1 setups that run counter to the H4 picture. The pairs move slowly enough that positioning against the H4 structure on a H1 signal frequently results in a long wait with no directional progress before the H4 reasserts itself.`,
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY FALLBACK PERSONALITIES
// Used when no explicit pair or group match is found
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FALLBACK: Record<SymbolCategory, string> = {
  forex: `I am trading a Forex pair. Forex markets are session-driven — London and NY sessions carry the highest volume and most observable directional structure. Structural price action with well-defined levels is the primary read on Forex instruments. Session context is part of every setup — a pattern that produces a clean move during London hours may produce no move or a false move outside those hours when the participant base is thinner.`,

  metal: `I am trading a precious metal. Metals are macro-reactive with aggressive wick behavior. Structural levels are frequently swept before the real move begins — wick penetration of obvious structural anchors is a recognized behavioral pattern on this instrument class, not necessarily an invalidation signal. The book on metals is thinner during off-hours, and thin-book conditions mean the noise floor is wider than during peak session hours.`,

  index: `I am trading an equity index. Indices are session-gated instruments with peak volatility at session open. Opening spikes on indices frequently sweep obvious structural levels before the session direction is established. Named prior session highs/lows and psychological round numbers are observed structural reference points — and they are also where the opening sweep targets tend to form.`,

  crypto: `I am trading a cryptocurrency. Crypto operates 24/7 with no session anchor, but US trading hours produce the most structurally meaningful moves. Aggressive wick behavior at round-number and structural levels is the norm on this instrument class. Outside US hours, the book is thinner and the same pip distance that is structural breathing room during US hours may be inside the noise during Asian or early European sessions.`,

  energy: `I am trading an energy instrument. Energy markets react sharply to supply/demand news, OPEC decisions, and geopolitical events. Volatility spikes on energy instruments frequently exceed structural anchors without prior warning — fundamental news is a first-order input on this instrument class, not just context. Intraday technical structure on energy instruments can be overridden entirely by a supply or demand headline that changes the fundamental picture mid-session.`,
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
 * CCIP-2026-0401-PAIR-PERSONALITY-V2 — SSOT authority for this function.
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
 * CCIP-2026-0401-PAIR-PERSONALITY-V2 — SSOT authority for this function.
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
