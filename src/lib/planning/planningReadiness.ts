import type { PlanningRecord, ReviewIssue, StructuredPRD } from '../../types';
import { projectDecision } from './decisionProjection';

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
    assumptionCount: number;
    conflictCount: number;
    changedSourceCount: number;
    isReadyToBuild: boolean;
    nextAction: {
        kind: 'clarify_foundation' | 'resolve_decision' | 'review_source_change' | 'confirm_scope' | 'challenge_plan' | 'align_outputs' | 'commit_plan';
        label: string;
        detail: string;
        planningRecordId?: string;
    };
};

export type PlanningReadinessInput = {
    prd?: StructuredPRD;
    planningRecords: PlanningRecord[];
    incompleteSectionCount: number;
    hasCurrentChallenge: boolean;
    blockingReviewIssueCount: number;
    generatedOutputCount: number;
    staleOutputCount: number;
    isCommitted?: boolean;
};

const meaningful = (value?: string): boolean => !!value && value.trim().length >= 12;

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
    const prd = input.prd;
    const projected = input.planningRecords.map(record => ({ record, state: projectDecision(record) }));
    const unresolved = projected.filter(({ state }) => state.status === 'open' || state.status === 'proposed');
    const needsResolution = projected.filter(({ record, state }) => {
        const materialOrUnclassified = record.materiality === undefined
            || record.materiality === 'blocking'
            || record.materiality === 'high';
        if (state.status === 'open' || state.status === 'proposed') {
            if (record.type === 'decision' || record.type === 'open_question' || record.type === 'conflict') return true;
            if (record.type === 'risk') return record.materiality !== 'low';
            if (record.type === 'assumption') return materialOrUnclassified;
        }
        // Deferral is a planning choice, not proof that a consequential issue
        // is safe to carry into implementation. Explicitly normal/low items may
        // remain deferred; conflicts and unclassified legacy records may not.
        if (state.status === 'deferred') {
            if (record.type === 'conflict') return true;
            if (['decision', 'open_question', 'risk', 'assumption'].includes(record.type)) return materialOrUnclassified;
        }
        return false;
    });
    const conflicts = needsResolution.filter(({ record }) => record.type === 'conflict');
    const keyDecisions = needsResolution.filter(({ record }) => record.type === 'decision' || record.type === 'open_question' || record.type === 'conflict');
    const assumptions = unresolved.filter(({ record }) => record.type === 'assumption');
    const materialAssumptions = needsResolution.filter(({ record }) => record.type === 'assumption');
    const materialRisks = needsResolution.filter(({ record }) => record.type === 'risk');
    const changedSources = input.planningRecords.filter(record => record.sourceState === 'changed' || record.sourceState === 'missing');
    const nextRecord = conflicts[0]?.record ?? keyDecisions[0]?.record ?? materialRisks[0]?.record ?? materialAssumptions[0]?.record;

    const problemClear = meaningful(prd?.coreProblem);
    const userClear = (prd?.targetUsers?.filter(item => meaningful(item)).length ?? 0) > 0 || (prd?.jtbd?.length ?? 0) > 0;
    const outcomeClear = (prd?.successMetrics?.length ?? 0) > 0 || meaningful(prd?.productThesis?.whyExist);
    const features = prd?.features ?? [];
    const scopeExists = features.length > 0;
    const mvpFeatures = features.filter(feature => feature.tier === 'mvp' || feature.tier === undefined);
    const scopeCandidates = mvpFeatures.length > 0 ? mvpFeatures : features;
    const scopeConfirmed = scopeCandidates.length > 0 && scopeCandidates.every(feature => feature.confirmed);
    const foundationClear = problemClear && userClear && outcomeClear && input.incompleteSectionCount === 0;
    const decisionsClear = needsResolution.length === 0 && changedSources.length === 0;
    const challengeClear = input.hasCurrentChallenge && input.blockingReviewIssueCount === 0;
    const alignmentClear = input.generatedOutputCount === 0 || input.staleOutputCount === 0;
    const isReadyToBuild = foundationClear && scopeExists && scopeConfirmed && decisionsClear && challengeClear && alignmentClear;

    const criteria: PlanningReadinessCriterion[] = [
        { id: 'problem', label: 'Problem understood', status: problemClear ? 'met' : 'attention', explanation: problemClear ? 'The plan states a concrete problem.' : 'Clarify the problem before treating proposed features as necessary.' },
        { id: 'user', label: 'Primary user understood', status: userClear ? 'met' : 'attention', explanation: userClear ? 'A primary user or job is defined.' : 'Identify who experiences the problem and in what context.' },
        { id: 'outcome', label: 'Desired outcome defined', status: outcomeClear ? 'met' : 'attention', explanation: outcomeClear ? 'The plan includes an outcome or success measure.' : 'State what should improve if this product succeeds.' },
        { id: 'scope', label: 'Scope is intentional', status: !scopeExists ? 'not_started' : scopeConfirmed ? 'met' : 'attention', explanation: !scopeExists ? 'No feature scope exists yet.' : scopeConfirmed ? 'Every proposed first-release feature has explicit user confirmation.' : 'The generated first-release feature set is still a proposal; confirm what truly belongs.' },
        { id: 'decisions', label: 'Material choices resolved', status: decisionsClear ? 'met' : 'attention', explanation: decisionsClear ? `${assumptions.length} visible assumption${assumptions.length === 1 ? '' : 's'} may remain without blocking progress.` : `${keyDecisions.length} key choice${keyDecisions.length === 1 ? '' : 's'}, ${materialAssumptions.length} material assumption${materialAssumptions.length === 1 ? '' : 's'}, ${materialRisks.length} material risk${materialRisks.length === 1 ? '' : 's'}, and ${changedSources.length} changed source${changedSources.length === 1 ? '' : 's'} need attention.` },
        { id: 'challenge', label: 'Current plan challenged', status: !input.hasCurrentChallenge ? 'not_started' : challengeClear ? 'met' : 'attention', explanation: !input.hasCurrentChallenge ? 'Run a planning challenge when the working plan is coherent enough to test.' : challengeClear ? 'The current plan has a completed challenge with no required finding.' : `${input.blockingReviewIssueCount} review finding${input.blockingReviewIssueCount === 1 ? '' : 's'} marked for resolution before build remain.` },
        { id: 'alignment', label: 'Outputs aligned', status: input.generatedOutputCount === 0 ? 'not_started' : alignmentClear ? 'met' : 'attention', explanation: input.generatedOutputCount === 0 ? 'No downstream outputs exist yet; this does not reduce planning readiness.' : alignmentClear ? 'Generated outputs reference the current plan.' : `${input.staleOutputCount} output${input.staleOutputCount === 1 ? '' : 's'} may reflect an earlier plan.` },
    ];

    let nextAction: PlanningReadiness['nextAction'];
    if (!foundationClear) nextAction = { kind: 'clarify_foundation', label: 'Strengthen the foundation', detail: 'Clarify the problem, primary user, and desired outcome in the PRD.' };
    else if (changedSources.length > 0) nextAction = { kind: 'review_source_change', label: 'Revisit a changed decision', detail: changedSources[0].title, planningRecordId: changedSources[0].id };
    else if (nextRecord) nextAction = { kind: 'resolve_decision', label: conflicts.length > 0 ? 'Resolve the leading conflict' : 'Resolve the next key decision', detail: nextRecord.title, planningRecordId: nextRecord.id };
    else if (!scopeConfirmed) nextAction = { kind: 'confirm_scope', label: 'Confirm intentional scope', detail: 'Decide which proposed feature is genuinely necessary for the first release.' };
    else if (!input.hasCurrentChallenge || input.blockingReviewIssueCount > 0) nextAction = { kind: 'challenge_plan', label: input.hasCurrentChallenge ? 'Address challenge findings' : 'Challenge the working plan', detail: 'Look for weak assumptions, contradictions, unnecessary scope, and feasibility risks.' };
    else if (!alignmentClear) nextAction = { kind: 'align_outputs', label: 'Review affected outputs', detail: 'The plan changed after downstream work was generated.' };
    else nextAction = input.isCommitted
        ? { kind: 'align_outputs', label: input.generatedOutputCount > 0 ? 'Review the build foundation' : 'Generate the build foundation', detail: 'Use the committed reasoning foundation to create or review implementation outputs.' }
        : { kind: 'commit_plan', label: 'Commit the plan', detail: 'The current reasoning foundation is ready to become the basis for implementation.' };

    const phase: PlanningReadinessPhase = isReadyToBuild
        ? 'ready_to_build'
        : !foundationClear ? 'exploring'
            : !decisionsClear || !scopeConfirmed ? 'needs_decisions'
                : !challengeClear ? 'ready_to_challenge'
                    : !alignmentClear ? 'needs_alignment'
                        : 'ready_to_build';
    const copy: Record<PlanningReadinessPhase, [string, string]> = {
        exploring: ['Working plan · exploring', 'The product foundation is still taking shape. Generated detail should be treated as provisional.'],
        needs_decisions: ['Working plan · needs key decisions', 'The direction is taking shape, but unresolved choices could still materially change it.'],
        ready_to_challenge: ['Working plan · ready to challenge', 'The core direction is coherent enough for Synapse to test its weaknesses.'],
        needs_alignment: ['Committed context changed', 'The plan is stronger, but existing outputs may still reflect earlier reasoning.'],
        ready_to_build: ['Plan is ready to build', 'The core product reasoning is explicit, challenged, and aligned.'],
    };
    return {
        phase, headline: copy[phase][0], summary: copy[phase][1], criteria, nextAction,
        unresolvedCount: new Set([...unresolved, ...needsResolution].map(item => item.record.id)).size, assumptionCount: assumptions.length,
        conflictCount: conflicts.length, changedSourceCount: changedSources.length, isReadyToBuild,
    };
}
