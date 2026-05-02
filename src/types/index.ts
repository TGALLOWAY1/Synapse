// Navigation stages. 'mockups' and 'artifacts' are legacy values preserved
// for migration of older persisted projects; the active UI uses 'workspace'.
export type PipelineStage = 'prd' | 'workspace' | 'history' | 'mockups' | 'artifacts';

export type ProjectPlatform = 'app' | 'web';

export type Project = {
    id: string;
    name: string;
    createdAt: number;
    currentStage?: PipelineStage;
    platform?: ProjectPlatform;
    // Inferred by the PRD pipeline. Stored as metadata only — never replaces
    // the user-chosen `name`.
    productName?: string;
    productCategory?: string;
};

export type BranchMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
};

export type Branch = {
    id: string;
    projectId: string;
    spineVersionId: string;
    anchorText: string;
    status: 'active' | 'resolved' | 'rejected' | 'merged';
    createdAt: number;
    messages: BranchMessage[];
};

// Structured PRD types
export type Feature = {
    id: string;
    name: string;
    description: string;
    userValue: string;
    complexity: 'low' | 'medium' | 'high';
    priority?: 'must' | 'should' | 'could';
    acceptanceCriteria?: string[];
    dependencies?: string[]; // feature IDs
    // --- Premium PRD additions (all optional) ---
    system?: string;                  // FeatureSystem id this feature rolls up under
    successCriteria?: string[];       // happy-path acceptance checks
    edgeCases?: string[];             // boundary / unusual conditions
    failureModes?: string[];          // explicit failure states + recovery
    uiAcceptanceCriteria?: string[];  // UI behavior expectations
    analyticsEvents?: string[];       // events that should fire
    tier?: 'mvp' | 'v1' | 'later';    // release tier
};

export type StructuredPRD = {
    vision: string;
    targetUsers: string[];
    coreProblem: string;
    features: Feature[];
    architecture: string;
    risks: string[];
    nonFunctionalRequirements?: string[];
    constraints?: string[];
    // Phase B grounding fields. Optional so older projects keep working; the
    // mockup spec engine and alignment critique use them when present to
    // force PRD-derived nouns/verbs into generated screens instead of
    // relying on heuristic term extraction.
    domainEntities?: DomainEntity[];
    primaryActions?: PrimaryAction[];

    // --- Premium PRD additions (all optional). Populated by the multi-pass
    // pipeline. Legacy projects keep working without these. ---
    productName?: string;
    productCategory?: string;
    executiveSummary?: string;
    productThesis?: ProductThesis;
    jtbd?: Jtbd[];
    principles?: Principle[];
    userLoops?: UserLoop[];
    uxPages?: UXPage[];
    featureSystems?: FeatureSystem[];
    richDataModel?: PrdDataModel;
    stateMachines?: StateMachine[];
    roles?: RolePermission[];
    architectureFlows?: ArchFlow[];
    risksDetailed?: RiskDetailed[];
    mvpScope?: MvpScope;
    successMetrics?: SuccessMetric[];
    assumptions?: Assumption[];
};

export type DomainEntity = {
    name: string;                 // e.g. "Patient case"
    description?: string;         // short what-it-is line
    exampleValues?: string[];     // 1–4 realistic example instances
};

export type PrimaryAction = {
    verb: string;                 // e.g. "Assign"
    target: string;               // e.g. "case owner"
};

// --- Premium PRD section types ---

export type ProductThesis = {
    whyExist: string;
    whyNow?: string;
    differentiation: string;
    intentionalTradeoffs?: string[];
    nonGoals?: string[];          // what the product should NOT become
};

export type Jtbd = {
    segment: string;
    motivation: string;
    painPoints: string[];
    job: string;                  // the job-to-be-done
    successMoment: string;
};

export type Principle = {
    name: string;
    description: string;
};

