import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, FileQuestion, Loader2, RefreshCcw, Sparkles, X } from 'lucide-react';
import {
    AssumptionValidationPanel,
    type AssumptionEvidenceActionGuard,
    type AssumptionEvidenceCorrectionInput,
    type AssumptionEvidenceInput,
    type AssumptionValidationPlanInput,
    type AssumptionValidationView,
} from './AssumptionValidationPanel';
import { UnderlineTabs, type UnderlineTab } from '../ui/UnderlineTabs';
import type { AssumptionEvidenceConclusion, AssumptionUncertaintyTreatment } from '../../types';
import { assumptionWorkflowCopy, planningRecordCopy, planningRecordDominantCondition, type PlanningRecordDominantCondition } from '../../lib/planning/planningLanguage';

export type DecisionCenterOptionView = {
    id: string;
    label: string;
    description?: string;
    tradeoffs?: Array<{ kind: 'benefit' | 'cost' | 'risk' | 'constraint'; summary: string }>;
};

export type DecisionCenterPreviewView = {
    id: string;
    status: 'generating' | 'ready' | 'stale' | 'failed' | 'applied' | 'superseded';
    affectedPrdSections: string[];
    affectedArtifactLabels: string[];
    beforeSummary?: string;
    afterSummary?: string;
    explanation?: string;
    error?: string;
    canApply?: boolean;
    proposals?: Array<{
        id: string;
        targetLabel: string;
        targetKind: string;
        section: string;
        beforeSummary?: string;
        proposedSummary?: string;
        reason: string;
        confidence: 'definite' | 'likely' | 'possible';
        reasoningConfidence?: 'high' | 'medium' | 'low';
        evidenceCharacter?: 'direct' | 'supported_inference' | 'plausible_inference';
        requiresInput?: boolean;
        requiredForVerdictAlignment?: boolean;
        canEditWording?: boolean;
        canRequestReasoning?: boolean;
        analysisStatus?: 'advisory_candidate' | 'bounded_applicable' | 'already_aligned' | 'not_applicable' | 'needs_input' | 'rejected' | 'failed';
        analysisMethod?: 'deterministic' | 'model';
        analysisModel?: string;
        analysisProvider?: string;
        analysisFailureReason?: string;
        analysisAmbiguity?: string;
        analysisQuestions?: string[];
        analysisEvidence?: Array<{ label: string; excerpt?: string }>;
        analysisBusy?: boolean;
        analysisError?: string;
        disposition: 'pending' | 'accepted' | 'rejected' | 'edited' | 'deferred' | 'confirmed_aligned' | 'confirmed_not_applicable';
        editedSummary?: string;
    }>;
};

export type DecisionCenterRecordView = {
    id: string;
    type: 'decision' | 'assumption' | 'risk' | 'question' | 'conflict';
    title: string;
    statement?: string;
    whyItMatters?: string;
    status: 'proposed' | 'open' | 'confirmed' | 'rejected' | 'deferred' | 'resolved' | 'invalidated' | 'superseded';
    materiality?: 'blocking' | 'high' | 'normal' | 'low';
    /** A material assumption can have a recorded planning verdict and still
     * need evidence-backed validation. This is attention, not a second verdict. */
    requiresValidation?: boolean;
    options?: DecisionCenterOptionView[];
    /** Live state of machine option suggestion for records without stored
     * options. Presence of an error means the last attempt failed. */
    optionsSuggestion?: { busy: boolean; error?: string };
    recommendation?: { optionId?: string; summary: string; rationale?: string; confidence?: string };
    resolution?: string;
    rationale?: string;
    sourceLabels?: string[];
    sourceNotice?: string;
    createdAt: number;
    history?: Array<{ id: string; label: string; at: number; rationale?: string }>;
    validation?: AssumptionValidationView;
    preview?: DecisionCenterPreviewView;
};

export type DecisionAction = 'confirm' | 'custom' | 'defer' | 'reject' | 'reopen' | 'revise' | 'invalidate';

interface Props {
    records: DecisionCenterRecordView[];
    initialSelectedId?: string;
    readOnly?: boolean;
    onDecide: (recordId: string, action: DecisionAction, value?: string, rationale?: string) => void;
    /** Requests machine-suggested alternatives for an unresolved decision.
     * Safe to call repeatedly; the container ignores duplicate requests. */
    onPrepareOptions?: (recordId: string) => void;
    onPreviewImpact: (recordId: string) => void;
    onApplyToPlan: (recordId: string) => void;
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
    /** Jumps to the Explore/Build stage. Open items never block exploring
     * design assets, and the Decision Center says so explicitly. */
    onContinueToExplore?: () => void;
}

const needsVerdict = (record: DecisionCenterRecordView) => ['proposed', 'open'].includes(record.status);
const dominantCondition = (record: DecisionCenterRecordView) => planningRecordDominantCondition({
    type: record.type === 'question' ? 'open_question' : record.type,
    status: record.status,
    requiresValidation: record.requiresValidation,
    hasCurrentEvidenceConclusion: Boolean(record.validation?.conclusionIsCurrent && record.validation.acceptedConclusion),
    needsAlignment: Boolean(record.preview && ['ready', 'stale', 'failed'].includes(record.preview.status)),
});
/** Queue/detail status label. An answered material assumption keeps its
 * validation invitation, but it must read as answered — never as still
 * pending — so it gets a dedicated label instead of "Worth validating". */
const dominantConditionLabel = (record: DecisionCenterRecordView) =>
    ['confirmed', 'rejected', 'resolved'].includes(record.status) && record.requiresValidation
        ? 'Answered · not validated'
        : planningRecordCopy(dominantCondition(record)).label;
/** One plain sentence per attention group so the queue itself answers "what am
 * I supposed to do with these?" — approve, answer, or review. */
