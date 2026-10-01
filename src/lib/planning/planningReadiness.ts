import type { PlanningRecord, ReviewIssue, StructuredPRD } from '../../types';
import { alignmentProposalNeedsResolution, alignmentProposalReviews } from './decisionImpact';
import { projectDecision } from './decisionProjection';
import { assumptionValidationReadiness } from './assumptionValidation';
import type { AssumptionValidationCurrentContext } from './assumptionValidation';
import type { DownstreamUpdatePlanSummary } from './downstreamUpdatePlan';

export type PlanningReadinessPhase =
    | 'exploring'
    | 'needs_decisions'
    | 'ready_to_challenge'
    | 'needs_alignment'
    | 'ready_to_build';

export type PlanningReadinessCriterion = {
    id: 'problem' | 'user' | 'outcome' | 'scope' | 'decisions' | 'challenge' | 'alignment';
    label: string;
    status: 'met' | 'attention' | 'not_started';
    explanation: string;
};

export type PlanningReadiness = {
    phase: PlanningReadinessPhase;
    headline: string;
    summary: string;
    criteria: PlanningReadinessCriterion[];
    unresolvedCount: number;
    /**
     * Count of surfaced decisions still awaiting the user's engagement — records
     * of type decision/open_question/conflict/assumption whose projected status
     * is still `open` or `proposed`. Answering OR deferring/skipping a record
     * moves it out of this set. This is the gate for the optional specialist
     * critique (Challenge → Findings): the critique cannot start until every
     * surfaced decision has been addressed. Distinct from `unresolvedCount`,
     * which also unions in `needsResolution` (still counts deferred material
     * items) and therefore never clears on defer.
     */
    openDecisionCount: number;
    assumptionCount: number;
    /**
     * Records awaiting the user's answer in the Decision Center — projected
     * status `open`/`proposed`, every record type. `decisions` counts every
     * non-assumption record (decisions, questions, conflicts, risks: the
     * Decision Center's "Needs your decision" set) and `assumptions` the
     * assumptions still to confirm, so `decisions + assumptions` always equals
     * the Decision Center's "Needs attention" count. Feeds the Plan-stage
     * one-line bar and the journey rail's Decide badge.
     */
    openItems: { decisions: number; assumptions: number };
    conflictCount: number;
    changedSourceCount: number;
    /** Advisory projection only: "is the product reasoning sound?". Nothing
     * gates generation, export, or prompt copying on it. */
    isReadyToBuild: boolean;
};

export type PlanningReadinessInput = {
    prd?: StructuredPRD;
    planningRecords: PlanningRecord[];
    incompleteSectionCount: number;
    hasCurrentChallenge: boolean;
    blockingReviewIssueCount: number;
    generatedOutputCount: number;
    staleOutputCount: number;
    evaluatedAt?: number;
    currentSpineVersionId?: string;
    currentSpineContentHash?: string;
    downstreamUpdatePlanSummary?: DownstreamUpdatePlanSummary;
};

const meaningful = (value?: string): boolean => !!value && value.trim().length >= 12;

const material = (record: PlanningRecord): boolean =>
    record.materiality === undefined || record.materiality === 'blocking' || record.materiality === 'high';

/** Shared conservative resolution boundary for the advisory readiness
 * projection and challenge coverage. User acknowledgement is not validation,
 * invalidated choices require a replacement, and incomplete legacy authority
 * fails closed. */
