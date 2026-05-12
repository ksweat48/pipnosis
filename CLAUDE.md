# Pipnosis — Engineering Principles

## Core Mandate: Improve Alpha's Brain, Not His Constraints

The Pipnosis infrastructure is complete.

All sensors, coordinators, audit trails, and data pipelines are in place. Alpha has full access to:
- Pattern detection (13 pattern types including stop_hunt_expansion, equal_highs_lows)
- Adversarial detector (stop runs, fake breakouts, BOS confirmation, recency)
- Liquidity intent analyzer (sweep facts, wick quality, FVG, volume)
- Trapped participant fuel (Q_TRAPPED_FUEL)
- Sweep-reclaim protocol (Q_SWEEP_RECLAIM_STATUS — CCIP-2026-0422A)
- Full answer sheet audit trail (Q1–Q12 + all extended fields)
- Momentum trajectory, micro-regime classifier, daily narrative

**Future work is focused exclusively on improving how Alpha thinks — not on constraining what Alpha can do.**

### The Rule

If Alpha is making a bad decision, the answer is **to improve Alpha's reasoning**, not to add a code gate or hard block.

- Do not add new execution blocks or guards to coordinator-alpha.ts to fix a trading problem
- Do not add new confidence floors, phase-based restrictions, or session-based locks
- Do not solve a reasoning failure with an infrastructure patch

The right fix is always: open alpha-identity.ts, understand why Alpha reasoned incorrectly, and improve the prompt so Alpha reasons correctly from first principles.

A gate fixes one symptom. Better reasoning fixes the entire class of problem.

### What "Improve Alpha's Brain" Means in Practice

- Strengthen the reasoning process (HOW I THINK BEFORE EVERY DECISION)
- Add new reasoning obligations connected to existing sensor data
- Clarify when signals are timing intelligence vs directional confirmation
- Improve the self-contradiction detection (answer_sheet fields that create internal consistency checks)
- Sharpen phase-native trade type definitions so Alpha selects better setups
- Improve Alpha's understanding of market structure — sweeps, traps, trapped fuel, BOS, narrative timing

### What It Does Not Mean

- New TypeScript code that intercepts Alpha's output and redirects it
- New database gates that prevent execution based on pattern labels
- Hardcoded symbol-specific or pattern-specific blocks
- Adding MORE constraints to the arena walls

### CCIP Compliance

All prompt changes follow CCIP. Every change to alpha-identity.ts is tagged with a CCIP reference. No silent behavior changes.

---

## ALPHA AUTONOMY DOCTRINE — NON-NEGOTIABLE (CCIP-2026-0511ZZ)

Ratified 2026-05-11. Persisted in Supabase table `alpha_engineering_doctrine` as the SSOT record. This section is engineering law. Any PR, agent, or contributor that violates it must be rejected.

### Foundational Premise

**Alpha knows how to trade.** He is an institutional-grade reasoning system with direct access to raw sensor data, market structure, liquidity intelligence, and full historical context. Raw data + his own reasoning is sufficient. The system's job is to deliver clean data and record his decisions — never to shape them.

### Prohibited Changes to Alpha's Brain

No future update to `alpha-identity.ts` or any prompt-construction file may:

1. Tell Alpha what to decide on any specific setup, symbol, pattern, or condition
2. Influence direction (no "if X then BUY", no "when Y consider SELL")
3. Force a checklist, procedure, or step-numbered reasoning bracket
4. Add "STEP 1 → STEP 2 → STEP 3" teaching blocks
5. Teach market mechanics the LLM already understands (sweeps, traps, BOS, FVGs, session behavior)
6. Add pattern-to-output translation tables or "IF pattern=X THEN output=Y" rules
7. Introduce procedural hypothesis_buy / hypothesis_sell brackets or equivalent named procedures
8. Add pre-execution checklists, confirmation checklists, or gate-style reasoning obligations
9. Add symbol-specific or pattern-specific hardcoded reasoning
10. Prescribe confidence values, tier selections, or entry-mode choices for any condition

### Permitted Changes to Alpha's Brain

Prompt changes may ONLY:

- Sharpen reasoning quality and critical thinking obligations
- Clarify self-contradiction detection (fields that create internal consistency checks)
- Improve decision-first / audit-second discipline
- Adjust schema-contract references when the output schema changes
- Remove existing constraints, teachings, or rules (reduction is always safe)

### Prohibited Infrastructure Changes

No future update to the coordinator, database, or surrounding infrastructure may:

1. Intercept Alpha's directional output and redirect it
2. Add execution gates, confidence floors, or phase-based locks to fix a reasoning problem
3. Add session-based or kill-zone-based execution restrictions
4. Second-guess a clean-audit directional call
5. Translate Alpha's output through a rules table before persistence

### Permitted Infrastructure Changes

Infrastructure may ONLY:

- Enforce data integrity (schema presence, type safety, ledger consistency, no-null contracts at the transport layer)
- Record Alpha's decisions for audit and learning
- Surface sensor data to Alpha
- Correct true semantic contradictions (e.g., `winning_hypothesis !== action`) that the schema cannot express

### The Decision-First / Audit-Second Rule

The audit trail (Q1-Q12 and all extended Q-fields) **records** reasoning that Alpha already performed. It does not **generate** reasoning. Alpha decides, then documents. Never the reverse. Any change that reintroduces audit-first / decision-second ordering is a violation.

### If Alpha Makes a Bad Decision

The fix is **always** to improve the quality of his reasoning. Never a gate, block, floor, phase-lock, session-lock, pattern-specific rule, or symbol-specific rule. A gate fixes one symptom. Better reasoning fixes the entire class of problem.

