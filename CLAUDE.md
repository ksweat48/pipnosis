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
