import type {
    PlanningRecord,
    ReadinessActionTarget,
    ReadinessConcernKind,
    ReadinessCriterionEvidence,
    ReadinessReview,
    ReadinessReviewConcern,
    ReadinessReviewCriterion,
    ReadinessReviewCriterionId,
    ReadinessReviewSnapshotHashes,
    ReviewIssue,
    ReviewRun,
    SpecialistRun,
    SpecialistFinding,
    StructuredPRD,
} from '../../types';
import {
    READINESS_CRITERIA_VERSION,
    READINESS_REVIEW_SCHEMA_VERSION,
} from '../../types';
import { hashReviewValue } from '../review/hash';
import { buildReviewContextManifest, verifyEvidenceRef } from '../review/manifest';
import { coveragePathSupports, PRODUCT_READINESS_COVERAGE_AREAS } from '../review/coverage';
import type { ProjectOutputAlignmentSummary } from './outputAlignment';
import { assumptionValidationReadiness, projectAssumptionValidation } from './assumptionValidation';
import type { AssumptionValidationCurrentContext } from './assumptionValidation';
import { projectDecision } from './decisionProjection';
import {
    derivePlanningReadiness,
    planningRecordRequiresResolution,
    planningRecordNeedsAlignment,
    reviewIssueNeedsResolutionBeforeBuild,
} from './planningReadiness';

export type ReadinessReviewInput = {
    projectId: string;
    spine: {
        versionId: string;
        content: string;
        structuredPRD?: StructuredPRD;
        incompleteSectionCount?: number;
        isCommitted?: boolean;
        safetyReview?: {
            status: 'generated' | 'restricted' | 'blocked';
            classification: string;
            detectedConcerns: string[];
            reviewedAt: number;
        };
    };
    planningRecords: PlanningRecord[];
    reviewRuns: ReviewRun[];
    specialistRuns: SpecialistRun[];
    reviewFindings?: SpecialistFinding[];
    reviewIssues: ReviewIssue[];
    outputAlignment: ProjectOutputAlignmentSummary;
    /** Exact preferred output identities at assessment time. Content hashes
     * use the same review hash as challenge manifests. */
    currentArtifactRefs?: Array<{
        artifactId: string;
        artifactVersionId: string;
        contentHash: string;
    }>;
    currentChallengeContextSignature?: string;
    createdAt?: number;
};

export type ReadinessReviewCurrentnessReason =
    | 'integrity_mismatch'
    | 'schema_changed'
    | 'criteria_changed'
    | 'spine_identity_changed'
    | 'spine_content_changed'
    | 'planning_state_changed'
    | 'challenge_changed'
    | 'alignment_changed'
    | 'downstream_changed';

export type ReadinessReviewCurrentness = {
    current: boolean;
    historical: boolean;
    integrityValid: boolean;
    reasons: ReadinessReviewCurrentnessReason[];
};

const byId = <T extends { id: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => a.id.localeCompare(b.id));

const evidenceId = (criterionId: ReadinessReviewCriterionId, sourceId: string, summary: string): string =>
    `readiness-evidence-${hashReviewValue({ criterionId, sourceId, summary })}`;

const concernId = (
    criterionId: ReadinessReviewCriterionId,
    kind: ReadinessConcernKind,
    sourceId: string,
    consequence: string,
): string => `readiness-concern-${hashReviewValue({ criterionId, kind, sourceId, consequence })}`;

const isMaterial = (record: PlanningRecord): boolean =>
    record.materiality === undefined || record.materiality === 'blocking' || record.materiality === 'high';

const isAcceptedUnvalidatedAssumption = (
    record: PlanningRecord,
    evaluatedAt: number,
    context: AssumptionValidationCurrentContext,
): boolean =>
    record.type === 'assumption'
    && projectDecision(record).status === 'confirmed'
    && isMaterial(record)
    && !assumptionValidationReadiness(record, evaluatedAt, context).ready;

const assumptionConcernExplanation = (
    record: PlanningRecord,
    evaluatedAt: number,
    context: AssumptionValidationCurrentContext,
): string => {
    const validation = assumptionValidationReadiness(record, evaluatedAt, context);
    const projection = projectAssumptionValidation(record, evaluatedAt);
    if (projection.workflowState === 'due_for_review') {
        return 'Earlier validation is historical or expired and no longer supports the current assumption.';
    }
    if (validation.reason === 'competing_evidence') {
        return 'Current independent evidence points in competing directions; the recorded conclusion does not resolve that contradiction.';
    }
    if (validation.reason === 'insufficient_support') {
        return 'The recorded conclusion is not supported by current, independent first-hand evidence that answers the validation question.';
    }
    if (validation.reason === 'missing_caveats') {
        return 'A partially supported conclusion needs explicit caveats before it can safely qualify the plan.';
    }
    if (validation.reason === 'stale_planning_context') {
        return 'The validation conclusion belongs to an earlier planning version and must be reviewed against the current plan.';
    }
    if (validation.reason === 'verdict_not_synchronized') {
        return 'The validation outcome is not bound to a current user verdict, so its plan consequences cannot be reviewed safely.';
    }
    if (projection.userTreatment) {
        return 'The user recorded how to proceed under uncertainty, but the assumption remains unvalidated.';
    }
    return 'This material assumption has no current evidence-supported user conclusion.';
};

