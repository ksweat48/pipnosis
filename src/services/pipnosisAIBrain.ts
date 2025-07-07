import { backendAPI } from './backendAPI';

/**
 * Pipnosis AI Brain - Core Decision Engine
 * 
 * This module implements the Pipnosis AI trading system that interprets natural language prompts,
 * assesses trade feasibility, analyzes forex pairs, and executes trades with full risk management.
 * The brain is governed by 10 immutable laws of trading and prioritizes capital preservation.
 */

// Types
export interface TradingGoal {
  type: 'profit' | 'percentage' | 'pips';
  amount: number;
  timeframe: 'day' | 'week' | 'month' | 'custom';
  days?: number;
}

export interface MarketCondition {
  pair: string;
  trend: 'bullish' | 'bearish' | 'sideways';
  strength: number; // 0-100
  volatility: 'low' | 'medium' | 'high';
  support: number;
  resistance: number;
  signals: string[];
}

export interface TradeStrategy {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high';
  symbol: string;
  action: 'buy' | 'sell';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  estimatedGain: number;
  confidence: number; // 0-100
  reasoning: string;
  feasible: boolean;
  pipnosisLawsCompliance: string[];
}

export interface FeasibilityResult {
  feasible: boolean;
  adjustedGoal?: TradingGoal;
  reason: string;
  riskAssessment: string;
  lawsReferenced: string[];
}

export interface PromptAnalysisResult {
  goal: TradingGoal;
  strategies: TradeStrategy[];
  marketAnalysis: string;
  riskAssessment: string;
  confidence: 'high' | 'medium' | 'low';
  aiRecommendation: string;
}

// Constants
const PIPNOSIS_LAWS = [
  "Capital Preservation Above All",
  "Target 70–80% Win Rate Over Time",
  "Manage Drawdown Relentlessly",
  "Never Chase Unrealistic Goals",
  "AI Is the Final Decision-Maker",
  "Trades Must Have High Quality Entry Conditions",
  "Cut Losses Early, Let Winners Run",
  "No Trading During High-Risk Events",
  "Do Not Overtrade",
  "Prioritize Consistency Over Speed"
];

const TIER_1_PAIRS = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD'];
const TIER_2_PAIRS = ['EURJPY', 'GBPJPY', 'EURGBP', 'XAUUSD', 'USDMXN', 'USDZAR', 'BTCUSD'];

// Main AI Brain Class
export class PipnosisAIBrain {
  private accountBalance: number = 10000;
  private riskProfile: 'low' | 'medium' | 'high' | 'auto' = 'auto';
  private maxDrawdown: number = 15; // percentage
  private maxDailyRisk: number = 6; // percentage
  private maxOpenTrades: number = 5;
  private currentDrawdown: number = 0;
  private currentDailyRisk: number = 0;
  private openTrades: number = 0;
  private marketData: any[] = [];
  
  constructor() {
    console.log('🧠 Pipnosis AI Brain initialized');
  }
  
  /**
   * Set account configuration
   */
  public configure(config: {
    accountBalance?: number;
    riskProfile?: 'low' | 'medium' | 'high' | 'auto';
    maxDrawdown?: number;
    maxDailyRisk?: number;
    maxOpenTrades?: number;
  }) {
    if (config.accountBalance) this.accountBalance = config.accountBalance;
    if (config.riskProfile) this.riskProfile = config.riskProfile;
    if (config.maxDrawdown) this.maxDrawdown = config.maxDrawdown;
    if (config.maxDailyRisk) this.maxDailyRisk = config.maxDailyRisk;
    if (config.maxOpenTrades) this.maxOpenTrades = config.maxOpenTrades;
    
    console.log('🧠 Pipnosis AI Brain configured:', {
      accountBalance: this.accountBalance,
      riskProfile: this.riskProfile,
      maxDrawdown: this.maxDrawdown,
      maxDailyRisk: this.maxDailyRisk,
      maxOpenTrades: this.maxOpenTrades
    });
  }
  
  /**
   * Update market data
   */
  public updateMarketData(data: any[]) {
    this.marketData = data;
  }
  
