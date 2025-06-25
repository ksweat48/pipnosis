import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// CRITICAL: Load environment variables from root directory FIRST, before any other imports
const envPath = join(__dirname, '../../.env');
console.log('🔧 AI Service loading environment variables from:', envPath);
dotenv.config({ path: envPath });

// Verify environment variables are loaded
console.log('🔑 Environment check in AI Service:');
console.log('- OPENAI_API_KEY:', process.env.OPENAI_API_KEY ? `${process.env.OPENAI_API_KEY.substring(0, 10)}...` : 'MISSING');

// Import OpenAI AFTER environment variables are loaded
import OpenAI from 'openai';
import { saveAIJournalEntry, saveTradingSession } from '../lib/supabase.js';

// Initialize OpenAI with better error handling - DON'T crash if API key is missing
let openai = null;
let openaiInitialized = false;

try {
  const apiKey = process.env.OPENAI_API_KEY;
  console.log('🔍 Checking OpenAI API key:', apiKey ? `${apiKey.substring(0, 10)}...` : 'MISSING');
  
  if (apiKey && apiKey !== 'your_openai_api_key_here' && !apiKey.includes('your_') && apiKey.length > 10) {
    openai = new OpenAI({
      apiKey: apiKey
    });
    openaiInitialized = true;
    console.log('🔑 OpenAI client initialized successfully');
  } else {
    console.warn('⚠️ OpenAI API key not configured properly. AI features will use mock responses.');
    console.log('💡 To enable real AI features, add your OpenAI API key to the .env file');
    console.log('💡 Expected format: OPENAI_API_KEY=sk-...');
  }
} catch (error) {
  console.warn('⚠️ OpenAI initialization failed:', error.message);
  console.log('💡 AI service will continue in mock mode');
}

// Pipnosis Trading Laws (embedded in AI logic)
const PIPNOSIS_LAWS = `
PIPNOSIS IMMUTABLE LAWS OF TRADING:

1. Capital Preservation Above All - Never risk the entire account balance on any single trade or series of trades.
2. Target 70–80% Win Rate Over Time - Trades should be selected and filtered to statistically strive for a 70%–80% win rate.
3. Manage Drawdown Relentlessly - Limit cumulative drawdown. If drawdown exceeds safe thresholds, halt trading.
4. Never Chase Unrealistic Goals - Scale down unrealistic goals and preserve user funds.
5. AI Is the Final Decision-Maker - Pipnosis retains ultimate judgment to override risky trades.
6. Trades Must Have High Quality Entry Conditions - Each trade must meet multiple technical confirmations.
7. Cut Losses Early, Let Winners Run - Favor intelligent trailing stops and time-based exits.
8. No Trading During High-Risk Events - Avoid trading before/during major economic news unless explicitly enabled.
9. Do Not Overtrade - Obey trade frequency limits based on account size and user risk tier.
10. Prioritize Consistency Over Speed - Fulfill part of prompt rather than overextend and risk loss.

These laws are IMMUTABLE and override any user request that would violate them.
`;

