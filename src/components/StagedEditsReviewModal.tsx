import { useMemo, useState } from 'react';
import { X, Check, Loader2, ShieldCheck, AlertTriangle, Layers } from 'lucide-react';
import { useProjectStore } from '../store/projectStore';
import { applyStagedEditsToStructuredPRD, getStagedEdits } from '../lib/stagedBranchEdits';
import { reviewStagedEdits, type EditReviewFinding } from '../lib/services/prdEditReview';
import { renderPremiumMarkdown } from '../lib/services/prdMarkdownRenderer';
import { normalizeError, userMessage } from '../lib/errors';
import { ErrorBanner } from './ErrorBanner';

interface StagedEditsReviewModalProps {
    projectId: string;
    spineVersionId: string;
    onClose: () => void;
}

const SEVERITY_STYLES: Record<EditReviewFinding['severity'], string> = {
    high: 'border-red-200 bg-red-50 text-red-800',
    medium: 'border-amber-200 bg-amber-50 text-amber-800',
    low: 'border-neutral-200 bg-neutral-50 text-neutral-700',
};

/**
 * Review & Apply overlay for staged edits. Applies every staged branch's patch
 * to the latest structured PRD sequentially (fail-closed per anchor), offers an
 * advisory pre-commit consistency critique, then commits ONE new spine version
 * for the whole batch.
 */
