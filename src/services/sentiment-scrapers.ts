/**
 * Free Sentiment Scraper Pipeline - API-Based Version
 *
 * Scrapes 4 reliable free API sources with no CORS issues:
 * 1. Finnhub Market News (35% weight) - integrated server-side via Supabase Edge Function
 * 2. FMP Financial News (35% weight) - 250 calls/day
 * 3. Fear & Greed Index (20% weight) - no key required
 * 4. CoinGecko Trending (10% weight) - 30 calls/min, 10k/month
 *
 * Fallback sources: NewsAPI, Alpha Vantage (if primary fails)
 * All scrapers use proper APIs to avoid CORS issues.
 * 10-minute cache means ~144 calls/day maximum.
 */

import { SentimentInput } from '@/brains/omega-sentiment-brain';
import { getEnv } from '@/lib/environment';

interface ScraperResult {
  source: string;
  items: string[];
  timestamp: Date;
  error?: string;
}

class SentimentScrapers {
  private readonly TIMEOUT_MS = 10000;
  private readonly MAX_ITEMS_PER_SOURCE = 10;
  private readonly FMP_API_KEY = getEnv('VITE_FMP_API_KEY');

  /**
   * Scrape all sources and aggregate into SentimentInput
   * Primary sources: Finnhub, FMP, Fear & Greed, CoinGecko
   * Fallback sources: NewsAPI, Alpha Vantage (used if primary fails)
   */
  async scrapeAll(): Promise<SentimentInput> {
    const results = await Promise.allSettled([
      this.scrapeFinnhub(),
      this.scrapeFMPNews(),
      this.scrapeFearGreedIndex(),
      this.scrapeCoinGeckoTrending()
    ]);

    let finnhubNews = this.extractResult(results[0]);
    let fmpNews = this.extractResult(results[1]);
    const fearGreed = this.extractResult(results[2]);
    const coinGecko = this.extractResult(results[3]);

    // Fallback to alternative sources if primary news sources failed
    const primaryNewsSourcesSucceeded = finnhubNews.length > 0 || fmpNews.length > 0;

    if (!primaryNewsSourcesSucceeded) {
      console.log('[Scrapers] Primary news sources failed, trying alternatives...');
      const fallbackResults = await Promise.allSettled([
        this.scrapeNewsAPI(),
        this.scrapeAlphaVantage()
      ]);

      const newsApiHeadlines = this.extractResult(fallbackResults[0]);
      const alphaVantageHeadlines = this.extractResult(fallbackResults[1]);

      // Use fallback sources if they succeeded
      if (finnhubNews.length === 0) {
        finnhubNews = newsApiHeadlines; // Replace Finnhub with NewsAPI
      }
      if (fmpNews.length === 0) {
        fmpNews = alphaVantageHeadlines; // Replace FMP with Alpha Vantage
      }
    }

    const successfulSources: string[] = [];
    if (finnhubNews.length > 0) successfulSources.push(`Finnhub(${finnhubNews.length})`);
    if (fmpNews.length > 0) successfulSources.push(`FMP(${fmpNews.length})`);
    if (fearGreed.length > 0) successfulSources.push(`FearGreed(${fearGreed.length})`);
    if (coinGecko.length > 0) successfulSources.push(`CoinGecko(${coinGecko.length})`);

    if (successfulSources.length > 0) {
      console.log(`[Scrapers] ✓ ${successfulSources.join(', ')}`);
    }

    return {
      finnhubNews: finnhubNews.slice(0, this.MAX_ITEMS_PER_SOURCE),
      fmpNews: fmpNews.slice(0, this.MAX_ITEMS_PER_SOURCE),
      redditSignals: [], // Reddit removed - unreliable with rate limits
      fearGreedSignals: fearGreed.slice(0, 3),
      coinGeckoTrending: coinGecko.slice(0, 5)
    };
  }

  /**
   * Extract result from Promise.allSettled
   */
  private extractResult(result: PromiseSettledResult<string[]>): string[] {
    if (result.status === 'fulfilled') {
      return result.value;
    }
    // Some scrapers may fail - system gracefully degrades to working sources
    return [];
  }

