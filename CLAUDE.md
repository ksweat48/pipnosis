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
