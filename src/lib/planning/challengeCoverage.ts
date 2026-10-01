import type {
    PlanningRecord,
    ReviewIssue,
    ReviewRun,
    SpecialistFinding,
    SpecialistRun,
    StructuredPRD,
} from '../../types';
import { hashReviewValue } from '../review/hash';
import { buildReviewContextManifest, verifyEvidenceRef } from '../review/manifest';
import { coveragePathSupports, PRODUCT_READINESS_COVERAGE_AREAS } from '../review/coverage';
import { planningContentHash } from './planningHash';
import {
    planningRecordRequiresResolution,
    reviewIssueNeedsResolutionBeforeBuild,
} from './planningReadiness';

/**
 * Challenge coverage of the CURRENT plan — a pure, derived read-side
 * projection (cross-cutting rule 10). It answers "has the exact current plan
 * been substantively challenged, and which consequential findings are still
 * unresolved?" and feeds two advisory consumers:
 *
 *  - `derivePlanningReadiness` (its `challenge` criterion), and
 *  - the generation/export `WorkflowCheckpointSummary` critique rows.
 *
 * Nothing here gates rendering or generation, and nothing is persisted. (It
 * used to live inside the durable readiness-review checkpoint, which was
 * removed together with the Finalize/commitment layer; the coverage rules
 * themselves are unchanged.)
 */
export type ChallengeCoverageInput = {
    projectId: string;
    spine: {
        versionId: string;
        content: string;
        structuredPRD?: StructuredPRD;
    };
    planningRecords: PlanningRecord[];
    reviewRuns: ReviewRun[];
    specialistRuns: SpecialistRun[];
    reviewFindings?: SpecialistFinding[];
    reviewIssues: ReviewIssue[];
    /** Exact preferred output identities right now. A challenge run whose
     * reviewed artifact refs no longer match is not coverage of this plan. */
    currentArtifactRefs?: Array<{
        artifactId: string;
        artifactVersionId: string;
        contentHash: string;
    }>;
    currentChallengeContextSignature?: string;
    evaluatedAt?: number;
};

export type ChallengeCoverageUntriagedFinding = {
    id: string;
    reviewId: string;
    title: string;
    summary: string;
};

export type ChallengeCoverage = {
    /** The latest substantive (complete, validated, source-grounded) run on the exact current plan. */
    substantive?: ReviewRun;
    substantiveRuns: ReviewRun[];
    /** The latest run on the exact current plan, substantive or not. */
    shallow?: ReviewRun;
    /** Consequential issues of a substantive run that still need resolution. */
    blockingIssues: ReviewIssue[];
    /** Issues of a substantive run the user has handled (dismissed, addressed, acted on). */
    addressedIssues: ReviewIssue[];
    /** Consequential specialist findings that never entered durable issue triage. */
    untriagedFindings: ChallengeCoverageUntriagedFinding[];
};

/** Dismissing or marking a finding already addressed needs a substantive
 * rationale; entry surfaces must enforce the same floor so a closure accepted
 * in the UI is never silently ignored by the coverage projection. */
export const MIN_CLOSURE_REASON_LENGTH = 12;

const latest = <T extends { createdAt: number; completedAt?: number }>(items: T[]): T | undefined =>
    [...items].sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))[0];

function exactChallengeRuns(input: ChallengeCoverageInput, spineContentHash: string): ReviewRun[] {
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
    input: ChallengeCoverageInput,
): boolean {
    if (run.scope.kind !== 'project' || run.status !== 'complete' || run.synthesisStatus !== 'complete') return false;
    const requiredSpecialistIds = run.requiredSpecialistIds ?? [];
    if (!requiredSpecialistIds.includes('product_scope') || requiredSpecialistIds.length === 0) return false;
    const selectedIds = new Set(run.selectedSpecialists.map(item => item.specialistId));
    if (requiredSpecialistIds.some(id => !selectedIds.has(id))) return false;
    const expectedContextRefs = expectedChallengeContextRefs(run);
    const currentPrdManifest = buildReviewContextManifest({
        projectId: input.projectId,
        projectName: 'Challenge coverage validation',
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
        && (disposition.reason?.trim().length ?? 0) < MIN_CLOSURE_REASON_LENGTH) return false;
    return true;
}

export function deriveChallengeCoverage(input: ChallengeCoverageInput): ChallengeCoverage {
    const evaluatedAt = input.evaluatedAt ?? Date.now();
    const validationContext = {
        currentSpineVersionId: input.spine.versionId,
        currentSpineContentHash: planningContentHash(input.spine.structuredPRD ?? input.spine.content),
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
