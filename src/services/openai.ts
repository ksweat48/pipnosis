const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

const IMMUTABLE_LAWS = [
  "Law #1: Capital Preservation - Never risk more than 2-4% of account balance per trade",
  "Law #2: Risk-Reward Ratio - Minimum 1:1 RRR, target 2:1 or better",
  "Law #3: Drawdown Management - Maximum 15% account drawdown before stopping",
  "Law #4: Trade Limit - Maximum 2 trades per session",
  "Law #5: AI Final Decision - AI has ultimate authority on trade execution",
  "Law #6: Quality Over Quantity - Only high-probability setups with multiple confirmations",
  "Law #7: No Revenge Trading - No re-entry after stop loss without new analysis",
  "Law #8: Market Hours - Only trade during active market sessions",
  "Law #9: Stop Loss Mandatory - Every trade must have a stop loss",
  "Law #10: Take Profit Strategy - Define clear profit targets before entry"
];

interface Strategy {
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
  riskRewardRatio: number;
  feasible: boolean;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}

interface AnalysisResult {
  strategies: Strategy[];
  summary: string;
  confidence: 'high' | 'medium' | 'low';
  riskAssessment: string;
}

interface JournalEntry {
  id: string;
  timestamp: string;
  type: 'entry' | 'modification' | 'exit' | 'update' | 'pause';
  title: string;
  message: string;
  tradeId?: string;
  symbol?: string;
  pnl?: number;
  confidence?: 'high' | 'medium' | 'low';
}

