import { supabase } from '../lib/supabase';
import { MarketSnapshot } from './trigger-detection-rules';
import { RegimeValidationResult } from './llm-regime-validator';
import { SetupQualityResult } from './llm-setup-quality';

export interface MistakePreventionResult {
  allow_trade: boolean;
  risk_level: 'low' | 'medium' | 'high' | 'critical';
  mistake_flags: string[];
  similar_losing_patterns_found: number;
  correlated_loss_risk: boolean;
  recent_loss_context: {
    consecutive_losses: number;
    recent_loss_rate: number;
    needs_cooling_off: boolean;
  };
  warnings: string[];
  preventive_reasoning: string;
  recommendation: 'allow' | 'warn' | 'block';
}

class LLMMistakePrevention {
  private apiKey: string;
  private model: string = 'gpt-4o';
  private endpoint: string = 'https://api.openai.com/v1/chat/completions';
  private enabled: boolean = false;
  private callCount: number = 0;

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    this.enabled = !!this.apiKey;

    if (this.enabled) {
      console.log('[LLM Mistake Prevention] 🛡️ Layer 3 initialized');
    } else {
      console.warn('[LLM Mistake Prevention] No API key, prevention disabled');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async checkForMistakes(
    userId: string,
    snapshot: MarketSnapshot,
    triggerType: string,
    regimeValidation: RegimeValidationResult,
    setupQuality: SetupQualityResult
  ): Promise<MistakePreventionResult> {
    if (!this.enabled) {
      return this.createFallbackCheck(userId, snapshot);
    }

    console.log(`\n[LLM Layer 3 - Mistake Prevention] 🛡️ Checking for mistakes on ${snapshot.symbol}`);
    const startTime = Date.now();

    try {
      const [losingPatterns, recentLosses, correlatedLosses] = await Promise.all([
        this.getLosingPatterns(userId, snapshot.symbol),
        this.getRecentLossContext(userId),
        this.checkCorrelatedLossRisk(userId, snapshot.symbol)
      ]);

      const prompt = this.buildPreventionPrompt(
        snapshot,
        triggerType,
        regimeValidation,
        setupQuality,
        losingPatterns,
        recentLosses,
        correlatedLosses
      );

      const response = await this.callGPT4o(prompt);
      const result = this.parsePreventionResult(response, losingPatterns.length);

      this.callCount++;
      const duration = Date.now() - startTime;

      console.log(`[LLM Layer 3] ${result.allow_trade ? '✅ ALLOW' : '🚫 BLOCK'} (${duration}ms)`);
      console.log(`  Risk Level: ${result.risk_level}`);
      console.log(`  Mistake Flags: ${result.mistake_flags.length}`);
      console.log(`  Similar Losing Patterns: ${result.similar_losing_patterns_found}`);

      return result;
    } catch (error) {
      console.error('[LLM Layer 3] Error:', error);
      return this.createFallbackCheck(userId, snapshot);
    }
  }

  private async getLosingPatterns(userId: string, symbol: string): Promise<any[]> {
    try {
      const { data: patterns } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('insight_type', 'losing_pattern')
        .gte('confidence_score', 60)
        .order('confidence_score', { ascending: false })
        .limit(10);

      return patterns || [];
    } catch (error) {
      console.error('[Mistake Prevention] Error fetching losing patterns:', error);
      return [];
    }
  }

  private async getRecentLossContext(userId: string): Promise<any> {
    try {
      const { data: recentTrades } = await supabase
        .from('trade_history')
        .select('outcome, profit_loss')
        .eq('user_id', userId)
        .order('closed_at', { ascending: false })
        .limit(20);

      if (!recentTrades || recentTrades.length === 0) {
        return {
          consecutive_losses: 0,
          recent_loss_rate: 0,
          total_recent_trades: 0,
          needs_cooling_off: false
        };
      }

      let consecutiveLosses = 0;
      for (const trade of recentTrades) {
        if (trade.outcome === 'loss') {
          consecutiveLosses++;
        } else {
          break;
        }
      }

      const losses = recentTrades.filter(t => t.outcome === 'loss').length;
      const lossRate = (losses / recentTrades.length) * 100;

      return {
        consecutive_losses: consecutiveLosses,
        recent_loss_rate: lossRate,
        total_recent_trades: recentTrades.length,
        needs_cooling_off: consecutiveLosses >= 3 || lossRate > 60
      };
    } catch (error) {
      console.error('[Mistake Prevention] Error fetching recent losses:', error);
      return {
        consecutive_losses: 0,
        recent_loss_rate: 0,
        total_recent_trades: 0,
        needs_cooling_off: false
      };
    }
  }

  private async checkCorrelatedLossRisk(userId: string, symbol: string): Promise<boolean> {
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data: recentLosses } = await supabase
        .from('trade_history')
        .select('symbol')
        .eq('user_id', userId)
        .eq('outcome', 'loss')
        .gte('closed_at', oneDayAgo);

      if (!recentLosses || recentLosses.length === 0) return false;

      const symbolLosses = recentLosses.filter(t => t.symbol === symbol).length;
      return symbolLosses >= 3;
    } catch (error) {
      return false;
    }
  }

  private buildPreventionPrompt(
    snapshot: MarketSnapshot,
    triggerType: string,
    regimeValidation: RegimeValidationResult,
    setupQuality: SetupQualityResult,
    losingPatterns: any[],
    recentLosses: any,
    correlatedLossRisk: boolean
  ): string {
    const currentCandle = snapshot.ohlc[snapshot.ohlc.length - 1];

    let losingPatternsText = 'None on record';
    if (losingPatterns.length > 0) {
      losingPatternsText = losingPatterns.map((p, i) =>
        `  ${i + 1}. "${p.insight_title}" (confidence: ${p.confidence_score}%)\n     ${p.insight_description}\n     Avoid when: ${p.avoid_when_conditions?.when || 'N/A'}`
      ).join('\n\n');
    }

    return `You are the Mistake Prevention Brain (Layer 3 of 5) in Pipnosis AI Trading System.

Your critical responsibility: BLOCK this trade if it matches past mistakes or shows high risk of repeating losses.

PREVIOUS LAYERS PASSED:
✅ Layer 1 - Regime validated: ${regimeValidation.detected_regime.trend} / ${regimeValidation.detected_regime.volatility}
✅ Layer 2 - Setup quality: ${setupQuality.quality_score}/100 (${setupQuality.recommendation})

CURRENT SETUP:
Symbol: ${snapshot.symbol}
Trigger: ${triggerType}
Price: ${currentCandle.close.toFixed(5)}
Trend: ${snapshot.priceAction.trend}
Volatility: ${snapshot.priceAction.volatility}

RECENT LOSS CONTEXT (Last 20 trades):
⚠️ Consecutive Losses: ${recentLosses.consecutive_losses}
⚠️ Recent Loss Rate: ${recentLosses.recent_loss_rate.toFixed(1)}%
⚠️ Needs Cooling Off: ${recentLosses.needs_cooling_off ? 'YES' : 'NO'}
⚠️ Correlated Loss Risk on ${snapshot.symbol}: ${correlatedLossRisk ? 'HIGH' : 'LOW'}

KNOWN LOSING PATTERNS FOR ${snapshot.symbol}:
${losingPatternsText}

Your task:
1. Check if current setup matches any losing patterns
2. Assess if trader needs cooling-off period (too many recent losses)
3. Check for correlated loss risk (repeated losses on same symbol)
4. Identify specific mistake flags
5. Make ALLOW/WARN/BLOCK recommendation

RED FLAGS that should trigger BLOCK:
- 3+ consecutive losses (currently: ${recentLosses.consecutive_losses})
- Loss rate > 60% in last 20 trades (currently: ${recentLosses.recent_loss_rate.toFixed(1)}%)
- Current setup matches high-confidence losing pattern
- 3+ losses on this symbol in last 24h

Respond in this EXACT JSON format (no markdown):
{
  "allow_trade": <true/false>,
  "risk_level": "<low/medium/high/critical>",
  "mistake_flags": ["<flag 1>", "<flag 2>"],
  "similar_losing_patterns_found": <number of patterns that match>,
  "correlated_loss_risk": <true if symbol has recent losses>,
  "warnings": ["<warning 1>", "<warning 2>"],
  "preventive_reasoning": "<why you're blocking or allowing, reference specific patterns if blocking>",
  "recommendation": "<allow/warn/block>"
}

Be RUTHLESS. When in doubt, BLOCK. Protecting capital is priority #1.`;
  }

  private async callGPT4o(prompt: string): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are a mistake prevention specialist. Be ruthless in protecting capital. When in doubt, block the trade.'
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      throw new Error(`GPT-4o API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private parsePreventionResult(content: string, patternCount: number): MistakePreventionResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    return {
      allow_trade: parsed.allow_trade ?? true,
      risk_level: parsed.risk_level || 'medium',
      mistake_flags: parsed.mistake_flags || [],
      similar_losing_patterns_found: parsed.similar_losing_patterns_found || 0,
      correlated_loss_risk: parsed.correlated_loss_risk || false,
      recent_loss_context: {
        consecutive_losses: 0,
        recent_loss_rate: 0,
        needs_cooling_off: false
      },
      warnings: parsed.warnings || [],
      preventive_reasoning: parsed.preventive_reasoning || '',
      recommendation: parsed.recommendation || 'allow'
    };
  }

  private async createFallbackCheck(userId: string, snapshot: MarketSnapshot): Promise<MistakePreventionResult> {
    const recentLosses = await this.getRecentLossContext(userId);

    const shouldBlock = recentLosses.consecutive_losses >= 3 || recentLosses.recent_loss_rate > 70;

    return {
      allow_trade: !shouldBlock,
      risk_level: shouldBlock ? 'high' : 'medium',
      mistake_flags: shouldBlock ? ['Consecutive losses detected'] : [],
      similar_losing_patterns_found: 0,
      correlated_loss_risk: false,
      recent_loss_context: recentLosses,
      warnings: shouldBlock ? ['Cooling-off period recommended'] : [],
      preventive_reasoning: 'Fallback check: basic loss prevention based on recent trades',
      recommendation: shouldBlock ? 'block' : 'allow'
    };
  }

  getUsageStats(): { calls: number } {
    return { calls: this.callCount };
  }
}

export const llmMistakePrevention = new LLMMistakePrevention();