  /**
   * Finnhub Market News API (via Netlify Function proxy - server-side key)
   */
  private async scrapeFinnhub(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'finnhub'
          // API key read from server-side environment
        })
      });

      const result = await response.json();

      if (!result.success || !Array.isArray(result.data)) {
        console.warn('[Finnhub] Response not successful or invalid format:', result.error);
        return [];
      }

      const headlines = result.data
        .slice(0, 10)
        .map((item: any) => this.sanitizeText(item.headline || ''))
        .filter((h: string) => h.length > 0);

      console.log(`[Finnhub] ✓ Fetched ${headlines.length} headlines`);
      return headlines;

    } catch (error) {
      console.error('[Finnhub] Failed to fetch news:', error);
      return [];
    }
  }

  /**
   * Financial Modeling Prep (FMP) News API (via Netlify Function proxy)
   */
  private async scrapeFMPNews(): Promise<string[]> {
    try {
      if (!this.FMP_API_KEY) {
        console.warn('[FMP] Missing API key');
        return [];
      }

      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'fmp',
          apiKey: this.FMP_API_KEY
        })
      });

      const result = await response.json();

      if (!result.success || !Array.isArray(result.data)) {
        console.warn('[FMP] Response not successful or invalid format:', result.error);
        return [];
      }

      const headlines = result.data
        .map((item: any) => this.sanitizeText(item.title || item.text || ''))
        .filter((h: string) => h.length > 0);

      console.log(`[FMP] ✓ Fetched ${headlines.length} headlines`);
      return headlines;

    } catch (error) {
      console.error('[FMP] Failed to fetch news:', error);
      return [];
    }
  }

  /**
   * Fear & Greed Index API (via Netlify Function proxy)
   */
  private async scrapeFearGreedIndex(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'feargreed'
        })
      });

      const result = await response.json();

      if (!result.success) {
        return [];
      }

      const data = result.data;

      if (!data?.data?.[0]) {
        return [];
      }

      const current = data.data[0];
      const value = parseInt(current.value);
      const classification = current.value_classification;

      let sentiment = '';
      if (value >= 75) {
        sentiment = `Market sentiment: EXTREME GREED (${value}/100) - High risk of correction, USD may strengthen`;
      } else if (value >= 55) {
        sentiment = `Market sentiment: GREED (${value}/100) - Bullish conditions, watch for reversal signals`;
      } else if (value >= 45) {
        sentiment = `Market sentiment: NEUTRAL (${value}/100) - Balanced market conditions`;
      } else if (value >= 25) {
        sentiment = `Market sentiment: FEAR (${value}/100) - Bearish conditions, potential buying opportunities`;
      } else {
        sentiment = `Market sentiment: EXTREME FEAR (${value}/100) - Oversold conditions, strong reversal potential`;
      }

      return [sentiment];

    } catch (error) {
      console.error('[FearGreed] Failed to fetch index:', error);
      return [];
    }
  }

  /**
   * CoinGecko Trending API (crypto market sentiment proxy) (via Netlify Function proxy)
   */
  private async scrapeCoinGeckoTrending(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'coingecko'
        })
      });

      const result = await response.json();

      if (!result.success) {
        return [];
      }

      const data = result.data;

      if (!data?.coins) {
        return [];
      }

      const trending = data.coins
        .slice(0, 5)
        .map((coin: any) => {
          const name = coin.item?.name || '';
          const rank = coin.item?.market_cap_rank || 'N/A';
          return `Crypto trending: ${name} (rank ${rank}) - Risk appetite indicator`;
        })
        .filter((s: string) => s.length > 0);

      return trending;

    } catch (error) {
      console.error('[CoinGecko] Failed to fetch trending:', error);
      return [];
    }
  }

  /**
   * Fetch with timeout
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response;

    } finally {
      clearTimeout(timeoutId);
    }
  }


  /**
   * NewsAPI - Top Business Headlines (fallback for Finnhub)
   * Free tier: 100 requests/day, good quality financial news
   */
  private async scrapeNewsAPI(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'newsapi'
        })
      });

      const result = await response.json();

      if (!result.success || !result.data?.articles) {
        console.warn('[NewsAPI] Response not successful or invalid format:', result.error);
        return [];
      }

      const headlines = result.data.articles
        .slice(0, 10)
        .map((item: any) => this.sanitizeText(item.title || ''))
        .filter((h: string) => h.length > 0);

      console.log(`[NewsAPI] ✓ Fetched ${headlines.length} headlines`);
      return headlines;

    } catch (error) {
      console.error('[NewsAPI] Failed to fetch news:', error);
      return [];
    }
  }

  /**
   * Alpha Vantage News & Sentiment (fallback for FMP)
   * Free tier: 25 requests/day, includes sentiment scores
   */
  private async scrapeAlphaVantage(): Promise<string[]> {
    try {
      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'alphavantage'
        })
      });

      const result = await response.json();

      if (!result.success || !result.data?.feed) {
        console.warn('[AlphaVantage] Response not successful or invalid format:', result.error);
        return [];
      }

      const headlines = result.data.feed
        .slice(0, 10)
        .map((item: any) => {
          const title = this.sanitizeText(item.title || '');
          // Include sentiment score if available
          const sentiment = item.overall_sentiment_score;
          if (sentiment !== undefined) {
            const sentimentLabel = sentiment > 0.15 ? 'bullish' : sentiment < -0.15 ? 'bearish' : 'neutral';
            return `${title} [${sentimentLabel}]`;
          }
          return title;
        })
        .filter((h: string) => h.length > 0);

      console.log(`[AlphaVantage] ✓ Fetched ${headlines.length} headlines with sentiment`);
      return headlines;

    } catch (error) {
      console.error('[AlphaVantage] Failed to fetch news:', error);
      return [];
    }
  }

  /**
   * Sanitize text (remove HTML, trim, clean)
   */
  private sanitizeText(text: string): string {
    return text
      .replace(/<[^>]+>/g, '') // Remove HTML tags
      .replace(/&[a-z]+;/gi, ' ') // Remove remaining entities
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim()
      .slice(0, 200); // Max 200 chars per headline
  }
}

export const sentimentScrapers = new SentimentScrapers();
