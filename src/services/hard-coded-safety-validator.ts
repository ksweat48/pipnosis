/**
 * Hard-Coded Safety Validator
 *
 * Non-negotiable safety rules that Alpha CANNOT override.
 * These rules protect the account and ensure regulatory compliance.
 *
 * Alpha has full authority to make trading decisions, but these
 * rules act as circuit breakers for dangerous situations.
 */

import { supabase } from '../lib/supabase';
import type { AlphaDecision } from '../brains/coordinator-alpha';

export interface SafetyRule {
  rule_name: string;
  rule_type: string;
  rule_description: string;
  rule_logic: Record<string, any>;
  enabled: boolean;
  priority: number;
}

export interface SafetyViolation {
  rule_name: string;
  rule_type: string;
  violation_description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  recommended_action: string;
}

export interface SafetyCheckResult {
  passed: boolean;
  violations: SafetyViolation[];
  safe_to_execute: boolean;
  corrected_decision?: AlphaDecision;
}

class HardCodedSafetyValidator {
  private rules: SafetyRule[] = [];
  private lastRulesLoad: Date | null = null;
  private CACHE_DURATION_MS = 60000; // 1 minute cache

  /**
   * Load safety rules from database (cached)
   */
  private async loadRules(): Promise<void> {
    const now = new Date();
    if (this.lastRulesLoad && (now.getTime() - this.lastRulesLoad.getTime()) < this.CACHE_DURATION_MS) {
      return; // Use cached rules
    }

    try {
      const { data, error } = await supabase
        .from('hard_coded_safety_rules')
        .select('*')
        .eq('enabled', true)
        .order('priority', { ascending: false });

      if (error) {
        console.error('[Safety Validator] Failed to load rules:', error);
        // Fall back to default rules if database fails
        this.loadDefaultRules();
        return;
      }

      this.rules = data || [];
      this.lastRulesLoad = now;
      console.log(`[Safety Validator] Loaded ${this.rules.length} safety rules`);
    } catch (error) {
      console.error('[Safety Validator] Exception loading rules:', error);
      this.loadDefaultRules();
    }
  }

  /**
   * Default safety rules (fallback if database fails)
   */
  private loadDefaultRules(): void {
    this.rules = [
      {
        rule_name: 'max_position_size',
        rule_type: 'POSITION_SIZE',
        rule_description: 'Maximum position size per trade',
        rule_logic: { max_lots: 1.0, max_pct_of_balance: 10 },
        enabled: true,
        priority: 100
      },
      {
        rule_name: 'min_stop_loss',
        rule_type: 'STOP_LOSS',
        rule_description: 'Minimum stop loss distance',
        rule_logic: { min_atr_multiplier: 1.0, min_pips: 5 },
        enabled: true,
        priority: 90
      },
      {
        rule_name: 'max_leverage',
        rule_type: 'LEVERAGE',
        rule_description: 'Maximum leverage allowed',
        rule_logic: { max_leverage: 100 },
        enabled: true,
        priority: 100
      },
      {
        rule_name: 'max_drawdown',
        rule_type: 'DRAWDOWN',
        rule_description: 'Maximum account drawdown',
        rule_logic: { max_drawdown_pct: 20 },
        enabled: true,
        priority: 100
      },
      {
        rule_name: 'price_validation',
        rule_type: 'PRICE_VALIDATION',
        rule_description: 'Price must be within valid ranges',
        rule_logic: { check_symbol_ranges: true, check_spread: true },
        enabled: true,
        priority: 95
      }
    ];
    this.lastRulesLoad = new Date();
  }