const groupGuidance: Partial<Record<PlanningRecordDominantCondition, string>> = {
    needs_decision: 'Synapse recommends an answer for each — approve it or choose your own.',
    worth_validating: 'Confirm or correct what Synapse assumed. Deeper validation can wait until you start building.',
    needs_alignment: 'A recorded answer may change the plan — review the proposed updates.',
    accepted_without_validation: 'Accepted on your call. Validate with evidence when you start building.',
    invalidated: 'The recorded answer no longer holds — record a new one.',
};
const previewStatusLabel: Record<DecisionCenterPreviewView['status'], string> = {
    generating: 'Preparing impact', ready: 'Review changes', stale: 'Impact needs refresh',
    failed: 'Impact unavailable', applied: 'Change applied', superseded: 'Superseded',
};
const proposalDispositionLabel: Record<NonNullable<DecisionCenterPreviewView['proposals']>[number]['disposition'], string> = {
    pending: 'Needs review', accepted: 'Will update', rejected: 'Keeping current', edited: 'Edited', deferred: 'Deferred',
    confirmed_aligned: 'Alignment verified', confirmed_not_applicable: 'Confirmed not affected',
};
const proposalAnalysisLabel: Record<NonNullable<NonNullable<DecisionCenterPreviewView['proposals']>[number]['analysisStatus']>, string> = {
    advisory_candidate: 'Advisory target', bounded_applicable: 'Ready to review', needs_input: 'Needs context',
    already_aligned: 'Appears already aligned', not_applicable: 'Appears not affected',
    rejected: 'No safe proposal', failed: 'Proposal unavailable',
};
const evidenceCharacterLabel = {
    direct: 'Direct evidence', supported_inference: 'Supported inference', plausible_inference: 'Plausible inference',
} as const;

