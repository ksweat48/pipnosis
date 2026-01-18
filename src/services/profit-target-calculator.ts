import { logger } from '../lib/logger';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';

export type TPPlacement = 'single' | 'partial';

export interface LiquidityZone {
  price: number;
  type: 'psychological' | 'structural' | 'order_cluster';
  strength: 'weak' | 'moderate' | 'strong';
  distance_pips: number;
}

export interface TPCalculationInput {
  entry_price: number;
  stop_loss: number;
  direction: 'long' | 'short';
  symbol: string;

  liquidity_zones: LiquidityZone[];
  structure_resistance?: number;

  session_time_remaining_minutes?: number;
  expected_volatility_pips_per_hour?: number;

  allow_partials?: boolean;
  min_rr_ratio?: number;
}

export interface TPTarget {
  price: number;
  percentage: number;
  rr_ratio: number;
  reasoning: string;
  expected_time_to_fill_minutes?: number;
}

export interface TPCalculationResult {
  targets: TPTarget[];
  placement_type: TPPlacement;
  total_rr: number;
  liquidity_override_used: boolean;
  warnings: string[];
  recommendation_quality: 'excellent' | 'good' | 'acceptable' | 'poor';
}

export class EliteProfitTargetCalculator {
  private readonly MIN_RR_RATIO = 1.0;
  private readonly PSYCHOLOGICAL_LEVELS = [0, 20, 50, 80, 100];

  private readonly PARTIAL_TP_SPLIT = {
    first: 0.5,
    second: 0.5
  };

  calculateProfitTargets(input: TPCalculationInput): TPCalculationResult {
    const warnings: string[] = [];

    const pip_value = this.getPipValue(input.symbol);
    const stop_distance_pips = Math.abs(input.entry_price - input.stop_loss) / pip_value;

    logger.info('[TP Calculator] Starting calculation', {
      symbol: input.symbol,
      entry: input.entry_price,
      stop: input.stop_loss,
      stop_distance_pips,
      direction: input.direction,
      liquidity_zones_count: input.liquidity_zones.length
    });

    const primary_liquidity = this.findBestLiquidityZone(
      input.liquidity_zones,
      input.entry_price,
      input.direction,
      stop_distance_pips,
      pip_value,
      input.min_rr_ratio || this.MIN_RR_RATIO
    );

    if (!primary_liquidity) {
      logger.warn('[TP Calculator] No valid liquidity zone found meeting R:R requirements');
      return {
        targets: [],
        placement_type: 'single',
        total_rr: 0,
        liquidity_override_used: false,
        warnings: ['No valid liquidity zones found meeting minimum R:R requirements'],
        recommendation_quality: 'poor'
      };
    }

    const primary_rr = this.calculateRR(
      input.entry_price,
      input.stop_loss,
      primary_liquidity.price
    );

    const liquidity_override = input.structure_resistance
      ? this.checkLiquidityOverride(primary_liquidity.price, input.structure_resistance, input.direction)
      : false;

    if (liquidity_override) {
      logger.info('[TP Calculator] LIQUIDITY OVERRIDE: Placing TP beyond structure resistance', {
        tp_price: primary_liquidity.price,
        structure: input.structure_resistance,
        reasoning: 'Strong liquidity pool overrides structure'
      });
    }

    let placement_type: TPPlacement = 'single';
    let targets: TPTarget[] = [];

    // ARCHITECTURAL CHANGE (v2.0): Time is ADVISORY ONLY, never blocking
    // Session time constraints are informational for learning/scoring purposes
    const time_constraint_met = input.session_time_remaining_minutes && input.expected_volatility_pips_per_hour
      ? this.checkTimeConstraint(
          primary_liquidity.distance_pips,
          input.expected_volatility_pips_per_hour,
          input.session_time_remaining_minutes
        )
      : true;

    if (!time_constraint_met) {
      // ADVISORY ONLY: No blocking - just informational warning
      warnings.push('ADVISORY: TP may extend beyond session - style upgrade may apply (NOT blocking)');
    }

    if (input.allow_partials && primary_rr > 2.0 && this.shouldUsePartials(input)) {
      const partial_targets = this.calculatePartialTargets(input, primary_liquidity, pip_value);
      if (partial_targets && partial_targets.length > 0) {
        placement_type = 'partial';
        targets = partial_targets;
        logger.info('[TP Calculator] Using PARTIAL TPs', {
          targets: targets.map(t => ({ price: t.price, rr: t.rr_ratio, pct: t.percentage }))
        });
      }
    }

    if (targets.length === 0) {
      const expected_time = this.estimateTimeToFill(
        primary_liquidity.distance_pips,
        input.expected_volatility_pips_per_hour
      );

      targets = [{
        price: primary_liquidity.price,
        percentage: 100,
        rr_ratio: primary_rr,
        reasoning: `Single TP at ${primary_liquidity.type} liquidity zone (${primary_liquidity.strength} strength)${liquidity_override ? ' - OVERRIDING STRUCTURE' : ''}`,
        expected_time_to_fill_minutes: expected_time
      }];

      logger.info('[TP Calculator] Using SINGLE TP (Elite Trader default)', {
        price: primary_liquidity.price,
        rr: primary_rr,
        liquidity_type: primary_liquidity.type,
        strength: primary_liquidity.strength
      });
    }

    const total_rr = targets.reduce((sum, t) => sum + (t.rr_ratio * t.percentage / 100), 0);

    const quality = this.assessRecommendationQuality(
      total_rr,
      liquidity_override,
      primary_liquidity.strength,
      time_constraint_met
    );

    return {
      targets,
      placement_type,
      total_rr,
      liquidity_override_used: liquidity_override,
      warnings,
      recommendation_quality: quality
    };
  }