  /**
   * Validate Alpha's decision against hard-coded safety rules
   */
  async validateDecision(
    decision: AlphaDecision,
    context: {
      symbol: string;
      currentPrice: number;
      atr: number;
      accountBalance: number;
      openPositions: number;
      currentDrawdown: number;
    }
  ): Promise<SafetyCheckResult> {
    await this.loadRules();

    const violations: SafetyViolation[] = [];

    // Skip validation for NO_TRADE decisions
    if (decision.action === 'NO_TRADE') {
      return {
        passed: true,
        violations: [],
        safe_to_execute: true
      };
    }

    // Check each rule
    for (const rule of this.rules) {
      const violation = await this.checkRule(rule, decision, context);
      if (violation) {
        violations.push(violation);
      }
    }

    // Determine if safe to execute
    const criticalViolations = violations.filter(v => v.severity === 'CRITICAL');
    const safe_to_execute = criticalViolations.length === 0;

    console.log(`[Safety Validator] Decision: ${decision.action} @ ${decision.confidence}%`);
    console.log(`[Safety Validator] Violations: ${violations.length} (${criticalViolations.length} critical)`);

    if (violations.length > 0) {
      violations.forEach(v => {
        console.warn(`[Safety Validator] ${v.severity}: ${v.rule_name} - ${v.violation_description}`);
      });
    }

    return {
      passed: violations.length === 0,
      violations,
      safe_to_execute,
      corrected_decision: safe_to_execute ? undefined : this.createSafeDecision(decision, context)
    };
  }

  /**
   * Check a single safety rule
   */
  private async checkRule(
    rule: SafetyRule,
    decision: AlphaDecision,
    context: any
  ): Promise<SafetyViolation | null> {
    switch (rule.rule_type) {
      case 'POSITION_SIZE':
        return this.checkPositionSize(rule, decision, context);
      case 'STOP_LOSS':
        return this.checkStopLoss(rule, decision, context);
      case 'LEVERAGE':
        return this.checkLeverage(rule, decision, context);
      case 'DRAWDOWN':
        return this.checkDrawdown(rule, decision, context);
      case 'PRICE_VALIDATION':
        return this.checkPriceValidation(rule, decision, context);
      case 'MAX_EXPOSURE':
        return this.checkMaxExposure(rule, decision, context);
      default:
        return null;
    }
  }

  /**
   * Check position size rule
   */
  private checkPositionSize(rule: SafetyRule, decision: AlphaDecision, context: any): SafetyViolation | null {
    const maxPctOfBalance = rule.rule_logic.max_pct_of_balance || 10;
    const risk_pct = decision.risk_pct || 3;

    if (risk_pct > maxPctOfBalance) {
      return {
        rule_name: rule.rule_name,
        rule_type: rule.rule_type,
        violation_description: `Position risk ${risk_pct}% exceeds maximum ${maxPctOfBalance}%`,
        severity: 'CRITICAL',
        recommended_action: `Reduce position size to ${maxPctOfBalance}% or less`
      };
    }

    return null;
  }

  /**
   * Check stop loss rule
   */
  private checkStopLoss(rule: SafetyRule, decision: AlphaDecision, context: any): SafetyViolation | null {
    const minAtrMultiplier = rule.rule_logic.min_atr_multiplier || 1.0;
    const minPips = rule.rule_logic.min_pips || 5;

    const slDistance = Math.abs(decision.entry - decision.stopLoss);
    const minDistance = context.atr * minAtrMultiplier;

    if (slDistance < minDistance) {
      return {
        rule_name: rule.rule_name,
        rule_type: rule.rule_type,
        violation_description: `Stop loss too tight: ${slDistance.toFixed(5)} < ${minDistance.toFixed(5)} (${minAtrMultiplier}x ATR)`,
        severity: 'HIGH',
        recommended_action: `Widen stop loss to at least ${minAtrMultiplier}x ATR`
      };
    }

    return null;
  }

  /**
   * Check leverage rule
   */
  private checkLeverage(rule: SafetyRule, decision: AlphaDecision, context: any): SafetyViolation | null {
    const maxLeverage = rule.rule_logic.max_leverage || 100;
    // For now, we don't calculate actual leverage, but this is where it would be checked
    return null;
  }

