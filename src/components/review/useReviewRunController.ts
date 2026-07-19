import { useEffect, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useToastStore } from '../../store/toastStore';
import { getStrongModel } from '../../lib/geminiClient';
import type {
    ReviewEvidenceRef,
    ReviewIssue,
    ReviewRun,
    SpecialistFinding,
    SpecialistFindingKind,
    SpecialistRun,
} from '../../types';
import {
    clusterGroundedFindings,
    createGeminiSpecialistTransport,
    hashReviewValue,
    runAdversarialReview,
    runSingleSpecialist,
    SPECIALIST_REGISTRY,
    toPersistedReviewContextManifest,
    type FindingCluster,
    type ReviewContextManifest,
    type ReviewOrchestrationEvent,
    type ReviewSpecialistId,
    type SpecialistRunResult,
    type ValidatedSpecialistFinding,
} from '../../lib/review';
import type { ReviewSpecialistOption } from './ReviewWorkspace';

const activeControllers = new Map<string, AbortController>();

/**
 * Owns adversarial-review run orchestration: starting a review, streaming
 * specialist events into persisted run state, synthesizing findings into
 * issues, retrying a single specialist, resuming an interrupted review, and
 * cancellation. All persisted state flows through the review store actions.
 */
export function useReviewRunController(params: {
    projectId: string;
    canWrite: boolean;
    initialReviewId?: string;
    currentManifest: ReviewContextManifest | undefined;
    manifests: { current: Map<string, ReviewContextManifest> };
    manifestForReview: (reviewId: string) => ReviewContextManifest | undefined;
    panel: ReviewSpecialistOption[];
    reviewRuns: ReviewRun[];
    specialistRuns: SpecialistRun[];
}) {
    const { projectId, canWrite, initialReviewId, currentManifest, manifests, manifestForReview, panel, reviewRuns, specialistRuns } = params;
    const [activeRunId, setActiveRunId] = useState<string | undefined>(initialReviewId);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (initialReviewId && reviewRuns.some(run => run.id === initialReviewId)) {
            setActiveRunId(initialReviewId);
        }
    }, [initialReviewId, reviewRuns]);

    const persistFinding = (reviewId: string, specialistRunId: string, finding: ValidatedSpecialistFinding) => {
        const state = useProjectStore.getState();
        const persistedFindingId = `${reviewId}:${finding.id}`;
        if ((state.reviewFindings[projectId] ?? []).some(existing => existing.id === persistedFindingId && existing.reviewId === reviewId)) return;
        const manifest = manifests.current.get(reviewId);
        const evidence: ReviewEvidenceRef[] = finding.evidence.map(item => {
            const locator = manifest?.locators.find(candidate => candidate.id === item.locatorId);
            const source = manifest?.sources.find(candidate => candidate.sourceKey === item.sourceKey);
            return {
                id: item.locatorId || `${specialistRunId}:${hashReviewValue(item)}`,
                sourceType: source?.sourceType ?? 'spine',
                sourceId: source?.artifactId ?? source?.spineVersionId ?? manifest?.spineVersionId ?? '',
                sourceVersionId: source?.artifactVersionId ?? source?.spineVersionId ?? manifest?.spineVersionId ?? '',
                artifactSubtype: source?.artifactSubtype,
                locator: { section: locator?.label, jsonPath: item.path },
                excerpt: item.excerpt,
                excerptHash: item.excerptHash,
                verified: item.verified,
            };
        });
        const persisted: Omit<SpecialistFinding, 'id' | 'projectId'> & { id: string } = {
            id: persistedFindingId,
            reviewId,
            specialistRunId,
            specialistId: finding.specialistId,
            kind: finding.type as SpecialistFindingKind,
            title: finding.title,
            observation: finding.observation,
            whyItMatters: finding.consequence || finding.decisionOrClarification,
            consequence: finding.consequence,
            recommendedAction: finding.recommendedAction,
            severity: finding.severity,
            confidence: finding.confidence,
            implementationImpact: finding.implementationBlocking ? 'blocker' : finding.canDefer ? 'deferrable' : 'resolve_before_build',
            evidence,
            fingerprint: finding.fingerprint,
            grounded: finding.grounded,
            createdAt: Date.now(),
        };
        state.addReviewFinding(projectId, persisted);
    };

    const persistCluster = (reviewId: string, cluster: FindingCluster, allFindings: ValidatedSpecialistFinding[]) => {
        const state = useProjectStore.getState();
        const persistedIssueId = `${reviewId}:${cluster.id}`;
        if ((state.reviewIssues[projectId] ?? []).some(existing => existing.id === persistedIssueId && existing.reviewId === reviewId)) return;
        const lead = allFindings.find(finding => cluster.findingIds.includes(finding.id));
        if (!lead) return;
        const findingIds = cluster.findingIds.map(id => id.startsWith(`${reviewId}:`) ? id : `${reviewId}:${id}`);
        const issue: Omit<ReviewIssue, 'id' | 'projectId' | 'status' | 'dispositions' | 'createdAt' | 'updatedAt'> & { id: string } = {
            id: persistedIssueId,
            reviewId,
            title: cluster.title,
            summary: lead.observation,
            kind: lead.type as SpecialistFindingKind,
            findingIds,
            specialistIds: cluster.specialistIds,
            relationship: cluster.consensus === 'single' ? 'standalone' : cluster.consensus,
            perspectives: cluster.perspectives.map(perspective => ({
                findingIds: [perspective.findingId.startsWith(`${reviewId}:`) ? perspective.findingId : `${reviewId}:${perspective.findingId}`],
                recommendation: perspective.recommendation,
            })),
            severity: cluster.severity,
            confidence: lead.confidence,
            implementationImpact: lead.implementationBlocking ? 'blocker' : lead.canDefer ? 'deferrable' : 'resolve_before_build',
            relatedPlanningRecordIds: [],
        };
        state.addReviewIssue(projectId, issue);

        // A dismissal is a user decision scoped to the exact reviewed context.
        // Carry it forward only when a re-review finds the same fingerprint set
        // against the unchanged context; changed sources intentionally reopen it.
        const fingerprints = allFindings
            .filter(finding => cluster.findingIds.includes(finding.id))
            .map(finding => finding.fingerprint)
            .sort()
            .join('|');
        const priorDismissed = (state.reviewIssues[projectId] ?? []).find(candidate => {
            if (candidate.reviewId === reviewId || candidate.status !== 'dismissed') return false;
            const priorFingerprints = (state.reviewFindings[projectId] ?? [])
                .filter(finding => finding.reviewId === candidate.reviewId && candidate.findingIds.includes(finding.id))
                .map(finding => finding.fingerprint)
                .sort()
                .join('|');
            const disposition = candidate.dispositions.at(-1);
            const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
            return priorFingerprints === fingerprints
                && disposition?.action === 'dismiss'
                && disposition.contextSignature === run?.sourceManifest.contextSignature;
        });
        const priorDisposition = priorDismissed?.dispositions.at(-1);
        if (priorDisposition) {
            state.applyReviewIssueDisposition(projectId, reviewId, persistedIssueId, {
                action: 'dismiss',
                contextSignature: priorDisposition.contextSignature,
                reason: priorDisposition.reason,
                at: priorDisposition.at,
            });
        }
    };

    const validatedFindingsForReview = (reviewId: string, manifest: ReviewContextManifest): ValidatedSpecialistFinding[] => {
        return (useProjectStore.getState().reviewFindings[projectId] ?? []).filter(finding => finding.reviewId === reviewId).map(finding => ({
            id: finding.id,
            title: finding.title,
            observation: finding.observation,
            type: finding.kind === 'assumption' ? 'missing_information' : finding.kind,
            severity: finding.severity,
            confidence: finding.confidence,
            implementationBlocking: finding.implementationImpact === 'blocker',
            canDefer: finding.implementationImpact === 'deferrable',
            consequence: finding.consequence ?? finding.whyItMatters,
            decisionOrClarification: finding.whyItMatters,
            recommendedAction: finding.recommendedAction ?? 'Clarify the plan before implementation.',
            affectedFeatureIds: [],
            specialistId: finding.specialistId as ReviewSpecialistId,
            evidence: finding.evidence.map(evidence => ({
                sourceKey: evidence.sourceType === 'spine' ? `spine:${evidence.sourceVersionId}` : `artifact:${evidence.sourceVersionId}`,
                locatorId: evidence.id,
                path: evidence.locator?.jsonPath ?? '',
                excerpt: evidence.excerpt ?? '',
                excerptHash: evidence.excerptHash ?? hashReviewValue(evidence.excerpt ?? ''),
                verified: evidence.verified,
            })),
            grounded: finding.grounded,
            validationWarnings: finding.grounded ? [] : ['Evidence did not pass local validation.'],
            fingerprint: finding.fingerprint,
        })).filter(finding => manifest.sources.some(source => finding.evidence.some(evidence => evidence.sourceKey === source.sourceKey)));
    };

    const applyEvent = (reviewId: string, event: ReviewOrchestrationEvent) => {
        const state = useProjectStore.getState();
        const specialistRun = (state.specialistRuns[projectId] ?? []).find(run => run.reviewId === reviewId && run.specialistId === event.specialistId);
        if (!specialistRun) return;
        if (event.type === 'specialist_started' || event.type === 'specialist_retrying') {
            state.updateSpecialistRun(projectId, specialistRun.id, { status: 'running', attemptCount: event.attempt, startedAt: specialistRun.startedAt ?? Date.now() });
        } else if (event.type === 'specialist_completed') {
            for (const finding of event.findings) persistFinding(reviewId, specialistRun.id, finding);
            state.updateSpecialistRun(projectId, specialistRun.id, { status: 'complete', attemptCount: event.attempt, completedAt: Date.now() });
        } else if (event.type === 'specialist_failed') {
            state.updateSpecialistRun(projectId, specialistRun.id, { status: 'failed', error: { message: event.error }, completedAt: Date.now() });
        } else if (event.type === 'specialist_cancelled') {
            state.updateSpecialistRun(projectId, specialistRun.id, { status: 'cancelled', completedAt: Date.now() });
        }
    };

    const persistResult = (reviewId: string, result: SpecialistRunResult) => {
        const state = useProjectStore.getState();
        const run = (state.specialistRuns[projectId] ?? []).find(item => item.reviewId === reviewId && item.specialistId === result.specialistId);
        if (!run) return;
        const manifest = manifests.current.get(reviewId);
        const coverageChecks = result.coverageChecks?.map(check => ({
            area: check.area,
            conclusion: check.conclusion,
            evidence: check.evidence.map(item => {
                const locator = manifest?.locators.find(candidate => candidate.id === item.locatorId);
                const source = manifest?.sources.find(candidate => candidate.sourceKey === item.sourceKey);
                return {
                    id: item.locatorId || `${run.id}:coverage:${hashReviewValue(item)}`,
                    sourceType: source?.sourceType ?? 'spine',
                    sourceId: source?.artifactId ?? source?.spineVersionId ?? manifest?.spineVersionId ?? '',
                    sourceVersionId: source?.artifactVersionId ?? source?.spineVersionId ?? manifest?.spineVersionId ?? '',
                    artifactSubtype: source?.artifactSubtype,
                    locator: { section: locator?.label, jsonPath: item.path },
                    excerpt: item.excerpt,
                    excerptHash: item.excerptHash,
                    verified: item.verified,
                } satisfies ReviewEvidenceRef;
            }),
        }));
        const coverageEvidence = result.coverageChecks?.flatMap(check => check.evidence) ?? [];
        for (const finding of result.findings) persistFinding(reviewId, run.id, finding);
        state.updateSpecialistRun(projectId, run.id, {
            status: result.status === 'complete' ? 'complete' : result.status,
            attemptCount: result.attempts,
            completedAt: Date.now(),
            validation: {
                valid: result.findings.every(finding => finding.grounded)
                    && coverageEvidence.length > 0
                    && coverageEvidence.every(item => item.verified),
                unsupportedEvidenceIds: [
                    ...result.findings.flatMap(finding => finding.evidence.filter(item => !item.verified).map(item => item.locatorId)),
                    ...coverageEvidence.filter(item => !item.verified).map(item => item.locatorId),
                ],
                warnings: result.findings.flatMap(finding => finding.validationWarnings),
            },
            error: result.error ? { message: result.error } : undefined,
            coverageSummary: result.coverageSummary,
            resolvedAreas: result.resolvedAreas,
            coverageChecks,
        });
    };

    const executeReview = async (reviewId: string, manifest: ReviewContextManifest, specialistIds: ReviewSpecialistId[], focus?: string) => {
        const controller = new AbortController();
        activeControllers.set(reviewId, controller);
        const state = useProjectStore.getState();
        state.updateReviewRun(projectId, reviewId, { status: 'running', startedAt: Date.now() });
        try {
            const result = await runAdversarialReview(manifest, specialistIds, {
                transport: createGeminiSpecialistTransport(),
                signal: controller.signal,
                focus,
                concurrency: 3,
                onEvent: event => applyEvent(reviewId, event),
            });
            for (const specialistResult of result.specialistResults) persistResult(reviewId, specialistResult);
            if (result.status === 'cancelled') {
                state.updateReviewRun(projectId, reviewId, { status: 'cancelled', completedAt: Date.now() });
                return;
            }
            state.updateReviewRun(projectId, reviewId, { status: 'synthesizing', synthesisStatus: 'running' });
            const allFindings = validatedFindingsForReview(reviewId, manifest);
            const clusters = clusterGroundedFindings(allFindings);
            state.supersedeOpenReviewIssues(projectId, reviewId, clusters.map(cluster => `${reviewId}:${cluster.id}`));
            for (const cluster of clusters) persistCluster(reviewId, cluster, allFindings);
            state.updateReviewRun(projectId, reviewId, {
                status: result.status === 'failed' ? 'failed' : result.status === 'partial' ? 'partial' : 'complete',
                synthesisStatus: result.status === 'failed' ? 'failed' : 'complete',
                completedAt: Date.now(),
            });
        } catch (error) {
            const cancelled = controller.signal.aborted;
            state.updateReviewRun(projectId, reviewId, {
                status: cancelled ? 'cancelled' : 'failed',
                synthesisStatus: cancelled ? 'interrupted' : 'failed',
                completedAt: Date.now(),
            });
            if (!cancelled) useToastStore.getState().addToast({ type: 'error', title: 'Review could not finish', message: error instanceof Error ? error.message : 'Unknown review error' });
        } finally {
            activeControllers.delete(reviewId);
            setBusy(false);
        }
    };

    const handleStart = async ({ specialistIds, focus }: { specialistIds: string[]; focus?: string }) => {
        if (!canWrite || !currentManifest || busy) return;
        setBusy(true);
        const selected = specialistIds.filter((id): id is ReviewSpecialistId => id in SPECIALIST_REGISTRY);
        const state = useProjectStore.getState();
        const { reviewId } = state.createReviewRun(projectId, {
            scope: { kind: focus ? 'focus' : 'project', focus },
            sourceManifest: toPersistedReviewContextManifest(currentManifest),
            selectedSpecialists: selected.map(id => ({ specialistId: id, label: SPECIALIST_REGISTRY[id].label, reason: panel.find(option => option.id === id)?.selectionReason ?? 'Selected by the user.' })),
            requiredSpecialistIds: panel.filter(option => option.recommended).map(option => option.id),
            modelPolicyVersion: 1,
        });
        manifests.current.set(reviewId, currentManifest);
        for (const id of selected) {
            const specialist = SPECIALIST_REGISTRY[id];
            state.createSpecialistRun(projectId, {
                reviewId,
                specialistId: id,
                responsibility: specialist.responsibility,
                boundaries: specialist.boundaries,
                contextRefIds: currentManifest.sources.map(source => source.sourceKey),
                model: getStrongModel(),
                provider: 'gemini',
            });
        }
        setActiveRunId(reviewId);
        await executeReview(reviewId, currentManifest, selected, focus);
    };

    const handleRetrySpecialist = async (reviewId: string, specialistId: string) => {
        if (!canWrite) return;
        const manifest = manifestForReview(reviewId);
        if (!manifest || !(specialistId in SPECIALIST_REGISTRY)) {
            useToastStore.getState().addToast({ type: 'warning', title: 'Review snapshot unavailable', message: 'One or more reviewed source versions are no longer available.' });
            return;
        }
        const controller = new AbortController();
        activeControllers.set(reviewId, controller);
        setBusy(true);
        const result = await runSingleSpecialist(manifest, specialistId as ReviewSpecialistId, {
            transport: createGeminiSpecialistTransport(), signal: controller.signal, onEvent: event => applyEvent(reviewId, event),
        });
        persistResult(reviewId, result);
        activeControllers.delete(reviewId);
        setBusy(false);
    };

    const handleResumeReview = async (reviewId: string) => {
        if (!canWrite) return;
        const manifest = manifestForReview(reviewId);
        const run = reviewRuns.find(item => item.id === reviewId);
        if (!manifest || !run) {
            useToastStore.getState().addToast({ type: 'warning', title: 'Review snapshot unavailable', message: 'This review cannot resume because its exact source snapshot is unavailable.' });
            return;
        }
        const incomplete = specialistRuns
            .filter(item => item.reviewId === reviewId && item.status !== 'complete')
            .map(item => item.specialistId)
            .filter((id): id is ReviewSpecialistId => id in SPECIALIST_REGISTRY);
        if (incomplete.length === 0) {
            const allFindings = validatedFindingsForReview(reviewId, manifest);
            const clusters = clusterGroundedFindings(allFindings);
            useProjectStore.getState().supersedeOpenReviewIssues(projectId, reviewId, clusters.map(cluster => `${reviewId}:${cluster.id}`));
            for (const cluster of clusters) persistCluster(reviewId, cluster, allFindings);
            useProjectStore.getState().updateReviewRun(projectId, reviewId, { status: 'complete', synthesisStatus: 'complete', completedAt: Date.now() });
            return;
        }
        setBusy(true);
        await executeReview(reviewId, manifest, incomplete, run.scope.focus);
    };

    const cancelRun = (reviewId: string) => activeControllers.get(reviewId)?.abort();

    return { activeRunId, setActiveRunId, busy, handleStart, handleRetrySpecialist, handleResumeReview, cancelRun };
}