const isAcceptedMaterialRisk = (record: PlanningRecord): boolean =>
    record.type === 'risk'
    && projectDecision(record).status === 'confirmed'
    && isMaterial(record);

const latest = <T extends { createdAt: number; completedAt?: number }>(items: T[]): T | undefined =>
    [...items].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))[0];

function exactChallengeRuns(input: ReadinessReviewInput, spineContentHash: string): ReviewRun[] {
    return input.reviewRuns.filter(run => (
        run.sourceManifest.spineVersionId === input.spine.versionId
        && run.sourceManifest.spineContentHash === spineContentHash
        && (!input.currentChallengeContextSignature
            || run.sourceManifest.contextSignature === input.currentChallengeContextSignature)
        && run.sourceManifest.artifactRefs.every(reviewed => input.currentArtifactRefs?.some(current => (
            current.artifactId === reviewed.artifactId
            && current.artifactVersionId === reviewed.artifactVersionId
            && current.contentHash === reviewed.contentHash
        )) === true)
    ));
}

function expectedChallengeContextRefs(run: ReviewRun): string[] {
    return [
        `spine:${run.sourceManifest.spineVersionId}`,
        ...run.sourceManifest.artifactRefs.map(ref => `artifact:${ref.artifactVersionId}`),
    ];
}

function isSubstantiveChallenge(
    run: ReviewRun,
    specialistRuns: SpecialistRun[],
    input: ReadinessReviewInput,
): boolean {
    if (run.scope.kind !== 'project' || run.status !== 'complete' || run.synthesisStatus !== 'complete') return false;
    const requiredSpecialistIds = run.requiredSpecialistIds ?? [];
    if (!requiredSpecialistIds.includes('product_scope') || requiredSpecialistIds.length === 0) return false;
    const selectedIds = new Set(run.selectedSpecialists.map(item => item.specialistId));
    if (requiredSpecialistIds.some(id => !selectedIds.has(id))) return false;
    const expectedContextRefs = expectedChallengeContextRefs(run);
    const currentPrdManifest = buildReviewContextManifest({
        projectId: input.projectId,
        projectName: 'Readiness evidence validation',
        spine: {
            versionId: input.spine.versionId,
            content: input.spine.content,
            structuredPRD: input.spine.structuredPRD ?? {} as StructuredPRD,
        },
        artifacts: [],
        safetyBoundaries: [],
    });
    const persistedCoverageEvidenceIsCurrent = (
        specialistId: string,
        area: NonNullable<SpecialistRun['coverageChecks']>[number]['area'],
        evidence: NonNullable<SpecialistRun['coverageChecks']>[number]['evidence'][number],
    ): boolean => {
        const path = evidence.locator?.jsonPath;
        if (!evidence.verified
            || evidence.sourceType !== 'spine'
            || evidence.sourceId !== input.spine.versionId
            || evidence.sourceVersionId !== input.spine.versionId
            || typeof path !== 'string'
            || !coveragePathSupports(specialistId, area, path)) return false;
        return verifyEvidenceRef(currentPrdManifest, {
            sourceKey: `spine:${input.spine.versionId}`,
            locatorId: evidence.id,
            path,
            excerpt: evidence.excerpt ?? '',
            excerptHash: evidence.excerptHash,
        }).verified;
    };
    return run.selectedSpecialists.every(selection => {
        const specialist = latest(specialistRuns.filter(item => (
            item.reviewId === run.id && item.specialistId === selection.specialistId
        )));
        const reviewedContextRefs = new Set(specialist?.contextRefIds ?? []);
        const hasExactSourceCoverage = expectedContextRefs.every(ref => reviewedContextRefs.has(ref));
        const requiredAreas = selection.specialistId === 'product_scope'
            ? PRODUCT_READINESS_COVERAGE_AREAS
            : ['specialist_boundary'];
        const hasAuditableCoverage = requiredAreas.every(area => specialist?.coverageChecks?.some(check => (
            check.area === area
            && check.conclusion.trim().length >= 20
            && check.evidence.length > 0
            && check.evidence.every(evidence => persistedCoverageEvidenceIsCurrent(
                selection.specialistId, check.area, evidence,
            ))
        )));
        return specialist?.status === 'complete'
            && specialist.validation?.valid === true
            && hasExactSourceCoverage
            && hasAuditableCoverage;
    });
}

