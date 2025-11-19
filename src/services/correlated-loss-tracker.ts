import { supabase } from '../lib/supabase';

interface CorrelationPattern {
  symbols: string[];
  correlationStrength: number; // 0-100
  lossFrequency: number; // How often losses occur together
  avgLossAmount: number;
  occurrences: number;
  lastOccurrence: Date;
  shouldAvoid: boolean;
  avoidanceReason: string;
}

interface AntiPattern {
  patternType: string;
  description: string;
  failureRate: number;
  avgLoss: number;
  occurrences: number;
  conditions: any;
  avoidWhen: string[];
}

class CorrelatedLossTracker {
  private readonly CORRELATION_THRESHOLD = 0.7;
  private readonly MIN_OCCURRENCES = 3;
  private readonly LOSS_FREQUENCY_THRESHOLD = 0.6;

  async trackCorrelatedLosses(userId: string): Promise<void> {
    console.log('[Correlated Loss Tracker] Analyzing correlated losses...');

    const recentLosses = await this.getRecentLosses(userId, 100);

    if (recentLosses.length < 10) {
      console.log('[Correlated Loss Tracker] Insufficient loss data');
      return;
    }

    const symbolCorrelations = await this.analyzeSymbolCorrelations(recentLosses);

    const timeBasedCorrelations = await this.analyzeTimeBasedCorrelations(recentLosses);

    const setupCorrelations = await this.analyzeSetupCorrelations(recentLosses);

    await this.saveCorrelationPatterns(userId, symbolCorrelations);
    await this.saveAntiPatterns(userId, [
      ...timeBasedCorrelations,
      ...setupCorrelations
    ]);

    console.log(`[Correlated Loss Tracker] Found ${symbolCorrelations.length} symbol correlations`);
    console.log(`[Correlated Loss Tracker] Found ${timeBasedCorrelations.length + setupCorrelations.length} anti-patterns`);
  }

  private async getRecentLosses(userId: string, limit: number): Promise<any[]> {
    try {
      const { data: losses } = await supabase
        .from('ai_trade_analysis')
        .select('*')
        .eq('user_id', userId)
        .eq('outcome', 'loss')
        .order('entry_time', { ascending: false})
        .limit(limit);

      return losses || [];
    } catch (error) {
      console.error('[Correlated Loss Tracker] Error getting losses:', error);
      return [];
    }
  }

