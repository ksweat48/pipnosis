/**
 * Session Intelligence Populator - SSOT for Trading Session Analysis
 *
 * Authority: Determines which trading session is active and which pairs are optimal
 *
 * Runs every hour to analyze current market conditions and provide
 * advisory intelligence to users. This is purely educational and does not
 * affect Alpha's autonomous trading decisions.
 *
 * Architecture:
 * 1. Determine current trading session (London/NY/Asian) based on EST time
 * 2. Analyze market conditions (trending/ranging/volatile/quiet)
 * 3. Rank top 5 pairs for the current session with reasoning
 * 4. Insert data into session_intelligence_data with 2-hour expiration
 *
 * Sessions (EST):
 * - London: 3:00 AM - 12:00 PM EST
 * - New York: 8:00 AM - 5:00 PM EST
 * - Asian: 7:00 PM - 4:00 AM EST
 */

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

interface SessionInfo {
  name: 'London' | 'New York' | 'Asian';
  startHour: number;
  endHour: number;
}

interface BestPair {
  symbol: string;
  confidence: number;
  reasoning: string;
}

function getCurrentSession(): SessionInfo {
  const now = new Date();
  const hour = now.getUTCHours() - 5; // Convert to EST (UTC-5)
  const estHour = hour < 0 ? hour + 24 : hour;

  // London: 3:00 AM - 12:00 PM EST (most liquid)
  if (estHour >= 3 && estHour < 12) {
    return { name: 'London', startHour: 3, endHour: 12 };
  }

  // New York: 8:00 AM - 5:00 PM EST (overlap with London 8-12)
  if (estHour >= 8 && estHour < 17) {
    return { name: 'New York', startHour: 8, endHour: 17 };
  }

  // Asian: 7:00 PM - 4:00 AM EST (quieter, crypto active)
  return { name: 'Asian', startHour: 19, endHour: 4 };
}

async function analyzeMarketConditions(): Promise<{
  condition: 'trending' | 'ranging' | 'volatile' | 'quiet' | 'sideways';
  isTradable: boolean;
}> {
  // Query recent price data to determine market conditions
  // For now, use time-based heuristics (will enhance with real analysis later)

  const session = getCurrentSession();
  const isLondonOrNY = session.name === 'London' || session.name === 'New York';

  // London/NY sessions are typically more tradable
  if (isLondonOrNY) {
    return {
      condition: 'trending',
      isTradable: true
    };
  }

  // Asian session can be quieter but still tradable
  return {
    condition: 'ranging',
    isTradable: true
  };
}

function getRankedPairs(session: SessionInfo, condition: string): BestPair[] {
  // Session-specific pair recommendations based on liquidity and activity
  // SSOT: Only recommend pairs from the official 9-pair watchlist
  // Official watchlist: XAUUSD, US30, NAS100, SPX500, EURUSD, GBPUSD, USDJPY, BTCUSD, ETHUSD

  if (session.name === 'London') {
    return [
      {
        symbol: 'EURUSD',
        confidence: 95,
        reasoning: 'London session peak liquidity. EUR pairs typically show strong directional moves during European trading hours.'
      },
      {
        symbol: 'GBPUSD',
        confidence: 92,
        reasoning: 'Cable is most active during London session. High volatility provides clear technical setups.'
      },
      {
        symbol: 'XAUUSD',
        confidence: 88,
        reasoning: 'Gold reacts to European economic data. Safe-haven flows during London session.'
      },
      {
        symbol: 'USDJPY',
        confidence: 85,
        reasoning: 'London-Tokyo overlap creates trading opportunities. Risk-on/risk-off sentiment driver.'
      },
      {
        symbol: 'US30',
        confidence: 82,
        reasoning: 'Dow Jones index active during London-NY overlap. US futures trading begins during European hours.'
      }
    ];
  }

  if (session.name === 'New York') {
    return [
      {
        symbol: 'US30',
        confidence: 95,
        reasoning: 'Dow Jones most active during NY session. Major economic data releases drive clear directional moves.'
      },
      {
        symbol: 'SPX500',
        confidence: 93,
        reasoning: 'S&P 500 peak liquidity during NY hours. Fed policy and US data key drivers.'
      },
      {
        symbol: 'NAS100',
        confidence: 90,
        reasoning: 'NASDAQ tech sector volatility highest during NY session. Strong momentum patterns.'
      },
      {
        symbol: 'EURUSD',
        confidence: 87,
        reasoning: 'Most liquid forex pair during NY session. High volume provides quality entry opportunities.'
      },
      {
        symbol: 'XAUUSD',
        confidence: 84,
        reasoning: 'Gold reacts to US dollar strength and Fed commentary. NY session volatility creates opportunities.'
      }
    ];
  }

  // Asian session
  return [
    {
      symbol: 'USDJPY',
      confidence: 92,
      reasoning: 'Tokyo session peak activity. Japanese economic data and risk sentiment drive moves.'
    },
    {
      symbol: 'BTCUSD',
      confidence: 88,
      reasoning: 'Crypto markets 24/7. Asian session often shows momentum continuation patterns.'
    },
    {
      symbol: 'ETHUSD',
      confidence: 85,
      reasoning: 'Ethereum follows Bitcoin patterns. 24/7 liquidity during quieter forex hours.'
    },
    {
      symbol: 'XAUUSD',
      confidence: 82,
      reasoning: 'Gold trades actively during Asian hours. Safe-haven flows from Asian market participants.'
    },
    {
      symbol: 'EURUSD',
      confidence: 78,
      reasoning: 'EUR pairs show technical setups during Asian session. Lower volatility allows precise entries.'
    }
  ];
}

export const handler: Handler = async (event) => {
  console.log('[SessionIntelligence] Starting session analysis...');

  try {
    // Determine current session
    const session = getCurrentSession();
    console.log(`[SessionIntelligence] Current session: ${session.name} (${session.startHour}:00 - ${session.endHour}:00 EST)`);

    // Analyze market conditions
    const { condition, isTradable } = await analyzeMarketConditions();
    console.log(`[SessionIntelligence] Market condition: ${condition}, Tradable: ${isTradable}`);

    // Get ranked pairs for this session
    const bestPairs = getRankedPairs(session, condition);

    // Generate recommendation text
    let recommendationText = '';
    if (isTradable) {
      recommendationText = `${session.name} session is active with ${condition} conditions. Focus on ${bestPairs[0].symbol} and ${bestPairs[1].symbol} for highest probability setups.`;
    } else {
      recommendationText = `${session.name} session showing ${condition} conditions. Consider waiting for clearer market direction or reduced volatility.`;
    }

    // Insert into database (expires in 2 hours)
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 2);

    const { error: insertError } = await supabase
      .from('session_intelligence_data')
      .insert({
        session_name: session.name,
        session_start_hour: session.startHour,
        session_end_hour: session.endHour,
        best_pairs: bestPairs,
        market_condition: condition,
        is_tradable: isTradable,
        recommendation_text: recommendationText,
        expires_at: expiresAt.toISOString()
      });

    if (insertError) {
      console.error('[SessionIntelligence] Error inserting session data:', insertError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to insert session data' })
      };
    }

    console.log('[SessionIntelligence] Successfully updated session intelligence');
    console.log(`[SessionIntelligence] Top pair: ${bestPairs[0].symbol} (${bestPairs[0].confidence}%)`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        session: session.name,
        condition,
        topPairs: bestPairs.slice(0, 3).map(p => p.symbol)
      })
    };

  } catch (error) {
    console.error('[SessionIntelligence] Fatal error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' })
    };
  }
};
