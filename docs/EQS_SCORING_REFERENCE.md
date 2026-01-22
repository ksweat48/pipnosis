# EQS Scoring Reference - Complete System Documentation

**Last Updated:** 2026-01-22
**Version:** 2.0 (Post Time-Based Urgency Removal)

---

## Executive Summary

The Entry Quality Score (EQS) is a **75-point scoring system** that evaluates entry timing quality. All trade styles (SCALP, MICRO_INTRADAY, INTRADAY) use the **same unified scoring system**.

**Key Change (Jan 2026):** Time-based urgency phases (Phase 1/2/3 with progressive threshold relaxation) have been **removed**. The system now uses **confidence-based static thresholds only**.

---

## Universal EQS Scoring (75-Point Scale)

### Core Requirements (60 points total)

| Component | Max Points | Weight | Description |
|-----------|-----------|--------|-------------|
| **Pullback Quality** | 20 | ESSENTIAL | Retracement depth, impulse identification |
| **VWAP Interaction** | 15 | IMPORTANT | Distance from VWAP, kiss pattern, reclaim quality |
| **EMA Alignment** | 15 | ESSENTIAL | Direction match, slope strength, crossover signals |
| **Liquidity Reaction** | 10 | HELPFUL | Pool response, sweep reclaim patterns |

### Boosters (15 points total - optional)

| Component | Max Points | Weight | Description |
|-----------|-----------|--------|-------------|
| **Compression/Expansion** | 5 | NICE TO HAVE | Range compression detection, expansion follows |
| **Failed Move Confirmation** | 5 | NICE TO HAVE | False breakout, exhaustion, rejection patterns |
| **Timeframe Alignment** | 5 | NICE TO HAVE | M5 confirmation, MTF alignment |

### Modifiers

- **Friction Penalty:** -15 to 0 points (wicks, spread, noise)
- **A+ Pattern Bonus:** +10 to +15 points (exceptional setups)

---

## Threshold System (Confidence-Based Static)

**No Time Decay:** Thresholds remain constant throughout the intent lifetime.

| Alpha Confidence | EQS Threshold | % of 75 | Grade Requirement |
|-----------------|---------------|---------|-------------------|
| **85%+** (Excellent) | 30 | 40% | Grade C+ |
| **70%+** (Solid) | 35 | 47% | Grade B- |
| **60%+** (Acceptable) | 40 | 53% | Grade B |

**Example:**
- Trade with 88% Alpha confidence: EQS must be ≥ 30/75 to execute
- Trade with 65% Alpha confidence: EQS must be ≥ 40/75 to execute

---

## Style-Specific Behavior

### Universal Scoring

**Important:** All styles use the **same 75-point EQS scoring system**. There are NO style-specific scoring weights.

### Style Adjustments (Advisory Only)

Styles apply **soft EQS adjustments** (+/- 2-5 points) when TP/SL ranges deviate from typical style ranges:

#### SCALP
- **Typical TP Range:** 20-50 pips
- **Typical SL Range:** 10-18 pips
- **Max Wait Time (Edge Loss):** 10 minutes

#### MICRO_INTRADAY
- **Typical TP Range:** 50-120 pips
- **Typical SL Range:** 20-35 pips
- **Max Wait Time (Edge Loss):** 45 minutes

#### INTRADAY
- **Typical TP Range:** 100-200 pips
- **Typical SL Range:** 35-60 pips
- **Max Wait Time (Edge Loss):** 120 minutes

**Note:** These adjustments are **advisory rewards/penalties**, not structural differences in scoring.

---

## Thesis-Specific Scoring (Separate System)

In addition to the universal 75-point system, there is a **thesis-specific scoring system** in `thesis-entry-quality-engine.ts`:

### 1. Momentum Scalp Thesis (0-100 scale)
**Goal:** Catch immediate continuation/impulse

| Component | Weight | Description |
|-----------|--------|-------------|
| Momentum strength | 30% | Strong, moderate, weak, none |
| Candle body dominance | 20% | Body-to-wick ratio |
| EMA alignment | 15% | Slope and direction match |
| VWAP proximity | 15% | Distance < 0.3 ATR ideal |
| Pullback quality | 10% | Shallow retracements |
| Noise absence | 10% | Low chop/noise |

**Execution Threshold:** EQS ≥40, IMMEDIATE can override to 30

