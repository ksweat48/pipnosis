import { supabase } from '../lib/supabase';

/**
 * Economic Calendar Service
 *
 * Integrates economic events and news releases to:
 * - Track high-impact news events
 * - Learn pre/post-event market behavior
 * - Adjust trading strategy around news
 * - Calculate optimal trading windows
 * - Track surprise index and market reactions
 */

export interface EconomicEvent {
  id: string;
  eventTime: Date;
  eventName: string;
  currency: string;
  impactLevel: 'low' | 'medium' | 'high';
  eventType: 'interest_rate' | 'nfp' | 'gdp' | 'inflation' | 'employment' |
              'retail_sales' | 'pmi' | 'central_bank_speech' | 'fomc' | 'ecb' | 'boe' | 'other';
  forecastValue?: number;
  previousValue?: number;
  actualValue?: number;
  surpriseIndex?: number;

  // Learned market behavior
  avgVolatilityIncreasePct?: number;
  avgRangeExpansionPips?: number;
  typicalDurationMinutes?: number;
  continuationProbability?: number;
  reversalProbability?: number;

  // Trading recommendations
  avoidTradingBeforeMinutes: number;
  avoidTradingAfterMinutes: number;
  opportunityAfterMinutes?: number;
}

export interface EventImpactAnalysis {
  upcomingEvents: EconomicEvent[];
  inDangerZone: boolean;
  safeToProceed: boolean;
  minutesUntilNextEvent: number;
  recommendation: string;
  affectedPairs: string[];
}

class EconomicCalendarService {
  private readonly HIGH_IMPACT_EVENTS = [
    'nfp', 'interest_rate', 'gdp', 'inflation', 'fomc', 'ecb', 'boe'
  ];

