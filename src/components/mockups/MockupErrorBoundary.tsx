import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
    children: ReactNode;
    /** Rendered when the child tree throws during render. */
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
}

/**
 * Lightweight error boundary scoped to mockup rendering. If the MockupViewer
 * or MockupHtmlPreview tree throws (e.g. due to corrupted payload data), this
 * catches it and shows a clean placeholder instead of crashing the entire
 * MockupsView panel.
 */
export class MockupErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[MockupErrorBoundary] Render crash caught:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            return this.props.fallback ?? (
                <div className="bg-white rounded-xl border border-neutral-200 p-6 text-sm text-neutral-500">
                    <p className="font-medium text-neutral-700 mb-1">Unable to render this mockup</p>
                    <p>
                        Something went wrong while displaying this version. Try regenerating the mockup
                        or selecting a different version.
                    </p>
                </div>
            );
        }
        return this.props.children;
    }
}