---

### 2. Liquidity Sweep Reversal Thesis (0-100 scale)
**Goal:** Fade engineered stop runs

| Component | Weight | Description |
|-----------|--------|-------------|
| Valid sweep magnitude | 25% | Clear liquidity grab |
| Break of structure after sweep | 25% | BOS confirmation |
| Acceptance candles | 20% | Post-sweep acceptance |
| Wick rejection | 15% | Strong rejection wicks |
| VWAP reclaim | 10% | Reclaim after sweep |
| Volume confirmation | 5% | Expansion on reversal |

**Rule:** No BOS + no acceptance → EQS capped at 55
**Execution Threshold:** EQS ≥60

---

### 3. Trend Pullback Thesis (0-100 scale)
**Goal:** Enter continuation at value

| Component | Weight | Description |
|-----------|--------|-------------|
| HTF trend alignment | 20% | Must align with higher TF |
| Pullback depth | 20% | 38-61% optimal, 23-78% acceptable |
| EMA support/resistance | 15% | Bounce from key EMA |
| VWAP interaction | 15% | Distance < 0.5 ATR |
| Acceptance candle | 15% | Reversal confirmation |
| Liquidity cleanliness | 10% | Low noise levels |

**Execution Threshold:** EQS ≥55

---

### 4. Breakout Continuation Thesis (0-100 scale)
**Goal:** Trade post-break acceptance

| Component | Weight | Description |
|-----------|--------|-------------|
| Range compression pre-break | 20% | Coiling before break |
| Break strength | 20% | Strong momentum break |
| Retest quality | 20% | Clean retest of level |
| Volume expansion | 15% | Volume surge on break |
| Acceptance above level | 15% | Holds above breakout |
| Trend alignment | 10% | HTF confirms |

**Execution Threshold:** EQS ≥50

---

### 5. Mean Reversion Thesis (0-100 scale)
**Goal:** Fade extremes back to mean

| Component | Weight | Description |
|-----------|--------|-------------|
| Distance from mean | 25% | ≥1.5 ATR ideal |
| Exhaustion candle | 20% | Climax pattern |
| Momentum decay | 15% | Slowing momentum |
| HTF range context | 15% | Range-bound structure |
| Liquidity proximity | 15% | Near key levels |
| Acceptance | 10% | Reversal confirmation |

**Execution Threshold:** EQS ≥60

---

### 6. Failed Move Thesis (0-100 scale)
**Goal:** Capitalize on false breakouts

| Component | Weight | Description |
|-----------|--------|-------------|
| Failed breakout detection | 30% | Clear failure pattern |
| Fast reclaim | 25% | Quick return inside range |
| Momentum flip | 20% | Direction reversal |
| Range validity | 15% | Well-defined range |
| Volume confirmation | 10% | Volume surge on reclaim |

**Execution Threshold:** EQS ≥55

---

### 7. Range Extreme Thesis (0-100 scale)
**Goal:** Trade extreme positions in ranges

| Component | Weight | Description |
|-----------|--------|-------------|
| Extreme location | 30% | At range boundary |
| Rejection candle | 25% | Strong rejection |
| Volatility contraction | 20% | Low volatility environment |
| Multiple touches | 15% | Level tested multiple times |
| Volume confirmation | 10% | Volume at extreme |

**Execution Threshold:** EQS ≥50

---

## EQS Grading System (75-Point Scale)

| Grade | EQS Range | % of Max | Action Tier | Description |
|-------|-----------|----------|-------------|-------------|
| **A+** | 60-75 | 80%+ | Execute immediately | Optimal microstructure |
| **A** | 54-59 | 72-79% | Execute with acceptance | Strong setup |
| **B** | 49-53 | 65-71% | Wait for better entry | Good but not optimal |
| **C** | 38-48 | 50-64% | Require confirmation | Marginal quality |
| **D** | 23-37 | 30-49% | Wait passive | Significant improvement needed |
| **F** | 0-22 | <30% | Do not execute | Insufficient quality |

---

## Filters Used by Each Style

### SCALP Style Filters

**Execution Filters:**
1. Price in exact entry zone (no tolerance)
2. EQS ≥ confidence threshold (30/35/40)
3. Market hours valid
4. Not at edge loss time (10 min)