const validDispositionActionsByStatus: Partial<Record<ReviewIssue['status'], Set<ReviewIssue['dispositions'][number]['action']>>> = {
    acted: new Set(['propose_record', 'link_existing', 'challenge_existing', 'request_revision']),
    dismissed: new Set(['dismiss']),
    already_addressed: new Set(['already_addressed']),
};

function hasValidIssueDisposition(issue: ReviewIssue, run: ReviewRun): boolean {
    const allowedActions = validDispositionActionsByStatus[issue.status];
    if (!allowedActions) return false;
    const disposition = Array.isArray(issue.dispositions) ? issue.dispositions.at(-1) : undefined;
    if (!disposition
        || disposition.actor !== 'user'
        || !allowedActions.has(disposition.action)
        || disposition.contextSignature !== run.sourceManifest.contextSignature) return false;
    if ((issue.status === 'dismissed' || issue.status === 'already_addressed')
        && (disposition.reason?.trim().length ?? 0) < 12) return false;
    return true;
}

export function deriveReadinessChallengeState(input: ReadinessReviewInput) {
    const evaluatedAt = input.createdAt ?? Date.now();
    const validationContext = {
        currentSpineVersionId: input.spine.versionId,
        currentSpineContentHash: hashReviewValue(input.spine.structuredPRD ?? input.spine.content),
    };
    const spineContentHash = hashReviewValue(input.spine.content);
    const exactRuns = exactChallengeRuns(input, spineContentHash);
    const substantiveRuns = exactRuns.filter(run => isSubstantiveChallenge(run, input.specialistRuns, input));
    const substantive = latest(substantiveRuns);
    const shallow = latest(exactRuns);
    const substantiveRunIds = new Set(substantiveRuns.map(run => run.id));
    const substantiveRunsById = new Map(substantiveRuns.map(run => [run.id, run]));
    const applicableIssues = input.reviewIssues.filter(issue => (
        issue.projectId === input.projectId && substantiveRunIds.has(issue.reviewId)
    ));
    const blockingIssues = substantive
        ? applicableIssues.filter(issue => {
            if (issue.implementationImpact === 'deferrable') return false;
            const run = substantiveRunsById.get(issue.reviewId);
            if (!run) return true;
            // Open/deferred issues and bare legacy supersession remain
            // unresolved. Every state that claims an issue was handled must
            // carry an exact-context, runtime-validated user disposition.
            if (!hasValidIssueDisposition(issue, run)) return true;
            if (reviewIssueNeedsResolutionBeforeBuild(issue, input.spine.versionId)) return true;
            if (issue.status !== 'acted') return false;
            // A dangling or still-open linked record is not resolution. Fail
            // closed instead of allowing a relationship id to manufacture it.
            return issue.relatedPlanningRecordIds.some(id => {
                const linked = input.planningRecords.find(record => record.id === id);
                return !linked || planningRecordRequiresResolution(linked, input.planningRecords, new Set(), evaluatedAt, validationContext);
            });
        })
        : [];
    const blockingKeys = new Set(blockingIssues.map(issue => `${issue.reviewId}:${issue.id}`));
    const addressedIssues = applicableIssues.filter(issue => !blockingKeys.has(`${issue.reviewId}:${issue.id}`));
    const representedFindingIds = new Set(applicableIssues.flatMap(issue => issue.findingIds));
    const findingsById = new Map((input.reviewFindings ?? []).map(finding => [finding.id, finding]));
    const untriagedFindings = substantiveRuns.flatMap(run => (
        input.specialistRuns
            .filter(specialist => specialist.reviewId === run.id && specialist.status === 'complete')
            .flatMap(specialist => specialist.findingIds)
            .filter(findingId => !representedFindingIds.has(findingId))
            .flatMap(findingId => {
                const finding = findingsById.get(findingId);
                if (finding?.implementationImpact === 'deferrable') return [];
                return [{
                    id: findingId,
                    reviewId: run.id,
                    title: finding?.title ?? 'Untriaged challenge finding',
                    summary: finding?.whyItMatters ?? 'A specialist finding has not been reviewed into durable project state.',
                }];
            })
    ));
    return { substantive, substantiveRuns, shallow, blockingIssues, addressedIssues, untriagedFindings };
}

