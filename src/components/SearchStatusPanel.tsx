import React from 'react';

interface Props {
  sessionId: string;
  onSearchComplete: (opportunity: any) => void;
  onSearchTimeout: () => void;
  onCancel: () => void;
}

export function SearchStatusPanel({ sessionId, onCancel }: Props) {
  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-bold text-white mb-4">Extended Search Active</h3>
      <div className="text-gray-400 text-sm mb-4">Searching for opportunities...</div>
      <button onClick={onCancel} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">
        Cancel Search
      </button>
    </div>
  );
}
