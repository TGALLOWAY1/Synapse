import type {
    ReviewIssue,
    ReviewRun,
    SpecialistFinding,
    SpecialistRun,
    SpineVersion,
} from '../../types';
import { SPECIALIST_REGISTRY, type ReviewSpecialistId } from '../../lib/review';
import type { ReviewIssueView, ReviewRunView } from './ReviewWorkspace';
import { issueTreatmentLabel } from './reviewIssueDispositions';

const specialistStatus = (status: string): 'queued' | 'running' | 'complete' | 'failed' | 'cancelled' => {
    if (status === 'running') return 'running';
    if (status === 'complete') return 'complete';
    if (status === 'cancelled') return 'cancelled';
    if (['failed', 'timed_out', 'invalid', 'interrupted'].includes(status)) return 'failed';
    return 'queued';
};

const runStatus = (status: string): ReviewRunView['status'] => {
    if (status === 'queued') return 'running';
    return status as ReviewRunView['status'];
};

export const buildReviewIssueViews = (
    reviewId: string,
    issues: ReviewIssue[],
    findings: SpecialistFinding[],
): ReviewIssueView[] => issues.filter(issue => issue.reviewId === reviewId).map(issue => {
    const sourceFindings = findings.filter(finding => finding.reviewId === reviewId && issue.findingIds.includes(finding.id));
    const latestDisposition = issue.dispositions.at(-1);
    const lead = sourceFindings[0];
    return {
        id: issue.id,
        title: issue.title,
        observation: issue.summary,
        consequence: lead?.consequence ?? lead?.whyItMatters ?? 'This may create avoidable implementation ambiguity.',
        recommendedAction: lead?.recommendedAction ?? 'Clarify the plan before implementation.',
        kind: issue.relationship === 'disagreement' ? 'decision_needed' : issue.kind === 'assumption' || issue.kind === 'user_judgment' ? 'missing_information' : issue.kind,
        severity: issue.implementationImpact === 'blocker' ? 'blocking' : issue.severity === 'high' || issue.severity === 'critical' ? 'important' : 'advisory',
        confidence: issue.confidence,
        status: issue.status === 'acted'
            ? 'linked'
            : issue.status === 'already_addressed'
                ? 'addressed'
                : issue.status === 'superseded'
                    ? 'dismissed'
                    : issue.status,
        specialistNames: issue.specialistIds.map(id => SPECIALIST_REGISTRY[id as ReviewSpecialistId]?.label ?? id),
        affectedSources: [...new Set(sourceFindings.flatMap(finding => finding.evidence.map(evidence => evidence.locator?.section ?? evidence.artifactSubtype ?? 'PRD')))],
        evidence: sourceFindings.flatMap(finding => finding.evidence.filter(evidence => evidence.verified).map(evidence => ({
            id: evidence.id,
            sourceLabel: evidence.artifactSubtype?.replaceAll('_', ' ') ?? 'Product requirements',
            locator: evidence.locator?.section ?? evidence.locator?.jsonPath,
            excerpt: evidence.excerpt ?? '',
        }))),
        perspectives: issue.perspectives?.map(perspective => ({
            specialistName: SPECIALIST_REGISTRY[sourceFindings.find(finding => perspective.findingIds.includes(finding.id))?.specialistId as ReviewSpecialistId]?.label ?? 'Specialist',
            recommendation: perspective.recommendation,
        })),
        disagreement: issue.relationship === 'disagreement',
        dispositionNote: latestDisposition?.reason,
        planningRecordId: issue.relatedPlanningRecordIds.at(-1),
        sourceFindingIds: issue.findingIds,
        updatedAt: issue.updatedAt,
        treatmentHistory: issue.dispositions.map(disposition => ({
            action: issueTreatmentLabel(disposition.action),
            reason: disposition.reason,
            at: disposition.at,
        })),
    };
});