  private findBestLiquidityZone(
    zones: LiquidityZone[],
    entry: number,
    direction: 'long' | 'short',
    stop_distance_pips: number,
    pip_value: number,
    min_rr: number
  ): LiquidityZone | null {
    const valid_zones = zones.filter(zone => {
      const is_correct_direction = direction === 'long'
        ? zone.price > entry
        : zone.price < entry;

      if (!is_correct_direction) return false;

      const target_distance_pips = Math.abs(zone.price - entry) / pip_value;
      const rr = target_distance_pips / stop_distance_pips;

      return rr >= min_rr;
    });

    if (valid_zones.length === 0) return null;

    valid_zones.sort((a, b) => {
      const strength_score = { weak: 1, moderate: 2, strong: 3 };
      const type_score = { order_cluster: 3, psychological: 2, structural: 1 };

      const score_a = strength_score[a.strength] * type_score[a.type];
      const score_b = strength_score[b.strength] * type_score[b.type];

      return score_b - score_a;
    });

    return valid_zones[0];
  }

  private calculateRR(entry: number, stop: number, target: number): number {
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    return reward / risk;
  }

  private checkLiquidityOverride(
    tp_price: number,
    structure: number,
    direction: 'long' | 'short'
  ): boolean {
    if (direction === 'long') {
      return tp_price > structure;
    } else {
      return tp_price < structure;
    }
  }

  private shouldUsePartials(input: TPCalculationInput): boolean {
    const has_strong_liquidity = input.liquidity_zones.some(z => z.strength === 'strong');
    const has_multiple_zones = input.liquidity_zones.length >= 2;

    return has_strong_liquidity && has_multiple_zones;
  }

  private calculatePartialTargets(
    input: TPCalculationInput,
    primary: LiquidityZone,
    pip_value: number
  ): TPTarget[] | null {
    const stop_distance_pips = Math.abs(input.entry_price - input.stop_loss) / pip_value;

    const intermediate_zones = input.liquidity_zones.filter(zone => {
      const is_before_primary = input.direction === 'long'
        ? zone.price < primary.price && zone.price > input.entry_price
        : zone.price > primary.price && zone.price < input.entry_price;

      if (!is_before_primary) return false;

      const distance_pips = Math.abs(zone.price - input.entry_price) / pip_value;
      const rr = distance_pips / stop_distance_pips;

      return rr >= this.MIN_RR_RATIO;
    });

    if (intermediate_zones.length === 0) return null;

    intermediate_zones.sort((a, b) =>
      input.direction === 'long'
        ? a.price - b.price
        : b.price - a.price
    );

    const first_target = intermediate_zones[0];
    const first_rr = this.calculateRR(input.entry_price, input.stop_loss, first_target.price);
    const second_rr = this.calculateRR(input.entry_price, input.stop_loss, primary.price);

    const first_time = this.estimateTimeToFill(
      first_target.distance_pips,
      input.expected_volatility_pips_per_hour
    );
    const second_time = this.estimateTimeToFill(
      primary.distance_pips,
      input.expected_volatility_pips_per_hour
    );

    return [
      {
        price: first_target.price,
        percentage: this.PARTIAL_TP_SPLIT.first * 100,
        rr_ratio: first_rr,
        reasoning: `First partial at ${first_target.type} liquidity (${first_target.strength})`,
        expected_time_to_fill_minutes: first_time
      },
      {
        price: primary.price,
        percentage: this.PARTIAL_TP_SPLIT.second * 100,
        rr_ratio: second_rr,
        reasoning: `Final partial at ${primary.type} liquidity (${primary.strength})`,
        expected_time_to_fill_minutes: second_time
      }
    ];
  }

