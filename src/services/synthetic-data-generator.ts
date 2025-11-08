import { supabase } from '../lib/supabase';

export interface SyntheticCandle {
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tick_volume: number;
  spread: number;
}

export interface GenerationParams {
  volatility: number;
  trendBias: number;
  marketRegime: 'trending_up' | 'trending_down' | 'ranging' | 'high_volatility' | 'mixed';
  supportResistanceLevels: boolean;
}

export interface SyntheticDataResult {
  generationId: string;
  symbol: string;
  candlesGenerated: number;
  dateRange: {
    start: string;
    end: string;
  };
  params: GenerationParams;
}

class SyntheticDataGeneratorService {
  private readonly DEFAULT_VOLATILITY = 0.0015;
  private readonly HIGH_VOLATILITY = 0.003;
  private readonly LOW_VOLATILITY = 0.0008;

  async generateSyntheticData(
    userId: string,
    symbol: string,
    startDate: Date,
    endDate: Date,
    scenario: string = 'mixed',
    customParams?: Partial<GenerationParams>
  ): Promise<SyntheticDataResult> {
    console.log(`[Synthetic] Generating data for ${symbol} from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    const params = this.getScenarioParams(scenario, customParams);
    const startTime = Date.now();

    const generationRecord = await this.createGenerationRecord(userId, symbol, startDate, endDate, params, scenario);
    const generationId = generationRecord.id;

    const m1Candles = await this.generateM1Candles(symbol, startDate, endDate, params, generationId);

    const allTimeframes = ['M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
    for (const timeframe of allTimeframes) {
      await this.aggregateToTimeframe(m1Candles, symbol, timeframe, generationId);
    }

    const totalCandles = m1Candles.length * 7;
    const duration = Date.now() - startTime;

    await supabase
      .from('synthetic_data_generations')
      .update({
        candles_generated: totalCandles,
        generation_duration_ms: duration
      })
      .eq('id', generationId);

    console.log(`[Synthetic] ✅ Generated ${totalCandles} candles in ${duration}ms`);

    return {
      generationId,
      symbol,
      candlesGenerated: totalCandles,
      dateRange: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      params
    };
  }

  private getScenarioParams(scenario: string, customParams?: Partial<GenerationParams>): GenerationParams {
    const baseParams: GenerationParams = {
      volatility: this.DEFAULT_VOLATILITY,
      trendBias: 0,
      marketRegime: 'mixed',
      supportResistanceLevels: true
    };

    switch (scenario) {
      case 'trending_up':
        return {
          ...baseParams,
          trendBias: 0.0003,
          marketRegime: 'trending_up',
          ...customParams
        };

      case 'trending_down':
        return {
          ...baseParams,
          trendBias: -0.0003,
          marketRegime: 'trending_down',
          ...customParams
        };

      case 'ranging':
        return {
          ...baseParams,
          volatility: this.LOW_VOLATILITY,
          trendBias: 0,
          marketRegime: 'ranging',
          supportResistanceLevels: true,
          ...customParams
        };

      case 'high_volatility':
        return {
          ...baseParams,
          volatility: this.HIGH_VOLATILITY,
          trendBias: 0,
          marketRegime: 'high_volatility',
          ...customParams
        };

      case 'mixed':
      default:
        return {
          ...baseParams,
          marketRegime: 'mixed',
          ...customParams
        };
    }
  }

  private async generateM1Candles(
    symbol: string,
    startDate: Date,
    endDate: Date,
    params: GenerationParams,
    generationId: string
  ): Promise<SyntheticCandle[]> {
    const candles: SyntheticCandle[] = [];
    const basePrice = this.getBasePrice(symbol);
    let currentPrice = basePrice;

    let currentTime = new Date(startDate);
    const endTime = new Date(endDate);

    let currentTrend = params.trendBias;
    let trendDuration = 0;
    const maxTrendDuration = 120;

    let volatilityMultiplier = 1.0;
    let volatilityCycle = 0;

    while (currentTime < endTime) {
      if (this.isWeekend(currentTime)) {
        currentTime = this.skipToMonday(currentTime);
        continue;
      }

      if (params.marketRegime === 'mixed') {
        if (trendDuration >= maxTrendDuration) {
          currentTrend = this.randomTrend();
          trendDuration = 0;
        }
        trendDuration++;

        volatilityCycle++;
        if (volatilityCycle > 60) {
          volatilityMultiplier = Math.random() > 0.5 ? 1.5 : 0.7;
          volatilityCycle = 0;
        }
      }

      const drift = currentTrend;
      const effectiveVolatility = params.volatility * volatilityMultiplier;

      const randomShock = this.gaussianRandom() * effectiveVolatility * currentPrice;
      const priceChange = drift * currentPrice + randomShock;

      const open = currentPrice;
      currentPrice = Math.max(currentPrice + priceChange, basePrice * 0.8);
      currentPrice = Math.min(currentPrice, basePrice * 1.2);

      const intrabarVolatility = effectiveVolatility * currentPrice * 0.5;
      const high = Math.max(open, currentPrice) + Math.abs(this.gaussianRandom()) * intrabarVolatility;
      const low = Math.min(open, currentPrice) - Math.abs(this.gaussianRandom()) * intrabarVolatility;
      const close = currentPrice;

      const volume = Math.floor(Math.random() * 500 + 100);
      const tickVolume = Math.floor(Math.random() * 50 + 10);
      const spread = 0.00002;

      const closeTime = new Date(currentTime.getTime() + 60000);

      candles.push({
        open_time: currentTime.toISOString(),
        close_time: closeTime.toISOString(),
        open: this.roundPrice(open),
        high: this.roundPrice(high),
        low: this.roundPrice(low),
        close: this.roundPrice(close),
        volume,
        tick_volume: tickVolume,
        spread
      });

      currentTime = closeTime;
    }

    await this.saveCandlesToDatabase(candles, symbol, 'M1', generationId);

    console.log(`[Synthetic] Generated ${candles.length} M1 candles`);
    return candles;
  }

  private async aggregateToTimeframe(
    m1Candles: SyntheticCandle[],
    symbol: string,
    timeframe: string,
    generationId: string
  ): Promise<void> {
    const minutes = this.getTimeframeMinutes(timeframe);
    const aggregated: SyntheticCandle[] = [];

    for (let i = 0; i < m1Candles.length; i += minutes) {
      const chunk = m1Candles.slice(i, i + minutes);
      if (chunk.length === 0) continue;

      const open = chunk[0].open;
      const close = chunk[chunk.length - 1].close;
      const high = Math.max(...chunk.map(c => c.high));
      const low = Math.min(...chunk.map(c => c.low));
      const volume = chunk.reduce((sum, c) => sum + c.volume, 0);
      const tickVolume = chunk.reduce((sum, c) => sum + c.tick_volume, 0);

      aggregated.push({
        open_time: chunk[0].open_time,
        close_time: chunk[chunk.length - 1].close_time,
        open: this.roundPrice(open),
        high: this.roundPrice(high),
        low: this.roundPrice(low),
        close: this.roundPrice(close),
        volume,
        tick_volume: tickVolume,
        spread: chunk[0].spread
      });
    }

    await this.saveCandlesToDatabase(aggregated, symbol, timeframe, generationId);
    console.log(`[Synthetic] Aggregated ${aggregated.length} ${timeframe} candles`);
  }

  private async saveCandlesToDatabase(
    candles: SyntheticCandle[],
    symbol: string,
    timeframe: string,
    generationId: string
  ): Promise<void> {
    const BATCH_SIZE = 1000;

    for (let i = 0; i < candles.length; i += BATCH_SIZE) {
      const batch = candles.slice(i, i + BATCH_SIZE);
      const records = batch.map(candle => ({
        synthetic_session_id: generationId,
        symbol,
        timeframe,
        ...candle,
        is_synthetic: true
      }));

      const { error } = await supabase
        .from('synthetic_candles')
        .insert(records);

      if (error) {
        console.error(`[Synthetic] Error saving batch:`, error);
        throw error;
      }
    }
  }

  private async createGenerationRecord(
    userId: string,
    symbol: string,
    startDate: Date,
    endDate: Date,
    params: GenerationParams,
    scenario: string
  ): Promise<any> {
    const { data, error } = await supabase
      .from('synthetic_data_generations')
      .insert({
        user_id: userId,
        symbol,
        start_date: startDate.toISOString(),
        end_date: endDate.toISOString(),
        generation_params: params,
        market_scenario: scenario
      })
      .select()
      .single();

    if (error) {
      console.error('[Synthetic] Error creating generation record:', error);
      throw error;
    }

    return data;
  }

  private getBasePrice(symbol: string): number {
    const basePrices: { [key: string]: number } = {
      'EURUSD': 1.0850,
      'GBPUSD': 1.2650,
      'USDJPY': 149.50,
      'XAUUSD': 2650.00,
      'US30': 42000.00
    };
    return basePrices[symbol] || 1.0000;
  }

  private getTimeframeMinutes(timeframe: string): number {
    const timeframes: { [key: string]: number } = {
      'M1': 1,
      'M5': 5,
      'M15': 15,
      'M30': 30,
      'H1': 60,
      'H4': 240,
      'D1': 1440
    };
    return timeframes[timeframe] || 1;
  }

  private gaussianRandom(): number {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  private randomTrend(): number {
    const trends = [-0.0003, -0.0001, 0, 0.0001, 0.0003];
    return trends[Math.floor(Math.random() * trends.length)];
  }

  private isWeekend(date: Date): boolean {
    const day = date.getUTCDay();
    return day === 0 || day === 6;
  }

  private skipToMonday(date: Date): Date {
    const newDate = new Date(date);
    while (this.isWeekend(newDate)) {
      newDate.setUTCDate(newDate.getUTCDate() + 1);
    }
    return newDate;
  }

  private roundPrice(price: number): number {
    return Math.round(price * 100000) / 100000;
  }

  async getSyntheticCandles(
    generationId: string,
    symbol: string,
    timeframe: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from('synthetic_candles')
      .select('*')
      .eq('synthetic_session_id', generationId)
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .gte('open_time', startDate.toISOString())
      .lte('open_time', endDate.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error('[Synthetic] Error fetching candles:', error);
      return [];
    }

    return data || [];
  }

  async getOrCreateSyntheticData(
    userId: string,
    symbol: string,
    startDate: Date,
    endDate: Date,
    scenario: string = 'mixed'
  ): Promise<string> {
    const { data: existing } = await supabase
      .from('synthetic_data_generations')
      .select('id')
      .eq('user_id', userId)
      .eq('symbol', symbol)
      .eq('market_scenario', scenario)
      .gte('start_date', startDate.toISOString())
      .lte('end_date', endDate.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      console.log('[Synthetic] Using existing generation:', existing.id);
      return existing.id;
    }

    const result = await this.generateSyntheticData(userId, symbol, startDate, endDate, scenario);
    return result.generationId;
  }

  async deleteSyntheticGeneration(generationId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('synthetic_data_generations')
      .delete()
      .eq('id', generationId)
      .eq('user_id', userId);

    if (error) {
      console.error('[Synthetic] Error deleting generation:', error);
      throw error;
    }

    console.log(`[Synthetic] Deleted generation ${generationId}`);
  }
}

export const syntheticDataGenerator = new SyntheticDataGeneratorService();