export const buildReviewRunViews = (params: {
    reviewRuns: ReviewRun[];
    specialistRuns: SpecialistRun[];
    findings: SpecialistFinding[];
    issues: ReviewIssue[];
    spines: SpineVersion[];
    currentContextSignature: string | undefined;
}): ReviewRunView[] => {
    const { reviewRuns, specialistRuns, findings, issues, spines, currentContextSignature } = params;
    return reviewRuns.slice().reverse().map(run => {
        const selectedIds = new Set(run.selectedSpecialists.map(item => item.specialistId));
        const omittedRequiredIds = (run.requiredSpecialistIds ?? []).filter(id => !selectedIds.has(id));
        const persistedSpecialists = specialistRuns.filter(item => item.reviewId === run.id);
        const requiredCoverageIncomplete = (run.requiredSpecialistIds ?? []).some(id => {
            const specialist = persistedSpecialists.find(item => item.specialistId === id);
            return !specialist || specialist.status !== 'complete' || specialist.validation?.valid !== true;
        });
        return ({
            id: run.id,
            label: `Review ${run.sequenceNumber}`,
            sourceLabel: `PRD version ${spines.findIndex(spine => spine.id === run.sourceManifest.spineVersionId) + 1 || run.sourceManifest.spineVersionId}`,
            capturedAt: run.sourceManifest.capturedAt,
            status: runStatus(run.status),
            focus: run.scope.focus,
            contextChanged: currentContextSignature !== run.sourceManifest.contextSignature,
            readinessCoverage: !run.requiredSpecialistIds?.length
                ? 'unverifiable' as const
                : omittedRequiredIds.length > 0
                    ? 'exploratory' as const
                    : requiredCoverageIncomplete ? 'incomplete' as const : 'complete' as const,
            omittedRequiredSpecialistNames: omittedRequiredIds.map(id => (
                SPECIALIST_REGISTRY[id as ReviewSpecialistId]?.label ?? id
            )),
            specialists: specialistRuns.filter(item => item.reviewId === run.id).map(item => ({
                id: item.specialistId,
                name: SPECIALIST_REGISTRY[item.specialistId as ReviewSpecialistId]?.label ?? item.specialistId,
                responsibility: item.responsibility,
                selectionReason: run.selectedSpecialists.find(selected => selected.specialistId === item.specialistId)?.reason ?? '',
                status: specialistStatus(item.status),
                findingCount: item.findingIds.length,
                error: item.error?.message,
                coverageSummary: item.coverageSummary,
                resolvedAreas: item.resolvedAreas,
            })),
            issues: buildReviewIssueViews(run.id, issues, findings),
            untriagedFindings: [...new Set(specialistRuns
                .filter(specialist => specialist.reviewId === run.id && specialist.status === 'complete')
                .flatMap(specialist => specialist.findingIds))]
                .filter(findingId => !issues.some(issue => (
                    issue.reviewId === run.id && issue.findingIds.includes(findingId)
                )))
                .map(findingId => {
                    const finding = findings.find(candidate => candidate.id === findingId && candidate.reviewId === run.id);
                    if (!finding) {
                        const specialist = specialistRuns.find(candidate => (
                            candidate.reviewId === run.id && candidate.findingIds.includes(findingId)
                        ));
                        const specialistName = specialist
                            ? SPECIALIST_REGISTRY[specialist.specialistId as ReviewSpecialistId]?.label ?? specialist.specialistId
                            : 'Specialist review';
                        return {
                            id: findingId,
                            title: 'Challenge finding details are unavailable',
                            observation: 'The completed specialist run references this finding, but its durable finding record is missing.',
                            consequence: 'Synapse cannot verify or triage the original reasoning without re-running the review.',
                            recommendedAction: 'Review the current plan again to restore auditable finding detail.',
                            severity: 'blocking' as const,
                            confidence: 'low' as const,
                            specialistName,
                            affectedSources: [],
                            evidence: [],
                            canTriage: false,
                        };
                    }
                    return {
                        id: finding.id,
                        title: finding.title,
                        observation: finding.observation,
                        consequence: finding.consequence ?? finding.whyItMatters,
                        recommendedAction: finding.recommendedAction ?? 'Review this finding and decide how it should affect the plan.',
                        severity: finding.implementationImpact === 'blocker'
                            ? 'blocking' as const
                            : finding.severity === 'high' || finding.severity === 'critical'
                                ? 'important' as const
                                : 'advisory' as const,
                        confidence: finding.confidence,
                        specialistName: SPECIALIST_REGISTRY[finding.specialistId as ReviewSpecialistId]?.label ?? finding.specialistId,
                        affectedSources: [...new Set(finding.evidence.map(evidence => (
                            evidence.locator?.section ?? evidence.artifactSubtype ?? 'PRD'
                        )))],
                        evidence: finding.evidence.filter(evidence => evidence.verified).map(evidence => ({
                            id: evidence.id,
                            sourceLabel: evidence.artifactSubtype?.replaceAll('_', ' ') ?? 'Product requirements',
                            locator: evidence.locator?.section ?? evidence.locator?.jsonPath,
                            excerpt: evidence.excerpt ?? '',
                        })),
                    };
                }),
        });
    });
};