  private async analyzeSymbolCorrelations(losses: any[]): Promise<CorrelationPattern[]> {
    const correlations: CorrelationPattern[] = [];

    const symbols = [...new Set(losses.map(l => l.symbol))];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const sym1 = symbols[i];
        const sym2 = symbols[j];

        const sym1Losses = losses.filter(l => l.symbol === sym1);
        const sym2Losses = losses.filter(l => l.symbol === sym2);

        if (sym1Losses.length < this.MIN_OCCURRENCES || sym2Losses.length < this.MIN_OCCURRENCES) {
          continue;
        }

        let simultaneousLosses = 0;
        const timeWindow = 60 * 60 * 1000;

        for (const loss1 of sym1Losses) {
          const time1 = new Date(loss1.entry_time).getTime();

          for (const loss2 of sym2Losses) {
            const time2 = new Date(loss2.entry_time).getTime();

            if (Math.abs(time1 - time2) < timeWindow) {
              simultaneousLosses++;
              break;
            }
          }
        }

        const lossFrequency = simultaneousLosses / Math.min(sym1Losses.length, sym2Losses.length);

        if (lossFrequency >= this.LOSS_FREQUENCY_THRESHOLD) {
          const totalLoss = sym1Losses.reduce((sum, l) => sum + Math.abs(parseFloat(l.pnl)), 0) +
                           sym2Losses.reduce((sum, l) => sum + Math.abs(parseFloat(l.pnl)), 0);

          const avgLoss = totalLoss / (sym1Losses.length + sym2Losses.length);

          const correlationStrength = Math.min(100, lossFrequency * 100 + 20);

          const lastLoss = Math.max(
            ...sym1Losses.map(l => new Date(l.entry_time).getTime()),
            ...sym2Losses.map(l => new Date(l.entry_time).getTime())
          );

          correlations.push({
            symbols: [sym1, sym2],
            correlationStrength,
            lossFrequency,
            avgLossAmount: avgLoss,
            occurrences: simultaneousLosses,
            lastOccurrence: new Date(lastLoss),
            shouldAvoid: correlationStrength >= 70,
            avoidanceReason: `${sym1} and ${sym2} lose together ${(lossFrequency * 100).toFixed(0)}% of the time. Average loss: $${avgLoss.toFixed(2)}`
          });
        }
      }
    }

    return correlations.sort((a, b) => b.correlationStrength - a.correlationStrength);
  }

  private async analyzeTimeBasedCorrelations(losses: any[]): Promise<AntiPattern[]> {
    const antiPatterns: AntiPattern[] = [];

    const hourlyLosses: Record<number, any[]> = {};
    for (const loss of losses) {
      const hour = new Date(loss.entry_time).getUTCHours();
      if (!hourlyLosses[hour]) hourlyLosses[hour] = [];
      hourlyLosses[hour].push(loss);
    }

    for (const [hour, hourLosses] of Object.entries(hourlyLosses)) {
      if (hourLosses.length >= this.MIN_OCCURRENCES) {
        const totalLoss = hourLosses.reduce((sum, l) => sum + Math.abs(parseFloat(l.pnl)), 0);
        const avgLoss = totalLoss / hourLosses.length;

        const { data: allTrades } = await supabase
          .from('ai_trade_analysis')
          .select('outcome')
          .gte('entry_time', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .limit(1000);

        if (allTrades) {
          const hourTrades = allTrades.filter(t => {
            const tradeHour = new Date(t.entry_time).getUTCHours();
            return tradeHour === parseInt(hour);
          });

          if (hourTrades.length >= 5) {
            const hourLossCount = hourTrades.filter(t => t.outcome === 'loss').length;
            const failureRate = (hourLossCount / hourTrades.length) * 100;

            if (failureRate >= 60) {
              antiPatterns.push({
                patternType: 'time_based',
                description: `Trading at ${hour}:00 UTC has high failure rate`,
                failureRate,
                avgLoss,
                occurrences: hourLosses.length,
                conditions: { hour: parseInt(hour) },
                avoidWhen: [`Between ${hour}:00 and ${(parseInt(hour) + 1) % 24}:00 UTC`]
              });
            }
          }
        }
      }
    }

    return antiPatterns;
  }

  private async analyzeSetupCorrelations(losses: any[]): Promise<AntiPattern[]> {
    const antiPatterns: AntiPattern[] = [];

    const setupLosses: Record<string, any[]> = {};
    for (const loss of losses) {
      const conditions = loss.entry_market_conditions || {};
      const setup = conditions.optimalStrategy || 'Unknown';

      if (!setupLosses[setup]) setupLosses[setup] = [];
      setupLosses[setup].push(loss);
    }

    for (const [setup, setupLossArray] of Object.entries(setupLosses)) {
      if (setupLossArray.length >= this.MIN_OCCURRENCES && setup !== 'Unknown') {
        const totalLoss = setupLossArray.reduce((sum, l) => sum + Math.abs(parseFloat(l.pnl)), 0);
        const avgLoss = totalLoss / setupLossArray.length;

        antiPatterns.push({
          patternType: 'setup_based',
          description: `Setup "${setup}" frequently results in losses`,
          failureRate: 100,
          avgLoss,
          occurrences: setupLossArray.length,
          conditions: { setup },
          avoidWhen: [`When optimal strategy is "${setup}"`]
        });
      }
    }

    const directionLosses: Record<string, any[]> = {
      long: losses.filter(l => l.direction === 'buy'),
      short: losses.filter(l => l.direction === 'sell')
    };

    for (const [direction, dirLosses] of Object.entries(directionLosses)) {
      if (dirLosses.length >= 8) {
        const { data: allTrades } = await supabase
          .from('ai_trade_analysis')
          .select('outcome, direction')
          .gte('entry_time', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .eq('direction', direction === 'long' ? 'buy' : 'sell')
          .limit(1000);

        if (allTrades && allTrades.length >= 10) {
          const losses = allTrades.filter(t => t.outcome === 'loss').length;
          const failureRate = (losses / allTrades.length) * 100;

          if (failureRate >= 60) {
            const totalLoss = dirLosses.reduce((sum, l) => sum + Math.abs(parseFloat(l.pnl)), 0);
            const avgLoss = totalLoss / dirLosses.length;

            antiPatterns.push({
              patternType: 'directional_bias',
              description: `${direction === 'long' ? 'Long' : 'Short'} trades have high failure rate`,
              failureRate,
              avgLoss,
              occurrences: dirLosses.length,
              conditions: { direction: direction === 'long' ? 'buy' : 'sell' },
              avoidWhen: [`When trading ${direction} positions`]
            });
          }
        }
      }
    }

    return antiPatterns;
  }

  private async saveCorrelationPatterns(userId: string, correlations: CorrelationPattern[]): Promise<void> {
    try {
      for (const correlation of correlations) {
        await supabase
          .from('correlated_loss_patterns')
          .upsert({
            user_id: userId,
            symbols: correlation.symbols,
            correlation_strength: correlation.correlationStrength,
            loss_frequency: correlation.lossFrequency,
            avg_loss_amount: correlation.avgLossAmount,
            occurrences: correlation.occurrences,
            last_occurrence: correlation.lastOccurrence.toISOString(),
            should_avoid: correlation.shouldAvoid,
            avoidance_reason: correlation.avoidanceReason,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,symbols'
          });
      }
    } catch (error) {
      console.error('[Correlated Loss Tracker] Error saving correlations:', error);
    }
  }

  private async saveAntiPatterns(userId: string, antiPatterns: AntiPattern[]): Promise<void> {
    try {
      for (const pattern of antiPatterns) {
        await supabase
          .from('anti_patterns')
          .upsert({
            user_id: userId,
            pattern_type: pattern.patternType,
            description: pattern.description,
            failure_rate: pattern.failureRate,
            avg_loss: pattern.avgLoss,
            occurrences: pattern.occurrences,
            conditions: pattern.conditions,
            avoid_when: pattern.avoidWhen,
            updated_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,pattern_type,description'
          });
      }
    } catch (error) {
      console.error('[Correlated Loss Tracker] Error saving anti-patterns:', error);
    }
  }

  async getActiveCorrelations(userId: string): Promise<CorrelationPattern[]> {
    try {
      const { data } = await supabase
        .from('correlated_loss_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('should_avoid', true)
        .order('correlation_strength', { ascending: false })
        .limit(10);

      if (!data) return [];

      return data.map(d => ({
        symbols: d.symbols,
        correlationStrength: d.correlation_strength,
        lossFrequency: d.loss_frequency,
        avgLossAmount: d.avg_loss_amount,
        occurrences: d.occurrences,
        lastOccurrence: new Date(d.last_occurrence),
        shouldAvoid: d.should_avoid,
        avoidanceReason: d.avoidance_reason
      }));
    } catch (error) {
      console.error('[Correlated Loss Tracker] Error getting correlations:', error);
      return [];
    }
  }

  async getActiveAntiPatterns(userId: string): Promise<AntiPattern[]> {
    try {
      const { data } = await supabase
        .from('anti_patterns')
        .select('*')
        .eq('user_id', userId)
        .gte('failure_rate', 60)
        .gte('occurrences', this.MIN_OCCURRENCES)
        .order('failure_rate', { ascending: false })
        .limit(15);

      if (!data) return [];

      return data.map(d => ({
        patternType: d.pattern_type,
        description: d.description,
        failureRate: d.failure_rate,
        avgLoss: d.avg_loss,
        occurrences: d.occurrences,
        conditions: d.conditions,
        avoidWhen: d.avoid_when
      }));
    } catch (error) {
      console.error('[Correlated Loss Tracker] Error getting anti-patterns:', error);
      return [];
    }
  }

  async shouldAvoidTrade(
    userId: string,
    symbol: string,
    direction: 'buy' | 'sell',
    hour: number,
    setup?: string
  ): Promise<{ shouldAvoid: boolean; reasons: string[] }> {
    const reasons: string[] = [];

    const correlations = await this.getActiveCorrelations(userId);
    for (const corr of correlations) {
      if (corr.symbols.includes(symbol)) {
        reasons.push(corr.avoidanceReason);
      }
    }

    const antiPatterns = await this.getActiveAntiPatterns(userId);
    for (const pattern of antiPatterns) {
      if (pattern.patternType === 'time_based' && pattern.conditions.hour === hour) {
        reasons.push(`${pattern.description} (${pattern.failureRate.toFixed(0)}% failure rate)`);
      }

      if (pattern.patternType === 'directional_bias' && pattern.conditions.direction === direction) {
        reasons.push(`${pattern.description} (${pattern.failureRate.toFixed(0)}% failure rate)`);
      }

      if (pattern.patternType === 'setup_based' && setup && pattern.conditions.setup === setup) {
        reasons.push(`${pattern.description} (${pattern.occurrences} losses observed)`);
      }
    }

    return {
      shouldAvoid: reasons.length > 0,
      reasons
    };
  }
}

export const correlatedLossTracker = new CorrelatedLossTracker();
export type { CorrelationPattern, AntiPattern };
