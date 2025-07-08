// Simple mock data hook to replace Supabase database functionality

import { useState, useEffect, useCallback } from 'react';

export const useDatabaseStats = () => {
  const [stats, setStats] = useState({
    openPositions: 0,
    totalPrompts: 0,
    totalTrades: 0,
    totalJournalEntries: 0,
    accountValue: 10000,
    winRate: 73.5,
    totalPnL: 385.50
  });
  const [isLoading, setIsLoading] = useState(false);

  const [tradeCounts, setTradeCounts] = useState({
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0
  });

  useEffect(() => {
    try {
      const totalTradesStr = localStorage.getItem('pipnosis_trade_count');
      const winningTradesStr = localStorage.getItem('pipnosis_winning_trades');
      const losingTradesStr = localStorage.getItem('pipnosis_losing_trades');
      
      const totalTrades = totalTradesStr ? parseInt(totalTradesStr, 10) : 0;
      const winningTrades = winningTradesStr ? parseInt(winningTradesStr, 10) : 0;
      const losingTrades = losingTradesStr ? parseInt(losingTradesStr, 10) : 0;
      
      setTradeCounts({
        totalTrades,
        winningTrades,
        losingTrades
      });
      
      setStats(prev => ({
        ...prev,
        totalTrades,
        winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 73.5,
        totalPnL: winningTrades * 50 - losingTrades * 25 // Simple calculation for demo
      }));
      
      console.log('📊 Loaded trade counts:', { totalTrades, winningTrades, losingTrades });
    } catch (error) {
      console.error('Error loading trade counts:', error);
    }
  }, []);

  const updateTradeCount = useCallback((success: boolean = true) => {
    try {
      const totalTradesStr = localStorage.getItem('pipnosis_trade_count') || '0';
      const winningTradesStr = localStorage.getItem('pipnosis_winning_trades') || '0';
      const losingTradesStr = localStorage.getItem('pipnosis_losing_trades') || '0';
      
      const totalTrades = parseInt(totalTradesStr, 10) + 1;
      const winningTrades = parseInt(winningTradesStr, 10) + (success ? 1 : 0);
      const losingTrades = parseInt(losingTradesStr, 10) + (success ? 0 : 1);
      
      localStorage.setItem('pipnosis_trade_count', totalTrades.toString());
      localStorage.setItem('pipnosis_winning_trades', winningTrades.toString());
      localStorage.setItem('pipnosis_losing_trades', losingTrades.toString());
      
      setStats(prev => ({
        ...prev,
        totalTrades,
        winRate: (winningTrades / totalTrades) * 100,
        totalPnL: winningTrades * 50 - losingTrades * 25 // Simple calculation for demo
      }));
      
      setTradeCounts({
        totalTrades,
        winningTrades,
        losingTrades
      });
    } catch (error) {
      console.error('Error updating trade count:', error);
    }
  }, []);

  return {
    stats,
    isLoading,
    refreshStats: () => {}, // No-op function since we're not fetching from a database
    updateTradeCount,
    tradeCounts
  };
};