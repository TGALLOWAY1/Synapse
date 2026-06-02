import { useEffect } from 'react';
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

interface FinalizationSuccessModalProps {
    // True once every build asset already has a generated version (e.g. the
    // user re-finalized a spine whose artifacts were generated earlier).
    // Drives the "ready" vs "being created" copy.
    assetsReady: boolean;
    onOpenAssets: () => void;
    onClose: () => void;
}

/**
 * Post-finalization transition. Shown immediately after the user marks a PRD
 * as final so the change is unmistakable: the PRD is locked, build assets are
 * underway, and the next action is to review them. "Open Assets" navigates to
 * the Assets view, opens the artifact panel, and selects the first non-PRD
 * artifact (handled by the parent).
 */
export function FinalizationSuccessModal({
    assetsReady, onOpenAssets, onClose,
}: FinalizationSuccessModalProps) {
    // Escape closes the modal (without navigating) — the PRD stays final.
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="finalize-success-title"
        >
            <div
                className="bg-white text-neutral-900 rounded-2xl shadow-2xl w-full max-w-md p-8 text-center"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mb-5">
                    <CheckCircle2 size={30} className="text-green-600" />
                </div>
                <h2 id="finalize-success-title" className="text-xl font-bold mb-2">
                    PRD Finalized
                </h2>
                <p className="text-neutral-600 text-sm mb-6 flex items-center justify-center gap-1.5">
                    {assetsReady ? (
                        'Your build assets are ready.'
                    ) : (
                        <>
                            <Loader2 size={14} className="text-indigo-500 animate-spin shrink-0" />
                            Your build assets are being created.
                        </>
                    )}
                </p>
                <button
                    type="button"
                    onClick={onOpenAssets}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition"
                >
                    Open Assets
                    <ArrowRight size={16} />
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition"
                >
                    Stay on the PRD
                </button>
            </div>
        </div>
    );
}
