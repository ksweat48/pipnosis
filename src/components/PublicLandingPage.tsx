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
        <div className="mb-4">
          <h1 className="text-7xl md:text-8xl font-bold text-white mb-3 tracking-tight">
            Pipnosis
          </h1>
          <div className="h-0.5 w-32 mx-auto bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />
        </div>
        <p className="text-2xl md:text-3xl text-gray-300 font-light tracking-wide mb-12">
          AI Trading Assistant
        </p>
        <div className="relative inline-block">
          <div className="absolute -inset-px blur opacity-60 rounded-lg animate-pulse">
            <div className="absolute inset-0 bg-white rounded-lg"></div>
          </div>
          <Link
            to="/auth"
            className="relative px-10 py-4 bg-emerald-600 text-white text-lg font-semibold rounded-lg hover:bg-emerald-700 inline-block transition-all hover:scale-105"
            style={{
              boxShadow: '0 0 8px rgba(255, 255, 255, 0.6), 0 0 15px rgba(255, 255, 255, 0.3)'
            }}
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
}