  /**
   * Check drawdown rule
   */
  private checkDrawdown(rule: SafetyRule, decision: AlphaDecision, context: any): SafetyViolation | null {
    const maxDrawdownPct = rule.rule_logic.max_drawdown_pct || 20;

    if (context.currentDrawdown >= maxDrawdownPct) {
      return {
        rule_name: rule.rule_name,
        rule_type: rule.rule_type,
        violation_description: `Current drawdown ${context.currentDrawdown.toFixed(1)}% exceeds maximum ${maxDrawdownPct}%`,
        severity: 'CRITICAL',
        recommended_action: 'BLOCK all trades until drawdown recovers'
      };
    }

    return null;
  }

  /**
   * Check price validation rule
   */
  private checkPriceValidation(rule: SafetyRule, decision: AlphaDecision, context: any): SafetyViolation | null {
    // Check if prices are reasonable (not zero, not negative, SL/TP in correct direction)
    if (decision.entry <= 0 || decision.stopLoss <= 0 || decision.takeProfit <= 0) {
      return {
        rule_name: rule.rule_name,
        rule_type: rule.rule_type,
        violation_description: 'Invalid price levels (zero or negative)',
        severity: 'CRITICAL',
        recommended_action: 'BLOCK trade - invalid prices'
      };
    }

    // Check SL/TP direction
    if (decision.action === 'BUY') {
      if (decision.stopLoss >= decision.entry) {
        return {
          rule_name: rule.rule_name,
          rule_type: rule.rule_type,
          violation_description: 'BUY trade: Stop loss must be BELOW entry',
          severity: 'CRITICAL',
          recommended_action: 'BLOCK trade - SL direction error'
        };
      }
      if (decision.takeProfit <= decision.entry) {
        return {
          rule_name: rule.rule_name,
          rule_type: rule.rule_type,
          violation_description: 'BUY trade: Take profit must be ABOVE entry',
          severity: 'CRITICAL',
          recommended_action: 'BLOCK trade - TP direction error'
        };
      }
    } else if (decision.action === 'SELL') {
      if (decision.stopLoss <= decision.entry) {
        return {
          rule_name: rule.rule_name,
          rule_type: rule.rule_type,
          violation_description: 'SELL trade: Stop loss must be ABOVE entry',
          severity: 'CRITICAL',
          recommended_action: 'BLOCK trade - SL direction error'
        };
      }
      if (decision.takeProfit >= decision.entry) {
        return {
          rule_name: rule.rule_name,
          rule_type: rule.rule_type,
          violation_description: 'SELL trade: Take profit must be BELOW entry',
          severity: 'CRITICAL',
          recommended_action: 'BLOCK trade - TP direction error'
        };
      }
    }

    return null;
  }

  /**
   * Check max exposure rule
   */
  private checkMaxExposure(rule: SafetyRule, decision: AlphaDecision, context: any): SafetyViolation | null {
    const maxTrades = rule.rule_logic.max_trades || 3;

    if (context.openPositions >= maxTrades) {
      return {
        rule_name: rule.rule_name,
        rule_type: rule.rule_type,
        violation_description: `Already at maximum concurrent trades (${context.openPositions}/${maxTrades})`,
        severity: 'HIGH',
        recommended_action: 'Wait for existing position to close'
      };
    }

    return null;
  }

  /**
   * Create a safe NO_TRADE decision when violations occur
   */
  private createSafeDecision(original: AlphaDecision, context: any): AlphaDecision {
    return {
      ...original,
      action: 'NO_TRADE',
      decision: 'NO_TRADE',
      confidence: 0,
      reasoning: `SAFETY BLOCK: ${original.reasoning}`,
      omega_summary: `[BLOCKED] ${original.omega_summary}`
    };
  }
}

export const hardCodedSafetyValidator = new HardCodedSafetyValidator();
