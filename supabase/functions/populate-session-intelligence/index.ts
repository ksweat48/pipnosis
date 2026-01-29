import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PairScore {
  symbol: string;
  confidence: number;
  status: "ready" | "heating" | "monitoring";
  indicatorAlignment?: Record<string, boolean>;
  tradeConfidence?: number;
}

interface SessionIntelligence {
  session_name: string;
  session_start_hour: number;
  session_end_hour: number;
  market_condition: "trending" | "volatile" | "ranging" | "quiet";
  is_tradable: boolean;
  top_pairs: PairScore[];
  heating_pairs: PairScore[];
  all_pair_scores: PairScore[];
  recommendation_text: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("[Session Intelligence] Starting population...");

    const now = new Date();
    const currentHour = now.getHours();

    // Determine current session based on time of day
    let sessionData: SessionIntelligence;

    if (currentHour >= 14 && currentHour < 22) {
      // New York session
      sessionData = await generateSessionIntelligence(
        supabase,
        "New York",
        14,
        22
      );
    } else if (currentHour >= 22 || currentHour < 8) {
      // Asian session
      sessionData = await generateSessionIntelligence(
        supabase,
        "Asian",
        22,
        8
      );
    } else {
      // London session
      sessionData = await generateSessionIntelligence(supabase, "London", 8, 14);
    }

    // Insert or update the session intelligence
    const { error } = await supabase
      .from("session_intelligence_data")
      .upsert(
        {
          session_name: sessionData.session_name,
          session_start_hour: sessionData.session_start_hour,
          session_end_hour: sessionData.session_end_hour,
          market_condition: sessionData.market_condition,
          is_tradable: sessionData.is_tradable,
          top_pairs: sessionData.top_pairs,
          heating_pairs: sessionData.heating_pairs,
          all_pair_scores: sessionData.all_pair_scores,
          recommendation_text: sessionData.recommendation_text,
          best_pairs: sessionData.top_pairs,
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 6 * 60 * 1000).toISOString(),
        },
        {
          onConflict: "session_name",
        }
      );

    if (error) {
      throw error;
    }

    console.log("[Session Intelligence] ✅ Population complete");

    return new Response(
      JSON.stringify({
        success: true,
        session: sessionData,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[Session Intelligence] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function generateSessionIntelligence(
  supabase: any,
  sessionName: string,
  startHour: number,
  endHour: number
): Promise<SessionIntelligence> {
  // Fetch all available pairs
  const { data: symbols } = await supabase
    .from("symbol_availability")
    .select("symbol")
    .limit(50);

  const watchlistSymbols = symbols?.map((s: any) => s.symbol) || [
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "AUDUSD",
    "NZDUSD",
    "USDCAD",
    "USDCHF",
    "BTCUSD",
    "ETHUSD",
    "XAUUSD",
  ];

  // Calculate scores for each pair
  const pairScores: PairScore[] = [];

  for (const symbol of watchlistSymbols) {
    const alignment = calculateIndicatorAlignment(symbol);
    const alignmentPercentage = Math.round(
      (Object.values(alignment).filter(Boolean).length / Object.keys(alignment).length) * 100
    );

    pairScores.push({
      symbol,
      confidence: alignmentPercentage,
      status: getStatus(alignmentPercentage),
      indicatorAlignment: alignment,
      tradeConfidence: alignmentPercentage,
    });
  }

  // Sort by confidence descending
  pairScores.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

  // Categorize pairs
  const readyPairs = pairScores.filter((p) => (p.confidence || 0) >= 70);
  const heatingPairs = pairScores.filter(
    (p) => (p.confidence || 0) >= 50 && (p.confidence || 0) < 70
  );

  // Determine market condition based on overall alignment
  const avgConfidence =
    pairScores.reduce((sum, p) => sum + (p.confidence || 0), 0) /
    pairScores.length;
  const marketCondition = getMarketCondition(avgConfidence);

  return {
    session_name: sessionName,
    session_start_hour: startHour,
    session_end_hour: endHour,
    market_condition: marketCondition,
    is_tradable: readyPairs.length > 0,
    top_pairs: readyPairs.slice(0, 5),
    heating_pairs: heatingPairs.slice(0, 5),
    all_pair_scores: pairScores,
    recommendation_text:
      readyPairs.length > 0
        ? `${readyPairs.length} pair(s) ready for trading with 70%+ indicator alignment. ${heatingPairs.length} more pairs heating up.`
        : `No ready pairs yet. ${heatingPairs.length} pairs warming toward entry signals.`,
  };
}

function calculateIndicatorAlignment(symbol: string): Record<string, boolean> {
  // Simulated indicator alignment based on symbol
  // In production, this would fetch real data from analysis tables
  const seed = symbol.charCodeAt(0) + symbol.length;
  const random = Math.sin(seed) * 10000 - Math.floor(Math.sin(seed) * 10000);

  return {
    vwap: random > 0.5,
    ema20: random > 0.3,
    ema50: random > 0.4,
    rsi: random > 0.6,
    volume: random > 0.45,
    momentum: random > 0.55,
    structure: random > 0.5,
    candles: random > 0.4,
  };
}

function getStatus(
  confidence: number
): "ready" | "heating" | "monitoring" {
  if (confidence >= 70) return "ready";
  if (confidence >= 50) return "heating";
  return "monitoring";
}

function getMarketCondition(
  avgConfidence: number
): "trending" | "volatile" | "ranging" | "quiet" {
  if (avgConfidence >= 65) return "trending";
  if (avgConfidence >= 50) return "volatile";
  if (avgConfidence >= 35) return "ranging";
  return "quiet";
}
