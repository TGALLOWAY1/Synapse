import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, FileText, Sparkles, Zap } from 'lucide-react';
import { ScreenShell } from '../components/ScreenShell';
import { StatusIcon, type StepStatus } from '../components/GenerationStep';
import { ArtifactDrawer } from '../components/ArtifactDrawer';
import { TOUR_ASSETS, TOUR_ASSET_GROUPS, type TourAsset } from '../tourData';
import type { ScreenProps } from '../tourTypes';

const ASSET_GEN_MS = 650;
const allDone = () => TOUR_ASSETS.map(() => 'done' as StepStatus);

/**
 * Screen 5 (hero) — "Mark as Final" finalizes the PRD and the downstream
 * workspace assets generate one at a time, grouped exactly as the real Assets
 * page groups them (Project Foundation → Experience → Architecture →
 * Development). Each finished asset is clickable and opens a lightweight preview
 * drawer. This is the key onboarding moment.
 */
export default function ScreenAssets({ reducedMotion }: ScreenProps) {
    // The screen remounts fresh each time it becomes active, so the hero moment
    // (Mark as Final → assets generate) replays on every return.
    const [finalized, setFinalized] = useState(false);
    const [statuses, setStatuses] = useState<StepStatus[]>(() =>
        reducedMotion ? allDone() : TOUR_ASSETS.map(() => 'queued'),
    );
    const [openAsset, setOpenAsset] = useState<TourAsset | null>(null);
    const timers = useRef<number[]>([]);

    // Clear any in-flight generation timers on unmount.
    useEffect(() => () => timers.current.forEach(clearTimeout), []);

    const markFinal = () => {
        setFinalized(true);
        if (reducedMotion) {
            setStatuses(allDone());
            return;
        }
        let acc = 250;
        TOUR_ASSETS.forEach((_, i) => {
            timers.current.push(
                window.setTimeout(() => setStatuses((p) => p.map((s, j) => (j === i ? 'generating' : s))), acc),
            );
            acc += ASSET_GEN_MS;
            timers.current.push(
                window.setTimeout(() => setStatuses((p) => p.map((s, j) => (j === i ? 'done' : s))), acc),
            );
        });
    };

    const doneCount = statuses.filter((s) => s === 'done').length;
    const generating = finalized && doneCount < TOUR_ASSETS.length;

    return (
        <ScreenShell
            title="One finalized PRD"
            accent="powers the entire workspace."
            subtitle="Mark your PRD as final and Synapse generates all the assets you need to build."
        >
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)]">
                {/* PRD card */}
                <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/[0.05] p-5">
                    <div className="mb-3 flex items-center gap-2">
                        <FileText size={18} className="text-indigo-300" />
                        <span className="text-sm font-semibold text-white">Product Requirements Document</span>
                    </div>
                    <div className="mb-4 space-y-2">
                        {[10, 8, 11, 7].map((w, i) => (
                            <span key={i} className="block h-2 rounded bg-indigo-400/25" style={{ width: `${w * 8}%` }} />
                        ))}
                    </div>
                    <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-300">
                        <Check size={13} /> Looks complete!
                    </div>
                    <button
                        type="button"
                        onClick={markFinal}
                        disabled={finalized}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:bg-emerald-600 disabled:opacity-100"
                    >
                        {finalized ? <Check size={16} /> : <Sparkles size={16} />}
                        {finalized ? 'PRD finalized' : 'Mark as Final'}
                    </button>
                </div>

                {/* Generating orb (decorative, desktop) */}
                <div className="hidden items-center justify-center self-center lg:flex" aria-hidden="true">
                    <motion.span
                        className="flex h-16 w-16 items-center justify-center rounded-full border border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
                        animate={generating && !reducedMotion ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                        transition={{ duration: 1.2, repeat: generating && !reducedMotion ? Infinity : 0 }}
                    >
                        <Sparkles size={22} />
                    </motion.span>
                </div>

                {/* Assets — grouped exactly like the workspace Assets page
                    sidebar (Project Foundation → Experience → Architecture →
                    Development). The generation status array is keyed by the
                    flat TOUR_ASSETS order, so each button looks up its own
                    index. */}
                <div className="space-y-4">
                    {TOUR_ASSET_GROUPS.map((group) => {
                        const groupAssets = TOUR_ASSETS.map((asset, i) => ({ asset, i })).filter(
                            ({ asset }) => asset.group === group.id,
                        );
                        if (groupAssets.length === 0) return null;
                        return (
                            <div key={group.id}>
                                <div className="mb-2 flex items-center gap-2">
                                    <group.icon size={13} className="text-neutral-500" aria-hidden="true" />
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                                        {group.title}
                                    </span>
                                </div>
                                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                                    {groupAssets.map(({ asset, i }) => {
                                        const status = statuses[i];
                                        const isDone = status === 'done';
                                        return (
                                            <button
                                                key={asset.id}
                                                type="button"
                                                disabled={!isDone}
                                                onClick={() => setOpenAsset(asset)}
                                                aria-label={isDone ? `Preview ${asset.name}` : `${asset.name} (not generated yet)`}
                                                className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${
                                                    isDone
                                                        ? 'border-neutral-700 bg-neutral-800/50 hover:border-indigo-500/50 hover:bg-neutral-800'
                                                        : 'border-neutral-800 bg-neutral-800/20'
                                                }`}
                                            >
                                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${asset.accent}`}>
                                                    <asset.icon size={18} aria-hidden="true" />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm font-medium text-neutral-100">{asset.name}</span>
                                                    <span className="block truncate text-xs text-neutral-500">{asset.tagline}</span>
                                                </span>
                                                {status === 'queued' ? (
                                                    <span className="text-[11px] text-neutral-600">Queued</span>
                                                ) : (
                                                    <span className="flex items-center gap-1">
                                                        <StatusIcon status={status} reducedMotion={reducedMotion} size="sm" />
                                                        {isDone && <ChevronRight size={15} className="text-neutral-500" />}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Callout */}
            <div className="mt-5 flex items-start gap-4 rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
                    <Zap size={20} />
                </span>
                <div>
                    <p className="text-base font-semibold text-white">One source of truth. Everything stays in sync.</p>
                    <p className="mt-1 text-sm text-neutral-400">
                        All assets are connected to your PRD so changes flow through the entire workspace.
                        {doneCount > 0 && !generating && ' Tap any asset above to preview it.'}
                    </p>
                </div>
            </div>

            <ArtifactDrawer asset={openAsset} onClose={() => setOpenAsset(null)} reducedMotion={reducedMotion} />
        </ScreenShell>
    );
}
