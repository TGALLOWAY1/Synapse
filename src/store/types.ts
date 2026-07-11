import type {
    Project, SpineVersion, HistoryEvent, Branch, StructuredPRD,
    PipelineStage, ProjectPlatform,
    Artifact, ArtifactVersion, ArtifactType, CoreArtifactSubtype,
    SourceRef, FeedbackItem, FeedbackType, FeedbackStatus,
    ArtifactSlotKey, ProjectJobState, SlotState,
    QualityScores, GenerationMeta, SpineSafetyReview,
    PreflightMode, PreflightQuestion,
    ProjectTask, TaskStatus, TaskExternalRef,
    WorkflowRun, VersionProvenance,
} from '../types';
import type { ImplementationTask } from '../types/tasks';
import type { SectionId } from '../lib/schemas/prdSchemas';
import type { PrdSectionStatusEntry } from './slices/prdProgressSlice';

export interface SpineGenerationMetaInput {
    sourcePrompt?: string;
    qualityScores?: QualityScores;
    generationMeta?: GenerationMeta;
    model?: string;
    prdVersion?: number;
}

export interface ProjectState {
    projects: Record<string, Project>;
    spineVersions: Record<string, SpineVersion[]>;
    historyEvents: Record<string, HistoryEvent[]>;
    branches: Record<string, Branch[]>;

    // Artifact system
    artifacts: Record<string, Artifact[]>;
    artifactVersions: Record<string, ArtifactVersion[]>;
    feedbackItems: Record<string, FeedbackItem[]>;

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
    loadDemoProject: () => Promise<{ projectId: string; available: boolean }>;

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
    updateSpineQualityScores: (
        projectId: string,
        spineId: string,
        scores: import('../types').QualityScores,
        generationMeta?: import('../types').GenerationMeta,
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
        },
    ) => { newSpineId: string };
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