  private readonly CURRENCY_PAIRS_MAP: Record<string, string[]> = {
    'USD': ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'NZDUSD', 'USDCAD'],
    'EUR': ['EURUSD', 'EURGBP', 'EURJPY', 'EURCHF', 'EURAUD'],
    'GBP': ['GBPUSD', 'EURGBP', 'GBPJPY', 'GBPAUD'],
    'JPY': ['USDJPY', 'EURJPY', 'GBPJPY'],
    'AUD': ['AUDUSD', 'EURAUD', 'GBPAUD'],
    'NZD': ['NZDUSD'],
    'CAD': ['USDCAD'],
    'CHF': ['USDCHF', 'EURCHF']
  };

  /**
   * Fetch upcoming economic events
   */
  async getUpcomingEvents(
    hoursAhead: number = 24,
    minImpact: 'low' | 'medium' | 'high' = 'medium'
  ): Promise<EconomicEvent[]> {
    const now = new Date();
    const futureTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);

    const impactLevels = minImpact === 'high'
      ? ['high']
      : minImpact === 'medium'
        ? ['medium', 'high']
        : ['low', 'medium', 'high'];

    const { data, error } = await supabase
      .from('economic_events')
      .select('*')
      .gte('event_time', now.toISOString())
      .lte('event_time', futureTime.toISOString())
      .in('impact_level', impactLevels)
      .order('event_time', { ascending: true });

    if (error) {
      console.error('[Economic Calendar] Error fetching events:', error);
      return [];
    }

    return this.mapDatabaseEventsToEvents(data || []);
  }

  /**
   * Check if it's safe to trade given upcoming events
   */
  async analyzeEventImpact(
    symbol: string,
    lookAheadMinutes: number = 60
  ): Promise<EventImpactAnalysis> {
    const now = new Date();
    const futureTime = new Date(now.getTime() + lookAheadMinutes * 60 * 1000);

    // Determine which currencies are involved in this pair
    const currencies = this.getCurrenciesFromPair(symbol);

    // Fetch high-impact events for these currencies
    const { data, error } = await supabase
      .from('economic_events')
      .select('*')
      .gte('event_time', now.toISOString())
      .lte('event_time', futureTime.toISOString())
      .in('currency', currencies)
      .in('impact_level', ['medium', 'high'])
      .order('event_time', { ascending: true });

    if (error) {
      console.error('[Economic Calendar] Error analyzing impact:', error);
      return this.createSafeAnalysis();
    }

    const upcomingEvents = this.mapDatabaseEventsToEvents(data || []);

    if (upcomingEvents.length === 0) {
      return this.createSafeAnalysis();
    }

    // Find next event
    const nextEvent = upcomingEvents[0];
    const minutesUntilEvent = (nextEvent.eventTime.getTime() - now.getTime()) / 60000;

    // Check if we're in danger zone (within avoid period)
    const inDangerZone = minutesUntilEvent <= nextEvent.avoidTradingBeforeMinutes;

    // Get all affected pairs
    const affectedPairs = new Set<string>();
    currencies.forEach(currency => {
      const pairs = this.CURRENCY_PAIRS_MAP[currency] || [];
      pairs.forEach(pair => affectedPairs.add(pair));
    });

    let recommendation = '';
    let safeToProceed = true;

    if (inDangerZone) {
      safeToProceed = false;
      recommendation = `⚠️ AVOID TRADING: ${nextEvent.eventName} in ${Math.round(minutesUntilEvent)} minutes. High volatility expected. Wait ${nextEvent.avoidTradingAfterMinutes} minutes post-event.`;
    } else if (minutesUntilEvent <= 120) {
      recommendation = `⚡ CAUTION: ${nextEvent.eventName} approaching in ${Math.round(minutesUntilEvent)} minutes. Consider reducing position size or waiting.`;
    } else {
      recommendation = `✅ Safe to trade. Next event: ${nextEvent.eventName} in ${Math.round(minutesUntilEvent)} minutes.`;
    }

    return {
      upcomingEvents,
      inDangerZone,
      safeToProceed,
      minutesUntilNextEvent: minutesUntilEvent,
      recommendation,
      affectedPairs: Array.from(affectedPairs)
    };
  }

  /**
   * Learn from historical event impact
   */
  async recordEventImpact(
    eventId: string,
    actualVolatilityIncrease: number,
    rangeExpansionPips: number,
    continuedInitialMove: boolean
  ): Promise<void> {
    // Fetch existing event
    const { data: existing, error: fetchError } = await supabase
      .from('economic_events')
      .select('*')
      .eq('id', eventId)
      .maybeSingle();

    if (fetchError || !existing) {
      console.error('[Economic Calendar] Error fetching event:', fetchError);
      return;
    }

    // Update running averages
    const timesOccurred = existing.times_occurred || 1;
    const newTimesOccurred = timesOccurred + 1;

    const currentAvgVolatility = existing.avg_volatility_increase_pct || 0;
    const currentAvgRange = existing.avg_range_expansion_pips || 0;
    const currentContinuationProb = existing.continuation_probability || 0.5;

    const newAvgVolatility = ((currentAvgVolatility * timesOccurred) + actualVolatilityIncrease) / newTimesOccurred;
    const newAvgRange = ((currentAvgRange * timesOccurred) + rangeExpansionPips) / newTimesOccurred;
    const newContinuationProb = ((currentContinuationProb * timesOccurred) + (continuedInitialMove ? 1 : 0)) / newTimesOccurred;

    // Update event
    const { error: updateError } = await supabase
      .from('economic_events')
      .update({
        avg_volatility_increase_pct: newAvgVolatility,
        avg_range_expansion_pips: newAvgRange,
        continuation_probability: newContinuationProb,
        reversal_probability: 1 - newContinuationProb,
        times_occurred: newTimesOccurred,
        last_updated: new Date().toISOString()
      })
      .eq('id', eventId);

    if (updateError) {
      console.error('[Economic Calendar] Error updating event:', updateError);
    } else {
      console.log(`[Economic Calendar] Updated impact learning for ${existing.event_name}`);
    }
  }

  /**
   * Add or update economic event
   */
  async upsertEvent(event: Partial<EconomicEvent>): Promise<void> {
    const { error } = await supabase
      .from('economic_events')
      .upsert({
        event_time: event.eventTime?.toISOString(),
        event_name: event.eventName,
        currency: event.currency,
        impact_level: event.impactLevel,
        event_type: event.eventType,
        forecast_value: event.forecastValue,
        previous_value: event.previousValue,
        actual_value: event.actualValue,
        avoid_trading_before_minutes: event.avoidTradingBeforeMinutes || 30,
        avoid_trading_after_minutes: event.avoidTradingAfterMinutes || 15,
        opportunity_after_minutes: event.opportunityAfterMinutes
      });

    if (error) {
      console.error('[Economic Calendar] Error upserting event:', error);
    }
  }

  /**
   * Bulk import events (useful for initial setup or calendar refresh)
   */
  async bulkImportEvents(events: Partial<EconomicEvent>[]): Promise<number> {
    let imported = 0;

    for (const event of events) {
      await this.upsertEvent(event);
      imported++;
    }

    console.log(`[Economic Calendar] Imported ${imported} events`);
    return imported;
  }

  /**
   * Calculate surprise index when actual is released
   */
  calculateSurpriseIndex(forecast: number, actual: number, previous: number): number {
    if (forecast === 0) return 0;

    // Surprise index = (Actual - Forecast) / Forecast * 100
    const surprise = ((actual - forecast) / Math.abs(forecast)) * 100;

    return surprise;
  }

  /**
   * Get currencies from pair symbol
   */
  private getCurrenciesFromPair(symbol: string): string[] {
    // Extract currencies from pair like EURUSD -> [EUR, USD]
    if (symbol.length >= 6) {
      return [symbol.substring(0, 3), symbol.substring(3, 6)];
    }
    return [];
  }

  /**
   * Map database rows to EconomicEvent objects
   */
  private mapDatabaseEventsToEvents(data: any[]): EconomicEvent[] {
    return data.map(row => ({
      id: row.id,
      eventTime: new Date(row.event_time),
      eventName: row.event_name,
      currency: row.currency,
      impactLevel: row.impact_level,
      eventType: row.event_type,
      forecastValue: row.forecast_value,
      previousValue: row.previous_value,
      actualValue: row.actual_value,
      surpriseIndex: row.surprise_index,
      avgVolatilityIncreasePct: row.avg_volatility_increase_pct,
      avgRangeExpansionPips: row.avg_range_expansion_pips,
      typicalDurationMinutes: row.typical_duration_minutes,
      continuationProbability: row.continuation_probability,
      reversalProbability: row.reversal_probability,
      avoidTradingBeforeMinutes: row.avoid_trading_before_minutes || 30,
      avoidTradingAfterMinutes: row.avoid_trading_after_minutes || 15,
      opportunityAfterMinutes: row.opportunity_after_minutes
    }));
  }

  /**
   * Create safe analysis when no events found
   */
  private createSafeAnalysis(): EventImpactAnalysis {
    return {
      upcomingEvents: [],
      inDangerZone: false,
      safeToProceed: true,
      minutesUntilNextEvent: Infinity,
      recommendation: '✅ No high-impact events in the next hour. Safe to trade.',
      affectedPairs: []
    };
  }

  /**
   * Populate calendar with common recurring events (one-time setup)
   */
  async seedCommonEvents(): Promise<void> {
    const commonEvents: Partial<EconomicEvent>[] = [
      {
        eventName: 'US Non-Farm Payrolls (NFP)',
        currency: 'USD',
        impactLevel: 'high',
        eventType: 'nfp',
        avoidTradingBeforeMinutes: 60,
        avoidTradingAfterMinutes: 30,
        opportunityAfterMinutes: 30
      },
      {
        eventName: 'FOMC Interest Rate Decision',
        currency: 'USD',
        impactLevel: 'high',
        eventType: 'interest_rate',
        avoidTradingBeforeMinutes: 120,
        avoidTradingAfterMinutes: 60,
        opportunityAfterMinutes: 60
      },
      {
        eventName: 'ECB Interest Rate Decision',
        currency: 'EUR',
        impactLevel: 'high',
        eventType: 'interest_rate',
        avoidTradingBeforeMinutes: 120,
        avoidTradingAfterMinutes: 60,
        opportunityAfterMinutes: 60
      },
      {
        eventName: 'BOE Interest Rate Decision',
        currency: 'GBP',
        impactLevel: 'high',
        eventType: 'interest_rate',
        avoidTradingBeforeMinutes: 120,
        avoidTradingAfterMinutes: 60,
        opportunityAfterMinutes: 60
      },
      {
        eventName: 'US CPI (Inflation)',
        currency: 'USD',
        impactLevel: 'high',
        eventType: 'inflation',
        avoidTradingBeforeMinutes: 30,
        avoidTradingAfterMinutes: 15,
        opportunityAfterMinutes: 15
      },
      {
        eventName: 'US GDP',
        currency: 'USD',
        impactLevel: 'high',
        eventType: 'gdp',
        avoidTradingBeforeMinutes: 30,
        avoidTradingAfterMinutes: 15,
        opportunityAfterMinutes: 15
      }
    ];

    console.log('[Economic Calendar] Seeding common events...');
    await this.bulkImportEvents(commonEvents);
    console.log('[Economic Calendar] Common events seeded successfully');
  }
}

export const economicCalendarService = new EconomicCalendarService();
