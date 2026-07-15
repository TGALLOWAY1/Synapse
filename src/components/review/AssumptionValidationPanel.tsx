import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, FlaskConical, Plus, Sparkles } from 'lucide-react';
import type {
    AssumptionEvidenceConclusion,
    AssumptionEvidenceRecord,
    AssumptionEvidenceSourceType,
    AssumptionInterpretationProposal,
    AssumptionUncertaintyTreatment,
    AssumptionValidationMethodKind,
    AssumptionValidationPlan,
    AssumptionValidationPlanProposal,
    AssumptionValidationWorkflowState,
} from '../../types';

export type AssumptionValidationPlanInput = {
    question: string;
    methodKind: AssumptionValidationMethodKind;
    methodLabel: string;
    supportSignals: string[];
    contradictionSignals: string[];
    inconclusiveConditions: string[];
    limitations: string[];
    revisitCondition?: string;
    expiresAt?: number;
    sourceProposalId?: string;
    sourceProposalContentHash?: string;
};

export type AssumptionEvidenceInput = {
    sourceType: AssumptionEvidenceSourceType;
    source: string;
    sourceIdentity: string;
    observedAt: number;
    observation: string;
    scopeOrSample?: string;
    limitations: string[];
    character: 'direct' | 'interpretation';
    relation: AssumptionEvidenceRecord['relation'];
};

export type AssumptionValidationView = {
    workflowState: AssumptionValidationWorkflowState;
    currentPlan?: AssumptionValidationPlan;
    latestPlanProposal?: AssumptionValidationPlanProposal;
    activeEvidence: AssumptionEvidenceRecord[];
    duplicateEvidenceIds: string[];
    evidenceFromAnotherQuestionIds: string[];
    latestInterpretation?: AssumptionInterpretationProposal;
    acceptedConclusion?: AssumptionEvidenceConclusion;
    conclusionIsCurrent: boolean;
    userTreatment?: AssumptionUncertaintyTreatment;
    treatmentRationale?: string;
    revisitAt?: number;
    revisitCondition?: string;
    hasHistoricalValidation: boolean;
    dependentLabels: string[];
    history: Array<{ id: string; label: string; at: number; detail?: string }>;
};

interface Props {
    recordId: string;
    readOnly?: boolean;
    validation: AssumptionValidationView;
    requiresValidation: boolean;
    consequence?: string;
    hasPlanImpact: boolean;
    onGeneratePlan: (recordId: string) => void;
    onRecordPlan: (recordId: string, input: AssumptionValidationPlanInput) => void;
    onAddEvidence: (recordId: string, input: AssumptionEvidenceInput) => void;
    onInterpretEvidence: (recordId: string) => void;
    onRecordOutcome: (recordId: string, input: {
        conclusion: AssumptionEvidenceConclusion;
        caveats?: string;
        revisitAt?: number;
        revisitCondition?: string;
        sourceInterpretationId?: string;
        sourceInterpretationContentHash?: string;
    }) => void;
    onRecordTreatment: (recordId: string, input: {
        treatment: AssumptionUncertaintyTreatment;
        rationale: string;
        revisitAt?: number;
        revisitCondition?: string;
    }) => void;
    onReopenOutcome: (recordId: string, reason: string) => void;
    onPreviewImpact: (recordId: string) => void;
}

const workflowLabels: Record<AssumptionValidationWorkflowState, string> = {
    not_planned: 'Not planned',
    planned: 'Validation planned',
    in_progress: 'Evidence in progress',
    completed: 'Outcome recorded',
    due_for_review: 'Due for review',
};

const conclusionLabels: Record<AssumptionEvidenceConclusion, string> = {
    unsupported: 'Unsupported',
    supported: 'Supported',
    partially_supported: 'Partially supported',
    contradicted: 'Contradicted',
    inconclusive: 'Inconclusive',
    more_evidence_needed: 'More evidence needed',
};

const treatmentLabels: Record<AssumptionUncertaintyTreatment, string> = {
    accepted_without_validation: 'Accepted without validation',
    temporarily_tolerated: 'Temporarily tolerated',
    deferred: 'Deferred',
};

