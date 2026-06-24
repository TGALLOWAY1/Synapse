import { X, RotateCcw } from 'lucide-react';
import type { StructuredPRD } from '../../types';
import {
    diffText, diffStructuredPRD, getDiffSummary,
    type DiffSegment, type SectionDiff,
} from '../../lib/versionDiff';

// Compare a historical version (the "from" side) against the current version.
// PRD mode renders a section-aware diff; text mode (artifacts) a word diff.
// Read-only: the only action is opening the restore confirmation.
export type CompareInput =
    | { kind: 'prd'; before: StructuredPRD | undefined; after: StructuredPRD | undefined }
    | { kind: 'text'; before: string; after: string };

interface VersionCompareViewProps {
    input: CompareInput;
    fromLabel: string;     // e.g. "Version 3"
    toLabel: string;       // e.g. "Current"
    onClose: () => void;
    onRestore?: () => void; // omit to hide the restore affordance
}

function Segments({ segments }: { segments: DiffSegment[] }) {
    if (segments.length === 0) {
        return <span className="text-neutral-400 italic">No changes</span>;
    }
    return (
        <>
            {segments.map((s, i) => {
                if (s.added) {
                    return (
                        <span key={i} className="bg-green-100 text-green-800 rounded-sm">
                            {s.value}
                        </span>
                    );
                }
                if (s.removed) {
                    return (
                        <span key={i} className="bg-red-100 text-red-700 line-through rounded-sm">
                            {s.value}
                        </span>
                    );
                }
                return <span key={i}>{s.value}</span>;
            })}
        </>
    );
}

const KIND_BADGE: Record<SectionDiff['kind'], { label: string; className: string }> = {
    added: { label: 'Added', className: 'bg-green-50 text-green-700 border-green-200' },
    removed: { label: 'Removed', className: 'bg-red-50 text-red-700 border-red-200' },
    changed: { label: 'Changed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    unchanged: { label: 'No changes', className: 'bg-neutral-50 text-neutral-400 border-neutral-200' },
};

export function VersionCompareView({ input, fromLabel, toLabel, onClose, onRestore }: VersionCompareViewProps) {
    const prdDiffs = input.kind === 'prd' ? diffStructuredPRD(input.before, input.after) : [];
    const summary = input.kind === 'prd' ? getDiffSummary(prdDiffs) : null;
    const textSegments = input.kind === 'text' ? diffText(input.before, input.after) : [];

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onClose}>
            <div
                className="bg-white rounded-t-2xl md:rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[92vh] md:max-h-[88vh]"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between p-4 md:p-5 border-b border-neutral-200">
                    <div className="min-w-0">
                        <h2 className="text-base md:text-lg font-bold text-neutral-900">Compare versions</h2>
                        <p className="text-xs text-neutral-500 mt-0.5">
                            <span className="font-medium text-neutral-700">{fromLabel}</span>
                            {' → '}
                            <span className="font-medium text-neutral-700">{toLabel}</span>
                        </p>
                        {summary && (
                            <p className="text-[11px] text-neutral-500 mt-1">
                                {summary.changed} changed · {summary.added} added · {summary.removed} removed
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 rounded-md hover:bg-neutral-100 text-neutral-500 shrink-0"
                        aria-label="Close compare"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-4">
                    {input.kind === 'prd' ? (
                        prdDiffs.map(section => {
                            const badge = KIND_BADGE[section.kind];
                            return (
                                <div key={section.key} className="border border-neutral-200 rounded-lg overflow-hidden">
                                    <div className="flex items-center justify-between px-3 py-2 bg-neutral-50 border-b border-neutral-100">
                                        <span className="text-sm font-semibold text-neutral-800">{section.label}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${badge.className}`}>
                                            {badge.label}
                                        </span>
                                    </div>
                                    {section.kind !== 'unchanged' && (
                                        <div className="px-3 py-2 text-sm text-neutral-700 whitespace-pre-wrap break-words leading-relaxed">
                                            <Segments segments={section.segments} />
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div className="border border-neutral-200 rounded-lg px-3 py-2 text-sm text-neutral-700 whitespace-pre-wrap break-words leading-relaxed">
                            <Segments segments={textSegments} />
                        </div>
                    )}
                </div>

                {/* Footer */}
                {onRestore && (
                    <div className="flex items-center justify-between gap-3 p-4 border-t border-neutral-200">
                        <span className="text-xs text-neutral-500">Restoring from {fromLabel}</span>
                        <button
                            type="button"
                            onClick={onRestore}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition min-h-[44px] md:min-h-0"
                        >
                            <RotateCcw size={14} /> Restore this version
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