### Enforcement

- Every prompt change must cite this doctrine in its CCIP reference
- Build-time audit script `scripts/audit-alpha-identity.ts` scans for forbidden patterns
- Supabase table `alpha_engineering_doctrine` holds the ratified text — any deviation must first supersede that row with explicit justification
- PRs that violate this doctrine must be rejected on architectural grounds, regardless of trading-outcome arguments

---

## RAW-DATA DOCTRINE — NON-NEGOTIABLE (CCIP-2026-0512A)

Ratified 2026-05-12. **Supersedes CCIP-2026-0511ZZ.** Persisted in Supabase table `alpha_engineering_doctrine` as the active SSOT record. This section is engineering law. All obligations inherited from 0511ZZ remain in force; 0512A adds a stricter layer on top.

### Foundational Premise

Alpha is an institutional-grade reasoning system. He already understands every market move, signal, phase, pattern, session behavior, and structural mechanic. He does **not** require definitions, labels, verdicts, or teachings from infrastructure code. He requires **raw data** and the discipline to reason from it.

The system's sole responsibilities toward Alpha are:
1. Deliver raw sensor readings (numbers, prices, booleans, counts)
2. Record his decisions for audit and learning

Never to interpret, pre-classify, or verdict the market on his behalf.

### Prohibited Prompt Content

No context builder, formatter, or prompt-assembly function may inject:

1. Interpretation labels for market moves ("momentum peaking", "exhausting", "building", "compressing")
2. Phase names or hunt descriptions ("post_sweep_resolving", "look for continuation", "reversal setups are active")
3. Pattern verdicts or alignment narratives ("SUPPORTS:", "CONFLICTS:", "Overall Reasoning:", "Direction Bias:", "Direction Aligned:")
4. Intent labels per timeframe ("HTF Intent: bullish")
5. Signal classifications ("REJECTION WICK detected — possible exhaustion", "bullish absorption on M15", "strong wick", "structural observation")
6. Historical trade performance summaries (recent win/loss, best/worst performing pairs, R:R ratio success rates, trade history)
7. Teaching narratives about what phase supports which hunt type
8. Directional suggestions ("Long targets", "Short targets" — use "above price" / "below price" instead)
9. Confidence recommendations, tier prescriptions, or entry-mode choices
10. Any sentence that tells Alpha what the market is doing rather than showing him the numbers

### Permitted Prompt Content

Context builders may emit only:

- Raw numeric readings (ratios, percentiles, counts, prices)
- Boolean flags (`swept=true`, `bos_confirmed=false`)
- Pattern type names without interpretation (`pattern_type=double_top`)
- Price levels without directional framing
- Schema contract references when the output contract changes

### Prohibited Infrastructure Changes

No infrastructure code may:

1. Inject historical performance data into Alpha's prompt
2. Pre-classify market regimes in the prompt text
3. Translate sensor outputs into English narratives
4. Add verdict layers on top of raw data
5. Intercept Alpha's output or redirect his decisions
6. Add execution gates, confidence floors, phase-locks, or session-locks to fix a reasoning problem

### Permitted Infrastructure Changes

Infrastructure may only:

- Enforce data integrity (schema presence, type safety, ledger consistency, no-null contracts at the transport layer)
- Record Alpha's decisions for audit and learning
- Surface raw sensor data to Alpha
- Correct true semantic contradictions that the schema cannot express

### If Alpha Makes a Bad Decision

The fix is **always** to improve the quality of his reasoning via the prompt, or to deliver additional **raw** data he was missing. Never a gate, block, floor, phase-lock, session-lock, pattern-specific rule, symbol-specific rule, or interpretation layer.

### Enforcement

- Every prompt or context-builder change must cite this doctrine
- Build-time audit script `scripts/audit-alpha-identity.cjs` scans for forbidden tokens across `alpha-identity.ts`, `coordinator-alpha.ts`, and all prompt formatter files
- Supabase row with `ccip_reference = 'CCIP-2026-0512A'` and `active = true` is the SSOT — any deviation must first supersede that record with an explicit CCIP amendment

---

## MTF LAYER CONTRACT — CCIP-2026-0512B (amendment to 0512A)

Ratified 2026-05-12. Implementation-level amendment to the Raw-Data Doctrine. Persisted in Supabase as `ccip_reference = 'CCIP-2026-0512B-MTF-LAYER-CONTRACT'`.

1. **Single fetch authority.** `MarketDataService.getCandles` is the only authorized candle-fetch path for code that feeds Alpha's prompt or the multi-timeframe pattern intelligence sensor.
2. **SSOT lookback windows.** MTF lookback windows live in `src/config/timeframe-hierarchy.ts` as `MTF_LOOKBACK_WINDOWS`, accessed via `getMTFLookbackWindows()`. No inline magic numbers. MICRO_INTRADAY: HTF=50, MTF=60, LTF=60.
3. **Layer symmetry.** H1 (HTF), M15 (MTF), M5 (LTF), and D1 are all delivered as raw columnar OHLC tables (oldest→newest) plus raw numeric readings. No layer served exclusively as pre-computed verdicts.
4. **Prompt content.** All MTF blocks emit raw readings only: prices, pip distances, booleans, counts, BOS/sweep flags. No DIRECTION RULE, no tailwind/counter-trend framing, no MANDATORY procedural wrappers, no INSTITUTIONAL LEVEL RULES, no magnetic-pull/structurally-weak verdicts, no Expect-rejection narratives.
5. **Enforcement.** `scripts/audit-alpha-identity.cjs` blocks the build on any of the above tokens appearing in `coordinator-alpha.ts` or `multi-timeframe-pattern-intelligence.ts`.