const methodOptions: Array<{ value: AssumptionValidationMethodKind; label: string }> = [
    { value: 'user_interviews', label: 'User interviews' },
    { value: 'usability_observation', label: 'Usability observation' },
    { value: 'technical_test', label: 'Technical test' },
    { value: 'prototype', label: 'Prototype' },
    { value: 'analytics_measurement', label: 'Analytics measurement' },
    { value: 'stakeholder_statement', label: 'Stakeholder statement' },
    { value: 'expert_review', label: 'Expert review' },
    { value: 'document_review', label: 'Document review' },
    { value: 'direct_observation', label: 'Direct observation' },
    { value: 'other', label: 'Other' },
];

const evidenceSourceOptions: Array<{ value: AssumptionEvidenceSourceType; label: string }> = [
    { value: 'user_interview', label: 'User interview' },
    { value: 'usability_observation', label: 'Usability observation' },
    { value: 'technical_test', label: 'Technical test' },
    { value: 'prototype', label: 'Prototype' },
    { value: 'analytics_measurement', label: 'Analytics or measurement' },
    { value: 'stakeholder_statement', label: 'Stakeholder statement' },
    { value: 'expert_review', label: 'Expert review' },
    { value: 'document', label: 'Document' },
    { value: 'external_source', label: 'External source' },
    { value: 'direct_observation', label: 'Direct observation' },
    { value: 'other', label: 'Other' },
];

const splitLines = (value: string): string[] => value.split('\n').map(item => item.trim()).filter(Boolean);

const formatDate = (timestamp: number): string => new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
}).format(timestamp);

