import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Check,
    ChevronRight,
    Clock,
    FileText,
    Link2,
    Network,
    ShieldCheck,
} from 'lucide-react';
import { ScreenShell } from '../components/ScreenShell';
import { NodeGraph, type GraphSelection } from '../components/NodeGraph';
import {
    RECENT_ACTIVITY,
    TOUR_ASSETS,
    TOUR_PROJECT,
    WORKSPACE_NAV,
} from '../tourData';
import type { ScreenProps } from '../tourTypes';

/** Rich PRD hub content rendered inside the NodeGraph's PRD node. */
function PrdHubCard() {
    return (
        <span className="flex flex-col gap-2">
            <span className="flex items-center gap-2">
                <FileText size={18} className="text-indigo-300" />
                <span className="text-sm font-semibold text-white">Product Requirements Document</span>
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
                    <Check size={11} /> {TOUR_PROJECT.prdVersion} Current
                </span>
            </span>
            <span className="text-xs text-neutral-400">{TOUR_PROJECT.summary}</span>
            <span className="flex items-center gap-3 text-[11px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                    <Clock size={11} /> {TOUR_PROJECT.updated}
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-400">
                    <ShieldCheck size={11} /> Plan committed
                </span>
            </span>
        </span>
    );
}

/**
 * Screen 7 — the connected workspace. A project rail showing the Plan →
 * Challenge → Build → History progression, the committed plan's PRD wired to
 * its generated artifacts (tap any node to trace dependencies), and a tappable
 * recent-activity timeline. Teaches that Synapse keeps the whole project
 * consistent.
 */
export default function ScreenConnections({ reducedMotion }: ScreenProps) {
    const [selected, setSelected] = useState<GraphSelection>('prd');
    const [openActivity, setOpenActivity] = useState<string | null>(RECENT_ACTIVITY[0].id);

    return (
        <ScreenShell
            title="Everything stays"
            accent="connected."
            subtitle="When the product changes, Synapse helps keep the rest of the project aligned."
        >
            <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
                {/* Project rail (desktop) */}
                <aside className="hidden rounded-2xl border border-neutral-700 bg-neutral-800/40 p-4 lg:block">
                    <div className="mb-4 flex items-center gap-2">
                        <Network size={16} className="text-indigo-300" />
                        <span className="text-sm font-semibold text-white">Synapse</span>
                    </div>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">Project</p>
                    <div className="mb-4 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-200">
                        {TOUR_PROJECT.name}
                    </div>
                    <nav className="space-y-1">
                        {/* "Build" is active — this screen shows the committed
                            plan's generated outputs and their connections. */}
                        {WORKSPACE_NAV.map((item) => (
                            <span
                                key={item}
                                className={`block rounded-lg px-3 py-1.5 text-sm ${
                                    item === 'Build' ? 'bg-indigo-500/15 text-indigo-200' : 'text-neutral-400'
                                }`}
                            >
                                {item}
                            </span>
                        ))}
                    </nav>
                    <div className="mt-4 rounded-lg border border-neutral-700 p-3">
                        <p className="text-xs text-neutral-400">Project health</p>
                        <p className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-emerald-400">
                            <Check size={13} /> Good
                        </p>
                        <p className="mt-1 text-[11px] text-neutral-500">All artifacts are up to date</p>
                    </div>
                </aside>

                {/* Main canvas */}
                <div className="space-y-4">
                    <div className="rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                        <div className="mb-4 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-white">Generated Artifacts</h3>
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                                <Check size={13} /> {TOUR_ASSETS.length} of {TOUR_ASSETS.length} up to date
                            </span>
                        </div>
                        <NodeGraph
                            assets={TOUR_ASSETS}
                            selected={selected}
                            onSelect={setSelected}
                            reducedMotion={reducedMotion}
                            prdContent={<PrdHubCard />}
                            showStatus
                        />
                        <p className="mt-4 text-center text-xs text-neutral-500" aria-live="polite">
                            {selected === 'prd'
                                ? 'The PRD drives every artifact — all are highlighted.'
                                : selected
                                  ? `${TOUR_ASSETS.find((a) => a.id === selected)?.name} depends on the PRD.`
                                  : 'Tap the PRD or any artifact to trace its dependencies.'}
                        </p>
                    </div>

                    {/* Recent activity */}
                    <div className="rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                        <h3 className="mb-3 text-sm font-semibold text-white">Recent Activity</h3>
                        <ul className="space-y-1.5">
                            {RECENT_ACTIVITY.map((entry) => {
                                const open = openActivity === entry.id;
                                return (
                                    <li key={entry.id}>
                                        <button
                                            type="button"
                                            onClick={() => setOpenActivity(open ? null : entry.id)}
                                            aria-expanded={open}
                                            className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
                                        >
                                            <span className="w-14 shrink-0 text-xs text-neutral-500">{entry.when}</span>
                                            <span className="rounded-md bg-neutral-700/70 px-1.5 py-0.5 text-xs font-semibold text-neutral-200">
                                                {entry.version}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate text-sm text-neutral-200">{entry.title}</span>
                                            {entry.impact && (
                                                <span className="hidden shrink-0 text-xs text-emerald-400 sm:inline">{entry.impact}</span>
                                            )}
                                            <ChevronRight
                                                size={15}
                                                className={`shrink-0 text-neutral-600 transition-transform ${open ? 'rotate-90' : ''}`}
                                            />
                                        </button>
                                        <AnimatePresence initial={false}>
                                            {open && (
                                                <motion.div
                                                    initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="overflow-hidden pl-[4.75rem] text-xs text-neutral-400"
                                                >
                                                    <p className="pb-2">
                                                        {entry.detail}
                                                        {entry.impact && (
                                                            <span className="mt-1 block text-emerald-400">
                                                                {entry.impact} · dependencies refreshed
                                                            </span>
                                                        )}
                                                    </p>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            </div>

            {/* Callout */}
            <div className="mt-5 flex items-start gap-4 rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
                    <Link2 size={20} />
                </span>
                <div>
                    <p className="text-base font-semibold text-white">Change one thing, everything stays in sync.</p>
                    <p className="mt-1 text-sm text-neutral-400">
                        Update the PRD and Synapse helps keep all downstream artifacts aligned automatically.
                    </p>
                </div>
            </div>
        </ScreenShell>
    );
}