function snapshotHashes(input: ReadinessReviewInput, criteriaVersion: number): ReadinessReviewSnapshotHashes {
    const evaluatedAt = input.createdAt ?? Date.now();
    const validationContext = {
        currentSpineVersionId: input.spine.versionId,
        currentSpineContentHash: hashReviewValue(input.spine.structuredPRD ?? input.spine.content),
    };
    const spineIdentity = hashReviewValue({ projectId: input.projectId, spineVersionId: input.spine.versionId });
    const spineContent = hashReviewValue(input.spine.content);
    const applicableChallengeRuns = exactChallengeRuns(input, spineContent);
    const applicableChallengeRunIds = new Set(applicableChallengeRuns.map(run => run.id));
    const planningState = hashReviewValue({
        prd: input.spine.structuredPRD,
        incompleteSectionCount: input.spine.incompleteSectionCount ?? 0,
        safetyReview: input.spine.safetyReview,
        records: byId(input.planningRecords.map(record => record.assumptionValidation ? {
            ...record,
            // updatedAt also moves when an advisory proposal is stored. The
            // authoritative fields and append-only events below carry the
            // meaningful state change, so the wall-clock timestamp is not a
            // readiness dependency by itself.
            updatedAt: record.createdAt,
            assumptionValidation: {
                ...record.assumptionValidation,
                // Advisory proposals have no user authority and must not make
                // an otherwise unchanged readiness checkpoint historical.
                planProposals: [],
                interpretationProposals: [],
            },
        } : record)),
        assumptionValidationProjection: byId(input.planningRecords
            .filter(record => record.type === 'assumption')
            .map(record => {
                const projection = projectAssumptionValidation(record, evaluatedAt);
                const readiness = assumptionValidationReadiness(record, evaluatedAt, validationContext);
                return {
                    id: record.id,
                    workflowState: projection.workflowState,
                    conclusionIsCurrent: projection.conclusionIsCurrent,
                    acceptedConclusion: projection.acceptedConclusion,
                    readiness: readiness.ready,
                    readinessReason: readiness.reason,
                };
            })),
    });
    const challenge = hashReviewValue({
        runs: byId(applicableChallengeRuns),
        specialists: byId(input.specialistRuns.filter(run => applicableChallengeRunIds.has(run.reviewId))),
        findings: byId((input.reviewFindings ?? []).filter(finding => applicableChallengeRunIds.has(finding.reviewId))),
        issues: byId(input.reviewIssues.filter(issue => applicableChallengeRunIds.has(issue.reviewId))),
        currentArtifactRefs: [...(input.currentArtifactRefs ?? [])].sort((a, b) => (
            a.artifactId.localeCompare(b.artifactId)
            || a.artifactVersionId.localeCompare(b.artifactVersionId)
        )),
        currentChallengeContextSignature: input.currentChallengeContextSignature,
    });
    const alignment = hashReviewValue(byId(input.planningRecords.filter(planningRecordNeedsAlignment)));
    const downstream = hashReviewValue({
        ...input.outputAlignment,
        outputs: [...input.outputAlignment.outputs].sort((a, b) => a.artifactId.localeCompare(b.artifactId)),
        artifactRefs: [...(input.currentArtifactRefs ?? [])].sort((a, b) => (
            a.artifactId.localeCompare(b.artifactId)
            || a.artifactVersionId.localeCompare(b.artifactVersionId)
        )),
    });
    const aggregate = hashReviewValue({
        schemaVersion: READINESS_REVIEW_SCHEMA_VERSION,
        criteriaVersion,
        spineIdentity,
        spineContent,
        planningState,
        challenge,
        alignment,
        downstream,
    });
    return { spineIdentity, spineContent, planningState, challenge, alignment, downstream, aggregate };
}

const makeEvidence = (
    criterionId: ReadinessReviewCriterionId,
    quality: ReadinessCriterionEvidence['quality'],
    summary: string,
    sourceType: ReadinessCriterionEvidence['sourceType'],
    sourceId: string,
    sourceVersionId?: string,
    contentHash?: string,
): ReadinessCriterionEvidence => ({
    id: evidenceId(criterionId, sourceId, summary),
    quality,
    summary,
    sourceType,
    sourceId,
    sourceVersionId,
    contentHash,
});

