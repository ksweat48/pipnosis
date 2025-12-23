/**
 * Free Sentiment Scraper Pipeline - API-Based Version
 *
 * Scrapes 5 reliable free API sources with no CORS issues:
 * 1. Finnhub Market News (30% weight) - using existing API
 * 2. FMP Financial News (30% weight) - 250 calls/day
 * 3. Reddit JSON API (20% weight) - no key required
 * 4. Fear & Greed Index (15% weight) - no key required
 * 5. CoinGecko Trending (5% weight) - 30 calls/min, 10k/month
 *
 * All scrapers use proper APIs to avoid CORS issues.
 * 10-minute cache means ~144 calls/day maximum.
 */

import { SentimentInput } from '@/brains/omega-sentiment-brain';

interface ScraperResult {
  source: string;
  items: string[];
  timestamp: Date;
  error?: string;
}

class SentimentScrapers {
  private readonly TIMEOUT_MS = 10000;
  private readonly MAX_ITEMS_PER_SOURCE = 10;
  private readonly FMP_API_KEY = import.meta.env.VITE_FMP_API_KEY || '';
  private readonly FINNHUB_API_KEY = import.meta.env.VITE_FINNHUB_API_KEY || '';

  /**
   * Scrape all sources and aggregate into SentimentInput
   */
  async scrapeAll(): Promise<SentimentInput> {
    const results = await Promise.allSettled([
      this.scrapeFinnhub(),
      this.scrapeFMPNews(),
      this.scrapeReddit(),
      this.scrapeFearGreedIndex(),
      this.scrapeCoinGeckoTrending()
    ]);

    const finnhubNews = this.extractResult(results[0]);
    const fmpNews = this.extractResult(results[1]);
    const redditSignals = this.extractResult(results[2]);
    const fearGreed = this.extractResult(results[3]);
    const coinGecko = this.extractResult(results[4]);

    const successfulSources: string[] = [];
    if (finnhubNews.length > 0) successfulSources.push(`Finnhub(${finnhubNews.length})`);
    if (fmpNews.length > 0) successfulSources.push(`FMP(${fmpNews.length})`);
    if (redditSignals.length > 0) successfulSources.push(`Reddit(${redditSignals.length})`);
    if (fearGreed.length > 0) successfulSources.push(`FearGreed(${fearGreed.length})`);
    if (coinGecko.length > 0) successfulSources.push(`CoinGecko(${coinGecko.length})`);

    if (successfulSources.length > 0) {
      console.log(`[Scrapers] ✓ ${successfulSources.join(', ')}`);
    }

    return {
      finnhubNews: finnhubNews.slice(0, this.MAX_ITEMS_PER_SOURCE),
      fmpNews: fmpNews.slice(0, this.MAX_ITEMS_PER_SOURCE),
      redditSignals: redditSignals.slice(0, this.MAX_ITEMS_PER_SOURCE),
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
    // Scrapers expected to fail in browser due to CORS - this is normal
    // System gracefully degrades to working sources (Reddit)
    return [];
  }

  /**
   * Finnhub Market News API (via Netlify Function proxy)
   */
  private async scrapeFinnhub(): Promise<string[]> {
    try {
      if (!this.FINNHUB_API_KEY) {
        return [];
      }

      const response = await this.fetchWithTimeout('/.netlify/functions/sentiment-proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'finnhub',
          apiKey: this.FINNHUB_API_KEY
        })
      });

      const result = await response.json();

      if (!result.success || !Array.isArray(result.data)) {
        return [];
      }

      const headlines = result.data
        .slice(0, 10)
        .map((item: any) => this.sanitizeText(item.headline || ''))
        .filter((h: string) => h.length > 0);

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
        return [];
      }

      const headlines = result.data
        .map((item: any) => this.sanitizeText(item.title || ''))
        .filter((h: string) => h.length > 0);

      return headlines;

    } catch (error) {
      console.error('[FMP] Failed to fetch news:', error);
      return [];
    }
  }

  /**
   * Fear & Greed Index API
   */
  private async scrapeFearGreedIndex(): Promise<string[]> {
    try {
      const url = 'https://api.alternative.me/fng/?limit=1';
      const response = await this.fetchWithTimeout(url);
      const data = await response.json();

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
   * CoinGecko Trending API (crypto market sentiment proxy)
   */
  private async scrapeCoinGeckoTrending(): Promise<string[]> {
    try {
      const url = 'https://api.coingecko.com/api/v3/search/trending';
      const response = await this.fetchWithTimeout(url);
      const data = await response.json();

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
   * Reddit JSON API
   */
  private async scrapeReddit(): Promise<string[]> {
    try {
      const subreddits = [
        'https://www.reddit.com/r/Forex/top.json?limit=5&t=day',
        'https://www.reddit.com/r/Gold/top.json?limit=5&t=day',
        'https://www.reddit.com/r/wallstreetbets/top.json?limit=5&t=day'
      ];

      const results = await Promise.allSettled(
        subreddits.map(url => this.scrapeRedditFeed(url))
      );

      const allItems = results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => (r as PromiseFulfilledResult<string[]>).value);

      return allItems.slice(0, this.MAX_ITEMS_PER_SOURCE);

    } catch (error) {
      return [];
    }
  }


  /**
   * Scrape Reddit JSON feed
   */
  private async scrapeRedditFeed(url: string): Promise<string[]> {
    const response = await this.fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)'
      }
    });

    const json = await response.json();

    const posts = json?.data?.children || [];
    const titles = posts
      .map((post: any) => post?.data?.title || '')
      .filter((title: string) => title.length > 0)
      .map((title: string) => this.sanitizeText(title));

    return titles;
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
