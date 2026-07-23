import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Accessibility,
    AlertTriangle,
    ArrowRight,
    Boxes,
    Brain,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Circle,
    Clock3,
    Crosshair,
    Database,
    History,
    Link2,
    ListChecks,
    Loader2,
    Lock,
    RefreshCcw,
    Rocket,
    Search,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    User,
    X,
    type LucideIcon,
} from 'lucide-react';
import type {
    DecisionAction,
    DecisionCenterRecordView,
} from './DecisionCenter';
import type {
    AssumptionEvidenceActionGuard,
    AssumptionEvidenceCorrectionInput,
    AssumptionEvidenceInput,
    AssumptionValidationPlanInput,
} from './AssumptionValidationPanel';
import type { AssumptionEvidenceConclusion, AssumptionUncertaintyTreatment } from '../../types';
import { MIN_CLOSURE_REASON_LENGTH } from '../../lib/planning';
import type { BatchVerdictCandidate, BatchVerdictResult } from '../../lib/planning';

export type ReviewSpecialistOption = {
    id: string;
    name: string;
    responsibility: string;
    selectionReason: string;
    /** The concrete goals this specialist scrutinizes, shown in the setup
     * row's expandable detail. Optional — omit it to render no expander. */
    focusAreas?: string[];
    recommended?: boolean;
};

export type ReviewSpecialistProgress = ReviewSpecialistOption & {
    status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
    findingCount?: number;
    error?: string;
    coverageSummary?: string;
    resolvedAreas?: string[];
};

export type ReviewEvidenceItem = {
    id: string;
    sourceLabel: string;
    locator?: string;
    excerpt: string;
};

export type ReviewPerspective = {
    specialistName: string;
    recommendation: string;
};

export type ReviewIssueView = {
    id: string;
    title: string;
    observation: string;
    consequence: string;
    recommendedAction: string;
    kind: 'contradiction' | 'risk' | 'missing_information' | 'recommendation' | 'optional_improvement' | 'decision_needed';
    severity: 'blocking' | 'important' | 'advisory';
    confidence: 'high' | 'medium' | 'low';
    status: 'open' | 'linked' | 'deferred' | 'dismissed' | 'addressed';
    specialistNames: string[];
    affectedSources: string[];
    evidence: ReviewEvidenceItem[];
    perspectives?: ReviewPerspective[];
    disagreement?: boolean;
    dispositionNote?: string;
    planningRecordId?: string;
    sourceFindingIds?: string[];
    updatedAt: number;
    treatmentHistory?: Array<{ action: string; reason?: string; at: number }>;
};

export type ReviewUntriagedFindingView = {
    id: string;
    title: string;
    observation: string;
    consequence: string;
    recommendedAction: string;
    severity: 'blocking' | 'important' | 'advisory';
    confidence: 'high' | 'medium' | 'low';
    specialistName: string;
    affectedSources: string[];
    evidence: ReviewEvidenceItem[];
    /** False when a specialist run references a finding whose persisted detail
     * is unavailable. The exact gap remains visible, but must be re-reviewed
     * rather than converted into evidence-free durable issue state. */
    canTriage?: boolean;
};

export type ReviewRunView = {
    id: string;
    label: string;
    sourceLabel: string;
    capturedAt: number;
    status: 'draft' | 'running' | 'synthesizing' | 'validating' | 'complete' | 'partial' | 'cancelled' | 'interrupted' | 'failed';
    specialists: ReviewSpecialistProgress[];
    issues: ReviewIssueView[];
    untriagedFindings?: ReviewUntriagedFindingView[];
    focus?: string;
    contextChanged?: boolean;
    readinessCoverage?: 'complete' | 'exploratory' | 'incomplete' | 'unverifiable';
    omittedRequiredSpecialistNames?: string[];
    error?: string;
};

export type PlanningRecordView = DecisionCenterRecordView & { sourceIssueIds: string[] };

export type ReviewIssueAction =
    | 'propose_decision'
    | 'add_assumption'
    | 'add_risk'
    | 'request_clarification'
    | 'record_conflict'
    | 'link_existing'
    | 'challenge_decision'
    | 'request_revision'
    | 'defer'
    | 'dismiss'
    | 'already_addressed';

