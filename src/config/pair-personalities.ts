/**
 * Pair Personalities — Instrument Character Injections
 *
 * ═══════════════════════════════════════════════════════════════════
 * CCIP-2026-0421-PAIR-PERSONALITY-V3
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
 * CCIP-2026-0421 SESSION NEUTRALITY PRINCIPLE:
 * Opportunities exist in every session. Every session has structure that
 * can be read, levels that can be traded, and directional edge that can
 * be found. Alpha assesses each session independently on the live candle
 * evidence — no session is pre-labelled as thin, unreliable, or not worth
 * trading. Session time affects HOW Alpha reads structure (stop sizing from
 * live ATR, wick behavior relative to current book depth) but NEVER WHETHER
 * Alpha trades. The decision to trade is always based on whether structural
 * edge exists — not on which session the clock shows.
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

SL awareness: Gold requires breathing room. Stops placed at obvious structural levels (equal highs/lows, session pivots) are routinely swept before the real move begins. A tight stop on Gold is a gift to the market. Named swing highs and lows on Gold are known to the market — a stop placed just beyond a named level is still at the level, not behind it. Alpha uses live ATR to determine what structural breathing room looks like in the current session — stop size calibrates to present conditions.

TP awareness: Gold can run hard once a level clears. Named structural levels (prior session highs/lows, daily high/low) are observed reference points. Partial liquidity sweeps are common — a confirmed close beyond a level carries more weight than a wick through it.

DRIFT & SPREAD DISCIPLINE: Gold moves several pips between a decision being formed and an execution reaching the market. A planned entry is a target zone, not a precise tick. Alpha sizes the stop so it absorbs this normal decision-to-fill drift in addition to structural noise — a stop that becomes invalid from a few pips of drift was never sized for this instrument. The planned entry should be chosen at a price that still has its full structural stop distance intact even after several pips of realistic drift have been absorbed.

SL NOISE FLOOR (CCIP-2026-0501A — GOLD STOP SURVIVAL): Gold consumes stops placed inside its structural noise floor more aggressively than any Forex pair. The noise floor is the typical retrace a directional move makes before continuing — behavioral, not an ATR number. Gold's noise floor expands noticeably during London/NY overlap and around US CPI, NFP, and FOMC windows, and contracts (but does not disappear) in late Asian hours. A structural stop placed at the most recent M5/M15 swing during London or NY is frequently consumed by the very next candle's wick. The structural SL distance must exceed the last comparable noise-floor retrace on the control timeframe with genuine room on top — not a fixed multiple, but enough that a routine retest does not take it out.

SESSION AFFINITY (CCIP-2026-0501A — GOLD SESSION DYNAMICS): Gold is a macro-reactive instrument whose behavior shifts materially by session:
  • Asian session (Tokyo): Thinner participation, tighter ranges, more controlled wick behavior. Structural levels set here are frequently respected intra-Asia but re-tested or swept when London arrives. Setups initiated here must price in the London retest.
  • London open: Gold's first high-edge window. Asian range is frequently swept at or shortly after London open — that sweep-then-reclaim is one of the most reliable behavioral triggers on this instrument. Stops placed at the Asian high/low at London open are positioned inside the sweep zone.
  • London/NY overlap: Highest volatility and highest stop-hunt density. Gold prints its widest wicks in this window. Execute_now inside an obvious structural level during the first 15 minutes of overlap without a confirmed sweep-reclaim is adverse-selection territory.
  • Mid-NY: Continuation window once the overlap flush resolves. A direction established and confirmed by London/NY overlap frequently extends through mid-NY unless a US data release interrupts.
  • Late-NY and post-close: Ranges tighten, participation drops. Gold's structural stops are most durable here, but so are the fewest real continuation opportunities.
Named swing levels on Gold are highest-conviction at London open and London/NY overlap — those are the windows where the full participant base sees them. A level swept during Asian hours alone does not carry the same structural weight as one tested with full participation.

Opportunities exist in every session on Gold. Alpha reads the live candle structure and ATR to find the edge that is present right now — the structural pattern and the stop sizing both calibrate to current conditions, not to a fixed session label.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, Gold's M5 wicks are aggressive. A single institutional order flow event moves Gold through several pips without touching a named structural level — what looks like a wick is often just normal candle mechanics on this instrument.

Wick-hunt completions — a wick through a level followed by a close back inside — frequently precede the directional move. The wick IS the hunt. The hunt is the level clearing before the real participants enter.

The most common way a Gold scalp dies is not a bad thesis — it is a structurally correct thesis with a stop that sits inside the noise. Alpha uses live ATR to place the stop where the structure genuinely invalidates, not at the nearest obvious level.

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

TP awareness: EURUSD moves in measured, clean waves. Named daily and session highs/lows are observed structural reference points. Opportunities exist in every session — Alpha reads the current structural setup and range for the edge that is present now.

SL NOISE FLOOR (CCIP-2026-0501A — EURUSD STOP SURVIVAL): EURUSD has the tightest noise floor of any instrument in the watchlist — structural levels are respected with more consistency than on Gold or Yen crosses. The risk here is not wick aggression; it is crowding. The most obvious EURUSD levels are the most-watched levels on earth, and the most-watched levels collect the most liquidity on both sides before resolution. A structural stop placed exactly at a named prior session high/low during London or NY is positioned where retail stops cluster — that is a sweep target, not a safe stop. Alpha's rule: the structural SL must sit behind a level with enough room that a routine liquidity sweep does not consume it, even though EURUSD's per-candle noise is lower than volatile instruments.

SESSION AFFINITY (CCIP-2026-0501A — EURUSD SESSION DYNAMICS): EURUSD's character shifts by session in predictable ways:
  • Asian session: Narrowest ranges of the day; consolidation and range-build dominates. Breaks printed during Asia are low-conviction until confirmed at London open.
  • London open: The dominant directional window for EURUSD. The European participant base asserts the session's directional bias; the Asian range is frequently swept as part of that assertion. The highest-probability trigger here is a sweep of the Asian extreme followed by reclaim and M15 body confirmation in the opposing direction.
  • London/NY overlap: Highest volume, cleanest continuation setups when the London narrative is strong — or sharpest reversals when US flows override it. News-driven reversals at the overlap are a recognized pattern.
  • Mid-NY: Slower; continuation of the overlap's resolved direction is the dominant read.
  • Late-NY and Asian rollover: Position-squaring into London close, then quiet. Stops placed during this window need to survive the entire next London open — that is a long time for a tight stop to live.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, EURUSD M5 price action is among the cleanest of any instrument — but that cleanliness means there is nowhere to hide. A thesis that is slightly wrong on EURUSD is immediately wrong, with no erratic wick behavior to obscure the diagnosis. Entry precision and structure clarity matter more on this pair than on any volatile instrument. The spread is narrow — the structure must be precise to justify it.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, EURUSD produces clear M15 structural reads across all sessions. Alpha reads what the M15 tape is showing now — directional structure, confirmed body closes, and named levels. Each session produces its own structural context that Alpha interprets on its own terms.`,
      INTRADAY: `On INTRADAY, EURUSD H1 structural moves provide directional reads regardless of session. Alpha assesses each H1 move on its structural integrity — confirmed body closes, named levels, and the prevailing H1 narrative. Structure holds or breaks on its own merits.`,
    },
  },

  // ── GBP/USD (GBPUSD) ───────────────────────────────────────────────────────
  {
    group: 'GBPUSD',
    symbols: ['GBPUSD'],
    characterContext: `I am trading GBP/USD (GBPUSD). Cable is a pair with a recognized behavioral pattern: strong directional impulses bookended by liquidity sweeps. Before Cable picks a direction, it frequently sweeps the obvious high or low — sometimes both — before committing. This is not randomness; it is how the pair distributes liquidity before a real move.

SL awareness: GBP/USD is particularly prone to sharp wicks at high-activity windows. The sweep is the pair's behavioral signature — a stop placed at the most obvious prior high or low is positioned exactly where the sweep targets it. In clean trending conditions structural levels hold more consistently. In choppy or news-reactive conditions, wick behavior on Cable becomes erratic and the prior level is routinely overshot.

TP awareness: Cable is capable of strong, extended impulsive legs from confirmed moves. Named prior session highs/lows and key psychological levels are observed structural reference points. Opportunities exist in every session — Alpha reads the current structural setup for the edge that is present now.

SL NOISE FLOOR (CCIP-2026-0501A — GBPUSD STOP SURVIVAL): Cable has a wider noise floor than EURUSD and a more aggressive sweep habit. Cable's signature sweep — a wick through the obvious high or low followed by reversal — is the instrument telling the market where stops were clustered. A structural SL placed at the most recent obvious swing on Cable during London or overlap hours is positioned inside the sweep zone by design. The stop must sit behind the typical sweep depth, not at the level itself. In choppy conditions Cable's sweeps deepen and the required noise-floor buffer widens accordingly — structural SL sizing on Cable is never divorced from the current volatility regime.

SESSION AFFINITY (CCIP-2026-0501A — GBPUSD SESSION DYNAMICS): Cable is a London-native instrument with secondary activity at NY overlap:
  • Asian session: Thinnest participation; ranges are narrow and frequently unrepresentative of the day's actual direction. Sweeps of the Asian range at London open are one of Cable's most recognized behavioral signatures.
  • London open: Cable's highest-edge window. GBP economic data and BoE commentary concentrate here; the London participant base sets the day's structural narrative. Sweep-reclaim of the Asian extreme with M15 body confirmation at or shortly after London open is a high-conviction trigger.
  • London/NY overlap: Second-highest-activity window. US data and cross-currency flows can override the London narrative — a Cable move that ran hard through London and stalls at the overlap is frequently challenged or reversed here.
  • Mid-NY: Cable loses its primary participant base; moves initiated here without overlap confirmation often lack follow-through.
  • Late-NY / pre-Asian: Ranges tighten; stops placed here must survive until London returns.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, GBPUSD M5 candles frequently produce wide wicks at key structural levels. The sweep — a fast move through the obvious level before reversal — is a recognized pattern on this instrument. When the wick has completed and the body has closed back on the other side, that is a different setup to entering before the sweep has resolved. Cable rewards patience at structural extremes.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the M15 wick-then-body-close pattern on Cable is one of the most recognizable in Forex. A long wick through a prior high or low followed by an M15 body close back inside the prior range is the pair announcing its liquidity hunt. What follows that pattern carries more directional weight than a simple break without the sweep.`,
      INTRADAY: `On INTRADAY, Cable's H1 structural narrative is shaped by session activity. A Cable H1 trend that is still in motion after a strong session move may face challenge as new participants arrive — Alpha reads the H1 confirmation and structure rather than assuming continuation or reversal.`,
    },
  },

  // ── USD/JPY (USDJPY) ───────────────────────────────────────────────────────
  {
    group: 'USDJPY',
    symbols: ['USDJPY'],
    characterContext: `I am trading USD/JPY (USDJPY). USDJPY is a momentum-driven pair with sharp reversals when risk sentiment shifts. It reacts strongly to global risk appetite — risk-off flows (JPY strengthening) and risk-on flows (JPY weakening) can override local technical structure. Tokyo session produces genuine, observable directional movement. Range sweeps before major directional moves are a recognized behavioral pattern — the pair distributing liquidity before committing to a direction.

SL awareness: USDJPY spikes aggressively at structural levels and at session transitions. It is highly sensitive to sudden risk-off flows that can generate fast, uninterrupted moves in either direction without warning. Named structural levels on USDJPY are sweep magnets at every session transition — stops placed exactly at session highs/lows are positioned inside the instrument's recognized liquidity-hunt behavior.

TP awareness: When USDJPY moves with momentum, it extends further than local structure alone suggests. Named session levels and key psychological round numbers are observed reference points. A USDJPY breakout with genuine risk-flow behind it does not respect intermediate local structure the way a ranging pair would.

SL NOISE FLOOR (CCIP-2026-0501A — USDJPY STOP SURVIVAL): USDJPY has a wide noise floor relative to other Forex majors (narrower than Gold but wider than EURUSD). Structural SL must be calibrated to USDJPY's specific noise characteristics — tighter than Yen crosses but wider than EUR or GBP majors. Named structural levels are sweep magnets at every session transition — stops placed exactly at session highs/lows are positioned inside the instrument's recognized liquidity-hunt behavior.

SESSION AFFINITY (CCIP-2026-0501A — USDJPY SESSION DYNAMICS): USDJPY is the only Forex major with a native Asian session edge:
  • Tokyo session: USDJPY's native session. Genuine directional moves form here, driven by domestic participation and regional risk flows. USDJPY produces its cleanest structural reads during Tokyo.
  • Tokyo/London transition: Frequently sees a sweep of the Tokyo range as London participants test the Asian-set narrative. Sweep-reclaim with M15 body confirmation during this transition is a recognized USDJPY behavioral trigger.
  • London session: USDJPY remains active but less dominant than during Tokyo or NY.
  • London/NY overlap: Highest-volatility window for USDJPY — US data and risk-flow convergence produce the widest moves of the day.
  • Late NY / Asian rollover: Position unwind and risk-sentiment checks; moves initiated here that survive into the next Tokyo session carry genuine conviction. Risk-off flows can produce fast, uninterrupted JPY-strengthening moves at any time during this window.`,
    styleNotes: {
      SCALP: `On SCALP, USDJPY has fast M5 candles with real pip velocity. A confirmed M5 body close in direction carries genuine weight here. A few pips of entry precision changes the realized R:R meaningfully because the pip moves are large and the entry timing is what defines whether the stop is in front of or behind the structural anchor.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the Tokyo session range is an observable, structural reference frame for USDJPY. A break of an established range accompanied by an M15 body confirmation is a recognized behavioral pattern — the sweep of the range is the hunt, and the M15 body close after that sweep is the tell. A wick through the range that does not produce an M15 body confirmation is not yet a break; it is the hunt in progress.`,
      INTRADAY: `On INTRADAY, USDJPY is driven by macro risk flows at the H1 level. An H1 structural move that aligns with the prevailing risk sentiment (risk-on or risk-off) carries more conviction than an H1 move that runs against the macro tone. H1 moves that lack macro alignment are more likely to stall at prior session boundaries.`,
    },
  },

  // ── US INDICES ─────────────────────────────────────────────────────────────
  {
    group: 'US_INDICES',
    symbols: ['US30', 'NAS100'],
    characterContext: `I am trading a US equity index. US indices — Dow Jones, NASDAQ — have a clear personality: strong directional moves bookended by liquidity sweeps at key structural levels. Pre-market and early session candles establish range boundaries that frequently get swept before the dominant direction asserts itself. Named level sweeps before real moves are a core behavioral pattern on these instruments — not randomness, but the instrument clearing liquidity before committing.

SL awareness: US indices print wide-ranging candles at high-activity windows and frequently spike through obvious structural levels — previous day high/low, psychological round numbers, session highs/lows — before the direction is established. Stops placed at the most obvious levels during high-activity windows are positioned where the opening spike targets them. NAS100 carries higher intraday volatility than US30 — structural sweeps on NAS100 are typically deeper and faster than equivalent moves on US30. Major economic data releases produce spike candles that move through intraday structural anchors as if they are not there.

TP awareness: When these indices trend with genuine momentum, they trend cleanly for extended periods. The prior session's close, prior day's range boundaries, and psychological round numbers are observed structural reference points. Opportunities exist in every session — Alpha reads the current structural setup and live ATR to find the edge that is present now.

DRIFT & SPREAD DISCIPLINE: US indices — especially NAS100 — are the fastest-moving instruments in this watchlist. Price can travel more than 5 pips in the seconds between a decision being formed and an execution reaching the market, particularly during the first hour of cash session and around data releases. A planned entry on NAS100 is a target zone, not a tick. A stop sized so tightly that normal decision-to-fill drift consumes most of it is not a stop for this instrument — it is a stop for a slower one. Alpha places the planned entry such that its full structural stop distance remains intact even after realistic fast-market drift (roughly 1.5× typical drift) has been absorbed. NAS100 requires the widest drift tolerance of this group; US30 is faster than Forex but tighter than NAS100.

SL NOISE FLOOR (CCIP-2026-0429D — INDEX STOP SURVIVAL): US indices consume stops placed inside their structural noise floor. The noise floor is the typical retrace a directional move makes before continuing — not an ATR number, but a behavioral footprint. Structural stop distances that fall below this footprint are stops guaranteed to be taken out by routine price discovery before the actual thesis is invalidated. NAS100: the widest noise floor of the watchlist; stops co-located with the most recent M5 swing on NAS100 during cash session routinely get swept by the next M5 bar. US30: wide but narrower than NAS100; its noise floor expands noticeably around opening prints and FOMC/NFP windows and contracts during late-NY quiet hours. Alpha's rule for both: the structural SL distance must exceed the last comparable noise-floor retrace on the control timeframe with genuine room on top — not by an engineered multiple, but by enough that a routine retest does not consume the stop.

SESSION AFFINITY (CCIP-2026-0429E — INDEX SESSION DYNAMICS): US indices are US-session-native instruments. The structural regime differs materially by session and by index:
  • Pre-cash (before NY open): Thin participation, wider spreads, dominated by futures rolls and overnight positioning. Moves printed during this window are exploratory, not committal. Wait intents at pre-cash levels should price in that those levels are frequently swept at the open.
  • Cash session open (first 60–90 minutes of NY): The highest-edge window on US indices. Opening range establishes the dealing range for the session; the first genuine sweep of either extreme with a reclaim on the control TF is the highest-probability directional trigger. This is also the window of maximum stop-hunt risk — execute_now inside the first 15 minutes without a confirmed sweep-reclaim is adverse-selection territory.
  • London/NY overlap (for US30 especially): When the European session is still live, US30 tracks European index narrative before cash-session fully asserts; NAS100 is less tethered and leads more often.
  • Mid-NY quiet (lunch hour ~16:30–18:00 UTC): Noise floor tightens, volume drops. Continuation setups initiated here frequently stall until late-session participation returns.
  • Late-NY momentum (last 90 minutes to close): The second-highest-edge window. Position-unwind flows produce clean continuation or reversal prints depending on the day's narrative, and prior-day extremes are genuine structural magnets.
Per-index session bias: NAS100 — strongest at cash open and late-NY, most volatile around mega-cap earnings and Fed events; US30 — follows cyclical / industrial narrative, cleanest on macro data days and steadier than NAS100 during lunch quiet.`,
    styleNotes: {
      SCALP: `On SCALP, US indices produce their widest M5 wicks at high-activity structural levels. The opening range — the initial volatility window when participation surges — frequently sweeps both the prior high and prior low before the session direction is chosen. An M5 stop placed at the obvious prior level during this window is inside the opening sweep zone. The opening range, once the initial volatility has been absorbed, tends to act as a boundary — a confirmed M5 body break of that boundary after the noise has resolved is a different trade to entering before the sweep has completed.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the dominant directional move on US indices is established after the initial volatility at session opens resolves. M15 body confirmation after the initial spike has settled produces cleaner reads than attempting to read direction during the opening volatility itself. The opening spike is the instrument distributing liquidity — what happens after that distribution is the actual market view.`,
      INTRADAY: `On INTRADAY, H1 candles built after the initial session open volatility carries the dominant directional information on US indices. A position based on pre-move structure should be confirmed by an H1 body close that validates the direction before the established level is tested — Alpha reads the H1 confirmation and structural narrative.`,
    },
  },


];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY FALLBACK PERSONALITIES
// Used when no explicit pair or group match is found
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_FALLBACK: Record<SymbolCategory, string> = {
  forex: `I am trading a Forex pair. Forex markets are session-influenced — different sessions bring different participant bases and activity levels. Structural price action with well-defined levels is the primary read on Forex instruments. Opportunities exist in every session — Alpha reads the current structural setup and finds the edge that is present now, regardless of which session is active.`,

  metal: `I am trading a precious metal. Metals are macro-reactive with aggressive wick behavior. Structural levels are frequently swept before the real move begins — wick penetration of obvious structural anchors is a recognized behavioral pattern on this instrument class, not necessarily an invalidation signal. Alpha uses live ATR to size stops — structural breathing room calibrates to the current session's actual conditions automatically.`,

  index: `I am trading an equity index. Indices are session-influenced instruments with elevated volatility at session opens and key data releases. Opening spikes on indices frequently sweep obvious structural levels before the session direction is established. Named prior session highs/lows and psychological round numbers are observed structural reference points — and they are also where the opening sweep tends to target. Opportunities exist in every session — Alpha reads the current structural setup for the edge present now.`,


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
 * CCIP-2026-0421-PAIR-PERSONALITY-V3 — SSOT authority for this function.
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
 * CCIP-2026-0421-PAIR-PERSONALITY-V3 — SSOT authority for this function.
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