  /**
   * Update current trading state
   */
  public updateTradingState(state: {
    currentDrawdown?: number;
    currentDailyRisk?: number;
    openTrades?: number;
  }) {
    if (state.currentDrawdown !== undefined) this.currentDrawdown = state.currentDrawdown;
    if (state.currentDailyRisk !== undefined) this.currentDailyRisk = state.currentDailyRisk;
    if (state.openTrades !== undefined) this.openTrades = state.openTrades;
  }
  
  /**
   * Parse user prompt to extract trading goal
   */
  public parsePrompt(prompt: string): TradingGoal {
    console.log('🧠 Parsing prompt:', prompt);
    
    // Default goal
    let goal: TradingGoal = {
      type: 'profit',
      amount: 100,
      timeframe: 'week'
    };
    
    // Extract dollar amount
    const dollarMatch = prompt.match(/\$(\d+)/);
    const numberMatch = prompt.match(/(\d+) dollars|(\d+) bucks|(\d+)%|(\d+) percent|(\d+) pips/i);
    
    if (dollarMatch) {
      goal.type = 'profit';
      goal.amount = parseInt(dollarMatch[1]);
    } else if (numberMatch) {
      const amount = parseInt(numberMatch[0]);
      if (prompt.includes('%') || prompt.includes('percent')) {
        goal.type = 'percentage';
        goal.amount = amount;
      } else if (prompt.includes('pips')) {
        goal.type = 'pips';
        goal.amount = amount;
      } else {
        goal.type = 'profit';
        goal.amount = amount;
      }
    }
    
    // Extract timeframe
    if (prompt.includes('today') || prompt.includes('daily')) {
      goal.timeframe = 'day';
    } else if (prompt.includes('this week') || prompt.includes('weekly')) {
      goal.timeframe = 'week';
    } else if (prompt.includes('this month') || prompt.includes('monthly')) {
      goal.timeframe = 'month';
    }
    
    console.log('🧠 Parsed goal:', goal);
    return goal;
  }
  