export function planningRecordRequiresResolution(
    record: PlanningRecord,
    allRecords: PlanningRecord[] = [record],
    visited = new Set<string>(),
    evaluatedAt = Date.now(),
    validationContext?: AssumptionValidationCurrentContext,
): boolean {
    if (visited.has(record.id)) return true;
    const nextVisited = new Set(visited).add(record.id);
    const state = projectDecision(record);
    if (state.status === 'superseded') {
        const replacement = allRecords.find(item => item.id === state.supersededById);
        return !replacement || planningRecordRequiresResolution(replacement, allRecords, nextVisited, evaluatedAt, validationContext);
    }
    if (state.status === 'invalidated') return material(record);
    const settledWithoutVerdictProvenance = ['confirmed', 'rejected', 'resolved'].includes(state.status)
        && !state.latestVerdictEventId;
    if (settledWithoutVerdictProvenance && material(record)) return true;
    // Provenance drift is only a build blocker when the record itself is
    // consequential. Low-impact uncertainty stays visible without becoming a
    // procedural gate merely because its source moved or is unavailable.
    if (record.sourceState === 'changed' || record.sourceState === 'missing') return material(record);
    if (record.type === 'assumption' && material(record)) {
        // Assumptions have a stronger resolution boundary than ordinary
        // choices. A current user verdict alone is not validation; only a
        // current evidence-backed conclusion synchronized to that verdict can
        // clear the assumption criterion.
        return !assumptionValidationReadiness(record, evaluatedAt, validationContext).ready;
    }
    if (state.status === 'open' || state.status === 'proposed') {
        if (record.type === 'decision' || record.type === 'open_question' || record.type === 'conflict') return true;
        if (record.type === 'risk') return record.materiality !== 'low';
        if (record.type === 'assumption') return material(record);
    }
    if (state.status === 'deferred') {
        if (record.type === 'conflict') return true;
        if (['decision', 'open_question', 'risk', 'assumption'].includes(record.type)) return material(record);
    }
    // Evidence references currently prove only that an excerpt is grounded in
    // durable project content. They do not validate the real-world premise.
    // Until an explicit validation provenance exists, accepting a material
    // assumption must remain accepted-but-unvalidated.
    if (record.type === 'risk' && state.status === 'confirmed' && material(record)) return true;
    return false;
}

/** A verdict and its plan propagation are separate user actions. Readiness
 * remains blocked while a current proposal is pending/deferred, while an
 * accepted edit has not been applied, or while the user kept an exact source
 * claim that directly contradicts the verdict. */
export function planningRecordNeedsAlignment(record: PlanningRecord): boolean {
    const projection = projectDecision(record);
    if (!['confirmed', 'rejected'].includes(projection.status) || !projection.latestVerdictEventId) return false;
    const assessment = [...(record.assessments ?? [])].reverse().find(item => (
        item.impactPreview?.decisionEventId === projection.latestVerdictEventId
    ));
    const preview = assessment?.impactPreview;
    if (!preview) {
        // A recorded verdict is not proof that its affected plan context was
        // reconciled. Treat material legacy records conservatively until they
        // receive an impact review; low/normal items do not block exploration.
        const material = record.materiality === undefined || record.materiality === 'blocking' || record.materiality === 'high';
        const hasAffectedContext = (record.affectedPlanLocations?.length ?? 0) > 0
            || (record.affectedPrdSections?.length ?? 0) > 0
            || (record.affectedArtifactSlots?.length ?? 0) > 0;
        return material && hasAffectedContext;
    }
    if (assessment?.status === 'stale' || assessment?.status === 'failed'
        || ['generating', 'stale', 'failed', 'superseded'].includes(preview.status)) return true;
    if (!preview.alignmentProposals?.length) return false;

    const applied = (record.events ?? []).some(event => (
        event.type === 'applied_to_plan' && event.impactPreviewId === preview.id
    ));
    return alignmentProposalReviews(record, preview).some(review => alignmentProposalNeedsResolution(review, applied));
}

/** Consequential findings remain blocking until explicitly resolved or linked
 * to durable decision context. Deferral and an unverified revision request do
 * not make the underlying implementation risk disappear. */
export function reviewIssueNeedsResolutionBeforeBuild(issue: ReviewIssue, currentSpineVersionId?: string): boolean {
    if (issue.implementationImpact === 'deferrable') return false;
    if (issue.status === 'open' || issue.status === 'deferred') return true;
    if (issue.status !== 'acted') return false;
    const latestDisposition = issue.dispositions.at(-1);
    if (latestDisposition?.action === 'request_revision') {
        return !latestDisposition.resultingSpineVersionId
            || latestDisposition.resultingSpineVersionId !== currentSpineVersionId;
    }
    return issue.relatedPlanningRecordIds.length === 0;
}