export type UserLoop = {
    name: string;
    trigger: string;
    action: string;
    systemResponse: string;
    reward: string;
    retentionMechanic: string;
};

export type UXPage = {
    id: string;
    name: string;
    purpose: string;
    primaryUser?: string;
    components: string[];
    interactions: string[];
    emptyState?: string;
    loadingState?: string;
    errorState?: string;
    responsiveNotes?: string;
};

export type FeatureSystem = {
    id: string;
    name: string;
    purpose: string;
    featureIds: string[];                  // Feature.id refs
    endToEndBehavior?: string;
    dependencies?: string[];
    edgeCases?: string[];
    mvpVsLater?: string;                   // narrative on tier split
};

export type PrdField = {
    name: string;
    type: string;
    required?: boolean;
    notes?: string;
};

export type PrdEntity = {
    name: string;
    description: string;
    fields: PrdField[];
    relationships?: string[];
    constraints?: string[];
    examples?: string[];                   // realistic example records
};

export type PrdDataModel = {
    entities: PrdEntity[];
};

export type MachineState = {
    name: string;
    trigger?: string;                      // what causes entry
    nextStates?: string[];
    userVisible?: string;
    systemBehavior?: string;
};

export type StateMachine = {
    entity: string;                        // e.g. "ProductListing"
    states: MachineState[];
};

export type RolePermission = {
    role: string;                          // e.g. "Verified artisan"
    allowed: string[];
    restricted?: string[];
    dataVisibility?: string;
    notes?: string;
};

export type ArchFlow = {
    name: string;                          // e.g. "Product image upload"
    steps: string[];                       // numbered steps as plain strings
};

export type RiskDetailed = {
    risk: string;
    likelihood: 'low' | 'med' | 'high';
    impact: string;
    mitigation: string;
    owner?: string;
};

export type MvpScope = {
    mvp: string[];
    v1: string[];
    later: string[];
    rationale?: string;
};

export type SuccessMetric = {
    name: string;
    target?: string;
    instrumentation?: string;
};

export type Assumption = {
    id: string;
    statement: string;
    confidence: 'low' | 'med' | 'high';
};

// --- Quality scoring (7-dimension rubric, 1–5 each) ---

export type QualityScores = {
    specificity: number;
    uxUsefulness: number;
    engineeringUsefulness: number;
    strategicClarity: number;
    formatting: number;
    acceptanceCriteria: number;
    downstreamReadiness: number;
    overall: number;
    notes?: string;
};

export type GenerationPassRecord = {
    stage: string;                         // 'strategy' | 'render_score' | 'revision'
    ms: number;
    ok: boolean;
};

export type GenerationMeta = {
    passes: GenerationPassRecord[];
    totalMs: number;
    revised: boolean;
    schemaVersion: number;                 // bump when the StructuredPRD shape changes
};

export type SpineVersion = {
    id: string; // e.g. "v1", "v2"
    projectId: string;
    promptText: string;
    responseText: string;
    createdAt: number;
    isLatest: boolean;
    isFinal: boolean;
    structuredPRD?: StructuredPRD;
    generationError?: {
        message: string;
        category: string;
        timestamp: number;
        raw?: string;
    };
    // --- Premium PRD additions (all optional). ---
    sourcePrompt?: string;                 // original user prompt at generation time
    qualityScores?: QualityScores;
    model?: string;                        // model used for generation
    generationMeta?: GenerationMeta;
    prdVersion?: number;                   // schema version (1 = legacy; 2 = premium)
};

// --- Structured Artifact Content Types ---

export interface ScreenItem {
    name: string;
    purpose: string;
    components: string[];
    navigationFrom?: string[];
    navigationTo?: string[];
    priority: 'core' | 'secondary' | 'supporting';
    featureRefs?: string[];
}

export interface ScreenInventoryContent {
    groups: { name: string; screens: ScreenItem[] }[];
}

export interface DataField {
    name: string;
    type: string;
    required: boolean;
    description: string;
}

