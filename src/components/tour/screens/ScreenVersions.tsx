import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownUp, GitCompare, History, Star } from 'lucide-react';
import { ScreenShell } from '../components/ScreenShell';
import { VERSIONS, type VersionEntry } from '../tourData';
import type { ScreenProps } from '../tourTypes';

const ids = VERSIONS.map((v) => v.id);

/** Aggregate the change counts + sample diff for the range (older, newer]. */
function compareRange(newerId: string, olderId: string) {
    const newerIdx = VERSIONS.findIndex((v) => v.id === newerId);
    const olderIdx = VERSIONS.findIndex((v) => v.id === olderId);
    // VERSIONS is newest-first, so the newer version has the smaller index.
    const [lo, hi] = newerIdx <= olderIdx ? [newerIdx, olderIdx] : [olderIdx, newerIdx];
    const range = VERSIONS.slice(lo, hi); // versions strictly newer than the older bound
    return range.reduce(
        (acc, v) => {
            acc.additions += v.additions;
            acc.changes += v.changes;
            acc.removals += v.removals;
            acc.diff.push(...v.diff);
            return acc;
        },
        { additions: 0, changes: 0, removals: 0, diff: [] as VersionEntry['diff'] },
    );
}

function CountBadges({ additions, changes, removals }: { additions: number; changes: number; removals: number }) {
    return (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-emerald-400">↑ {additions} additions</span>
            <span className="text-indigo-300">⇄ {changes} changes</span>
            <span className="text-rose-400">↓ {removals} removals</span>
        </div>
    );
}

/**
 * Screen 5 — an interactive version timeline plus a compare panel. Teaches safe
 * experimentation: every refinement is a version you can revisit and diff.
 */
