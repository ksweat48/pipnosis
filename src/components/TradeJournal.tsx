import React from 'react';

interface Props {
  onReaction: (entryId: string, reaction: 'thumbs-up' | 'explain-more') => void;
}

export function TradeJournal({ onReaction }: Props) {
  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-white mb-4">Trade Journal</h3>
      <div className="text-gray-400 text-sm">No journal entries yet</div>
    </div>
  );
}