**Quality Scoring:**
- Momentum strength (30% weight in momentum scalp thesis)
- Body dominance (20% weight)
- EMA alignment (15% weight)
- VWAP proximity (15% weight)

---

### MICRO_INTRADAY Style Filters

**Execution Filters:**
1. Price in exact entry zone (no tolerance)
2. EQS ≥ confidence threshold (30/35/40)
3. Market hours valid
4. Not at edge loss time (45 min)

**Quality Scoring:**
- Pullback quality (25% weight in trend pullback thesis)
- Acceptance candles (25% weight)
- Location (20% weight)
- VWAP interaction (15% weight)

---

### INTRADAY Style Filters

**Execution Filters:**
1. Price in exact entry zone (no tolerance)
2. EQS ≥ confidence threshold (30/35/40)
3. Market hours valid
4. Not at edge loss time (120 min)

**Quality Scoring:**
- Location (30% weight in universal system)
- Pullback quality (25% weight)
- Acceptance (20% weight)
- Trend alignment (15% weight)

---

## What Changed (Jan 2026 - Time-Based Urgency Removal)

### REMOVED (Old System)
- ❌ Phase 1/2/3 progressive relaxation
- ❌ Time-decayed EQS thresholds (60 → 50 → 40)
- ❌ Progressive zone tolerance (0 → 20-40 pips → 50-70 pips)
- ❌ Phase transition timers
- ❌ Time-based threshold adjustments

### NEW (Current System)
- ✅ Confidence-based static thresholds only (30/35/40)
- ✅ Exact zone matching only (no tolerance)
- ✅ Absolute edge loss time limits per style
- ✅ No time-based threshold decay
- ✅ Simpler, more predictable execution model

### Philosophy Shift

**Old:** "Wait longer, get easier execution" (threshold relaxes over time)
**New:** "High conviction gets easier execution" (threshold based on confidence)

---

## SSOT Authorities

| Responsibility | Authority File |
|---------------|----------------|
| EQS Component Maximums | `src/config/alpha-identity.ts` → `EQS_COMPONENT_MAXIMUMS` |
| Confidence Thresholds | `src/config/alpha-identity.ts` → `EQS_CONFIDENCE_TIERS` |
| Edge Loss Time Limits | `src/config/alpha-identity.ts` → `EDGE_LOSS_TIME_LIMITS` |
| Universal EQS Calculation | `src/services/entry-qualification-engine.ts` |
| Thesis-Specific EQS | `src/services/thesis-entry-quality-engine.ts` |
| Edge Loss Detection | `src/services/entry-edge-loss-detector.ts` |
| Execution Decision | `src/services/unified-entry-monitor.ts` |

---

## Examples

### Example 1: High Confidence Scalp (85% confidence)

```typescript
Alpha Confidence: 85%
EQS Score: 32/75
Threshold: 30 (85%+ tier)

Decision: ✅ EXECUTE
Reason: Score 32 meets threshold 30
Style: SCALP (no special scoring, same 75-point system)
```

### Example 2: Standard Confidence Intraday (65% confidence)

```typescript
Alpha Confidence: 65%
EQS Score: 38/75
Threshold: 40 (60%+ baseline tier)

Decision: ⏳ WAIT
Reason: Score 38 below threshold 40 (need 2 more points)
Style: INTRADAY (no special scoring, same 75-point system)
```

### Example 3: Solid Confidence with Thesis (72% confidence, liquidity sweep)

```typescript
Alpha Confidence: 72%
EQS Score: 36/75 (universal system)
Thesis EQS: 58/100 (liquidity sweep thesis)
Threshold: 35 (70%+ tier)

Decision: ✅ EXECUTE
Reason: Universal score 36 meets threshold 35, thesis confirms quality
Thesis: Liquidity Sweep Reversal
```

---

## Summary

- **Universal System:** All styles use the same 75-point EQS scoring
- **No Time Decay:** Thresholds are static, confidence-based only
- **Exact Zones:** No progressive tolerance, price must be in zone
- **Edge Loss:** Absolute time limits trigger user choice modal
- **Thesis-Specific:** Optional thesis scoring (0-100 scale) runs in parallel
- **Alpha Authority:** Alpha's confidence determines threshold, not time elapsed

**Key Principle:** Quality standards don't degrade over time. High conviction trades get entry timing flexibility through lower thresholds, not by waiting longer.
