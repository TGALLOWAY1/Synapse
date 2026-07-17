import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronDown,
    CircleDot, ExternalLink, History, Info, ListChecks, ShieldCheck, X,
} from 'lucide-react';
import {
    latestDownstreamUpdatePlanItemState,
    validateDownstreamUpdatePlanEventIntegrity,
    type DownstreamImpactCertainty,
    type DownstreamUpdateDisposition,
    type DownstreamUpdatePlan,
    type DownstreamUpdatePlanEvent,
    type DownstreamUpdatePlanItem,
} from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../../store/projectStore';
import { DownstreamArtifactUpdateProposalReview } from './DownstreamArtifactUpdateProposalReview';

const EMPTY_PLANS: DownstreamUpdatePlan[] = [];
const EMPTY_EVENTS: DownstreamUpdatePlanEvent[] = [];
const EMPTY_LIST: unknown[] = [];

const certaintyOrder: Record<DownstreamImpactCertainty, number> = {
    definite: 0,
    likely: 1,
    possible: 2,
};

const certaintyCopy: Record<DownstreamImpactCertainty, { label: string; detail: string; classes: string }> = {
    definite: {
        label: 'Definite impact',
        detail: 'Durable project evidence establishes a mismatch.',
        classes: 'border-orange-200 bg-orange-50 text-orange-800',
    },
    likely: {
        label: 'Likely impact',
        detail: 'Strong dependency evidence suggests this region needs attention.',
        classes: 'border-amber-200 bg-amber-50 text-amber-800',
    },
    possible: {
        label: 'Review recommended',
        detail: 'The change is relevant, but it does not prove this output is wrong.',
        classes: 'border-sky-200 bg-sky-50 text-sky-800',
    },
};

const dispositionCopy: Record<DownstreamUpdateDisposition, string> = {
    planned: 'Planned',
    deferred: 'Deferred',
    not_applicable: 'Not applicable',
    already_aligned: 'Already aligned',
};

const actionCopy: Record<DownstreamUpdatePlanItem['recommendedAction'], string> = {
    review_only: 'Review this region',
    revise_behavior: 'Revise this behavior',
    remove_obsolete_element: 'Remove an obsolete element',
    add_missing_state: 'Add the missing state',
    reconsider_flow_branch: 'Reconsider this flow branch',
    review_entity: 'Review this entity',
    review_field: 'Review this field',
    review_relationship: 'Review this relationship',
    review_architecture: 'Review this architecture entry',
    review_implementation_plan: 'Review this plan entry',
    confirm_no_change: 'Confirm no change is required',
    gather_information: 'Gather more information',
};

function regionLabel(item: DownstreamUpdatePlanItem): string {
    const region = item.region;
    if (region.kind === 'screen') {
        return `${region.screenName} · ${region.label ?? region.aspect}`;
    }
    if (region.kind === 'flow') {
        return `${region.flowName} · ${region.label ?? (region.stepIndex !== undefined ? `Step ${region.stepIndex + 1}` : region.aspect)}`;
    }
    if (region.kind === 'data_model') {
        return `${region.entityName} · ${region.label ?? region.memberName ?? region.aspect}`;
    }
    if (region.kind === 'implementation_plan') {
        return `${region.section === 'architecture' ? 'Architecture' : region.aspect.replace(/_/g, ' ')} · ${region.label ?? region.entryLabel}`;
    }
    return region.label;
}

function currentRationale(events: DownstreamUpdatePlanEvent[], plan: DownstreamUpdatePlan, itemId: string): string | undefined {
    const latest = [...events]
        .filter(event => event.planId === plan.id
            && event.itemId === itemId
            && event.expectedPlanIntegrityHash === plan.integrityHash
            && event.type === 'disposition_recorded'
            && validateDownstreamUpdatePlanEventIntegrity(event))
        .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id))[0];
    return latest?.type === 'disposition_recorded' ? latest.rationale : undefined;
}