export interface ReviewWorkspaceProps {
    projectName: string;
    recommendedPanel: ReviewSpecialistOption[];
    sourcesInScope: string[];
    missingSources?: string[];
    runs: ReviewRunView[];
    planningRecords: PlanningRecordView[];
    activeRunId?: string;
    initialTab?: 'review' | 'decisions' | 'history';
    initialDecisionId?: string;
    initialIssueId?: string;
    initialFindingId?: string;
    /** Count of still-open planning items. These remain advisory and never
     * disable specialist critique actions. */
    openDecisionCount?: number;
    /** Jumps to the Explore/Build stage from the Decision Center. */
    onContinueToExplore?: () => void;
    busy?: boolean;
    onStartReview: (input: { specialistIds: string[]; focus?: string }) => void | Promise<void>;
    onSelectRun: (runId: string) => void;
    onCancelRun: (runId: string) => void;
    onRetrySpecialist: (runId: string, specialistId: string) => void;
    onRetrySynthesis: (runId: string) => void;
    onActOnIssue: (runId: string, issueId: string, action: ReviewIssueAction, note?: string, planningRecordId?: string) => void;
    onReopenIssue: (runId: string, issueId: string, reason: string, expectedUpdatedAt: number) => void;
    onTriageFinding: (runId: string, findingId: string) => void;
    /** @deprecated Decision Center authority now lives in DecisionCenterContainer. */
    onConfirmPlanningRecord?: (recordId: string) => void;
    /** @deprecated Decision Center authority now lives in DecisionCenterContainer. */
    onReopenPlanningRecord?: (recordId: string) => void;
    onDecidePlanningRecord?: (recordId: string, action: DecisionAction, value?: string, rationale?: string) => void;
    onPrepareDecisionOptions?: (recordId: string) => void;
    onPreviewPlanningRecordImpact?: (recordId: string) => void;
    onApplyPlanningRecordToPlan?: (recordId: string) => void;
    onReviewAlignmentProposal?: (recordId: string, previewId: string, proposalId: string, disposition: 'accepted' | 'rejected' | 'edited' | 'deferred' | 'confirmed_aligned' | 'confirmed_not_applicable', editedValue?: string) => void;
    onRequestAlignmentProposal?: (
        recordId: string,
        previewId: string,
        proposalId: string,
        request: { kind: 'missing_info' | 'different_interpretation'; guidance: string },
    ) => void | Promise<void>;
    onGenerateAssumptionValidationPlan?: (recordId: string) => void;
    onRecordAssumptionValidationPlan?: (recordId: string, input: AssumptionValidationPlanInput) => void;
    onAddAssumptionEvidence?: (recordId: string, input: AssumptionEvidenceInput) => void;
    onCorrectAssumptionEvidence?: (recordId: string, input: AssumptionEvidenceCorrectionInput) => void;
    onRetractAssumptionEvidence?: (recordId: string, input: AssumptionEvidenceActionGuard) => void;
    onInterpretAssumptionEvidence?: (recordId: string) => void;
    onRecordAssumptionOutcome?: (recordId: string, input: {
        conclusion: AssumptionEvidenceConclusion;
        caveats?: string;
        revisitAt?: number;
        revisitCondition?: string;
        sourceInterpretationId?: string;
        sourceInterpretationContentHash?: string;
    }) => void;
    onRecordAssumptionTreatment?: (recordId: string, input: {
        treatment: AssumptionUncertaintyTreatment;
        rationale: string;
        revisitAt?: number;
        revisitCondition?: string;
    }) => void;
    onReopenAssumptionOutcome?: (recordId: string, reason: string) => void;
    recommendationBatchBusy?: boolean;
    recommendationBatchResult?: BatchVerdictResult;
    onAcceptRecommendations?: (candidates: BatchVerdictCandidate[]) => void;
    readOnly?: boolean;
}

const KIND_LABELS: Record<ReviewIssueView['kind'], string> = {
    contradiction: 'Contradiction',
    risk: 'Risk',
    missing_information: 'Missing information',
    recommendation: 'Recommendation',
    optional_improvement: 'Optional improvement',
    decision_needed: 'Decision needed',
};

const ACTIONS: Array<{ id: ReviewIssueAction; label: string; description: string }> = [
    { id: 'propose_decision', label: 'Propose a decision', description: 'Add an open proposal to the Decision Center.' },
    { id: 'add_assumption', label: 'Add an assumption', description: 'Track an inference that still needs validation.' },
    { id: 'add_risk', label: 'Add a risk', description: 'Record a risk that needs an owner or response.' },
    { id: 'request_clarification', label: 'Request clarification', description: 'Keep the question open for user judgment.' },
    { id: 'record_conflict', label: 'Record a conflict', description: 'Preserve a contradiction between sources or recommendations.' },
    { id: 'link_existing', label: 'Link an existing record', description: 'Connect this issue without creating a duplicate.' },
    { id: 'challenge_decision', label: 'Challenge a decision', description: 'Open a challenge without changing the confirmed decision.' },
    { id: 'request_revision', label: 'Request a plan revision', description: 'Record a requested update; no artifact is rewritten automatically.' },
    { id: 'defer', label: 'Defer', description: 'Keep the issue for later with a reason.' },
    { id: 'already_addressed', label: 'Already addressed', description: 'Record where the project already resolves it.' },
    { id: 'dismiss', label: 'Dismiss', description: 'Reject the finding while preserving the audit trail.' },
];

function StatusIcon({ status }: { status: ReviewSpecialistProgress['status'] }) {
    if (status === 'running') return <Loader2 size={15} className="animate-spin text-indigo-600" aria-label="Running" />;
    if (status === 'complete') return <CheckCircle2 size={15} className="text-emerald-600" aria-label="Complete" />;
    if (status === 'failed') return <AlertTriangle size={15} className="text-red-500" aria-label="Failed" />;
    if (status === 'cancelled') return <X size={15} className="text-neutral-400" aria-label="Cancelled" />;
    return <Circle size={15} className="text-neutral-300" aria-label="Queued" />;
}

function CritiqueOpenItemsSuggestion({ count, className = '' }: { count: number; className?: string }) {
    if (count <= 0) return null;
    return (
        <p className={`text-xs leading-5 text-amber-800 ${className}`} role="note">
            {count} open item{count === 1 ? '' : 's'} — critiquing now may re-raise {count === 1 ? 'it' : 'them'}.
        </p>
    );
}

// Each challenger carries a distinct semantic accent (solid icon tile) so the
// panel scans as a set of specialists, not a list of checkboxes. Keyed by the
// registry specialist id; DEFAULT_ACCENT covers any future/unknown specialist.
const SPECIALIST_ACCENTS: Record<string, { icon: LucideIcon; tile: string }> = {
    ai_model_risk: { icon: Brain, tile: 'bg-violet-500' },
    security_privacy: { icon: Lock, tile: 'bg-emerald-500' },
    product_scope: { icon: Crosshair, tile: 'bg-blue-500' },
    ux_behavior: { icon: User, tile: 'bg-orange-500' },
    data_backend: { icon: Database, tile: 'bg-teal-500' },
    architecture: { icon: Boxes, tile: 'bg-indigo-500' },
    accessibility: { icon: Accessibility, tile: 'bg-sky-500' },
    reliability_qa: { icon: ShieldCheck, tile: 'bg-rose-500' },
    delivery_operations: { icon: Rocket, tile: 'bg-amber-500' },
};
const DEFAULT_ACCENT: { icon: LucideIcon; tile: string } = { icon: Sparkles, tile: 'bg-neutral-500' };

