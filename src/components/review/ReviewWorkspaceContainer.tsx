import { useMemo, useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import type {
    PlanningRecord,
    ReviewEvidenceRef,
    ReviewIssue,
    ReviewIssueDisposition,
    SpecialistFinding,
    SpecialistFindingKind,
} from '../../types';
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
import {
    ReviewWorkspace,
    type PlanningRecordView,
    type ReviewIssueAction,
    type ReviewIssueView,
    type ReviewRunView,
    type ReviewSpecialistOption,
} from './ReviewWorkspace';

interface Props {
    projectId: string;
}

const activeControllers = new Map<string, AbortController>();

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

const DISPOSITION_BY_ACTION: Record<ReviewIssueAction, ReviewIssueDisposition['action']> = {
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

const dispositionForAction = (action: ReviewIssueAction): ReviewIssueDisposition['action'] => DISPOSITION_BY_ACTION[action];

export function ReviewWorkspaceContainer({ projectId }: Props) {
    const project = useProjectStore(state => state.projects[projectId]);
    const spines = useProjectStore(state => state.spineVersions[projectId] ?? []);
    const artifacts = useProjectStore(state => state.artifacts[projectId] ?? []);
    const artifactVersions = useProjectStore(state => state.artifactVersions[projectId] ?? []);
    const reviewRuns = useProjectStore(state => state.reviewRuns[projectId] ?? []);
    const specialistRuns = useProjectStore(state => state.specialistRuns[projectId] ?? []);
    const findings = useProjectStore(state => state.reviewFindings[projectId] ?? []);
    const issues = useProjectStore(state => state.reviewIssues[projectId] ?? []);
    const planningRecords = useProjectStore(state => state.planningRecords[projectId] ?? []);
    const [activeRunId, setActiveRunId] = useState<string>();
    const [busy, setBusy] = useState(false);
    const manifests = useRef(new Map<string, ReviewContextManifest>());

    const latestSpine = spines.find(spine => spine.isLatest) ?? spines.at(-1);
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
        if ((state.reviewFindings[projectId] ?? []).some(existing => existing.id === finding.id && existing.reviewId === reviewId)) return;
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
            id: finding.id,
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
        if ((useProjectStore.getState().reviewIssues[projectId] ?? []).some(existing => existing.id === cluster.id && existing.reviewId === reviewId)) return;
        const lead = allFindings.find(finding => cluster.findingIds.includes(finding.id));
        if (!lead) return;
        const issue: Omit<ReviewIssue, 'id' | 'projectId' | 'status' | 'dispositions' | 'createdAt' | 'updatedAt'> & { id: string } = {
            id: cluster.id,
            reviewId,
            title: cluster.title,
            summary: lead.observation,
            kind: lead.type as SpecialistFindingKind,
            findingIds: cluster.findingIds,
            specialistIds: cluster.specialistIds,
            relationship: cluster.consensus === 'single' ? 'standalone' : cluster.consensus,
            perspectives: cluster.perspectives.map(perspective => ({
                findingIds: [perspective.findingId],
                recommendation: perspective.recommendation,
            })),
            severity: cluster.severity,
            confidence: lead.confidence,
            implementationImpact: lead.implementationBlocking ? 'blocker' : lead.canDefer ? 'deferrable' : 'resolve_before_build',
            relatedPlanningRecordIds: [],
        };
        useProjectStore.getState().addReviewIssue(projectId, issue);
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
        for (const finding of result.findings) persistFinding(reviewId, run.id, finding);
        state.updateSpecialistRun(projectId, run.id, {
            status: result.status === 'complete' ? 'complete' : result.status,
            attemptCount: result.attempts,
            completedAt: Date.now(),
            validation: {
                valid: result.findings.every(finding => finding.grounded),
                unsupportedEvidenceIds: result.findings.flatMap(finding => finding.evidence.filter(item => !item.verified).map(item => item.locatorId)),
                warnings: result.findings.flatMap(finding => finding.validationWarnings),
            },
            error: result.error ? { message: result.error } : undefined,
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
            for (const cluster of clusterGroundedFindings(allFindings)) persistCluster(reviewId, cluster, allFindings);
            state.updateReviewRun(projectId, reviewId, {
                status: result.status === 'partial' ? 'partial' : 'complete',
                synthesisStatus: 'complete',
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
        if (!currentManifest || busy) return;
        setBusy(true);
        const selected = specialistIds.filter((id): id is ReviewSpecialistId => id in SPECIALIST_REGISTRY);
        const state = useProjectStore.getState();
        const { reviewId } = state.createReviewRun(projectId, {
            scope: { kind: focus ? 'focus' : 'project', focus },
            sourceManifest: toPersistedReviewContextManifest(currentManifest),
            selectedSpecialists: selected.map(id => ({ specialistId: id, label: SPECIALIST_REGISTRY[id].label, reason: panel.find(option => option.id === id)?.selectionReason ?? 'Selected by the user.' })),
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
            });
        }
        setActiveRunId(reviewId);
        await executeReview(reviewId, currentManifest, selected, focus);
    };

    const handleRetrySpecialist = async (reviewId: string, specialistId: string) => {
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
            for (const cluster of clusterGroundedFindings(allFindings)) persistCluster(reviewId, cluster, allFindings);
            useProjectStore.getState().updateReviewRun(projectId, reviewId, { status: 'complete', synthesisStatus: 'complete', completedAt: Date.now() });
            return;
        }
        setBusy(true);
        await executeReview(reviewId, manifest, incomplete, run.scope.focus);
    };

    const handleIssueAction = (reviewId: string, issueId: string, action: ReviewIssueAction, note?: string, planningRecordId?: string) => {
        const state = useProjectStore.getState();
        const issue = (state.reviewIssues[projectId] ?? []).find(item => item.id === issueId);
        const run = (state.reviewRuns[projectId] ?? []).find(item => item.id === reviewId);
        if (!issue || !run) return;
        let recordId = planningRecordId;
        const recordType = recordTypeForAction(action);
        if (recordType) {
            const sourceFindings = (state.reviewFindings[projectId] ?? []).filter(finding => issue.findingIds.includes(finding.id));
            recordId = state.createPlanningRecord(projectId, {
                type: recordType,
                status: recordType === 'decision' ? 'proposed' : 'open',
                title: issue.title,
                statement: note?.trim() || issue.summary,
                recommendation: sourceFindings.find(finding => finding.recommendedAction)?.recommendedAction,
                evidence: sourceFindings.flatMap(finding => finding.evidence),
                sourceFindingIds: issue.findingIds,
                sourceReviewIssueId: issue.id,
                createdBy: 'specialist_review',
            }).planningRecordId;
        }
        state.applyReviewIssueDisposition(projectId, issueId, {
            action: dispositionForAction(action),
            contextSignature: run.sourceManifest.contextSignature,
            reason: note?.trim() || undefined,
            planningRecordId: recordId,
        });
    };

    const issueViews = (reviewId: string): ReviewIssueView[] => issues.filter(issue => issue.reviewId === reviewId).map(issue => {
        const sourceFindings = findings.filter(finding => issue.findingIds.includes(finding.id));
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
        };
    });

    const runViews: ReviewRunView[] = reviewRuns.slice().reverse().map(run => ({
        id: run.id,
        label: `Review ${run.sequenceNumber}`,
        sourceLabel: `PRD version ${spines.findIndex(spine => spine.id === run.sourceManifest.spineVersionId) + 1 || run.sourceManifest.spineVersionId}`,
        capturedAt: run.sourceManifest.capturedAt,
        status: runStatus(run.status),
        focus: run.scope.focus,
        contextChanged: currentManifest?.contextSignature !== run.sourceManifest.contextSignature,
        specialists: specialistRuns.filter(item => item.reviewId === run.id).map(item => ({
            id: item.specialistId,
            name: SPECIALIST_REGISTRY[item.specialistId as ReviewSpecialistId]?.label ?? item.specialistId,
            responsibility: item.responsibility,
            selectionReason: run.selectedSpecialists.find(selected => selected.specialistId === item.specialistId)?.reason ?? '',
            status: specialistStatus(item.status),
            findingCount: item.findingIds.length,
            error: item.error?.message,
        })),
        issues: issueViews(run.id),
    }));

    const planningViews: PlanningRecordView[] = planningRecords.map(record => ({
        id: record.id,
        type: record.type === 'open_question' ? 'question' : record.type,
        title: record.title,
        status: record.status === 'rejected' || record.status === 'deferred' || record.status === 'superseded' || record.status === 'invalidated'
            ? 'dismissed'
            : record.status,
        description: record.statement,
        sourceIssueIds: record.sourceReviewIssueId ? [record.sourceReviewIssueId] : [],
        createdAt: record.createdAt,
    }));

    if (!project || !currentManifest) return <div className="p-6 text-sm text-neutral-500">Finalize a structured PRD before starting a specialist review.</div>;
    return <ReviewWorkspace
        projectName={project.name}
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
        onConfirmPlanningRecord={recordId => {
            const record = planningRecords.find(item => item.id === recordId);
            if (record) useProjectStore.getState().updatePlanningRecordStatusByUser(projectId, recordId, record.type === 'decision' ? 'confirmed' : 'resolved');
        }}
        onReopenPlanningRecord={recordId => useProjectStore.getState().updatePlanningRecordStatusByUser(projectId, recordId, 'open')}
    />;
}
