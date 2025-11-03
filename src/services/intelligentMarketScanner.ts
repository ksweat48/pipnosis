import { supabase } from '@/lib/supabase';
import { technicalScanEngine, TechnicalSignal } from '@/lib/technicalScanEngine';
import { aiMarketEngine, AIMarketAnalysis } from '@/lib/aiMarketEngine';
import { saveMarketAnalysis } from './marketAnalysisService';

export interface ScanResult {
  technicalSignal: TechnicalSignal | null;
  aiAnalysis: AIMarketAnalysis | null;
  finalScore: number;
  shouldTrade: boolean;
  reasoning: string;
  timestamp: Date;
}

export interface ScannerConfig {
  symbols: string[];
  timeframe: string;
  minTechnicalScore: number;
  requireAIValidation: boolean;
  maxSignalsPerScan: number;
}

class IntelligentMarketScanner {
  private isScanning: boolean = false;
  private lastScanTime: Date | null = null;
  private scanHistory: ScanResult[] = [];
  private readonly MAX_HISTORY = 50;

  async fetchCandles(symbol: string, timeframe: string, limit: number = 100): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('historical_candles')
        .select('time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('time', { ascending: false })
        .limit(limit);

      if (error) {
        console.error(`[Scanner] Failed to fetch candles for ${symbol}:`, error);
        return [];
      }

      return (data || []).reverse().map(c => ({
        time: new Date(c.time).getTime(),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
        volume: c.volume ? parseFloat(c.volume) : 1
      }));

    } catch (error) {
      console.error(`[Scanner] Error fetching candles:`, error);
      return [];
    }
  }

  async scanSymbol(symbol: string, config: ScannerConfig): Promise<ScanResult> {
    console.log(`[Scanner] Scanning ${symbol} ${config.timeframe}...`);

    const candles = await this.fetchCandles(symbol, config.timeframe, 100);

    if (candles.length < 60) {
      return {
        technicalSignal: null,
        aiAnalysis: null,
        finalScore: 0,
        shouldTrade: false,
        reasoning: `Insufficient candle data for ${symbol} (${candles.length}/60)`,
        timestamp: new Date()
      };
    }

    const technicalSignal = technicalScanEngine.analyzeTechnicals(symbol, config.timeframe, candles);

    if (!technicalSignal || technicalSignal.score < config.minTechnicalScore) {
      return {
        technicalSignal,
        aiAnalysis: null,
        finalScore: technicalSignal?.score || 0,
        shouldTrade: false,
        reasoning: technicalSignal
          ? `Technical score ${technicalSignal.score} below threshold ${config.minTechnicalScore}`
          : 'No valid technical setup detected',
        timestamp: new Date()
      };
    }

    console.log(`[Scanner] ${symbol} technical signal found (score: ${technicalSignal.score})`);

    let aiAnalysis: AIMarketAnalysis | null = null;
    let finalScore = technicalSignal.score;
    let shouldTrade = false;
    let reasoning = technicalSignal.reasons.join('. ');

    if (config.requireAIValidation && technicalSignal.score >= 75) {
      console.log(`[Scanner] Requesting AI validation for ${symbol}...`);

      try {
        aiAnalysis = await aiMarketEngine.analyzeMarket(candles, technicalSignal);

        if (aiAnalysis) {
          await saveMarketAnalysis(symbol, config.timeframe, aiAnalysis);

          const aiConfidenceBonus = aiAnalysis.confidence * 0.2;
          finalScore = Math.min(technicalSignal.score + aiConfidenceBonus, 100);

          const aiAgreesWithDirection =
            (technicalSignal.direction === 'buy' && ['strong_buy', 'buy'].includes(aiAnalysis.recommendation)) ||
            (technicalSignal.direction === 'sell' && ['strong_sell', 'sell'].includes(aiAnalysis.recommendation));

          shouldTrade = aiAgreesWithDirection && aiAnalysis.confidence >= 60;

          reasoning = shouldTrade
            ? `Technical setup (${technicalSignal.score}) validated by AI (${aiAnalysis.confidence}% confidence). ${aiAnalysis.reasoning}`
            : `AI suggests ${aiAnalysis.recommendation}. ${aiAnalysis.reasoning}`;

          console.log(`[Scanner] AI validation complete: ${shouldTrade ? 'APPROVED' : 'REJECTED'}`);
        }
      } catch (error) {
        console.error('[Scanner] AI validation failed:', error);
        shouldTrade = technicalSignal.score >= 85;
        reasoning = `High-confidence technical setup (${technicalSignal.score}). AI validation unavailable.`;
      }
    } else {
      shouldTrade = technicalSignal.score >= 85;
      reasoning = shouldTrade
        ? `Strong technical setup: ${reasoning}`
        : `Technical setup detected but below execution threshold`;
    }

    return {
      technicalSignal,
      aiAnalysis,
      finalScore,
      shouldTrade,
      reasoning,
      timestamp: new Date()
    };
  }

  async scanAllSymbols(config: ScannerConfig): Promise<ScanResult[]> {
    if (this.isScanning) {
      console.warn('[Scanner] Scan already in progress, skipping...');
      return [];
    }

    this.isScanning = true;
    this.lastScanTime = new Date();

    console.log(`[Scanner] Starting scan of ${config.symbols.length} symbols...`);

    const results: ScanResult[] = [];

    for (const symbol of config.symbols) {
      const result = await this.scanSymbol(symbol, config);
      results.push(result);

      if (result.shouldTrade) {
        this.addToHistory(result);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const tradableSignals = results
      .filter(r => r.shouldTrade)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, config.maxSignalsPerScan);

    console.log(`[Scanner] Scan complete. Found ${tradableSignals.length} tradable setups.`);

    this.isScanning = false;
    return tradableSignals;
  }

  private addToHistory(result: ScanResult): void {
    this.scanHistory.unshift(result);
    if (this.scanHistory.length > this.MAX_HISTORY) {
      this.scanHistory = this.scanHistory.slice(0, this.MAX_HISTORY);
    }
  }

  getScanHistory(): ScanResult[] {
    return [...this.scanHistory];
  }

  getLastScanTime(): Date | null {
    return this.lastScanTime;
  }

  isCurrentlyScanning(): boolean {
    return this.isScanning;
  }

  clearHistory(): void {
    this.scanHistory = [];
    console.log('[Scanner] History cleared');
  }

  async getDefaultConfig(): Promise<ScannerConfig> {
    return {
      symbols: ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'],
      timeframe: 'M15',
      minTechnicalScore: 65,
      requireAIValidation: true,
      maxSignalsPerScan: 3
    };
  }

  async createGoalBasedConfig(
    watchlist: string[],
    riskMode: 'low' | 'medium' | 'high',
    timeframeHours: number
  ): Promise<ScannerConfig> {
    const riskConfig = {
      low: { minScore: 80, maxSignals: 1, requireAI: true },
      medium: { minScore: 75, maxSignals: 2, requireAI: true },
      high: { minScore: 70, maxSignals: 3, requireAI: true }
    };

    const config = riskConfig[riskMode];

    const timeframe = timeframeHours <= 4 ? 'M5' :
                     timeframeHours <= 24 ? 'M15' :
                     timeframeHours <= 168 ? 'H1' : 'H4';

    return {
      symbols: watchlist,
      timeframe,
      minTechnicalScore: config.minScore,
      requireAIValidation: config.requireAI,
      maxSignalsPerScan: config.maxSignals
    };
  }

  getStats(): {
    totalScans: number;
    avgScore: number;
    topSymbol: string | null;
    aiUsagePercent: number;
  } {
    if (this.scanHistory.length === 0) {
      return {
        totalScans: 0,
        avgScore: 0,
        topSymbol: null,
        aiUsagePercent: 0
      };
    }

    const totalScore = this.scanHistory.reduce((sum, r) => sum + r.finalScore, 0);
    const avgScore = totalScore / this.scanHistory.length;

    const symbolCounts: Record<string, number> = {};
    for (const result of this.scanHistory) {
      const symbol = result.technicalSignal?.symbol || 'unknown';
      symbolCounts[symbol] = (symbolCounts[symbol] || 0) + 1;
    }

    const topSymbol = Object.entries(symbolCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    const withAI = this.scanHistory.filter(r => r.aiAnalysis !== null).length;
    const aiUsagePercent = (withAI / this.scanHistory.length) * 100;

    return {
      totalScans: this.scanHistory.length,
      avgScore,
      topSymbol,
      aiUsagePercent
    };
  }
}

export const intelligentMarketScanner = new IntelligentMarketScanner();
