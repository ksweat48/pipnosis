import React, { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { learningPipelineHealthCheck } from '../services/learning-pipeline-health-check';
import LearningPipelineMonitor from '../components/LearningPipelineMonitor';
import GPT4oUsageMonitor from '../components/GPT4oUsageMonitor';
import {
  Activity,
  AlertCircle,
  CheckCircle,
  PlayCircle,
  RefreshCw,
  Download
} from 'lucide-react';

export default function SystemDiagnosticsPage() {
  const { user } = useAuth();
  const [testRunning, setTestRunning] = useState(false);
  const [testResults, setTestResults] = useState<any>(null);

  const runPipelineTest = async () => {
    if (!user) return;

    setTestRunning(true);
    setTestResults(null);

    try {
      const results = await learningPipelineHealthCheck.runPipelineTest(user.id);
      setTestResults(results);
    } catch (error) {
      console.error('[System Diagnostics] Test failed:', error);
      setTestResults({
        success: false,
        stageResults: [{
          stage: 'Pipeline Test',
          passed: false,
          message: `Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      });
    } finally {
      setTestRunning(false);
    }
  };

  const exportDiagnostics = async () => {
    if (!user) return;

    try {
      const report = await learningPipelineHealthCheck.checkPipelineHealth(user.id);
      const diagnosticsData = {
        timestamp: new Date().toISOString(),
        user_id: user.id,
        health_report: report,
        test_results: testResults
      };

      const blob = new Blob([JSON.stringify(diagnosticsData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pipeline-diagnostics-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[System Diagnostics] Export failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">System Diagnostics</h1>
              <p className="text-gray-400">
                Monitor and diagnose the AI learning pipeline in real-time
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={exportDiagnostics}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export Report
              </button>
              <button
                onClick={runPipelineTest}
                disabled={testRunning}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 text-white rounded-lg flex items-center gap-2 transition-colors"
              >
                {testRunning ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Running Test...
                  </>
                ) : (
                  <>
                    <PlayCircle className="w-4 h-4" />
                    Run Pipeline Test
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Test Results */}
        {testResults && (
          <div className={`border rounded-lg p-6 ${
            testResults.success
              ? 'bg-green-500/10 border-green-500/20'
              : 'bg-red-500/10 border-red-500/20'
          }`}>
            <div className="flex items-start gap-3 mb-4">
              {testResults.success ? (
                <CheckCircle className="w-6 h-6 text-green-500 mt-0.5" />
              ) : (
                <AlertCircle className="w-6 h-6 text-red-500 mt-0.5" />
              )}
              <div>
                <h2 className="text-lg font-semibold text-white mb-1">
                  Pipeline Test {testResults.success ? 'Passed' : 'Failed'}
                </h2>
                <p className="text-sm text-gray-400">
                  {testResults.success
                    ? 'All pipeline components are functioning correctly'
                    : 'Some pipeline components have issues that need attention'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {testResults.stageResults.map((result: any, index: number) => (
                <div
                  key={index}
                  className={`p-3 rounded-lg border ${
                    result.passed
                      ? 'bg-green-500/5 border-green-500/20'
                      : 'bg-red-500/5 border-red-500/20'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {result.passed ? (
                      <CheckCircle className="w-4 h-4 text-green-500 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="text-white font-medium">{result.stage}</div>
                      <div className={`text-sm ${
                        result.passed ? 'text-green-300' : 'text-red-300'
                      }`}>
                        {result.message}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* GPT-4o Usage Monitor */}
        <GPT4oUsageMonitor />

        {/* Pipeline Monitor */}
        <LearningPipelineMonitor />

        {/* Info Section */}
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-white mb-3">About Pipeline Monitoring</h2>
          <div className="space-y-3 text-gray-400 text-sm">
            <p>
              The Learning Pipeline Monitor tracks data flow through every stage of the AI learning system.
              Each stage processes data from the previous stage and passes it to the next.
            </p>
            <p>
              <strong className="text-white">Status Indicators:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li><span className="text-green-500">Healthy</span> - Stage is processing data normally (activity within last 2 hours)</li>
              <li><span className="text-yellow-500">Warning</span> - Stage has reduced activity (no activity in 2-24 hours)</li>
              <li><span className="text-gray-500">Idle</span> - Stage is inactive (no activity in 24+ hours)</li>
              <li><span className="text-red-500">Error</span> - Stage has encountered errors and needs attention</li>
            </ul>
            <p>
              <strong className="text-white">Health Score:</strong> A composite score (0-100%) based on all pipeline stages.
              Scores above 75% indicate healthy operation, 50-75% warrant attention, and below 50% require immediate action.
            </p>
            <p>
              <strong className="text-white">Pipeline Test:</strong> Runs diagnostic checks on all components to verify
              they are properly configured and accessible. Use this to troubleshoot issues before running backtests.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
