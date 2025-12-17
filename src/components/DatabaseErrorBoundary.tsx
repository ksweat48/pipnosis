import React, { Component, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryCount: number;
}

export class DatabaseErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, retryCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('DatabaseErrorBoundary caught an error:', error, errorInfo);
    this.setState(prev => ({
      error,
      errorInfo,
      retryCount: prev.retryCount + 1
    }));
  }

  handleReset = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full">
            <div className="bg-gray-900 border border-gray-700 rounded-xl p-8">
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600/20 rounded-full mb-4">
                  <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Oops! We hit a snag</h1>
                <p className="text-gray-400">Something unexpected happened. Let's get you back on track!</p>
              </div>

              {import.meta.env.DEV && this.state.error && (
                <div className="bg-gray-800/50 rounded-lg p-4 mb-6">
                  <p className="text-gray-400 text-sm font-mono break-all">
                    {this.state.error.message || 'Unknown error'}
                  </p>
                  {this.state.errorInfo && (
                    <details className="mt-3">
                      <summary className="text-gray-400 text-xs cursor-pointer hover:text-gray-300">
                        Show error details
                      </summary>
                      <pre className="mt-2 text-xs text-gray-500 overflow-auto max-h-40">
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-3 justify-center">
                <button
                  onClick={this.handleReset}
                  className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium transition-all"
                >
                  Try Again
                </button>
                <button
                  onClick={this.handleGoHome}
                  className="px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-all"
                >
                  Go Home
                </button>
              </div>

              {this.state.retryCount > 2 && (
                <div className="mt-4 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
                  <p className="text-blue-400 text-sm">
                    Still having trouble? Try refreshing your browser or come back in a moment.
                  </p>
                </div>
              )}

              <p className="text-center text-gray-500 text-xs mt-6">
                We're here to help! Feel free to try again or head back to the home page.
              </p>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
