import React from 'react';

interface Props {
  onComplete: () => void;
}

export function DatabaseSetupWizard({ onComplete }: Props) {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="glass-card p-8 max-w-md">
        <h2 className="text-2xl font-bold text-white mb-4">Database Setup</h2>
        <p className="text-gray-400 mb-6">Setting up your database...</p>
        <button onClick={onComplete} className="w-full px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700">
          Complete Setup
        </button>
      </div>
    </div>
  );
}
