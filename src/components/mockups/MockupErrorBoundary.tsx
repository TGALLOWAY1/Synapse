import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { RefreshCcw } from 'lucide-react';

interface Props {
    children: ReactNode;
    /** Rendered when the child tree throws during render. */
    fallback?: ReactNode;
    /**
     * When this value changes between renders, the boundary clears its
     * error state and re-attempts rendering its children. Pass something
     * that uniquely identifies the rendered content (e.g. the mockup
     * version id) so navigating to a different version automatically
     * recovers without a manual click.
     */
    resetKey?: string | number;
}

interface State {
    hasError: boolean;
    /** Snapshot of resetKey at the time the error was captured. */
    capturedResetKey?: string | number;
}

/**
 * Lightweight error boundary scoped to mockup rendering. If the MockupViewer
 * or MockupHtmlPreview tree throws (e.g. due to corrupted payload data or an
 * infinite render loop), this catches it and shows a clean placeholder
 * instead of crashing the entire MockupsView panel. The fallback exposes a
 * "Try again" button so users aren't trapped on the error UI when the
 * surrounding app state has moved on.
 */
export class MockupErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): Partial<State> {
        return { hasError: true };
    }

    static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
        // Auto-reset when the caller swaps to a different rendered subject
        // (e.g. switching mockup version). Without this, hasError stays true
        // forever once a render has thrown — even after the user navigates
        // away — and they get stuck on the fallback indefinitely.
        if (state.hasError && state.capturedResetKey !== props.resetKey) {
            return { hasError: false, capturedResetKey: undefined };
        }
        return null;
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[MockupErrorBoundary] Render crash caught:', error, info.componentStack);
        this.setState({ capturedResetKey: this.props.resetKey });
    }

    private handleReset = () => {
        this.setState({ hasError: false, capturedResetKey: undefined });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback !== undefined) return this.props.fallback;
            return (
                <div className="bg-white rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500">
                    <p className="font-medium text-neutral-700 mb-1">Unable to render this mockup</p>
                    <p>
                        Something went wrong while displaying this version. Try regenerating the mockup
                        or selecting a different version.
                    </p>
                    <button
                        type="button"
                        onClick={this.handleReset}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 transition"
                    >
                        <RefreshCcw size={12} />
                        Try again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