const todayInputValue = (): string => {
    const today = new Date();
    const local = new Date(today.getTime() - today.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
};

const dateInputValue = (timestamp?: number): string => {
    if (timestamp === undefined) return '';
    const date = new Date(timestamp);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
};

const dateInputTimestamp = (value: string): number | undefined =>
    value ? new Date(`${value}T12:00:00`).getTime() : undefined;

const consequenceWithoutPrefix = (value: string): string =>
    value.replace(/^\s*if\s+this\s+is\s+wrong\s*[:,—–-]?\s*/i, '').trim();

const methodEvidenceGuidance = (method: AssumptionValidationMethodKind): string => {
    if (['user_interviews', 'usability_observation', 'prototype'].includes(method)) {
        return 'For readiness, record at least two independent direct observations from this method, including the scope or sample.';
    }
    if (['technical_test', 'analytics_measurement'].includes(method)) {
        return 'For readiness, record at least one direct result from this method and compare it with the support and contradiction signals.';
    }
    if (method === 'direct_observation') {
        return 'For readiness, record at least one direct observation with its scope and compare it with the support and contradiction signals.';
    }
    return 'This method can inform the project, but it cannot by itself establish evidence-backed readiness.';
};

export function AssumptionValidationPanel({
    recordId,
    readOnly,
    validation,
    requiresValidation,
    consequence,
    hasPlanImpact,
    onGeneratePlan,
    onRecordPlan,
    onAddEvidence,
    onInterpretEvidence,
    onRecordOutcome,
    onRecordTreatment,
    onReopenOutcome,
    onPreviewImpact,
}: Props) {
    const [planDraft, setPlanDraft] = useState({
        question: validation.currentPlan?.question ?? '',
        methodKind: validation.currentPlan?.method.kind ?? 'user_interviews' as AssumptionValidationMethodKind,
        methodLabel: validation.currentPlan?.method.label ?? 'User interviews',
        supportSignals: validation.currentPlan?.supportSignals.join('\n') ?? '',
        contradictionSignals: validation.currentPlan?.contradictionSignals.join('\n') ?? '',
        inconclusiveConditions: validation.currentPlan?.inconclusiveConditions.join('\n') ?? '',
        limitations: validation.currentPlan?.limitations.join('\n') ?? '',
        revisitCondition: validation.currentPlan?.revisitCondition ?? '',
        expiryDate: dateInputValue(validation.currentPlan?.expiresAt),
        sourceProposalId: undefined as string | undefined,
        sourceProposalContentHash: undefined as string | undefined,
    });
    const [evidenceDraft, setEvidenceDraft] = useState({
        sourceType: 'user_interview' as AssumptionEvidenceSourceType,
        source: '', sourceIdentity: '', observation: '', scopeOrSample: '', limitations: '', observedDate: todayInputValue(),
        character: 'direct' as 'direct' | 'interpretation',
        relation: 'inconclusive' as AssumptionEvidenceRecord['relation'],
    });
    const [outcome, setOutcome] = useState<AssumptionEvidenceConclusion | ''>('');
    const [outcomeCaveats, setOutcomeCaveats] = useState('');
    const [outcomeRevisit, setOutcomeRevisit] = useState('');
    const [outcomeRevisitDate, setOutcomeRevisitDate] = useState('');
    const [treatment, setTreatment] = useState<AssumptionUncertaintyTreatment>('temporarily_tolerated');
    const [treatmentRationale, setTreatmentRationale] = useState('');
    const [treatmentRevisit, setTreatmentRevisit] = useState('');
    const [treatmentRevisitDate, setTreatmentRevisitDate] = useState('');
    const [reopenReason, setReopenReason] = useState('');
    const duplicateIds = new Set(validation.duplicateEvidenceIds);
    const consequenceDetail = consequence ? consequenceWithoutPrefix(consequence) : '';

    const useProposal = () => {
        const proposal = validation.latestPlanProposal;
        if (!proposal) return;
        setPlanDraft({
            question: proposal.question,
            methodKind: proposal.method.kind,
            methodLabel: proposal.method.label,
            supportSignals: proposal.supportSignals.join('\n'),
            contradictionSignals: proposal.contradictionSignals.join('\n'),
            inconclusiveConditions: proposal.inconclusiveConditions.join('\n'),
            limitations: proposal.limitations.join('\n'),
            revisitCondition: proposal.revisitCondition ?? '',
            expiryDate: dateInputValue(proposal.expiresAt),
            sourceProposalId: proposal.id,
            sourceProposalContentHash: proposal.contentHash,
        });
    };

    const savePlan = () => {
        if (!planDraft.question.trim() || !planDraft.methodLabel.trim()) return;
        onRecordPlan(recordId, {
            question: planDraft.question.trim(),
            methodKind: planDraft.methodKind,
            methodLabel: planDraft.methodLabel.trim(),
            supportSignals: splitLines(planDraft.supportSignals),
            contradictionSignals: splitLines(planDraft.contradictionSignals),
            inconclusiveConditions: splitLines(planDraft.inconclusiveConditions),
            limitations: splitLines(planDraft.limitations),
            revisitCondition: planDraft.revisitCondition.trim() || undefined,
            expiresAt: dateInputTimestamp(planDraft.expiryDate),
            sourceProposalId: planDraft.sourceProposalId,
            sourceProposalContentHash: planDraft.sourceProposalContentHash,
        });
    };

    const saveEvidence = () => {
        if (!evidenceDraft.source.trim() || !evidenceDraft.sourceIdentity.trim() || !evidenceDraft.observation.trim() || !evidenceDraft.observedDate) return;
        onAddEvidence(recordId, {
            sourceType: evidenceDraft.sourceType,
            source: evidenceDraft.source.trim(),
            sourceIdentity: evidenceDraft.sourceIdentity.trim(),
            observedAt: dateInputTimestamp(evidenceDraft.observedDate)!,
            observation: evidenceDraft.observation.trim(),
            scopeOrSample: evidenceDraft.scopeOrSample.trim() || undefined,
            limitations: splitLines(evidenceDraft.limitations),
            character: evidenceDraft.character,
            relation: evidenceDraft.relation,
        });
        setEvidenceDraft(current => ({ ...current, source: '', sourceIdentity: '', observation: '', scopeOrSample: '', limitations: '' }));
    };

    return (
        <section className="mt-6 rounded-xl border border-indigo-100 bg-white p-4 sm:p-5" aria-labelledby={`assumption-validation-${recordId}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-700"><FlaskConical size={14} /> {requiresValidation ? 'Assumption validation' : 'Optional assumption validation'}</div>
                    <h3 id={`assumption-validation-${recordId}`} className="mt-1 text-base font-semibold text-neutral-950">{requiresValidation ? 'Replace belief with evidence' : 'Validate if it would improve the plan'}</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-neutral-600">{requiresValidation ? 'Acceptance lets planning continue but does not establish that the belief is true. Validation requires evidence that answers a specific question.' : 'This assumption is not consequential enough to require a formal test. You can still validate it if new evidence would change the plan.'}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${validation.workflowState === 'completed' ? 'bg-emerald-50 text-emerald-700' : validation.workflowState === 'due_for_review' ? 'bg-amber-50 text-amber-800' : 'bg-neutral-100 text-neutral-700'}`}>
                    {workflowLabels[validation.workflowState]}
                </span>
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Evidence conclusion</p>
                    <p className="mt-1 text-sm font-semibold text-neutral-900">{validation.acceptedConclusion ? conclusionLabels[validation.acceptedConclusion] : 'No current conclusion'}</p>
                    {!validation.conclusionIsCurrent && validation.hasHistoricalValidation && <p className="mt-1 text-xs text-amber-700">Earlier validation is historical and cannot support the current assumption.</p>}
                </div>
                <div className="rounded-lg bg-neutral-50 px-3 py-2.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Unresolved uncertainty</p>
                    <p className="mt-1 text-sm font-semibold text-neutral-900">{validation.userTreatment ? treatmentLabels[validation.userTreatment] : 'Not explicitly treated'}</p>
                    {validation.treatmentRationale && <p className="mt-1 text-xs text-neutral-600">{validation.treatmentRationale}</p>}
                </div>
            </div>

            {validation.acceptedConclusion && requiresValidation && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" role="status">
                    Your conclusion is recorded, but the current evidence does not yet satisfy this validation method or current planning version. The assumption remains unresolved for readiness.
                </div>
            )}

            <section className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-3" aria-label="Potential plan impact">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Potential plan impact</p>
                {consequenceDetail && <p className="mt-1 text-sm leading-5 text-neutral-700"><strong className="text-neutral-900">If this is wrong:</strong> {consequenceDetail}</p>}
                <p className="mt-1 text-xs leading-5 text-neutral-600"><strong className="text-neutral-800">Dependent areas:</strong> {validation.dependentLabels.length > 0 ? validation.dependentLabels.join(' · ') : 'No exact dependent areas have been identified.'}</p>
                <p className="mt-1 text-xs leading-5 text-neutral-500">This is a read-only preview. Recording a conclusion will not change the plan; exact changes must use the guarded alignment review.</p>
            </section>

            {(validation.revisitCondition || validation.revisitAt) && (
                <div className="mt-3 flex gap-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                    <Clock3 size={15} className="mt-0.5 shrink-0" /> <span>{validation.revisitAt && <><strong>Review date:</strong> {formatDate(validation.revisitAt)}. </>}{validation.revisitCondition && <><strong>Revisit when:</strong> {validation.revisitCondition}</>}</span>
                </div>
            )}

            {!readOnly && (
                <details className="mt-5 rounded-lg border border-neutral-200" open={!validation.currentPlan}>
                    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-neutral-900">1. Plan the smallest credible test</summary>
                    <div className="border-t border-neutral-100 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <button type="button" onClick={() => onGeneratePlan(recordId)} className="min-h-11 rounded-lg border border-indigo-200 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50"><Sparkles size={14} className="mr-1.5 inline" /> Ask Synapse to suggest a plan</button>
                            {validation.latestPlanProposal && <button type="button" onClick={useProposal} className="min-h-11 rounded-lg border border-neutral-200 px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">Use suggestion as a draft</button>}
                        </div>
                        {validation.latestPlanProposal && (
                            <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/70 px-3 py-2.5">
                                <p className="text-xs font-semibold text-indigo-800">Synapse proposal · not yet your plan</p>
                                <p className="mt-1 text-sm font-medium text-indigo-950">{validation.latestPlanProposal.question}</p>
                                <p className="mt-1 text-xs text-indigo-800">{validation.latestPlanProposal.method.label}</p>
                            </div>
                        )}
                        <label htmlFor={`validation-question-${recordId}`} className="mt-4 block text-xs font-semibold text-neutral-700">Validation question</label>
                        <textarea id={`validation-question-${recordId}`} rows={2} value={planDraft.question} onChange={event => setPlanDraft(current => ({ ...current, question: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} placeholder="What observable result would reduce uncertainty?" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" />
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold text-neutral-700">Method
                                <select value={planDraft.methodKind} onChange={event => { const kind = event.target.value as AssumptionValidationMethodKind; const label = methodOptions.find(item => item.value === kind)?.label ?? 'Other'; setPlanDraft(current => ({ ...current, methodKind: kind, methodLabel: label, sourceProposalId: undefined, sourceProposalContentHash: undefined })); }} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal">
                                    {methodOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                                </select>
                            </label>
                            <label className="text-xs font-semibold text-neutral-700">Method label
                                <input value={planDraft.methodLabel} onChange={event => setPlanDraft(current => ({ ...current, methodLabel: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm font-normal" />
                            </label>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <label className="text-xs font-semibold text-neutral-700">Evidence that would support it
                                <textarea value={planDraft.supportSignals} onChange={event => setPlanDraft(current => ({ ...current, supportSignals: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} rows={3} placeholder="One signal per line" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                            </label>
                            <label className="text-xs font-semibold text-neutral-700">Evidence that would contradict it
                                <textarea value={planDraft.contradictionSignals} onChange={event => setPlanDraft(current => ({ ...current, contradictionSignals: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} rows={3} placeholder="One signal per line" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                            </label>
                        </div>
                        <details className="mt-3 rounded-lg bg-neutral-50 px-3 py-2">
                            <summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold text-neutral-700">Limits and revisit conditions</summary>
                            <label className="block text-xs font-medium text-neutral-600">What would remain inconclusive?
                                <textarea value={planDraft.inconclusiveConditions} onChange={event => setPlanDraft(current => ({ ...current, inconclusiveConditions: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} rows={2} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                            </label>
                            <label className="mt-3 block text-xs font-medium text-neutral-600">Method limitations
                                <textarea value={planDraft.limitations} onChange={event => setPlanDraft(current => ({ ...current, limitations: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} rows={2} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                            </label>
                            <label className="mt-3 block text-xs font-medium text-neutral-600">Revisit when
                                <input value={planDraft.revisitCondition} onChange={event => setPlanDraft(current => ({ ...current, revisitCondition: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} placeholder="For example, before pricing is finalized" className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm font-normal" />
                            </label>
                            <label className="mt-3 block text-xs font-medium text-neutral-600">Validation expires on (optional)
                                <input type="date" value={planDraft.expiryDate} onChange={event => setPlanDraft(current => ({ ...current, expiryDate: event.target.value, sourceProposalId: undefined, sourceProposalContentHash: undefined }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal sm:w-auto" />
                            </label>
                        </details>
                        <button type="button" disabled={!planDraft.question.trim() || !planDraft.methodLabel.trim()} onClick={savePlan} className="mt-3 min-h-11 w-full rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto">Record my validation plan</button>
                    </div>
                </details>
            )}

            {validation.currentPlan && (
                <details className="mt-3 rounded-lg border border-neutral-200" open={validation.activeEvidence.length === 0}>
                    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-neutral-900">2. Add evidence <span className="ml-1 font-normal text-neutral-500">({validation.activeEvidence.length})</span></summary>
                    <div className="border-t border-neutral-100 p-3">
                        <p className="text-sm font-medium text-neutral-900">Question: {validation.currentPlan.question}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">{methodEvidenceGuidance(validation.currentPlan.method.kind)}</p>
                        {validation.activeEvidence.length > 0 && (
                            <ul className="mt-3 space-y-2" aria-label="Recorded evidence">
                                {validation.activeEvidence.map(evidence => (
                                    <li key={evidence.id} className={`rounded-lg border px-3 py-2.5 ${duplicateIds.has(evidence.id) ? 'border-amber-200 bg-amber-50' : 'border-neutral-200 bg-white'}`}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs font-semibold text-neutral-900">{evidence.source}</span>
                                            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{evidence.relation}</span>
                                            <span className="text-[11px] text-neutral-500">{evidence.character === 'direct' ? 'Direct observation' : 'Interpretation'} · {formatDate(evidence.observedAt)}</span>
                                        </div>
                                        <p className="mt-1 text-sm leading-5 text-neutral-700">{evidence.observation}</p>
                                        {evidence.relation === 'irrelevant' && <p className="mt-1 text-xs text-neutral-500">This source is preserved, but does not count as support for this question.</p>}
                                        {duplicateIds.has(evidence.id) && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle size={13} /> Duplicate source — not independent corroboration.</p>}
                                        {(evidence.scopeOrSample || evidence.limitations.length > 0) && <details className="mt-2 text-xs text-neutral-600"><summary className="cursor-pointer font-medium">Scope and limitations</summary>{evidence.scopeOrSample && <p className="mt-1">Scope: {evidence.scopeOrSample}</p>}{evidence.limitations.length > 0 && <p className="mt-1">Limits: {evidence.limitations.join(' · ')}</p>}</details>}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {validation.evidenceFromAnotherQuestionIds.length > 0 && <p className="mt-3 text-xs text-amber-700">{validation.evidenceFromAnotherQuestionIds.length} earlier evidence record{validation.evidenceFromAnotherQuestionIds.length === 1 ? '' : 's'} answered a different validation question and cannot support this one.</p>}
                        {!readOnly && (
                            <div className="mt-4 rounded-lg bg-neutral-50 p-3">
                                <h4 className="text-xs font-semibold uppercase tracking-wide text-neutral-600"><Plus size={13} className="mr-1 inline" /> Record evidence</h4>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <label className="text-xs font-semibold text-neutral-700">Evidence type
                                        <select value={evidenceDraft.sourceType} onChange={event => setEvidenceDraft(current => ({ ...current, sourceType: event.target.value as AssumptionEvidenceSourceType }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal">{evidenceSourceOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
                                    </label>
                                    <label className="text-xs font-semibold text-neutral-700">Source
                                        <input value={evidenceDraft.source} onChange={event => setEvidenceDraft(current => ({ ...current, source: event.target.value }))} placeholder="Interview participant, test, or document" className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal" />
                                    </label>
                                </div>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Source identity
                                    <input value={evidenceDraft.sourceIdentity} onChange={event => setEvidenceDraft(current => ({ ...current, sourceIdentity: event.target.value }))} placeholder="Stable URL, session ID, experiment ID, or file ID" className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal" />
                                </label>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Observed on
                                    <input type="date" value={evidenceDraft.observedDate} onChange={event => setEvidenceDraft(current => ({ ...current, observedDate: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal sm:w-auto" />
                                </label>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Observation or result
                                    <textarea value={evidenceDraft.observation} onChange={event => setEvidenceDraft(current => ({ ...current, observation: event.target.value }))} rows={3} className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-normal" />
                                </label>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <label className="text-xs font-semibold text-neutral-700">Relation to the question
                                        <select value={evidenceDraft.relation} onChange={event => setEvidenceDraft(current => ({ ...current, relation: event.target.value as AssumptionEvidenceRecord['relation'] }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal"><option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="inconclusive">Inconclusive</option><option value="irrelevant">Irrelevant</option></select>
                                    </label>
                                    <label className="text-xs font-semibold text-neutral-700">Evidence character
                                        <select value={evidenceDraft.character} onChange={event => setEvidenceDraft(current => ({ ...current, character: event.target.value as 'direct' | 'interpretation' }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal"><option value="direct">Direct observation</option><option value="interpretation">Interpretation</option></select>
                                    </label>
                                </div>
                                <details className="mt-3"><summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold text-neutral-600">Add scope or limitations</summary><label className="block text-xs text-neutral-600">Scope or sample<input value={evidenceDraft.scopeOrSample} onChange={event => setEvidenceDraft(current => ({ ...current, scopeOrSample: event.target.value }))} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm" /></label><label className="mt-3 block text-xs text-neutral-600">Limitations<textarea value={evidenceDraft.limitations} onChange={event => setEvidenceDraft(current => ({ ...current, limitations: event.target.value }))} rows={2} placeholder="One per line" className="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm" /></label></details>
                                <button type="button" disabled={!evidenceDraft.source.trim() || !evidenceDraft.sourceIdentity.trim() || !evidenceDraft.observation.trim() || !evidenceDraft.observedDate} onClick={saveEvidence} className="mt-3 min-h-11 w-full rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto">Add evidence</button>
                            </div>
                        )}
                    </div>
                </details>
            )}

            {validation.currentPlan && validation.activeEvidence.length > 0 && (
                <details className="mt-3 rounded-lg border border-neutral-200" open={!validation.acceptedConclusion}>
                    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-neutral-900">3. Interpret and record what you learned</summary>
                    <div className="border-t border-neutral-100 p-3">
                        {!readOnly && <button type="button" onClick={() => onInterpretEvidence(recordId)} className="min-h-11 w-full rounded-lg border border-indigo-200 px-3 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 sm:w-auto"><Sparkles size={14} className="mr-1.5 inline" /> Review evidence with Synapse</button>}
                        {validation.latestInterpretation && (
                            <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/70 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">Synapse interpretation · advisory</p><span className="text-xs font-semibold text-indigo-900">{conclusionLabels[validation.latestInterpretation.recommendedConclusion]}</span></div>
                                <p className="mt-2 text-sm leading-6 text-indigo-950">{validation.latestInterpretation.reasoning}</p>
                                <p className="mt-2 text-xs text-indigo-800">This interpretation cannot become the project outcome until you explicitly record your conclusion.</p>
                                <details className="mt-2 text-xs text-indigo-900"><summary className="cursor-pointer font-semibold">Reasoning details</summary><p className="mt-1">Supports: {validation.latestInterpretation.supportingEvidenceIds.length} · Contradicts: {validation.latestInterpretation.contradictingEvidenceIds.length} · Inconclusive: {validation.latestInterpretation.inconclusiveEvidenceIds.length} · Irrelevant: {validation.latestInterpretation.irrelevantEvidenceIds.length} · Duplicates excluded: {validation.latestInterpretation.duplicateEvidenceIds.length}</p>{validation.latestInterpretation.limitations.length > 0 && <p className="mt-1">Limits: {validation.latestInterpretation.limitations.join(' · ')}</p>}</details>
                                {!readOnly && <button type="button" onClick={() => setOutcome(validation.latestInterpretation!.recommendedConclusion)} className="mt-3 min-h-11 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-semibold text-indigo-700">Use as my draft conclusion</button>}
                            </div>
                        )}
                        {!readOnly && (
                            <div className="mt-4 rounded-lg border border-neutral-200 p-3">
                                <h4 className="text-sm font-semibold text-neutral-900">Your recorded outcome</h4>
                                <p className="mt-1 text-xs leading-5 text-neutral-500">You remain responsible for the conclusion. Contradictory evidence may legitimately remain inconclusive.</p>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Conclusion
                                    <select aria-label="Your validation conclusion" value={outcome} onChange={event => setOutcome(event.target.value as AssumptionEvidenceConclusion)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal"><option value="">Choose a conclusion</option>{Object.entries(conclusionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
                                </label>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Caveats
                                    <textarea value={outcomeCaveats} onChange={event => setOutcomeCaveats(event.target.value)} rows={2} placeholder="What does this evidence still not establish?" className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                                </label>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Revisit when (optional)
                                    <input value={outcomeRevisit} onChange={event => setOutcomeRevisit(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm font-normal" />
                                </label>
                                <label className="mt-3 block text-xs font-semibold text-neutral-700">Conclusion revisit on (optional)
                                    <input type="date" value={outcomeRevisitDate} onChange={event => setOutcomeRevisitDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal sm:w-auto" />
                                </label>
                                <button type="button" disabled={!outcome} onClick={() => onRecordOutcome(recordId, { conclusion: outcome || 'inconclusive', caveats: outcomeCaveats.trim() || undefined, revisitAt: dateInputTimestamp(outcomeRevisitDate), revisitCondition: outcomeRevisit.trim() || undefined, sourceInterpretationId: validation.latestInterpretation?.id, sourceInterpretationContentHash: validation.latestInterpretation?.contentHash })} className="mt-3 min-h-11 w-full rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto">Record my conclusion</button>
                            </div>
                        )}
                    </div>
                </details>
            )}

            {!readOnly && !validation.acceptedConclusion && (
                <details className="mt-3 rounded-lg border border-neutral-200">
                    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-neutral-900">Proceed without validation</summary>
                    <div className="border-t border-neutral-100 p-3">
                        <p className="text-xs leading-5 text-neutral-600">This records how you are treating unresolved uncertainty. It does not validate the assumption or erase the risk.</p>
                        <label className="mt-3 block text-xs font-semibold text-neutral-700">Treatment
                            <select value={treatment} onChange={event => setTreatment(event.target.value as AssumptionUncertaintyTreatment)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal"><option value="accepted_without_validation">Accepted without validation</option><option value="temporarily_tolerated">Temporarily tolerated</option><option value="deferred">Deferred</option></select>
                        </label>
                        <label className="mt-3 block text-xs font-semibold text-neutral-700">Why proceed?
                            <textarea value={treatmentRationale} onChange={event => setTreatmentRationale(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                        </label>
                        <label className="mt-3 block text-xs font-semibold text-neutral-700">Revisit when (optional)
                            <input value={treatmentRevisit} onChange={event => setTreatmentRevisit(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm font-normal" />
                        </label>
                        <label className="mt-3 block text-xs font-semibold text-neutral-700">Uncertainty revisit on (optional)
                            <input type="date" value={treatmentRevisitDate} onChange={event => setTreatmentRevisitDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm font-normal sm:w-auto" />
                        </label>
                        <button type="button" disabled={!treatmentRationale.trim()} onClick={() => onRecordTreatment(recordId, { treatment, rationale: treatmentRationale.trim(), revisitAt: dateInputTimestamp(treatmentRevisitDate), revisitCondition: treatmentRevisit.trim() || undefined })} className="mt-3 min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 disabled:opacity-40 sm:w-auto">Record unresolved uncertainty</button>
                    </div>
                </details>
            )}

            {!readOnly && validation.acceptedConclusion && validation.conclusionIsCurrent && (
                <details className="mt-3 rounded-lg border border-neutral-200">
                    <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold text-neutral-700">Reopen this conclusion</summary>
                    <div className="border-t border-neutral-100 p-3">
                        <p className="text-xs leading-5 text-neutral-600">Reopening preserves this outcome in history and returns the assumption to active review. It does not remove evidence.</p>
                        <label className="mt-3 block text-xs font-semibold text-neutral-700">Why reopen this conclusion?
                            <textarea value={reopenReason} onChange={event => setReopenReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm font-normal" />
                        </label>
                        <button type="button" disabled={!reopenReason.trim()} onClick={() => { onReopenOutcome(recordId, reopenReason.trim()); setReopenReason(''); }} className="mt-3 min-h-11 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 disabled:opacity-40 sm:w-auto">Reopen conclusion</button>
                    </div>
                </details>
            )}

            {(validation.acceptedConclusion || validation.userTreatment) && (
                <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex gap-2"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /><div><p className="text-sm font-semibold text-neutral-900">Review the plan consequence</p><p className="mt-1 text-xs leading-5 text-neutral-600">The recorded outcome does not rewrite the PRD. Inspect exact affected targets through the existing guarded alignment review.</p></div></div>
                    {!readOnly && <button type="button" onClick={() => onPreviewImpact(recordId)} className="mt-3 min-h-11 w-full rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white sm:w-auto">{hasPlanImpact ? 'Refresh plan impact' : 'Review plan impact'}</button>}
                </div>
            )}

            {validation.history.length > 0 && (
                <details className="mt-4 border-t border-neutral-100 pt-3">
                    <summary className="min-h-10 cursor-pointer py-2 text-xs font-semibold text-neutral-600">Validation history ({validation.history.length})</summary>
                    <ol className="space-y-2 border-l border-neutral-200 pl-3">{validation.history.map(event => <li key={event.id} className="text-xs text-neutral-600"><span className="font-medium text-neutral-800">{event.label}</span> · {formatDate(event.at)}{event.detail && <span className="mt-0.5 block">{event.detail}</span>}</li>)}</ol>
                </details>
            )}
        </section>
    );
}