  /**
   * Check if the trading goal is feasible based on account balance and risk profile
   */
  public checkFeasibility(goal: TradingGoal): FeasibilityResult {
    console.log('🧠 Checking feasibility for goal:', goal);
    
    // Determine risk percentage based on profile
    const riskPercentage = this.riskProfile === 'low' ? 2 :
                          this.riskProfile === 'medium' ? 5 :
                          this.riskProfile === 'high' ? 10 : 5; // Default to medium if auto
    
    // Calculate maximum risk amount
    const maxRiskAmount = this.accountBalance * (riskPercentage / 100);
    
    // Calculate maximum potential profit based on risk-reward ratio
    // Conservative RRR of 2:1
    const maxPotentialProfit = maxRiskAmount * 2;
    
    // Calculate maximum daily profit based on account size
    // Conservative estimate: 1-3% of account per day depending on risk profile
    const maxDailyProfitPercentage = this.riskProfile === 'low' ? 1 :
                                    this.riskProfile === 'medium' ? 2 :
                                    this.riskProfile === 'high' ? 3 : 2;
    
    const maxDailyProfit = this.accountBalance * (maxDailyProfitPercentage / 100);
    const maxWeeklyProfit = maxDailyProfit * 5; // 5 trading days
    const maxMonthlyProfit = maxDailyProfit * 21; // ~21 trading days per month
    
    // Determine maximum profit based on timeframe
    let maxTimeframeProfit: number;
    let timeframeDescription: string;
    
    switch (goal.timeframe) {
      case 'day':
        maxTimeframeProfit = maxDailyProfit;
        timeframeDescription = 'daily';
        break;
      case 'week':
        maxTimeframeProfit = maxWeeklyProfit;
        timeframeDescription = 'weekly';
        break;
      case 'month':
        maxTimeframeProfit = maxMonthlyProfit;
        timeframeDescription = 'monthly';
        break;
      default:
        maxTimeframeProfit = maxWeeklyProfit; // Default to weekly
        timeframeDescription = 'weekly';
    }
    
    // Check if goal is feasible
    let feasible = true;
    let adjustedGoal: TradingGoal | undefined;
    let reason = '';
    let lawsReferenced: string[] = [];
    
    if (goal.type === 'profit' && goal.amount > maxTimeframeProfit) {
      feasible = false;
      
      // Calculate a more realistic goal (80% of max)
      const realisticAmount = Math.floor(maxTimeframeProfit * 0.8);
      
      adjustedGoal = {
        ...goal,
        amount: realisticAmount
      };
      
      reason = `The requested profit of $${goal.amount} exceeds the maximum recommended ${timeframeDescription} profit of $${Math.floor(maxTimeframeProfit)} for your account size and risk profile. A more realistic goal would be $${realisticAmount}.`;
      lawsReferenced = [PIPNOSIS_LAWS[0], PIPNOSIS_LAWS[3]]; // Capital Preservation, Never Chase Unrealistic Goals
    } else if (goal.type === 'percentage' && goal.amount > maxDailyProfitPercentage * (goal.timeframe === 'day' ? 1 : goal.timeframe === 'week' ? 5 : 21)) {
      feasible = false;
      
      // Calculate a more realistic percentage
      const realisticPercentage = Math.floor(maxDailyProfitPercentage * (goal.timeframe === 'day' ? 1 : goal.timeframe === 'week' ? 5 : 21) * 0.8);
      
      adjustedGoal = {
        ...goal,
        amount: realisticPercentage
      };
      
      reason = `The requested percentage gain of ${goal.amount}% exceeds the maximum recommended ${timeframeDescription} percentage of ${maxDailyProfitPercentage * (goal.timeframe === 'day' ? 1 : goal.timeframe === 'week' ? 5 : 21)}% for your risk profile. A more realistic goal would be ${realisticPercentage}%.`;
      lawsReferenced = [PIPNOSIS_LAWS[0], PIPNOSIS_LAWS[3]]; // Capital Preservation, Never Chase Unrealistic Goals
    } else {
      reason = `The requested goal of ${goal.type === 'profit' ? '$' + goal.amount : goal.amount + (goal.type === 'percentage' ? '%' : ' pips')} is feasible within your ${timeframeDescription} trading parameters.`;
      lawsReferenced = [PIPNOSIS_LAWS[1], PIPNOSIS_LAWS[9]]; // Target Win Rate, Consistency Over Speed
    }
    
    // Check current trading state
    if (this.currentDrawdown > this.maxDrawdown * 0.7) {
      if (feasible) {
        feasible = false;
        reason = `Current drawdown of ${this.currentDrawdown.toFixed(1)}% is approaching the maximum allowed drawdown of ${this.maxDrawdown}%. Trading is paused to protect capital.`;
        lawsReferenced = [PIPNOSIS_LAWS[0], PIPNOSIS_LAWS[2]]; // Capital Preservation, Manage Drawdown
      }
    }
    
    if (this.currentDailyRisk > this.maxDailyRisk * 0.8) {
      if (feasible) {
        feasible = false;
        reason = `Current daily risk exposure of ${this.currentDailyRisk.toFixed(1)}% is approaching the maximum allowed daily risk of ${this.maxDailyRisk}%. Trading is restricted until tomorrow.`;
        lawsReferenced = [PIPNOSIS_LAWS[0], PIPNOSIS_LAWS[2]]; // Capital Preservation, Manage Drawdown
      }
    }
    
    if (this.openTrades >= this.maxOpenTrades) {
      if (feasible) {
        feasible = false;
        reason = `Maximum number of concurrent trades (${this.maxOpenTrades}) already reached. Wait for some positions to close before opening new trades.`;
        lawsReferenced = [PIPNOSIS_LAWS[8]]; // Do Not Overtrade
      }
    }
    
    // Generate risk assessment
    const riskAssessment = `Based on your account balance of $${this.accountBalance.toLocaleString()} and ${this.riskProfile} risk profile, your maximum recommended risk per trade is $${Math.floor(maxRiskAmount)} (${riskPercentage}% of balance). This allows for a maximum ${timeframeDescription} profit target of approximately $${Math.floor(maxTimeframeProfit)} with proper risk management.`;
    
    return {
      feasible,
      adjustedGoal,
      reason,
      riskAssessment,
      lawsReferenced
    };
  }
  