  private checkTimeConstraint(
    distance_pips: number,
    volatility_pph: number,
    time_remaining_minutes: number
  ): boolean {
    const expected_minutes = (distance_pips / volatility_pph) * 60;
    const safety_buffer = 1.2;
    return expected_minutes * safety_buffer <= time_remaining_minutes;
  }

  private estimateTimeToFill(
    distance_pips: number,
    volatility_pph?: number
  ): number | undefined {
    if (!volatility_pph) return undefined;
    return Math.round((distance_pips / volatility_pph) * 60);
  }

  private assessRecommendationQuality(
    total_rr: number,
    liquidity_override: boolean,
    liquidity_strength: string,
    time_constraint_met: boolean
  ): 'excellent' | 'good' | 'acceptable' | 'poor' {
    if (total_rr >= 2.0 && liquidity_strength === 'strong' && time_constraint_met) {
      return 'excellent';
    }
    if (total_rr >= 1.5 && time_constraint_met) {
      return 'good';
    }
    if (total_rr >= 1.0) {
      return 'acceptable';
    }
    return 'poor';
  }

  /**
   * SSOT COMPLIANCE: Use centralized pip value from currencyHelpers
   *
   * Previously this method had hardcoded pip values that diverged from SSOT,
   * causing catastrophic calculation errors (e.g., ETHUSD 0.1 vs 1.0 = 10x error).
   *
   * Now delegates to getCurrencyPipInfo() - the single source of truth.
   */
  private getPipValue(symbol: string): number {
    const pipInfo = getCurrencyPipInfo(symbol);

    // Diagnostic logging for ETHUSD to catch future regressions
    if (symbol.toUpperCase().includes('ETH')) {
      logger.info(`[TP Calculator] SSOT pip value for ${symbol}: ${pipInfo.pipValue}`);
    }

    return pipInfo.pipValue;
  }

  public detectLiquidityZones(
    candles: Array<{ high: number; low: number; close: number; volume?: number }>,
    current_price: number,
    direction: 'long' | 'short',
    symbol: string = 'EURUSD'
  ): LiquidityZone[] {
    const zones: LiquidityZone[] = [];
    const pip_value = this.getPipValue(symbol);

    const psychological_levels = this.findPsychologicalLevels(current_price, direction, pip_value);
    zones.push(...psychological_levels);

    const swing_highs_lows = this.findSwingPoints(candles, direction, pip_value);
    zones.push(...swing_highs_lows);

    return zones.sort((a, b) =>
      direction === 'long'
        ? a.price - b.price
        : b.price - a.price
    );
  }

  private findPsychologicalLevels(price: number, direction: 'long' | 'short', pip_value: number): LiquidityZone[] {
    const zones: LiquidityZone[] = [];

    // Calculate psychological levels based on pip value
    // For BTCUSD (pip=1.0): levels every 50-100 points
    // For ETHUSD (pip=0.1): levels every 5-10 points
    // For forex (pip=0.0001): levels every 50 pips
    const level_spacing = pip_value >= 1.0 ? 50 : pip_value >= 0.1 ? 5 : 50;

    for (let i = 1; i <= 5; i++) {
      const level_offset = level_spacing * i * pip_value;
      const level = direction === 'long'
        ? price + level_offset
        : price - level_offset;

      // Check if it's a round number (divisible by 100 for BTCUSD, by 10 for others)
      const round_threshold = pip_value >= 1.0 ? 100 : 10;
      const is_round_number = Math.abs(level) % round_threshold < 0.01;

      zones.push({
        price: level,
        type: 'psychological',
        strength: is_round_number ? 'strong' : 'moderate',
        distance_pips: Math.abs(level - price) / pip_value
      });
    }

    return zones;
  }

  private findSwingPoints(
    candles: Array<{ high: number; low: number; close: number }>,
    direction: 'long' | 'short',
    pip_value: number
  ): LiquidityZone[] {
    const zones: LiquidityZone[] = [];
    const lookback = Math.min(50, candles.length);
    const recent_candles = candles.slice(-lookback);
    const current_price = candles[candles.length - 1].close;

    if (direction === 'long') {
      const highs = recent_candles.map(c => c.high);
      const max_high = Math.max(...highs);

      zones.push({
        price: max_high,
        type: 'structural',
        strength: 'moderate',
        distance_pips: Math.abs(max_high - current_price) / pip_value
      });
    } else {
      const lows = recent_candles.map(c => c.low);
      const min_low = Math.min(...lows);

      zones.push({
        price: min_low,
        type: 'structural',
        strength: 'moderate',
        distance_pips: Math.abs(min_low - current_price) / pip_value
      });
    }

    return zones;
  }
}

export const eliteProfitTargetCalculator = new EliteProfitTargetCalculator();
