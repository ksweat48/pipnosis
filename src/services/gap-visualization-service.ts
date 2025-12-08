/**
 * Gap Visualization Service
 *
 * Detects and categorizes gaps between candles for visualization and analysis.
 * Distinguishes between real market gaps (price jumps) and missing data gaps.
 */

import { CandleData } from './candle-data-service';

export type GapType = 'price_gap' | 'missing_data' | 'weekend' | 'low_liquidity';
export type GapVisualizationMode = 'show_all' | 'hide_weekends' | 'compress_all' | 'highlight_major';

export interface PriceGap {
  type: GapType;
  startTime: number;
  endTime: number;
  startPrice: number;
  endPrice: number;
  gapSize: number; // in pips or price units
  gapSizePercent: number;
  timeDiffMinutes: number;
  isMajor: boolean; // Gap > 1% of price
  description: string;
}

export interface GapVisualizationSettings {
  mode: GapVisualizationMode;
  highlightMajorGaps: boolean;
  showGapLabels: boolean;
  minGapSizeToShow: number; // Minimum gap size in percent to visualize
  barSpacing: number; // Pixels between bars (3-15)
}

class GapVisualizationService {
  private settings: GapVisualizationSettings = {
    mode: 'show_all',
    highlightMajorGaps: true,
    showGapLabels: false,
    minGapSizeToShow: 0.1, // 0.1% minimum
    barSpacing: 4 // Tighter spacing (default is 6)
  };

  /**
   * Detect all gaps in candle data
   */
  detectGaps(candles: CandleData[]): PriceGap[] {
    if (candles.length < 2) return [];

    const gaps: PriceGap[] = [];

    for (let i = 1; i < candles.length; i++) {
      const prevCandle = candles[i - 1];
      const currentCandle = candles[i];

      const prevClose = prevCandle.close;
      const currentOpen = currentCandle.open;
      const prevTime = typeof prevCandle.time === 'number' ? prevCandle.time : Math.floor(new Date(prevCandle.time).getTime() / 1000);
      const currentTime = typeof currentCandle.time === 'number' ? currentCandle.time : Math.floor(new Date(currentCandle.time).getTime() / 1000);

      const timeDiffMinutes = (currentTime - prevTime) / 60;
      const gapSize = Math.abs(currentOpen - prevClose);
      const gapSizePercent = (gapSize / prevClose) * 100;

      // Detect gap type
      let gapType: GapType = 'price_gap';
      let description = '';

      // Weekend gap (more than 24 hours)
      if (timeDiffMinutes > 1440) {
        gapType = 'weekend';
        description = 'Weekend market closure';
      }
      // Missing data (time gap but should have candles)
      else if (timeDiffMinutes > 10) {
        gapType = 'missing_data';
        description = `${Math.floor(timeDiffMinutes / 5)} missing candles`;
      }
      // Low liquidity gap (small time gap, big price gap)
      else if (timeDiffMinutes <= 5 && gapSizePercent > 0.05) {
        gapType = 'low_liquidity';
        description = 'Low liquidity price jump';
      }
      // Normal price gap
      else if (gapSizePercent > 0.01) {
        gapType = 'price_gap';
        description = `${gapSizePercent.toFixed(2)}% price gap`;
      } else {
        // Skip tiny gaps
        continue;
      }

      const isMajor = gapSizePercent > 0.5 || timeDiffMinutes > 60;

      gaps.push({
        type: gapType,
        startTime: prevTime,
        endTime: currentTime,
        startPrice: prevClose,
        endPrice: currentOpen,
        gapSize,
        gapSizePercent,
        timeDiffMinutes,
        isMajor,
        description
      });
    }

    return gaps;
  }