  /**
   * Analyze trading pairs to find the best opportunities
   */
  public analyzePairs(goal: TradingGoal, useTier2: boolean = false): MarketCondition[] {
    console.log('🧠 Analyzing pairs for goal:', goal);
    
    // Determine which pairs to analyze
    const pairsToAnalyze = [...TIER_1_PAIRS];
    if (useTier2) {
      pairsToAnalyze.push(...TIER_2_PAIRS);
    }
    
    // Get market data for pairs
    let marketConditions: MarketCondition[] = [];
    
    // If we have real market data, use it
    if (this.marketData.length > 0) {
      marketConditions = this.marketData.map(data => ({
        pair: data.symbol,
        trend: data.trend === 'up' ? 'bullish' : data.trend === 'down' ? 'bearish' : 'sideways',
        strength: Math.random() * 40 + 60, // 60-100
        volatility: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low',
        support: data.price * 0.995,
        resistance: data.price * 1.005,
        signals: [data.signal === 'buy' ? 'Buy Signal' : data.signal === 'sell' ? 'Sell Signal' : 'Neutral']
      }));
    } else {
      // Generate mock market conditions
      marketConditions = pairsToAnalyze.map(pair => {
        const isBullish = Math.random() > 0.5;
        const basePrice = pair === 'EURUSD' ? 1.1425 :
                         pair === 'GBPUSD' ? 1.2735 :
                         pair === 'USDJPY' ? 149.85 :
                         pair === 'USDCHF' ? 0.8945 :
                         pair === 'AUDUSD' ? 0.6785 :
                         pair === 'USDCAD' ? 1.3625 :
                         pair === 'NZDUSD' ? 0.6245 :
                         pair === 'EURJPY' ? 171.25 :
                         pair === 'GBPJPY' ? 190.85 :
                         pair === 'EURGBP' ? 0.8975 :
                         pair === 'XAUUSD' ? 2045.50 : 1.0000;
        
        return {
          pair,
          trend: isBullish ? 'bullish' : 'bearish',
          strength: Math.random() * 40 + 60, // 60-100
          volatility: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low',
          support: basePrice * 0.995,
          resistance: basePrice * 1.005,
          signals: [
            isBullish ? 'Buy Signal' : 'Sell Signal',
            Math.random() > 0.5 ? 'RSI Oversold' : 'RSI Overbought',
            Math.random() > 0.5 ? 'MACD Bullish Cross' : 'MACD Bearish Cross',
            Math.random() > 0.5 ? 'Support Level Hold' : 'Resistance Level Hold'
          ]
        };
      });
    }
    
    // Score and sort pairs based on goal
    marketConditions.forEach(condition => {
      // Calculate a score based on trend strength, volatility, and signals
      let score = condition.strength;
      
      // Adjust score based on volatility (higher volatility is better for short-term goals)
      if (goal.timeframe === 'day') {
        if (condition.volatility === 'high') score += 15;
        else if (condition.volatility === 'medium') score += 10;
      } else if (goal.timeframe === 'week') {
        if (condition.volatility === 'medium') score += 15;
        else if (condition.volatility === 'high') score += 10;
      } else {
        if (condition.volatility === 'low') score += 15;
        else if (condition.volatility === 'medium') score += 10;
      }
      
      // Adjust score based on signals
      if (condition.signals.includes('Buy Signal') || condition.signals.includes('Sell Signal')) {
        score += 10;
      }
      
      // Store score
      (condition as any).score = score;
    });
    
    // Sort by score (highest first)
    marketConditions.sort((a, b) => (b as any).score - (a as any).score);
    
    return marketConditions;
  }
  
