import React, { Component, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class DatabaseErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('[DatabaseErrorBoundary] Caught error:', error);
    console.error('[DatabaseErrorBoundary] Error info:', errorInfo);

    this.setState({
      error,
      errorInfo
    });
  }

  private getErrorType(): { title: string; message: string; isDatabase: boolean } {
    const errorMessage = this.state.error?.message || '';
    const stackTrace = this.state.error?.stack || '';

    if (errorMessage.toLowerCase().includes('chart') ||
        stackTrace.includes('MarketChart') ||
        stackTrace.includes('SyntheticCandlestickChart') ||
        errorMessage.includes('addCandlestickSeries')) {
      return {
        title: 'Chart Display Error',
        message: 'There was an issue initializing the chart component. This is typically a temporary issue.',
        isDatabase: false
      };
    }

    if (errorMessage.toLowerCase().includes('database') ||
        errorMessage.toLowerCase().includes('supabase') ||
        errorMessage.toLowerCase().includes('connection')) {
      return {
        title: 'Database Connection Error',
        message: 'Unable to connect to the database. Please check your connection and try again.',
        isDatabase: true
      };
    }

    return {
      title: 'Application Error',
      message: 'An unexpected error occurred. Please try refreshing the page.',
      isDatabase: false
    };
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const errorType = this.getErrorType();

      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-gray-900 rounded-lg shadow-xl border border-gray-800 p-8">
            <div className="flex items-center justify-center mb-6">
              <div className="p-4 bg-red-500/10 rounded-full">
                <AlertCircle className="w-12 h-12 text-red-500" />
              </div>
            </div>

            <h1 className="text-2xl font-bold text-white mb-2 text-center">
              {errorType.title}
            </h1>

            <p className="text-gray-400 text-center mb-6">
              {errorType.message}
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <div className="mb-6 p-4 bg-gray-800 rounded-lg border border-gray-700">
                <p className="text-xs font-mono text-red-400 mb-2">
                  {this.state.error.message}
                </p>
                {this.state.error.stack && (
                  <details className="mt-2">
                    <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                      Stack trace
                    </summary>
                    <pre className="text-xs text-gray-600 mt-2 overflow-auto max-h-48">
                      {this.state.error.stack}
                    </pre>
                  </details>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors font-medium"
              >
                <RefreshCw size={18} />
                Retry
              </button>

              {!errorType.isDatabase && (
                <button
                  onClick={() => window.history.back()}
                  className="flex-1 px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors font-medium"
                >
                  Go Back
                </button>
              )}
            </div>

            <p className="text-xs text-gray-600 text-center mt-6">
              If this problem persists, please contact support.
            </p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
