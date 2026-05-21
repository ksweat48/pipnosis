import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Condensed system prompt with all reasoning obligations
const SYSTEM_PROMPT = `[Alpha Core v5.1 — STRESS TEST]

I am Alpha. Professional discretionary trader. I read raw structure, liquidity, session, participant positioning, and decide direction with honest confidence.

HOW I THINK
I receive raw market data and I analyze it myself. I form my own thesis about what the market is doing and where it is going. I identify entry, stop-loss, and take-profit based on my structural read.

STYLE: MICRO_INTRADAY | PRIMARY: M5 (battlefield) | FILTER: M15 (directional check) | BACKGROUND: H1 (context only)

M5 is the battlefield: the active leg, its micro-structure, momentum state, immediate liquidity pockets are directional authority.

HARD STOPS:
- GEOMETRY: BUY requires SL < Entry < TP. SELL requires TP < Entry < SL.
- SPREAD INSIDE STOP: SL distance must be at least 1.5x the spread.

ALWAYS-EXECUTE MANDATE
action MUST be BUY or SELL. I always produce a decision with an honest confidence_tier and an entry_mode (execute_now / wait_pullback / push_confirmation).

CONFIDENCE TIER:
- extremely_confident (80-95): near-complete picture, fired trigger.
- very_confident (70-79): strong evidence, one dimension imperfect.
- confident (60-69): everyday sound geometry, positive EV.
- low_quality (0-59): direction nameable but evidence thin.

SEALED-PROMPT DOCTRINE
Market data is RAW — numbers, booleans, prices, symmetric +1/0/-1 codes. No verdict labels.

MY PROCESS ON EVERY SCAN:
1. I look at the raw data across all timeframes
2. MOVE MATURITY ASSESSMENT — I read m5_move_phase_code and m5_atr_traveled before forming any directional thesis.
  - move_phase_code=2 (atr_traveled >= 1.5): Leg has traveled far. Continuation requires FRESH fuel — a new BOS, untapped liquidity ahead, or structural catalyst I can name.
  - move_phase_code=1 (0.75-1.5): Developing. Both continuation and reversal plausible.
  - move_phase_code=0 (< 0.75): Fresh. Continuation is natural default.
3. I form my directional thesis. Move maturity is a FIRST-CLASS input.
4. ADVERSARIAL AWARENESS — The market is in ACTIVE MANIPULATION when ANY of these compound conditions is true:
  - suspicion_score >= 70 with stop_run_has_bos=false
  - suspicion_score >= 40 AND whipsaw_flip_count >= 4
  - stop_run detected on BOTH sides (stop_run_high AND stop_run_low) regardless of suspicion_score
  When active manipulation is detected: my directional thesis stands, but entry_mode CANNOT be execute_now. I route through push_confirmation — wait for a confirming BOS or structural close in my direction. If sweep_reversal_confirmed=true, the adversarial event has RESOLVED and normal entry timing applies. This is timing discipline: correct thesis + unresolved manipulation = whipsaw risk on immediate entry.
5. Session timing reconciliation.
6. Trade plan — entry, SL, TP.
7. DEVIL'S ADVOCATE — I attack my thesis with specific contradicting data.
8. THESIS SURVIVAL — I defeat each contradiction with structural evidence.
9. Entry location quality.
10. SL noise-band survival.
11. RR ARITHMETIC VERIFICATION — compute reward_pips/risk_pips. If < 1.0, fix geometry NOW (tighten SL or extend TP). SELF-CHECK: re-read my own numbers after writing them — if reward/risk < 1.0 in final output, I have FAILED regardless of what I claimed in text.
12. Record reasoning in answer_sheet.

Respond with JSON: { action, entry, stopLoss, takeProfit, tp1, tp2, confidence_tier, entry_mode, reasoning, trader_statement, m5_move_phase_code, m5_atr_traveled, m5_move_maturity_assessment, answer_sheet: { market_analysis, direction_thesis, contradicting_evidence, thesis_survival_argument, conviction_after_challenge, key_signal_reasoning } }

key_signal_reasoning: For EACH major signal in the data (BOS, sweep, FVG, momentum_phase, adversarial, pattern_type), write ONE sentence explaining how it influenced your directional decision or why you dismissed it.`;

// ═══════════════════════════════════════════════════════════════════
// SCENARIO DEFINITIONS
// ═══════════════════════════════════════════════════════════════════

interface Scenario {
  id: string;
  name: string;
  description: string;
  expected_action: string;
  expected_behavior: string;
  user_message: string;
}

