import { useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useProjectStore } from '../../store/projectStore';
import type {
    AssumptionEvidenceConclusion,
    AssumptionUncertaintyTreatment,
    PlanningRecord,
    ReviewEvidenceRef,
    ReviewIssue,
    ReviewIssueDisposition,
    SpecialistFinding,
    SpecialistFindingKind,
} from '../../types';
import type { DecisionEvent } from '../../types';
import {
    buildReviewContextManifest,
    clusterGroundedFindings,
    createGeminiSpecialistTransport,
    hashReviewValue,
    recommendSpecialistPanel,
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
import { useToastStore } from '../../store/toastStore';
import { getStrongModel } from '../../lib/geminiClient';
import {
    alignmentProposalReviews,
    buildDecisionImpact,
    buildResidualDecisionImpact,
    buildReviewedDecisionImpact,
    isDecisionImpactStale,
    projectDecision,
    reasonAboutComplexPlanningTargets,
    integrateComplexCandidateIntoPreview,
    COMPLEX_TARGET_KINDS,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    buildAssumptionInterpretationProposal,
    buildAssumptionValidationPlanProposal,
    assumptionValidationReadiness,
    planningContentHash,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../../lib/planning';
import { canPerformProjectAction } from '../../lib/projectCapabilities';
import { alignmentProposalContentHash } from '../../lib/planning/proposalIntegrity';
import {
    ReviewWorkspace,
    type PlanningRecordView,
    type ReviewIssueAction,
    type ReviewIssueView,
    type ReviewRunView,
    type ReviewSpecialistOption,
} from './ReviewWorkspace';
import type {
    AssumptionEvidenceActionGuard,
    AssumptionEvidenceCorrectionInput,
    AssumptionEvidenceInput,
    AssumptionValidationPlanInput,
} from './AssumptionValidationPanel';

interface Props {
    projectId: string;
    initialTab?: 'review' | 'decisions';
    initialRecordId?: string;
    initialReviewId?: string;
    initialIssueId?: string;
    initialFindingId?: string;
}

const activeControllers = new Map<string, AbortController>();

// Zustand selectors are consumed through React's useSyncExternalStore. Keep
// the absent per-project snapshot referentially stable so projects that have
// not created every review collection yet do not trigger an infinite render
// loop under React 19.
const EMPTY_PROJECT_COLLECTION: never[] = [];

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

const recordTypeForAction = (action: ReviewIssueAction): PlanningRecord['type'] | undefined => ({
    propose_decision: 'decision',
    add_assumption: 'assumption',
    add_risk: 'risk',
    request_clarification: 'open_question',
    record_conflict: 'conflict',
    challenge_decision: 'conflict',
} as Partial<Record<ReviewIssueAction, PlanningRecord['type']>>)[action];

type InitialReviewIssueDispositionAction = Exclude<ReviewIssueDisposition['action'], 'reopen'>;

const DISPOSITION_BY_ACTION: Record<ReviewIssueAction, InitialReviewIssueDispositionAction> = {
    propose_decision: 'propose_record',
    add_assumption: 'propose_record',
    add_risk: 'propose_record',
    request_clarification: 'propose_record',
    record_conflict: 'propose_record',
    link_existing: 'link_existing',
    challenge_decision: 'challenge_existing',
    request_revision: 'request_revision',
    defer: 'defer',
    dismiss: 'dismiss',
    already_addressed: 'already_addressed',
};

const dispositionForAction = (action: ReviewIssueAction): InitialReviewIssueDispositionAction => DISPOSITION_BY_ACTION[action];

const issueTreatmentLabel = (action: ReviewIssueDisposition['action']): string => ({
    propose_record: 'Added to the Decision Center',
    link_existing: 'Connected to an existing planning item',
    challenge_existing: 'Recorded as a conflict with an existing decision',
    request_revision: 'Plan revision requested',
    defer: 'Deferred',
    dismiss: 'Dismissed with rationale',
    already_addressed: 'Marked already addressed',
    reopen: 'Returned to Needs attention',
})[action];

export function ReviewWorkspaceContainer({ projectId, initialTab, initialRecordId, initialReviewId, initialIssueId, initialFindingId }: Props) {
    const project = useProjectStore(state => state.projects[projectId]);
    const spines = useProjectStore(state => state.spineVersions[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const artifacts = useProjectStore(state => state.artifacts[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const artifactVersions = useProjectStore(state => state.artifactVersions[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const reviewRuns = useProjectStore(state => state.reviewRuns[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const specialistRuns = useProjectStore(state => state.specialistRuns[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const findings = useProjectStore(state => state.reviewFindings[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const issues = useProjectStore(state => state.reviewIssues[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const planningRecords = useProjectStore(state => state.planningRecords[projectId] ?? EMPTY_PROJECT_COLLECTION);
    const [activeRunId, setActiveRunId] = useState<string | undefined>(initialReviewId);
    const [busy, setBusy] = useState(false);
    const [alignmentAnalysis, setAlignmentAnalysis] = useState<Record<string, { busy: boolean; error?: string }>>({});
    const canWrite = canPerformProjectAction(projectId, 'persist');
    const manifests = useRef(new Map<string, ReviewContextManifest>());

    useEffect(() => {
        if (initialReviewId && reviewRuns.some(run => run.id === initialReviewId)) {
            setActiveRunId(initialReviewId);
        }
    }, [initialReviewId, reviewRuns]);

    const latestSpine = spines.find(spine => spine.isLatest) ?? spines.at(-1);
    useEffect(() => {
        if (!canWrite || !latestSpine?.structuredPRD) return;
        useProjectStore.getState().importPlanningAssumptions(projectId, latestSpine.id, latestSpine.structuredPRD);
    }, [canWrite, latestSpine?.id, latestSpine?.structuredPRD, projectId]);
    const preferredArtifacts = useMemo(() => artifacts.flatMap(artifact => {
        if (artifact.type !== 'core_artifact' || !artifact.subtype || !artifact.currentVersionId) return [];
        const version = artifactVersions.find(candidate => candidate.id === artifact.currentVersionId);
        return version ? [{
            artifactId: artifact.id,
            versionId: version.id,
            subtype: artifact.subtype,
            title: artifact.title,
            content: version.content,
        }] : [];
    }), [artifacts, artifactVersions]);

    const currentManifest = useMemo(() => {
        if (!project || !latestSpine?.structuredPRD) return undefined;
        return buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            spine: {
                versionId: latestSpine.id,
                schemaVersion: latestSpine.prdVersion,
                content: latestSpine.responseText,
                structuredPRD: latestSpine.structuredPRD,
                canonicalSpine: latestSpine.canonicalSpine,
            },
            artifacts: preferredArtifacts,
            safetyBoundaries: latestSpine.safetyReview?.detectedConcerns ?? [],
        });
    }, [latestSpine, preferredArtifacts, project, projectId]);

    const manifestForReview = (reviewId: string): ReviewContextManifest | undefined => {
        const cached = manifests.current.get(reviewId);
        if (cached) return cached;
        const run = reviewRuns.find(candidate => candidate.id === reviewId);
        const sourceSpine = spines.find(candidate => candidate.id === run?.sourceManifest.spineVersionId);
        if (!run || !project || !sourceSpine?.structuredPRD) return undefined;
        const sourceArtifacts = run.sourceManifest.artifactRefs.flatMap(ref => {
            const artifact = artifacts.find(candidate => candidate.id === ref.artifactId);
            const version = artifactVersions.find(candidate => candidate.id === ref.artifactVersionId);
            if (!artifact?.subtype || !version) return [];
            return [{ artifactId: artifact.id, versionId: version.id, subtype: artifact.subtype, title: artifact.title, content: version.content }];
        });
        if (sourceArtifacts.length !== run.sourceManifest.artifactRefs.length) return undefined;
        const manifest = buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            capturedAt: run.sourceManifest.capturedAt,
            spine: {
                versionId: sourceSpine.id,
                schemaVersion: sourceSpine.prdVersion,
                content: sourceSpine.responseText,
                structuredPRD: sourceSpine.structuredPRD,
                canonicalSpine: sourceSpine.canonicalSpine,
            },
            artifacts: sourceArtifacts,
            expectedArtifactSubtypes: [
                ...sourceArtifacts.map(item => item.subtype),
                ...(run.sourceManifest.missingArtifactSubtypes ?? []),
            ],
            safetyBoundaries: sourceSpine.safetyReview?.detectedConcerns ?? [],
        });
        if (manifest.contextSignature !== run.sourceManifest.contextSignature) return undefined;
        manifests.current.set(reviewId, manifest);
        return manifest;
    };

    const panel = useMemo<ReviewSpecialistOption[]>(() => {
        if (!currentManifest) return [];
        return recommendSpecialistPanel(currentManifest).map(item => {
            const specialist = SPECIALIST_REGISTRY[item.specialistId];
            return {
                id: item.specialistId,
                name: specialist.label,
                responsibility: specialist.responsibility,
                selectionReason: item.reasons.join(' '),
                recommended: true,
            };
        });
    }, [currentManifest]);

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

    const handleIssueAction = (reviewId: string, issueId: string, action: ReviewIssueAction, note?: string, planningRecordId?: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const issue = (state.reviewIssues[projectId] ?? []).find(item => item.id === issueId && item.reviewId === reviewId);
        const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
        if (!issue || !run) return;
        let recordId = planningRecordId;
        const recordType = recordTypeForAction(action);
        if (recordType) {
            const sourceFindings = (state.reviewFindings[projectId] ?? []).filter(
                finding => finding.reviewId === reviewId && issue.findingIds.includes(finding.id),
            );
            recordId = state.createPlanningRecord(projectId, {
                type: recordType,
                status: recordType === 'decision' ? 'proposed' : 'open',
                title: issue.title,
                statement: note?.trim() || issue.summary,
                recommendation: sourceFindings.find(finding => finding.recommendedAction)?.recommendedAction,
                evidence: sourceFindings.flatMap(finding => finding.evidence),
                sourceFindingIds: issue.findingIds,
                sourceReviewIssueId: issue.id,
                challengesRecordId: action === 'challenge_decision' ? planningRecordId : undefined,
                createdBy: 'specialist_review',
            }).planningRecordId;
        }
        state.applyReviewIssueDisposition(projectId, reviewId, issueId, {
            action: dispositionForAction(action),
            contextSignature: run.sourceManifest.contextSignature,
            reason: note?.trim() || undefined,
            planningRecordId: recordId,
        });
    };

    const handleReopenIssue = (reviewId: string, issueId: string, reason: string, expectedUpdatedAt: number) => {
        if (!canWrite || !currentManifest) return;
        const state = useProjectStore.getState();
        const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
        if (!run) return;
        const result = state.reopenReviewIssue(projectId, reviewId, issueId, {
            reason,
            expectedUpdatedAt,
            expectedContextSignature: run.sourceManifest.contextSignature,
            currentContextSignature: currentManifest.contextSignature,
        });
        if (!result.ok) {
            useToastStore.getState().addToast({
                type: 'warning',
                title: 'Finding not reopened',
                message: result.reason,
            });
        }
    };

    const handleTriageFinding = (reviewId: string, findingId: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const finding = (state.reviewFindings[projectId] ?? []).find(item => (
            item.id === findingId && item.reviewId === reviewId
        ));
        if (!finding) return;
        const existing = (state.reviewIssues[projectId] ?? []).find(issue => (
            issue.reviewId === reviewId && issue.findingIds.includes(findingId)
        ));
        if (existing) return;
        state.addReviewIssue(projectId, {
            id: `${reviewId}:triage:${hashReviewValue(findingId)}`,
            reviewId,
            title: finding.title,
            summary: finding.observation,
            kind: finding.kind,
            findingIds: [finding.id],
            specialistIds: [finding.specialistId],
            relationship: 'standalone',
            severity: finding.severity,
            confidence: finding.confidence,
            implementationImpact: finding.implementationImpact,
            relatedPlanningRecordIds: [],
        });
    };

    const issueViews = (reviewId: string): ReviewIssueView[] => issues.filter(issue => issue.reviewId === reviewId).map(issue => {
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

    const runViews: ReviewRunView[] = reviewRuns.slice().reverse().map(run => {
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
        contextChanged: currentManifest?.contextSignature !== run.sourceManifest.contextSignature,
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
        issues: issueViews(run.id),
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

    const planningViews: PlanningRecordView[] = planningRecords.map(record => {
        const projection = projectDecision(record);
        const validationProjection = record.type === 'assumption' ? projectAssumptionValidation(record) : undefined;
        const currentSpineContentHash = latestSpine
            ? planningContentHash(latestSpine.structuredPRD ?? latestSpine.responseText)
            : undefined;
        const evidenceSetHash = validationProjection
            ? assumptionEvidenceSetHash(validationProjection.activeEvidence)
            : undefined;
        const latestPlanProposal = [...(record.assumptionValidation?.planProposals ?? [])].reverse().find(proposal => (
            proposal.assumptionStatementHash === assumptionStatementHash(record)
            && proposal.evidenceSetHash === evidenceSetHash
            && (!proposal.sourceSpineVersionId || (
                proposal.sourceSpineVersionId === latestSpine?.id
                && proposal.sourceSpineContentHash === currentSpineContentHash
            ))
        ));
        const latestInterpretation = [...(record.assumptionValidation?.interpretationProposals ?? [])].reverse().find(proposal => (
            proposal.assumptionStatementHash === assumptionStatementHash(record)
            && proposal.validationPlanHash === validationProjection?.currentPlan?.contentHash
            && proposal.evidenceSetHash === evidenceSetHash
            && (!proposal.sourceSpineVersionId || (
                proposal.sourceSpineVersionId === latestSpine?.id
                && proposal.sourceSpineContentHash === currentSpineContentHash
            ))
        ));
        const assessment = record.assessments?.at(-1);
        const storedPreview = assessment?.impactPreview;
        const previewStale = storedPreview && latestSpine?.structuredPRD
            ? isDecisionImpactStale(storedPreview, latestSpine.id, latestSpine.structuredPRD)
                || storedPreview.decisionEventId !== projection.latestVerdictEventId
            : false;
        const option = record.decisionOptions?.find(item => item.id === projection.selectedOptionId);
        const proposalReviews = storedPreview ? alignmentProposalReviews(record, storedPreview) : [];
        return {
            id: record.id,
            type: record.type === 'open_question' ? 'question' : record.type,
            title: record.title,
            statement: record.statement,
            whyItMatters: record.whyItMatters ?? record.evidence[0]?.excerpt,
            status: projection.status,
            materiality: record.materiality,
            requiresValidation: record.type === 'assumption'
                && (record.materiality === undefined || record.materiality === 'blocking' || record.materiality === 'high')
                && !assumptionValidationReadiness(record, Date.now(), {
                    currentSpineVersionId: latestSpine?.id,
                    currentSpineContentHash,
                }).ready,
            options: record.decisionOptions,
            recommendation: record.recommendationDetail ?? (record.recommendation ? { summary: record.recommendation } : undefined),
            resolution: option?.label ?? projection.answer,
            rationale: projection.rationale,
            sourceLabels: (record.sources ?? []).map(source => source.sourceType === 'prd_assumption'
                ? 'PRD assumption'
                : source.sourceType.replaceAll('_', ' ')),
            sourceNotice: record.sourceState === 'changed'
                ? `The source assumption changed to: ${record.currentSourceStatement}. Review this decision before relying on it.`
                : record.sourceState === 'missing'
                    ? 'The source assumption is no longer present in the current PRD. Review whether this decision is still valid.'
                    : undefined,
            sourceIssueIds: record.sourceReviewIssueId ? [record.sourceReviewIssueId] : [],
            createdAt: record.createdAt,
            history: (record.events ?? []).map(event => ({
                id: event.id,
                label: event.type.replaceAll('_', ' '),
                at: event.at,
                rationale: event.rationale,
            })),
            validation: validationProjection ? {
                workflowState: validationProjection.workflowState,
                currentPlan: validationProjection.currentPlan,
                latestPlanProposal,
                activeEvidence: validationProjection.activeEvidence,
                duplicateEvidenceIds: validationProjection.duplicateEvidenceIds,
                evidenceFromAnotherQuestionIds: validationProjection.evidenceFromAnotherQuestionIds,
                latestInterpretation,
                acceptedConclusion: validationProjection.acceptedConclusion,
                conclusionIsCurrent: validationProjection.conclusionIsCurrent,
                userTreatment: validationProjection.userTreatment,
                treatmentRationale: validationProjection.treatmentRationale,
                revisitAt: validationProjection.revisitAt,
                revisitCondition: validationProjection.revisitCondition,
                hasHistoricalValidation: validationProjection.hasHistoricalValidation,
                dependentLabels: [...new Set([
                    ...(record.affectedPrdSections ?? []),
                    ...(record.affectedArtifactSlots ?? []).map(slot => slot.replaceAll('_', ' ')),
                    ...(record.affectedPlanLocations ?? []).map(location => location.label),
                ])],
                history: (record.assumptionValidation?.events ?? []).map(event => ({
                    id: event.id,
                    label: event.type === 'validation_plan_recorded' ? 'Validation plan recorded'
                        : event.type === 'validation_evidence_recorded' ? 'Evidence recorded'
                            : event.type === 'validation_evidence_retracted' ? 'Evidence retracted'
                                : event.type === 'validation_outcome_recorded' ? `Conclusion: ${event.conclusion.replaceAll('_', ' ')}`
                                    : event.type === 'validation_outcome_reopened' ? 'Conclusion reopened'
                                        : `Uncertainty ${event.treatment.replaceAll('_', ' ')}`,
                    at: event.at,
                    detail: event.type === 'validation_outcome_recorded' ? event.caveats
                        : event.type === 'validation_evidence_recorded' ? event.evidence.source
                            : event.type === 'validation_uncertainty_treatment_recorded' ? event.rationale
                                : event.type === 'validation_evidence_retracted' || event.type === 'validation_outcome_reopened' ? event.reason
                                    : undefined,
                })),
                evidenceSetHash,
                sourceSpineVersionId: latestSpine?.id,
                sourceSpineContentHash: currentSpineContentHash,
            } : undefined,
            preview: storedPreview ? {
                id: storedPreview.id,
                status: previewStale ? 'stale' : storedPreview.status,
                affectedPrdSections: storedPreview.affectedPrdSections,
                affectedArtifactLabels: storedPreview.affectedArtifactSlots.map(slot => slot.replaceAll('_', ' ')),
                beforeSummary: storedPreview.proposedPrdPatch?.[0]?.beforeSummary,
                afterSummary: storedPreview.proposedPrdPatch?.[0]?.afterSummary,
                explanation: storedPreview.explanation,
                error: storedPreview.error,
                proposals: proposalReviews.map(review => ({
                    id: review.proposal.id,
                    targetLabel: review.proposal.target.label,
                    targetKind: review.proposal.target.kind,
                    section: review.proposal.target.section,
                    beforeSummary: review.proposal.beforeSummary,
                    proposedSummary: review.proposal.proposedSummary,
                    reason: review.proposal.reason,
                    confidence: review.proposal.confidence,
                    reasoningConfidence: review.proposal.reasoningConfidence ?? review.proposal.contract?.reasoningConfidence,
                    evidenceCharacter: review.proposal.evidenceCharacter ?? review.proposal.contract?.evidenceCharacter,
                    requiresInput: review.proposal.requiresInput,
                    requiredForVerdictAlignment: review.proposal.requiredForVerdictAlignment,
                    canEditWording: typeof review.proposal.proposedValue === 'string'
                        || (Array.isArray(review.proposal.proposedValue) && review.proposal.proposedValue.every(item => typeof item === 'string'))
                        || review.proposal.target.entityType === 'assumption',
                    canRequestReasoning: !['accepted', 'edited'].includes(review.disposition)
                        && COMPLEX_TARGET_KINDS.includes(review.proposal.target.kind as typeof COMPLEX_TARGET_KINDS[number])
                        && Boolean(review.proposal.target.jsonPath)
                        && review.proposal.target.jsonPath !== '$.architecture',
                    analysisStatus: review.proposal.contract?.analysisStatus,
                    analysisMethod: review.proposal.contract?.method,
                    analysisModel: review.proposal.contract?.model,
                    analysisProvider: review.proposal.contract?.provider,
                    analysisFailureReason: review.proposal.contract?.failureReason,
                    analysisAmbiguity: review.proposal.ambiguity,
                    analysisQuestions: review.proposal.questions,
                    analysisEvidence: review.proposal.evidenceSummary?.map(summary => {
                        const separator = summary.indexOf(': ');
                        return separator > 0
                            ? { label: summary.slice(0, separator), excerpt: summary.slice(separator + 2) }
                            : { label: 'Planning evidence', excerpt: summary };
                    }),
                    analysisBusy: alignmentAnalysis[`${record.id}:${storedPreview.id}:${review.proposal.id}`]?.busy,
                    analysisError: alignmentAnalysis[`${record.id}:${storedPreview.id}:${review.proposal.id}`]?.error,
                    disposition: review.disposition,
                    editedSummary: review.editedSummary,
                })),
                canApply: proposalReviews.some(review =>
                    ['accepted', 'edited'].includes(review.disposition)
                    && !review.proposal.requiresInput
                    && (storedPreview.proposalContractVersion !== 1 || review.proposal.contract?.analysisStatus === 'bounded_applicable')
                    && storedPreview.proposedPrdPatch?.some(patch => patch.proposalId === review.proposal.id),
                ),
            } : undefined,
        };
    });

    const createImpactReview = (recordId: string) => {
        const state = useProjectStore.getState();
        const record = state.planningRecords[projectId]?.find(item => item.id === recordId);
        const spine = state.spineVersions[projectId]?.find(item => item.isLatest);
        if (!record || !spine?.structuredPRD) return undefined;
        const result = buildDecisionImpact({ projectId, record, baselineSpineVersionId: spine.id, structuredPRD: spine.structuredPRD });
        if (!result.ok) return result;
        state.addPlanningAssessment(projectId, recordId, result.assessment);
        return result;
    };

    const currentAssumptionContext = (recordId: string) => {
        const state = useProjectStore.getState();
        const record = state.planningRecords[projectId]?.find(item => item.id === recordId);
        const spine = state.spineVersions[projectId]?.find(item => item.isLatest)
            ?? state.spineVersions[projectId]?.at(-1);
        return {
            state,
            record,
            spine,
            spineContentHash: spine ? planningContentHash(spine.structuredPRD ?? spine.responseText) : undefined,
        };
    };

    const showValidationError = (title: string, reason: string) => {
        useToastStore.getState().addToast({ type: 'error', title, message: reason });
    };

    const handleGenerateAssumptionValidationPlan = (recordId: string) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const technical = record.affectedPrdSections?.some(section => /architecture|technical|constraint/i.test(section));
        const proposal = buildAssumptionValidationPlanProposal({
            record,
            question: `What observable result would show that “${record.statement}” is reliable enough to plan around?`,
            method: technical
                ? { kind: 'technical_test', label: 'Small technical test' }
                : { kind: 'user_interviews', label: 'Focused user interviews' },
            supportSignals: ['A directly observed result answers the validation question in the expected direction.'],
            contradictionSignals: ['A directly observed result shows the assumption does not hold in the relevant context.'],
            inconclusiveConditions: ['The source does not answer this exact question or the scope is too narrow to guide the plan.'],
            limitations: ['One method can reduce uncertainty without proving the assumption in every context.'],
            revisitCondition: 'New contradictory evidence appears or the dependent plan changes.',
            sourceSpineVersionId: spine?.id,
            sourceSpineContentHash: spineContentHash,
            model: 'bounded-validation-plan-v1',
            provider: 'synapse',
        });
        const result = state.addAssumptionValidationPlanProposal(projectId, recordId, proposal);
        if (!result.ok) showValidationError('Validation plan not prepared', result.reason);
    };

    const handleRecordAssumptionValidationPlan = (recordId: string, input: AssumptionValidationPlanInput) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        const plan = sealAssumptionValidationPlan({
            id: uuidv4(),
            question: input.question,
            method: { kind: input.methodKind, label: input.methodLabel },
            supportSignals: input.supportSignals,
            contradictionSignals: input.contradictionSignals,
            inconclusiveConditions: input.inconclusiveConditions,
            limitations: input.limitations,
            revisitCondition: input.revisitCondition,
            expiresAt: input.expiresAt,
            authoredBy: 'user',
            createdAt: at,
        });
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_plan_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            plan,
            sourceProposalId: input.sourceProposalId,
            sourceProposalContentHash: input.sourceProposalContentHash,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Validation plan not saved', result.reason);
        else useToastStore.getState().addToast({ type: 'success', title: 'Validation plan recorded', message: 'This user-authored plan now defines what evidence belongs to the assumption.' });
    };

    const handleAddAssumptionEvidence = (recordId: string, input: AssumptionEvidenceInput) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        if (!projection.currentPlan) {
            showValidationError('Evidence not saved', 'Record a validation plan before adding evidence.');
            return;
        }
        const evidence = sealAssumptionEvidence({
            id: uuidv4(), planningRecordId: recordId,
            sourceType: input.sourceType, source: input.source, sourceIdentity: input.sourceIdentity,
            observedAt: input.observedAt, recordedAt: at, observation: input.observation,
            validationQuestion: projection.currentPlan.question,
            scopeOrSample: input.scopeOrSample, limitations: input.limitations,
            character: input.character, relation: input.relation,
            assumptionStatementHash: assumptionStatementHash(record),
            validationPlanHash: projection.currentPlan.contentHash,
            authoredBy: 'user',
        });
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_evidence_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            evidence,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Evidence not saved', result.reason);
        else if (result.duplicateEvidenceOf) useToastStore.getState().addToast({ type: 'info', title: 'Duplicate source preserved', message: 'This record is visible, but will not count as independent corroboration.' });
        else useToastStore.getState().addToast({ type: 'success', title: 'Evidence recorded', message: 'The observation remains separate from any interpretation or conclusion.' });
    };

    const handleRetractAssumptionEvidence = (recordId: string, input: AssumptionEvidenceActionGuard) => {
        if (!canWrite) return;
        const result = useProjectStore.getState().retractAssumptionEvidence(projectId, recordId, input);
        if (!result.ok) showValidationError('Evidence not retracted', result.reason);
        else useToastStore.getState().addToast({
            type: 'success', title: 'Evidence retracted',
            message: 'The original remains in history. Prior interpretations and conclusions now need review.',
        });
    };

    const handleCorrectAssumptionEvidence = (recordId: string, input: AssumptionEvidenceCorrectionInput) => {
        if (!canWrite) return;
        const result = useProjectStore.getState().correctAssumptionEvidence(projectId, recordId, input);
        if (!result.ok) showValidationError('Evidence not corrected', result.reason);
        else useToastStore.getState().addToast({
            type: 'success', title: 'Evidence corrected',
            message: 'The replacement is current, the original remains in history, and the conclusion needs review.',
        });
    };

    const handleInterpretAssumptionEvidence = (recordId: string) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const projection = projectAssumptionValidation(record);
        if (!projection.currentPlan || projection.activeEvidence.length === 0) {
            showValidationError('Interpretation unavailable', 'Record a current validation plan and at least one evidence source first.');
            return;
        }
        const relations = new Set(projection.independentEvidence.map(item => item.relation));
        const proposal = buildAssumptionInterpretationProposal({
            record,
            reasoning: relations.has('supports') && relations.has('contradicts')
                ? 'Current independent evidence points in conflicting directions, so the assumption should remain inconclusive unless the user records a more qualified outcome.'
                : `Synapse compared ${projection.independentEvidence.length} independent source${projection.independentEvidence.length === 1 ? '' : 's'} with the validation question and excluded duplicate sources from corroboration.`,
            limitations: [
                'This interpretation summarizes user-recorded evidence relationships; it does not verify that a source is truthful or representative.',
                ...(projection.activeEvidence.some(item => item.character === 'interpretation') ? ['Some records are interpretations rather than direct observations.'] : []),
            ],
            sourceSpineVersionId: spine?.id,
            sourceSpineContentHash: spineContentHash,
            model: 'bounded-evidence-interpretation-v1',
            provider: 'synapse',
        });
        const result = state.addAssumptionInterpretationProposal(projectId, recordId, proposal);
        if (!result.ok) showValidationError('Interpretation not prepared', result.reason);
    };

    const handleRecordAssumptionOutcome = (recordId: string, input: {
        conclusion: AssumptionEvidenceConclusion;
        caveats?: string;
        revisitAt?: number;
        revisitCondition?: string;
        sourceInterpretationId?: string;
        sourceInterpretationContentHash?: string;
    }) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        if (!projection.currentPlan) return;
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_outcome_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            conclusion: input.conclusion,
            caveats: input.caveats,
            expectedValidationPlanHash: projection.currentPlan.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            sourceInterpretationId: input.sourceInterpretationId,
            sourceInterpretationContentHash: input.sourceInterpretationContentHash,
            revisitAt: input.revisitAt,
            revisitCondition: input.revisitCondition,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Conclusion not saved', result.reason);
        else useToastStore.getState().addToast({ type: 'success', title: 'Your conclusion was recorded', message: 'Synapse’s interpretation remains advisory and separate in history.' });
    };

    const handleRecordAssumptionTreatment = (recordId: string, input: {
        treatment: AssumptionUncertaintyTreatment;
        rationale: string;
        revisitAt?: number;
        revisitCondition?: string;
    }) => {
        if (!canWrite) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_uncertainty_treatment_recorded', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            treatment: input.treatment,
            rationale: input.rationale,
            revisitAt: input.revisitAt,
            revisitCondition: input.revisitCondition,
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Uncertainty treatment not saved', result.reason);
        else useToastStore.getState().addToast({ type: 'info', title: 'Unresolved uncertainty recorded', message: 'The assumption remains unvalidated.' });
    };

    const handleReopenAssumptionOutcome = (recordId: string, reason: string) => {
        if (!canWrite || !reason.trim()) return;
        const { state, record, spine, spineContentHash } = currentAssumptionContext(recordId);
        if (!record || record.type !== 'assumption') return;
        const at = Date.now();
        const projection = projectAssumptionValidation(record, at);
        if (!projection.latestOutcomeEventId || !projection.currentPlan) return;
        const event = sealAssumptionValidationEvent({
            id: uuidv4(), planningRecordId: recordId, type: 'validation_outcome_reopened', actor: 'user', at,
            assumptionStatementHash: assumptionStatementHash(record),
            expectedSpineVersionId: spine?.id,
            expectedSpineContentHash: spineContentHash,
            previousOutcomeEventId: projection.latestOutcomeEventId,
            reason: reason.trim(),
            expectedValidationPlanHash: projection.currentPlan.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        });
        const result = state.appendAssumptionValidationEvent(projectId, recordId, event);
        if (!result.ok) showValidationError('Conclusion not reopened', result.reason);
        else useToastStore.getState().addToast({ type: 'info', title: 'Conclusion reopened', message: 'The earlier outcome remains in history while this assumption returns to active review.' });
    };

    const handleDecisionAction = (recordId: string, action: import('./DecisionCenter').DecisionAction, value?: string, rationale?: string) => {
        if (!canWrite) return;
        const record = planningRecords.find(item => item.id === recordId);
        if (!record) return;
        const base = { id: uuidv4(), planningRecordId: recordId, actor: 'user' as const, at: Date.now(), rationale };
        let event: DecisionEvent;
        const projection = projectDecision(record);
        if (action === 'reopen') event = { ...base, type: 'reopened' };
        else if (action === 'defer') event = { ...base, type: 'deferred' };
        else if (action === 'reject') event = { ...base, type: 'premise_rejected', reason: value?.trim() || 'The premise is not valid.' };
        else if (action === 'invalidate') event = { ...base, type: 'invalidated', reason: value?.trim() || 'The decision is no longer valid.' };
        else if (action === 'revise' && projection.latestVerdictEventId) event = {
            ...base, type: 'revised', previousEventId: projection.latestVerdictEventId, answer: value?.trim(),
        };
        else if (action === 'confirm' && value && record.decisionOptions?.some(option => option.id === value)) {
            event = { ...base, type: 'option_selected', optionId: value };
        } else {
            event = { ...base, type: 'custom_answered', answer: value?.trim() || record.statement };
        }
        const result = useProjectStore.getState().appendPlanningDecisionEvent(projectId, recordId, event);
        if (!result.ok) useToastStore.getState().addToast({ type: 'error', title: 'Decision not saved', message: result.reason });
        else if (!['defer', 'reopen', 'invalidate'].includes(action)) {
            const impact = createImpactReview(recordId);
            if (impact && !impact.ok) useToastStore.getState().addToast({
                type: 'info', title: 'Decision saved', message: impact.reason,
            });
        }
    };

    const handlePreviewImpact = (recordId: string) => {
        if (!canWrite) return;
        const result = createImpactReview(recordId);
        if (!result) return;
        if (!result.ok) {
            useToastStore.getState().addToast({ type: 'info', title: 'Impact preview needs more context', message: result.reason });
            return;
        }
    };

    const handleAlignmentProposalReview = (
        recordId: string,
        previewId: string,
        proposalId: string,
        disposition: 'accepted' | 'rejected' | 'edited' | 'deferred' | 'confirmed_aligned' | 'confirmed_not_applicable',
        editedValue?: string,
    ) => {
        if (!canWrite) return;
        const record = useProjectStore.getState().planningRecords[projectId]?.find(item => item.id === recordId);
        const preview = record?.assessments?.find(item => item.impactPreview?.id === previewId)?.impactPreview;
        const proposal = preview?.alignmentProposals?.find(item => item.id === proposalId);
        const result = useProjectStore.getState().appendPlanningDecisionEvent(projectId, recordId, {
            id: uuidv4(), planningRecordId: recordId, type: 'alignment_change_reviewed', actor: 'user',
            impactPreviewId: previewId, proposalId, disposition, at: Date.now(),
            ...(proposal?.contract ? { proposalContentHash: alignmentProposalContentHash(proposal) } : {}),
            ...(disposition === 'edited' ? { editedValue, editedSummary: editedValue } : {}),
        });
        if (!result.ok) useToastStore.getState().addToast({ type: 'error', title: 'Alignment review not saved', message: result.reason });
    };

    const handleRequestAlignmentProposal = async (
        recordId: string,
        previewId: string,
        proposalId: string,
        request: { kind: 'missing_info' | 'different_interpretation'; guidance: string },
    ) => {
        if (!canWrite) throw new Error('This project is read-only.');
        const key = `${recordId}:${previewId}:${proposalId}`;
        setAlignmentAnalysis(current => ({ ...current, [key]: { busy: true } }));
        const fail = (message: string): never => {
            setAlignmentAnalysis(current => ({ ...current, [key]: { busy: false, error: message } }));
            throw new Error(message);
        };

        const initialState = useProjectStore.getState();
        const initialRecord = initialState.planningRecords[projectId]?.find(item => item.id === recordId);
        const initialAssessment = initialRecord?.assessments?.at(-1);
        const initialPreview = initialAssessment?.impactPreview;
        const initialSpine = initialState.spineVersions[projectId]?.find(item => item.isLatest);
        const initialProposal = initialPreview?.alignmentProposals?.find(item => item.id === proposalId);
        const recordAtStart = initialRecord ?? fail('This planning record is no longer current. Refresh the Decision Center.');
        const previewAtStart = initialPreview?.id === previewId
            ? initialPreview
            : fail('This review target is no longer current. Refresh the impact preview.');
        const proposalAtStart = initialProposal ?? fail('This review target is no longer current. Refresh the impact preview.');
        const spineAtStart = initialSpine ?? fail('The current working plan is unavailable.');
        const initialPrd = spineAtStart.structuredPRD ?? fail('The current working plan is unavailable.');
        if (isDecisionImpactStale(previewAtStart, spineAtStart.id, initialPrd)) {
            fail('The working plan changed. Refresh the impact preview before requesting wording.');
        }
        if (!COMPLEX_TARGET_KINDS.includes(proposalAtStart.target.kind as typeof COMPLEX_TARGET_KINDS[number])) {
            fail('This target needs a more precise planning location before Synapse can propose wording.');
        }
        const projection = projectDecision(recordAtStart);
        const causeEvent = recordAtStart.events?.find(event => event.id === previewAtStart.decisionEventId);
        const guidance = request.guidance.trim();
        let recordForReasoning = recordAtStart;
        let guidanceEvidenceId: string | undefined;
        if (guidance) {
            const contextEvent: Extract<DecisionEvent, { type: 'alignment_context_provided' }> = {
                id: uuidv4(), planningRecordId: recordId, type: 'alignment_context_provided', actor: 'user',
                impactPreviewId: previewId, proposalId, requestKind: request.kind, context: guidance, at: Date.now(),
            };
            const saved = useProjectStore.getState().appendPlanningDecisionEvent(projectId, recordId, contextEvent);
            if (!saved.ok) fail(`Your context could not be preserved: ${saved.reason}`);
            guidanceEvidenceId = contextEvent.id;
            recordForReasoning = useProjectStore.getState().planningRecords[projectId]?.find(item => item.id === recordId)
                ?? fail('Your context was saved, but the planning record is no longer available.');
        }
        const result = await reasonAboutComplexPlanningTargets({
            baselineSpineVersionId: spineAtStart.id,
            structuredPRD: initialPrd,
            cause: {
                id: previewAtStart.decisionEventId,
                kind: recordAtStart.sources?.some(source => source.key.startsWith('prd_edit:')) ? 'direct_edit' : 'decision',
                summary: `${recordAtStart.title}: ${recordAtStart.statement}`,
                answer: projection.answer,
                planningRecordId: recordAtStart.id,
                decisionEventId: causeEvent?.id,
                sourceSpineVersionId: spineAtStart.id,
            },
            targets: [{ id: proposalId, location: proposalAtStart.target }],
            requiredEvidenceRefIds: guidanceEvidenceId ? [guidanceEvidenceId] : undefined,
            evidence: [
                ...recordForReasoning.evidence.flatMap(evidence => evidence.excerpt ? [{
                    id: evidence.id,
                    label: evidence.locator?.section ?? 'Planning evidence',
                    sourceType: evidence.sourceType === 'spine' ? 'prd' as const : 'review' as const,
                    sourceId: evidence.sourceId,
                    sourceVersionId: evidence.sourceVersionId,
                    excerpt: evidence.excerpt,
                    location: evidence.locator?.section ? {
                        kind: evidence.locator.entityType === 'feature' ? 'feature' as const : 'claim' as const,
                        section: evidence.locator.section,
                        label: evidence.locator.entityId ?? evidence.locator.section,
                        jsonPath: evidence.locator.jsonPath,
                        entityType: evidence.locator.entityType,
                        entityId: evidence.locator.entityId,
                        excerpt: evidence.excerpt,
                    } : undefined,
                }] : []),
                ...(guidance && guidanceEvidenceId ? [{
                    id: guidanceEvidenceId,
                    label: request.kind === 'different_interpretation' ? 'Your requested interpretation' : 'Your added context',
                    sourceType: 'planning_record' as const,
                    sourceId: recordAtStart.id,
                    sourceVersionId: spineAtStart.id,
                    excerpt: guidance,
                }] : []),
            ],
        });
        const reasoning = result.ok
            ? result
            : fail(result.errors[0] ?? 'Synapse could not produce a trustworthy bounded proposal.');

        // The model call is outside the store transaction. Re-read every guard
        // before integrating so concurrent edits or verdict changes fail closed.
        const currentState = useProjectStore.getState();
        const currentRecord = currentState.planningRecords[projectId]?.find(item => item.id === recordId);
        const currentAssessment = currentRecord?.assessments?.at(-1);
        const currentPreview = currentAssessment?.impactPreview;
        const currentSpine = currentState.spineVersions[projectId]?.find(item => item.isLatest);
        const recordNow = currentRecord ?? fail('The planning record changed while Synapse was preparing this proposal. Nothing was replaced.');
        const assessmentNow = currentAssessment ?? fail('The impact assessment changed while Synapse was preparing this proposal. Nothing was replaced.');
        const previewNow = currentPreview?.id === previewId
            ? currentPreview
            : fail('The review changed while Synapse was preparing this proposal. Nothing was replaced.');
        const spineNow = currentSpine ?? fail('The working plan changed while Synapse was preparing this proposal. Nothing was replaced.');
        const currentPrd = spineNow.structuredPRD ?? fail('The working plan changed while Synapse was preparing this proposal. Nothing was replaced.');
        if (isDecisionImpactStale(previewNow, spineNow.id, currentPrd)) {
            fail('The working plan changed while Synapse was preparing this proposal. Nothing was replaced.');
        }
        const integrated = integrateComplexCandidateIntoPreview({
            preview: previewNow,
            replaceProposalId: proposalId,
            candidate: reasoning.candidates[0],
            record: recordNow,
            structuredPRD: currentPrd,
            currentSpineVersionId: spineNow.id,
            model: reasoning.model,
            provider: 'gemini',
        });
        const acceptedIntegration = integrated.ok ? integrated : fail(integrated.reason);
        currentState.addPlanningAssessment(projectId, recordId, {
            ...assessmentNow,
            impactPreview: acceptedIntegration.preview,
        });
        setAlignmentAnalysis(current => {
            const next = { ...current };
            delete next[key];
            return next;
        });
    };

    const handleApplyToPlan = (recordId: string) => {
        if (!canWrite) return;
        const state = useProjectStore.getState();
        const record = state.planningRecords[projectId]?.find(item => item.id === recordId);
        const spine = state.spineVersions[projectId]?.find(item => item.isLatest);
        const assessment = record?.assessments?.at(-1);
        const preview = assessment?.impactPreview;
        if (!record || !spine?.structuredPRD || !assessment || !preview || preview.status !== 'ready') return;
        if (isDecisionImpactStale(preview, spine.id, spine.structuredPRD)) {
            state.addPlanningAssessment(projectId, recordId, {
                ...assessment,
                status: 'stale',
                impactPreview: { ...preview, status: 'stale' },
            });
            return;
        }
        const reviewed = buildReviewedDecisionImpact({ record, preview, structuredPRD: spine.structuredPRD });
        if (reviewed.rejectedProposalIds.length > 0) {
            useToastStore.getState().addToast({
                type: 'error',
                title: 'Working plan not updated',
                message: 'One or more accepted changes no longer match the proposal you reviewed. Refresh the impact preview and review them again.',
            });
            return;
        }
        if (!reviewed.nextPrd || reviewed.acceptedProposalIds.length === 0) {
            useToastStore.getState().addToast({ type: 'info', title: 'No accepted changes', message: 'Accept or edit at least one safe proposal before updating the working plan.' });
            return;
        }
        const applied = state.compareAndAppendStructuredPRD(projectId, spine.id, reviewed.nextPrd, {
            editSummary: `Aligned PRD with decision: ${record.title}`,
            expectedPrdHash: preview.baseline.spineContentHash,
            decisionApplication: {
                planningRecordId: record.id,
                decisionEventId: preview.decisionEventId,
                impactPreviewId: preview.id,
                appliedEventId: uuidv4(),
            },
        });
        const current = useProjectStore.getState().planningRecords[projectId]?.find(item => item.id === recordId);
        const currentAssessment = current?.assessments?.find(item => item.id === assessment.id);
        if (currentAssessment) {
            useProjectStore.getState().addPlanningAssessment(projectId, recordId, {
                ...currentAssessment,
                status: applied.status === 'applied' ? 'fresh' : 'stale',
                impactPreview: {
                    ...preview,
                    status: applied.status === 'applied' ? 'applied' : 'stale',
                    ...(applied.status === 'applied' ? { appliedAt: Date.now(), resultingSpineVersionId: applied.newSpineId } : {}),
                },
            });
        }
        const residual = applied.status === 'applied' && applied.newSpineId
            ? buildResidualDecisionImpact({
                record: current ?? record,
                preview,
                structuredPRD: reviewed.nextPrd,
                baselineSpineVersionId: applied.newSpineId,
                appliedProposalIds: reviewed.acceptedProposalIds,
            })
            : undefined;
        if (residual) {
            useProjectStore.getState().addPlanningAssessment(projectId, recordId, residual.assessment);
        }
        useToastStore.getState().addToast(applied.status === 'applied'
            ? { type: 'success', title: 'Working plan updated', message: residual
                ? `${residual.preview.alignmentProposals?.length ?? 0} alignment review${residual.preview.alignmentProposals?.length === 1 ? '' : 's'} remain. Nothing else was rewritten.`
                : 'Accepted changes created a new PRD version. Nothing else was rewritten.' }
            : { type: 'info', title: 'Preview is stale', message: 'Refresh the impact preview before recording this decision in the PRD.' });
    };

    if (!project || !currentManifest) return <div className="p-6 text-sm text-neutral-500">A structured working plan is needed before Synapse can challenge it.</div>;
    return <ReviewWorkspace
        projectName={project.name}
        initialTab={initialTab}
        initialDecisionId={initialRecordId}
        initialIssueId={initialIssueId}
        initialFindingId={initialFindingId}
        recommendedPanel={panel}
        sourcesInScope={currentManifest.sources.map(source => source.label)}
        missingSources={currentManifest.missingArtifacts.map(source => source.replaceAll('_', ' '))}
        runs={runViews}
        planningRecords={planningViews}
        activeRunId={activeRunId}
        busy={busy}
        onStartReview={handleStart}
        onSelectRun={setActiveRunId}
        onCancelRun={reviewId => activeControllers.get(reviewId)?.abort()}
        onRetrySpecialist={(reviewId, specialistId) => void handleRetrySpecialist(reviewId, specialistId)}
        onRetrySynthesis={reviewId => void handleResumeReview(reviewId)}
        onActOnIssue={handleIssueAction}
        onReopenIssue={handleReopenIssue}
        onTriageFinding={handleTriageFinding}
        onConfirmPlanningRecord={recordId => {
            const record = planningRecords.find(item => item.id === recordId);
            if (record) useProjectStore.getState().updatePlanningRecordStatusByUser(projectId, recordId, record.type === 'decision' ? 'confirmed' : 'resolved');
        }}
        onReopenPlanningRecord={recordId => useProjectStore.getState().updatePlanningRecordStatusByUser(projectId, recordId, 'open')}
        onDecidePlanningRecord={handleDecisionAction}
        onPreviewPlanningRecordImpact={handlePreviewImpact}
        onApplyPlanningRecordToPlan={handleApplyToPlan}
        onReviewAlignmentProposal={handleAlignmentProposalReview}
        onRequestAlignmentProposal={handleRequestAlignmentProposal}
        onGenerateAssumptionValidationPlan={handleGenerateAssumptionValidationPlan}
        onRecordAssumptionValidationPlan={handleRecordAssumptionValidationPlan}
        onAddAssumptionEvidence={handleAddAssumptionEvidence}
        onCorrectAssumptionEvidence={handleCorrectAssumptionEvidence}
        onRetractAssumptionEvidence={handleRetractAssumptionEvidence}
        onInterpretAssumptionEvidence={handleInterpretAssumptionEvidence}
        onRecordAssumptionOutcome={handleRecordAssumptionOutcome}
        onRecordAssumptionTreatment={handleRecordAssumptionTreatment}
        onReopenAssumptionOutcome={handleReopenAssumptionOutcome}
        readOnly={!canPerformProjectAction(projectId, 'persist')}
    />;
}
