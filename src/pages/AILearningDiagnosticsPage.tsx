import React from 'react';
import AILearningDiagnosticsPanel from '../components/AILearningDiagnosticsPanel';
import { Activity } from 'lucide-react';

export default function AILearningDiagnosticsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-10 h-10 text-blue-400" />
            <h1 className="text-4xl font-bold">AI Learning System Diagnostics</h1>
          </div>
          <p className="text-gray-400 text-lg">
            Monitor, test, and verify the AI learning system health and performance
          </p>
        </div>

        {/* Diagnostics Panel */}
        <AILearningDiagnosticsPanel />

        {/* Info Section */}
        <div className="mt-8 bg-blue-900/20 border border-blue-500/30 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-white mb-4">About This Diagnostic Tool</h3>
          <div className="space-y-3 text-gray-300">
            <p>
              This diagnostic tool provides real-time monitoring and verification of the AI learning system.
              It checks database connectivity, data integrity, and learning system functionality.
            </p>
            <p>
              <strong className="text-white">What it checks:</strong>
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Database tables exist and are accessible</li>
              <li>Learning insights are being generated from backtests</li>
              <li>Trade analyses are being created and stored</li>
              <li>Performance evolution is tracking over time</li>
              <li>Skill progression system is functioning</li>
              <li>Recent learning activity is occurring</li>
              <li>Database triggers are active and working</li>
            </ul>
            <p className="mt-4">
              <strong className="text-white">How to use:</strong>
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Click <strong className="text-blue-400">Refresh</strong> to update the health status</li>
              <li>Click <strong className="text-blue-400">Run Full Test</strong> to execute comprehensive diagnostics</li>
              <li>Review any issues and follow recommendations</li>
              <li>If issues persist, check console logs for detailed error messages</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