  /**
   * Filter gaps based on current visualization settings
   */
  filterGapsForDisplay(gaps: PriceGap[]): PriceGap[] {
    let filtered = gaps;

    switch (this.settings.mode) {
      case 'hide_weekends':
        filtered = gaps.filter(g => g.type !== 'weekend');
        break;
      case 'compress_all':
        filtered = []; // Don't show any gap markers when compressed
        break;
      case 'highlight_major':
        filtered = gaps.filter(g => g.isMajor);
        break;
      case 'show_all':
      default:
        filtered = gaps;
    }

    // Apply minimum gap size filter
    return filtered.filter(g =>
      g.gapSizePercent >= this.settings.minGapSizeToShow ||
      g.type === 'weekend' ||
      g.type === 'missing_data'
    );
  }

  /**
   * Get recommended bar spacing for current mode
   */
  getBarSpacing(): number {
    switch (this.settings.mode) {
      case 'compress_all':
        return 2; // Very tight spacing
      case 'hide_weekends':
        return 3; // Tight spacing
      case 'show_all':
        return 6; // Default spacing
      case 'highlight_major':
        return 4; // Slightly tighter
      default:
        return this.settings.barSpacing;
    }
  }

  /**
   * Update visualization settings
   */
  updateSettings(newSettings: Partial<GapVisualizationSettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    localStorage.setItem('gap_visualization_settings', JSON.stringify(this.settings));
  }

  /**
   * Get current settings
   */
  getSettings(): GapVisualizationSettings {
    return { ...this.settings };
  }

  /**
   * Load settings from localStorage
   */
  loadSettings(): void {
    try {
      const stored = localStorage.getItem('gap_visualization_settings');
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('[GapVisualization] Error loading settings:', error);
    }
  }

  /**
   * Generate gap statistics for display
   */
  getGapStatistics(gaps: PriceGap[]): {
    totalGaps: number;
    priceGaps: number;
    weekendGaps: number;
    missingDataGaps: number;
    majorGaps: number;
    avgGapSize: number;
    largestGap: PriceGap | null;
  } {
    const priceGaps = gaps.filter(g => g.type === 'price_gap' || g.type === 'low_liquidity').length;
    const weekendGaps = gaps.filter(g => g.type === 'weekend').length;
    const missingDataGaps = gaps.filter(g => g.type === 'missing_data').length;
    const majorGaps = gaps.filter(g => g.isMajor).length;

    const avgGapSize = gaps.length > 0
      ? gaps.reduce((sum, g) => sum + g.gapSizePercent, 0) / gaps.length
      : 0;

    const largestGap = gaps.length > 0
      ? gaps.reduce((largest, current) =>
          current.gapSizePercent > largest.gapSizePercent ? current : largest
        )
      : null;

    return {
      totalGaps: gaps.length,
      priceGaps,
      weekendGaps,
      missingDataGaps,
      majorGaps,
      avgGapSize,
      largestGap
    };
  }

  /**
   * Check if data quality is good (no unexpected gaps)
   */
  assessDataQuality(gaps: PriceGap[]): {
    isGood: boolean;
    score: number; // 0-100
    issues: string[];
    warnings: string[];
  } {
    const issues: string[] = [];
    const warnings: string[] = [];

    const missingDataGaps = gaps.filter(g => g.type === 'missing_data');
    const unexpectedGaps = gaps.filter(g =>
      g.type === 'missing_data' && g.timeDiffMinutes < 1440
    );

    if (missingDataGaps.length > 0) {
      issues.push(`${missingDataGaps.length} data gaps detected`);
    }

    if (unexpectedGaps.length > 10) {
      issues.push('High number of unexpected gaps - data quality may be poor');
    }

    const majorPriceGaps = gaps.filter(g => g.isMajor && g.type !== 'weekend');
    if (majorPriceGaps.length > 5) {
      warnings.push(`${majorPriceGaps.length} major price gaps - high volatility period`);
    }

    // Calculate quality score
    let score = 100;
    score -= missingDataGaps.length * 5; // -5 points per missing data gap
    score -= unexpectedGaps.length * 2; // -2 points per unexpected gap
    score = Math.max(0, Math.min(100, score));

    return {
      isGood: score >= 80,
      score,
      issues,
      warnings
    };
  }
}

export const gapVisualizationService = new GapVisualizationService();