export function DecisionCenter({
    records, initialSelectedId, readOnly, onDecide, onPrepareOptions, onPreviewImpact, onApplyToPlan,
    onReviewAlignmentProposal, onRequestAlignmentProposal,
    onGenerateAssumptionValidationPlan = () => {},
    onRecordAssumptionValidationPlan = () => {},
    onAddAssumptionEvidence = () => {},
    onCorrectAssumptionEvidence = () => {},
    onRetractAssumptionEvidence = () => {},
    onInterpretAssumptionEvidence = () => {},
    onRecordAssumptionOutcome = () => {},
    onRecordAssumptionTreatment = () => {},
    onReopenAssumptionOutcome = () => {},
    onContinueToExplore,
}: Props) {
    const initialRecord = records.find(record => record.id === initialSelectedId);
    const [view, setView] = useState<'needs_review' | 'log'>(() => initialRecord ? (needsVerdict(initialRecord) ? 'needs_review' : 'log') : records.some(needsVerdict) ? 'needs_review' : 'log');
    // The attention queue holds only records that still need an answer. An
    // answered material assumption moves to "Resolved & history" (labeled
    // "Answered · not validated") — validation stays available there, but it
    // never keeps a record looking unresolved after the user answered it.
    const visible = useMemo(() => records.filter(record => view === 'needs_review' ? needsVerdict(record) : !needsVerdict(record)), [records, view]);
    // Stable-partition the queue by dominant condition in first-seen order so
    // rows group under one small header instead of repeating a tag per row.
    const groupedVisible = useMemo(() => {
        const groups: Array<{ label: string; condition: PlanningRecordDominantCondition; records: DecisionCenterRecordView[] }> = [];
        for (const record of visible) {
            const condition = dominantCondition(record);
            const label = dominantConditionLabel(record);
            const existing = groups.find(group => group.label === label);
            if (existing) existing.records.push(record);
            else groups.push({ label, condition, records: [record] });
        }
        return groups;
    }, [visible]);
    const [selectedId, setSelectedId] = useState<string | undefined>(initialRecord?.id);
    const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(initialRecord));
    const [customAnswer, setCustomAnswer] = useState('');
    const [rationale, setRationale] = useState('');
    /** Selected suggested option id, or 'other' for a custom answer. When
     * undefined, the Synapse recommendation (if any) acts as the default
     * choice — approving it still requires the explicit user action below. */
    const [answerChoice, setAnswerChoice] = useState<string | undefined>();
    const [lastDecidedId, setLastDecidedId] = useState<string | undefined>();
    const [proposalEdits, setProposalEdits] = useState<Record<string, string>>({});
    const [proposalRequest, setProposalRequest] = useState<{ proposalId: string; kind: 'missing_info' | 'different_interpretation' }>();
    const [proposalGuidance, setProposalGuidance] = useState('');
    const [lastInitialSelectedId, setLastInitialSelectedId] = useState(initialSelectedId);
    if (initialSelectedId !== lastInitialSelectedId) {
        setLastInitialSelectedId(initialSelectedId);
        const target = records.find(record => record.id === initialSelectedId);
        if (target) {
            setView(needsVerdict(target) ? 'needs_review' : 'log');
            setSelectedId(target.id);
            setMobileDetailOpen(true);
            setCustomAnswer('');
            setRationale('');
            setAnswerChoice(undefined);
        }
    }
    const detailHeadingRef = useRef<HTMLHeadingElement>(null);
    const correctionTextareaRef = useRef<HTMLTextAreaElement>(null);
    const selected = visible.find(record => record.id === selectedId) ?? visible[0];
    const dominantNextAction = selected
        ? needsVerdict(selected)
            ? selected.type === 'assumption'
                ? 'Decide whether to test this assumption, correct it, or explicitly proceed with the uncertainty.'
                : 'Record the product choice that should govern the plan.'
            : selected.preview
                ? 'Review the exact plan alignment work below.'
                : ['confirmed', 'rejected', 'resolved'].includes(selected.status)
                    ? 'Preview what this recorded answer may change in the plan.'
                    : 'Review the recorded outcome and decide whether it should be reopened.'
        : undefined;
    const selectedHasCurrentAssumptionConclusion = selected?.type === 'assumption'
        && selected.validation?.conclusionIsCurrent
        && Boolean(selected.validation.acceptedConclusion);
    const unresolvedCount = records.filter(needsVerdict).length;
    const pendingProposalCount = (selected?.preview?.proposals ?? []).filter(proposal => proposal.disposition === 'pending').length;
    const decisionQueueTabs: UnderlineTab[] = [
        { id: 'needs_review', label: 'Needs attention' },
        { id: 'log', label: 'Resolved & history' },
    ];

    useEffect(() => {
        if (mobileDetailOpen) detailHeadingRef.current?.focus();
    }, [mobileDetailOpen, selected?.id]);

    // Suggested alternatives are prepared automatically the first time an
    // unresolved decision is opened. The container ignores duplicate requests
    // and a failed attempt stays visible with a manual retry.
    useEffect(() => {
        if (readOnly || !onPrepareOptions || !selected) return;
        if (selected.type !== 'decision' && selected.type !== 'question') return;
        if (!needsVerdict(selected) || selected.options?.length || selected.optionsSuggestion) return;
        onPrepareOptions(selected.id);
    }, [onPrepareOptions, readOnly, selected]);

    const choose = (id: string) => {
        setSelectedId(id);
        setMobileDetailOpen(true);
        setCustomAnswer('');
        setRationale('');
        setAnswerChoice(undefined);
    };

    const submit = (action: DecisionAction, value?: string) => {
        if (!selected) return;
        onDecide(selected.id, action, value, rationale.trim() || undefined);
        // A newly recorded answer should remain in view so the user can inspect
        // its consequences and request an impact preview. Moving it out of the
        // needs-review queue must not feel like the reasoning disappeared.
        if (action === 'reopen') {
            setView('needs_review');
        } else if (needsVerdict(selected)) {
            // Answering always moves the record to "Resolved & history" — even
            // when validation stays worth doing. The queue must visibly shrink
            // with every answer or resolving never feels achievable.
            setView('log');
        }
        setLastDecidedId(['confirm', 'custom', 'reject'].includes(action) && needsVerdict(selected) ? selected.id : undefined);
        setSelectedId(selected.id);
        setMobileDetailOpen(true);
        setCustomAnswer('');
        setRationale('');
        setAnswerChoice(undefined);
    };

    const requestAlignmentProposal = async (proposalId: string) => {
        if (!selected?.preview || !proposalRequest || !onRequestAlignmentProposal) return;
        const proposal = selected.preview.proposals?.find(item => item.id === proposalId);
        const guidanceRequired = proposalRequest.kind === 'different_interpretation'
            || (proposal?.analysisMethod === 'model' && proposal.analysisStatus === 'needs_input');
        if (guidanceRequired && !proposalGuidance.trim()) return;
        try {
            await onRequestAlignmentProposal(selected.id, selected.preview.id, proposalId, {
                kind: proposalRequest.kind,
                guidance: proposalGuidance.trim(),
            });
            setProposalRequest(undefined);
            setProposalGuidance('');
        } catch {
            // The container exposes the bounded failure through analysisError.
            // Keep the form and Phase 1 review target intact for a retry.
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col bg-neutral-50">
            <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Decision Center</h1>
                        <p className="mt-1 text-sm text-neutral-500">Answer each open item — approve a suggested option when there is one, or record your own call.</p>
                    </div>
                    {unresolvedCount > 0 && (
                        <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800" aria-label={`${unresolvedCount} planning item${unresolvedCount === 1 ? '' : 's'} need${unresolvedCount === 1 ? 's' : ''} an answer`}>
                            {unresolvedCount} need{unresolvedCount === 1 ? 's' : ''} an answer
                        </div>
                    )}
                </div>
                {onContinueToExplore && (
                    <p className="mt-2 text-xs text-neutral-500">
                        Open items never block your design assets.{' '}
                        <button type="button" onClick={onContinueToExplore} className="font-semibold text-indigo-700 underline underline-offset-2 hover:text-indigo-900">
                            Continue to Explore
                        </button>
                    </p>
                )}
            </header>
            {unresolvedCount === 0 && records.length > 0 && (
                <div className="shrink-0 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 sm:px-6" role="status">
                    Nothing needs an answer right now
                </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col md:grid md:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
                <aside className={`${mobileDetailOpen ? 'hidden md:flex' : 'flex'} min-h-0 flex-1 flex-col border-r border-neutral-200 bg-white`} aria-label="Decision queue">
                    <div className="shrink-0 px-2 pt-1">
                        <UnderlineTabs
                            tabs={decisionQueueTabs}
                            activeId={view}
                            onChange={id => setView(id as 'needs_review' | 'log')}
                            ariaLabel="Decision queue view"
                            className="[&>button]:flex-1"
                        />
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                        {visible.length === 0 ? (
                            <div className="px-4 py-10 text-center">
                                {view === 'needs_review' ? <Check className="mx-auto text-emerald-500" size={24} /> : <FileQuestion className="mx-auto text-neutral-300" size={24} />}
                                <p className="mt-3 text-sm font-semibold text-neutral-800">{view === 'needs_review' ? 'Nothing needs an answer' : 'No resolved planning history yet'}</p>
                                <p className="mt-1 text-xs leading-5 text-neutral-500">{view === 'needs_review' ? 'New assumptions and review findings will appear here.' : 'Answered and deferred choices remain available here.'}</p>
                            </div>
                        ) : groupedVisible.map(group => (
                            <div key={group.label}>
                                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{group.label}</div>
                                {view === 'needs_review' && groupGuidance[group.condition] && (
                                    <p className="px-3 pb-2 text-xs leading-5 text-neutral-500">{groupGuidance[group.condition]}</p>
                                )}
                                {group.records.map(record => (
                                    <button
                                        type="button"
                                        key={record.id}
                                        onClick={() => choose(record.id)}
                                        aria-current={selected?.id === record.id ? 'true' : undefined}
                                        className={`mb-1 w-full rounded-xl border px-3 py-3 text-left transition ${selected?.id === record.id ? 'border-indigo-200 bg-indigo-50' : 'border-transparent hover:bg-neutral-50'}`}
                                    >
                                        <p className="text-sm font-semibold leading-5 text-neutral-900">{record.title}</p>
                                        <span className="mt-1 flex items-center gap-2">
                                            {view === 'needs_review' && (record.materiality === 'blocking' || record.materiality === 'high') && (
                                                <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">{record.materiality === 'blocking' ? 'Blocking' : 'High impact'}</span>
                                            )}
                                            {/* The group header already says "Deferred", but a
                                                per-row chip keeps that visible while scanning a
                                                long Resolved & history list, matching the
                                                Blocking/High impact treatment above. */}
                                            {view === 'log' && record.status === 'deferred' && (
                                                <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-neutral-600">Deferred</span>
                                            )}
                                            {record.sourceLabels?.[0] && <span className="truncate text-xs text-neutral-400">From {record.sourceLabels[0]}</span>}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ))}
                    </div>
                </aside>

                <main className={`${mobileDetailOpen ? 'block' : 'hidden md:block'} min-h-0 flex-1 overflow-y-auto`} aria-label="Decision detail">
                    {!selected ? (
                        <div className="mx-auto max-w-xl px-5 py-16 text-center text-sm text-neutral-500">Select a decision to inspect its reasoning and history.</div>
                    ) : (
                        <div className="mx-auto w-full max-w-4xl xl:max-w-5xl px-4 py-5 sm:px-7 sm:py-8">
                            <button type="button" onClick={() => setMobileDetailOpen(false)} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-neutral-600 md:hidden"><ArrowLeft size={16} /> Back to decisions</button>
                            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{dominantConditionLabel(selected)}</div>
                            <h2 ref={detailHeadingRef} tabIndex={-1} className="mt-2 text-2xl font-bold leading-tight text-neutral-950">{selected.title}</h2>
                            {selected.statement && selected.statement !== selected.title && <p className="mt-2 text-sm leading-6 text-neutral-700">{selected.statement}</p>}
                            {selected.sourceNotice && <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">{selected.sourceNotice}</div>}
                            {selected.whyItMatters && <section className="mt-6"><h3 className="text-sm font-semibold text-neutral-900">Why it matters</h3><p className="mt-1 text-sm leading-6 text-neutral-600">{selected.whyItMatters}</p></section>}

                            {/* The AssumptionValidationPanel (mounted below under the same
                                condition) already carries the guidance for assumptions with a
                                validation flow, so suppress the generic callout to avoid a
                                duplicate "next action" for them. */}
                            {!(selected.type === 'assumption' && selected.validation) && (
                                <section className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3" aria-label="Next action">
                                    <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Next action</p>
                                    <p className="mt-1 text-sm font-semibold leading-6 text-indigo-950">{dominantNextAction}</p>
                                </section>
                            )}

                            {!readOnly && needsVerdict(selected) && (() => {
                                // Assumptions keep their dedicated validation flow; suggested
                                // alternatives apply to choices (decisions and open questions).
                                const optionsApply = selected.type !== 'assumption';
                                const storedOptions = optionsApply ? selected.options ?? [] : [];
                                const recommendedId = selected.recommendation?.optionId;
                                const orderedOptions = recommendedId
                                    ? [...storedOptions.filter(option => option.id === recommendedId), ...storedOptions.filter(option => option.id !== recommendedId)]
                                    : storedOptions;
                                const hasOptions = orderedOptions.length > 0;
                                const suggestionBusy = optionsApply && !hasOptions && Boolean(selected.optionsSuggestion?.busy);
                                const suggestionError = optionsApply && !hasOptions && !suggestionBusy ? selected.optionsSuggestion?.error : undefined;
                                // The Synapse recommendation is the default choice so approving it
                                // is one explicit click. A verdict is still only ever recorded by
                                // that user action — nothing is auto-approved.
                                const defaultChoice = recommendedId && orderedOptions.some(option => option.id === recommendedId)
                                    ? recommendedId
                                    : undefined;
                                const effectiveChoice = answerChoice ?? defaultChoice;
                                // A simple assumption confirm ("Yes, that's right") is the primary
                                // path here, so the free-text correction area must not appear
                                // until the user actually asks to correct it — otherwise it reads
                                // as a required first step ahead of the confirm/defer buttons.
                                const isAssumptionSimpleConfirm = selected.type === 'assumption' && !selected.options?.length;
                                const showTextarea = hasOptions
                                    ? effectiveChoice === 'other'
                                    : isAssumptionSimpleConfirm
                                        ? answerChoice === 'other'
                                        : true;
                                const chosenOption = effectiveChoice && effectiveChoice !== 'other'
                                    ? orderedOptions.find(option => option.id === effectiveChoice)
                                    : undefined;
                                const approvingRecommendation = chosenOption !== undefined && chosenOption.id === recommendedId;
                                const canSave = chosenOption !== undefined || (showTextarea && customAnswer.trim().length > 0);
                                const save = () => {
                                    if (chosenOption) submit('confirm', chosenOption.id);
                                    else if (customAnswer.trim()) submit('custom', customAnswer.trim());
                                };
                                return (
                                <section className="mt-6 rounded-xl border border-neutral-200 bg-white p-4">
                                    <h3 className="text-sm font-semibold text-neutral-900" id="decision-answer-heading">Your answer</h3>
                                    {hasOptions && (
                                        <div className="mt-3 space-y-2" role="radiogroup" aria-labelledby="decision-answer-heading">
                                            {orderedOptions.map(option => {
                                                const isRecommended = option.id === recommendedId;
                                                const isChosen = effectiveChoice === option.id;
                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={isChosen}
                                                        onClick={() => setAnswerChoice(option.id)}
                                                        className={`w-full rounded-xl border p-4 text-left transition ${isChosen ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300' : 'border-neutral-200 bg-white hover:border-indigo-300'}`}
                                                    >
                                                        <span className="flex flex-wrap items-center gap-2">
                                                            <span className="text-sm font-semibold text-neutral-900">{option.label}</span>
                                                            {isRecommended && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-700"><Sparkles size={10} /> Recommended</span>}
                                                        </span>
                                                        {option.description && <span className="mt-1 block text-sm leading-6 text-neutral-600">{option.description}</span>}
                                                        {option.tradeoffs && option.tradeoffs.length > 0 && <span className="mt-2 block text-xs leading-5 text-neutral-500">{option.tradeoffs.map(item => item.summary).join(' · ')}</span>}
                                                        {isRecommended && selected.recommendation?.rationale && <span className="mt-2 block border-t border-indigo-100 pt-2 text-xs leading-5 text-indigo-900/80">Why Synapse suggests this: {selected.recommendation.rationale}</span>}
                                                    </button>
                                                );
                                            })}
                                            <button
                                                type="button"
                                                role="radio"
                                                aria-checked={effectiveChoice === 'other'}
                                                onClick={() => setAnswerChoice('other')}
                                                className={`w-full rounded-xl border p-4 text-left transition ${effectiveChoice === 'other' ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-300' : 'border-dashed border-neutral-300 bg-white hover:border-indigo-300'}`}
                                            >
                                                <span className="text-sm font-semibold text-neutral-900">Other</span>
                                                <span className="mt-1 block text-sm text-neutral-600">Record a different approach in your own words.</span>
                                            </button>
                                        </div>
                                    )}
                                    {suggestionBusy && (
                                        <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-900" role="status">
                                            <Loader2 size={14} className="shrink-0 animate-spin" /> Synapse is preparing 2-3 suggested approaches. You can also answer directly below.
                                        </div>
                                    )}
                                    {suggestionError && (
                                        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
                                            Suggested approaches are unavailable: {suggestionError}
                                            {onPrepareOptions && <button type="button" onClick={() => onPrepareOptions(selected.id)} className="ml-2 font-semibold underline underline-offset-2">Try again</button>}
                                        </div>
                                    )}
                                    {(() => {
                                        // "Not quite" is never a dead end: while the correction
                                        // area is hidden, the click reveals and focuses it instead
                                        // of rendering disabled with no explanation.
                                        const correctIt = () => {
                                            const trimmed = customAnswer.trim();
                                            if (trimmed) { submit('reject', trimmed); return; }
                                            if (!showTextarea) setAnswerChoice('other');
                                            requestAnimationFrame(() => correctionTextareaRef.current?.focus());
                                        };
                                        const correctionField = showTextarea && (
                                            <>
                                                <label className={hasOptions ? 'sr-only' : 'mt-2 block'} htmlFor="decision-answer"><span className="sr-only">Your answer</span></label>
                                                <textarea ref={correctionTextareaRef} id="decision-answer" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} rows={3} placeholder={selected.type === 'assumption' ? 'Explain what should replace this premise' : hasOptions ? 'Describe the approach that should govern the plan' : 'Record the product choice in your own words'} className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                            </>
                                        );
                                        const rationaleField = (
                                            <>
                                                <label className="mt-3 block text-xs font-medium text-neutral-600" htmlFor="decision-rationale">Why? (optional)</label>
                                                <input id="decision-rationale" value={rationale} onChange={event => setRationale(event.target.value)} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                            </>
                                        );
                                        const answerButtons = (
                                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                                {selected.type !== 'assumption' && <button type="button" disabled={!canSave} onClick={save} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-40">{approvingRecommendation ? <><Check size={14} className="mr-1 inline" /> Approve recommendation</> : 'Save decision'}</button>}
                                                {selected.type === 'assumption' && !selected.options?.length && <button type="button" onClick={() => submit('confirm', selected.statement || selected.title)} className="min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"><Check size={14} className="mr-1 inline" /> Yes, that's right</button>}
                                                {(selected.type !== 'assumption' || !selected.validation) && <button type="button" onClick={() => submit('defer')} className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"><Clock3 size={14} className="mr-1 inline" /> Defer</button>}
                                                <button type="button" onClick={correctIt} className="min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"><X size={14} className="mr-1 inline" /> Not quite — correct it</button>
                                            </div>
                                        );
                                        // For a simple assumption confirm, the buttons are the
                                        // headline action; the correction textarea only follows
                                        // once the user actually asks to correct the premise.
                                        return isAssumptionSimpleConfirm ? (
                                            <>
                                                {rationaleField}
                                                {answerButtons}
                                                {correctionField}
                                                <p className="mt-2 text-xs leading-5 text-neutral-500">Recorded as your call — not independently checked.</p>
                                            </>
                                        ) : (
                                            <>
                                                {correctionField}
                                                {rationaleField}
                                                {answerButtons}
                                            </>
                                        );
                                    })()}
                                </section>
                                );
                            })()}

                            {selected.id === lastDecidedId && !needsVerdict(selected) && (() => {
                                const next = records.filter(record => needsVerdict(record) && record.id !== selected.id);
                                return (
                                    <section className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3" role="status" aria-label="Answer recorded">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-sm font-semibold text-emerald-900">
                                                Answer recorded. {next.length > 0
                                                    ? `${next.length} item${next.length === 1 ? '' : 's'} still need${next.length === 1 ? 's' : ''} an answer.`
                                                    : 'Nothing else needs an answer right now.'}
                                            </p>
                                            {next.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setLastDecidedId(undefined); setView('needs_review'); choose(next[0].id); }}
                                                    className="inline-flex min-h-10 max-w-full items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
                                                >
                                                    <span className="truncate">Next: {next[0].title}</span> <ArrowRight size={14} className="shrink-0" />
                                                </button>
                                            )}
                                        </div>
                                    </section>
                                );
                            })()}

                            {!needsVerdict(selected) && selected.status !== 'deferred' && selected.status !== 'invalidated' && (
                                <section className={`mt-6 rounded-xl border p-4 ${selected.type === 'assumption' ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
                                    <h3 className={`text-sm font-semibold ${selected.type === 'assumption' ? 'text-amber-950' : 'text-emerald-900'}`}>{selected.type === 'assumption' ? selectedHasCurrentAssumptionConclusion ? 'Evidence outcome recorded' : 'Accepted for planning · not validated' : 'Selected answer'}</h3>
                                    <p className={`mt-1 text-sm ${selected.type === 'assumption' ? 'text-amber-900' : 'text-emerald-800'}`}>{selected.resolution || 'Decision recorded'}</p>
                                    {selected.rationale && <p className={`mt-1 text-xs ${selected.type === 'assumption' ? 'text-amber-800' : 'text-emerald-700'}`}>Reason: {selected.rationale}</p>}
                                </section>
                            )}

                            {/* Validation is a follow-up the user can opt into, never the
                                first thing between them and answering — so the full
                                evidence workflow lives behind this disclosure, open only
                                when a validation is already underway. */}
                            {selected.type === 'assumption' && selected.validation && (
                                <details
                                    className="mt-6 rounded-xl border border-indigo-100 bg-white"
                                    open={['planned', 'in_progress', 'due_for_review'].includes(selected.validation.workflowState)
                                        // A generated-but-unrecorded plan proposal must stay visible:
                                        // proposals don't advance workflowState, and collapsing them
                                        // would hide the only "use suggestion as a draft" affordance.
                                        || Boolean(selected.validation.latestPlanProposal && !selected.validation.currentPlan)}
                                >
                                    <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-800">
                                        Validate with evidence{selected.requiresValidation ? ' · recommended before you build' : ' (optional)'}
                                        {selected.validation.workflowState !== 'not_planned' && (
                                            <span className="ml-2 font-normal text-neutral-500">{assumptionWorkflowCopy(selected.validation.workflowState).label}</span>
                                        )}
                                    </summary>
                                    <div className="border-t border-neutral-100 px-3 pb-3 [&>section]:mt-3 [&>section]:border-0 [&>section]:p-2">
                                        <AssumptionValidationPanel
                                            key={selected.id}
                                            recordId={selected.id}
                                            readOnly={readOnly}
                                            validation={selected.validation}
                                            requiresValidation={Boolean(selected.requiresValidation)}
                                            consequence={selected.whyItMatters}
                                            hasPlanImpact={Boolean(selected.preview)}
                                            onGeneratePlan={onGenerateAssumptionValidationPlan}
                                            onRecordPlan={onRecordAssumptionValidationPlan}
                                            onAddEvidence={onAddAssumptionEvidence}
                                            onCorrectEvidence={onCorrectAssumptionEvidence}
                                            onRetractEvidence={onRetractAssumptionEvidence}
                                            onInterpretEvidence={onInterpretAssumptionEvidence}
                                            onRecordOutcome={onRecordAssumptionOutcome}
                                            onRecordTreatment={onRecordAssumptionTreatment}
                                            onReopenOutcome={onReopenAssumptionOutcome}
                                            onPreviewImpact={onPreviewImpact}
                                        />
                                    </div>
                                </details>
                            )}

                            {selected.preview ? (
                                <section className={`mt-6 rounded-xl border p-4 ${selected.preview.status === 'stale' || selected.preview.status === 'failed' ? 'border-amber-200 bg-amber-50' : 'border-indigo-200 bg-indigo-50/60'}`}>
                                    {/* The alignment loop is a follow-up review, not part of
                                        recording an answer — it stays collapsed behind this
                                        one-line summary so answering never unloads a wall of
                                        proposal cards onto the user. */}
                                    <details>
                                    <summary className="min-h-10 cursor-pointer py-1 text-sm font-semibold text-neutral-900">
                                        Plan alignment · {previewStatusLabel[selected.preview.status]}
                                        {pendingProposalCount > 0 && <span className="ml-2 font-normal text-neutral-600">{pendingProposalCount} suggested update{pendingProposalCount === 1 ? '' : 's'} to review</span>}
                                    </summary>
                                    {selected.preview.beforeSummary && <p className="mt-3 text-xs text-neutral-500">Before</p>}
                                    {selected.preview.beforeSummary && <p className="text-sm text-neutral-700">{selected.preview.beforeSummary}</p>}
                                    {selected.preview.afterSummary && <p className="mt-3 text-xs text-neutral-500">After</p>}
                                    {selected.preview.afterSummary && <p className="text-sm font-medium text-neutral-900">{selected.preview.afterSummary}</p>}
                                    <details className="mt-3 rounded-lg border border-neutral-200 bg-white/70 px-3 py-2 text-xs text-neutral-600">
                                        <summary className="min-h-10 cursor-pointer py-2 font-semibold text-neutral-700">Affected plan and outputs</summary>
                                        <p>PRD: {selected.preview.affectedPrdSections.join(', ') || 'No verified changes'}</p>
                                        <p className="mt-1">Outputs to review: {selected.preview.affectedArtifactLabels.join(', ') || 'None identified'}</p>
                                    </details>
                                    {selected.preview.explanation && <p className="mt-3 text-sm leading-6 text-neutral-700">{selected.preview.explanation}</p>}
                                    {selected.preview.proposals && selected.preview.proposals.length > 0 && (
                                        <div className="mt-4 space-y-3" aria-label="Proposed plan alignment changes">
                                            {selected.preview.proposals.map(proposal => (
                                                <article key={proposal.id} className="rounded-lg border border-indigo-100 bg-white p-3">
                                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                                        <p className="text-xs font-semibold text-neutral-900">{proposal.targetLabel}</p>
                                                        <span className="rounded-full bg-neutral-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{proposalDispositionLabel[proposal.disposition]}</span>
                                                    </div>
                                                    <p className="mt-1 text-[11px] text-neutral-500">{proposal.targetKind.replace('_', ' ')} · {proposal.section} · {proposal.confidence} impact relevance</p>
                                                    {proposal.beforeSummary && <p className="mt-2 text-xs text-neutral-500">Current: {proposal.beforeSummary}</p>}
                                                    {proposal.proposedSummary && <p className="mt-1 text-sm font-medium text-neutral-900">Proposed: {proposal.editedSummary || proposal.proposedSummary}</p>}
                                                    <p className="mt-2 text-xs leading-5 text-neutral-600">{proposal.reason}</p>
                                                    {proposal.analysisStatus && (proposal.analysisMethod === 'model' || proposal.analysisStatus !== 'bounded_applicable') && (
                                                        <div className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-700" aria-label={`Proposal analysis for ${proposal.targetLabel}`}>
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <span className="font-semibold text-neutral-900">{proposalAnalysisLabel[proposal.analysisStatus]}</span>
                                                                {proposal.reasoningConfidence && <span>· {proposal.reasoningConfidence} reasoning confidence</span>}
                                                                {proposal.evidenceCharacter && <span>· {evidenceCharacterLabel[proposal.evidenceCharacter]}</span>}
                                                                {proposal.analysisMethod && <span>· {proposal.analysisMethod === 'model' ? 'Synapse reasoning' : 'Checked automatically'}</span>}
                                                            </div>
                                                            {(proposal.analysisAmbiguity || proposal.analysisFailureReason) && <p className="mt-1 leading-5"><span className="font-semibold">Ambiguity or limit:</span> {proposal.analysisAmbiguity || proposal.analysisFailureReason}</p>}
                                                            {proposal.analysisQuestions && proposal.analysisQuestions.length > 0 && (
                                                                <div className="mt-1.5"><p className="font-semibold">Information still needed</p><ul className="mt-1 list-disc space-y-1 pl-4">{proposal.analysisQuestions.map(question => <li key={question}>{question}</li>)}</ul></div>
                                                            )}
                                                            {(proposal.analysisEvidence?.length || proposal.analysisModel) && (
                                                                <details className="mt-1.5">
                                                                    <summary className="cursor-pointer font-semibold">Reasoning basis{proposal.analysisEvidence?.length ? ` (${proposal.analysisEvidence.length})` : ''}</summary>
                                                                    {proposal.analysisEvidence && proposal.analysisEvidence.length > 0 && (
                                                                        <ul className="mt-1 space-y-1.5">
                                                                            {proposal.analysisEvidence.map(item => <li key={`${item.label}:${item.excerpt ?? ''}`}><span className="font-medium">{item.label}</span>{item.excerpt && <span className="block text-neutral-500">{item.excerpt}</span>}</li>)}
                                                                        </ul>
                                                                    )}
                                                                    {proposal.analysisModel && <p className="mt-2 text-[11px] text-neutral-500">Technical provenance: {proposal.analysisProvider ? `${proposal.analysisProvider} · ` : ''}{proposal.analysisModel}</p>}
                                                                </details>
                                                            )}
                                                        </div>
                                                    )}
                                                    {proposal.requiredForVerdictAlignment && proposal.disposition === 'rejected' && (
                                                        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">Keeping this exact claim preserves a contradiction with your selected answer. The plan remains unaligned until you accept or edit this change.</div>
                                                    )}
                                                    {(proposal.analysisStatus === 'needs_input' || (!proposal.analysisStatus && proposal.requiresInput)) ? (
                                                        <div className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Additional input is required before Synapse can safely propose an edit.</div>
                                                    ) : (!proposal.analysisStatus || proposal.analysisStatus === 'bounded_applicable') && !readOnly && selected.preview?.status === 'ready' && onReviewAlignmentProposal ? (
                                                        <div className="mt-3">
                                                            {proposal.canEditWording !== false && <input
                                                                aria-label={`Edit proposed change for ${proposal.targetLabel}`}
                                                                value={proposalEdits[proposal.id] ?? ''}
                                                                onChange={event => setProposalEdits(current => ({ ...current, [proposal.id]: event.target.value }))}
                                                                placeholder="Preserve your preferred wording (optional)"
                                                                className="w-full rounded-md border border-neutral-200 px-3 py-2 text-xs outline-none focus:border-indigo-400"
                                                            />}
                                                            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                                                <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'accepted')} className="min-h-11 w-full rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white sm:w-auto">Accept</button>
                                                                {proposal.canEditWording !== false && <button type="button" disabled={!(proposalEdits[proposal.id] ?? '').trim()} onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'edited', proposalEdits[proposal.id].trim())} className="min-h-11 w-full rounded-md border border-indigo-200 px-3 text-xs font-semibold text-indigo-700 disabled:opacity-40 sm:w-auto">Use my wording</button>}
                                                                <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'rejected')} className="min-h-11 w-full rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 sm:w-auto">{proposal.requiredForVerdictAlignment ? "Keep current (won't match your answer)" : 'Keep current'}</button>
                                                                <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'deferred')} className="min-h-11 w-full rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 sm:w-auto">Defer</button>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                    {(proposal.analysisStatus === 'already_aligned' || proposal.analysisStatus === 'not_applicable') && !readOnly && selected.preview?.status === 'ready' && onReviewAlignmentProposal && (
                                                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                                            <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, proposal.analysisStatus === 'already_aligned' ? 'confirmed_aligned' : 'confirmed_not_applicable')} className="min-h-11 w-full rounded-md border border-indigo-200 px-3 text-xs font-semibold text-indigo-700 sm:w-auto">{proposal.analysisStatus === 'already_aligned' ? 'Confirm already aligned' : 'Confirm not affected'}</button>
                                                            <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'deferred')} className="min-h-11 w-full rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 sm:w-auto">Defer review</button>
                                                        </div>
                                                    )}
                                                    {(proposal.requiresInput || (proposal.analysisStatus && !['bounded_applicable', 'already_aligned', 'not_applicable'].includes(proposal.analysisStatus))) && !readOnly && selected.preview?.status === 'ready' && onReviewAlignmentProposal && (
                                                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                                            <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'rejected')} className="min-h-11 w-full rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 sm:w-auto">Not affected</button>
                                                            <button type="button" onClick={() => onReviewAlignmentProposal(selected.id, selected.preview!.id, proposal.id, 'deferred')} className="min-h-11 w-full rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 sm:w-auto">Defer review</button>
                                                        </div>
                                                    )}
                                                    {!readOnly && proposal.canRequestReasoning && selected.preview?.status === 'ready' && onRequestAlignmentProposal && (
                                                        <div className="mt-3 border-t border-neutral-100 pt-3">
                                                            {proposalRequest?.proposalId === proposal.id ? (
                                                                <div className="space-y-2" aria-label={`Request proposal for ${proposal.targetLabel}`}>
                                                                    <label className="block text-xs font-semibold text-neutral-800" htmlFor={`proposal-guidance-${proposal.id}`}>
                                                                        {proposalRequest.kind === 'different_interpretation'
                                                                            ? 'What should Synapse interpret differently?'
                                                                            : proposal.analysisMethod === 'model' && proposal.analysisStatus === 'needs_input'
                                                                                ? 'What missing information should Synapse account for?'
                                                                                : 'Add context for this proposal (optional)'}
                                                                    </label>
                                                                    <textarea
                                                                        id={`proposal-guidance-${proposal.id}`}
                                                                        rows={3}
                                                                        value={proposalGuidance}
                                                                        onChange={event => setProposalGuidance(event.target.value)}
                                                                        placeholder={proposalRequest.kind === 'different_interpretation'
                                                                            ? 'Describe the direction or meaning you want Synapse to reconsider.'
                                                                            : proposal.analysisMethod === 'model' && proposal.analysisStatus === 'needs_input'
                                                                                ? 'Add the constraint, evidence, or product context needed to answer the question above.'
                                                                                : 'Optional: add a constraint or product detail Synapse should account for.'}
                                                                        className="w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                                                                    />
                                                                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                                                                        <button
                                                                            type="button"
                                                                            disabled={proposal.analysisBusy || ((proposalRequest.kind === 'different_interpretation' || (proposal.analysisMethod === 'model' && proposal.analysisStatus === 'needs_input')) && !proposalGuidance.trim())}
                                                                            onClick={() => { void requestAlignmentProposal(proposal.id); }}
                                                                            className="min-h-11 w-full rounded-md bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-40 sm:w-auto"
                                                                        >
                                                                            {proposal.analysisBusy
                                                                                ? 'Preparing proposal…'
                                                                                : proposalRequest.kind === 'different_interpretation'
                                                                                    ? 'Prepare another interpretation'
                                                                                    : proposal.analysisMethod === 'model' && proposal.analysisStatus === 'needs_input'
                                                                                        ? 'Try again with context'
                                                                                        : 'Prepare proposed change'}
                                                                        </button>
                                                                        <button type="button" disabled={proposal.analysisBusy} onClick={() => { setProposalRequest(undefined); setProposalGuidance(''); }} className="min-h-11 w-full rounded-md border border-neutral-200 px-3 text-xs font-medium text-neutral-700 sm:w-auto">Cancel</button>
                                                                    </div>
                                                                </div>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setProposalRequest({ proposalId: proposal.id, kind: ['bounded_applicable', 'already_aligned', 'not_applicable'].includes(proposal.analysisStatus ?? '') ? 'different_interpretation' : 'missing_info' });
                                                                        setProposalGuidance('');
                                                                    }}
                                                                    className="min-h-11 w-full rounded-md border border-indigo-200 px-3 text-xs font-semibold text-indigo-700 sm:w-auto"
                                                                >
                                                                    {['bounded_applicable', 'already_aligned', 'not_applicable'].includes(proposal.analysisStatus ?? '')
                                                                        ? 'Ask for a different reading'
                                                                        : proposal.analysisMethod === 'model' && proposal.analysisStatus === 'needs_input'
                                                                            ? 'Provide missing information'
                                                                            : 'Ask Synapse to propose wording'}
                                                                </button>
                                                            )}
                                                            {proposal.analysisError && <p className="mt-2 text-xs leading-5 text-red-700" role="alert">{proposal.analysisError} The original review target remains unchanged.</p>}
                                                        </div>
                                                    )}
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                    {!readOnly && selected.preview.status === 'ready' && selected.preview.canApply && <button type="button" onClick={() => onApplyToPlan(selected.id)} className="mt-4 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">Apply accepted changes</button>}
                                    </details>
                                    {selected.preview.error && <p className="mt-2 text-sm text-red-700">{selected.preview.error}</p>}
                                    {!readOnly && (selected.preview.status === 'stale' || selected.preview.status === 'failed') && <button type="button" onClick={() => onPreviewImpact(selected.id)} className="mt-4 min-h-11 rounded-lg border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800"><RefreshCcw size={14} className="mr-1 inline" /> Refresh preview</button>}
                                </section>
                            ) : !readOnly && ['confirmed', 'rejected', 'resolved'].includes(selected.status) ? (
                                <button type="button" onClick={() => onPreviewImpact(selected.id)} className="mt-6 min-h-11 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700">Preview impact</button>
                            ) : null}

                            {selected.recommendation
                                && !(needsVerdict(selected) && !readOnly && selected.type !== 'assumption'
                                    && selected.recommendation.optionId
                                    && selected.options?.some(option => option.id === selected.recommendation?.optionId)) && (
                                <section className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/70 p-4">
                                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700"><Sparkles size={14} /> Synapse recommendation</div>
                                    <p className="mt-2 text-sm font-semibold text-indigo-950">{selected.recommendation.summary}</p>
                                    {selected.recommendation.rationale && <p className="mt-1 text-sm leading-6 text-indigo-900/80">{selected.recommendation.rationale}</p>}
                                </section>
                            )}

                            {selected.options && selected.options.length > 0 && needsVerdict(selected) && (readOnly || selected.type === 'assumption') && (
                                <section className="mt-6 space-y-2" aria-label="Available options">
                                    <h3 className="text-sm font-semibold text-neutral-900">Alternatives and tradeoffs</h3>
                                    {selected.options.map(option => (
                                        <button key={option.id} type="button" disabled={readOnly} onClick={() => submit('confirm', option.id)} className="min-h-11 w-full rounded-xl border border-neutral-200 bg-white p-4 text-left hover:border-indigo-300 disabled:cursor-not-allowed disabled:opacity-60">
                                            <span className="text-sm font-semibold text-neutral-900">{option.label}</span>
                                            {option.description && <span className="mt-1 block text-sm text-neutral-600">{option.description}</span>}
                                            {option.tradeoffs && option.tradeoffs.length > 0 && <span className="mt-2 block text-xs text-neutral-500">{option.tradeoffs.map(item => item.summary).join(' · ')}</span>}
                                        </button>
                                    ))}
                                </section>
                            )}

                            {!readOnly && !needsVerdict(selected) && (
                                <details className="mt-6 rounded-xl border border-neutral-200 bg-white">
                                    <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-neutral-700">Change this record</summary>
                                    <section className="border-t border-neutral-100 p-4">
                                    {['confirmed', 'rejected', 'resolved'].includes(selected.status) && <>
                                    <label className="text-sm font-semibold text-neutral-900" htmlFor="decision-revision">Revise or invalidate</label>
                                    <textarea id="decision-revision" value={customAnswer} onChange={event => setCustomAnswer(event.target.value)} rows={2} placeholder="Enter the revised answer or explain why this decision is no longer valid" className="mt-2 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <button type="button" disabled={!customAnswer.trim()} onClick={() => submit('revise', customAnswer.trim())} className="min-h-11 rounded-lg border border-indigo-200 px-4 text-sm font-semibold text-indigo-700 disabled:opacity-40">Save revision</button>
                                        <button type="button" disabled={!customAnswer.trim()} onClick={() => submit('invalidate', customAnswer.trim())} className="min-h-11 rounded-lg border border-red-200 px-4 text-sm font-semibold text-red-700 disabled:opacity-40">Mark no longer valid</button>
                                    </div>
                                    </>}
                                    <button type="button" onClick={() => submit('reopen')} className="mt-4 min-h-11 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-700 hover:bg-neutral-50"><RefreshCcw size={14} className="mr-1 inline" /> Reopen decision</button>
                                    </section>
                                </details>
                            )}
                            <details className="mt-7 border-t border-neutral-200 pt-4">
                                <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-semibold text-neutral-700"><ChevronDown size={14} /> Source and history</summary>
                                <p className="mt-2 text-xs text-neutral-500">Sources: {selected.sourceLabels?.join(', ') || 'User-created decision'}</p>
                                <ol className="mt-3 space-y-3 border-l border-neutral-200 pl-4">
                                    {(selected.history ?? []).map(item => <li key={item.id}><p className="text-sm font-medium text-neutral-800">{item.label}</p><p className="text-xs text-neutral-400">{new Date(item.at).toLocaleString()}</p>{item.rationale && <p className="mt-1 text-xs text-neutral-600">{item.rationale}</p>}</li>)}
                                </ol>
                            </details>
                        </div>
                    )}
                </main>
            </div>
        </div>
    );
}
