import { useState } from 'react';
import { History, X, GitCompare, RotateCcw, Check } from 'lucide-react';
import type { VersionChangeSource } from '../../types';
import { VersionCompareView, type CompareInput } from './VersionCompareView';
import { RevertConfirmModal } from './RevertConfirmModal';

// One row in the version list, normalized so the panel works for PRDs (spine)
// and artifacts alike.
export type VersionEntry = {
    id: string;
    label: string;          // "Version 3"
    isCurrent: boolean;     // latest (PRD) / preferred (artifact)
    createdAt: number;
    changeSource?: VersionChangeSource;
    editSummary?: string;
    // Optional one-line summary of the automatic consistency-review pass that
    // produced/vetted this PRD version (transparency/debugging). PRD only.
    consistencyReview?: string;
};

interface VersionHistoryPanelProps {
    title: string;
    entries: VersionEntry[];          // display order (current first recommended)
    restoreKind: 'prd' | 'artifact';
    // Diff input for "compare this version against current".
    getCompareInput: (id: string) => CompareInput;
    // PRD only: downstream artifacts that would go stale on restore.
    getStaleArtifactTitles?: () => string[];
    onRestore: (id: string) => void;
    onClose: () => void;
}

const SOURCE_LABEL: Record<VersionChangeSource, string> = {
    ai_generation: 'Generated',
    ai_regeneration: 'Regenerated',
    ai_section_retry: 'Section retry',
    branch_merge: 'Branch merge',
    user_edit: 'Edited',
    revert: 'Restored',
    consistency_review: 'Consistency review',
    marked_current: 'Confirmed current',
};

const SOURCE_CLASS: Record<VersionChangeSource, string> = {
    ai_generation: 'bg-blue-50 text-blue-700 border-blue-200',
    ai_regeneration: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    ai_section_retry: 'bg-sky-50 text-sky-700 border-sky-200',
    branch_merge: 'bg-green-50 text-green-700 border-green-200',
    user_edit: 'bg-violet-50 text-violet-700 border-violet-200',
    revert: 'bg-amber-50 text-amber-700 border-amber-200',
    consistency_review: 'bg-teal-50 text-teal-700 border-teal-200',
    marked_current: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function formatTime(ts: number): string {
    return new Date(ts).toLocaleString([], {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

export function VersionHistoryPanel({
    title, entries, restoreKind, getCompareInput, getStaleArtifactTitles, onRestore, onClose,
}: VersionHistoryPanelProps) {
    const [compareId, setCompareId] = useState<string | null>(null);
    const [confirmId, setConfirmId] = useState<string | null>(null);

    const compareEntry = entries.find(e => e.id === compareId) ?? null;
    const confirmEntry = entries.find(e => e.id === confirmId) ?? null;

    const doRestore = (id: string) => {
        onRestore(id);
        setConfirmId(null);
        setCompareId(null);
        onClose();
    };

    return (
        <>
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
                <div
                    className="bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[88vh]"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between p-4 md:p-5 border-b border-neutral-200">
                        <div className="flex items-center gap-2">
                            <History size={18} className="text-indigo-600" />
                            <h2 className="text-base md:text-lg font-bold text-neutral-900">{title}</h2>
                            <span className="bg-neutral-100 text-neutral-500 text-xs px-2 py-0.5 rounded-full font-medium">
                                {entries.length}
                            </span>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500"
                            aria-label="Close version history"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
                        {entries.length === 0 ? (
                            <p className="text-sm text-neutral-400 text-center py-8">No versions yet.</p>
                        ) : (
                            entries.map(entry => (
                                <div
                                    key={entry.id}
                                    className="border border-neutral-200 rounded-lg p-3 hover:border-neutral-300 transition"
                                >
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-neutral-800">{entry.label}</span>
                                        {entry.isCurrent && (
                                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium bg-emerald-50 text-emerald-700 border-emerald-200">
                                                <Check size={10} /> {restoreKind === 'prd' ? 'Current' : 'Preferred'}
                                            </span>
                                        )}
                                        {entry.changeSource && (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${SOURCE_CLASS[entry.changeSource]}`}>
                                                {SOURCE_LABEL[entry.changeSource]}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-neutral-400 mt-1">{formatTime(entry.createdAt)}</div>
                                    {entry.editSummary && (
                                        <div className="text-xs text-neutral-600 mt-1 break-words">{entry.editSummary}</div>
                                    )}
                                    {entry.consistencyReview && (
                                        <div className="text-[11px] text-teal-700 mt-1 break-words">
                                            <span className="font-medium">Consistency review:</span> {entry.consistencyReview}
                                        </div>
                                    )}
                                    {!entry.isCurrent && (
                                        <div className="flex items-center gap-2 mt-2">
                                            <button
                                                type="button"
                                                onClick={() => setCompareId(entry.id)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md transition min-h-[36px]"
                                            >
                                                <GitCompare size={12} /> Compare
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setConfirmId(entry.id)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-md transition min-h-[36px]"
                                            >
                                                <RotateCcw size={12} /> Restore
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            {compareEntry && (
                <VersionCompareView
                    input={getCompareInput(compareEntry.id)}
                    fromLabel={compareEntry.label}
                    toLabel="Current"
                    onClose={() => setCompareId(null)}
                    onRestore={() => setConfirmId(compareEntry.id)}
                />
            )}

            {confirmEntry && (
                <RevertConfirmModal
                    kind={restoreKind}
                    sourceLabel={confirmEntry.label}
                    staleArtifactTitles={restoreKind === 'prd' ? getStaleArtifactTitles?.() ?? [] : []}
                    onCancel={() => setConfirmId(null)}
                    onConfirm={() => doRestore(confirmEntry.id)}
                />
            )}
        </>
    );
}