class OpenAIService {
  private async makeRequest(messages: any[], temperature: number = 0.7): Promise<any> {
    if (!OPENAI_API_KEY) {
      console.warn('OpenAI API key not configured, using mock data');
      return this.getMockResponse(messages);
    }

    try {
      const response = await fetch(OPENAI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages,
          temperature,
          max_tokens: 2000
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`OpenAI API error: ${response.status} - ${JSON.stringify(errorData)}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('OpenAI API request failed:', error);
      return this.getMockResponse(messages);
    }
  }

  private getMockResponse(messages: any[]): string {
    const lastMessage = messages[messages.length - 1]?.content || '';

    if (lastMessage.includes('journal') || lastMessage.includes('decision')) {
      return JSON.stringify({
        title: 'AI Trade Analysis Complete',
        message: 'Market conditions analyzed. Conservative strategy recommended following Pipnosis Law #1 for capital preservation.',
        confidence: 'high'
      });
    }

    return JSON.stringify({
      strategies: [
        {
          id: 'mock-1',
          name: 'Conservative Growth Strategy',
          risk: 'low',
          symbol: 'EURUSD',
          action: 'buy',
          entry: 1.1425,
          stopLoss: 1.1395,
          takeProfit: 1.1485,
          lotSize: 0.3,
          estimatedGain: 180,
          riskRewardRatio: 2.0,
          feasible: true,
          reasoning: 'Following Pipnosis Laws #1, #2, and #6. Conservative 2% risk with strong technical setup.',
          confidence: 'high'
        }
      ],
      summary: 'Market analysis complete. One high-probability setup identified.',
      confidence: 'high',
      riskAssessment: 'Risk managed per Pipnosis Immutable Laws'
    });
  }

  async interpretPrompt(
    prompt: string,
    accountBalance: number,
    marketData?: any[]
  ): Promise<AnalysisResult> {
    const systemPrompt = `You are Pipnosis AI, an expert forex trading assistant. You must ALWAYS follow these 10 Immutable Laws:

${IMMUTABLE_LAWS.join('\n')}

Analyze the user's trading goal and current market conditions. Generate 1-2 trading strategies (one low-risk, one medium-risk) that comply with ALL laws.

Current account balance: $${accountBalance}
Available pairs: EURUSD, GBPUSD, XAUUSD

Return ONLY valid JSON in this exact format:
{
  "strategies": [
    {
      "id": "unique-id",
      "name": "Strategy Name",
      "risk": "low|medium",
      "symbol": "EURUSD",
      "action": "buy|sell",
      "entry": 1.1425,
      "stopLoss": 1.1395,
      "takeProfit": 1.1485,
      "lotSize": 0.3,
      "estimatedGain": 180,
      "riskRewardRatio": 2.0,
      "feasible": true,
      "reasoning": "Detailed explanation with law references",
      "confidence": "high|medium|low"
    }
  ],
  "summary": "Brief market analysis",
  "confidence": "high|medium|low",
  "riskAssessment": "Risk evaluation statement"
}`;

    const userMessage = `User Goal: "${prompt}"

Market Data: ${JSON.stringify(marketData?.slice(0, 3) || [])}

Generate trading strategies that achieve this goal while strictly following all Pipnosis Laws.`;

    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], 0.7);

      const parsed = JSON.parse(response);

      return {
        strategies: parsed.strategies || [],
        summary: parsed.summary || 'Analysis complete',
        confidence: parsed.confidence || 'medium',
        riskAssessment: parsed.riskAssessment || 'Risk managed'
      };
    } catch (error) {
      console.error('Failed to parse OpenAI response:', error);
      throw new Error('AI analysis failed. Please try again.');
    }
  }

  async generateJournalEntry(
    eventType: string,
    tradeData: any
  ): Promise<JournalEntry> {
    const systemPrompt = `You are Pipnosis AI creating a trading journal entry. Be concise, clear, and reference relevant Immutable Laws when applicable.

Return ONLY valid JSON in this format:
{
  "title": "Entry Title",
  "message": "Detailed message explaining the decision or event",
  "confidence": "high|medium|low"
}`;

    const userMessage = `Event Type: ${eventType}
Trade Data: ${JSON.stringify(tradeData)}

Create a journal entry explaining this trading event.`;

    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], 0.5);

      const parsed = JSON.parse(response);

      return {
        id: `journal-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: eventType as any,
        title: parsed.title || 'Trading Update',
        message: parsed.message || 'Trade event recorded',
        confidence: parsed.confidence || 'medium',
        tradeId: tradeData.tradeId,
        symbol: tradeData.symbol,
        pnl: tradeData.pnl
      };
    } catch (error) {
      console.error('Failed to generate journal entry:', error);
      return {
        id: `journal-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: eventType as any,
        title: 'Trading Update',
        message: 'Event recorded',
        confidence: 'medium'
      };
    }
  }

  async assessFeasibility(
    goal: string,
    balance: number,
    risk: string
  ): Promise<any> {
    const systemPrompt = `You are Pipnosis AI assessing trading goal feasibility. Consider account balance, risk tolerance, and market conditions.

Return ONLY valid JSON:
{
  "feasible": true|false,
  "reasoning": "Detailed explanation",
  "recommendations": ["rec1", "rec2"],
  "estimatedTimeframe": "timeframe",
  "riskLevel": "low|medium|high"
}`;

    const userMessage = `Goal: "${goal}"
Balance: $${balance}
Risk Tolerance: ${risk}

Assess if this goal is achievable and provide recommendations.`;

    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], 0.6);

      return JSON.parse(response);
    } catch (error) {
      console.error('Failed to assess feasibility:', error);
      return {
        feasible: true,
        reasoning: 'Goal appears achievable with proper risk management',
        recommendations: ['Follow Pipnosis Laws', 'Start with low-risk trades'],
        estimatedTimeframe: 'Multiple sessions',
        riskLevel: 'medium'
      };
    }
  }

  async explainDecision(
    decision: string,
    context: any
  ): Promise<string> {
    const systemPrompt = `You are Pipnosis AI explaining a trading decision. Be educational and reference the Immutable Laws.`;

    const userMessage = `Decision: ${decision}
Context: ${JSON.stringify(context)}

Provide a clear explanation of why this decision was made.`;

    try {
      const response = await this.makeRequest([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ], 0.5);

      return response;
    } catch (error) {
      console.error('Failed to explain decision:', error);
      return 'This decision was made following Pipnosis trading principles and market analysis.';
    }
  }
}

export const openAIService = new OpenAIService();