const makeConcern = (input: {
    criterionId: ReadinessReviewCriterionId;
    kind: ReadinessConcernKind;
    title: string;
    consequence: string;
    blocking: boolean;
    evidenceQuality: ReadinessReviewConcern['evidenceQuality'];
    sourceType: ReadinessReviewConcern['source']['type'];
    sourceId: string;
    sourceVersionId?: string;
    actionTarget: ReadinessActionTarget;
}): ReadinessReviewConcern => ({
    id: concernId(input.criterionId, input.kind, input.sourceId, input.consequence),
    criterionId: input.criterionId,
    kind: input.kind,
    title: input.title,
    consequence: input.consequence,
    blocking: input.blocking,
    evidenceQuality: input.evidenceQuality,
    source: { type: input.sourceType, sourceId: input.sourceId, sourceVersionId: input.sourceVersionId },
    actionTarget: input.actionTarget,
});

function reviewPayload(review: Omit<ReadinessReview, 'integrityHash'>): unknown {
    // Persistence and cloud transport are JSON boundaries. Hash the same
    // representation they preserve so optional `undefined` fields cannot make
    // an otherwise untouched checkpoint fail integrity after reload.
    return JSON.parse(JSON.stringify(review)) as unknown;
}

function expectedAggregate(review: ReadinessReview): string {
    const hashes = review.snapshotHashes;
    return hashReviewValue({
        schemaVersion: review.schemaVersion,
        criteriaVersion: review.criteriaVersion,
        spineIdentity: hashes.spineIdentity,
        spineContent: hashes.spineContent,
        planningState: hashes.planningState,
        challenge: hashes.challenge,
        alignment: hashes.alignment,
        downstream: hashes.downstream,
    });
}

export function validateReadinessReviewIntegrity(review: ReadinessReview): boolean {
    const { integrityHash, ...payload } = review;
    return review.snapshotHashes.aggregate === expectedAggregate(review)
        && integrityHash === hashReviewValue(reviewPayload(payload));
}

