/**
 * AI Identity System - Pipnosis Alpha Mission & Platform Streak Modifier
 *
 * CCIP-2026-0309: Platform-wide trade score refactor.
 *
 * WHAT THIS FILE IS NOW:
 * - PIPNOSIS_IDENTITY: Alpha's immutable mission, values, and thinking style
 * - getPlatformStreakModifier(): streak-to-confidence-modifier lookup (-5 to +5, every 5 trades = 1 point)
 * - buildStreakContext(): factual observation-only string passed to Alpha's prompt (no numeric steering)
 *
 * WHAT HAS BEEN REMOVED:
 * - PersonalityState interface (defensive/cautious/balanced/aggressive)
 * - getPersonalityState() — personality labels are gone entirely
 * - All risk_appetite, trading_style, prompt_modifier personality fields
 * - buildMotivationalContext() — replaced by buildStreakContext()
 * - getStrategyPlanningIdentity() / getExecutionIdentity() — per-user score injection
 *
 * REASON:
 * Personality labels ("DEFENSIVE", "ultra-selective") introduced score-chasing
 * behaviour and risk-appetite overrides that bypassed user-controlled risk sizing.
 * The score system now does ONE thing only: apply a small confidence adjustment
 * at execution time based on Alpha's consecutive win or loss streak as a platform.
 *
 * SSOT:
 * - Personality labels: REMOVED (no file owns them)
 * - Platform streak + modifier: alpha_platform_score table (single row)
 * - Platform score reads: reward-engine.ts loadPlatformScore()
 * - Confidence modifier application: confidence-calculation-engine.ts
 */

export interface PlatformScore {
  consecutive_wins: number;
  consecutive_losses: number;
  total_trades: number;
  total_wins: number;
  total_losses: number;
  confidence_modifier: number;
  last_outcome: 'win' | 'loss' | 'breakeven' | null;
  last_updated: string;
}

export interface TraderScore {
  current_score: number;
  lifetime_profit: number;
  lifetime_loss: number;
  streak_wins: number;
  streak_losses: number;
  confidence_level: string;
  risk_appetite: number;
  trading_style: string;
  total_trades: number;
  win_rate: number;
}

export const PIPNOSIS_IDENTITY = {
  name: 'Pipnosis Alpha',
  role: 'Professional AI Intraday Trader',

  mission: 'Generate positive expected value on every session by reasoning carefully about whether each trade serves the current objective',

  personality: 'Analytical, disciplined, selective, patient, self-correcting',

  coreValues: [
    'Every trade decision must answer: does this setup serve the session objective?',
    'A well-reasoned decision to wait is as valuable as a well-reasoned trade',
    'Protect capital by rejecting setups where the failure probability exceeds the edge',
    'Seek positive expected value — not activity, not confirmation of a directional bias',
    'Learn from every outcome by examining whether the reasoning was sound, not just whether it profited',
    'Adapt position sizing to the quality of the setup, not to emotional state'
  ],

  primeDirect: 'Reason well. Execute selectively. Serve the session objective.',

  thinkingStyle: [
    'Probabilistic — assess the likelihood of both the setup playing out and the failure mode materialising',
    'Objective-anchored — every decision is evaluated against the session goal, not against a desire to trade',
    'Self-correcting — treat every deviation from reasoning standards as a learning event',
    'Risk-first — the downside is assessed before the upside is considered',
    'Expected-value focused — a 75% setup with a 1.5 R:R is evaluated differently from a 65% setup with a 2.0 R:R',
    'Dispassionate — confidence state informs risk sizing, not the decision to trade or not'
  ]
};

/**
 * STREAK MODIFIER CONSTANTS — SSOT
 *
 * These values define the scaling rule for the platform streak confidence modifier.
 * Every 5 consecutive wins/losses = +/-1, up to a hard cap of +/-5.
 * Fewer than 5 consecutive results in the same direction = no adjustment.
 */
export const PLATFORM_STREAK_MODIFIER = {
  MAX_BONUS: 5,
  MAX_PENALTY: -5,
  TRADES_PER_POINT: 5,
} as const;

/**
 * getPlatformStreakModifier
 *
 * Returns the confidence modifier (-5 to +5) based on consecutive win/loss streak.
 * This is the ONLY effect of the platform score on Alpha's behavior.
 *
 * Rules:
 * - 5 consecutive wins  → +1 | 10 → +2 | 15 → +3 | 20 → +4 | 25+ → +5 (hard cap)
 * - 5 consecutive losses → -1 | 10 → -2 | 15 → -3 | 20 → -4 | 25+ → -5 (hard cap)
 * - Fewer than 5 in a row → 0 (no adjustment — Alpha is always analytically confident)
 */
export function getPlatformStreakModifier(score: PlatformScore): number {
  if (score.consecutive_wins >= PLATFORM_STREAK_MODIFIER.TRADES_PER_POINT) {
    return Math.min(
      PLATFORM_STREAK_MODIFIER.MAX_BONUS,
      Math.floor(score.consecutive_wins / PLATFORM_STREAK_MODIFIER.TRADES_PER_POINT)
    );
  }
  if (score.consecutive_losses >= PLATFORM_STREAK_MODIFIER.TRADES_PER_POINT) {
    return Math.max(
      PLATFORM_STREAK_MODIFIER.MAX_PENALTY,
      -Math.floor(score.consecutive_losses / PLATFORM_STREAK_MODIFIER.TRADES_PER_POINT)
    );
  }
  return 0;
}

/**
 * buildStreakContext
 *
 * CCIP-2026-0329A GOVERNANCE COMPLIANCE:
 * Returns a factual, observation-only context string passed to Alpha's prompt.
 *
 * WHAT THIS MUST NOT DO (per confidence-calculation-engine.ts SSOT):
 * - Must NOT inject a numeric confidence adjustment (+X% / -X%)
 * - Must NOT instruct Alpha to "Apply this to your final confidence score"
 * - Must NOT pre-score or arithmetically steer Alpha's reasoning
 *
 * WHAT THIS DOES:
 * - Reports the streak as a raw factual observation
 * - Alpha reads it as context and prices it into his own reasoning freely
 * - The mechanical modifier from getPlatformStreakModifier() is ONLY used by
 *   confidence-calculation-engine.ts at the post-LLM calculation layer (SSOT)
 *
 * Authority: confidence-calculation-engine.ts owns all confidence arithmetic.
 * This function owns only the factual observation string.
 */
export function buildStreakContext(score: PlatformScore): string {
  if (score.consecutive_wins >= PLATFORM_STREAK_MODIFIER.TRADES_PER_POINT) {
    return `Platform streak context: ${score.consecutive_wins} consecutive platform wins — recent execution has been well-aligned with market conditions.`;
  }

  if (score.consecutive_losses >= PLATFORM_STREAK_MODIFIER.TRADES_PER_POINT) {
    return `Platform streak context: ${score.consecutive_losses} consecutive platform losses — recent execution has faced adverse conditions. Prioritise setup quality over trade frequency.`;
  }

  return `Platform streak context: no significant streak — platform is in a neutral execution phase.`;
}
