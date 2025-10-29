import React from 'react';
import { StrategyOption } from '@/types/strategy';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  strategy: StrategyOption;
  accountBalance: number;
}

export function TradeConfirmationModal({ isOpen, onClose, onConfirm, strategy }: Props) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full">
        <h3 className="text-xl font-bold text-white mb-4">Confirm Trade</h3>
        <div className="space-y-2 mb-6 text-gray-300">
          <div>Symbol: {strategy.symbol}</div>
          <div>Action: {strategy.action.toUpperCase()}</div>
          <div>Entry: {strategy.entry}</div>
          <div>Stop Loss: {strategy.stopLoss}</div>
          <div>Take Profit: {strategy.takeProfit}</div>
        </div>
        <div className="flex gap-4">
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600">
            Cancel
          </button>
          <button onClick={onConfirm} className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