export interface DataRelationship {
    type: 'has_many' | 'belongs_to' | 'has_one' | 'many_to_many';
    target: string;
    description?: string;
}

export interface DataEntity {
    name: string;
    description: string;
    fields: DataField[];
    relationships: DataRelationship[];
    indexes?: string[];
    constraints?: string[];
}

export interface DataModelContent {
    entities: DataEntity[];
    apiEndpoints?: { method: string; path: string; description: string; entity: string }[];
}

export interface ComponentItem {
    name: string;
    purpose: string;
    props?: { name: string; type: string; description?: string }[];
    usedIn?: string[];
    complexity: 'simple' | 'moderate' | 'complex';
    notes?: string;
}

export interface ComponentInventoryContent {
    categories: { name: string; components: ComponentItem[] }[];
}

// --- Artifact System ---

export type ArtifactType = 'prd' | 'mockup' | 'prompt' | 'core_artifact';

export type CoreArtifactSubtype =
    | 'screen_inventory'
    | 'user_flows'
    | 'component_inventory'
    | 'implementation_plan'
    | 'data_model'
    | 'prompt_pack'
    | 'design_system';

// --- Background generation jobs ---

export type GenerationStatus =
    | 'idle'
    | 'queued'
    | 'generating'
    | 'done'
    | 'error'
    | 'interrupted';

export type ArtifactSlotKey = CoreArtifactSubtype | 'mockup';

export interface SlotState {
    status: GenerationStatus;
    startedAt?: number;
    finishedAt?: number;
    error?: { message: string; category: string; timestamp: number };
    attempt: number;
    progressLog?: string[];
}

export interface ProjectJobState {
    spineVersionId: string;
    startedAt: number;
    slots: Record<ArtifactSlotKey, SlotState>;
}

export type StalenessState = 'current' | 'possibly_outdated' | 'outdated';

export type SourceRef = {
    id: string;
    sourceArtifactId: string;
    sourceArtifactVersionId: string;
    sourceType: ArtifactType | 'spine';
    anchorInfo?: string;
};

export type Artifact = {
    id: string;
    projectId: string;
    type: ArtifactType;
    subtype?: CoreArtifactSubtype;
    title: string;
    status: 'draft' | 'active' | 'archived';
    currentVersionId: string | null;
    createdAt: number;
    updatedAt: number;
};

export type ArtifactVersion = {
    id: string;
    artifactId: string;
    versionNumber: number;
    parentVersionId: string | null;
    content: string;
    metadata: Record<string, unknown>;
    sourceRefs: SourceRef[];
    generationPrompt: string;
    isPreferred: boolean;
    createdAt: number;
};

// Feedback types
export type FeedbackType =
    | 'feature_addition'
    | 'workflow_refinement'
    | 'ia_navigation'
    | 'missing_state'
    | 'visual_system'
    | 'ambiguous_requirement'
    | 'implementation_consideration'
    | 'naming_wording';

export type FeedbackStatus = 'open' | 'accepted' | 'rejected' | 'incorporated';

export type FeedbackItem = {
    id: string;
    projectId: string;
    sourceArtifactVersionId: string;
    type: FeedbackType;
    title: string;
    description: string;
    status: FeedbackStatus;
    targetArtifactType: ArtifactType;
    createdAt: number;
    updatedAt: number;
};

// Mockup generation settings
export type MockupPlatform = 'mobile' | 'desktop' | 'responsive';
export type MockupFidelity = 'low' | 'mid' | 'high';
export type MockupScope = 'single_screen' | 'multi_screen' | 'key_workflow';

export type MockupSettings = {
    platform: MockupPlatform;
    fidelity: MockupFidelity;
    style?: string;
    scope: MockupScope;
    selectedSections?: string[];
    // Phase C: Demo Safe Mode. Pins temperature=0 + topK=1 on the provider
    // call, disables the HTML-engine fallback chain, and hard-rejects on
    // alignment critique miss. Intended for recruiter demos where a
    // predictable "refused to generate" is preferable to a silent degrade.
    safeMode?: boolean;
};

