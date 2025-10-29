import React from 'react';
import { Link } from 'react-router-dom';

export function PublicLandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center p-4">
      <div className="text-center">
        <h1 className="text-5xl font-bold text-white mb-6">Pipnosis AI Trading</h1>
        <p className="text-xl text-gray-400 mb-8">AI-Powered Forex Trading Assistant</p>
        <Link to="/auth" className="px-8 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 inline-block">
          Get Started
        </Link>
      </div>
    </div>
  );
}
