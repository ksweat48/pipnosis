class StrategyService {
  async getAvailableStrategies() {
    return [
      { id: 'scalping', name: 'Scalping Strategy' },
      { id: 'swing', name: 'Swing Trading' },
      { id: 'trend', name: 'Trend Following' }
    ];
  }
}

export const strategyService = new StrategyService();