// Rendered HTML/Tailwind mockup payload (stored as JSON string in
// ArtifactVersion.content; distinguished by metadata.format === 'mockup_html_v1').
export type MockupScreen = {
    id: string;       // stable per-screen id (uuid, assigned client-side)
    name: string;     // screen title, e.g. "Editor Dashboard"
    purpose: string;  // one-sentence rationale grounded in the PRD
    html: string;     // static body fragment — no <html>/<head>/<script>
    notes?: string;   // optional assumptions / callouts
};

export type MockupPayload = {
    version: 'mockup_html_v1';
    title: string;              // overall title, e.g. "Editor Workspace Concept"
    summary: string;            // 1–2 sentence product framing
    screens: MockupScreen[];    // always >= 1
};

export const MOCKUP_HTML_V1 = 'mockup_html_v1' as const;

// --- AI image previews (OpenAI gpt-image-2) ---
//
// Each MockupScreen can optionally have an associated AI-generated image
// preview produced by OpenAI gpt-image-2. The image lives outside the Zustand
// store (in IndexedDB) because base64 PNGs are too large for localStorage's
// quota. MockupPayload is intentionally unchanged — image presence is looked
// up by `${versionId}:${screenId}` in the IDB image store.
export type MockupImageQuality = 'low' | 'medium' | 'high';

export type MockupImageRecord = {
    key: string;            // `${versionId}:${screenId}`
    projectId: string;
    artifactId: string;
    versionId: string;
    screenId: string;
    dataUrl: string;        // `data:image/png;base64,...`
    quality: MockupImageQuality;
    prompt: string;         // prompt sent to gpt-image-2 (for traceability)
    generatedAt: number;
};

// --- Screen Inventory user-uploaded images ---
//
// Per-screen image history attached to a Screen Inventory artifact. Users
// copy a generated prompt into an external image tool (Nano Banana, GPT
// image, etc.), then upload the result back to the screen card. Each
// upload is a new immutable record with an incrementing `versionNumber`;
// `isPreferred` mirrors the same semantics as `ArtifactVersion.isPreferred`
// — exactly one preferred record per `(artifactVersionId, screenSlug)`
// bucket. Records live in IndexedDB to stay out of the localStorage quota.
export type ScreenInventoryImageRecord = {
    key: string;              // `${artifactVersionId}:${screenSlug}:${versionNumber}`
    projectId: string;
    artifactId: string;
    artifactVersionId: string;
    screenSlug: string;       // slug of ScreenItem.name
    screenName: string;       // original name (for display / debugging)
    versionNumber: number;
    isPreferred: boolean;
    dataUrl: string;          // `data:<mime>;base64,...`
    mimeType: string;
    prompt: string;           // prompt that was offered for copy at upload time
    generatedAt: number;
};

// Prompt artifact settings
export type PromptTarget =
    | 'mockup'
    | 'coding'
    | 'ux_critique'
    | 'implementation'
    | 'user_flow'
    | 'testing'
    | 'launch_copy';

// History event types (expanded)
export type HistoryEventType =
    | 'Init'
    | 'Regenerated'
    | 'Consolidated'
    | 'ArtifactGenerated'
    | 'ArtifactRegenerated'
    | 'FeedbackCreated'
    | 'FeedbackApplied'
    | 'GenerationFailed';

export type HistoryEvent = {
    id: string;
    projectId: string;
    spineVersionId?: string;
    artifactId?: string;
    artifactVersionId?: string;
    type: HistoryEventType;
    description: string;
    diff?: {
        matchMode?: "exact" | "word";
        matchCount?: number;
        matches: { before: string; after: string }[];
        sampleText?: string;
    };
    createdAt: number;
};
