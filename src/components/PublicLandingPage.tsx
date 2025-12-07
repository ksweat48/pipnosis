import React from 'react';
import { Link } from 'react-router-dom';

export function PublicLandingPage() {
  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-subtle-zoom"
        style={{
          backgroundImage: 'url(/2_pipnosis_background_hawk_and_candle_image.png)',
          backgroundAttachment: 'fixed'
        }}
      />
      <div className="absolute inset-0 bg-black/60" />

      <div className="text-center relative z-10">
        <h1 className="text-5xl font-bold text-white mb-6">Pipnosis AI Trading</h1>
        <p className="text-xl text-gray-400 mb-8">AI-Powered Forex Trading Assistant</p>
        <Link to="/auth" className="px-8 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 inline-block transition-all hover:scale-105 shadow-lg hover:shadow-emerald-500/25">
          Get Started
        </Link>
      </div>
    </div>
  );
}
