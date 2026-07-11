import { useState } from 'react';
import { resetDemoProject } from '../lib/demoRouteHydration';

export function DemoReadOnlyNotice() {
    const [isResetting, setIsResetting] = useState(false);
    const [resetError, setResetError] = useState<string | null>(null);

    const handleReset = async () => {
        if (isResetting) return;
        setIsResetting(true);
        setResetError(null);
        try {
            const result = await resetDemoProject();
            if (!result.available) setResetError('The example could not be restored. Please try again.');
        } catch {
            setResetError('The example could not be restored. Please try again.');
        } finally {
            setIsResetting(false);
        }
    };

    return (
        <div
            role="status"
            aria-live="polite"
            className="shrink-0 bg-indigo-500/10 border-b border-indigo-500/30 text-indigo-200 text-sm px-4 py-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 z-10"
        >
            <span>
                This is a read-only example project. Explore its PRD, screens, mockups, data model,
                implementation plan, and history without changing the saved project. Editing and generation are disabled.
            </span>
            <button
                type="button"
                onClick={handleReset}
                disabled={isResetting}
                className="font-medium underline underline-offset-2 disabled:opacity-60"
            >
                {isResetting ? 'Resetting demo…' : 'Reset demo'}
            </button>
            {resetError && <span role="alert">{resetError}</span>}
        </div>
    );
}