type ReviewItem = DownstreamUpdatePlanItem & {
    disposition?: DownstreamUpdateDisposition;
    priority: number;
    rationale?: string;
};

interface DownstreamUpdatePlanReviewProps {
    projectId: string;
    initialPlanId: string;
    initialItemId?: string;
    onClose: () => void;
    onOpenSource: (planningRecordId?: string) => void;
    onOpenOutput: (plan: DownstreamUpdatePlan, item: DownstreamUpdatePlanItem) => void;
}

export function DownstreamUpdatePlanReview({
    projectId, initialPlanId, initialItemId, onClose, onOpenSource, onOpenOutput,
}: DownstreamUpdatePlanReviewProps) {
    const plans = useProjectStore(state => state.downstreamUpdatePlans[projectId] ?? EMPTY_PLANS);
    const events = useProjectStore(state => state.downstreamUpdatePlanEvents[projectId] ?? EMPTY_EVENTS);
    // These subscriptions intentionally keep currentness reactive. Stable store arrays avoid
    // React 19/Zustand snapshot churn for projects without one of these collections.
    useProjectStore(state => state.spineVersions[projectId] ?? EMPTY_LIST);
    useProjectStore(state => state.artifactVersions[projectId] ?? EMPTY_LIST);
    useProjectStore(state => state.planningRecords[projectId] ?? EMPTY_LIST);
    const appendEvent = useProjectStore(state => state.appendDownstreamUpdatePlanEvent);

    const initialPlan = plans.find(plan => plan.id === initialPlanId);
    const artifactPlans = useMemo(() => plans
        .filter(plan => plan.artifact.artifactId === initialPlan?.artifact.artifactId)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)), [plans, initialPlan?.artifact.artifactId]);
    const [selectedPlanId, setSelectedPlanId] = useState(initialPlanId);
    const [pendingDisposition, setPendingDisposition] = useState<{ itemId: string; disposition: DownstreamUpdateDisposition }>();
    const [rationale, setRationale] = useState('');
    const [error, setError] = useState<string>();
    const closeRef = useRef<HTMLButtonElement>(null);
    const dialogRef = useRef<HTMLElement>(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    const plan = artifactPlans.find(candidate => candidate.id === selectedPlanId) ?? initialPlan;
    const currentness = plan
        ? useProjectStore.getState().getDownstreamUpdatePlanCurrentness(projectId, plan.id)
        : undefined;
    const readOnly = !currentness?.current;

    const items: ReviewItem[] = useMemo(() => {
        if (!plan) return [];
        return plan.items.map(item => {
            const state = latestDownstreamUpdatePlanItemState(plan, events, item.id);
            return {
                ...item,
                disposition: state.disposition,
                priority: state.priority,
                rationale: currentRationale(events, plan, item.id),
            };
        }).sort((a, b) => certaintyOrder[a.certainty] - certaintyOrder[b.certainty]
            || a.priority - b.priority || a.id.localeCompare(b.id));
    }, [events, plan]);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onCloseRef.current();
            if (event.key !== 'Tab' || !dialogRef.current) return;
            const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
                'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
            )];
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            previouslyFocused?.focus();
        };
    }, []);

    useEffect(() => {
        if (!initialItemId) return;
        document.getElementById(`update-plan-item-${initialItemId}`)?.scrollIntoView?.({ block: 'center' });
    }, [initialItemId]);

    if (!plan) return null;

    const recordDisposition = (itemId: string, disposition: DownstreamUpdateDisposition, note?: string) => {
        const result = appendEvent(projectId, plan.id, itemId, {
            type: 'disposition_recorded', disposition, ...(note ? { rationale: note } : {}),
        });
        if (!result.ok) {
            setError(result.reason === 'stale'
                ? 'This plan became historical while it was open. Generate a current plan before recording a choice.'
                : result.reason === 'rationale_required'
                    ? 'Add a short rationale so this consequential choice remains understandable.'
                    : 'This choice could not be recorded. Review the current plan and try again.');
            return;
        }
        setError(undefined);
        setPendingDisposition(undefined);
        setRationale('');
    };

    const chooseDisposition = (itemId: string, disposition: DownstreamUpdateDisposition) => {
        if (disposition === 'planned') return recordDisposition(itemId, disposition);
        setPendingDisposition({ itemId, disposition });
        setRationale('');
        setError(undefined);
    };

    const moveItem = (itemId: string, direction: -1 | 1) => {
        const item = items.find(candidate => candidate.id === itemId);
        if (!item) return;
        // Certainty is a safety ordering, not a user preference. Reorder only
        // within that group so a possible item never displays "Priority 1"
        // beneath a definite item that the UI must keep first.
        const group = items.filter(candidate => candidate.certainty === item.certainty);
        const index = group.findIndex(candidate => candidate.id === itemId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= group.length) return;
        const reordered = [...group];
        [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
        const groupStart = items.findIndex(candidate => candidate.certainty === item.certainty);
        reordered.forEach((candidate, priority) => {
            appendEvent(projectId, plan.id, candidate.id, { type: 'priority_changed', priority: groupStart + priority + 1 });
        });
    };

    const completed = items.filter(item => item.disposition).length;
    const targetSpine = plan.source.targetSpineVersionId.slice(0, 8);

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4" role="presentation" onMouseDown={onClose}>
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="downstream-update-plan-title"
                onMouseDown={event => event.stopPropagation()}
                className="flex max-h-[94vh] w-full min-w-0 flex-col overflow-hidden rounded-t-2xl bg-neutral-50 shadow-2xl md:max-h-[90vh] md:max-w-4xl md:rounded-2xl"
            >
                <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-4 md:px-6">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-600">
                                    <ListChecks size={14} aria-hidden="true" /> Update plan
                                </span>
                                {readOnly ? (
                                    <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">
                                        Historical · read only
                                    </span>
                                ) : (
                                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                        Current plan
                                    </span>
                                )}
                            </div>
                            <h2 id="downstream-update-plan-title" className="mt-1 truncate text-lg font-bold text-neutral-950 md:text-xl">
                                {plan.artifact.title}
                            </h2>
                            <p className="mt-1 text-sm leading-relaxed text-neutral-600">
                                Planning alone does not edit this output. If you later approve and apply a bounded proposal, Synapse creates a new artifact version without regenerating the full output.
                            </p>
                        </div>
                        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close update plan" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600">
                            <X size={20} />
                        </button>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-neutral-600 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="min-w-0 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2">
                            <div className="font-semibold text-indigo-900">What changed</div>
                            <div className="mt-0.5 break-words text-indigo-800">{plan.source.summary}</div>
                            <div className="mt-1 text-[11px] text-indigo-700">
                                Planning spine {targetSpine} · {plan.source.confirmed ? 'Confirmed source change' : 'Source change remains provisional'}
                            </div>
                        </div>
                        {artifactPlans.length > 1 && (
                            <label className="grid gap-1 font-medium text-neutral-700">
                                Plan history
                                <select value={plan.id} onChange={event => setSelectedPlanId(event.target.value)} className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-sm">
                                    {artifactPlans.map((candidate, index) => (
                                        <option key={candidate.id} value={candidate.id}>
                                            {index === 0 ? 'Latest generated plan' : new Date(candidate.createdAt).toLocaleDateString()}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-neutral-500">{completed} of {items.length} items reviewed</span>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => onOpenSource(plan.source.planningRecordId)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                                <ArrowLeft size={14} /> {plan.source.planningRecordId ? 'Open source decision' : 'Open source PRD'}
                            </button>
                        </div>
                    </div>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                    {readOnly && (
                        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                            <History size={16} className="mt-0.5 shrink-0" />
                            <p>This plan no longer describes the current planning spine or output version. Its recommendations and user choices are preserved as history.</p>
                        </div>
                    )}
                    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
                    <div className="space-y-3">
                        {items.map((item) => {
                            const certainty = certaintyCopy[item.certainty];
                            const pending = pendingDisposition?.itemId === item.id ? pendingDisposition : undefined;
                            const certaintyPeers = items.filter(candidate => candidate.certainty === item.certainty);
                            const certaintyIndex = certaintyPeers.findIndex(candidate => candidate.id === item.id);
                            return (
                                <article id={`update-plan-item-${item.id}`} key={item.id} className="min-w-0 scroll-mt-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                                    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${certainty.classes}`}>{certainty.label}</span>
                                                <span className="text-[11px] font-medium text-neutral-500">Priority {item.priority}</span>
                                                {item.disposition && (
                                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                                                        <CheckCircle2 size={11} /> {dispositionCopy[item.disposition]}
                                                    </span>
                                                )}
                                            </div>
                                            <h3 className="mt-2 break-words text-sm font-bold text-neutral-950">{regionLabel(item)}</h3>
                                            <p className="mt-1 break-words text-sm leading-relaxed text-neutral-700">{item.currentInterpretation}</p>
                                        </div>
                                        {!readOnly && items.length > 1 && (
                                            <div className="flex shrink-0 gap-1" aria-label={`Reorder ${regionLabel(item)}`}>
                                                <button type="button" disabled={certaintyIndex === 0} onClick={() => moveItem(item.id, -1)} aria-label="Move earlier within this certainty group" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"><ArrowUp size={16} /></button>
                                                <button type="button" disabled={certaintyIndex === certaintyPeers.length - 1} onClick={() => moveItem(item.id, 1)} aria-label="Move later within this certainty group" className="flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-neutral-200 text-neutral-600 hover:bg-neutral-50 disabled:opacity-30"><ArrowDown size={16} /></button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                                        <div className="flex items-start gap-2">
                                            <CircleDot size={15} className="mt-0.5 shrink-0 text-indigo-600" />
                                            <div className="min-w-0">
                                                <div className="text-xs font-semibold text-neutral-900">Recommended: {actionCopy[item.recommendedAction]}</div>
                                                <p className="mt-0.5 break-words text-xs leading-relaxed text-neutral-600">{item.recommendation}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/70 px-3 py-2.5">
                                        <div className="flex items-start gap-2">
                                            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-emerald-600" />
                                            <div className="min-w-0">
                                                <div className="text-xs font-semibold text-emerald-900">What remains safe</div>
                                                <ul className="mt-1 space-y-1 text-xs leading-relaxed text-emerald-800">
                                                    {item.preservedScope.map(scope => <li key={scope} className="break-words">{scope}</li>)}
                                                </ul>
                                            </div>
                                        </div>
                                    </div>

                                    <details className="mt-3 rounded-lg border border-neutral-200 bg-white px-3 py-2">
                                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-neutral-700">
                                            Why this region? Evidence and ambiguity <ChevronDown size={15} aria-hidden="true" />
                                        </summary>
                                        <div className="border-t border-neutral-100 pb-1 pt-3 text-xs leading-relaxed text-neutral-600">
                                            <p className="break-words"><strong className="text-neutral-800">Dependency:</strong> {item.whyAffected}</p>
                                            <p className="mt-2 break-words"><strong className="text-neutral-800">Certainty:</strong> {certainty.detail}</p>
                                            {item.ambiguity && <p className="mt-2 break-words"><strong className="text-neutral-800">Remaining ambiguity:</strong> {item.ambiguity}</p>}
                                            <div className="mt-3 space-y-2">
                                                {item.evidence.length > 0 ? item.evidence.map(evidence => (
                                                    <div key={evidence.id} className="rounded-md bg-neutral-50 px-2.5 py-2">
                                                        <div className="font-medium text-neutral-800">{evidence.quality === 'direct' ? 'Direct evidence' : evidence.quality === 'inferred' ? 'Inferred support' : 'Incomplete provenance'}</div>
                                                        <div className="mt-0.5 break-words">{evidence.summary}</div>
                                                    </div>
                                                )) : <p className="italic text-neutral-500">No durable evidence identifies a narrower region. Treat this as a bounded review recommendation.</p>}
                                            </div>
                                        </div>
                                    </details>

                                    {item.rationale && (
                                        <p className="mt-3 break-words rounded-lg bg-neutral-50 px-3 py-2 text-xs text-neutral-600">
                                            <strong className="text-neutral-800">User rationale:</strong> {item.rationale}
                                        </p>
                                    )}

                                    {(plan.artifact.slot === 'screen_inventory' || plan.artifact.slot === 'user_flows' || plan.artifact.slot === 'data_model' || plan.artifact.slot === 'implementation_plan') && (
                                        <DownstreamArtifactUpdateProposalReview
                                            projectId={projectId}
                                            plan={plan}
                                            item={item}
                                            readOnly={readOnly}
                                        />
                                    )}

                                    {!readOnly && (
                                        <div className="mt-3 border-t border-neutral-100 pt-3">
                                            <div className="flex flex-wrap gap-2" aria-label={`Choose treatment for ${regionLabel(item)}`}>
                                                <button type="button" onClick={() => chooseDisposition(item.id, 'planned')} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700">Mark planned</button>
                                                <button type="button" onClick={() => chooseDisposition(item.id, 'deferred')} className="min-h-11 rounded-lg border border-neutral-200 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50">Defer</button>
                                                <button type="button" onClick={() => chooseDisposition(item.id, 'not_applicable')} className="min-h-11 rounded-lg border border-neutral-200 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50">Not applicable</button>
                                                <button type="button" onClick={() => chooseDisposition(item.id, 'already_aligned')} className="min-h-11 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-800 hover:bg-emerald-100">Already aligned</button>
                                                <button type="button" onClick={() => onOpenOutput(plan, item)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50"><ExternalLink size={13} /> Open output</button>
                                            </div>
                                            {pending && (
                                                <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                                                    <label className="block text-xs font-semibold text-indigo-950" htmlFor={`update-plan-rationale-${item.id}`}>
                                                        Why is this item {dispositionCopy[pending.disposition].toLowerCase()}?
                                                    </label>
                                                    <textarea id={`update-plan-rationale-${item.id}`} value={rationale} onChange={event => setRationale(event.target.value)} rows={3} className="mt-2 w-full resize-y rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-neutral-900" placeholder="Record enough context for a future reviewer." />
                                                    <div className="mt-2 flex flex-wrap justify-end gap-2">
                                                        <button type="button" onClick={() => setPendingDisposition(undefined)} className="min-h-11 rounded-lg px-3 text-xs font-medium text-neutral-700">Cancel</button>
                                                        <button type="button" disabled={rationale.trim().length < 3} onClick={() => recordDisposition(item.id, pending.disposition, rationale.trim())} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Record choice</button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                    </div>

                    <footer className="mt-4 rounded-xl border border-neutral-200 bg-white p-4">
                        <div className="flex items-start gap-2">
                            <Info size={16} className="mt-0.5 shrink-0 text-neutral-500" />
                            <div className="min-w-0 text-xs leading-relaxed text-neutral-600">
                                <div className="font-semibold text-neutral-900">Unaffected work is preserved</div>
                                <p className="mt-0.5 break-words">{plan.preservedArtifactSummary}</p>
                                <p className="mt-1">Planning does not change artifact content. Only a separately approved selective proposal can create a new version; Synapse does not regenerate the full output or clear alignment automatically.</p>
                            </div>
                        </div>
                    </footer>
                </div>
            </section>
        </div>
    );
}
