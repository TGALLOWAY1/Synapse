import type {
    Project, SpineVersion, HistoryEvent, Branch, StructuredPRD,
    PipelineStage, ProjectPlatform,
    Artifact, ArtifactVersion, ArtifactType, CoreArtifactSubtype,
    SourceRef, FeedbackItem, FeedbackType, FeedbackStatus,
    ArtifactSlotKey, ProjectJobState, SlotState,
    GenerationMeta, SpineSafetyReview,
    PreflightMode, PreflightQuestion,
    ProjectTask, TaskStatus, TaskExternalRef,
    WorkflowRun, VersionProvenance,
    ReviewRun, SpecialistRun, SpecialistFinding, ReviewIssue,
    ReviewIssueDisposition, PlanningRecord, PlanningRecordStatus,
    DecisionEvent, DecisionAssessment,
    AssumptionEvidenceRecord, AssumptionEvidenceSourceType,
    AssumptionValidationEvent, AssumptionValidationPlanProposal, AssumptionInterpretationProposal,
    ReadinessReview, ReadinessCommitmentEvent,
} from '../types';
import type { ImplementationTask } from '../types/tasks';
import type { SectionId } from '../lib/schemas/prdSchemas';
import type { PrdSectionStatusEntry } from './slices/prdProgressSlice';
import type { OutputAlignment, ProjectOutputAlignmentSummary } from '../lib/planning/outputAlignment';
import type {
    DownstreamUpdateDisposition,
    DownstreamUpdatePlan,
    DownstreamUpdatePlanCurrentness,
    DownstreamUpdatePlanEvent,
    DownstreamUpdatePlanSummary,
} from '../lib/planning/downstreamUpdatePlan';
import type {
    DownstreamArtifactUpdateApplication,
    DownstreamArtifactUpdateProposal,
    DownstreamArtifactUpdateProposalCurrentness,
    DownstreamArtifactUpdateReviewEvent,
    DownstreamArtifactUpdateVerification,
    DownstreamArtifactUpdateVerificationEvent,
    DownstreamArtifactUpdateOperation,
} from '../lib/planning/downstreamArtifactUpdateProposal';

export interface SpineGenerationMetaInput {
    sourcePrompt?: string;
    generationMeta?: GenerationMeta;
    model?: string;
    prdVersion?: number;
}

export type CompareAndAppendStructuredPRDResult =
    | { status: 'applied'; newSpineId: string }
    | {
        status: 'stale';
        expectedLatestSpineId: string;
        actualLatestSpineId?: string;
        reason?: 'spine_changed' | 'content_changed' | 'decision_changed';
    };

export type EditSpineStructuredPRDResult = {
    newSpineId: string;
    /** Present only when a user-authored content edit ran the bounded
     * consequential-edit recognizer. */
    recognition?: import('../lib/planning/consequentialEditRecognition').ConsequentialPrdEditRecognition;
};

export type ReadinessMutationFailureReason =
    | 'project_not_found'
    | 'review_not_found'
    | 'authorization_not_found'
    | 'authorization_consumed'
    | 'commitment_not_found'
    | 'stale'
    | 'tampered'
    | 'hash_mismatch'
    | 'accepted_concerns_mismatch'
    | 'rationale_required'
    | 'containment_required'
    | 'safety_blocked'
    | 'already_committed'
    | 'not_committed';

export type CreateReadinessReviewResult =
    | { status: 'created'; reviewId: string; review: ReadinessReview }
    | { status: 'rejected'; reason: 'project_not_found' | 'safety_blocked' | 'stale' };

export type AuthorizeReadinessCommitmentResult =
    | { status: 'authorized'; authorizationEventId: string }
    | { status: 'rejected'; reason: ReadinessMutationFailureReason };

export type CommitReadinessReviewResult =
    | { status: 'committed'; commitmentEventId: string }
    | { status: 'rejected'; reason: ReadinessMutationFailureReason };

export type ReopenReadinessCommitmentResult =
    | { status: 'reopened'; reopenEventId: string }
    | { status: 'rejected'; reason: ReadinessMutationFailureReason };