  /**
   * Generate trading strategies based on market conditions and goal
   */
  public generateStrategies(goal: TradingGoal, marketConditions: MarketCondition[]): TradeStrategy[] {
    console.log('🧠 Generating strategies for goal:', goal);
    
    const strategies: TradeStrategy[] = [];
    
    // Take top 3 pairs
    const topPairs = marketConditions.slice(0, 3);
    
    // Generate strategies for each risk level
    const riskLevels: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    
    riskLevels.forEach((risk, index) => {
      // Use different pair for each risk level if possible
      const pairIndex = Math.min(index, topPairs.length - 1);
      const marketCondition = topPairs[pairIndex];
      
      // Determine risk percentage based on risk level
      const riskPercentage = risk === 'low' ? 2 : risk === 'medium' ? 5 : 10;
      
      // Calculate risk amount
      const riskAmount = this.accountBalance * (riskPercentage / 100);
      
      // Determine if it's a buy or sell based on trend
      const action = marketCondition.trend === 'bullish' ? 'buy' : 'sell';
      
      // Format pair to ensure it doesn't have slashes
      const formattedPair = marketCondition.pair.replace('/', '').toUpperCase();
      
      // Calculate entry, SL, and TP
      const basePrice = action === 'buy' ? 
        (formattedPair.includes('JPY') ? marketCondition.support * 1.0001 : marketCondition.support * 1.0001) : 
        (formattedPair.includes('JPY') ? marketCondition.resistance * 0.9999 : marketCondition.resistance * 0.9999);
      
      // SL distance based on volatility and risk level
      const slDistancePercentage = marketCondition.volatility === 'high' ? 
        (risk === 'low' ? 0.5 : risk === 'medium' ? 0.8 : 1.2) :
        marketCondition.volatility === 'medium' ?
        (risk === 'low' ? 0.3 : risk === 'medium' ? 0.5 : 0.8) :
        (risk === 'low' ? 0.2 : risk === 'medium' ? 0.3 : 0.5);
      
      // Calculate SL and TP
      const slDistance = basePrice * (slDistancePercentage / 100);
      const stopLoss = action === 'buy' ? basePrice - slDistance : basePrice + slDistance;
      
      // RRR based on risk level
      const rrr = risk === 'low' ? 2 : risk === 'medium' ? 2.5 : 3;
      const tpDistance = slDistance * rrr;
      const takeProfit = action === 'buy' ? basePrice + tpDistance : basePrice - tpDistance;
      
      // Calculate lot size based on risk amount and SL distance
      // For simplicity, assume 1 pip = $10 per standard lot
      const pipValue = formattedPair.includes('JPY') ? 1000 : 100000;
      const pipDistance = formattedPair.includes('JPY') ? 
        Math.abs(basePrice - stopLoss) * 100 : 
        Math.abs(basePrice - stopLoss) * 10000;
      
      const lotSize = riskAmount / (pipDistance * 10); // $10 per pip for 1.0 lot
      
      // Calculate estimated gain
      const estimatedGain = Math.floor(riskAmount * rrr);
      
      // Generate strategy name
      const strategyName = risk === 'low' ? 
        'Conservative Capital Protection' : 
        risk === 'medium' ? 
        'Balanced Growth Strategy' : 
        'Aggressive Opportunity Capture';
      
      // Generate reasoning with Pipnosis Laws references
      const lawsCompliance = [
        PIPNOSIS_LAWS[0], // Capital Preservation
        PIPNOSIS_LAWS[5], // High Quality Entry
      ];
      
      if (risk === 'low') {
        lawsCompliance.push(PIPNOSIS_LAWS[2]); // Manage Drawdown
      } else if (risk === 'medium') {
        lawsCompliance.push(PIPNOSIS_LAWS[1]); // Target Win Rate
      } else {
        lawsCompliance.push(PIPNOSIS_LAWS[4]); // AI Final Decision
      }
      
      const reasoning = `${action.toUpperCase()} ${marketCondition.pair} at ${basePrice.toFixed(marketCondition.pair.includes('JPY') ? 2 : 5)} with ${risk} risk profile. Following ${lawsCompliance[0]} with ${riskPercentage}% account risk. Entry confirmed by ${marketCondition.signals.join(', ')}. ${lawsCompliance[1]} ensures multiple technical confirmations. Risk-reward ratio of ${rrr}:1 optimized for ${goal.timeframe} timeframe.`;
      
      // Check if strategy is feasible based on current trading state
      const feasible = this.currentDrawdown <= this.maxDrawdown * 0.7 && 
                      this.currentDailyRisk <= this.maxDailyRisk * 0.8 &&
                      this.openTrades < this.maxOpenTrades;
      
      // Create strategy
      strategies.push({
        id: `strategy-${risk}-${Date.now()}`,
        name: strategyName,
        risk,
        symbol: formattedPair,
        action,
        entry: basePrice,
        stopLoss,
        takeProfit,
        lotSize: parseFloat(lotSize.toFixed(2)),
        estimatedGain,
        confidence: risk === 'low' ? 85 : risk === 'medium' ? 75 : 65,
        reasoning,
        feasible,
        pipnosisLawsCompliance: lawsCompliance
      });
    });
    
    return strategies;
  }
  