// Enhanced Trading Pairs System - Tiered Approach
const TRADING_PAIRS = {
  // Tier 1: Default Scan Set - Most Popular & Most Liquid (Always scanned)
  tier1: [
    { symbol: 'EURUSD', name: 'Euro / US Dollar', spread: 'low', liquidity: 'high' },
    { symbol: 'GBPUSD', name: 'British Pound / USD', spread: 'low', liquidity: 'high' },
    { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', spread: 'low', liquidity: 'high' },
    { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', spread: 'low', liquidity: 'high' },
    { symbol: 'AUDUSD', name: 'Australian Dollar / USD', spread: 'medium', liquidity: 'high' },
    { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', spread: 'medium', liquidity: 'high' },
    { symbol: 'NZDUSD', name: 'New Zealand Dollar / USD', spread: 'medium', liquidity: 'medium' }
  ],
  
  // Tier 2: Smart Tier - Trendy, Volatile, or High RRR (Optional based on settings/conditions)
  tier2: [
    { symbol: 'EURJPY', name: 'Euro / Japanese Yen', spread: 'medium', liquidity: 'medium', reason: 'Trend-following potential' },
    { symbol: 'GBPJPY', name: 'British Pound / Japanese Yen', spread: 'medium', liquidity: 'medium', reason: 'High volatility (good for breakouts)' },
    { symbol: 'EURGBP', name: 'Euro / British Pound', spread: 'low', liquidity: 'high', reason: 'Low spread, good mean reversion' },
    { symbol: 'XAUUSD', name: 'Gold / US Dollar', spread: 'medium', liquidity: 'high', reason: 'High opportunity with clear behavior' },
    { symbol: 'USDMXN', name: 'US Dollar / Mexican Peso', spread: 'high', liquidity: 'low', reason: 'Exotic but highly directional' },
    { symbol: 'USDZAR', name: 'US Dollar / South African Rand', spread: 'high', liquidity: 'low', reason: 'Exotic, but high pip value' },
    { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', spread: 'high', liquidity: 'medium', reason: 'Crypto - high volatility opportunities' }
  ]
};

class AIService {
  constructor() {
    this.isInitialized = openaiInitialized;
    this.init();
  }

  async init() {
    try {
      if (!openaiInitialized) {
        console.warn('⚠️ OpenAI not initialized. AI features will use mock responses.');
        this.isInitialized = false;
        return;
      }

      // Test OpenAI connection if initialized
      if (openai) {
        try {
          console.log('🧪 Testing OpenAI connection...');
          await openai.models.list();
          this.isInitialized = true;
          console.log('✅ AI Service initialized with OpenAI GPT-4');
        } catch (testError) {
          console.warn('⚠️ OpenAI connection test failed:', testError.message);
          console.warn('⚠️ This might be due to invalid API key or network issues');
          this.isInitialized = false;
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize AI Service:', error.message);
      this.isInitialized = false;
    }
  }

  // Determine which pairs to analyze based on prompt and settings
  getAnalysisPairs(prompt, userSettings = {}) {
    const {
      expandedScan = false,
      pairSelectionMode = 'ai-choose',
      selectedPairs = [],
      riskLevel = null
    } = userSettings;

    let pairsToAnalyze = [...TRADING_PAIRS.tier1]; // Always include Tier 1

    // Determine if we should include Tier 2 pairs
    const shouldIncludeTier2 = 
      expandedScan || 
      prompt.toLowerCase().includes('high risk') ||
      prompt.toLowerCase().includes('aggressive') ||
      prompt.toLowerCase().includes('volatile') ||
      riskLevel === 'high';

    if (shouldIncludeTier2) {
      pairsToAnalyze = [...pairsToAnalyze, ...TRADING_PAIRS.tier2];
    }

    // If user manually selected pairs, use those instead
    if (pairSelectionMode === 'manual' && selectedPairs.length > 0) {
      const allPairs = [...TRADING_PAIRS.tier1, ...TRADING_PAIRS.tier2];
      pairsToAnalyze = allPairs.filter(pair => selectedPairs.includes(pair.symbol));
    }

    // For low risk prompts, filter to most predictable pairs
    if (prompt.toLowerCase().includes('low risk') || prompt.toLowerCase().includes('safe') || riskLevel === 'low') {
      pairsToAnalyze = pairsToAnalyze.filter(pair => 
        ['EURUSD', 'USDCHF', 'EURGBP'].includes(pair.symbol) || pair.spread === 'low'
      );
    }

    console.log(`📊 Selected ${pairsToAnalyze.length} pairs for analysis:`, pairsToAnalyze.map(p => p.symbol));
    return pairsToAnalyze;
  }

  // Determine if prompt specifies specific risk level
  extractRiskLevelFromPrompt(prompt) {
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('low risk') || lowerPrompt.includes('safe') || lowerPrompt.includes('conservative')) {
      return 'low';
    }
    if (lowerPrompt.includes('high risk') || lowerPrompt.includes('aggressive') || lowerPrompt.includes('risky')) {
      return 'high';
    }
    if (lowerPrompt.includes('medium risk') || lowerPrompt.includes('moderate')) {
      return 'medium';
    }
    
    return null; // No specific risk level mentioned
  }

  async analyzePrompt(prompt, accountBalance, marketData, userId, userSettings = {}) {
    try {
      // Save the trading session to Supabase
      let session = null;
      try {
        session = await saveTradingSession({
          user_id: userId,
          prompt_text: prompt,
          account_balance: accountBalance,
          market_data: marketData,
          status: 'analyzing'
        });
      } catch (supabaseError) {
        console.warn('⚠️ Failed to save trading session:', supabaseError.message);
      }

      // Determine pairs to analyze
      const analysisRiskLevel = this.extractRiskLevelFromPrompt(prompt);
      const pairsToAnalyze = this.getAnalysisPairs(prompt, { ...userSettings, riskLevel: analysisRiskLevel });

      let analysis;

      if (this.isInitialized && openai) {
        console.log('🤖 Using OpenAI GPT-4 for analysis');
        analysis = await this.getOpenAIAnalysis(prompt, accountBalance, marketData, pairsToAnalyze, analysisRiskLevel);
      } else {
        console.log('🤖 Using mock AI analysis (OpenAI not available)');
        analysis = this.getMockAnalysis(pairsToAnalyze, analysisRiskLevel);
      }

      // Update session with results
      if (session) {
        try {
          await saveTradingSession({
            ...session,
            strategies_generated: analysis.strategies,
            status: 'completed',
            ai_confidence: analysis.confidence
          });
        } catch (supabaseError) {
          console.warn('⚠️ Failed to update trading session:', supabaseError.message);
        }
      }

      // Generate AI journal entry
      if (userId) {
        try {
          await saveAIJournalEntry({
            user_id: userId,
            entry_type: 'market_update',
            title: 'AI Strategy Analysis Complete',
            content: `Analyzed prompt: "${prompt}". Generated ${analysis.strategies.length} strategies with ${analysis.confidence} confidence. ${analysis.summary}`,
            confidence_level: analysis.confidence
          });
        } catch (supabaseError) {
          console.warn('⚠️ Failed to save journal entry:', supabaseError.message);
        }
      }

      return analysis;
    } catch (error) {
      console.error('❌ AI Analysis failed:', error);
      
      // Save error to journal
      if (userId) {
        try {
          await saveAIJournalEntry({
            user_id: userId,
            entry_type: 'ai_decision',
            title: 'Analysis Error',
            content: `Failed to analyze prompt due to: ${error.message}. Using fallback strategies.`,
            confidence_level: 'low'
          });
        } catch (supabaseError) {
          console.warn('⚠️ Failed to save error journal entry:', supabaseError.message);
        }
      }

      return this.getMockAnalysis();
    }
  }

  async getOpenAIAnalysis(prompt, accountBalance, marketData, pairsToAnalyze, specifiedRiskLevel) {
    const pairsList = pairsToAnalyze.map(p => p.symbol).join(', ');
    const shouldGenerateAllRiskLevels = !specifiedRiskLevel;

    const systemPrompt = `You are Pipnosis, an expert AI forex trading assistant that STRICTLY follows the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_LAWS}

User's account balance: $${accountBalance}
Available trading pairs: ${pairsList}
Current market data: ${JSON.stringify(marketData)}

CRITICAL INSTRUCTIONS:
1. You MUST follow ALL 10 Immutable Laws in every decision
2. ${shouldGenerateAllRiskLevels ? 
  'Generate exactly 3 strategies: one LOW risk, one MEDIUM risk, and one HIGH risk strategy' : 
  `Generate 2-3 strategies for ${specifiedRiskLevel.toUpperCase()} risk level only`}
3. Use different trading pairs from the available list for variety
4. Each strategy must reference specific Pipnosis Laws in reasoning
5. Ensure position sizing follows Law #1 (Capital Preservation)

Risk Level Guidelines:
- LOW RISK: 1-2% account risk, conservative pairs (EURUSD, USDCHF, EURGBP), tight stops
- MEDIUM RISK: 3-5% account risk, major pairs, balanced R:R ratios
- HIGH RISK: 6-10% account risk, volatile pairs (GBPJPY, EURJPY, XAUUSD), wider targets

Return a JSON object with this exact structure:
{
  "strategies": [
    {
      "id": "1",
      "name": "Strategy Name",
      "risk": "low|medium|high",
      "tradeType": "SYMBOL Direction (Timeframe)",
      "entry": 1.2345,
      "stopLoss": 1.2300,
      "takeProfit": 1.2400,
      "lotSize": 0.5,
      "estimatedGain": 150,
      "feasible": true,
      "reasoning": "Detailed explanation including which Pipnosis Laws guide this strategy"
    }
  ],
  "summary": "Brief overview of the market analysis across all risk levels",
  "confidence": "high|medium|low",
  "riskAssessment": "Overall risk assessment referencing applicable Pipnosis Laws",
  "pairsAnalyzed": ${pairsToAnalyze.length},
  "tierInfo": "Information about which tiers were analyzed"
}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2000
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response from OpenAI');
    }

    try {
      return JSON.parse(content);
    } catch (parseError) {
      console.error('Failed to parse OpenAI response:', content);
      throw new Error('Invalid AI response format');
    }
  }

  getMockAnalysis(pairsToAnalyze = TRADING_PAIRS.tier1, specifiedRiskLevel = null) {
    const shouldGenerateAllRiskLevels = !specifiedRiskLevel;
    
    // Select different pairs for variety
    const availablePairs = pairsToAnalyze.map(p => p.symbol);
    const selectedPairs = availablePairs.slice(0, 3); // Use first 3 available pairs

    const strategies = [];

    if (shouldGenerateAllRiskLevels || specifiedRiskLevel === 'low') {
      strategies.push({
        id: '1',
        name: 'Conservative Capital Protection',
        risk: 'low',
        tradeType: `${selectedPairs[0] || 'EURUSD'} Swing (H4-D1)`,
        entry: 1.1410,
        stopLoss: 1.1380,
        takeProfit: 1.1470,
        lotSize: 0.3,
        estimatedGain: 180,
        feasible: true,
        reasoning: 'Conservative approach following Law #1 (Capital Preservation) with 1.5% account risk. Law #6 (High Quality Entry) ensures multiple confirmations. Law #2 targets 80% win rate with tight risk management per Law #3.'
      });
    }

    if (shouldGenerateAllRiskLevels || specifiedRiskLevel === 'medium') {
      strategies.push({
        id: '2',
        name: 'Balanced Growth Strategy',
        risk: 'medium',
        tradeType: `${selectedPairs[1] || 'GBPUSD'} Swing (H1-H4)`,
        entry: 1.2735,
        stopLoss: 1.2685,
        takeProfit: 1.2835,
        lotSize: 0.7,
        estimatedGain: 350,
        feasible: true,
        reasoning: 'Balanced approach per Law #5 (AI Final Decision) with 4% account risk. Law #7 (Cut Losses Early) guides stop placement. Maintains Law #2 target win rate while optimizing for weekly goals.'
      });
    }

    if (shouldGenerateAllRiskLevels || specifiedRiskLevel === 'high') {
      strategies.push({
        id: '3',
        name: 'Aggressive Opportunity Capture',
        risk: 'high',
        tradeType: `${selectedPairs[2] || 'USDJPY'} Breakout (M15-H1)`,
        entry: 149.85,
        stopLoss: 149.35,
        takeProfit: 150.85,
        lotSize: 1.2,
        estimatedGain: 600,
        feasible: true,
        reasoning: 'Higher risk approach still governed by Law #1 (Capital Preservation) with 8% max risk. Law #6 (High Quality Entry) requires breakout confirmation. Law #10 (Consistency Over Speed) ensures sustainable execution.'
      });
    }

    return {
      strategies,
      summary: `Market analysis across ${pairsToAnalyze.length} trading pairs shows ${shouldGenerateAllRiskLevels ? 'opportunities at all risk levels' : `${specifiedRiskLevel} risk opportunities`}. All strategies comply with Pipnosis Immutable Laws.`,
      confidence: 'high',
      riskAssessment: `Risk management follows Law #1 (Capital Preservation) and Law #3 (Drawdown Management). ${shouldGenerateAllRiskLevels ? 'Multiple risk levels provide flexibility while maintaining discipline.' : `${specifiedRiskLevel.charAt(0).toUpperCase() + specifiedRiskLevel.slice(1)} risk approach maintains law compliance.`}`,
      pairsAnalyzed: pairsToAnalyze.length,
      tierInfo: `Analyzed Tier 1 (${TRADING_PAIRS.tier1.length} pairs)${pairsToAnalyze.length > TRADING_PAIRS.tier1.length ? ` + Tier 2 (${pairsToAnalyze.length - TRADING_PAIRS.tier1.length} pairs)` : ''}`
    };
  }

  async generateJournalEntry(eventType, tradeData, userId) {
    try {
      if (!this.isInitialized || !openai) {
        return this.getMockJournalEntry(eventType, tradeData);
      }

      const systemPrompt = `You are Pipnosis AI, writing a trade journal entry that follows the Pipnosis Immutable Laws of Trading.

${PIPNOSIS_LAWS}

Write in a conversational, confident tone that explains trading decisions clearly while referencing which Pipnosis Laws guided the decision.
Keep it concise but informative. Use everyday trader language.

ALWAYS reference specific Pipnosis Laws that influenced the decision.

Return a JSON object with this structure:
{
  "title": "Brief title for the entry",
  "content": "Detailed explanation of the decision including which Pipnosis Laws were applied",
  "confidence_level": "high|medium|low"
}`;

      const userPrompt = `Write a journal entry for a ${eventType} event with this data: ${JSON.stringify(tradeData)}`;

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        max_tokens: 300
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return this.getMockJournalEntry(eventType, tradeData);
      }

      const parsed = JSON.parse(content);
      
      // Save to Supabase
      const entry = await saveAIJournalEntry({
        user_id: userId,
        trade_id: tradeData.tradeId,
        entry_type: eventType,
        title: parsed.title,
        content: parsed.content,
        confidence_level: parsed.confidence_level
      });

      return entry;
    } catch (error) {
      console.error('❌ Failed to generate journal entry:', error);
      return this.getMockJournalEntry(eventType, tradeData);
    }
  }

  getMockJournalEntry(eventType, tradeData) {
    const entries = {
      trade_entry: {
        title: 'Multi-Risk Strategy Analysis Complete',
        content: 'Generated comprehensive strategies across all risk levels following Pipnosis Law #6 (High Quality Entry Conditions) and Law #1 (Capital Preservation). Each risk tier maintains proper position sizing per Law #3 (Drawdown Management).',
        confidence_level: 'high'
      },
      trade_exit: {
        title: 'Trade Position Closed',
        content: 'Closed position following Law #7 (Cut Losses Early, Let Winners Run) to secure profits and manage risk. Law #10 (Consistency Over Speed) guided the exit timing.',
        confidence_level: 'medium'
      }
    };

    return entries[eventType] || entries.trade_entry;
  }
}

export const aiService = new AIService();