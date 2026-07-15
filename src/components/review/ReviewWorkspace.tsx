import { useEffect, useMemo, useState } from 'react';
import {
    AlertTriangle,
    ArrowRight,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Circle,
    Clock3,
    History,
    Link2,
    Loader2,
    RefreshCcw,
    ShieldAlert,
    Sparkles,
    X,
} from 'lucide-react';
import {
    DecisionCenter,
    type DecisionAction,
    type DecisionCenterRecordView,
} from './DecisionCenter';

export type ReviewSpecialistOption = {
    id: string;
    name: string;
    responsibility: string;
    selectionReason: string;
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
    busy?: boolean;
    onStartReview: (input: { specialistIds: string[]; focus?: string }) => void | Promise<void>;
    onSelectRun: (runId: string) => void;
    onCancelRun: (runId: string) => void;
    onRetrySpecialist: (runId: string, specialistId: string) => void;
    onRetrySynthesis: (runId: string) => void;
    onActOnIssue: (runId: string, issueId: string, action: ReviewIssueAction, note?: string, planningRecordId?: string) => void;
    onTriageFinding: (runId: string, findingId: string) => void;
    onConfirmPlanningRecord: (recordId: string) => void;
    onReopenPlanningRecord: (recordId: string) => void;
    onDecidePlanningRecord?: (recordId: string, action: DecisionAction, value?: string, rationale?: string) => void;
    onPreviewPlanningRecordImpact?: (recordId: string) => void;
    onApplyPlanningRecordToPlan?: (recordId: string) => void;
    onReviewAlignmentProposal?: (recordId: string, previewId: string, proposalId: string, disposition: 'accepted' | 'rejected' | 'edited' | 'deferred' | 'confirmed_aligned' | 'confirmed_not_applicable', editedValue?: string) => void;
    onRequestAlignmentProposal?: (
        recordId: string,
        previewId: string,
        proposalId: string,
        request: { kind: 'missing_info' | 'different_interpretation'; guidance: string },
    ) => void | Promise<void>;
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

function ReviewSetup({
    projectName,
    panel,
    sources,
    missingSources,
    busy,
    readOnly,
    onStart,
}: {
    projectName: string;
    panel: ReviewSpecialistOption[];
    sources: string[];
    missingSources: string[];
    busy?: boolean;
    readOnly?: boolean;
    onStart: ReviewWorkspaceProps['onStartReview'];
}) {
    const [selected, setSelected] = useState(() => new Set(panel.filter(p => p.recommended !== false).map(p => p.id)));
    const [focus, setFocus] = useState('');
    const omittedRecommended = panel.filter(option => option.recommended !== false && !selected.has(option.id));

    const toggle = (id: string) => setSelected(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    return (
        <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10">
            <div className="mb-7">
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700">
                    <ShieldAlert size={20} />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-neutral-950">Review the plan before building</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
                    A small panel of specialists will independently inspect {projectName} for unresolved decisions,
                    contradictions, unsupported assumptions, and implementation risks. You decide what becomes part of the plan.
                </p>
            </div>

            <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
                <div className="border-b border-neutral-100 px-4 py-4 sm:px-5">
                    <h2 className="font-semibold text-neutral-900">Recommended panel</h2>
                    <p className="mt-1 text-sm text-neutral-500">Selected for this project and its current artifacts.</p>
                </div>
                <div className="divide-y divide-neutral-100">
                    {panel.map(specialist => (
                        <label key={specialist.id} className="flex cursor-pointer items-start gap-3 px-4 py-4 hover:bg-neutral-50 sm:px-5">
                            <input
                                type="checkbox"
                                checked={selected.has(specialist.id)}
                                onChange={() => toggle(specialist.id)}
                                disabled={readOnly}
                                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-neutral-900">{specialist.name}</span>
                                <span className="mt-0.5 block text-sm text-neutral-600">{specialist.responsibility}</span>
                                <span className="mt-1 block text-xs text-neutral-400">Why selected: {specialist.selectionReason}</span>
                            </span>
                        </label>
                    ))}
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

            <section className="mt-5 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
                <h2 className="font-semibold text-neutral-900">Review scope</h2>
                <p className="mt-1 text-sm text-neutral-500">The review is pinned to the current versions of these sources.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {sources.map(source => <span key={source} className="rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-700">{source}</span>)}
                </div>
                {missingSources.length > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                        <span>Coverage gap: {missingSources.join(', ')} {missingSources.length === 1 ? 'is' : 'are'} not available yet.</span>
                    </div>
                )}
                <label className="mt-5 block text-sm font-medium text-neutral-800" htmlFor="review-focus">Optional focus</label>
                <textarea
                    id="review-focus"
                    value={focus}
                    onChange={e => setFocus(e.target.value)}
                    rows={3}
                    placeholder="For example: focus on mobile failure recovery or privacy-sensitive data flows"
                    className="mt-2 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                />
            </section>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-neutral-500">Findings remain suggestions until you explicitly act on them.</p>
                <button
                    type="button"
                    disabled={readOnly || selected.size === 0 || busy}
                    onClick={() => void onStart({ specialistIds: [...selected], focus: focus.trim() || undefined })}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {readOnly ? 'Reviews are read-only in this example' : 'Start specialist review'}
                </button>
            </div>
        </div>
    );
}

function ReviewProgress({ run, onCancel, onRetrySpecialist, onRetrySynthesis }: {
    run: ReviewRunView;
    onCancel: () => void;
    onRetrySpecialist: (id: string) => void;
    onRetrySynthesis: () => void;
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
                    </div>
                    {active && <button type="button" onClick={onCancel} className="min-h-10 rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50">Cancel review</button>}
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
                            {specialist.status === 'failed' && (
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
                {(run.status === 'interrupted' || run.status === 'failed') && (
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
                    </div>
                    {action === 'request_revision' && <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">This records a revision request. Synapse will not rewrite a confirmed artifact automatically.</p>}
                </div>
                <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-neutral-100 bg-white p-4 sm:flex-row sm:justify-end">
                    <button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50">Cancel</button>
                    <button type="button" disabled={(noteRequired && !note.trim()) || ((action === 'link_existing' || action === 'challenge_decision') && !recordId)} onClick={() => onSubmit(action, note.trim() || undefined, recordId || undefined)} className="min-h-11 rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">Save action</button>
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

function FindingCard({ issue, onResolve, readOnly, highlighted }: { issue: ReviewIssueView; onResolve: () => void; readOnly?: boolean; highlighted?: boolean }) {
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
                        <button type="button" onClick={onResolve} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                            Resolve <ArrowRight size={14} />
                        </button>
                    )}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                    <span>{issue.specialistNames.length > 1 ? `Raised independently by ${issue.specialistNames.join(' + ')}` : `Raised by ${issue.specialistNames[0]}`}</span>
                    <span>{issue.affectedSources.join(' · ')}</span>
                    <button type="button" onClick={() => setExpanded(v => !v)} aria-expanded={isExpanded} className="ml-auto inline-flex min-h-8 items-center gap-1 font-medium text-neutral-700 hover:text-neutral-950">
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
                </div>
            )}
        </article>
    );
}

function ReviewResults({ run, planningRecords, onAct, onTriageFinding, onNewReview, onRetryCoverage, readOnly, initialIssueId, initialFindingId }: {
    run: ReviewRunView;
    planningRecords: PlanningRecordView[];
    onAct: ReviewWorkspaceProps['onActOnIssue'];
    onTriageFinding: ReviewWorkspaceProps['onTriageFinding'];
    onNewReview: () => void;
    onRetryCoverage: () => void;
    readOnly?: boolean;
    initialIssueId?: string;
    initialFindingId?: string;
}) {
    const [statusFilter, setStatusFilter] = useState<'attention' | 'all' | 'closed'>('attention');
    const [actionIssue, setActionIssue] = useState<ReviewIssueView | null>(null);
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
                    <h1 className="mt-1 text-2xl font-bold tracking-tight text-neutral-950">Planning review</h1>
                    <p className="mt-1 text-sm text-neutral-500">Prioritized findings from {run.specialists.filter(s => s.status === 'complete').length} completed specialist reviews.</p>
                </div>
                <div className="space-y-2">
                    {!readOnly && <button type="button" onClick={onNewReview} className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"><RefreshCcw size={14} /> Review current plan</button>}
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
                {visible.length > 0 ? visible.map(issue => <FindingCard key={issue.id} issue={issue} highlighted={issue.id === initialIssueId || !!initialFindingId && issue.sourceFindingIds?.includes(initialFindingId)} readOnly={readOnly} onResolve={() => setActionIssue(issue)} />) : untriagedFindings.length === 0 || statusFilter === 'closed' ? (
                    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white px-5 py-12 text-center">
                        <CheckCircle2 size={28} className="mx-auto text-emerald-500" />
                        <h2 className="mt-3 font-semibold text-neutral-900">Nothing in this view</h2>
                        <p className="mt-1 text-sm text-neutral-500">A specialist is allowed to report that the reviewed area appears sufficiently resolved.</p>
                    </div>
                ) : null}
            </div>
            {actionIssue && <IssueActionDialog issue={actionIssue} planningRecords={planningRecords} onClose={() => setActionIssue(null)} onSubmit={(action, note, recordId) => { onAct(run.id, actionIssue.id, action, note, recordId); setActionIssue(null); }} />}
        </div>
    );
}

export function ReviewWorkspace(props: ReviewWorkspaceProps) {
    const [tab, setTab] = useState<'review' | 'decisions' | 'history'>(props.initialTab ?? 'review');
    const [startingNewReview, setStartingNewReview] = useState(false);
    const activeRun = startingNewReview ? undefined : (props.runs.find(run => run.id === props.activeRunId) ?? props.runs[0]);
    const chronologicalRuns = useMemo(() => [...props.runs].sort((a, b) => b.capturedAt - a.capturedAt), [props.runs]);
    const isInProgress = activeRun && ['running', 'synthesizing', 'validating', 'interrupted', 'failed'].includes(activeRun.status);

    return (
        <div className="flex h-full min-w-0 flex-1 flex-col bg-neutral-50 text-neutral-900">
            <div className="shrink-0 border-b border-neutral-200 bg-white px-3 sm:px-5">
                <div className="mx-auto flex w-full min-w-0 max-w-5xl items-center gap-1 overflow-x-auto">
                    <button type="button" onClick={() => setTab('review')} className={`min-h-12 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${tab === 'review' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500'}`}>Review findings</button>
                    <button type="button" onClick={() => setTab('decisions')} className={`min-h-12 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${tab === 'decisions' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500'}`}>Decision Center {props.planningRecords.length > 0 && <span className="ml-1 text-xs text-neutral-400">{props.planningRecords.length}</span>}</button>
                    <button type="button" onClick={() => setTab('history')} className={`min-h-12 whitespace-nowrap border-b-2 px-3 text-sm font-semibold ${tab === 'history' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-neutral-500'}`}>Review history</button>
                </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === 'decisions' ? (
                    <DecisionCenter
                        records={props.planningRecords}
                        initialSelectedId={props.initialDecisionId}
                        readOnly={props.readOnly}
                        onDecide={(recordId, action, value, rationale) => {
                            if (props.onDecidePlanningRecord) {
                                props.onDecidePlanningRecord(recordId, action, value, rationale);
                            } else if (action === 'reopen') {
                                props.onReopenPlanningRecord(recordId);
                            } else if (action === 'confirm' || action === 'custom') {
                                props.onConfirmPlanningRecord(recordId);
                            }
                        }}
                        onPreviewImpact={props.onPreviewPlanningRecordImpact ?? (() => {})}
                        onApplyToPlan={props.onApplyPlanningRecordToPlan ?? (() => {})}
                        onReviewAlignmentProposal={props.onReviewAlignmentProposal}
                        onRequestAlignmentProposal={props.onRequestAlignmentProposal}
                    />
                ) : tab === 'history' ? (
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
                                    </span>
                                    <span className={`text-xs font-semibold capitalize ${run.status === 'complete' ? 'text-emerald-700' : run.status === 'partial' ? 'text-amber-700' : 'text-neutral-500'}`}>{run.status}</span>
                                    {run.contextChanged && <span className="text-xs font-medium text-amber-700">Sources changed</span>}
                                </button>
                            ))}
                            {chronologicalRuns.length === 0 && <p className="rounded-xl border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500">No reviews have been run yet.</p>}
                        </div>
                    </div>
                ) : !activeRun ? (
                    <ReviewSetup projectName={props.projectName} panel={props.recommendedPanel} sources={props.sourcesInScope} missingSources={props.missingSources ?? []} busy={props.busy} readOnly={props.readOnly} onStart={async input => { setStartingNewReview(false); await props.onStartReview(input); }} />
                ) : isInProgress ? (
                    <ReviewProgress run={activeRun} onCancel={() => props.onCancelRun(activeRun.id)} onRetrySpecialist={id => props.onRetrySpecialist(activeRun.id, id)} onRetrySynthesis={() => props.onRetrySynthesis(activeRun.id)} />
                ) : activeRun.status === 'complete' || activeRun.status === 'partial' ? (
                    <ReviewResults
                        run={activeRun}
                        planningRecords={props.planningRecords}
                        onAct={props.onActOnIssue}
                        onTriageFinding={props.onTriageFinding}
                        readOnly={props.readOnly}
                        initialIssueId={props.initialIssueId}
                        initialFindingId={props.initialFindingId}
                        onNewReview={() => setStartingNewReview(true)}
                        onRetryCoverage={() => props.onRetrySynthesis(activeRun.id)}
                    />
                ) : (
                    <ReviewSetup projectName={props.projectName} panel={props.recommendedPanel} sources={props.sourcesInScope} missingSources={props.missingSources ?? []} busy={props.busy} readOnly={props.readOnly} onStart={props.onStartReview} />
                )}
            </div>
        </div>
    );
}
