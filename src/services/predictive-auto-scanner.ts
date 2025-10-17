import { supabase } from '@/lib/supabase';
import { marketDataService } from './market-data';
import { consolidatedPairAnalysisService } from './consolidated-pair-analysis';
import { aiPairPredictionService, PairPrediction } from './ai-pair-prediction';
import { thoughtProcessLogger } from './thought-process-logger';
import { Timeframe } from './metaapi';

export interface PredictiveScanResult {
  opportunityFound: boolean;
  predictions: PairPrediction[];
  readyPairs: string[];
  closePairs: string[];
  farPairs: string[];
  message: string;
  scanDuration: number;
}

class PredictiveAutoScanner {
  async performPredictiveScan(
    userId: string,
    symbols: string[],
    sessionId: string,
    decisionId: string,
    timeframe: string = 'M15'
  ): Promise<PredictiveScanResult> {
    const scanStartTime = Date.now();
    const predictions: PairPrediction[] = [];
    const scanCycleId = `scan-${Date.now()}`;
    let stepNumber = 0;

    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│              🎯 PREDICTIVE SCAN CYCLE STARTED                         │');
    console.log('└─────────────────────────────────────────────────────────────────────┘');

    await thoughtProcessLogger.logThought({
      userId,
      decisionId,
      stepNumber: ++stepNumber,
      stepType: 'symbol_scan',
      title: '🔍 Predictive Multi-Pair Analysis Started',
      content: `Analyzing ${symbols.length} pairs with AI prediction engine\n\nPairs: ${symbols.join(', ')}\n\nUsing consolidated analysis with time-to-entry predictions`,
      metadata: { symbols, scanType: 'predictive', scanCycleId }
    }, sessionId);

    for (const symbol of symbols) {
      try {
        console.log(`[PredictiveScanner] Analyzing ${symbol}...`);

        const candles = await marketDataService.getHistoricalData(
          symbol,
          timeframe as Timeframe,
          100,
          true,
          true
        );

        if (candles.length < 50) {
          console.warn(`[PredictiveScanner] Insufficient candles for ${symbol}, skipping`);
          continue;
        }

        const analysis = await consolidatedPairAnalysisService.analyzePair(
          symbol,
          candles,
          userId,
          sessionId,
          timeframe
        );

        const prediction = await aiPairPredictionService.createPrediction(
          userId,
          symbol,
          analysis.snapshot,
          analysis.marketSummary,
          sessionId,
          scanCycleId
        );

        predictions.push(prediction);

        const readinessIcon = this.getReadinessIcon(prediction.readinessStatus);
        const timeMessage = this.getTimeMessage(prediction);

        await thoughtProcessLogger.logThought({
          userId,
          decisionId,
          stepNumber: ++stepNumber,
          stepType: 'pair_analysis_consolidated',
          title: `${readinessIcon} ${symbol} - Complete Analysis`,
          content: `${analysis.displaySummary}\n\n${'─'.repeat(50)}\n\n${thoughtProcessLogger.formatPredictionSummary(prediction)}\n\n${thoughtProcessLogger.formatPairConditions(prediction.conditionsRequired)}\n\n${timeMessage}`,
          metadata: {
            symbol,
            readinessStatus: prediction.readinessStatus,
            readinessPercentage: prediction.readinessPercentage,
            estimatedMinutesToEntry: prediction.estimatedMinutesToEntry,
            predictionId: prediction.id,
            analysis: analysis.snapshot,
            prediction
          }
        }, sessionId);

        console.log(`[PredictiveScanner] ${symbol} analysis complete - ${prediction.readinessStatus} (${prediction.readinessPercentage.toFixed(0)}%)`);

      } catch (error: any) {
        console.error(`[PredictiveScanner] Error analyzing ${symbol}:`, error);

        await thoughtProcessLogger.logThought({
          userId,
          decisionId,
          stepNumber: ++stepNumber,
          stepType: 'error',
          title: `❌ ${symbol} - Analysis Failed`,
          content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}\n\nContinuing with remaining symbols...`,
          metadata: { symbol, error: error.message }
        }, sessionId);
      }
    }

    const readyPairs = predictions.filter(p => p.readinessStatus === 'ready').map(p => p.symbol);
    const closePairs = predictions.filter(p => p.readinessStatus === 'close').map(p => p.symbol);
    const farPairs = predictions.filter(p => p.readinessStatus === 'far').map(p => p.symbol);

    const summary = this.buildScanSummary(predictions, readyPairs, closePairs, farPairs);

    await thoughtProcessLogger.logThought({
      userId,
      decisionId,
      stepNumber: ++stepNumber,
      stepType: 'symbol_scan',
      title: '✅ Predictive Scan Complete',
      content: summary,
      metadata: {
        totalPairs: predictions.length,
        readyCount: readyPairs.length,
        closeCount: closePairs.length,
        farCount: farPairs.length,
        predictions: predictions.map(p => ({
          symbol: p.symbol,
          readiness: p.readinessStatus,
          minutesToEntry: p.estimatedMinutesToEntry
        }))
      }
    }, sessionId);

    const opportunityFound = readyPairs.length > 0;

    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log(`│              ${opportunityFound ? '✅ OPPORTUNITIES FOUND' : '⚪ NO IMMEDIATE OPPORTUNITIES'}                         │`);
    console.log('└─────────────────────────────────────────────────────────────────────┘');
    console.log(`[PredictiveScanner] Ready: ${readyPairs.length}, Close: ${closePairs.length}, Far: ${farPairs.length}`);
    console.log(`[PredictiveScanner] Scan duration: ${Date.now() - scanStartTime}ms`);

    return {
      opportunityFound,
      predictions,
      readyPairs,
      closePairs,
      farPairs,
      message: opportunityFound
        ? `${readyPairs.length} pair(s) ready for entry: ${readyPairs.join(', ')}`
        : closePairs.length > 0
        ? `${closePairs.length} pair(s) approaching entry conditions`
        : 'No viable opportunities in current market conditions',
      scanDuration: Date.now() - scanStartTime
    };
  }

  async scheduleDynamicScans(predictions: PairPrediction[], userId: string): Promise<void> {
    for (const prediction of predictions) {
      if (prediction.nextScanScheduledAt) {
        console.log(`[PredictiveScanner] Scheduling next scan for ${prediction.symbol} at ${prediction.nextScanScheduledAt.toLocaleTimeString()}`);
      }
    }
  }

  async updatePrediction(
    predictionId: string,
    userId: string,
    symbol: string,
    timeframe: string = 'M15'
  ): Promise<PairPrediction | null> {
    try {
      const candles = await marketDataService.getHistoricalData(
        symbol,
        timeframe as Timeframe,
        100,
        true,
        true
      );

      if (candles.length < 50) {
        console.warn(`[PredictiveScanner] Insufficient candles for ${symbol} update`);
        return null;
      }

      const analysis = await consolidatedPairAnalysisService.analyzePair(
        symbol,
        candles,
        userId,
        undefined,
        timeframe
      );

      const updatedPrediction = await aiPairPredictionService.updatePrediction(
        predictionId,
        analysis.snapshot,
        analysis.marketSummary
      );

      console.log(`[PredictiveScanner] Updated prediction for ${symbol} - ${updatedPrediction.readinessStatus} (${updatedPrediction.readinessPercentage.toFixed(0)}%)`);

      return updatedPrediction;
    } catch (error) {
      console.error(`[PredictiveScanner] Error updating prediction for ${symbol}:`, error);
      return null;
    }
  }

  private getReadinessIcon(status: string): string {
    switch (status) {
      case 'ready': return '🟢';
      case 'close': return '🟡';
      case 'far': return '⚪';
      case 'not_viable': return '⚫';
      default: return '⚪';
    }
  }

  private getTimeMessage(prediction: PairPrediction): string {
    const minutes = prediction.estimatedMinutesToEntry;

    if (prediction.readinessStatus === 'ready') {
      return `⏰ ENTRY WINDOW ACTIVE - Conditions aligned for immediate entry`;
    } else if (prediction.readinessStatus === 'close') {
      return `⏰ Entry predicted in approximately ${minutes} minutes - Monitoring closely`;
    } else if (minutes > 30) {
      return `⏰ Potential entry more than 30min away - Will rescan in 20 minutes`;
    } else if (prediction.readinessStatus === 'far') {
      return `⏰ Entry predicted in ~${minutes} minutes - Conditions still developing`;
    } else {
      return `⏰ Market conditions not favorable for entry`;
    }
  }

  private buildScanSummary(
    predictions: PairPrediction[],
    readyPairs: string[],
    closePairs: string[],
    farPairs: string[]
  ): string {
    const lines = [];

    lines.push(`📊 Scan Summary: ${predictions.length} pairs analyzed`);
    lines.push('');

    if (readyPairs.length > 0) {
      lines.push(`🟢 READY FOR ENTRY (${readyPairs.length}):`);
      readyPairs.forEach(symbol => {
        const pred = predictions.find(p => p.symbol === symbol)!;
        lines.push(`   ${symbol}: ${pred.readinessPercentage.toFixed(0)}% ready, ${pred.predictedDirection || 'N/A'} signal`);
      });
      lines.push('');
    }

    if (closePairs.length > 0) {
      lines.push(`🟡 APPROACHING ENTRY (${closePairs.length}):`);
      closePairs.forEach(symbol => {
        const pred = predictions.find(p => p.symbol === symbol)!;
        lines.push(`   ${symbol}: ${pred.readinessPercentage.toFixed(0)}% ready, ~${pred.estimatedMinutesToEntry}min to entry`);
      });
      lines.push('');
    }

    if (farPairs.length > 0) {
      lines.push(`⚪ CONDITIONS PENDING (${farPairs.length}):`);
      farPairs.forEach(symbol => {
        const pred = predictions.find(p => p.symbol === symbol)!;
        const timeMsg = pred.estimatedMinutesToEntry > 30 ? '>30min' : `~${pred.estimatedMinutesToEntry}min`;
        lines.push(`   ${symbol}: ${pred.readinessPercentage.toFixed(0)}% ready, ${timeMsg} to entry`);
      });
      lines.push('');
    }

    const notViable = predictions.filter(p => p.readinessStatus === 'not_viable');
    if (notViable.length > 0) {
      lines.push(`⚫ NOT VIABLE (${notViable.length}): ${notViable.map(p => p.symbol).join(', ')}`);
      lines.push('');
    }

    if (readyPairs.length === 0 && closePairs.length === 0) {
      lines.push('No immediate trading opportunities found.');
      lines.push('The AI will continue monitoring and will alert you when conditions align.');
    } else if (readyPairs.length > 0) {
      lines.push('✅ High-confidence opportunities detected - ready for execution!');
    } else {
      lines.push('⏳ Opportunities developing - monitoring closely for entry windows');
    }

    return lines.join('\n');
  }
}

export const predictiveAutoScanner = new PredictiveAutoScanner();