export function derivePlanningReadiness(input: PlanningReadinessInput): PlanningReadiness {
    const validationContext = {
        currentSpineVersionId: input.currentSpineVersionId,
        currentSpineContentHash: input.currentSpineContentHash,
    };
    const prd = input.prd;
    const projected = input.planningRecords.map(record => ({ record, state: projectDecision(record) }));
    const unresolved = projected.filter(({ state }) => state.status === 'open' || state.status === 'proposed');
    // Surfaced decisions the plan asks the user to engage with. Risks are
    // advisory (not "decisions to answer") and are intentionally excluded, so
    // they never gate the optional critique. Deferring/answering any of these
    // drops it from `unresolved`, clearing the gate.
    const openDecisions = unresolved.filter(({ record }) => (
        record.type === 'decision'
        || record.type === 'open_question'
        || record.type === 'conflict'
        || record.type === 'assumption'
    ));
    const needsResolution = projected.filter(({ record }) => (
        planningRecordRequiresResolution(record, input.planningRecords, new Set(), input.evaluatedAt, validationContext)
    ));
    const conflicts = needsResolution.filter(({ record }) => record.type === 'conflict');
    const keyDecisions = needsResolution.filter(({ record }) => record.type === 'decision' || record.type === 'open_question' || record.type === 'conflict');
    const assumptions = unresolved.filter(({ record }) => record.type === 'assumption');
    const materialAssumptions = needsResolution.filter(({ record }) => record.type === 'assumption');
    const materialRisks = needsResolution.filter(({ record }) => record.type === 'risk');
    const changedSources = input.planningRecords.filter(record => (
        (record.sourceState === 'changed' || record.sourceState === 'missing') && material(record)
    ));
    const alignmentRecords = input.planningRecords.filter(planningRecordNeedsAlignment);

    const problemClear = meaningful(prd?.coreProblem);
    const userClear = (prd?.targetUsers?.filter(item => meaningful(item)).length ?? 0) > 0 || (prd?.jtbd?.length ?? 0) > 0;
    const outcomeClear = (prd?.successMetrics?.length ?? 0) > 0 || meaningful(prd?.productThesis?.whyExist);
    const features = prd?.features ?? [];
    const scopeExists = features.length > 0;
    const mvpFeatures = features.filter(feature => feature.tier === 'mvp' || feature.tier === undefined);
    const scopeCandidates = mvpFeatures.length > 0 ? mvpFeatures : features;
    const scopeConfirmed = scopeCandidates.length > 0 && scopeCandidates.every(feature => feature.confirmed);
    const foundationClear = problemClear && userClear && outcomeClear && input.incompleteSectionCount === 0;
    const decisionsResolved = needsResolution.length === 0 && changedSources.length === 0;
    const planAlignmentClear = alignmentRecords.length === 0;
    const challengeClear = input.hasCurrentChallenge && input.blockingReviewIssueCount === 0;
    const updatePlanBlockers = input.downstreamUpdatePlanSummary?.blockingItems ?? [];
    const outputAlignmentClear = (input.generatedOutputCount === 0 || input.staleOutputCount === 0)
        && updatePlanBlockers.length === 0;
    const alignmentClear = planAlignmentClear && outputAlignmentClear;
    const isReadyToBuild = foundationClear && scopeExists && scopeConfirmed && decisionsResolved && alignmentClear && challengeClear;

    const criteria: PlanningReadinessCriterion[] = [
        { id: 'problem', label: 'Problem understood', status: problemClear ? 'met' : 'attention', explanation: problemClear ? 'The plan states a concrete problem.' : 'Clarify the problem before treating proposed features as necessary.' },
        { id: 'user', label: 'Primary user understood', status: userClear ? 'met' : 'attention', explanation: userClear ? 'A primary user or job is defined.' : 'Identify who experiences the problem and in what context.' },
        { id: 'outcome', label: 'Desired outcome defined', status: outcomeClear ? 'met' : 'attention', explanation: outcomeClear ? 'The plan includes an outcome or success measure.' : 'State what should improve if this product succeeds.' },
        { id: 'scope', label: 'Feature scope confirmed', status: !scopeExists ? 'not_started' : scopeConfirmed ? 'met' : 'attention', explanation: !scopeExists ? 'No feature scope exists yet.' : scopeConfirmed ? 'Every proposed first-release feature has explicit user confirmation.' : 'The generated first-release feature set is still a proposal — open Features and confirm what truly belongs.' },
        { id: 'decisions', label: 'Material choices resolved', status: decisionsResolved ? 'met' : 'attention', explanation: decisionsResolved ? `${assumptions.length} visible assumption${assumptions.length === 1 ? '' : 's'} may remain without blocking progress.` : `${keyDecisions.length} key choice${keyDecisions.length === 1 ? '' : 's'}, ${materialAssumptions.length} material assumption${materialAssumptions.length === 1 ? '' : 's'}, ${materialRisks.length} material risk${materialRisks.length === 1 ? '' : 's'}, and ${changedSources.length} changed source${changedSources.length === 1 ? '' : 's'} need attention.` },
        { id: 'challenge', label: 'Current plan challenged', status: !input.hasCurrentChallenge ? 'not_started' : challengeClear ? 'met' : 'attention', explanation: !input.hasCurrentChallenge ? 'Once open choices are settled and the plan reads coherently, run a challenge to stress-test it.' : challengeClear ? 'The current plan has a completed challenge with no required finding.' : `${input.blockingReviewIssueCount} review finding${input.blockingReviewIssueCount === 1 ? '' : 's'} marked for resolution before build remain.` },
        { id: 'alignment', label: 'Plan and outputs aligned', status: alignmentClear ? (input.generatedOutputCount === 0 ? 'not_started' : 'met') : 'attention', explanation: !planAlignmentClear ? `${alignmentRecords.length} resolved decision${alignmentRecords.length === 1 ? '' : 's'} still ${alignmentRecords.length === 1 ? 'needs' : 'need'} plan alignment review.` : input.generatedOutputCount === 0 ? 'No downstream outputs exist yet; this does not reduce planning readiness.' : outputAlignmentClear ? 'No consequential downstream mismatch remains unresolved.' : updatePlanBlockers.length > 0 ? `${updatePlanBlockers.length} definite downstream update${updatePlanBlockers.length === 1 ? '' : 's'} still ${updatePlanBlockers.length === 1 ? 'needs' : 'need'} planning before build.` : `${input.staleOutputCount} output${input.staleOutputCount === 1 ? '' : 's'} require${input.staleOutputCount === 1 ? 's' : ''} alignment review before build.` },
    ];

    const phase: PlanningReadinessPhase = isReadyToBuild
        ? 'ready_to_build'
        : !foundationClear ? 'exploring'
            : !decisionsResolved || !scopeConfirmed ? 'needs_decisions'
                : !planAlignmentClear ? 'needs_alignment'
                    : !challengeClear ? 'ready_to_challenge'
                    : !outputAlignmentClear ? 'needs_alignment'
                        : 'ready_to_build';
    const copy: Record<PlanningReadinessPhase, [string, string]> = {
        exploring: ['Working plan · exploring', 'The product foundation is still taking shape. Generated detail should be treated as provisional.'],
        needs_decisions: ['Working plan · needs key decisions', 'The direction is taking shape, but unresolved choices could still materially change it.'],
        ready_to_challenge: ['Working plan · ready to challenge', 'The core direction is coherent enough for Synapse to test its weaknesses.'],
        needs_alignment: ['Working plan · needs alignment', 'A resolved choice or later plan change still has consequences to review before this foundation is coherent.'],
        ready_to_build: ['Plan is ready to build', 'The core product reasoning is explicit, challenged, and aligned.'],
    };
    return {
        phase, headline: copy[phase][0], summary: copy[phase][1], criteria,
        unresolvedCount: new Set([...unresolved, ...needsResolution].map(item => item.record.id).concat(alignmentRecords.map(record => record.id))).size + updatePlanBlockers.length,
        openDecisionCount: openDecisions.length, assumptionCount: assumptions.length,
        openItems: {
            decisions: unresolved.filter(({ record }) => record.type !== 'assumption').length,
            assumptions: assumptions.length,
        },
        conflictCount: conflicts.length, changedSourceCount: changedSources.length, isReadyToBuild,
    };
}