const WHAT_HAPPENS_NEXT: Array<{ icon: LucideIcon; title: string; detail: string }> = [
    { icon: Search, title: 'Specialists independently review your plan', detail: 'Each specialist performs a focused critique.' },
    { icon: ListChecks, title: 'Findings become decisions', detail: 'You review findings and choose actions.' },
    { icon: RefreshCcw, title: 'Improve and iterate', detail: 'Refine your plan and rerun the critique when needed.' },
];

function ReviewSetup({
    projectName,
    panel,
    busy,
    readOnly,
    openDecisionCount,
    onStart,
}: {
    projectName: string;
    panel: ReviewSpecialistOption[];
    busy?: boolean;
    readOnly?: boolean;
    openDecisionCount: number;
    onStart: ReviewWorkspaceProps['onStartReview'];
}) {
    const [selected, setSelected] = useState(() => new Set(panel.filter(p => p.recommended !== false).map(p => p.id)));
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const omittedRecommended = panel.filter(option => option.recommended !== false && !selected.has(option.id));
    const allSelected = panel.length > 0 && panel.every(option => selected.has(option.id));

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleExpanded = (id: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const toggleAll = () => setSelected(allSelected ? new Set() : new Set(panel.map(option => option.id)));

    return (
        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
                {/* Primary column — specialist selection */}
                <div className="min-w-0">
                    <div className="mb-5 flex items-start gap-3">
                        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                            <ShieldAlert size={20} />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-2xl font-bold tracking-tight text-neutral-950">Run an optional specialist critique</h1>
                            <p className="mt-2 text-sm leading-6 text-neutral-600">
                                This critique is optional — run it when you want an adversarial second opinion on the current draft.
                                A small panel of specialists will independently inspect {projectName} for contradictions, unsupported
                                assumptions, and implementation risks. Each finding becomes a new decision you choose to act on or set aside.
                            </p>
                            <CritiqueOpenItemsSuggestion count={openDecisionCount} className="mt-2" />
                        </div>
                    </div>

                    <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
                        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
                            <div className="min-w-0">
                                <h2 className="font-semibold text-neutral-900">Recommended panel</h2>
                                <p className="mt-1 text-sm text-neutral-500">Select specialists for this project and its current artifacts.</p>
                            </div>
                            <button
                                type="button"
                                onClick={toggleAll}
                                disabled={readOnly || panel.length === 0}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                <Check size={15} /> {allSelected ? 'Clear all' : 'Select all'}
                            </button>
                        </div>
                        <div className="divide-y divide-neutral-100">
                            {panel.map(specialist => {
                                const accent = SPECIALIST_ACCENTS[specialist.id] ?? DEFAULT_ACCENT;
                                const AccentIcon = accent.icon;
                                const focusAreas = specialist.focusAreas ?? [];
                                const canExpand = focusAreas.length > 0;
                                const isExpanded = expanded.has(specialist.id);
                                return (
                                    <div key={specialist.id} className="transition hover:bg-neutral-50/70">
                                        <div className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
                                            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(specialist.id)}
                                                    onChange={() => toggle(specialist.id)}
                                                    disabled={readOnly}
                                                    className="mt-3.5 h-4 w-4 shrink-0 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className={`mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${accent.tile}`}>
                                                    <AccentIcon size={20} />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="block text-sm font-semibold text-neutral-900">{specialist.name}</span>
                                                    <span className="mt-0.5 block text-sm text-neutral-600">{specialist.responsibility}</span>
                                                    <span className="mt-1 block text-xs text-neutral-400">Why selected: {specialist.selectionReason}</span>
                                                </span>
                                            </label>
                                            {canExpand && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpanded(specialist.id)}
                                                    aria-expanded={isExpanded}
                                                    aria-label={`${isExpanded ? 'Hide' : 'Show'} what ${specialist.name} reviews`}
                                                    className="mt-2 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-600"
                                                >
                                                    <ChevronDown size={18} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                </button>
                                            )}
                                        </div>
                                        {canExpand && isExpanded && (
                                            <div className="px-4 pb-4 sm:px-5">
                                                <div className="rounded-xl border border-neutral-100 bg-neutral-50 p-3 sm:ml-[3.25rem]">
                                                    <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">What this specialist scrutinizes</p>
                                                    <ul className="mt-2 space-y-1.5">
                                                        {focusAreas.slice(0, 5).map((goal, index) => (
                                                            <li key={index} className="flex gap-2 text-xs leading-5 text-neutral-600">
                                                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                                                                <span>{goal}</span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {omittedRecommended.length > 0 && (
                            <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900 sm:px-5">
                                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                                <span>
                                    This narrower review remains useful for exploration, but it will not satisfy build-readiness coverage.
                                    Restore {omittedRecommended.map(option => option.name).join(', ')} for a complete checkpoint challenge.
                                </span>
                            </div>
                        )}
                    </section>
                </div>

                {/* Sidebar — what happens next + primary action */}
                <aside className="lg:sticky lg:top-6">
                    <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
                        <h2 className="font-semibold text-neutral-900">What happens next</h2>
                        <ol className="mt-4 space-y-4">
                            {WHAT_HAPPENS_NEXT.map((step, index) => {
                                const StepIcon = step.icon;
                                return (
                                    <li key={index} className="flex gap-3">
                                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                                            <StepIcon size={17} />
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-neutral-900">{step.title}</p>
                                            <p className="mt-0.5 text-xs leading-5 text-neutral-500">{step.detail}</p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                        <button
                            type="button"
                            disabled={readOnly || selected.size === 0 || busy}
                            onClick={() => void onStart({ specialistIds: [...selected], focus: undefined })}
                            className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                            {readOnly ? 'Reviews are read-only in this example' : 'Start specialist review'}
                        </button>
                        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-neutral-500">
                            <Lock size={12} className="shrink-0" /> Only you can view this critique and its findings.
                        </p>
                    </div>
                </aside>
            </div>
        </div>
    );
}

function ReviewProgress({ run, onCancel, onRetrySpecialist, onRetrySynthesis, openDecisionCount, readOnly }: {
    run: ReviewRunView;
    onCancel: () => void;
    onRetrySpecialist: (id: string) => void;
    onRetrySynthesis: () => void;
    openDecisionCount: number;
    readOnly?: boolean;
}) {
    const completed = run.specialists.filter(s => s.status === 'complete').length;
    const failed = run.specialists.filter(s => s.status === 'failed').length;
    const active = run.status === 'running' || run.status === 'synthesizing' || run.status === 'validating';
    return (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            {active ? <Loader2 size={19} className="animate-spin text-indigo-600" /> : <AlertTriangle size={19} className="text-amber-600" />}
                            <h1 className="text-xl font-bold text-neutral-950">
                                {run.status === 'synthesizing' ? 'Organizing the review' : run.status === 'validating' ? 'Checking the evidence' : run.status === 'interrupted' ? 'Review interrupted' : run.status === 'failed' ? 'Review needs attention' : 'Specialists are reviewing the plan'}
                            </h1>
                        </div>
                        <p className="mt-2 text-sm text-neutral-500">Reviewing {run.sourceLabel}. Completed work is preserved if another specialist fails.</p>
                        {(run.status === 'interrupted' || run.status === 'failed') && (
                            <CritiqueOpenItemsSuggestion count={openDecisionCount} className="mt-2" />
                        )}
                    </div>
                    {active && !readOnly && <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50">Cancel review</button>}
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-neutral-100" aria-label={`${completed} of ${run.specialists.length} specialists complete`}>
                    <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${run.specialists.length ? (completed / run.specialists.length) * 100 : 0}%` }} />
                </div>
                <p className="mt-2 text-xs text-neutral-500">{completed} of {run.specialists.length} specialist reviews complete</p>

                <div className="mt-5 divide-y divide-neutral-100 border-y border-neutral-100">
                    {run.specialists.map(specialist => (
                        <div key={specialist.id} className="flex items-start gap-3 py-4">
                            <span className="mt-0.5"><StatusIcon status={specialist.status} /></span>
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <p className="text-sm font-semibold text-neutral-900">{specialist.name}</p>
                                    {specialist.status === 'complete' && <span className="text-xs text-neutral-400">{specialist.findingCount ?? 0} grounded finding{specialist.findingCount === 1 ? '' : 's'}</span>}
                                </div>
                                <p className="mt-0.5 text-xs text-neutral-500">{specialist.responsibility}</p>
                                {specialist.error && <p className="mt-1 text-xs text-red-600">{specialist.error}</p>}
                                {specialist.status === 'complete' && specialist.findingCount === 0 && specialist.coverageSummary && (
                                    <p className="mt-1 text-xs leading-5 text-emerald-700">{specialist.coverageSummary}</p>
                                )}
                            </div>
                            {specialist.status === 'failed' && !readOnly && (
                                <button type="button" onClick={() => onRetrySpecialist(specialist.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                                    <RefreshCcw size={12} /> Retry
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {failed > 0 && active && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {failed} specialist{failed === 1 ? '' : 's'} failed. The review can still finish with clearly marked coverage gaps.
                    </div>
                )}
                {(run.status === 'interrupted' || run.status === 'failed') && !readOnly && (
                    <div className="mt-5 flex justify-end">
                        <button type="button" onClick={onRetrySynthesis} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                            <RefreshCcw size={14} /> Resume review
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function IssueActionDialog({ issue, planningRecords, onClose, onSubmit }: {
    issue: ReviewIssueView;
    planningRecords: PlanningRecordView[];
    onClose: () => void;
    onSubmit: (action: ReviewIssueAction, note?: string, planningRecordId?: string) => void;
}) {
    const [action, setAction] = useState<ReviewIssueAction>(issue.disagreement ? 'record_conflict' : 'propose_decision');
    const [note, setNote] = useState('');
    const [recordId, setRecordId] = useState('');
    const selected = ACTIONS.find(a => a.id === action)!;
    const noteRequired = action === 'dismiss' || action === 'defer' || action === 'already_addressed' || action === 'request_revision';
    // Dismissal/already-addressed dispositions must satisfy the readiness
    // closure floor here, or the closure gets rejected later at commit time.
    const minReasonLength = action === 'dismiss' || action === 'already_addressed' ? MIN_CLOSURE_REASON_LENGTH : 1;
    const reasonTooShort = noteRequired && note.trim().length < minReasonLength;
    return (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 sm:items-center sm:p-5" role="presentation" onMouseDown={onClose}>
            <div className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:max-w-xl sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="issue-action-title" onMouseDown={e => e.stopPropagation()}>
                <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-neutral-100 bg-white px-4 py-4 sm:px-5">
                    <div>
                        <h2 id="issue-action-title" className="font-semibold text-neutral-950">Resolve this finding</h2>
                        <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{issue.title}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
                </div>
                <div className="space-y-4 p-4 sm:p-5">
                    <label className="block text-sm font-medium text-neutral-800" htmlFor="issue-action">Action</label>
                    <select id="issue-action" value={action} onChange={e => setAction(e.target.value as ReviewIssueAction)} className="min-h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-800">
                        {ACTIONS.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                    <p className="text-xs leading-5 text-neutral-500">{selected.description}</p>
                    {(action === 'link_existing' || action === 'challenge_decision') && (
                        <div>
                            <label className="block text-sm font-medium text-neutral-800" htmlFor="planning-record">
                                {action === 'challenge_decision' ? 'Confirmed decision to challenge' : 'Decision Center record'}
                            </label>
                            <select id="planning-record" value={recordId} onChange={e => setRecordId(e.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm">
                                <option value="">Select a record</option>
                                {planningRecords
                                    .filter(record => action !== 'challenge_decision' || record.status === 'confirmed' || record.status === 'resolved')
                                    .map(record => <option key={record.id} value={record.id}>{record.title}</option>)}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-neutral-800" htmlFor="action-note">{noteRequired ? 'Reason' : 'Note (optional)'}</label>
                        <textarea id="action-note" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={action === 'already_addressed' ? 'Where is this addressed?' : 'Add context for the project record'} className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:bg-white" />
                        {minReasonLength > 1 && (
                            <p className="mt-1.5 text-xs text-neutral-500">
                                Readiness review requires a substantive reason (at least {minReasonLength} characters) to close a finding this way.
                            </p>
                        )}
                    </div>
                    {action === 'request_revision' && <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">This records a revision request. Synapse will not rewrite a confirmed artifact automatically.</p>}
                </div>
                <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-neutral-100 bg-white p-4 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50">Cancel</button>
                    <button type="button" disabled={reasonTooShort || ((action === 'link_existing' || action === 'challenge_decision') && !recordId)} onClick={() => onSubmit(action, note.trim() || undefined, recordId || undefined)} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">Save action</button>
                </div>
            </div>
        </div>
    );
}

function ReopenFindingDialog({ issue, onClose, onSubmit }: {
    issue: ReviewIssueView;
    onClose: () => void;
    onSubmit: (reason: string) => void;
}) {
    const [reason, setReason] = useState('');
    const valid = reason.trim().length >= 10;
    const dialogRef = useRef<HTMLDivElement>(null);
    const reasonRef = useRef<HTMLTextAreaElement>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        reasonRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
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

    return (
        <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 sm:items-center sm:p-5" role="presentation" onMouseDown={onClose}>
            <div ref={dialogRef} className="w-full rounded-t-2xl bg-white shadow-2xl sm:max-w-lg sm:rounded-2xl" role="dialog" aria-modal="true" aria-labelledby="reopen-finding-title" onMouseDown={event => event.stopPropagation()}>
                <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
                    <div>
                        <h2 id="reopen-finding-title" className="font-semibold text-neutral-950">Change this finding's treatment</h2>
                        <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{issue.title}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100"><X size={18} /></button>
                </div>
                <div className="p-4 sm:p-5">
                    <p className="text-sm leading-6 text-neutral-600">This returns the finding to Needs attention. It does not reopen or change any linked decision.</p>
                    <label className="mt-4 block text-sm font-medium text-neutral-800" htmlFor="reopen-finding-reason">Why does this need attention again?</label>
                    <textarea ref={reasonRef} id="reopen-finding-reason" rows={3} value={reason} onChange={event => setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100" />
                    <p className="mt-2 text-xs text-neutral-500">Your rationale is added to the finding's history.</p>
                </div>
                <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 p-4 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50">Cancel</button>
                    <button type="button" disabled={!valid} onClick={() => onSubmit(reason.trim())} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">Return to Needs attention</button>
                </div>
            </div>
        </div>
    );
}

const reviewIssueAnchorId = (issueId: string): string => `review-issue-${issueId}`;
const reviewFindingAnchorId = (findingId: string): string => `review-finding-${findingId}`;

function UntriagedFindingCard({
    finding,
    onTriage,
    onReviewAgain,
    readOnly,
    highlighted,
}: {
    finding: ReviewUntriagedFindingView;
    onTriage: () => void;
    onReviewAgain: () => void;
    readOnly?: boolean;
    highlighted?: boolean;
}) {
    return (
        <article
            id={reviewFindingAnchorId(finding.id)}
            tabIndex={-1}
            className={`scroll-mt-4 rounded-2xl border border-amber-300 bg-amber-50/40 p-4 shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 sm:p-5 ${highlighted ? 'ring-2 ring-indigo-300' : ''}`}
        >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                        <span className="text-amber-800">Needs challenge triage</span>
                        {finding.severity === 'blocking' && <span className="text-red-700">Resolve before building</span>}
                    </div>
                    <h3 className="mt-2 text-base font-bold leading-6 text-neutral-950">{finding.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-neutral-700">{finding.observation}</p>
                    <p className="mt-2 text-sm leading-6 text-neutral-600"><span className="font-semibold text-neutral-800">Why it matters:</span> {finding.consequence}</p>
                    <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
                        <p className="text-xs font-bold uppercase tracking-wider text-neutral-500">Recommended next action</p>
                        <p className="mt-1 text-sm leading-6 text-neutral-700">{finding.recommendedAction}</p>
                    </div>
                    <p className="mt-3 text-xs text-neutral-500">
                        Raised by {finding.specialistName}{finding.affectedSources.length ? ` · ${finding.affectedSources.join(' · ')}` : ''}
                    </p>
                </div>
                {!readOnly && (
                    <button
                        type="button"
                        onClick={finding.canTriage === false ? onReviewAgain : onTriage}
                        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                        {finding.canTriage === false ? 'Review current plan again' : 'Add to review queue'} <ArrowRight size={14} />
                    </button>
                )}
            </div>
        </article>
    );
}

function FindingCard({ issue, onResolve, onReopen, onReviewCurrent, contextChanged, readOnly, highlighted }: { issue: ReviewIssueView; onResolve: () => void; onReopen: () => void; onReviewCurrent: () => void; contextChanged?: boolean; readOnly?: boolean; highlighted?: boolean }) {
    const [expanded, setExpanded] = useState(issue.severity === 'blocking' || highlighted);
    const isExpanded = expanded || highlighted;
    const isClosed = issue.status === 'dismissed' || issue.status === 'addressed';
    return (
        <article
            id={reviewIssueAnchorId(issue.id)}
            tabIndex={-1}
            className={`scroll-mt-4 rounded-2xl border bg-white shadow-sm outline-none focus:ring-2 focus:ring-indigo-500 ${highlighted ? 'ring-2 ring-indigo-300' : ''} ${issue.severity === 'blocking' && !isClosed ? 'border-amber-300' : 'border-neutral-200'}`}
        >
            <div className="p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-semibold text-neutral-500">{KIND_LABELS[issue.kind]}</span>
                            {issue.severity === 'blocking' && <span className="font-semibold text-amber-700">Resolve before building</span>}
                            {issue.disagreement && <span className="font-semibold text-indigo-700">Specialists disagree</span>}
                            {issue.status !== 'open' && <span className="text-neutral-400">{issue.status.replace('_', ' ')}</span>}
                        </div>
                        <h3 className="mt-2 text-base font-bold leading-6 text-neutral-950">{issue.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-neutral-700">{issue.observation}</p>
                        <p className="mt-2 text-sm leading-6 text-neutral-600"><span className="font-semibold text-neutral-800">Why it matters:</span> {issue.consequence}</p>
                    </div>
                    {issue.status === 'open' && !readOnly && (
                        <button type="button" onClick={onResolve} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                            Resolve <ArrowRight size={14} />
                        </button>
                    )}
                    {issue.status !== 'open' && !readOnly && (
                        <button type="button" onClick={contextChanged ? onReviewCurrent : onReopen} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                            {contextChanged ? <><RefreshCcw size={14} /> Review current plan</> : <>Change treatment <ArrowRight size={14} /></>}
                        </button>
                    )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                    <span>{issue.specialistNames.length > 1 ? `Raised independently by ${issue.specialistNames.join(' + ')}` : `Raised by ${issue.specialistNames[0]}`}</span>
                    <span>{issue.affectedSources.join(' · ')}</span>
                    <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={isExpanded} className="ml-auto inline-flex min-h-11 items-center gap-1 font-medium text-neutral-700 hover:text-neutral-950">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Evidence and recommendation
                    </button>
                </div>
            </div>
            {isExpanded && (
                <div className="space-y-5 border-t border-neutral-100 bg-neutral-50/70 p-4 sm:p-5">
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Recommended next action</h4>
                        <p className="mt-1 text-sm leading-6 text-neutral-700">{issue.recommendedAction}</p>
                    </div>
                    {issue.perspectives && issue.perspectives.length > 0 && (
                        <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Specialist perspectives</h4>
                            <div className="mt-2 space-y-2">
                                {issue.perspectives.map(p => <div key={`${p.specialistName}-${p.recommendation}`} className="rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-700"><span className="font-semibold text-neutral-900">{p.specialistName}:</span> {p.recommendation}</div>)}
                            </div>
                        </div>
                    )}
                    <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Project evidence</h4>
                        <div className="mt-2 space-y-2">
                            {issue.evidence.map(item => (
                                <figure key={item.id} className="rounded-lg border border-neutral-200 bg-white p-3">
                                    <figcaption className="flex flex-wrap items-center gap-1 text-xs font-medium text-neutral-500"><Link2 size={12} /> {item.sourceLabel}{item.locator ? ` · ${item.locator}` : ''}</figcaption>
                                    <blockquote className="mt-2 border-l-2 border-indigo-200 pl-3 text-sm leading-6 text-neutral-700">{item.excerpt}</blockquote>
                                </figure>
                            ))}
                        </div>
                    </div>
                    <p className="text-xs text-neutral-400">Confidence: {issue.confidence}. Confidence describes evidence strength, not severity.</p>
                    {issue.treatmentHistory && issue.treatmentHistory.length > 0 && (
                        <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-500">Treatment history</h4>
                            <ol className="mt-2 space-y-2">
                                {issue.treatmentHistory.map((event, index) => (
                                    <li key={`${event.at}-${index}`} className="rounded-lg border border-neutral-200 bg-white p-3 text-xs leading-5 text-neutral-600">
                                        <span className="font-semibold text-neutral-800">{event.action}</span>
                                        {event.reason && <span className="mt-0.5 block">{event.reason}</span>}
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>
            )}
        </article>
    );
}

function ReviewResults({ run, planningRecords, onAct, onTriageFinding, onReopenIssue, onNewReview, onRetryCoverage, openDecisionCount, readOnly, initialIssueId, initialFindingId }: {
    run: ReviewRunView;
    planningRecords: PlanningRecordView[];
    onAct: ReviewWorkspaceProps['onActOnIssue'];
    onTriageFinding: ReviewWorkspaceProps['onTriageFinding'];
    onReopenIssue: ReviewWorkspaceProps['onReopenIssue'];
    onNewReview: () => void;
    onRetryCoverage: () => void;
    openDecisionCount: number;
    readOnly?: boolean;
    initialIssueId?: string;
    initialFindingId?: string;
}) {
    const [statusFilter, setStatusFilter] = useState<'attention' | 'all' | 'closed'>('attention');
    const [actionIssue, setActionIssue] = useState<ReviewIssueView | null>(null);
    const [reopeningIssue, setReopeningIssue] = useState<ReviewIssueView | null>(null);
    const untriagedFindings = useMemo(() => run.untriagedFindings ?? [], [run.untriagedFindings]);
    const open = run.issues.filter(i => i.status === 'open');
    const blocking = open.filter(i => i.severity === 'blocking').length
        + untriagedFindings.filter(finding => finding.severity === 'blocking').length;
    const deferred = run.issues.filter(i => i.status === 'deferred').length;
    const visible = run.issues.filter(i => statusFilter === 'all' || (statusFilter === 'attention' ? i.status === 'open' || i.status === 'linked' : i.status === 'dismissed' || i.status === 'addressed' || i.status === 'deferred'));
    const failed = run.specialists.filter(s => s.status === 'failed').length;

    useEffect(() => {
        const target = initialIssueId
            ? run.issues.find(issue => issue.id === initialIssueId)
            : undefined;
        const targetFinding = initialFindingId
            ? untriagedFindings.find(finding => finding.id === initialFindingId)
            : undefined;
        const representedIssue = initialFindingId
            ? run.issues.find(issue => issue.sourceFindingIds?.includes(initialFindingId))
            : undefined;
        if (targetFinding) {
            const frame = window.requestAnimationFrame(() => {
                const element = document.getElementById(reviewFindingAnchorId(targetFinding.id));
                if (typeof element?.scrollIntoView === 'function') {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                element?.focus({ preventScroll: true });
            });
            return () => window.cancelAnimationFrame(frame);
        }
        const exactIssue = target ?? representedIssue;
        if (!exactIssue) return;
        const targetVisible = statusFilter === 'all'
            || (statusFilter === 'attention'
                ? exactIssue.status === 'open' || exactIssue.status === 'linked'
                : exactIssue.status === 'dismissed' || exactIssue.status === 'addressed' || exactIssue.status === 'deferred');
        const frame = window.requestAnimationFrame(() => {
            if (!targetVisible) {
                setStatusFilter('all');
                return;
            }
            const element = document.getElementById(reviewIssueAnchorId(exactIssue.id));
            if (typeof element?.scrollIntoView === 'function') {
                element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
            element?.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [initialFindingId, initialIssueId, run.issues, statusFilter, untriagedFindings]);

    return (
        <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
            {run.readinessCoverage === 'exploratory' && (
                <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>
                        This completed review was intentionally exploratory and does not satisfy build-readiness coverage.
                        Missing required review: {(run.omittedRequiredSpecialistNames ?? []).join(', ')}. Review the current plan with the full panel to close this gap.
                    </span>
                </div>
            )}
            {run.readinessCoverage === 'unverifiable' && (
                <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>This legacy review did not record its required specialist panel, so it cannot support the current readiness review. Review the current plan again.</span>
                </div>
            )}
            {run.readinessCoverage === 'incomplete' && (
                <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>This review completed with unsupported or incomplete specialist evidence, so it cannot support readiness. Retry the current review to restore source-grounded coverage.</span>
                </div>
            )}
            {run.contextChanged && (
                <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <Clock3 size={16} className="mt-0.5 shrink-0" />
                    <span>This review covers {run.sourceLabel}. The project has changed since it ran, so confirm the source before acting.</span>
                </div>
            )}
            {run.status === 'partial' && (
                <div className="mb-5 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <div className="flex-1">
                        <span>Review complete with a coverage gap: {failed} specialist{failed === 1 ? '' : 's'} did not finish. Successful findings were still validated and synthesized.</span>
                        {!readOnly && <button type="button" onClick={onRetryCoverage} className="mt-2 block font-semibold underline underline-offset-2">Retry failed coverage</button>}
                    </div>
                </div>
            )}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">{run.label} · {run.sourceLabel}</p>
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-950">{run.readinessCoverage === 'exploratory' ? 'Exploratory planning review' : 'Planning review'}</h1>
                    <p className="mt-1 text-sm text-neutral-500">Prioritized findings from {run.specialists.filter(s => s.status === 'complete').length} completed specialist reviews.</p>
                </div>
                <div className="space-y-2">
                    {!readOnly && <button type="button" onClick={onNewReview} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"><RefreshCcw size={14} /> Review current plan</button>}
                    <CritiqueOpenItemsSuggestion count={openDecisionCount} />
                <div className="grid grid-cols-3 gap-2 text-center sm:flex">
                    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2"><div className="text-lg font-bold text-neutral-900">{open.length + untriagedFindings.length}</div><div className="text-[11px] text-neutral-500">Needs attention</div></div>
                    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2"><div className="text-lg font-bold text-amber-700">{blocking}</div><div className="text-[11px] text-neutral-500">Build blockers</div></div>
                    <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2"><div className="text-lg font-bold text-neutral-900">{deferred}</div><div className="text-[11px] text-neutral-500">Deferred</div></div>
                </div>
                </div>
            </div>
            <div className="mt-6 flex gap-1 overflow-x-auto border-b border-neutral-200">
                {([['attention', 'Needs attention'], ['all', 'All findings'], ['closed', 'Addressed & deferred']] as const).map(([id, label]) => (
                    <button key={id} type="button" onClick={() => setStatusFilter(id)} className={`min-h-10 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${statusFilter === id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500'}`}>{label}</button>
                ))}
            </div>
            <div className="mt-5 space-y-4">
                {statusFilter !== 'closed' && untriagedFindings.map(finding => (
                    <UntriagedFindingCard
                        key={finding.id}
                        finding={finding}
                        highlighted={finding.id === initialFindingId}
                        readOnly={readOnly}
                        onTriage={() => onTriageFinding(run.id, finding.id)}
                        onReviewAgain={onNewReview}
                    />
                ))}
                {visible.length > 0 ? visible.map(issue => <FindingCard key={issue.id} issue={issue} highlighted={issue.id === initialIssueId || !!initialFindingId && issue.sourceFindingIds?.includes(initialFindingId)} contextChanged={run.contextChanged} readOnly={readOnly} onResolve={() => setActionIssue(issue)} onReopen={() => setReopeningIssue(issue)} onReviewCurrent={onNewReview} />) : untriagedFindings.length === 0 || statusFilter === 'closed' ? (
                    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-5 py-12 text-center">
                        <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                        <h2 className="mt-3 font-semibold text-neutral-900">Nothing in this view</h2>
                        <p className="mt-1 text-sm text-neutral-500">A specialist is allowed to report that the reviewed area appears sufficiently resolved.</p>
                    </div>
                ) : null}
            </div>
            {actionIssue && <IssueActionDialog issue={actionIssue} planningRecords={planningRecords} onClose={() => setActionIssue(null)} onSubmit={(action, note, recordId) => { onAct(run.id, actionIssue.id, action, note, recordId); setActionIssue(null); }} />}
            {reopeningIssue && <ReopenFindingDialog issue={reopeningIssue} onClose={() => setReopeningIssue(null)} onSubmit={reason => { onReopenIssue(run.id, reopeningIssue.id, reason, reopeningIssue.updatedAt); setReopeningIssue(null); setStatusFilter('attention'); }} />}
        </div>
    );
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
    const openDecisionCount = props.openDecisionCount ?? 0;
    const normalizeTab = (tab: ReviewWorkspaceProps['initialTab']): 'review' | 'history' =>
        tab === 'history' ? 'history' : 'review';
    const [tab, setTab] = useState<'review' | 'history'>(() => normalizeTab(props.initialTab));
    const [lastInitialTab, setLastInitialTab] = useState(props.initialTab);
    if (props.initialTab !== lastInitialTab) {
        setLastInitialTab(props.initialTab);
        if (props.initialTab) setTab(normalizeTab(props.initialTab));
    }
    const [startingNewReview, setStartingNewReview] = useState(false);
    const activeRun = startingNewReview ? undefined : (props.runs.find(run => run.id === props.activeRunId) ?? props.runs[0]);
    const chronologicalRuns = useMemo(() => [...props.runs].sort((a, b) => b.capturedAt - a.capturedAt), [props.runs]);
    const isInProgress = activeRun && ['running', 'synthesizing', 'validating', 'interrupted', 'failed'].includes(activeRun.status);
    // The redesigned challenge/setup page is a single, tab-free two-column
    // layout. Findings/History navigation stays available on the run surfaces
    // (progress, results) and the history list itself, so a completed run is
    // always reachable — it is only the fresh setup page that drops the tabs.
    const showTabs = tab === 'history' || !!activeRun;

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col bg-neutral-50 text-neutral-900">
            {showTabs && (
                <div className="shrink-0 border-b border-neutral-200 bg-white px-3 sm:px-5">
                    <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center gap-1 overflow-hidden sm:overflow-x-auto">
                        <button type="button" aria-label="Review findings" onClick={() => setTab('review')} className={`min-h-12 min-w-0 flex-1 whitespace-nowrap border-b-2 px-1 text-xs font-semibold sm:flex-none sm:px-3 sm:text-sm ${tab === 'review' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500'}`}><span aria-hidden="true">Findings</span></button>
                        <button type="button" aria-label="Review history" onClick={() => setTab('history')} className={`min-h-12 min-w-0 flex-1 whitespace-nowrap border-b-2 px-1 text-xs font-semibold sm:flex-none sm:px-3 sm:text-sm ${tab === 'history' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500'}`}><span aria-hidden="true">History</span></button>
                    </div>
                </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === 'history' ? (
                    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
                        <h1 className="text-2xl font-bold tracking-tight text-neutral-950">Review history</h1>
                        <p className="mt-1 text-sm text-neutral-500">Each review remains attached to the exact project versions it inspected.</p>
                        <div className="mt-6 space-y-3">
                            {chronologicalRuns.map(run => (
                                <button key={run.id} type="button" onClick={() => { props.onSelectRun(run.id); setTab('review'); }} className="flex w-full items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left shadow-sm hover:border-neutral-300">
                                    <History size={16} className="mt-0.5 shrink-0 text-neutral-400" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-neutral-900">{run.label}</span>
                                        <span className="mt-0.5 block text-xs text-neutral-500">{run.sourceLabel} · {new Date(run.capturedAt).toLocaleString()}</span>
                                        {run.focus && <span className="mt-1 block truncate text-xs text-neutral-400">Focus: {run.focus}</span>}
                                        {run.readinessCoverage === 'exploratory' && (
                                            <span className="mt-1 block text-xs font-medium text-amber-700">
                                                Exploratory · omitted {(run.omittedRequiredSpecialistNames ?? []).join(', ')}
                                            </span>
                                        )}
                                        {run.readinessCoverage === 'unverifiable' && <span className="mt-1 block text-xs font-medium text-amber-700">Readiness coverage not recorded</span>}
                                        {run.readinessCoverage === 'incomplete' && <span className="mt-1 block text-xs font-medium text-amber-700">Specialist evidence incomplete</span>}
                                    </span>
                                    <span className={`text-xs font-semibold capitalize ${run.status === 'complete' && run.readinessCoverage === 'complete' ? 'text-emerald-700' : run.status === 'partial' || run.readinessCoverage !== 'complete' ? 'text-amber-700' : 'text-neutral-500'}`}>{run.readinessCoverage === 'exploratory' ? 'exploratory' : run.readinessCoverage === 'incomplete' ? 'incomplete' : run.status}</span>
                                    {run.contextChanged && <span className="text-xs font-medium text-amber-700">Sources changed</span>}
                                </button>
                            ))}
                            {chronologicalRuns.length === 0 && <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">No reviews have been run yet.</p>}
                        </div>
                    </div>
                ) : !activeRun ? (
                    <ReviewSetup projectName={props.projectName} panel={props.recommendedPanel} busy={props.busy} readOnly={props.readOnly} openDecisionCount={openDecisionCount} onStart={async input => { setStartingNewReview(false); await props.onStartReview(input); }} />
                ) : isInProgress ? (
                    <ReviewProgress run={activeRun} onCancel={() => props.onCancelRun(activeRun.id)} onRetrySpecialist={id => props.onRetrySpecialist(activeRun.id, id)} onRetrySynthesis={() => props.onRetrySynthesis(activeRun.id)} openDecisionCount={openDecisionCount} readOnly={props.readOnly} />
                ) : activeRun.status === 'complete' || activeRun.status === 'partial' ? (
                    <ReviewResults
                        run={activeRun}
                        planningRecords={props.planningRecords}
                        onAct={props.onActOnIssue}
                        onTriageFinding={props.onTriageFinding}
                        onReopenIssue={props.onReopenIssue}
                        readOnly={props.readOnly}
                        openDecisionCount={openDecisionCount}
                        initialIssueId={props.initialIssueId}
                        initialFindingId={props.initialFindingId}
                        onNewReview={() => setStartingNewReview(true)}
                        onRetryCoverage={() => props.onRetrySynthesis(activeRun.id)}
                    />
                ) : (
                    <ReviewSetup projectName={props.projectName} panel={props.recommendedPanel} busy={props.busy} readOnly={props.readOnly} openDecisionCount={openDecisionCount} onStart={props.onStartReview} />
                )}
            </div>
        </div>
    );
}
