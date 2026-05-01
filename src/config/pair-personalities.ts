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

TP awareness: EURUSD moves in measured, clean waves. Named daily and session highs/lows are observed structural reference points. Opportunities exist in every session — Alpha reads the current structural setup and range for the edge that is present now.`,
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

TP awareness: Cable is capable of strong, extended impulsive legs from confirmed moves. Named prior session highs/lows and key psychological levels are observed structural reference points. Opportunities exist in every session — Alpha reads the current structural setup for the edge that is present now.`,
    styleNotes: {
      SCALP: `On a SCALP timeframe, GBPUSD M5 candles frequently produce wide wicks at key structural levels. The sweep — a fast move through the obvious level before reversal — is a recognized pattern on this instrument. When the wick has completed and the body has closed back on the other side, that is a different setup to entering before the sweep has resolved. Cable rewards patience at structural extremes.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the M15 wick-then-body-close pattern on Cable is one of the most recognizable in Forex. A long wick through a prior high or low followed by an M15 body close back inside the prior range is the pair announcing its liquidity hunt. What follows that pattern carries more directional weight than a simple break without the sweep.`,
      INTRADAY: `On INTRADAY, Cable's H1 structural narrative is shaped by session activity. A Cable H1 trend that is still in motion after a strong session move may face challenge as new participants arrive — Alpha reads the H1 confirmation and structure rather than assuming continuation or reversal.`,
    },
  },

  // ── YEN PAIRS ──────────────────────────────────────────────────────────────
  {
    group: 'YEN_PAIRS',
    symbols: ['USDJPY', 'GBPJPY', 'EURJPY', 'AUDJPY'],
    characterContext: `I am trading a Yen pair. Yen crosses share a distinctive behavioral character: fast, momentum-driven moves with sharp reversals when risk sentiment shifts. These pairs react strongly to global risk appetite — risk-off flows (JPY strengthening) and risk-on flows (JPY weakening) move Yen crosses in a way that can override local technical structure. Tokyo session produces genuine, observable directional movement on Yen pairs. Range sweeps before major directional moves are a recognized behavioral pattern — the pair distributing liquidity before committing to a direction.

SL awareness: Yen pairs spike aggressively at structural levels and at session transitions. GBPJPY has the widest typical daily range and deepest structural sweeps of the group — what constitutes a safe stop distance on USDJPY is frequently inside the noise on GBPJPY. USDJPY is tighter-behaving than the crosses, but it is also highly sensitive to sudden risk-off flows that can generate fast, uninterrupted moves in either direction without warning.

TP awareness: When Yen pairs move with momentum, they extend further than local structure alone suggests. Named session levels and key psychological round numbers are observed reference points. A Yen pair breakout with genuine risk-flow behind it does not respect intermediate local structure the way a ranging pair would.

DRIFT & SPREAD DISCIPLINE: Yen crosses — particularly GBPJPY — have high pip velocity, meaning the distance price travels in the seconds between decision and fill is meaningful. A planned entry on a Yen cross is a zone; the fill is wherever the tape is at the moment of execution. Alpha sizes the stop so it tolerates several pips of decision-to-fill drift on top of the structural invalidation distance — a stop so tight that a normal few-pip drift consumes it is not a stop calibrated for this pair's velocity.`,
    styleNotes: {
      SCALP: `On SCALP, Yen pairs have fast M5 candles with real pip velocity. A directional candle on GBPJPY covers the same distance in M5 that takes EURUSD several candles — the clock runs differently on this instrument. A confirmed M5 body close in direction carries genuine weight here. A few pips of entry precision changes the realized R:R meaningfully because the pip moves are large and the entry timing is what defines whether the stop is in front of or behind the structural anchor.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the Tokyo session range is an observable, structural reference frame for Yen pairs. A break of an established range accompanied by an M15 body confirmation is a recognized behavioral pattern — the sweep of the range is the hunt, and the M15 body close after that sweep is the tell. A wick through the range that does not produce an M15 body confirmation is not yet a break; it is the hunt in progress.`,
      INTRADAY: `On INTRADAY, Yen pairs are driven by macro risk flows at the H1 level. An H1 structural move on a Yen cross that aligns with the prevailing risk sentiment (risk-on or risk-off) carries more conviction than an H1 move that runs against the macro tone. H1 moves on Yen pairs that lack macro alignment are more likely to stall at prior session boundaries.`,
    },
  },

  // ── US INDICES ─────────────────────────────────────────────────────────────
  {
    group: 'US_INDICES',
    symbols: ['US30', 'NAS100', 'SPX500'],
    characterContext: `I am trading a US equity index. US indices — Dow Jones, NASDAQ, S&P 500 — have a clear personality: strong directional moves bookended by liquidity sweeps at key structural levels. Pre-market and early session candles establish range boundaries that frequently get swept before the dominant direction asserts itself. Named level sweeps before real moves are a core behavioral pattern on these instruments — not randomness, but the instrument clearing liquidity before committing.

SL awareness: US indices print wide-ranging candles at high-activity windows and frequently spike through obvious structural levels — previous day high/low, psychological round numbers, session highs/lows — before the direction is established. Stops placed at the most obvious levels during high-activity windows are positioned where the opening spike targets them. NAS100 carries the highest intraday volatility of the three — structural sweeps on NAS100 are typically deeper and faster than equivalent moves on SPX500 or US30. Major economic data releases produce spike candles that move through intraday structural anchors as if they are not there.

TP awareness: When these indices trend with genuine momentum, they trend cleanly for extended periods. The prior session's close, prior day's range boundaries, and psychological round numbers are observed structural reference points. Opportunities exist in every session — Alpha reads the current structural setup and live ATR to find the edge that is present now.

DRIFT & SPREAD DISCIPLINE: US indices — especially NAS100 — are the fastest-moving instruments in this watchlist. Price can travel more than 5 pips in the seconds between a decision being formed and an execution reaching the market, particularly during the first hour of cash session and around data releases. A planned entry on NAS100 is a target zone, not a tick. A stop sized so tightly that normal decision-to-fill drift consumes most of it is not a stop for this instrument — it is a stop for a slower one. Alpha places the planned entry such that its full structural stop distance remains intact even after realistic fast-market drift (roughly 1.5× typical drift) has been absorbed. NAS100 requires the widest drift tolerance of this group; US30 and SPX500 are faster than Forex but tighter than NAS100.

SL NOISE FLOOR (CCIP-2026-0429D — INDEX STOP SURVIVAL): US indices consume stops placed inside their structural noise floor. The noise floor is the typical retrace a directional move makes before continuing — not an ATR number, but a behavioral footprint. Structural stop distances that fall below this footprint are stops guaranteed to be taken out by routine price discovery before the actual thesis is invalidated. NAS100: the widest noise floor of the watchlist; stops co-located with the most recent M5 swing on NAS100 during cash session routinely get swept by the next M5 bar. US30: wide but narrower than NAS100; its noise floor expands noticeably around opening prints and FOMC/NFP windows and contracts during late-NY quiet hours. SPX500: the tightest of the three and the best-behaved in structural retests, but still produces meaningful stop sweeps at round-number magnets and prior-day extremes. Alpha's rule for all three: the structural SL distance must exceed the last comparable noise-floor retrace on the control timeframe with genuine room on top — not by an engineered multiple, but by enough that a routine retest does not consume the stop.

SESSION AFFINITY (CCIP-2026-0429E — INDEX SESSION DYNAMICS): US indices are US-session-native instruments. The structural regime differs materially by session and by index:
  • Pre-cash (before NY open): Thin participation, wider spreads, dominated by futures rolls and overnight positioning. Moves printed during this window are exploratory, not committal. Wait intents at pre-cash levels should price in that those levels are frequently swept at the open.
  • Cash session open (first 60–90 minutes of NY): The highest-edge window on US indices. Opening range establishes the dealing range for the session; the first genuine sweep of either extreme with a reclaim on the control TF is the highest-probability directional trigger. This is also the window of maximum stop-hunt risk — execute_now inside the first 15 minutes without a confirmed sweep-reclaim is adverse-selection territory.
  • London/NY overlap (for US30, SPX500 especially): When the European session is still live, US30 and SPX500 track European index narrative before cash-session fully asserts; NAS100 is less tethered and leads more often.
  • Mid-NY quiet (lunch hour ~16:30–18:00 UTC): Noise floor tightens, volume drops. Continuation setups initiated here frequently stall until late-session participation returns.
  • Late-NY momentum (last 90 minutes to close): The second-highest-edge window. Position-unwind flows produce clean continuation or reversal prints depending on the day's narrative, and prior-day extremes are genuine structural magnets.
Per-index session bias: NAS100 — strongest at cash open and late-NY, most volatile around mega-cap earnings and Fed events; US30 — follows cyclical / industrial narrative, cleanest on macro data days and steadier than NAS100 during lunch quiet; SPX500 — the broadest-market benchmark, most reliable for mean-reversion at dealing-range extremes and round-number magnets, quietest of the three overnight.`,
    styleNotes: {
      SCALP: `On SCALP, US indices produce their widest M5 wicks at high-activity structural levels. The opening range — the initial volatility window when participation surges — frequently sweeps both the prior high and prior low before the session direction is chosen. An M5 stop placed at the obvious prior level during this window is inside the opening sweep zone. The opening range, once the initial volatility has been absorbed, tends to act as a boundary — a confirmed M5 body break of that boundary after the noise has resolved is a different trade to entering before the sweep has completed.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the dominant directional move on US indices is established after the initial volatility at session opens resolves. M15 body confirmation after the initial spike has settled produces cleaner reads than attempting to read direction during the opening volatility itself. The opening spike is the instrument distributing liquidity — what happens after that distribution is the actual market view.`,
      INTRADAY: `On INTRADAY, H1 candles built after the initial session open volatility carries the dominant directional information on US indices. A position based on pre-move structure should be confirmed by an H1 body close that validates the direction before the established level is tested — Alpha reads the H1 confirmation and structural narrative.`,
    },
  },

  // ── EUROPEAN INDICES ───────────────────────────────────────────────────────
  {
    group: 'EUROPEAN_INDICES',
    symbols: ['UK100', 'GER40'],
    characterContext: `I am trading a European equity index — FTSE (UK100) or DAX (GER40). European indices set their primary directional narrative during London hours, and that narrative is frequently challenged — and sometimes reversed — when US futures become active at the London/NY overlap. The London morning move is real; its survival to end-of-day is conditional on US alignment.

SL awareness: European indices carry wide daily ranges during momentum sessions. GER40 (DAX) is typically more volatile than UK100 (FTSE) — structural levels on GER40 are pierced more aggressively and the stop distances required to absorb normal noise are proportionally wider. High-activity windows on both instruments see elevated wick behavior — stops placed at the most obvious prior levels during these windows are positioned in the sweep zone.

TP awareness: Prior day close, prior session high/low, and round numbers are observed structural reference points. The London/NY overlap is a recognized inflection zone — a European index move that has run strongly without a pullback faces the highest probability of reversal or consolidation as new participants arrive. A move confirmed by multiple session participations is structurally sounder than a single-session move.`,
    styleNotes: {
      SCALP: `On SCALP, the high-activity windows on European indices are characterized by aggressive wicks — particularly in the first 15–30 minutes before the opening volatility has been absorbed. M5 wicks during the opening window are wider relative to bodies than at any other time on these instruments. A confirmed M5 body close after the opening wick has completed carries more directional weight than a position taken during the wick itself.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, European indices establish a range before the major session move resolves. A break of that established range confirmed on M15 is a recognized behavioral pattern — the range sweep is the liquidity hunt, and the M15 body close after that sweep is the signal. Alpha reads the current M15 structure for the directional edge present now.`,
      INTRADAY: `On INTRADAY, H1 structural moves on European indices built during the London session are the primary reference. When an H1 move stalls at a major overlap window and a reversal candle forms, that is a recognized behavioral transition as new participants take a view. H1 moves that survive the overlap with continuation volume are structurally more confirmed than those that pause exactly at the overlap.`,
    },
  },

  // ── CRYPTO (BTC, ETH) ──────────────────────────────────────────────────────
  {
    group: 'CRYPTO',
    symbols: ['BTCUSD', 'ETHUSD'],
    characterContext: `I am trading a cryptocurrency. Crypto markets operate 24/7 with no session gaps — structure exists and can be traded in every session. The instrument's behavioral character is constant: aggressive wick behavior at round-number levels and obvious structural zones, with false breaks through key levels followed by sharp reversals as a documented pattern — this is the instrument collecting liquidity before the true direction continues.

SL awareness: Crypto carries wide ATR and aggressive wick behavior at round-number levels and obvious structural zones. The spread on crypto is wider than on Forex pairs — that spread must be factored into the true cost of any position, particularly for scalp timeframes where the profit distance is narrowest. Alpha uses live ATR to size stops — structural breathing room is always calibrated to current conditions, not to a fixed session label.

TP awareness: Crypto is capable of extended trending moves once momentum is confirmed by volume. Volume-confirmed breaks of psychological levels carry directional weight. Prior day and prior week high/low are the most observable structural reference points. A price level that has been respected across multiple days on crypto carries more structural weight than a level established in a single session.

DRIFT & SPREAD DISCIPLINE: Crypto combines a wide spread with fast tick movement — the cost of reaching the market is larger per unit of price than any Forex pair, and the distance travelled during that reach is also larger. A planned crypto entry is always a zone. Alpha accounts for both the spread cost and the realistic decision-to-fill drift when choosing the planned entry: the stop distance must remain structurally valid after the spread has been crossed and after several pips of drift have been absorbed. A scalp setup on crypto whose viability depends on a perfect tick fill is not a setup — it is a coin toss dressed up as a plan.`,
    styleNotes: {
      SCALP: `On SCALP, crypto M5 wicks at round numbers and structural levels are among the most aggressive of any instrument. The combination of a wide spread and a well-known level creates conditions where the wick-hunt is the instrument's primary M5 behavior rather than the exception. A wick through a level followed by an M5 body close on the other side — with a close back inside the prior range — is the hunt completing. That completion is a different event from a genuine break. M5 body closes carry the directional vote; wick extremes carry the liquidity hunt.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, crypto produces M15 structural moves in every session. Opportunities exist whenever price is forming identifiable structure — confirmed M15 body closes, named levels, and directional momentum. Alpha reads what the M5/M15 tape is showing right now and assesses whether a structural edge exists in the current conditions.`,
      INTRADAY: `On INTRADAY, prior day and weekly high/low are the dominant H1 structural reference points on crypto. Crypto H1 trends are capable of extending multiple ATR units within a single session once momentum is established and confirmed by volume. Alpha assesses each H1 trend on its structural integrity and momentum — structure and trend that exists is tradeable regardless of when it formed.`,
    },
  },

  // ── COMMODITY CURRENCIES (AUD, NZD, CAD) ───────────────────────────────────
  {
    group: 'COMMODITY_FX',
    symbols: ['AUDUSD', 'NZDUSD', 'USDCAD'],
    characterContext: `I am trading a commodity-linked currency pair. AUD/USD, NZD/USD, and USD/CAD are influenced by commodity prices and global risk sentiment — they do not move on Forex flows alone. AUD and NZD pairs see strong directional activity during Sydney and Tokyo session hours; those sessions are their natural environment. USD/CAD has a real-time correlation to oil prices — a sudden oil price move during the session is a direct input to USDCAD, not just a contextual factor.

SL awareness: These pairs generally exhibit less wick-aggressive price action than Gold, Yen crosses, or Indices. The structural levels they form tend to be respected with more consistency than on high-volatility instruments. USD/CAD is the exception during CAD data releases and oil price shocks — USDCAD in these moments behaves more like an index or commodity than a Forex pair, with spike behavior that can exceed any prior technical anchor. Treating USDCAD as a calm pair during active oil or CAD news events is a misread of the instrument's current character.

TP awareness: Session highs/lows and multi-day range boundaries are strong reference points on these instruments. AUDUSD and NZDUSD have historically shown strong reversals at multi-month range boundaries. USDCAD's commodity correlation means its directional moves are sometimes driven entirely by oil — a move with oil behind it has different extension characteristics than a purely technical USDCAD move.`,
    styleNotes: {
      SCALP: `On SCALP, AUD and NZD pairs offer clean M5 structure — particularly during their native Sydney and Tokyo sessions where domestic participation is highest. These pairs produce tradeable M5 setups across all sessions; Alpha reads the current live structure and ATR to assess the edge present now.`,
      MICRO_INTRADAY: `On MICRO_INTRADAY, the Sydney and Tokyo transitions are natural inflection points for AUD and NZD pairs. An M15 structural move initiated during these sessions reflects domestic and regional participation. A USDCAD M15 move initiated during a CAD news window is a different instrument in that moment — the normal M15 structure reads do not apply when the fundamental driver is overriding the technical one.`,
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
      MICRO_INTRADAY: `On MICRO_INTRADAY, CHF pairs produce their most reliable structural moves during European session hours when Swiss and European participation is highest. Swiss economic data and SNB commentary are the primary discretionary inputs that can override technical structure on these instruments — their presence changes the instrument's character for the duration of the event.`,
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
  forex: `I am trading a Forex pair. Forex markets are session-influenced — different sessions bring different participant bases and activity levels. Structural price action with well-defined levels is the primary read on Forex instruments. Opportunities exist in every session — Alpha reads the current structural setup and finds the edge that is present now, regardless of which session is active.`,

  metal: `I am trading a precious metal. Metals are macro-reactive with aggressive wick behavior. Structural levels are frequently swept before the real move begins — wick penetration of obvious structural anchors is a recognized behavioral pattern on this instrument class, not necessarily an invalidation signal. Alpha uses live ATR to size stops — structural breathing room calibrates to the current session's actual conditions automatically.`,

  index: `I am trading an equity index. Indices are session-influenced instruments with elevated volatility at session opens and key data releases. Opening spikes on indices frequently sweep obvious structural levels before the session direction is established. Named prior session highs/lows and psychological round numbers are observed structural reference points — and they are also where the opening sweep tends to target. Opportunities exist in every session — Alpha reads the current structural setup for the edge present now.`,

  crypto: `I am trading a cryptocurrency. Crypto operates 24/7 with no session gaps — structure exists and can be traded in every session. Aggressive wick behavior at round-number and structural levels is the norm on this instrument class. Alpha uses live ATR to define structural breathing room — stop sizing calibrates to current conditions automatically, making the instrument tradeable in every session.`,

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
