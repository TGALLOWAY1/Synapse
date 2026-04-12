import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    showDetails: boolean;
}

/**
 * App-wide error boundary. Catches render crashes anywhere in the component
 * tree and shows a full-page recovery screen instead of a blank page.
 */
export class GlobalErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null, showDetails: false };

    static getDerivedStateFromError(error: Error): Partial<State> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[GlobalErrorBoundary] Unhandled render error:', error, info.componentStack);
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        this.setState({ hasError: false, error: null, showDetails: false });
        window.location.href = '/';
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-6">
                    <div className="max-w-md w-full text-center">
                        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="15" y1="9" x2="9" y2="15" />
                                <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                        </div>
                        <h1 className="text-xl font-semibold text-neutral-900 mb-2">Something went wrong</h1>
                        <p className="text-sm text-neutral-500 mb-6">
                            An unexpected error occurred. Your data is safe in local storage.
                        </p>
                        <div className="flex items-center justify-center gap-3 mb-6">
                            <button
                                onClick={this.handleReload}
                                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition"
                            >
                                Reload Application
                            </button>
                            <button
                                onClick={this.handleGoHome}
                                className="px-4 py-2 bg-neutral-200 text-neutral-700 text-sm font-medium rounded-lg hover:bg-neutral-300 transition"
                            >
                                Go Home
                            </button>
                        </div>
                        {this.state.error && (
                            <div className="text-left">
                                <button
                                    onClick={() => this.setState(s => ({ showDetails: !s.showDetails }))}
                                    className="text-xs text-neutral-400 hover:text-neutral-600 transition"
                                >
                                    {this.state.showDetails ? 'Hide' : 'Show'} technical details
                                </button>
                                {this.state.showDetails && (
                                    <pre className="mt-2 p-3 bg-neutral-100 border border-neutral-200 rounded-lg text-xs text-neutral-600 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                                        {this.state.error.message}
                                        {this.state.error.stack && `\n\n${this.state.error.stack}`}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}