export function deriveReadinessReview(input: ReadinessReviewInput): ReadinessReview {
    const evaluatedAt = input.createdAt ?? Date.now();
    const validationContext = {
        currentSpineVersionId: input.spine.versionId,
        currentSpineContentHash: hashReviewValue(input.spine.structuredPRD ?? input.spine.content),
    };
    const hashes = snapshotHashes(input, READINESS_CRITERIA_VERSION);
    const challenge = deriveReadinessChallengeState(input);
    const base = derivePlanningReadiness({
        prd: input.spine.structuredPRD,
        planningRecords: input.planningRecords,
        incompleteSectionCount: input.spine.incompleteSectionCount ?? 0,
        hasCurrentChallenge: Boolean(challenge.substantive),
        blockingReviewIssueCount: challenge.blockingIssues.length + challenge.untriagedFindings.length,
        generatedOutputCount: input.outputAlignment.outputs.length,
        staleOutputCount: input.outputAlignment.blockingCount,
        isCommitted: input.spine.isCommitted,
        evaluatedAt,
        ...validationContext,
    });

    const concerns: ReadinessReviewConcern[] = [];
    const criteria: ReadinessReviewCriterion[] = [];
    const baseById = new Map(base.criteria.map(item => [item.id, item]));
    const foundation = [
        ['problem', 'problem'] as const,
        ['user', 'user'] as const,
        ['outcome', 'outcome'] as const,
    ];
    for (const [id, section] of foundation) {
        const source = baseById.get(id)!;
        const blocking = source.status !== 'met';
        const summary = blocking ? source.explanation : `Current PRD evidence supports ${source.label.toLowerCase()}.`;
        const evidence = makeEvidence(id, blocking ? 'incomplete' : 'direct', summary, 'prd', section, input.spine.versionId, hashes.spineContent);
        const actionTarget: ReadinessActionTarget = { kind: 'prd', section };
        criteria.push({ ...source, id, blocking, evidence: [evidence], actionTarget: blocking ? actionTarget : undefined });
        if (blocking) concerns.push(makeConcern({
            criterionId: id, kind: 'foundation', title: source.label, consequence: source.explanation,
            blocking: true, evidenceQuality: 'incomplete', sourceType: 'prd', sourceId: section,
            sourceVersionId: input.spine.versionId, actionTarget,
        }));
    }

    const scopeSource = baseById.get('scope')!;
    const firstUnconfirmed = input.spine.structuredPRD?.features.find(feature => (
        (feature.tier === 'mvp' || feature.tier === undefined) && !feature.confirmed
    ));
    const scopeBlocking = scopeSource.status !== 'met';
    const scopeTarget: ReadinessActionTarget = { kind: 'feature', featureId: firstUnconfirmed?.id };
    criteria.push({
        ...scopeSource, id: 'scope', blocking: scopeBlocking,
        evidence: [makeEvidence('scope', scopeBlocking ? 'incomplete' : 'direct', scopeSource.explanation, 'prd', firstUnconfirmed?.id ?? 'features', input.spine.versionId, hashes.spineContent)],
        actionTarget: scopeBlocking ? scopeTarget : undefined,
    });
    if (scopeBlocking) concerns.push(makeConcern({
        criterionId: 'scope', kind: 'scope', title: scopeSource.label, consequence: scopeSource.explanation,
        blocking: true, evidenceQuality: 'incomplete', sourceType: 'prd', sourceId: firstUnconfirmed?.id ?? 'features',
        sourceVersionId: input.spine.versionId, actionTarget: scopeTarget,
    }));

    const recordGroups: Array<{ id: 'decisions' | 'assumptions' | 'risks'; records: PlanningRecord[] }> = [
        { id: 'decisions', records: input.planningRecords.filter(record => record.type === 'decision' || record.type === 'open_question' || record.type === 'conflict') },
        { id: 'assumptions', records: input.planningRecords.filter(record => record.type === 'assumption') },
        { id: 'risks', records: input.planningRecords.filter(record => record.type === 'risk') },
    ];
    const acceptedUnvalidated = input.planningRecords.filter(record => isAcceptedUnvalidatedAssumption(record, evaluatedAt, validationContext));
    for (const group of recordGroups) {
        const unresolved = group.records.filter(record => planningRecordRequiresResolution(record, input.planningRecords, new Set(), evaluatedAt, validationContext)
            || (group.id === 'assumptions' && isAcceptedUnvalidatedAssumption(record, evaluatedAt, validationContext)));
        const blocking = unresolved.length > 0;
        const label = group.id === 'decisions' ? 'Material choices resolved' : group.id === 'assumptions' ? 'Material assumptions validated' : 'Material risks addressed';
        const explanation = blocking ? `${unresolved.length} material ${group.id} item${unresolved.length === 1 ? '' : 's'} still needs attention.` : `${label}.`;
        const validatedAssumptionEvidence = group.id === 'assumptions'
            ? group.records.flatMap(record => {
                const validation = assumptionValidationReadiness(record, evaluatedAt, validationContext);
                if (!validation.ready) return [];
                return validation.qualifyingEvidence.map(item => makeEvidence(
                    group.id,
                    'direct',
                    `${record.title}: ${item.observation}`,
                    'planning_record',
                    item.id,
                    record.sources?.[0]?.sourceVersionId,
                    item.contentHash,
                ));
            })
            : [];
        const unresolvedAssumptionEvidence = group.id === 'assumptions'
            ? unresolved.flatMap(record => projectAssumptionValidation(record, evaluatedAt).independentEvidence.map(item => makeEvidence(
                group.id,
                'incomplete',
                `${record.title}: ${item.observation}`,
                'planning_record',
                item.id,
                record.sources?.[0]?.sourceVersionId,
                item.contentHash,
            )))
            : [];
        const evidence = unresolved.length > 0
            ? [
                ...unresolved.map(record => makeEvidence(group.id, 'incomplete', record.title, 'planning_record', record.id, record.sources?.[0]?.sourceVersionId)),
                ...unresolvedAssumptionEvidence,
            ]
            : validatedAssumptionEvidence.length > 0
                ? validatedAssumptionEvidence
                : [makeEvidence(group.id, challenge.substantive ? 'direct' : 'inferred', explanation, 'planning_record', `${group.id}:none`)];
        const actionTarget = unresolved[0] ? { kind: 'planning_record' as const, planningRecordId: unresolved[0].id } : undefined;
        criteria.push({ id: group.id, label, status: blocking ? 'attention' : 'met', blocking, explanation, evidence, actionTarget });
        for (const record of unresolved) {
            const kind: ReadinessConcernKind = record.type === 'conflict' ? 'conflict'
                : record.type === 'assumption' ? 'assumption' : record.type === 'risk' ? 'risk' : 'decision';
            concerns.push(makeConcern({
                criterionId: group.id, kind, title: record.title,
                consequence: record.type === 'assumption'
                    ? assumptionConcernExplanation(record, evaluatedAt, validationContext)
                    : isAcceptedMaterialRisk(record)
                        ? 'The user acknowledged this material risk, but the planning record does not prove mitigation or resolution.'
                        : record.statement,
                blocking: true, evidenceQuality: 'incomplete', sourceType: 'planning_record', sourceId: record.id,
                sourceVersionId: record.sources?.[0]?.sourceVersionId,
                actionTarget: { kind: 'planning_record', planningRecordId: record.id },
            }));
        }
    }

    const propagationRecords = input.planningRecords.filter(planningRecordNeedsAlignment);
    const propagationBlocking = propagationRecords.length > 0;
    const propagationExplanation = propagationBlocking
        ? `${propagationRecords.length} resolved choice${propagationRecords.length === 1 ? '' : 's'} still needs plan propagation.`
        : 'Resolved choices are reflected in the current plan.';
    criteria.push({
        id: 'plan_alignment', label: 'Decisions propagated into the plan', status: propagationBlocking ? 'attention' : 'met',
        blocking: propagationBlocking, explanation: propagationExplanation,
        evidence: propagationRecords.length
            ? propagationRecords.map(record => makeEvidence('plan_alignment', 'incomplete', record.title, 'alignment', record.id))
            : [makeEvidence('plan_alignment', 'direct', propagationExplanation, 'alignment', 'current')],
        actionTarget: propagationRecords[0] ? { kind: 'planning_record', planningRecordId: propagationRecords[0].id } : undefined,
    });
    for (const record of propagationRecords) concerns.push(makeConcern({
        criterionId: 'plan_alignment', kind: 'propagation', title: record.title,
        consequence: 'The recorded verdict and current plan are not yet demonstrably aligned.', blocking: true,
        evidenceQuality: 'incomplete', sourceType: 'alignment', sourceId: record.id,
        actionTarget: { kind: 'planning_record', planningRecordId: record.id },
    }));

    const challengeBlocking = !challenge.substantive
        || challenge.blockingIssues.length > 0
        || challenge.untriagedFindings.length > 0;
    const challengeExplanation = !challenge.substantive
        ? 'No current, substantive project challenge has complete validated specialist coverage.'
        : challenge.blockingIssues.length + challenge.untriagedFindings.length > 0
            ? `${challenge.blockingIssues.length + challenge.untriagedFindings.length} consequential challenge finding${challenge.blockingIssues.length + challenge.untriagedFindings.length === 1 ? '' : 's'} remains.`
            : 'The exact current plan has complete, source-grounded project-scope challenge coverage.';
    const challengeTarget = { kind: 'challenge' as const, reviewId: challenge.shallow?.id };
    criteria.push({
        id: 'challenge', label: 'Current plan challenged', status: !challenge.substantive ? 'not_started' : challengeBlocking ? 'attention' : 'met',
        blocking: challengeBlocking, explanation: challengeExplanation,
        evidence: [
            makeEvidence('challenge', challengeBlocking ? 'incomplete' : 'inferred', challengeExplanation, 'challenge', challenge.substantive?.id ?? challenge.shallow?.id ?? 'missing', input.spine.versionId, hashes.challenge),
            ...challenge.addressedIssues.map(issue => {
                const disposition = issue.dispositions.at(-1);
                const reason = disposition?.reason?.trim();
                const summary = `${issue.title}: ${issue.status.replace('_', ' ')}${reason ? ` — ${reason}` : ''}.`;
                return makeEvidence('challenge', 'direct', summary, 'challenge', issue.id, input.spine.versionId);
            }),
        ],
        actionTarget: challengeBlocking ? challengeTarget : undefined,
    });
    if (!challenge.substantive) concerns.push(makeConcern({
        criterionId: 'challenge', kind: 'challenge', title: 'Run a substantive planning challenge', consequence: challengeExplanation,
        blocking: true, evidenceQuality: 'incomplete', sourceType: 'challenge', sourceId: challenge.shallow?.id ?? 'missing',
        sourceVersionId: input.spine.versionId, actionTarget: challengeTarget,
    }));
    for (const issue of challenge.blockingIssues) concerns.push(makeConcern({
        criterionId: 'challenge', kind: issue.kind === 'risk' ? 'risk' : issue.kind === 'contradiction' ? 'conflict' : 'challenge',
        title: issue.title, consequence: issue.summary, blocking: true, evidenceQuality: 'direct', sourceType: 'challenge',
        sourceId: issue.id, sourceVersionId: input.spine.versionId,
        actionTarget: { kind: 'challenge', reviewId: issue.reviewId, issueId: issue.id },
    }));
    for (const finding of challenge.untriagedFindings) concerns.push(makeConcern({
        criterionId: 'challenge', kind: 'challenge', title: finding.title, consequence: finding.summary,
        blocking: true, evidenceQuality: 'incomplete', sourceType: 'challenge', sourceId: finding.id,
        sourceVersionId: input.spine.versionId,
        actionTarget: { kind: 'challenge', reviewId: finding.reviewId, findingId: finding.id },
    }));

    const blockingOutputs = input.outputAlignment.outputs.filter(output => output.blocksBuildReadiness);
    const outputCaveats = input.outputAlignment.outputs.filter(output => output.state === 'possibly_affected' && !output.blocksBuildReadiness);
    const downstreamBlocking = blockingOutputs.length > 0;
    const downstreamExplanation = downstreamBlocking
        ? `${blockingOutputs.length} downstream output${blockingOutputs.length === 1 ? '' : 's'} requires alignment.`
        : outputCaveats.length > 0 ? 'No output blocks implementation, but some remain possibly affected.'
            : input.outputAlignment.outputs.length === 0 ? 'No downstream output exists; this does not reduce planning readiness.'
                : 'Downstream outputs are aligned with the current plan.';
    criteria.push({
        id: 'downstream_alignment', label: 'Downstream outputs aligned', status: downstreamBlocking ? 'attention' : input.outputAlignment.outputs.length === 0 ? 'not_started' : 'met',
        blocking: downstreamBlocking, explanation: downstreamExplanation,
        evidence: input.outputAlignment.outputs.length === 0
            ? [makeEvidence('downstream_alignment', 'direct', downstreamExplanation, 'downstream', 'none')]
            : input.outputAlignment.outputs.map(output => makeEvidence('downstream_alignment', output.blocksBuildReadiness ? 'incomplete' : output.state === 'possibly_affected' ? 'inferred' : 'direct', output.summary, 'downstream', output.artifactId, output.generatedFromSpineId)),
        actionTarget: blockingOutputs[0] ? { kind: 'output', artifactId: blockingOutputs[0].artifactId, nodeId: blockingOutputs[0].nodeId } : undefined,
    });
    for (const output of [...blockingOutputs, ...outputCaveats]) concerns.push(makeConcern({
        criterionId: 'downstream_alignment', kind: 'downstream', title: output.title, consequence: output.summary,
        blocking: output.blocksBuildReadiness, evidenceQuality: output.blocksBuildReadiness ? 'incomplete' : 'inferred',
        sourceType: 'downstream', sourceId: output.artifactId, sourceVersionId: output.generatedFromSpineId,
        actionTarget: { kind: 'output', artifactId: output.artifactId, nodeId: output.nodeId },
    }));

    const caveats = outputCaveats.map(output => `${output.title}: ${output.summary}`);
    const conclusion = base.isReadyToBuild && acceptedUnvalidated.length === 0 && !criteria.some(item => item.blocking)
        ? 'ready_to_build' as const : 'not_ready' as const;
    const createdAt = evaluatedAt;
    const withoutIntegrity: Omit<ReadinessReview, 'integrityHash'> = {
        id: `readiness-review-${hashReviewValue({ aggregate: hashes.aggregate, createdAt })}`,
        projectId: input.projectId,
        schemaVersion: READINESS_REVIEW_SCHEMA_VERSION,
        criteriaVersion: READINESS_CRITERIA_VERSION,
        conclusion,
        spineVersionId: input.spine.versionId,
        snapshotHashes: hashes,
        criteria,
        concerns,
        caveats,
        createdAt,
    };
    return { ...withoutIntegrity, integrityHash: hashReviewValue(reviewPayload(withoutIntegrity)) };
}