export type AssumptionEvidenceMutationGuard = {
    evidenceId: string;
    expectedEvidenceContentHash: string;
    expectedEvidenceSetHash: string;
    expectedSpineVersionId: string;
    expectedSpineContentHash: string;
    reason: string;
};

export type AssumptionEvidenceReplacementInput = {
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

export type AssumptionEvidenceCorrectionInput = AssumptionEvidenceMutationGuard & {
    replacement: AssumptionEvidenceReplacementInput;
};

export type AssumptionEvidenceMutationResult =
    | { ok: true; evidenceId?: string; eventIds: string[] }
    | { ok: false; reason: string };

export interface ProjectState {
    projects: Record<string, Project>;
    spineVersions: Record<string, SpineVersion[]>;
    historyEvents: Record<string, HistoryEvent[]>;
    branches: Record<string, Branch[]>;

    // Artifact system
    artifacts: Record<string, Artifact[]>;
    artifactVersions: Record<string, ArtifactVersion[]>;
    feedbackItems: Record<string, FeedbackItem[]>;

    // Durable adversarial reviews and Decision Center records. These are
    // persisted independently so partial specialist success survives failure.
    reviewRuns: Record<string, ReviewRun[]>;
    specialistRuns: Record<string, SpecialistRun[]>;
    reviewFindings: Record<string, SpecialistFinding[]>;
    reviewIssues: Record<string, ReviewIssue[]>;
    planningRecords: Record<string, PlanningRecord[]>;
    readinessReviews: Record<string, ReadinessReview[]>;
    readinessCommitmentEvents: Record<string, ReadinessCommitmentEvent[]>;
    downstreamUpdatePlans: Record<string, DownstreamUpdatePlan[]>;
    downstreamUpdatePlanEvents: Record<string, DownstreamUpdatePlanEvent[]>;
    downstreamArtifactUpdateProposals: Record<string, DownstreamArtifactUpdateProposal[]>;
    downstreamArtifactUpdateReviewEvents: Record<string, DownstreamArtifactUpdateReviewEvent[]>;
    downstreamArtifactUpdateApplications: Record<string, DownstreamArtifactUpdateApplication[]>;
    downstreamArtifactUpdateVerifications: Record<string, DownstreamArtifactUpdateVerification[]>;
    downstreamArtifactUpdateVerificationEvents: Record<string, DownstreamArtifactUpdateVerificationEvent[]>;

    // Persisted implementation tasks, keyed by projectId.
    tasks: Record<string, ProjectTask[]>;

    // Existing actions
    createProject: (name: string, promptText: string, platform?: ProjectPlatform) => { projectId: string, spineId: string };
    updateSpineText: (projectId: string, spineId: string, text: string) => void;
    regenerateSpine: (projectId: string) => { newSpineId: string };
    markSpineFinal: (projectId: string, spineId: string, isFinal: boolean) => void;
    createBranch: (projectId: string, spineVersionId: string, anchorText: string, initialIntent: string) => { branchId: string };
    addBranchMessage: (projectId: string, branchId: string, role: 'user' | 'assistant', content: string) => void;
    mergeBranch: (projectId: string, branchId: string, newSpineText: string) => { newSpineId: string };
    deleteProject: (projectId: string) => void;
    deleteBranch: (projectId: string, branchId: string) => void;
    getProject: (projectId: string) => Project | undefined;
    getSpineVersions: (projectId: string) => SpineVersion[];
    getLatestSpine: (projectId: string) => SpineVersion | undefined;
    getHistoryEvents: (projectId: string) => HistoryEvent[];
    getBranchesForSpine: (projectId: string, spineVersionId: string) => Branch[];

    // Pipeline stage
    setProjectStage: (projectId: string, stage: PipelineStage) => void;

    // Stores the chosen design-system preset id (see DESIGN_SYSTEM_PRESETS).
    // Also clears `needsDesignSetup` — a chosen preset settles the setup step
    // regardless of which UI it was picked from.
    setProjectDesignSystemPreset: (projectId: string, presetId: string) => void;

    // Dismisses the setup-stage design selection step without choosing a
    // preset ("decide later") — the Mark-as-Final gate still asks before
    // assets generate.
    markDesignSetupComplete: (projectId: string) => void;

    // Demo project hydration. Returns the stable DEMO_PROJECT_ID and whether
    // a demo snapshot was available. When `available` is false, the home
    // page surfaces a friendly "no demo set" message.
    loadDemoProject: (options?: { force?: boolean }) => Promise<{ projectId: string; available: boolean }>;
    clearDemoProject: () => Promise<void>;

    // SYN-001: deterministic "Reset Demo" — wipes every local trace of the
    // demo project (all nine project-keyed store maps, transient job/
    // progress state, and the three IDB image stores + their reactive
    // caches) and falls through to `loadDemoProject()` for a full re-fetch +
    // restore from the pinned snapshot. Route/store-owned like
    // `loadDemoProject`; deliberately bypasses the read-only capability
    // guards rather than extending them. Operates only on DEMO_PROJECT_ID —
    // no projectId param.
    resetDemoProject: () => Promise<{ projectId: string; available: boolean }>;

    // Structured PRD
    updateStructuredPRD: (projectId: string, spineId: string, structuredPRD: StructuredPRD) => void;
    updateSpineStructuredPRD: (
        projectId: string,
        spineId: string,
        structuredPRD: StructuredPRD,
        responseText: string,
        meta?: SpineGenerationMetaInput,
    ) => void;
    // Versioning: append a NEW spine version from an edited structuredPRD
    // (clones the source spine, applies the edit, becomes the new isLatest)
    // instead of mutating in place — preserves history. Used for all user
    // edits and single-section retries. `meta` overrides carry forward
    // generation metadata (e.g. failedSections) onto the new version.
    editSpineStructuredPRD: (
        projectId: string,
        spineId: string,
        nextStructuredPRD: StructuredPRD,
        opts?: {
            responseText?: string;
            editSummary?: string;
            changeSource?: import('../types').VersionChangeSource;
            meta?: SpineGenerationMetaInput;
            /** Machine-generated merges can opt out even when they share the
             * user-edit append path. */
            recognizeConsequentialEdit?: boolean;
            // Per-edit decision tally delta (Decisions-tab confirm/reject/undo).
            // Merged into the version's provenance.decisionCounts; drives the
            // in-place amend coalescing when changeSource === 'decision_edit'.
            decisionDelta?: Partial<{ confirmed: number; corrected: number; reopened: number }>;
        },
    ) => EditSpineStructuredPRDResult;
    // Guarded append for changes prepared against a known PRD baseline (for
    // example, a future Decision Center impact preview). The latest-version
    // comparison and append happen in the same Zustand transaction.
    compareAndAppendStructuredPRD: (
        projectId: string,
        expectedLatestSpineId: string,
        nextStructuredPRD: StructuredPRD,
        opts?: {
            editSummary?: string;
            changeSource?: import('../types').VersionChangeSource;
            meta?: SpineGenerationMetaInput;
            expectedPrdHash?: string;
            decisionApplication?: {
                planningRecordId: string;
                decisionEventId: string;
                impactPreviewId: string;
                appliedEventId: string;
            };
        },
    ) => CompareAndAppendStructuredPRDResult;
    // Versioning: restore a historical spine by appending a new latest version
    // cloning its content. Never mutates or deletes the source version.
    revertSpineToVersion: (projectId: string, sourceSpineId: string) => { newSpineId: string };
    updateProjectProductMetadata: (
        projectId: string,
        meta: { productName?: string; productCategory?: string },
    ) => void;

    // Generation lifecycle. Stamps generationPhase: 'running' when a PRD run
    // actually begins; the settle paths (updateSpineStructuredPRD with
    // generationMeta, setSpineError, blocked setSpineSafetyReview) flip it to
    // 'complete'. Rehydration converts still-'running' spines into an
    // interrupted-generation error (see markInterruptedGenerations).
    markSpineGenerationStarted: (projectId: string, spineId: string) => void;

    // Error handling
    setSpineError: (projectId: string, spineId: string, error: { message: string; category: string; timestamp: number; raw?: string } | null) => void;

    // Safety guardrail. Persists the pre-generation verdict on a spine. When
    // `responseText` is provided (blocked case) it replaces the spine's text
    // with the Safety Review document and clears any "Generating PRD..." stub.
    setSpineSafetyReview: (
        projectId: string,
        spineId: string,
        review: SpineSafetyReview,
        responseText?: string,
    ) => void;

    // --- Preflight clarification (persisted on the spine; resumable) ---
    initPreflightSession: (projectId: string, spineId: string, mode: PreflightMode, originalIdea: string) => void;
    setPreflightQuestions: (projectId: string, spineId: string, questions: PreflightQuestion[], usedFallback?: boolean) => void;
    setPreflightAnswer: (projectId: string, spineId: string, questionId: string, answer: string, skipped: boolean) => void;
    setPreflightIndex: (projectId: string, spineId: string, index: number) => void;
    setPreflightSummary: (projectId: string, spineId: string, summary: { summary: string; assumptions: string[]; unknowns: string[] }) => void;
    completePreflightSession: (projectId: string, spineId: string) => void;
    setPreflightError: (projectId: string, spineId: string, message: string | null) => void;

    // --- Artifact System Actions ---
    createArtifact: (projectId: string, type: ArtifactType, title: string, subtype?: CoreArtifactSubtype) => { artifactId: string };
    updateArtifact: (projectId: string, artifactId: string, updates: Partial<Pick<Artifact, 'title' | 'status'>>) => void;
    deleteArtifact: (projectId: string, artifactId: string) => void;
    getArtifacts: (projectId: string, type?: ArtifactType) => Artifact[];
    getArtifact: (projectId: string, artifactId: string) => Artifact | undefined;

    // ArtifactVersion actions
    createArtifactVersion: (
        projectId: string,
        artifactId: string,
        content: string,
        metadata: Record<string, unknown>,
        sourceRefs: SourceRef[],
        generationPrompt: string,
        parentVersionId?: string | null,
        // Optional attribution override; defaults to ai_generation /
        // ai_regeneration by version number.
        provenance?: VersionProvenance,
    ) => { versionId: string };
    setPreferredVersion: (projectId: string, artifactId: string, versionId: string) => void;
    // Versioning: restore a historical artifact version by appending a cloned
    // ArtifactVersion (increments versionNumber, becomes preferred) rather than
    // only re-pointing isPreferred — keeps the audit log honest.
    revertArtifactToVersion: (projectId: string, artifactId: string, sourceVersionId: string) => { versionId: string };
    // Versioning: user asserts the preferred version is still current for a
    // newer spine — appends a cloned version whose sourceRefs are rebased onto
    // the given spine version and each dependency's current preferred version.
    markArtifactCurrentForSpine: (projectId: string, artifactId: string, spineVersionId: string) => { versionId: string };
    getArtifactVersions: (projectId: string, artifactId: string) => ArtifactVersion[];
    getPreferredVersion: (projectId: string, artifactId: string) => ArtifactVersion | undefined;
    getLatestArtifactVersion: (projectId: string, artifactId: string) => ArtifactVersion | undefined;
    updateArtifactVersionMetadata: (
        projectId: string,
        artifactId: string,
        versionId: string,
        patch: Record<string, unknown>,
        // When the patch is a user-authored overlay edit (screenEdits /
        // promptEdits), pass a description so an 'Edited' history event is
        // recorded; plumbing patches omit it and stay silent.
        opts?: { historyDescription?: string },
    ) => void;

    // Feedback actions
    createFeedbackItem: (
        projectId: string,
        sourceArtifactVersionId: string,
        type: FeedbackType,
        title: string,
        description: string,
        targetArtifactType: ArtifactType
    ) => { feedbackId: string };
    updateFeedbackStatus: (projectId: string, feedbackId: string, status: FeedbackStatus) => void;
    getFeedbackItems: (projectId: string, status?: FeedbackStatus) => FeedbackItem[];

    // Adversarial planning review + Decision Center actions.
    createReviewRun: (
        projectId: string,
        input: Omit<ReviewRun, 'id' | 'projectId' | 'sequenceNumber' | 'status' | 'synthesisStatus' | 'createdAt'>,
    ) => { reviewId: string };
    updateReviewRun: (
        projectId: string,
        reviewId: string,
        patch: Partial<Pick<ReviewRun, 'status' | 'synthesisStatus' | 'startedAt' | 'completedAt'>>,
    ) => void;
    createSpecialistRun: (
        projectId: string,
        input: Omit<SpecialistRun, 'id' | 'projectId' | 'status' | 'attemptCount' | 'findingIds' | 'createdAt'>,
    ) => { specialistRunId: string };
    updateSpecialistRun: (
        projectId: string,
        specialistRunId: string,
        patch: Partial<Omit<SpecialistRun, 'id' | 'projectId' | 'reviewId' | 'specialistId' | 'createdAt'>>,
    ) => void;
    addReviewFinding: (
        projectId: string,
        finding: Omit<SpecialistFinding, 'id' | 'projectId'> & { id?: string },
    ) => { findingId: string };
    addReviewIssue: (
        projectId: string,
        issue: Omit<ReviewIssue, 'id' | 'projectId' | 'status' | 'dispositions' | 'createdAt' | 'updatedAt'>
            & { id?: string; createdAt?: number },
    ) => { issueId: string };
    supersedeOpenReviewIssues: (projectId: string, reviewId: string, retainedIssueIds: string[]) => void;
    applyReviewIssueDisposition: (
        projectId: string,
        reviewId: string,
        issueId: string,
        disposition: Omit<ReviewIssueDisposition, 'actor' | 'at' | 'action'> & {
            action: Exclude<ReviewIssueDisposition['action'], 'reopen'>;
            at?: number;
        },
    ) => void;
    reopenReviewIssue: (
        projectId: string,
        reviewId: string,
        issueId: string,
        input: import('../lib/review').ReviewIssueRecoveryGuard & { at?: number },
    ) => { ok: true } | { ok: false; reason: string };
    createPlanningRecord: (
        projectId: string,
        input: Omit<PlanningRecord, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
    ) => { planningRecordId: string };
    /** Stores machine-suggested alternatives for an unresolved decision or
     * open question. Advisory only — refused once a user verdict exists. */
    setPlanningRecordDecisionOptions: (
        projectId: string,
        planningRecordId: string,
        input: {
            options: import('../types').PlanningDecisionOption[];
            recommendation?: import('../types').PlanningRecommendation;
            provenance?: PlanningRecord['decisionOptionsProvenance'];
        },
    ) => { ok: true } | { ok: false; reason: string };
    updatePlanningRecordStatusByUser: (
        projectId: string,
        planningRecordId: string,
        status: PlanningRecordStatus,
        patch?: Partial<Pick<PlanningRecord, 'resolution' | 'rationale' | 'resultingSpineVersionId' | 'supersedesId'>>,
    ) => void;
    appendPlanningDecisionEvent: (
        projectId: string,
        planningRecordId: string,
        event: DecisionEvent,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };
    importPlanningAssumptions: (
        projectId: string,
        sourceSpineVersionId: string,
        structuredPRD: StructuredPRD,
        preflightSession?: import('../types').PreflightSession,
    ) => { imported: number; existing: number };
    addPlanningAssessment: (
        projectId: string,
        planningRecordId: string,
        assessment: DecisionAssessment,
    ) => void;
    appendAssumptionValidationEvent: (
        projectId: string,
        planningRecordId: string,
        event: AssumptionValidationEvent,
    ) => { ok: true; duplicate: boolean; duplicateEvidenceOf?: string } | { ok: false; reason: string };
    retractAssumptionEvidence: (
        projectId: string,
        planningRecordId: string,
        input: AssumptionEvidenceMutationGuard,
    ) => AssumptionEvidenceMutationResult;
    correctAssumptionEvidence: (
        projectId: string,
        planningRecordId: string,
        input: AssumptionEvidenceCorrectionInput,
    ) => AssumptionEvidenceMutationResult;
    addAssumptionValidationPlanProposal: (
        projectId: string,
        planningRecordId: string,
        proposal: AssumptionValidationPlanProposal,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };
    addAssumptionInterpretationProposal: (
        projectId: string,
        planningRecordId: string,
        proposal: AssumptionInterpretationProposal,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };

    // Durable readiness checkpoints. Reviews are immutable snapshots; user
    // authority is recorded separately as append-only commitment events.
    createReadinessReview: (projectId: string) => CreateReadinessReviewResult;
    authorizeReadinessCommitment: (
        projectId: string,
        reviewId: string,
        input: {
            expectedIntegrityHash: string;
            expectedAggregateHash: string;
            acceptedConcernIds: string[];
            rationale?: string;
            containmentPlan?: string;
        },
    ) => AuthorizeReadinessCommitmentResult;
    commitReadinessReview: (
        projectId: string,
        reviewId: string,
        authorizationEventId: string,
    ) => CommitReadinessReviewResult;
    reopenReadinessCommitment: (
        projectId: string,
        commitmentEventId: string,
        reason?: string,
    ) => ReopenReadinessCommitmentResult;

    // Immutable, version-bound downstream update plans. Generated snapshots
    // carry no user authority; review choices are separate append-only events.
    recordDownstreamUpdatePlan: (
        projectId: string,
        plan: DownstreamUpdatePlan,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };
    generateDownstreamUpdatePlans: (
        projectId: string,
    ) => { status: 'generated'; planIds: string[]; created: number } | { status: 'rejected'; reason: string };
    appendDownstreamUpdatePlanEvent: (
        projectId: string,
        planId: string,
        itemId: string,
        input: { type: 'disposition_recorded'; disposition: DownstreamUpdateDisposition; rationale?: string; at?: number }
            | { type: 'priority_changed'; priority: number; at?: number },
    ) => { ok: true; eventId: string; duplicate: boolean } | { ok: false; reason: string };
    getDownstreamUpdatePlanCurrentness: (
        projectId: string,
        planId: string,
    ) => DownstreamUpdatePlanCurrentness | undefined;
    getDownstreamUpdatePlanSummary: (projectId: string) => DownstreamUpdatePlanSummary;

    // Phase 5 proposal foundation extends one exact update-plan item. Generated
    // proposals and verifications are advisory; user authority is append-only.
    recordDownstreamArtifactUpdateProposal: (
        projectId: string,
        proposal: DownstreamArtifactUpdateProposal,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };
    generateDownstreamArtifactUpdateProposal: (
        projectId: string,
        planId: string,
        itemId: string,
    ) => { status: 'generated'; proposalId: string; operation: DownstreamArtifactUpdateOperation }
        | { status: 'rejected'; reason: string };
    appendDownstreamArtifactUpdateReviewEvent: (
        projectId: string,
        proposalId: string,
        input:
            | { action: 'accepted'; rationale?: string; at?: number }
            | { action: 'edited'; operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>; editedContent: string | null; rationale: string; at?: number }
            | { action: 'rejected' | 'preserved' | 'deferred' | 'requested_another'; rationale: string; at?: number }
            | { action: 'provided_context'; context: string; at?: number },
    ) => { ok: true; eventId: string; duplicate: boolean } | { ok: false; reason: string };
    recordDownstreamArtifactUpdateApplication: (
        projectId: string,
        application: DownstreamArtifactUpdateApplication,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };
    applyDownstreamArtifactUpdateProposal: (
        projectId: string,
        proposalId: string,
    ) => { status: 'applied'; applicationId: string; artifactVersionId: string }
        | { status: 'rejected'; reason: string };
    recordDownstreamArtifactUpdateVerification: (
        projectId: string,
        verification: DownstreamArtifactUpdateVerification,
    ) => { ok: true; duplicate: boolean } | { ok: false; reason: string };
    verifyDownstreamArtifactUpdateItem: (
        projectId: string,
        planId: string,
        itemId: string,
    ) => { status: 'verified'; verificationId: string; result: DownstreamArtifactUpdateVerification['result'] }
        | { status: 'rejected'; reason: string };
    appendDownstreamArtifactUpdateVerificationEvent: (
        projectId: string,
        verificationId: string,
        input: {
            action: 'confirmed' | 'rejected' | 'deferred' | 'requested_another' | 'provided_context';
            rationale?: string;
            context?: string;
            at?: number;
        },
    ) => { ok: true; eventId: string; duplicate: boolean } | { ok: false; reason: string };
    getDownstreamArtifactUpdateProposalCurrentness: (
        projectId: string,
        proposalId: string,
    ) => DownstreamArtifactUpdateProposalCurrentness | undefined;

    // Implementation task tracking. `saveTasks` persists an extracted set for a
    // given Implementation Plan artifact, replacing any prior set for that
    // artifact while preserving status/externalRefs of tasks whose id still
    // exists (so re-saving after an edit never loses progress).
    saveTasks: (
        projectId: string,
        sourceArtifactId: string,
        tasks: ImplementationTask[],
        sourceSpineVersionId?: string,
    ) => { saved: number };
    setTaskStatus: (projectId: string, taskId: string, status: TaskStatus) => void;
    removeProjectTask: (projectId: string, taskId: string) => void;
    /** Attach external refs (e.g. created GitHub issues) to saved tasks. */
    recordTaskExports: (
        projectId: string,
        refs: Array<{ taskId: string; ref: TaskExternalRef }>,
    ) => void;
    getTasks: (projectId: string) => ProjectTask[];
    getTasksForArtifact: (projectId: string, sourceArtifactId: string) => ProjectTask[];

    // Orchestration metrics — persisted WorkflowRun history keyed by projectId.
    // Records what the concurrent DAG executor actually achieved per run
    // (runtime, speedup, concurrency, tokens, cost) for the Metrics dashboard.
    workflowRuns: Record<string, WorkflowRun[]>;
    recordWorkflowRun: (run: WorkflowRun) => void;
    getWorkflowRuns: (projectId: string) => WorkflowRun[];
    getAllWorkflowRuns: () => WorkflowRun[];
    clearWorkflowRuns: (projectId: string) => void;

    // Derived output-alignment projection (read-side only; lives on the
    // downstream update plan slice).
    getArtifactAlignment: (projectId: string, artifactId: string) => OutputAlignment | undefined;
    getProjectOutputAlignment: (projectId: string) => ProjectOutputAlignmentSummary;


    // Background generation jobs (transient — excluded from persist)
    jobs: Record<string, ProjectJobState | undefined>;
    initJob: (projectId: string, spineVersionId: string, slotKeys: ArtifactSlotKey[]) => void;
    setSlotStatus: (projectId: string, slot: ArtifactSlotKey, partial: Partial<SlotState>) => void;
    appendSlotProgress: (projectId: string, slot: ArtifactSlotKey, message: string) => void;
    clearJob: (projectId: string) => void;
    getSlot: (projectId: string, slot: ArtifactSlotKey) => SlotState | undefined;
    getJob: (projectId: string) => ProjectJobState | undefined;
    markAllInterrupted: (projectId: string) => void;

    // PRD generation progress (transient — excluded from persist)
    prdProgress: Record<string, { messages: string[]; updatedAt: number } | undefined>;
    appendPrdProgress: (projectId: string, message: string) => void;
    clearPrdProgress: (projectId: string) => void;
    getPrdProgress: (projectId: string) => { messages: string[]; updatedAt: number } | undefined;

    // Per-section generation status grid (transient — excluded from persist).
    // Shape is the canonical PrdSectionStatusEntry from the slice.
    prdSectionStatus: Record<string, Record<SectionId, PrdSectionStatusEntry> | undefined>;
    setSectionStatus: (projectId: string, sectionId: SectionId, update: Partial<PrdSectionStatusEntry>) => void;
    clearSectionStatus: (projectId: string) => void;
}
