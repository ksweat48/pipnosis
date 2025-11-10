import React, { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, DollarSign, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { pollingConfigService } from '@/services/polling-config-service';
import { tradeAudioNotifications } from '@/services/trade-audio-notifications';

interface LivePrice {
  bid: number;
  ask: number;
  timestamp: string;
  spread: number;
}

interface ManualTradePanelProps {
  symbol: string;
  onTradeExecuted?: () => void;
}

export function ManualTradePanel({ symbol, onTradeExecuted }: ManualTradePanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [lotSize, setLotSize] = useState(0.01);
  const [stopLossPips, setStopLossPips] = useState(20);
  const [takeProfitPips, setTakeProfitPips] = useState(40);
  const [limitPrice, setLimitPrice] = useState('');
  const [livePrice, setLivePrice] = useState<LivePrice | null>(null);
  const [balance, setBalance] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    fetchBalance();
    fetchLivePrice();
    const strategy = pollingConfigService.getStrategy();
    const interval = strategy.highInterval;
    const priceInterval = setInterval(fetchLivePrice, interval);
    return () => clearInterval(priceInterval);
  }, [symbol]);

  const fetchBalance = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', user.id)
        .single();

      if (error) throw error;
      if (data) setBalance(parseFloat(data.demo_balance) || 10000);
    } catch (err) {
      console.error('Failed to fetch balance:', err);
    }
  };

  const fetchLivePrice = async () => {
    try {
      // Read from database
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask, spread')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        console.error('Failed to fetch price:', error);
        return;
      }

      const priceData = {
        bid: parseFloat(data.bid),
        ask: parseFloat(data.ask),
        mid: (parseFloat(data.bid) + parseFloat(data.ask)) / 2,
        spread: parseFloat(data.spread)
      };

      const spread = parseFloat(((priceData.spread) * 10000).toFixed(1));

      if (livePrice) {
        const oldMid = (livePrice.bid + livePrice.ask) / 2;
        const newMid = priceData.mid;
        setPriceDirection(newMid > oldMid ? 'up' : newMid < oldMid ? 'down' : null);
        setTimeout(() => setPriceDirection(null), 500);
      }

      setLivePrice({
        bid: priceData.bid,
        ask: priceData.ask,
        timestamp: priceData.timestamp,
        spread
      });
    } catch (err) {
      console.error('Failed to fetch live price:', err);
    }
  };

  const calculatePipValue = (symbol: string, lotSize: number): number => {
    if (symbol.includes('JPY')) {
      return lotSize * 1000;
    }
    return lotSize * 10;
  };

  const calculateRisk = (action: 'buy' | 'sell'): { risk: number; reward: number; ratio: string } => {
    if (!livePrice) return { risk: 0, reward: 0, ratio: '0:0' };

    const entryPrice = action === 'buy' ? livePrice.ask : livePrice.bid;
    const pipValue = calculatePipValue(symbol, lotSize);
    const pointSize = symbol.includes('JPY') ? 0.01 : 0.0001;

    const stopLossPrice = action === 'buy'
      ? entryPrice - (stopLossPips * pointSize)
      : entryPrice + (stopLossPips * pointSize);

    const takeProfitPrice = action === 'buy'
      ? entryPrice + (takeProfitPips * pointSize)
      : entryPrice - (takeProfitPips * pointSize);

    const risk = Math.abs(entryPrice - stopLossPrice) * pipValue * 10;
    const reward = Math.abs(takeProfitPrice - entryPrice) * pipValue * 10;
    const ratio = `1:${(reward / risk).toFixed(2)}`;

    return { risk, reward, ratio };
  };

  const validateTrade = (action: 'buy' | 'sell'): string | null => {
    if (!livePrice) return 'Waiting for live price data...';
    if (lotSize <= 0) return 'Lot size must be greater than 0';
    if (lotSize > 10) return 'Maximum lot size is 10.0';
    if (stopLossPips <= 0) return 'Stop loss must be greater than 0';
    if (takeProfitPips <= 0) return 'Take profit must be greater than 0';

    const { risk } = calculateRisk(action);
    if (risk > balance * 0.05) return 'Risk exceeds 5% of balance';
    if (risk > balance) return 'Insufficient balance for this trade';

    if (orderType === 'limit') {
      const price = parseFloat(limitPrice);
      if (isNaN(price) || price <= 0) return 'Invalid limit price';

      if (action === 'buy' && price >= livePrice.ask) {
        return 'Buy limit must be below current ask price';
      }
      if (action === 'sell' && price <= livePrice.bid) {
        return 'Sell limit must be above current bid price';
      }
    }

    return null;
  };

  const executeTrade = async (action: 'buy' | 'sell') => {
    const validationError = validateTrade(action);
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      if (!livePrice) throw new Error('No live price data available');

      const entryPrice = orderType === 'market'
        ? (action === 'buy' ? livePrice.ask : livePrice.bid)
        : parseFloat(limitPrice);

      const pointSize = symbol.includes('JPY') ? 0.01 : 0.0001;

      const stopLossPrice = action === 'buy'
        ? entryPrice - (stopLossPips * pointSize)
        : entryPrice + (stopLossPips * pointSize);

      const takeProfitPrice = action === 'buy'
        ? entryPrice + (takeProfitPips * pointSize)
        : entryPrice - (takeProfitPips * pointSize);

      const positionData: any = {
        user_id: user.id,
        symbol: symbol.toUpperCase(),
        position_type: action,
        order_type: orderType,
        lot_size: lotSize,
        stop_loss: stopLossPrice,
        take_profit: takeProfitPrice,
        current_pnl: 0
      };

      if (orderType === 'market') {
        positionData.status = 'open';
        positionData.entry_price = entryPrice;
        positionData.current_price = entryPrice;
        positionData.opened_at = new Date().toISOString();
      } else {
        positionData.status = 'pending';
        positionData.limit_price = entryPrice;
      }

      const { data, error: insertError } = await supabase
        .from('simulated_positions')
        .insert(positionData)
        .select()
        .single();

      if (insertError) throw insertError;

      if (orderType === 'market') {
        await supabase
          .from('balance_transactions')
          .insert({
            user_id: user.id,
            transaction_type: 'margin_reserve',
            amount: -lotSize * 1000,
            balance_before: balance,
            balance_after: balance,
            position_id: data.id,
            description: `Margin reserved for ${action} ${symbol} ${lotSize} lots`
          });

        tradeAudioNotifications.playTradeEntrySound();
      }

      await fetchBalance();

      setError(null);
      setLoading(false);

      if (onTradeExecuted) onTradeExecuted();

    } catch (err) {
      console.error('Trade execution failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to execute trade');
      setLoading(false);
    }
  };

  const riskCalculationBuy = calculateRisk('buy');
  const riskCalculationSell = calculateRisk('sell');

  return (
    <div className="bg-gray-900">
      <div className="flex items-center justify-between p-4 bg-gray-800/30">
        <div className="flex items-center space-x-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          <h2 className="text-lg font-semibold text-white">Manual Trading</h2>
          <span className="text-sm text-gray-400">({symbol})</span>
        </div>
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-400">Balance: ${balance.toFixed(2)}</span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-400 hover:text-white transition-colors"
          >
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 space-y-4">
          {livePrice && (
            <div className="grid grid-cols-3 gap-4 p-3 bg-gray-800 rounded">
              <div className="text-center">
                <div className="text-xs text-gray-400 mb-1">BID</div>
                <div className={`text-xl font-bold ${priceDirection === 'down' ? 'text-red-400' : 'text-white'} transition-colors`}>
                  {livePrice.bid.toFixed(symbol.includes('JPY') ? 3 : 5)}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-400 mb-1">SPREAD</div>
                <div className="text-xl font-bold text-yellow-400">
                  {livePrice.spread}
                </div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-400 mb-1">ASK</div>
                <div className={`text-xl font-bold ${priceDirection === 'up' ? 'text-green-400' : 'text-white'} transition-colors`}>
                  {livePrice.ask.toFixed(symbol.includes('JPY') ? 3 : 5)}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setOrderType('market')}
              className={`px-4 py-2 rounded transition-colors ${
                orderType === 'market'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Market Order
            </button>
            <button
              onClick={() => setOrderType('limit')}
              className={`px-4 py-2 rounded transition-colors ${
                orderType === 'limit'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Limit Order
            </button>
          </div>

          {orderType === 'limit' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">Limit Price</label>
              <input
                type="number"
                step="0.00001"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
                placeholder="Enter limit price"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Lot Size</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                value={lotSize}
                onChange={(e) => setLotSize(parseFloat(e.target.value) || 0.01)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              />
              <div className="flex gap-1 mt-1">
                {[0.01, 0.1, 1.0].map(size => (
                  <button
                    key={size}
                    onClick={() => setLotSize(size)}
                    className="flex-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded"
                  >
                    {size}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Stop Loss (pips)</label>
              <input
                type="number"
                step="1"
                min="1"
                value={stopLossPips}
                onChange={(e) => setStopLossPips(parseInt(e.target.value) || 20)}
                className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Take Profit (pips)</label>
            <input
              type="number"
              step="1"
              min="1"
              value={takeProfitPips}
              onChange={(e) => setTakeProfitPips(parseInt(e.target.value) || 40)}
              className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-white"
            />
          </div>

          {error && (
            <div className="flex items-center space-x-2 p-3 bg-red-900/20 border border-red-700 rounded text-red-400">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="p-3 bg-green-900/20 border border-green-700 rounded">
                <div className="text-xs text-green-400 mb-2 font-semibold">BUY CALCULATION</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Risk:</span>
                    <span className="text-red-400">${riskCalculationBuy.risk.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Reward:</span>
                    <span className="text-green-400">${riskCalculationBuy.reward.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">R:R:</span>
                    <span className="text-white font-semibold">{riskCalculationBuy.ratio}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => executeTrade('buy')}
                disabled={loading || !livePrice}
                className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                <TrendingUp className="w-5 h-5" />
                <span>{loading ? 'EXECUTING...' : 'BUY'}</span>
              </button>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-red-900/20 border border-red-700 rounded">
                <div className="text-xs text-red-400 mb-2 font-semibold">SELL CALCULATION</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Risk:</span>
                    <span className="text-red-400">${riskCalculationSell.risk.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Reward:</span>
                    <span className="text-green-400">${riskCalculationSell.reward.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">R:R:</span>
                    <span className="text-white font-semibold">{riskCalculationSell.ratio}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => executeTrade('sell')}
                disabled={loading || !livePrice}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white font-bold py-4 px-6 rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                <TrendingDown className="w-5 h-5" />
                <span>{loading ? 'EXECUTING...' : 'SELL'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
