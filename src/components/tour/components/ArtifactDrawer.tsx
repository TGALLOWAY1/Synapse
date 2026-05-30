import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useIsMobile } from '../../../lib/useIsMobile';
import type { TourAsset } from '../tourData';

/** Lightweight per-kind preview rendered inside the drawer. All demo data. */
function AssetPreviewBody({ asset }: { asset: TourAsset }) {
    const { previewKind, preview } = asset;

    if (previewKind === 'flow' || previewKind === 'roadmap') {
        return (
            <ol className="space-y-2">
                {preview.map((step, i) => (
                    <li key={step} className="flex items-center gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-500/15 text-xs font-semibold text-indigo-300">
                            {i + 1}
                        </span>
                        <span className="text-sm text-neutral-200">{step}</span>
                        {previewKind === 'flow' && i < preview.length - 1 && (
                            <span className="ml-auto text-neutral-600" aria-hidden="true">→</span>
                        )}
                    </li>
                ))}
            </ol>
        );
    }

    if (previewKind === 'screens') {
        return (
            <div className="grid grid-cols-3 gap-2">
                {preview.map((screen) => (
                    <div key={screen} className="rounded-lg border border-neutral-700 bg-neutral-800/60 p-2">
                        <div className="mb-2 aspect-[9/16] rounded bg-gradient-to-b from-neutral-700/60 to-neutral-800" />
                        <span className="block truncate text-[11px] text-neutral-300">{screen}</span>
                    </div>
                ))}
            </div>
        );
    }

    if (previewKind === 'table') {
        return (
            <div className="overflow-hidden rounded-lg border border-neutral-700">
                {preview.map((entity, i) => (
                    <div
                        key={entity}
                        className={`flex items-center justify-between px-3 py-2 text-sm ${
                            i % 2 ? 'bg-neutral-800/40' : 'bg-neutral-800/20'
                        }`}
                    >
                        <span className="font-mono text-emerald-300">{entity}</span>
                        <span className="text-xs text-neutral-500">entity</span>
                    </div>
                ))}
            </div>
        );
    }

    if (previewKind === 'grid') {
        return (
            <div className="flex flex-wrap gap-2">
                {preview.map((c) => (
                    <span key={c} className="rounded-md border border-neutral-700 bg-neutral-800/60 px-3 py-1.5 text-xs text-neutral-200">
                        {c}
                    </span>
                ))}
            </div>
        );
    }

    if (previewKind === 'palette') {
        const swatch = ['bg-indigo-500', 'bg-neutral-600', 'bg-emerald-500', 'bg-pink-500', 'bg-amber-500'];
        return (
            <ul className="space-y-2">
                {preview.map((token, i) => (
                    <li key={token} className="flex items-center gap-3">
                        <span className={`h-5 w-5 rounded ${swatch[i % swatch.length]}`} aria-hidden="true" />
                        <span className="text-sm text-neutral-200">{token}</span>
                    </li>
                ))}
            </ul>
        );
    }

    // prompt
    return (
        <ul className="space-y-2">
            {preview.map((p) => (
                <li key={p} className="rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2 text-sm text-neutral-200">
                    <span className="mr-1 text-teal-300">›</span>
                    {p}
                </li>
            ))}
        </ul>
    );
}

/**
 * Preview drawer for a generated artifact. Bottom sheet on mobile, right-hand
 * drawer on desktop — mirrors the SelectionActionDialog responsive pattern
 * (safe-area insets, backdrop dismiss, Escape to close).
 */
export function ArtifactDrawer({
    asset,
    onClose,
    reducedMotion,
}: {
    asset: TourAsset | null;
    onClose: () => void;
    reducedMotion: boolean;
}) {
    const isMobile = useIsMobile();

    useEffect(() => {
        if (!asset) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [asset, onClose]);

    const enterFrom = isMobile ? { y: '100%' } : { x: '100%' };
    const settled = isMobile ? { y: 0 } : { x: 0 };
    const panelMotion = reducedMotion
        ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
        : { initial: enterFrom, animate: settled, exit: enterFrom };

    return (
        <AnimatePresence>
            {asset && (
                <>
                    <motion.div
                        className="fixed inset-0 z-50 bg-black/50"
                        onClick={onClose}
                        aria-hidden="true"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    />
                    <motion.div
                        role="dialog"
                        aria-label={`${asset.name} preview`}
                        className={
                            isMobile
                                ? 'fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-neutral-700 bg-neutral-900 p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl'
                                : 'fixed inset-y-0 right-0 z-50 flex w-[420px] max-w-[90vw] flex-col overflow-y-auto border-l border-neutral-700 bg-neutral-900 p-6 shadow-2xl'
                        }
                        {...panelMotion}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                    >
                        {isMobile && (
                            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-neutral-700" aria-hidden="true" />
                        )}
                        <div className="mb-4 flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${asset.accent}`}>
                                    <asset.icon size={20} aria-hidden="true" />
                                </span>
                                <div>
                                    <h3 className="text-base font-semibold text-white">{asset.name}</h3>
                                    <p className="text-xs text-neutral-400">{asset.tagline}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={onClose}
                                className="rounded-lg p-1.5 text-neutral-400 transition hover:bg-white/10 hover:text-white"
                                aria-label="Close preview"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <p className="mb-4 text-xs uppercase tracking-wide text-neutral-500">Preview</p>
                        <AssetPreviewBody asset={asset} />
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