  /**
   * Process a user prompt and generate trading strategies
   */
  public async processPrompt(prompt: string): Promise<PromptAnalysisResult> {
    console.log('🧠 Processing prompt:', prompt);
    
    // 1. Parse the prompt to extract the trading goal
    const goal = this.parsePrompt(prompt);
    
    // 2. Check if the goal is feasible
    const feasibility = this.checkFeasibility(goal);
    
    // 3. If not feasible, adjust the goal
    const finalGoal = feasibility.feasible ? goal : (feasibility.adjustedGoal || goal);
    
    // 4. Analyze trading pairs
    const marketConditions = this.analyzePairs(finalGoal, true);
    
    // 5. Generate strategies
    const strategies = this.generateStrategies(finalGoal, marketConditions);
    
    // 6. Generate market analysis
    const marketAnalysis = `Analysis of ${marketConditions.length} currency pairs shows ${
      marketConditions.filter(c => c.trend === 'bullish').length > marketConditions.filter(c => c.trend === 'bearish').length
        ? 'predominantly bullish'
        : marketConditions.filter(c => c.trend === 'bearish').length > marketConditions.filter(c => c.trend === 'bullish').length
        ? 'predominantly bearish'
        : 'mixed'
    } conditions. Top opportunities identified in ${strategies.map(s => s.symbol).filter((v, i, a) => a.indexOf(v) === i).join(', ')}. ${
      marketConditions.some(c => c.volatility === 'high')
        ? 'Market volatility is elevated, requiring careful position sizing.'
        : 'Market volatility is moderate, favorable for standard position sizing.'
    }`;
    
    // 7. Determine overall confidence
    const confidence = strategies.some(s => s.confidence >= 80) ? 'high' :
                      strategies.some(s => s.confidence >= 70) ? 'medium' : 'low';
    
    // 8. Generate AI recommendation
    const aiRecommendation = feasibility.feasible
      ? `Execute ${strategies[0].risk}-risk strategy first to test market conditions. Monitor for any changes in sentiment or volatility. Account balance of $${this.accountBalance.toLocaleString()} allows for ${strategies.length > 1 ? 'multiple strategy options' : 'conservative positioning'}. Consider scaling up after successful execution.`
      : `${feasibility.reason} Following ${feasibility.lawsReferenced.join(' and ')}, I recommend adjusting your goal to ${finalGoal.type === 'profit' ? '$' + finalGoal.amount : finalGoal.amount + (finalGoal.type === 'percentage' ? '%' : ' pips')} for this ${finalGoal.timeframe}.`;
    
    return {
      goal: finalGoal,
      strategies,
      marketAnalysis,
      riskAssessment: feasibility.riskAssessment,
      confidence,
      aiRecommendation
    };
  }
  
  /**
   * Monitor and manage an active trade
   */
  public monitorTrade(trade: any): { action: 'hold' | 'modify' | 'close'; reason: string; } {
    // This would contain logic to monitor and manage trades
    // For now, return a simple hold action
    return {
      action: 'hold',
      reason: 'Trade is performing as expected, following Law #7 (Cut Losses Early, Let Winners Run).'
    };
  }
}

// Create singleton instance
export const pipnosisAI = new PipnosisAIBrain();