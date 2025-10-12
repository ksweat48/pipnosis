import { Candle } from '../../lib/indicators';
import { FxFlowScalperV2, MultiTimeframeCandles } from './fxFlowScalperV2';
import { OpportunityRanking, PromptAnalysis, StrategyEvaluation } from '../types';
import { marketDataService } from '../../services/market-data';
import { Timeframe } from '../../services/metaapi';

const MAJOR_PAIRS = [
  'EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF',
  'AUDUSD', 'USDCAD', 'NZDUSD',
  'EURJPY', 'GBPJPY', 'EURGBP',
  'AUDJPY', 'EURAUD', 'EURCHF',
  'AUDNZD', 'NZDJPY', 'GBPAUD'
];

export class MultiSymbolScanner {
  private strategy: FxFlowScalperV2;

  constructor() {
    this.strategy = new FxFlowScalperV2();
  }

  async analyzePrompt(prompt: string): Promise<PromptAnalysis> {
    const lowerPrompt = prompt.toLowerCase();

    let intent: 'find_trade' | 'analyze_market' | 'check_signal' = 'find_trade';
    if (lowerPrompt.includes('analyze') || lowerPrompt.includes('market')) {
      intent = 'analyze_market';
    } else if (lowerPrompt.includes('check') || lowerPrompt.includes('signal')) {
      intent = 'check_signal';
    }

    let bias: 'bullish' | 'bearish' | 'any' = 'any';
    if (lowerPrompt.includes('buy') || lowerPrompt.includes('long') || lowerPrompt.includes('bullish')) {
      bias = 'bullish';
    } else if (lowerPrompt.includes('sell') || lowerPrompt.includes('short') || lowerPrompt.includes('bearish')) {
      bias = 'bearish';
    }

    const symbols: string[] = [];
    for (const pair of MAJOR_PAIRS) {
      if (lowerPrompt.includes(pair.toLowerCase())) {
        symbols.push(pair);
      }
    }

    let riskTolerance: 'low' | 'medium' | 'high' = 'medium';
    if (lowerPrompt.includes('safe') || lowerPrompt.includes('conservative') || lowerPrompt.includes('low risk')) {
      riskTolerance = 'low';
    } else if (lowerPrompt.includes('aggressive') || lowerPrompt.includes('high risk')) {
      riskTolerance = 'high';
    }

    const timeWindow = 60;

    return {
      intent,
      bias,
      symbols: symbols.length > 0 ? symbols : MAJOR_PAIRS,
      timeframe: '1M',
      riskTolerance,
      timeWindow
    };
  }

  async scanAllSymbols(
    promptAnalysis: PromptAnalysis
  ): Promise<OpportunityRanking[]> {
    const opportunities: OpportunityRanking[] = [];
    const symbolsToScan = promptAnalysis.symbols || MAJOR_PAIRS;

    console.log(`🔍 Scanning ${symbolsToScan.length} symbols for trade opportunities...`);

    for (const symbol of symbolsToScan) {
      try {
        const candles = await this.fetchMultiTimeframeData(symbol);

        let evaluation: StrategyEvaluation;

        if (promptAnalysis.bias === 'bullish') {
          evaluation = await this.strategy.evaluateForDirection(symbol, candles, 'BUY');
        } else if (promptAnalysis.bias === 'bearish') {
          evaluation = await this.strategy.evaluateForDirection(symbol, candles, 'SELL');
        } else {
          evaluation = await this.strategy.evaluateStrategy(symbol, candles);
        }

        if (evaluation.trade) {
          const score = this.calculateOpportunityScore(
            evaluation,
            promptAnalysis
          );

          opportunities.push({
            symbol,
            signal: evaluation.trade,
            score,
            reasons: evaluation.trade.reasoning,
            rank: 0
          });
        }
      } catch (error) {
        console.warn(`Failed to scan ${symbol}:`, error);
      }
    }

    opportunities.sort((a, b) => b.score - a.score);
    opportunities.forEach((opp, index) => {
      opp.rank = index + 1;
    });

    console.log(`✅ Found ${opportunities.length} valid opportunities`);

    return opportunities.slice(0, 3);
  }

  async findBestOpportunity(prompt: string): Promise<OpportunityRanking | null> {
    const promptAnalysis = await this.analyzePrompt(prompt);
    const opportunities = await this.scanAllSymbols(promptAnalysis);

    if (opportunities.length === 0) {
      return null;
    }

    return opportunities[0];
  }

  private async fetchMultiTimeframeData(symbol: string): Promise<MultiTimeframeCandles> {
    try {
      const [h1Candles, m5Candles, m1Candles] = await Promise.all([
        marketDataService.getHistoricalData(symbol, 'H1' as Timeframe, 50, true, true),
        marketDataService.getHistoricalData(symbol, 'M5' as Timeframe, 100, true, true),
        marketDataService.getHistoricalData(symbol, 'M1' as Timeframe, 100, true, true)
      ]);

      return {
        h1: h1Candles as Candle[],
        m5: m5Candles as Candle[],
        m1: m1Candles as Candle[]
      };
    } catch (error) {
      console.error(`Error fetching multi-timeframe data for ${symbol}:`, error);
      throw error;
    }
  }

  private calculateOpportunityScore(
    evaluation: StrategyEvaluation,
    promptAnalysis: PromptAnalysis
  ): number {
    if (!evaluation.trade) {
      return 0;
    }

    let score = evaluation.trade.confidence;

    if (promptAnalysis.bias !== 'any') {
      const biasMatches = (
        (promptAnalysis.bias === 'bullish' && evaluation.trade.direction === 'BUY') ||
        (promptAnalysis.bias === 'bearish' && evaluation.trade.direction === 'SELL')
      );

      if (biasMatches) {
        score += 10;
      }
    }

    if (evaluation.trade.riskReward >= 2) {
      score += 5;
    }

    if (evaluation.conditions.macro && evaluation.conditions.tactical && evaluation.conditions.entry) {
      score += 15;
    }

    if (promptAnalysis.riskTolerance === 'low' && evaluation.trade.confidence >= 85) {
      score += 10;
    } else if (promptAnalysis.riskTolerance === 'high' && evaluation.trade.confidence >= 70) {
      score += 5;
    }

    return Math.min(score, 100);
  }
}

export const multiSymbolScanner = new MultiSymbolScanner();
