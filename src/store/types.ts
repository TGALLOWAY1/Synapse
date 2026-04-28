import type {
    Project, SpineVersion, HistoryEvent, Branch, StructuredPRD,
    PipelineStage, ProjectPlatform,
    Artifact, ArtifactVersion, ArtifactType, CoreArtifactSubtype,
    SourceRef, FeedbackItem, FeedbackType, FeedbackStatus, StalenessState,
    ArtifactSlotKey, ProjectJobState, SlotState,
    QualityScores, GenerationMeta,
} from '../types';

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

    // Demo project hydration
    loadDemoProject: () => { projectId: string; captured: boolean };

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
    updateProjectProductMetadata: (
        projectId: string,
        meta: { productName?: string; productCategory?: string },
    ) => void;

    // Error handling
    setSpineError: (projectId: string, spineId: string, error: { message: string; category: string; timestamp: number; raw?: string } | null) => void;

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
        parentVersionId?: string | null
    ) => { versionId: string };
    setPreferredVersion: (projectId: string, artifactId: string, versionId: string) => void;
    getArtifactVersions: (projectId: string, artifactId: string) => ArtifactVersion[];
    getPreferredVersion: (projectId: string, artifactId: string) => ArtifactVersion | undefined;
    getLatestArtifactVersion: (projectId: string, artifactId: string) => ArtifactVersion | undefined;

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

    // Staleness
    getArtifactStaleness: (projectId: string, artifactId: string) => StalenessState;

    // Background generation jobs (transient — excluded from persist)
    jobs: Record<string, ProjectJobState | undefined>;
    initJob: (projectId: string, spineVersionId: string, slotKeys: ArtifactSlotKey[]) => void;
    setSlotStatus: (projectId: string, slot: ArtifactSlotKey, partial: Partial<SlotState>) => void;
    appendSlotProgress: (projectId: string, slot: ArtifactSlotKey, message: string) => void;
    clearJob: (projectId: string) => void;
    getSlot: (projectId: string, slot: ArtifactSlotKey) => SlotState | undefined;
    getJob: (projectId: string) => ProjectJobState | undefined;
    markAllInterrupted: (projectId: string) => void;
}
