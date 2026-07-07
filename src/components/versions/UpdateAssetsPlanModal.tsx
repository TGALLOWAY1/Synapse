// Update Assets plan — shown on the re-finalize edge when downstream assets
// already exist. Replaces the old silent "regenerate everything" funnel with a
// surgical, per-asset decision: Regenerate / Mark up to date / Decide later.
// Presentational: the caller builds the rows (from the dependency-graph
// evaluation + spine change summary) and executes the confirmed choices.

import { useState } from 'react';
import { AlertTriangle, RefreshCcw, ShieldCheck, X } from 'lucide-react';

export type UpdatePlanChoice = 'update' | 'mark_current' | 'skip';

export interface UpdatePlanRow {
    /** Artifact slot key ('design_system', 'mockup', …). */
    id: string;
    title: string;
    /** Human status ("Needs update", "Up to date", "Not generated", …). */
    statusLabel: string;
    /** True when the asset is stale/missing/errored (drives row emphasis). */
    isStale: boolean;
    /** What changed upstream, when known ("1 feature removed · …"). */
    changeHeadline?: string;
    /** Removed-feature names this asset's content still mentions. */
    removedFeatureNames?: string[];
    /** Advisory: the changed PRD sections aren't ones this asset derives from. */
    likelyUnaffected?: boolean;
    defaultChoice: UpdatePlanChoice;
    /** False when there is nothing to confirm (missing/errored/up-to-date). */
    canMarkCurrent: boolean;
}

interface UpdateAssetsPlanModalProps {
    /** Positional label of the PRD version being finalized ("Version 3"). */
    prdLabel: string;
    /** Headline of what changed since the assets' baseline PRD version. */
    changeHeadline?: string;
    /** "since Version 2" — the baseline the headline compares against. */
    baselineLabel?: string;
    rows: UpdatePlanRow[];
    /** Finalize + apply the choices. Keys are row ids. */
    onConfirm: (choices: Record<string, UpdatePlanChoice>) => void;
    /** Abort — the PRD is NOT finalized. */
    onCancel: () => void;
}

const CHOICE_LABELS: Record<UpdatePlanChoice, string> = {
    update: 'Regenerate',
    mark_current: 'Mark up to date',
    skip: 'Decide later',
};

export function UpdateAssetsPlanModal({
    prdLabel, changeHeadline, baselineLabel, rows, onConfirm, onCancel,
}: UpdateAssetsPlanModalProps) {
    const [choices, setChoices] = useState<Record<string, UpdatePlanChoice>>(
        () => Object.fromEntries(rows.map(r => [r.id, r.defaultChoice])),
    );

    const setChoice = (id: string, choice: UpdatePlanChoice) =>
        setChoices(prev => ({ ...prev, [id]: choice }));

    const updateCount = rows.filter(r => choices[r.id] === 'update').length;
    const keepCount = rows.filter(r => choices[r.id] === 'mark_current').length;
    const skipStaleCount = rows.filter(r => r.isStale && choices[r.id] === 'skip').length;

    const confirmLabel = updateCount > 0
        ? `Finalize & regenerate ${updateCount}${keepCount > 0 ? ` · keep ${keepCount}` : ''}`
        : keepCount > 0
            ? `Finalize & keep ${keepCount} current`
            : 'Finalize only';

    return (
        <div
            className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-4"
            onClick={onCancel}
            role="presentation"
        >
            <div
                className="bg-white rounded-xl shadow-xl border border-neutral-200 w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="update-plan-title"
            >
                <div className="px-5 pt-5 pb-3 shrink-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <h3 id="update-plan-title" className="text-base font-bold text-neutral-900">
                                Update assets for PRD {prdLabel}?
                            </h3>
                            <p className="text-sm text-neutral-600 mt-1">
                                Your assets were generated from an earlier PRD version. Choose what to
                                do with each — nothing is deleted, and current versions stay in history.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onCancel}
                            aria-label="Cancel finalize"
                            className="p-1.5 text-neutral-400 hover:text-neutral-700 transition shrink-0"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    {changeHeadline && (
                        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                            <div className="text-xs font-semibold text-indigo-900">
                                What changed{baselineLabel ? ` ${baselineLabel}` : ''}
                            </div>
                            <p className="text-xs text-indigo-800 mt-0.5 leading-relaxed">{changeHeadline}</p>
                        </div>
                    )}
                </div>

                <div className="px-5 space-y-2 overflow-y-auto min-h-0">
                    {rows.map(row => {
                        const choice = choices[row.id];
                        return (
                            <div
                                key={row.id}
                                className={`rounded-lg border p-3 ${row.isStale ? 'border-amber-200 bg-amber-50/50' : 'border-neutral-200'}`}
                            >
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-neutral-900">{row.title}</span>
                                    <span className={`text-[11px] px-2 py-0.5 rounded-full border font-medium ${
                                        row.isStale
                                            ? 'bg-amber-50 text-amber-800 border-amber-300'
                                            : 'bg-green-50 text-green-700 border-green-200'
                                    }`}>
                                        {row.statusLabel}
                                    </span>
                                </div>
                                {row.changeHeadline && (
                                    <p className="text-[11px] text-neutral-600 mt-1 leading-relaxed">
                                        {row.changeHeadline}
                                    </p>
                                )}
                                {row.removedFeatureNames && row.removedFeatureNames.length > 0 && (
                                    <p className="text-[11px] text-red-700 mt-1 leading-relaxed">
                                        Still references removed feature{row.removedFeatureNames.length === 1 ? '' : 's'}:{' '}
                                        <span className="font-semibold">{row.removedFeatureNames.join(', ')}</span>
                                    </p>
                                )}
                                {row.likelyUnaffected && (
                                    <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed">
                                        The changed PRD sections aren&rsquo;t ones this asset chiefly derives from.
                                    </p>
                                )}
                                <div className="mt-2 inline-flex rounded-lg border border-neutral-200 p-0.5 bg-white">
                                    {(['update', 'mark_current', 'skip'] as UpdatePlanChoice[]).map(c => {
                                        const disabled = c === 'mark_current' && !row.canMarkCurrent;
                                        return (
                                            <button
                                                key={c}
                                                type="button"
                                                disabled={disabled}
                                                onClick={() => setChoice(row.id, c)}
                                                className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition ${
                                                    choice === c
                                                        ? c === 'update'
                                                            ? 'bg-indigo-600 text-white'
                                                            : c === 'mark_current'
                                                                ? 'bg-emerald-600 text-white'
                                                                : 'bg-neutral-600 text-white'
                                                        : disabled
                                                            ? 'text-neutral-300 cursor-not-allowed'
                                                            : 'text-neutral-600 hover:text-neutral-900'
                                                }`}
                                            >
                                                {CHOICE_LABELS[c]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="px-5 py-4 shrink-0 space-y-2">
                    {skipStaleCount > 0 && (
                        <p className="flex items-start gap-1.5 text-[11px] text-amber-700 leading-relaxed">
                            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                            {skipStaleCount} asset{skipStaleCount === 1 ? '' : 's'} will stay flagged as
                            possibly outdated — you can update them later from the Project Map.
                        </p>
                    )}
                    <p className="text-[11px] text-neutral-500 leading-relaxed">
                        Regeneration runs in dependency order; a stale input of a selected asset is
                        included automatically so nothing rebuilds from stale context.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100 rounded-md transition"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={() => onConfirm(choices)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded-md transition"
                        >
                            {updateCount > 0 ? <RefreshCcw size={13} /> : <ShieldCheck size={13} />}
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
