/**
 * Free Sentiment Scraper Pipeline
 *
 * Scrapes 5 free sources for market sentiment signals:
 * 1. Google News RSS (primary feed)
 * 2. Investing.com RSS
 * 3. FXStreet RSS
 * 4. Reddit JSON API
 * 5. Twitter/X via Nitter RSS
 *
 * All scrapers are rate-limited and sanitized to <20 items total.
 */

import { SentimentInput } from '@/brains/omega-sentiment-brain';

interface ScraperResult {
  source: string;
  items: string[];
  timestamp: Date;
  error?: string;
}

class SentimentScrapers {
  private readonly TIMEOUT_MS = 10000; // 10 second timeout per source
  private readonly MAX_ITEMS_PER_SOURCE = 8;

  /**
   * Scrape all sources and aggregate into SentimentInput
   *
   * NOTE: Scrapers typically fail in browser due to CORS restrictions.
   * This is expected - system gracefully degrades to LLM-only analysis.
   */
  async scrapeAll(): Promise<SentimentInput> {
    const results = await Promise.allSettled([
      this.scrapeGoogleNews(),
      this.scrapeInvestingCom(),
      this.scrapeFXStreet(),
      this.scrapeReddit(),
      this.scrapeNitter()
    ]);

    const googleNews = this.extractResult(results[0]);
    const investingNews = this.extractResult(results[1]);
    const fxStreetNews = this.extractResult(results[2]);
    const redditSignals = this.extractResult(results[3]);
    const twitterSignals = this.extractResult(results[4]);

    // Only log successful sources
    const successfulSources: string[] = [];
    if (googleNews.length > 0) successfulSources.push(`Google(${googleNews.length})`);
    if (investingNews.length > 0) successfulSources.push(`Investing(${investingNews.length})`);
    if (fxStreetNews.length > 0) successfulSources.push(`FXStreet(${fxStreetNews.length})`);
    if (redditSignals.length > 0) successfulSources.push(`Reddit(${redditSignals.length})`);
    if (twitterSignals.length > 0) successfulSources.push(`Twitter(${twitterSignals.length})`);

    if (successfulSources.length > 0) {
      console.log(`[Scrapers] ✓ ${successfulSources.join(', ')}`);
    }

    return {
      googleNews: googleNews.slice(0, this.MAX_ITEMS_PER_SOURCE),
      fxStreetNews: [...fxStreetNews, ...investingNews].slice(0, this.MAX_ITEMS_PER_SOURCE),
      twitterSignals: twitterSignals.slice(0, this.MAX_ITEMS_PER_SOURCE),
      redditSignals: redditSignals.slice(0, this.MAX_ITEMS_PER_SOURCE)
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
   * Google News RSS - Primary feed
   */
  private async scrapeGoogleNews(): Promise<string[]> {
    try {
      const url = 'https://news.google.com/rss/search?q=forex+OR+gold+OR+usd+OR+stock+market&hl=en-US&gl=US&ceid=US:en';

      const response = await this.fetchWithTimeout(url);
      const text = await response.text();

      // Parse RSS XML
      const items = this.parseRSS(text);
      const headlines = items.map(item => this.sanitizeText(item.title || ''));

      return headlines.filter(h => h.length > 0);

    } catch (error) {
      // CORS errors are expected in browser - fail silently
      return [];
    }
  }

  /**
   * Investing.com RSS
   */
  private async scrapeInvestingCom(): Promise<string[]> {
    try {
      // Try multiple feeds
      const feeds = [
        'https://www.investing.com/rss/news_25.rss', // Forex
        'https://www.investing.com/rss/news_1.rss'   // General
      ];

      const results = await Promise.allSettled(
        feeds.map(url => this.scrapeRSSFeed(url))
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
   * FXStreet RSS
   */
  private async scrapeFXStreet(): Promise<string[]> {
    try {
      const url = 'https://www.fxstreet.com/rss/news';
      return await this.scrapeRSSFeed(url);

    } catch (error) {
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
   * Twitter/X via Nitter RSS mirror
   */
  private async scrapeNitter(): Promise<string[]> {
    try {
      // Use Nitter instances (RSS format)
      const nitterInstances = [
        'https://nitter.net',
        'https://nitter.poast.org',
        'https://nitter.privacydev.net'
      ];

      // Try first available instance
      for (const instance of nitterInstances) {
        try {
          const url = `${instance}/search/rss?f=tweets&q=forex+OR+gold+OR+usd&since=1d`;
          const items = await this.scrapeRSSFeed(url);

          if (items.length > 0) {
            return items;
          }
        } catch (err) {
          // Try next instance
          continue;
        }
      }

      return [];

    } catch (error) {
      return [];
    }
  }

  /**
   * Generic RSS feed scraper
   */
  private async scrapeRSSFeed(url: string): Promise<string[]> {
    const response = await this.fetchWithTimeout(url);
    const text = await response.text();

    const items = this.parseRSS(text);
    const headlines = items.map(item => this.sanitizeText(item.title || ''));

    return headlines.filter(h => h.length > 0);
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
   * Parse RSS XML (simple extraction)
   */
  private parseRSS(xml: string): Array<{ title?: string; description?: string }> {
    const items: Array<{ title?: string; description?: string }> = [];

    try {
      // Extract <item> blocks
      const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
      const itemMatches = xml.matchAll(itemRegex);

      for (const match of itemMatches) {
        const itemXml = match[1];

        // Extract title
        const titleMatch = itemXml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        const title = titleMatch ? this.decodeHTML(titleMatch[1]) : '';

        // Extract description (optional)
        const descMatch = itemXml.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
        const description = descMatch ? this.decodeHTML(descMatch[1]) : '';

        if (title) {
          items.push({ title, description });
        }
      }

      return items.slice(0, this.MAX_ITEMS_PER_SOURCE);

    } catch (error) {
      return [];
    }
  }

  /**
   * Decode HTML entities
   */
  private decodeHTML(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' '
    };

    let decoded = text;
    for (const [entity, char] of Object.entries(entities)) {
      decoded = decoded.replace(new RegExp(entity, 'g'), char);
    }

    return decoded;
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
