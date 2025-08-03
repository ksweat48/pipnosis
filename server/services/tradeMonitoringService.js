import cron from 'node-cron';
import { supabase, saveJournalEntry } from '../lib/supabase.js';
import { aiService } from './aiService.js';

class TradeMonitoringService {
  constructor() {
    this.isRunning = false;
    this.activeTrades = new Map();
    this.lastReassessment = new Map();
    this.monitoringInterval = null;
  }

  // Start the trade monitoring service
  start() {
    if (this.isRunning) {
      console.log('⚠️ Trade monitoring service is already running');
      return;
    }

    console.log('🚀 Starting AI Trade Monitoring Service...');
    
    // Schedule monitoring every 5 minutes (as per Immutable Law #10)
    this.monitoringInterval = cron.schedule('*/5 * * * *', async () => {
      await this.monitorAllActiveTrades();
    }, {
      scheduled: true,
      timezone: "UTC"
    });

    this.isRunning = true;
    console.log('✅ Trade monitoring service started - checking every 5 minutes');
  }

  // Stop the trade monitoring service
  stop() {
    if (this.monitoringInterval) {
      this.monitoringInterval.destroy();
      this.monitoringInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Trade monitoring service stopped');
  }

  // Monitor all active trades
  async monitorAllActiveTrades() {
    try {
      console.log('🔍 AI Trade Assistant: Monitoring active trades...');

      // Get all open trades from database
      const { data: activeTrades, error } = await supabase
        .from('trade_records')
        .select('*')
        .eq('status', 'open');

      if (error) {
        console.error('❌ Error fetching active trades:', error);
        return;
      }

      if (!activeTrades || activeTrades.length === 0) {
        console.log('ℹ️ No active trades to monitor');
        return;
      }

      console.log(`📊 Monitoring ${activeTrades.length} active trades`);

      // Monitor each trade
      for (const trade of activeTrades) {
        await this.monitorSingleTrade(trade);
      }

    } catch (error) {
      console.error('❌ Error in trade monitoring:', error);
    }
  }

  // Monitor a single trade and generate AI guidance
  async monitorSingleTrade(trade) {
    try {
      const tradeId = trade.id;
      const userId = trade.user_id;
      const symbol = trade.symbol;

      console.log(`🔍 Monitoring trade ${tradeId} for ${symbol}`);

      // Check if we've already reassessed this trade recently (prevent spam)
      const lastCheck = this.lastReassessment.get(tradeId);
      const now = new Date();
      
      if (lastCheck && (now.getTime() - lastCheck.getTime()) < 4 * 60 * 1000) {
        console.log(`⏭️ Skipping ${tradeId} - reassessed less than 4 minutes ago`);
        return;
      }

      // Get current market data for this symbol
      const currentMarketData = await this.getCurrentMarketData(symbol);
      
      if (!currentMarketData) {
        console.log(`⚠️ No market data available for ${symbol}`);
        return;
      }

      // Calculate current trade performance
      const tradePerformance = this.calculateTradePerformance(trade, currentMarketData);

      // Generate AI guidance
      const guidance = await this.generateAIGuidance(trade, currentMarketData, tradePerformance);

      // Only send guidance if action is required
      if (guidance.actionRequired) {
        console.log(`🤖 AI Guidance for ${symbol}: ${guidance.action}`);

        // Save guidance to journal
        await saveJournalEntry({
          user_id: userId,
          trade_id: tradeId,
          entry_type: 'ai_decision',
          title: guidance.title,
          content: guidance.message,
          confidence_level: guidance.confidence,
          metadata: {
            action: guidance.action,
            currentPrice: currentMarketData.price,
            unrealizedPnL: tradePerformance.unrealizedPnL,
            riskReward: tradePerformance.currentRR
          }
        });

        // Update trade status if needed
        if (guidance.action === 'close_now') {
          await this.closeTrade(tradeId, currentMarketData.price, 'ai_recommendation');
        } else if (guidance.action === 'move_sl_breakeven') {
          await this.updateStopLoss(tradeId, trade.entry_price);
        }
      }

      // Update last reassessment time
      this.lastReassessment.set(tradeId, now);

    } catch (error) {
      console.error(`❌ Error monitoring trade ${trade.id}:`, error);
    }
  }

  // Get current market data for a symbol
  async getCurrentMarketData(symbol) {
    try {
      // In a real implementation, this would fetch live data
      // For now, we'll generate realistic mock data
      const basePrices = {
        'EURUSD': 1.1425,
        'GBPUSD': 1.2735,
        'XAUUSD': 2045.50
      };

      const basePrice = basePrices[symbol] || 1.0000;
      const isGold = symbol === 'XAUUSD';
      
      // Add realistic price movement
      const priceVariation = isGold 
        ? (Math.random() - 0.5) * 10  // ±5 for gold
        : (Math.random() - 0.5) * 0.01; // ±0.005 for forex

      return {
        symbol,
        price: basePrice + priceVariation,
        bid: basePrice + priceVariation - (isGold ? 0.25 : 0.00001),
        ask: basePrice + priceVariation + (isGold ? 0.25 : 0.00001),
        timestamp: new Date().toISOString(),
        trend: Math.random() > 0.5 ? 'bullish' : 'bearish',
        volatility: Math.random() > 0.7 ? 'high' : 'medium'
      };
    } catch (error) {
      console.error('Error getting market data:', error);
      return null;
    }
  }

  // Calculate current trade performance
  calculateTradePerformance(trade, marketData) {
    const entryPrice = parseFloat(trade.entry_price);
    const currentPrice = marketData.price;
    const lotSize = parseFloat(trade.lot_size);
    const stopLoss = parseFloat(trade.stop_loss);
    const takeProfit = parseFloat(trade.take_profit);

    // Calculate unrealized P&L (simplified)
    let unrealizedPnL = 0;
    if (trade.trade_type === 'buy') {
      unrealizedPnL = (currentPrice - entryPrice) * lotSize * 100000; // Simplified calculation
    } else {
      unrealizedPnL = (entryPrice - currentPrice) * lotSize * 100000;
    }

    // Calculate current risk-reward ratio
    const distanceToSL = Math.abs(currentPrice - stopLoss);
    const distanceToTP = Math.abs(takeProfit - currentPrice);
    const currentRR = distanceToSL > 0 ? (distanceToTP / distanceToSL) : 0;

    // Calculate percentage of move toward TP
    const totalTPDistance = Math.abs(takeProfit - entryPrice);
    const currentTPProgress = Math.abs(currentPrice - entryPrice) / totalTPDistance;

    return {
      unrealizedPnL: Math.round(unrealizedPnL * 100) / 100,
      currentRR: Math.round(currentRR * 100) / 100,
      tpProgress: Math.round(currentTPProgress * 100),
      distanceToSL: distanceToSL,
      distanceToTP: distanceToTP,
      priceDirection: trade.trade_type === 'buy' ? 
        (currentPrice > entryPrice ? 'favorable' : 'unfavorable') :
        (currentPrice < entryPrice ? 'favorable' : 'unfavorable')
    };
  }

  // Generate AI guidance based on trade performance and market conditions
  async generateAIGuidance(trade, marketData, performance) {
    try {
      // Default guidance (no action required)
      let guidance = {
        actionRequired: false,
        action: 'hold',
        title: 'Trade Monitoring',
        message: 'Trade is performing as expected. Continue monitoring.',
        confidence: 'medium'
      };

      // Rule 1: Close if 80% of TP distance reached (secure profits)
      if (performance.tpProgress >= 80) {
        guidance = {
          actionRequired: true,
          action: 'close_now',
          title: 'Secure Profits - Close Trade',
          message: `Trade has reached 80% of TP target (${performance.tpProgress}% progress). Following Law #7 (Cut Losses Early, Let Winners Run), I recommend closing now to secure ${performance.unrealizedPnL > 0 ? '+' : ''}$${performance.unrealizedPnL} profit. Market conditions may reverse.`,
          confidence: 'high'
        };
      }
      // Rule 2: Move SL to breakeven if 50% of TP reached
      else if (performance.tpProgress >= 50 && performance.unrealizedPnL > 0) {
        guidance = {
          actionRequired: true,
          action: 'move_sl_breakeven',
          title: 'Move Stop Loss to Breakeven',
          message: `Trade is 50% toward TP target with $${performance.unrealizedPnL} unrealized profit. Following Law #7 (Cut Losses Early, Let Winners Run), I recommend moving stop loss to breakeven to protect gains while allowing for further upside.`,
          confidence: 'high'
        };
      }
      // Rule 3: Close if market conditions have changed significantly
      else if (marketData.volatility === 'high' && performance.priceDirection === 'unfavorable') {
        guidance = {
          actionRequired: true,
          action: 'close_now',
          title: 'Market Conditions Changed - Close Early',
          message: `Market volatility has increased and price is moving against the position. Current unrealized P&L: ${performance.unrealizedPnL > 0 ? '+' : ''}$${performance.unrealizedPnL}. Following Law #7 (Cut Losses Early), I recommend closing to minimize potential losses.`,
          confidence: 'medium'
        };
      }
      // Rule 4: Warning if approaching SL
      else if (performance.distanceToSL < performance.distanceToTP * 0.3) {
        guidance = {
          actionRequired: true,
          action: 'warning',
          title: 'Approaching Stop Loss',
          message: `Price is approaching stop loss level. Current unrealized P&L: ${performance.unrealizedPnL > 0 ? '+' : ''}$${performance.unrealizedPnL}. Following Law #1 (Capital Preservation), monitor closely for potential early exit if trend continues against position.`,
          confidence: 'medium'
        };
      }

      return guidance;

    } catch (error) {
      console.error('Error generating AI guidance:', error);
      return {
        actionRequired: false,
        action: 'hold',
        title: 'Monitoring Error',
        message: 'Unable to analyze trade conditions. Continue monitoring manually.',
        confidence: 'low'
      };
    }
  }

  // Close a trade
  async closeTrade(tradeId, closePrice, reason) {
    try {
      const { error } = await supabase
        .from('trade_records')
        .update({
          status: 'closed',
          current_price: closePrice,
          closed_at: new Date().toISOString(),
          trade_metadata: { close_reason: reason }
        })
        .eq('id', tradeId);

      if (error) {
        console.error('Error closing trade:', error);
      } else {
        console.log(`✅ Trade ${tradeId} closed at ${closePrice} (${reason})`);
      }
    } catch (error) {
      console.error('Error closing trade:', error);
    }
  }

  // Update stop loss
  async updateStopLoss(tradeId, newStopLoss) {
    try {
      const { error } = await supabase
        .from('trade_records')
        .update({
          stop_loss: newStopLoss,
          trade_metadata: { sl_moved_to_breakeven: true }
        })
        .eq('id', tradeId);

      if (error) {
        console.error('Error updating stop loss:', error);
      } else {
        console.log(`✅ Stop loss updated for trade ${tradeId} to ${newStopLoss}`);
      }
    } catch (error) {
      console.error('Error updating stop loss:', error);
    }
  }

  // Get monitoring status
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeTradesCount: this.activeTrades.size,
      lastCheck: new Date().toISOString()
    };
  }
}

// Create singleton instance
export const tradeMonitoringService = new TradeMonitoringService();