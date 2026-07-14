import { useEffect } from 'react';
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';

interface FinalizationSuccessModalProps {
    assetsGenerated: boolean;
    assetsBuilding: boolean;
    readyToBuild: boolean;
    onOpenAssets: () => void;
    onGenerateAssets: () => void;
    onClose: () => void;
}

/**
 * Post-commitment transition. Committing the reasoning foundation and
 * generating downstream output are deliberately separate choices.
 */
export function FinalizationSuccessModal({
    assetsGenerated, assetsBuilding, readyToBuild, onOpenAssets, onGenerateAssets, onClose,
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
                    {readyToBuild ? 'Plan committed' : 'Working plan committed with open questions'}
                </h2>
                <p className="text-neutral-600 text-sm mb-6 flex items-center justify-center gap-1.5">
                    {assetsBuilding ? (
                        <>
                            <Loader2 size={14} className="text-indigo-500 animate-spin shrink-0" />
                            Downstream outputs are being created from this committed plan.
                        </>
                    ) : assetsGenerated ? 'Existing outputs remain available for alignment review.' : readyToBuild
                        ? 'This version is now the intended basis for implementation. No outputs were generated automatically.'
                        : 'The version is committed, but unresolved reasoning remains visible. Any outputs stay exploratory until readiness improves.'}
                </p>
                <button
                    type="button"
                    autoFocus
                    onClick={assetsGenerated || assetsBuilding ? onOpenAssets : onGenerateAssets}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition"
                >
                    {assetsGenerated || assetsBuilding ? 'Review outputs' : readyToBuild ? 'Generate build foundation' : 'Explore outputs'}
                    <ArrowRight size={16} />
                </button>
                <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full px-4 py-2 text-sm text-neutral-500 hover:text-neutral-700 transition"
                >
                    Keep reviewing the plan
                </button>
            </div>
        </div>
    );
}