export function compareReadinessReviewCurrentness(
    review: ReadinessReview,
    input: ReadinessReviewInput,
    options: { criteriaVersion?: number; schemaVersion?: number } = {},
): ReadinessReviewCurrentness {
    const criteriaVersion = options.criteriaVersion ?? READINESS_CRITERIA_VERSION;
    const schemaVersion = options.schemaVersion ?? READINESS_REVIEW_SCHEMA_VERSION;
    const current = snapshotHashes(input, criteriaVersion);
    const reasons: ReadinessReviewCurrentnessReason[] = [];
    const integrityValid = validateReadinessReviewIntegrity(review);
    if (!integrityValid) reasons.push('integrity_mismatch');
    if (review.schemaVersion !== schemaVersion) reasons.push('schema_changed');
    if (review.criteriaVersion !== criteriaVersion) reasons.push('criteria_changed');
    if (review.snapshotHashes.spineIdentity !== current.spineIdentity) reasons.push('spine_identity_changed');
    if (review.snapshotHashes.spineContent !== current.spineContent) reasons.push('spine_content_changed');
    if (review.snapshotHashes.planningState !== current.planningState) reasons.push('planning_state_changed');
    if (review.snapshotHashes.challenge !== current.challenge) reasons.push('challenge_changed');
    if (review.snapshotHashes.alignment !== current.alignment) reasons.push('alignment_changed');
    if (review.snapshotHashes.downstream !== current.downstream) reasons.push('downstream_changed');
    return { current: reasons.length === 0, historical: reasons.length > 0 && integrityValid, integrityValid, reasons };
}