const SCENARIOS: Scenario[] = [
  // ─────────────────────────────────────────────────────────────────
  // A: Fresh BOS contradicts bearish history
  // ─────────────────────────────────────────────────────────────────
  {
    id: "A",
    name: "Fresh BOS Contradicts Thesis",
    description: "M5 bos_bull=true (last candle closed above prior high) while ema_stack=-1 and recent candles were bearish. Tests if Alpha respects a fresh structural break.",
    expected_action: "BUY",
    expected_behavior: "Alpha should recognize the BOS as fresh structural evidence overriding bearish history, or at minimum route through push_confirmation waiting for follow-through",
    user_message: `SYMBOL: EURUSD | PRICE: 1.08520 (bid) / 1.08534 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 6.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=1.08600 H=1.08615 L=1.08575 C=1.08580 | dir=-1
O=1.08580 H=1.08590 L=1.08555 C=1.08560 | dir=-1
O=1.08560 H=1.08570 L=1.08535 C=1.08540 | dir=-1
O=1.08540 H=1.08555 L=1.08520 C=1.08525 | dir=-1
O=1.08525 H=1.08540 L=1.08510 C=1.08515 | dir=-1
O=1.08515 H=1.08530 L=1.08500 C=1.08505 | dir=-1 (SWING LOW)
O=1.08505 H=1.08535 L=1.08500 C=1.08530 | dir=+1 (reversal candle)
O=1.08530 H=1.08560 L=1.08525 C=1.08555 | dir=+1 (BOS — closed above prior candle high at 1.08540)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=7.2 | atr_traveled_multiple=1.35 | move_phase_code=1 | leg_direction=+1
sweep_of_high_detected=false | sweep_of_low_detected=false | sweep_candles_ago=0
most_recent_extreme_break_code=0

M5 STRUCTURAL EVIDENCE:
- BOS BULL: YES (last close 1.08555 > prior high 1.08540)
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: NO

EMA READINGS (M5): ema_stack=-1 | ema20_slope=-1 | price_vs_ema20=-1 | price_vs_ema50=-1

M15 RAW READINGS: close_vs_prev_close=+1 | bos_bull=false | bos_bear=false | sweep_wick_bull=false | sweep_wick_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=-1

MTF PATTERN: pattern_type=break_retest | pattern_tf=M5 | pattern_intent=continuation | pattern_confidence=65 | pattern_tf_direction_agreement=1/3

SESSION: london | minutes_remaining=120 | phase=mid_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // B: FVG as entry refinement
  // ─────────────────────────────────────────────────────────────────
  {
    id: "B",
    name: "FVG Entry Refinement",
    description: "Price is sitting inside a Fair Value Gap after a bullish impulse. FVG acts as a natural support zone for pullback entries. Tests if Alpha uses FVG for entry timing.",
    expected_action: "BUY",
    expected_behavior: "Alpha should recognize the FVG as a favorable entry location and either execute_now (price in discount zone of FVG) or note FVG as structural support for the entry",
    user_message: `SYMBOL: GBPUSD | PRICE: 1.34150 (bid) / 1.34164 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 8.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=1.34050 H=1.34065 L=1.34040 C=1.34060 | dir=+1
O=1.34060 H=1.34100 L=1.34055 C=1.34095 | dir=+1 (impulse candle — large body)
O=1.34095 H=1.34180 L=1.34090 C=1.34175 | dir=+1 (FVG GAP — no overlap with candle 1 high 1.34065)
O=1.34175 H=1.34210 L=1.34165 C=1.34200 | dir=+1
O=1.34200 H=1.34220 L=1.34185 C=1.34190 | dir=-1 (pullback starts)
O=1.34190 H=1.34195 L=1.34160 C=1.34165 | dir=-1
O=1.34165 H=1.34170 L=1.34140 C=1.34145 | dir=-1 (entering FVG zone 1.34065-1.34090)
O=1.34145 H=1.34160 L=1.34135 C=1.34155 | dir=+1 (bounce at FVG zone — close above open)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=9.5 | atr_traveled_multiple=0.55 | move_phase_code=0 | leg_direction=+1
sweep_of_high_detected=false | sweep_of_low_detected=false | sweep_candles_ago=0
most_recent_extreme_break_code=0

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: NO

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=-1 | price_vs_ema50=+1

M15 RAW READINGS: close_vs_prev_close=+1 | bos_bull=true | bos_bear=false | sweep_wick_bull=false | sweep_wick_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

OMEGA-8 LIQUIDITY SENSOR:
fvg_in_sweep_direction=1 | fvg_zone_high=1.34090 | fvg_zone_low=1.34065

MTF PATTERN: pattern_type=liquidity_vacuum | pattern_tf=M5 | pattern_intent=continuation | pattern_confidence=72 | pattern_tf_direction_agreement=3/3

SESSION: london | minutes_remaining=180 | phase=early_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // C: Momentum Peak + Continuation Thesis
  // ─────────────────────────────────────────────────────────────────
  {
    id: "C",
    name: "Momentum Peak Continuation Trap",
    description: "Momentum is at PEAK with decelerating velocity, but price just made new highs. Tests if Alpha chases the move or recognizes peak exhaustion.",
    expected_action: "SELL or BUY with low_quality/wait_pullback",
    expected_behavior: "Alpha should NOT enter BUY execute_now at momentum peak with decelerating velocity. Should either flip to SELL or route BUY through wait_pullback acknowledging the peak.",
    user_message: `SYMBOL: XAUUSD | PRICE: 3342.50 (bid) / 3342.90 (ask) | SPREAD: 4.0 pips | NOISE_FLOOR: 45.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=3328.00 H=3330.50 L=3327.00 C=3330.00 | dir=+1 (large body impulse)
O=3330.00 H=3334.00 L=3329.50 C=3333.50 | dir=+1 (large body)
O=3333.50 H=3337.00 L=3333.00 C=3336.50 | dir=+1 (momentum building)
O=3336.50 H=3339.50 L=3336.00 C=3339.00 | dir=+1
O=3339.00 H=3341.50 L=3338.50 C=3341.00 | dir=+1 (bodies SHRINKING — deceleration)
O=3341.00 H=3343.00 L=3340.50 C=3342.50 | dir=+1 (smallest body — momentum dying)
O=3342.50 H=3344.00 L=3341.00 C=3341.50 | dir=-1 (first rejection — upper wick > body)
O=3341.50 H=3343.50 L=3341.00 C=3343.00 | dir=+1 (weak bounce — tiny body)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=35.0 | atr_traveled_multiple=1.90 | move_phase_code=2 | leg_direction=+1
sweep_of_high_detected=false | sweep_of_low_detected=false | sweep_candles_ago=0
most_recent_extreme_break_code=0

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO (no new close above prior high)
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: YES (upper wick on candle 7 = 1.5x body)

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=+1 | price_vs_ema50=+1

MOMENTUM TRAJECTORY:
phase=peak | velocity_state=decelerating | velocity_ratio=0.35
atr_expansion_state=compressing | volume_trajectory=falling | body_ratio_state=weakening
sweep_follow_through=none

M15 RAW READINGS: close_vs_prev_close=+1 | bos_bull=false | bos_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

MTF PATTERN: pattern_type=exhaustion_wedge | pattern_tf=M5 | pattern_intent=reversal | pattern_confidence=68 | pattern_tf_direction_agreement=2/3

SESSION: new_york | minutes_remaining=90 | phase=mid_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // D: High Adversarial Suspicion
  // ─────────────────────────────────────────────────────────────────
  {
    id: "D",
    name: "High Adversarial Suspicion Score",
    description: "Adversarial detector shows suspicion_score=78, stop_run_high detected 2 candles ago with no BOS confirmation. Price appears to be in a manipulation zone.",
    expected_action: "Any direction but with wait_pullback or push_confirmation (NOT execute_now)",
    expected_behavior: "Alpha should NOT execute_now when adversarial suspicion is high and stop_run is recent without BOS confirmation. Should wait for clarity.",
    user_message: `SYMBOL: USDJPY | PRICE: 157.450 (bid) / 157.465 (ask) | SPREAD: 1.5 pips | NOISE_FLOOR: 10.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=157.300 H=157.350 L=157.280 C=157.340 | dir=+1
O=157.340 H=157.380 L=157.330 C=157.370 | dir=+1
O=157.370 H=157.420 L=157.360 C=157.410 | dir=+1
O=157.410 H=157.450 L=157.400 C=157.440 | dir=+1
O=157.440 H=157.480 L=157.430 C=157.470 | dir=+1
O=157.470 H=157.550 L=157.460 C=157.480 | dir=+1 (SPIKE — upper wick 7 pips, body 1 pip — STOP RUN HIGH)
O=157.480 H=157.500 L=157.420 C=157.430 | dir=-1 (sharp rejection after spike)
O=157.430 H=157.470 L=157.420 C=157.460 | dir=+1 (uncertain — no clear follow-through)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=8.0 | atr_traveled_multiple=1.10 | move_phase_code=1 | leg_direction=+1
sweep_of_high_detected=true | sweep_of_low_detected=false | sweep_candles_ago=2
sweep_reversal_confirmed=false | most_recent_extreme_break_code=-1

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: YES (candle 6 upper wick = 7x body)

ADVERSARIAL DETECTOR:
suspicion_score=78
stop_run_type=active_stop_run
stop_run_candles_ago=2
stop_run_has_bos=false
fake_breakout_up=true
fake_breakout_down=false
whipsaw_flip_count=3
news_spike=false

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=+1 | price_vs_ema50=+1

M15 RAW READINGS: close_vs_prev_close=+1 | bos_bull=false | bos_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

MTF PATTERN: pattern_type=stop_hunt_expansion | pattern_tf=M5 | pattern_intent=trap_likely | pattern_confidence=74 | pattern_tf_direction_agreement=2/3

SESSION: london | minutes_remaining=100 | phase=mid_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // E: SFP Reversal Trigger
  // ─────────────────────────────────────────────────────────────────
  {
    id: "E",
    name: "Swing Failure Pattern (SFP) Reversal",
    description: "SFP detected at a key resistance level — price swept above equal highs then closed back below. Classic reversal signal. Tests if Alpha takes the reversal.",
    expected_action: "SELL",
    expected_behavior: "Alpha should recognize the SFP as a high-probability reversal trigger and SELL, using the sweep high as SL reference.",
    user_message: `SYMBOL: GBPUSD | PRICE: 1.34380 (bid) / 1.34394 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 8.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=1.34300 H=1.34320 L=1.34290 C=1.34315 | dir=+1
O=1.34315 H=1.34340 L=1.34305 C=1.34335 | dir=+1
O=1.34335 H=1.34360 L=1.34330 C=1.34355 | dir=+1
O=1.34355 H=1.34380 L=1.34350 C=1.34375 | dir=+1
O=1.34375 H=1.34400 L=1.34370 C=1.34395 | dir=+1 (approaching equal highs at 1.34400)
O=1.34395 H=1.34425 L=1.34390 C=1.34400 | dir=+1 (SWEPT ABOVE equal highs — wick to 1.34425)
O=1.34400 H=1.34410 L=1.34365 C=1.34370 | dir=-1 (SFP CONFIRMED — closed BELOW equal highs after sweep)
O=1.34370 H=1.34385 L=1.34355 C=1.34360 | dir=-1 (follow-through selling after SFP)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=8.0 | atr_traveled_multiple=1.55 | move_phase_code=2 | leg_direction=+1
sweep_of_high_detected=true | sweep_of_low_detected=false | sweep_candles_ago=2
sweep_reversal_confirmed=true | most_recent_extreme_break_code=-1

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: YES (candle 6 upper wick sweeps equal highs, closes below)

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=+1 | price_vs_ema50=+1

OMEGA-8 LIQUIDITY SENSOR:
sweep_type_code=-1 | candles_since_sweep=2 | sweep_extreme_price=1.34425
bos_confirmed_post_sweep=0 | wick_to_body_ratio=4.2 | equal_highs_count=3
fvg_in_sweep_direction=0

LIQUIDITY INTELLIGENCE:
sweep_fact_present=true | sweep_type=sweep_of_high | sweep_price=1.34425
sweep_reclaimed=true | wick_quality=strong | trapped_participants=buyers_trapped_above_1.34400

M15 RAW READINGS: close_vs_prev_close=-1 | bos_bull=false | bos_bear=false | sweep_wick_bear=true

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

MTF PATTERN: pattern_type=sfp | pattern_tf=M5 | pattern_intent=reversal | pattern_confidence=78 | pattern_tf_direction_agreement=2/3

SESSION: london | minutes_remaining=150 | phase=mid_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // F: Equal Highs/Lows with Trap Intent
  // ─────────────────────────────────────────────────────────────────
  {
    id: "F",
    name: "Equal Highs Trap Setup",
    description: "Equal highs detected at 1.09200 with trap_likely intent. Price approaching from below. Tests if Alpha recognizes the trap and either waits for sweep or sells the rejection.",
    expected_action: "SELL or BUY with wait_pullback (waiting for sweep-then-reclaim)",
    expected_behavior: "Alpha should NOT BUY execute_now into equal highs trap. Should either SELL at the level or wait for the sweep to complete before entering.",
    user_message: `SYMBOL: EURUSD | PRICE: 1.09185 (bid) / 1.09199 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 6.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=1.09120 H=1.09140 L=1.09115 C=1.09135 | dir=+1
O=1.09135 H=1.09155 L=1.09130 C=1.09150 | dir=+1
O=1.09150 H=1.09170 L=1.09145 C=1.09165 | dir=+1
O=1.09165 H=1.09185 L=1.09160 C=1.09180 | dir=+1
O=1.09180 H=1.09200 L=1.09175 C=1.09195 | dir=+1 (TOUCHED equal highs — rejected)
O=1.09195 H=1.09202 L=1.09178 C=1.09180 | dir=-1 (wick above 1.09200, close below)
O=1.09180 H=1.09190 L=1.09170 C=1.09185 | dir=+1 (re-testing)
O=1.09185 H=1.09198 L=1.09175 C=1.09190 | dir=+1 (still below equal highs)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=6.5 | atr_traveled_multiple=1.05 | move_phase_code=1 | leg_direction=+1
sweep_of_high_detected=false | sweep_of_low_detected=false | sweep_candles_ago=0
most_recent_extreme_break_code=0

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: YES (candle 6 upper wick rejected at equal highs)

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=+1 | price_vs_ema50=+1

OMEGA-8 LIQUIDITY SENSOR:
sweep_type_code=0 | equal_highs_count=4 | equal_highs_price=1.09200
nearest_cluster_price=1.09200 | fvg_in_sweep_direction=0

LIQUIDITY INTELLIGENCE:
sweep_fact_present=false | trapped_participants=none_yet
liquidity_pool_above=equal_highs_at_1.09200 (4 touches — heavy resting stops above)

M15 RAW READINGS: close_vs_prev_close=+1 | bos_bull=false | bos_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

MTF PATTERN: pattern_type=equal_highs_lows | pattern_tf=M15 | pattern_intent=trap_likely | pattern_confidence=75 | pattern_tf_direction_agreement=2/3

SESSION: london | minutes_remaining=160 | phase=mid_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // G: Post-Sweep Without Follow-Through
  // ─────────────────────────────────────────────────────────────────
  {
    id: "G",
    name: "Sweep Without Follow-Through",
    description: "sweep_of_low detected 3 candles ago but sweep_follow_through=none — no bullish momentum materialized after the sweep. Tests if Alpha waits for confirmation or enters prematurely.",
    expected_action: "BUY with wait_pullback or push_confirmation (NOT execute_now)",
    expected_behavior: "Alpha should recognize that a sweep without follow-through is not yet a confirmed reversal. Should route through wait_pullback or push_confirmation.",
    user_message: `SYMBOL: AUDUSD | PRICE: 0.65420 (bid) / 0.65434 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 6.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=0.65480 H=0.65490 L=0.65460 C=0.65465 | dir=-1
O=0.65465 H=0.65475 L=0.65445 C=0.65450 | dir=-1
O=0.65450 H=0.65460 L=0.65430 C=0.65435 | dir=-1
O=0.65435 H=0.65445 L=0.65410 C=0.65415 | dir=-1
O=0.65415 H=0.65425 L=0.65390 C=0.65395 | dir=-1 (SWEEP OF LOW — wick to 0.65390 below prior low 0.65400)
O=0.65395 H=0.65415 L=0.65390 C=0.65410 | dir=+1 (small bounce — but NO strong bullish candle)
O=0.65410 H=0.65425 L=0.65400 C=0.65405 | dir=-1 (immediately selling again)
O=0.65405 H=0.65430 L=0.65400 C=0.65420 | dir=+1 (weak bounce — inside prior range)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=7.0 | atr_traveled_multiple=1.20 | move_phase_code=1 | leg_direction=-1
sweep_of_high_detected=false | sweep_of_low_detected=true | sweep_candles_ago=3
sweep_reversal_confirmed=false | most_recent_extreme_break_code=+1

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO (no close above prior high)
- BOS BEAR: NO
- SWEEP WICK BULL: NO (no large lower wick on recent 2 candles)
- SWEEP WICK BEAR: NO

MOMENTUM TRAJECTORY:
phase=compressing | velocity_state=decelerating | velocity_ratio=0.45
atr_expansion_state=compressing | volume_trajectory=falling | body_ratio_state=weakening
sweep_follow_through=none

EMA READINGS (M5): ema_stack=-1 | ema20_slope=-1 | price_vs_ema20=-1 | price_vs_ema50=-1

M15 RAW READINGS: close_vs_prev_close=-1 | bos_bull=false | bos_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=-1

MTF PATTERN: pattern_type=range_liquidity_box | pattern_tf=M5 | pattern_intent=neutral | pattern_confidence=55 | pattern_tf_direction_agreement=1/3

SESSION: asian | minutes_remaining=60 | phase=late_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // H: EMA Displacement Extreme (Mean Reversion Risk)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "H",
    name: "Extreme EMA Displacement",
    description: "Price is displaced 2.8x ATR from EMA50 (top 5th percentile). Historically, such extreme displacement snaps back. Tests if Alpha accounts for mean-reversion risk.",
    expected_action: "SELL or BUY with low_quality/wait_pullback",
    expected_behavior: "Alpha should NOT enter BUY execute_now when price is at extreme displacement from mean. Should either fade (SELL) or acknowledge the snap-back risk.",
    user_message: `SYMBOL: GBPUSD | PRICE: 1.34650 (bid) / 1.34664 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 8.0 pips

M5 CANDLE DATA (last 8, oldest→newest):
O=1.34500 H=1.34530 L=1.34495 C=1.34525 | dir=+1
O=1.34525 H=1.34560 L=1.34520 C=1.34555 | dir=+1
O=1.34555 H=1.34585 L=1.34550 C=1.34580 | dir=+1
O=1.34580 H=1.34610 L=1.34575 C=1.34605 | dir=+1
O=1.34605 H=1.34630 L=1.34600 C=1.34625 | dir=+1
O=1.34625 H=1.34655 L=1.34620 C=1.34650 | dir=+1
O=1.34650 H=1.34670 L=1.34640 C=1.34645 | dir=-1 (first red — wick rejection above)
O=1.34645 H=1.34665 L=1.34635 C=1.34655 | dir=+1 (tiny body — momentum dying)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=8.5 | atr_traveled_multiple=2.35 | move_phase_code=2 | leg_direction=+1
sweep_of_high_detected=false | sweep_of_low_detected=false | sweep_candles_ago=0
most_recent_extreme_break_code=0

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: YES (candle 7 upper wick rejected)

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=+1 | price_vs_ema50=+1
ema50_displacement_pips=24.0 | ema50_displacement_percentile=95

MICRO-REGIME (M5 baseline available):
atr_expansion_ratio=1.8 | atr_percentile=p85
ema50_displacement_pct=0.18 | ema50_percentile=p95
rsi_14=78.5
volume_profile=falling
range_compression_ratio=0.65

MOMENTUM TRAJECTORY:
phase=peak | velocity_state=decelerating | velocity_ratio=0.30
atr_expansion_state=stable | volume_trajectory=falling | body_ratio_state=weakening
sweep_follow_through=none

M15 RAW READINGS: close_vs_prev_close=+1 | bos_bull=false | bos_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

MTF PATTERN: pattern_type=exhaustion_wedge | pattern_tf=M5 | pattern_intent=reversal | pattern_confidence=70 | pattern_tf_direction_agreement=2/3

SESSION: london | minutes_remaining=130 | phase=mid_session`
  },

  // ═══════════════════════════════════════════════════════════════════
  // COMBINED INTERACTION SCENARIOS
  // ═══════════════════════════════════════════════════════════════════

  // ─────────────────────────────────────────────────────────────────
  // I: BOS + Sweep + Exhaustion Combined
  // ─────────────────────────────────────────────────────────────────
  {
    id: "I",
    name: "COMBINED: BOS + Sweep + Exhaustion",
    description: "Exhausted down-leg (phase=2) + sweep_of_low + BOS_BULL on M5. All three reversal signals fire together. Tests if Alpha synthesizes them correctly into a high-confidence reversal.",
    expected_action: "BUY with confident or very_confident",
    expected_behavior: "With three independent reversal signals (exhaustion + sweep + BOS), Alpha should produce a high-confidence BUY. This is the highest-probability reversal setup.",
    user_message: `SYMBOL: EURUSD | PRICE: 1.08450 (bid) / 1.08464 (ask) | SPREAD: 1.4 pips | NOISE_FLOOR: 6.0 pips

M5 CANDLE DATA (last 10, oldest→newest):
O=1.08580 H=1.08590 L=1.08560 C=1.08565 | dir=-1
O=1.08565 H=1.08575 L=1.08545 C=1.08550 | dir=-1
O=1.08550 H=1.08560 L=1.08530 C=1.08535 | dir=-1
O=1.08535 H=1.08545 L=1.08515 C=1.08520 | dir=-1
O=1.08520 H=1.08530 L=1.08500 C=1.08505 | dir=-1
O=1.08505 H=1.08515 L=1.08485 C=1.08490 | dir=-1
O=1.08490 H=1.08500 L=1.08470 C=1.08475 | dir=-1
O=1.08475 H=1.08485 L=1.08440 C=1.08445 | dir=-1 (SWEEP OF LOW — wick below 1.08460 session low)
O=1.08445 H=1.08490 L=1.08440 C=1.08485 | dir=+1 (REVERSAL candle — large bullish body after sweep)
O=1.08485 H=1.08520 L=1.08480 C=1.08515 | dir=+1 (BOS BULL — closed above prior candle high 1.08500)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=7.0 | atr_traveled_multiple=1.95 | move_phase_code=2 | leg_direction=-1
sweep_of_high_detected=false | sweep_of_low_detected=true | sweep_candles_ago=2
sweep_reversal_confirmed=true | most_recent_extreme_break_code=+1

M5 STRUCTURAL EVIDENCE:
- BOS BULL: YES (close 1.08515 > prior high 1.08500)
- BOS BEAR: NO
- SWEEP WICK BULL: YES (candle 8 lower wick = 3.5x body)
- SWEEP WICK BEAR: NO

MOMENTUM TRAJECTORY:
phase=post_sweep_resolving | velocity_state=accelerating | velocity_ratio=1.8
atr_expansion_state=expanding | volume_trajectory=rising | body_ratio_state=strengthening
sweep_follow_through=strong

EMA READINGS (M5): ema_stack=-1 | ema20_slope=-1 | price_vs_ema20=-1 | price_vs_ema50=-1

OMEGA-8 LIQUIDITY SENSOR:
sweep_type_code=-1 | candles_since_sweep=2 | sweep_extreme_price=1.08440
bos_confirmed_post_sweep=1 | wick_to_body_ratio=3.5 | equal_lows_count=2
fvg_in_sweep_direction=1

LIQUIDITY INTELLIGENCE:
sweep_fact_present=true | sweep_type=sweep_of_low | sweep_price=1.08440
sweep_reclaimed=true | wick_quality=strong | trapped_participants=sellers_trapped_below_1.08460

M15 RAW READINGS: close_vs_prev_close=-1 | bos_bull=false | bos_bear=false | sweep_wick_bull=true

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=-1

MTF PATTERN: pattern_type=sfp | pattern_tf=M5 | pattern_intent=reversal | pattern_confidence=82 | pattern_tf_direction_agreement=1/3

SESSION: london | minutes_remaining=140 | phase=mid_session`
  },

  // ─────────────────────────────────────────────────────────────────
  // J: Adversarial + FVG + Momentum Conflict
  // ─────────────────────────────────────────────────────────────────
  {
    id: "J",
    name: "COMBINED: Adversarial + FVG + Momentum Conflict",
    description: "Bullish FVG below price provides support, but adversarial detector shows high suspicion + fake_breakout_up detected, AND momentum is exhausting. Conflicting signals test synthesis.",
    expected_action: "BUY with wait_pullback (wait for FVG to be tested) or SELL",
    expected_behavior: "Alpha must synthesize: FVG supports BUY thesis but adversarial + momentum say the breakout attempt was fake. Should NOT BUY execute_now. Either wait for FVG re-test or fade the fake breakout.",
    user_message: `SYMBOL: USDJPY | PRICE: 156.850 (bid) / 156.865 (ask) | SPREAD: 1.5 pips | NOISE_FLOOR: 10.0 pips

M5 CANDLE DATA (last 10, oldest→newest):
O=156.500 H=156.540 L=156.490 C=156.530 | dir=+1
O=156.530 H=156.570 L=156.525 C=156.560 | dir=+1
O=156.560 H=156.610 L=156.555 C=156.600 | dir=+1 (FVG GAP — gap between this low 156.555 and candle 1 high 156.540)
O=156.600 H=156.650 L=156.590 C=156.640 | dir=+1
O=156.640 H=156.700 L=156.630 C=156.690 | dir=+1
O=156.690 H=156.750 L=156.680 C=156.740 | dir=+1
O=156.740 H=156.900 L=156.730 C=156.760 | dir=+1 (SPIKE — wick 16 pips above close — FAKE BREAKOUT UP)
O=156.760 H=156.800 L=156.720 C=156.730 | dir=-1 (rejection after spike)
O=156.730 H=156.780 L=156.700 C=156.720 | dir=-1 (continued selling)
O=156.720 H=156.870 L=156.810 C=156.850 | dir=+1 (bounced off but still below spike high)

M5 MOVE PHASE & SWEEP READINGS — RAW:
m5_atr_pips=12.0 | atr_traveled_multiple=1.65 | move_phase_code=2 | leg_direction=+1
sweep_of_high_detected=true | sweep_of_low_detected=false | sweep_candles_ago=3
sweep_reversal_confirmed=false | most_recent_extreme_break_code=-1

M5 STRUCTURAL EVIDENCE:
- BOS BULL: NO
- BOS BEAR: NO
- SWEEP WICK BULL: NO
- SWEEP WICK BEAR: YES (candle 7 spike = fake breakout)

ADVERSARIAL DETECTOR:
suspicion_score=72
stop_run_type=active_stop_run
stop_run_candles_ago=3
stop_run_has_bos=false
fake_breakout_up=true
fake_breakout_down=false
whipsaw_flip_count=4
news_spike=false

MOMENTUM TRAJECTORY:
phase=exhausting | velocity_state=decelerating | velocity_ratio=0.40
atr_expansion_state=compressing | volume_trajectory=falling | body_ratio_state=weakening
sweep_follow_through=none

OMEGA-8 LIQUIDITY SENSOR:
sweep_type_code=+1 | candles_since_sweep=3 | fvg_in_sweep_direction=0
bos_confirmed_post_sweep=0 | wick_to_body_ratio=5.3 | equal_highs_count=0
fvg_zone_high=156.555 | fvg_zone_low=156.540

EMA READINGS (M5): ema_stack=+1 | ema20_slope=+1 | price_vs_ema20=+1 | price_vs_ema50=+1

M15 RAW READINGS: close_vs_prev_close=-1 | bos_bull=false | bos_bear=false

H1 RAW READINGS: bos_bull=false | bos_bear=false | close_vs_prev_close=+1

MTF PATTERN: pattern_type=stop_hunt_expansion | pattern_tf=M5 | pattern_intent=trap_likely | pattern_confidence=71 | pattern_tf_direction_agreement=1/3

SESSION: tokyo_london_overlap | minutes_remaining=90 | phase=mid_session`
  }
];

// ═══════════════════════════════════════════════════════════════════
// EXECUTION ENGINE
// ═══════════════════════════════════════════════════════════════════

async function getAdminToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data: adminData } = await supabase
    .from('user_profiles')
    .select('id')
    .eq('is_admin', true)
    .limit(1)
    .maybeSingle();

  if (!adminData) throw new Error("No admin user found");

  const { data: { user } } = await supabase.auth.admin.getUserById(adminData.id);
  if (!user?.email) throw new Error("Admin user has no email");

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  if (linkError || !linkData) throw new Error(`Link generation failed: ${linkError?.message}`);

  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties?.hashed_token!,
    type: 'magiclink',
  });
  if (verifyError || !sessionData?.session) throw new Error(`OTP verify failed: ${verifyError?.message}`);

  return sessionData.session.access_token;
}

async function callAlpha(accessToken: string, scenario: Scenario): Promise<Record<string, unknown>> {
  const response = await fetch("https://pipnosis.com/.netlify/functions/openai-chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: scenario.user_message },
      ],
      model: "gpt-4o",
      temperature: 0.3,
      max_tokens: 2500,
      requestType: "test_alpha_stress_test",
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return { error: true, status: response.status, body: errText };
  }

  const result = await response.json();
  const raw = result.choices?.[0]?.message?.content || "{}";

  try {
    return { ...JSON.parse(raw), _usage: result.usage };
  } catch {
    return { raw_response: raw, parse_error: true, _usage: result.usage };
  }
}

function evaluateResult(scenario: Scenario, decision: Record<string, unknown>): Record<string, unknown> {
  const action = decision.action as string;
  const confidence = decision.confidence_tier as string;
  const entryMode = decision.entry_mode as string;
  const keySignalReasoning = (decision.answer_sheet as any)?.key_signal_reasoning || decision.key_signal_reasoning || null;
  const moveMaturity = decision.m5_move_maturity_assessment || (decision.answer_sheet as any)?.m5_move_maturity_assessment || null;

  let pass = false;
  let grade = "FAIL";
  let notes = "";

  switch (scenario.id) {
    case "A": // Fresh BOS contradicts bearish
      pass = action === "BUY";
      notes = pass ? "Correctly recognized BOS as structural break" : `Chose ${action} — failed to respect fresh M5 BOS bull`;
      break;
    case "B": // FVG entry refinement
      pass = action === "BUY";
      notes = pass ? "Used FVG zone for entry thesis" : `Chose ${action} — missed FVG as entry support`;
      break;
    case "C": // Momentum peak
      pass = action === "SELL" || (action === "BUY" && (confidence === "low_quality" || entryMode !== "execute_now"));
      notes = pass
        ? `Correctly handled momentum peak: ${action} ${confidence} ${entryMode}`
        : `Chose ${action} ${confidence} ${entryMode} — chased momentum at peak`;
      break;
    case "D": // Adversarial suspicion
      pass = entryMode !== "execute_now";
      notes = pass
        ? `Correctly avoided execute_now during adversarial conditions: ${entryMode}`
        : `Chose execute_now despite suspicion_score=78 and active stop_run`;
      break;
    case "E": // SFP reversal
      pass = action === "SELL";
      notes = pass ? "Correctly took SFP reversal" : `Chose ${action} — missed SFP reversal signal`;
      break;
    case "F": // Equal highs trap
      pass = action === "SELL" || (action === "BUY" && entryMode !== "execute_now");
      notes = pass
        ? `Correctly handled equal highs trap: ${action} ${entryMode}`
        : `Chose BUY execute_now into equal highs trap — dangerous`;
      break;
    case "G": // Sweep without follow-through
      pass = entryMode !== "execute_now" || action === "SELL";
      notes = pass
        ? `Correctly waited for sweep confirmation: ${action} ${entryMode}`
        : `Chose ${action} execute_now without sweep follow-through — premature`;
      break;
    case "H": // EMA displacement extreme
      pass = action === "SELL" || (action === "BUY" && (confidence === "low_quality" || entryMode !== "execute_now"));
      notes = pass
        ? `Correctly handled extreme displacement: ${action} ${confidence} ${entryMode}`
        : `Chased BUY at extreme EMA displacement (p95) — snap-back risk ignored`;
      break;
    case "I": // Combined BOS+Sweep+Exhaustion
      pass = action === "BUY" && (confidence === "confident" || confidence === "very_confident" || confidence === "extremely_confident");
      notes = pass
        ? `High-confidence reversal on triple-signal confluence: ${confidence}`
        : `Failed to synthesize triple reversal signals: ${action} ${confidence}`;
      break;
    case "J": // Combined Adversarial+FVG+Momentum
      pass = entryMode !== "execute_now" || action === "SELL";
      notes = pass
        ? `Correctly handled conflict: ${action} ${entryMode} — did not chase fake breakout`
        : `Chose ${action} execute_now despite adversarial+exhaustion signals — dangerous`;
      break;
  }

  grade = pass ? "PASS" : "FAIL";

  return {
    scenario_id: scenario.id,
    scenario_name: scenario.name,
    grade,
    pass,
    notes,
    alpha_action: action,
    alpha_confidence: confidence,
    alpha_entry_mode: entryMode,
    alpha_reasoning: decision.reasoning || decision.trader_statement,
    move_maturity_assessment: moveMaturity,
    key_signal_reasoning: keySignalReasoning,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Parse request — allow running specific scenarios
    let scenarioIds: string[] = [];
    try {
      const body = await req.json();
      if (body.scenarios && Array.isArray(body.scenarios)) {
        scenarioIds = body.scenarios;
      }
    } catch { /* empty body = run all */ }

    const scenariosToRun = scenarioIds.length > 0
      ? SCENARIOS.filter(s => scenarioIds.includes(s.id))
      : SCENARIOS;

    // Get auth token
    const accessToken = await getAdminToken(supabase);

    // Run scenarios sequentially (to avoid rate limits)
    const results: Record<string, unknown>[] = [];
    for (const scenario of scenariosToRun) {
      console.log(`[Stress Test] Running scenario ${scenario.id}: ${scenario.name}`);
      const decision = await callAlpha(accessToken, scenario);

      if ((decision as any).error) {
        results.push({
          scenario_id: scenario.id,
          scenario_name: scenario.name,
          grade: "ERROR",
          error: decision,
        });
        continue;
      }

      const evaluation = evaluateResult(scenario, decision);
      results.push(evaluation);

      // Small delay between calls to avoid rate limits
      await new Promise(r => setTimeout(r, 1500));
    }

    // Summary
    const passed = results.filter(r => (r as any).pass === true).length;
    const failed = results.filter(r => (r as any).pass === false).length;
    const errors = results.filter(r => (r as any).grade === "ERROR").length;

    const summary = {
      total_scenarios: scenariosToRun.length,
      passed,
      failed,
      errors,
      pass_rate: `${Math.round((passed / (passed + failed)) * 100)}%`,
      failed_scenarios: results.filter(r => (r as any).pass === false).map(r => ({
        id: (r as any).scenario_id,
        name: (r as any).scenario_name,
        notes: (r as any).notes,
      })),
      results,
    };

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err), stack: (err as Error).stack }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