export function StagedEditsReviewModal({ projectId, spineVersionId, onClose }: StagedEditsReviewModalProps) {
    const { getBranchesForSpine, getLatestSpine, applyStagedBranchesToSpine } = useProjectStore();
    const branches = getBranchesForSpine(projectId, spineVersionId);
    const latestSpine = getLatestSpine(projectId);
    const structuredPRD = latestSpine?.structuredPRD;

    const [isReviewing, setIsReviewing] = useState(false);
    const [reviewed, setReviewed] = useState(false);
    const [findings, setFindings] = useState<EditReviewFinding[]>([]);
    const [reviewDegraded, setReviewDegraded] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Sequentially apply the staged edits to preview the combined result and
    // learn which edits apply cleanly vs. need re-selection.
    const preview = useMemo(() => {
        if (!structuredPRD) return null;
        const staged = getStagedEdits(branches);
        return { staged, ...applyStagedEditsToStructuredPRD(structuredPRD, staged) };
    }, [structuredPRD, branches]);

    const branchById = useMemo(
        () => new Map(branches.map(b => [b.id, b])),
        [branches],
    );

    const handleReview = async () => {
        if (!preview || !latestSpine) return;
        setIsReviewing(true);
        setError(null);
        try {
            const appliedEdits = preview.staged.filter(e => preview.applied.includes(e.branchId));
            const afterMarkdown = renderPremiumMarkdown(preview.structuredPRD);
            const result = await reviewStagedEdits({
                beforePrd: latestSpine.responseText,
                afterPrd: afterMarkdown,
                edits: appliedEdits.map(e => ({ anchorText: e.anchorText, replacement: e.replacement })),
            });
            setFindings(result.findings);
            setReviewDegraded(result.degraded);
            setReviewed(true);
        } catch (err) {
            const normalized = normalizeError(err);
            console.error('[Staged edits review failed]', normalized.raw);
            setError(userMessage(normalized));
        } finally {
            setIsReviewing(false);
        }
    };

    const handleApply = () => {
        if (!preview || preview.applied.length === 0) return;
        setIsCommitting(true);
        setError(null);
        try {
            const count = preview.applied.length;
            const editSummary = `Applied ${count} staged edit${count !== 1 ? 's' : ''}`;
            applyStagedBranchesToSpine(
                projectId,
                spineVersionId,
                preview.structuredPRD,
                renderPremiumMarkdown(preview.structuredPRD),
                preview.applied,
                editSummary,
            );
            onClose();
        } catch (err) {
            const normalized = normalizeError(err);
            console.error('[Staged edits apply failed]', normalized.raw);
            setError(userMessage(normalized));
            setIsCommitting(false);
        }
    };

    const skippedCount = preview?.skipped.length ?? 0;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex justify-center items-center overflow-y-auto p-4 md:p-8" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-4 border-b border-neutral-200 flex justify-between items-center bg-neutral-50 rounded-t-xl">
                    <div className="flex items-center gap-2">
                        <Layers size={18} className="text-indigo-600" />
                        <div>
                            <h2 className="text-lg font-semibold text-neutral-800">Review &amp; Apply staged edits</h2>
                            <p className="text-sm text-neutral-500">Applied together as a single new version.</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-neutral-400 hover:text-neutral-700 hover:bg-neutral-200 rounded-full transition">
                        <X size={20} />
                    </button>
                </div>

                {error && (
                    <div className="mx-4 mt-4">
                        <ErrorBanner message={error} onDismiss={() => setError(null)} />
                    </div>
                )}

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                    {!structuredPRD ? (
                        <div className="text-sm text-neutral-500 p-6 text-center">
                            Batch consolidation is only available for structured plans.
                        </div>
                    ) : !preview || preview.staged.length === 0 ? (
                        <div className="text-sm text-neutral-500 p-6 text-center">
                            No staged edits. Stage edits from the branches list to review them together.
                        </div>
                    ) : (
                        <>
                            {/* Skipped warning */}
                            {skippedCount > 0 && (
                                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                                    <span>
                                        {skippedCount} staged edit{skippedCount !== 1 ? 's' : ''} could not be applied
                                        cleanly (the anchor text was changed by another edit or is no longer unique) and
                                        will be left staged. Unstage and re-select those passages.
                                    </span>
                                </div>
                            )}

                            {/* Edit list */}
                            <div className="flex flex-col gap-3">
                                {preview.staged.map(edit => {
                                    const branch = branchById.get(edit.branchId);
                                    const willApply = preview.applied.includes(edit.branchId);
                                    return (
                                        <div key={edit.branchId} className={`rounded-lg border p-3 ${willApply ? 'border-neutral-200 bg-white' : 'border-amber-300 bg-amber-50/50'}`}>
                                            <div className="flex items-center justify-between mb-1">
                                                <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500">Anchor</span>
                                                {!willApply && <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">Needs re-selection</span>}
                                            </div>
                                            <p className="text-xs text-neutral-500 italic line-through break-words line-clamp-2">"{branch?.anchorText ?? edit.anchorText}"</p>
                                            <p className="mt-1.5 text-sm text-neutral-800 whitespace-pre-wrap break-words line-clamp-6">{edit.replacement}</p>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Consistency critique */}
                            <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2 text-sm font-medium text-neutral-700">
                                        <ShieldCheck size={16} className="text-indigo-600" />
                                        Consistency check
                                    </div>
                                    <button
                                        onClick={handleReview}
                                        disabled={isReviewing || preview.applied.length === 0}
                                        className="flex items-center gap-1.5 rounded-md border border-indigo-300 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50"
                                    >
                                        {isReviewing ? <><Loader2 size={13} className="animate-spin" /> Checking…</> : reviewed ? 'Re-check' : 'Check consistency'}
                                    </button>
                                </div>
                                <p className="mt-1 text-[11px] text-neutral-400">
                                    Advisory — checks the combined edits against the rest of the plan. It never blocks applying.
                                </p>

                                {reviewed && (
                                    <div className="mt-3 flex flex-col gap-2">
                                        {reviewDegraded ? (
                                            <p className="text-xs text-neutral-500 italic">The check couldn't run this time. You can apply, or re-check.</p>
                                        ) : findings.length === 0 ? (
                                            <div className="flex items-center gap-2 text-sm text-green-700">
                                                <Check size={15} /> No consistency issues found.
                                            </div>
                                        ) : (
                                            findings.map((f, i) => (
                                                <div key={i} className={`rounded-md border p-2 text-xs ${SEVERITY_STYLES[f.severity]}`}>
                                                    <span className="font-semibold uppercase tracking-wide text-[10px]">{f.severity}</span>
                                                    <p className="font-semibold">{f.title}</p>
                                                    <p className="mt-0.5 opacity-90">{f.detail}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-neutral-200 flex items-center justify-between gap-3 bg-neutral-50 rounded-b-xl">
                    <span className="text-xs text-neutral-500">
                        {preview && preview.applied.length > 0
                            ? `${preview.applied.length} edit${preview.applied.length !== 1 ? 's' : ''} will be applied as one version.`
                            : 'Nothing to apply.'}
                    </span>
                    <button
                        onClick={handleApply}
                        disabled={isCommitting || !preview || preview.applied.length === 0}
                        className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                    >
                        {isCommitting ? <><Loader2 size={16} className="animate-spin" /> Applying…</> : <>Apply as one version <Check size={16} /></>}
                    </button>
                </div>
            </div>
        </div>
    );
}
