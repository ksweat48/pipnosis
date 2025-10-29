import React from 'react';
import { Header } from '@/components/Header';

export function AdminDashboard() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <Header />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <h1 className="text-3xl font-bold text-white mb-6">Admin Dashboard</h1>
        <div className="glass-card p-6">
          <div className="text-gray-400">Admin controls and analytics</div>
        </div>
      </main>
    </div>
  );
}