export default function ScreenVersions({ reducedMotion }: ScreenProps) {
    const [selected, setSelected] = useState(ids[0]);
    const [compareA, setCompareA] = useState(ids[0]); // newer
    const [compareB, setCompareB] = useState(ids[2]); // older
    const [showCompare, setShowCompare] = useState(false);

    const comparison = useMemo(() => compareRange(compareA, compareB), [compareA, compareB]);

    return (
        <ScreenShell
            title="Nothing gets lost."
            accent="Every change is versioned."
            subtitle="Every refinement becomes a new version you can revisit, compare, or build on."
        >
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                {/* Timeline */}
                <ol className="relative space-y-3 before:absolute before:left-[7px] before:top-2 before:h-[calc(100%-1rem)] before:w-px before:bg-neutral-700">
                    {VERSIONS.map((v) => {
                        const isSelected = selected === v.id;
                        const isCurrent = v.id === ids[0];
                        return (
                            <li key={v.id} className="relative pl-7">
                                <span
                                    className={`absolute left-0 top-3 h-3.5 w-3.5 rounded-full border-2 ${
                                        isSelected ? 'border-indigo-400 bg-indigo-500' : 'border-neutral-600 bg-neutral-900'
                                    }`}
                                    aria-hidden="true"
                                />
                                <button
                                    type="button"
                                    onClick={() => setSelected(v.id)}
                                    aria-pressed={isSelected}
                                    className={`w-full rounded-xl border p-4 text-left transition ${
                                        isSelected
                                            ? 'border-indigo-400/70 bg-indigo-500/[0.07]'
                                            : 'border-neutral-700 bg-neutral-800/40 hover:border-neutral-500'
                                    }`}
                                >
                                    <div className="mb-1 flex items-center gap-2">
                                        <span className="rounded-md bg-neutral-700/70 px-1.5 py-0.5 text-xs font-semibold text-neutral-200">
                                            {v.id}
                                        </span>
                                        <span className="text-sm font-semibold text-white">{v.title}</span>
                                        {isCurrent && (
                                            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
                                                <Star size={11} /> Current
                                            </span>
                                        )}
                                    </div>
                                    <p className="mb-2 text-xs text-neutral-500">{v.date}</p>
                                    <p className="mb-2 text-sm text-neutral-300">{v.summary}</p>
                                    {(v.additions || v.changes || v.removals) > 0 && (
                                        <CountBadges additions={v.additions} changes={v.changes} removals={v.removals} />
                                    )}

                                    <AnimatePresence initial={false}>
                                        {isSelected && (
                                            <motion.ul
                                                initial={reducedMotion ? false : { opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                className="mt-3 space-y-1.5 overflow-hidden border-t border-neutral-700/70 pt-3"
                                            >
                                                {v.diff.map((d, i) => (
                                                    <li key={i} className="flex gap-2 text-xs">
                                                        <span
                                                            className={
                                                                d.type === 'add'
                                                                    ? 'text-emerald-400'
                                                                    : d.type === 'remove'
                                                                      ? 'text-rose-400'
                                                                      : 'text-indigo-300'
                                                            }
                                                        >
                                                            {d.type === 'add' ? '+' : d.type === 'remove' ? '−' : '~'}
                                                        </span>
                                                        <span className="text-neutral-300">{d.text}</span>
                                                    </li>
                                                ))}
                                            </motion.ul>
                                        )}
                                    </AnimatePresence>
                                </button>
                            </li>
                        );
                    })}
                </ol>

                {/* Compare panel */}
                <div className="h-fit rounded-2xl border border-neutral-700 bg-neutral-800/40 p-5">
                    <div className="mb-1 flex items-center gap-2">
                        <GitCompare size={16} className="text-indigo-300" />
                        <h3 className="text-sm font-semibold text-white">Compare versions</h3>
                    </div>
                    <p className="mb-4 text-xs text-neutral-400">See exactly what changed between any two versions.</p>

                    <div className="space-y-2">
                        {([['A — newer', compareA, setCompareA], ['B — older', compareB, setCompareB]] as const).map(
                            ([label, value, setter]) => (
                                <label key={label} className="block">
                                    <span className="mb-1 block text-[11px] uppercase tracking-wide text-neutral-500">{label}</span>
                                    <select
                                        value={value}
                                        onChange={(e) => setter(e.target.value)}
                                        className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 outline-none transition focus:border-indigo-500"
                                    >
                                        {VERSIONS.map((v) => (
                                            <option key={v.id} value={v.id}>
                                                {v.id} · {v.title}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            ),
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowCompare(true)}
                        disabled={compareA === compareB}
                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-2 text-sm font-medium text-indigo-200 transition hover:bg-indigo-500/20 disabled:opacity-40"
                    >
                        <ArrowDownUp size={15} /> Compare
                    </button>

                    {compareA === compareB && (
                        <p className="mt-2 text-xs text-amber-400/80">Pick two different versions to compare.</p>
                    )}

                    <AnimatePresence>
                        {showCompare && compareA !== compareB && (
                            <motion.div
                                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="mt-4 rounded-xl border border-neutral-700 bg-neutral-900/60 p-4"
                            >
                                <CountBadges
                                    additions={comparison.additions}
                                    changes={comparison.changes}
                                    removals={comparison.removals}
                                />
                                <ul className="mt-3 space-y-1.5">
                                    {comparison.diff.slice(0, 5).map((d, i) => (
                                        <li key={i} className="flex items-center gap-2">
                                            <span
                                                className={`h-2 flex-1 rounded ${
                                                    d.type === 'add'
                                                        ? 'bg-emerald-500/50'
                                                        : d.type === 'remove'
                                                          ? 'bg-rose-500/50'
                                                          : 'bg-indigo-500/50'
                                                }`}
                                            />
                                            <span className="text-xs text-neutral-500">
                                                {d.type === 'add' ? '+' : d.type === 'remove' ? '−' : '~'}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    <div className="mt-5 flex items-start gap-3 border-t border-neutral-700/70 pt-4">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
                            <History size={16} />
                        </span>
                        <p className="text-xs text-neutral-400">
                            <span className="font-semibold text-neutral-200">Safe to experiment.</span> Go back, explore new
                            directions, or merge your favorite ideas. You're always in control.
                        </p>
                    </div>
                </div>
            </div>
        </ScreenShell>
    );
}
