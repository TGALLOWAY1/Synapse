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
    // Only set on the cached demo project: the snapshot id this device's demo
    // was hydrated from. Used by `loadDemoProject` to detect when the owner
    // has pinned a newer demo snapshot and re-fetch instead of serving stale
    // local cache. Optional so legacy persisted projects keep working.
    demoSourceSnapshotId?: string;
    // The user-chosen design-system direction (a `DESIGN_SYSTEM_PRESETS` id,
    // e.g. 'saas_minimal' or 'custom'), picked once before artifact generation.
    // Steers design_system generation and, through it, the visual language of
    // mockups and the Screen Inventory copy-prompt. Optional — legacy projects
    // and the demo have none and behave exactly as before.
    designSystemPreset?: string;
    // True while the setup-stage design selection step (DesignSetupStep) is
    // still owed for this project. Stamped by `createProject`, cleared when a
    // preset is chosen (any path) or the user explicitly skips. Optional —
    // legacy projects and the demo have none and never see the setup step.
    needsDesignSetup?: boolean;
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
    implementationPlan?: ImplementationPlan;
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
    // Arrays of short distinct sentences. Legacy projects in localStorage
    // may have stored a single concatenated string here; the textCleanup
    // utility (`coerceToBulletList`) accepts both shapes so the renderer
    // never has to think about the difference.
    userVisible?: string[] | string;
    systemBehavior?: string[] | string;
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

export type ImplementationPlanPhase = {
    name: string;
    goals: string[];
    featureIds?: string[];
    estimatedWeeks?: number;
};

export type ImplementationPlan = {
    phases: ImplementationPlanPhase[];
    techStack?: string[];
    teamNotes?: string;
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

// Outcome of the automatic final consistency-review pass. Records — for
// debugging/diagnostics, never the UI — whether the review ran, whether its
// output was accepted over the deterministically-merged PRD, and (on
// rejection) why the merged PRD was kept instead. Optional/back-compat:
// legacy generation meta lacks it.
export type ConsistencyReviewMeta = {
    /** The review model call was attempted (false = skipped, e.g. partial run). */
    ran: boolean;
    /** The reviewed PRD passed every guard and was used as the generated PRD. */
    applied: boolean;
    status: 'applied' | 'rejected' | 'skipped' | 'error';
    /** Present only when status is 'rejected' or 'error'. */
    rejectionReason?: string;
    /**
     * Compact structured diff of what the review pass changed (or attempted to
     * change, on rejection). Transparency/debugging only — never affects
     * generation. Optional/back-compat: absent on legacy meta and skipped runs.
     */
    diff?: ConsistencyReviewDiff;
};

/**
 * A compact, human-readable record of what the consistency-review pass did.
 * Populated whether the review was accepted or rejected so the version-history
 * UI can explain the outcome. Pure/derived — carries no PRD content, only
 * summaries. All fields present so older stored diffs stay renderable.
 */
export type ConsistencyReviewDiff = {
    /** Top-level StructuredPRD field keys whose serialized value changed. */
    sectionsChanged: string[];
    /** Features whose id was preserved but whose display name changed (wording, not identity). */
    featuresReworded: Array<{ id: string; before: string; after: string }>;
    /** Product-name normalization, when the review canonicalized it. */
    productNameChange?: { before: string; after: string };
    /** Guard checks that fired (empty when the review was accepted cleanly). */
    guardsTriggered: string[];
    /** Final outcome of the review pass. */
    outcome: 'accepted' | 'partially-accepted' | 'repaired' | 'rejected';
};

export type GenerationMeta = {
    passes: GenerationPassRecord[];
    totalMs: number;
    revised: boolean;
    schemaVersion: number;                 // bump when the StructuredPRD shape changes
    // Section ids that errored during the DAG run. A non-empty list means the
    // stored PRD is partial (failed sections merged as empty stubs); the
    // workspace surfaces an incomplete-PRD banner with per-section retry, and
    // a successful single-section retry removes its id from this list.
    failedSections?: string[];
    // Result of the automatic consistency-review pass (default-on). See
    // ConsistencyReviewMeta. Absent on legacy meta / when the pass was skipped
    // for a partial run.
    consistencyReview?: ConsistencyReviewMeta;
};

// --- Workflow orchestration metrics domain types ---
//
// A WorkflowRun captures one end-to-end multi-agent run (a PRD generation, or
// a downstream-artifact bundle) so the Metrics dashboard can show how much the
// concurrent DAG executor actually saved over a hypothetical sequential run.
// All fields are derived deterministically from per-node start/end timings —
// nothing here changes generation behavior. These are persisted (per user,
// keyed by projectId) in `metricsSlice`; keep every field present so older
// stored runs stay renderable.

/** Token counts for a single model call. */
export type TokenUsage = {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
};

export type WorkflowType = 'prd' | 'artifacts';

export type WorkflowNodeStatus = 'complete' | 'error';

/** One agent/section call within a workflow run. */
export type WorkflowNodeRun = {
    id: string;
    /** Stable key for the unit of work (e.g. a PRD section id or artifact slot). */
    nodeId: string;
    /** Human-readable label shown in the timeline. */
    nodeName: string;
    /** Optional logical agent name (e.g. 'PRD Section Agent'). */
    agentName?: string;
    provider: string;                       // 'gemini' | 'openai' | …
    model: string;
    status: WorkflowNodeStatus;
    /** nodeIds this node consumed as upstream context (true data deps only). */
    dependencyIds: string[];
    /** Topological wave index — nodes sharing one are eligible to run together. */
    parallelGroupId?: number;
    /** Wall-clock ms relative to the run start (so detail views can lay out bars). */
    startedAt: number;
    completedAt: number;
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;                 // USD, estimate (see modelPricing.ts)
    retryCount?: number;
    errorMessage?: string;
};

export type WorkflowRunStatus = 'complete' | 'partial' | 'error';

/** Aggregate metrics for one multi-agent workflow run. */
export type WorkflowRun = {
    id: string;
    projectId: string;
    projectName?: string;
    workflowType: WorkflowType;
    status: WorkflowRunStatus;
    /** Epoch ms when the run started / settled. */
    startedAt: number;
    completedAt: number;
    actualRuntimeMs: number;
    /** Σ node.durationMs — the hypothetical one-after-another runtime. */
    sequentialEstimateMs: number;
    parallelTimeSavedMs: number;
    speedupRatio: number;
    maxConcurrency: number;
    averageConcurrency: number;
    criticalPathMs: number;
    totalNodeRuntimeMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    estimatedCost: number;                  // USD, estimate
    retryCount: number;
    failureCount: number;
    nodeCount: number;
    parallelGroupCount: number;
    nodes: WorkflowNodeRun[];
    /** Free-form extras (e.g. consistency-review ms, model pair). */
    metadata?: Record<string, unknown>;
};

// --- Safety guardrail domain types ---

export type SafetyClassification =
    | 'allowed'
    | 'allowed_with_restrictions'
    | 'disallowed';

export type SafetyConfidence = 'low' | 'medium' | 'high';

/** Structured verdict from the pre-generation safety classifier. */
export type SafetyClassificationResult = {
    classification: SafetyClassification;
    confidence: SafetyConfidence;
    detectedConcerns: string[];
    userFacingReason: string;   // user-safe; never leaks internal policy text
    safeAlternatives: string[];
};

/** Persisted safety verdict on a SpineVersion. `status` drives UI + gating. */
export type SpineSafetyReview = {
    classification: SafetyClassification;
    status: 'generated' | 'restricted' | 'blocked';
    detectedConcerns: string[];
    userFacingReason: string;
    safeAlternatives: string[];
    reviewedAt: number;
};

// --- Canonical PRD Spine ---------------------------------------------------
//
// A compact, structured, deterministic contract derived from the finalized
// StructuredPRD (after the silent consistency review). It is the *primary*
// source of truth for downstream artifact generation — a single, stable
// product contract that replaces the several overlapping PRD summaries that
// used to be concatenated into artifact prompts (feature glossary + inline
// PRD summary). Full PRD markdown is retained only as a secondary fallback.
//
// The spine is built by `buildCanonicalPrdSpine` (deterministic code, never an
// LLM call) and attached to `SpineVersion.canonicalSpine`. It is intentionally
// compact — no embedded markdown — so it can be rendered into a prompt as
// structured JSON without bloating context. Every field is conservative:
// screen/entity seeds are *seeds*, not full downstream artifacts. All arrays
// are optional-empty and the whole object is optional on SpineVersion so
// legacy projects (which have no saved spine) keep working — artifact
// generation rebuilds a spine lazily from the stored StructuredPRD.

/** Schema version for the canonical spine shape — bump on breaking changes. */
export const CANONICAL_SPINE_SCHEMA_VERSION = 1 as const;

export type SpineProductIdentity = {
    /** Authoritative product name (user-chosen name wins over model-invented). */
    productName?: string;
    /** One-sentence product description. */
    description?: string;
    /** Platform / delivery context, e.g. "Mobile app", "Web app". */
    platform?: string;
    /** The single primary product goal. */
    primaryGoal?: string;
};

export type SpineUserSegment = {
    /** Segment / persona name. */
    segment: string;
    /** Primary jobs-to-be-done for this segment. */
    jobsToBeDone?: string[];
    /** Key pains or needs. */
    pains?: string[];
};

/**
 * Canonical feature entry. `id` is the PRD `Feature.id` verbatim — feature ids
 * stay canonical across the PRD and every downstream artifact.
 */
export type SpineFeature = {
    id: string;
    name: string;
    description: string;
    /** Acceptance criteria or success expectations, when available. */
    acceptanceCriteria?: string[];
    /** MoSCoW priority marker, when available. */
    priority?: 'must' | 'should' | 'could';
    /** MVP / post-MVP release tier, when available. */
    tier?: 'mvp' | 'v1' | 'later';
};

/**
 * A likely canonical screen implied by the PRD. `id` is a deterministic
 * slug-based id (`scr-<slug>` with numeric dedup suffixes) — interim stable id
 * until a real screen inventory exists. Seeds are conservative, not a full
 * screen inventory.
 */
export type SpineScreenSeed = {
    id: string;
    name: string;
    purpose?: string;
    /** Canonical `Feature.id`s this screen relates to, when derivable. */
    relatedFeatureIds?: string[];
    /** Primary user intent for the screen, in the user's own words. */
    userIntent?: string;
    /** Known screen states, when available. */
    states?: string[];
};

/**
 * A likely canonical domain entity implied by the PRD. `id` is a deterministic
 * slug-based id (`ent-<slug>` with numeric dedup suffixes). Seeds are
 * conservative, not a full data model.
 */
export type SpineEntitySeed = {
    id: string;
    name: string;
    description?: string;
    /** Canonical `Feature.id`s this entity relates to, when derivable. */
    relatedFeatureIds?: string[];
    /** Obvious relationships, when available. */
    relationships?: string[];
};

export type SpineConstraints = {
    technical?: string[];
    product?: string[];
    nonFunctional?: string[];
    /** Privacy / security / compliance constraints (extracted from the above). */
    privacySecurityCompliance?: string[];
    /** Explicit out-of-scope items. */
    outOfScope?: string[];
};

/**
 * Safety restrictions that must propagate downstream. Sourced from the spine's
 * persisted `SpineSafetyReview`. `blocked` spines never reach artifact
 * generation, so in practice this carries `generated` / `restricted`.
 */
export type SpineSafetyRestrictions = {
    classification: SafetyClassification;
    status: SpineSafetyReview['status'];
    /** Binding restriction directives for `allowed_with_restrictions` runs. */
    restrictionDirectives?: string[];
    /** Content/implementation boundaries (detected concerns) to honor. */
    boundaries?: string[];
};

export type SpineArchitectureDirection = {
    /** High-level architecture guidance (short decision narrative). */
    summary?: string;
    integrationAssumptions?: string[];
    dataStorageAssumptions?: string[];
    aiToolingAssumptions?: string[];
    /** Implementation constraints artifacts should respect. */
    implementationConstraints?: string[];
};

export type SpineDesignDirection = {
    /** Selected `DESIGN_SYSTEM_PRESETS` id. */
    presetId?: string;
    presetLabel?: string;
    tone?: string;
    visualDirection?: string;
    accessibilityExpectations?: string[];
    platformNotes?: string[];
};

export type CanonicalSpineValidation = {
    valid: boolean;
    warnings: string[];
};

export type CanonicalSpineMeta = {
    schemaVersion: typeof CANONICAL_SPINE_SCHEMA_VERSION;
    generatedAt: number;
    /** Spine version the contract was built from (for diffing/staleness). */
    sourceSpineVersionId?: string;
    /** `StructuredPRD` schema version at build time, when known. */
    sourcePrdVersion?: number;
    validation: CanonicalSpineValidation;
};

export type CanonicalPrdSpine = {
    identity: SpineProductIdentity;
    users: SpineUserSegment[];
    features: SpineFeature[];
    screenSeeds: SpineScreenSeed[];
    entitySeeds: SpineEntitySeed[];
    constraints: SpineConstraints;
    safety?: SpineSafetyRestrictions;
    architecture: SpineArchitectureDirection;
    design?: SpineDesignDirection;
    meta: CanonicalSpineMeta;
};

// --- Preflight clarification (optional pre-PRD interview) ---
// When the user opts into Quick (5) or Deep (10) clarification, Synapse
// generates idea-specific questions, collects answers one at a time, shows a
// summary, then feeds the responses into PRD generation as authoritative
// intent. State lives on the spine so progress is resumable across refresh.
// Absent `preflightSession` = the legacy/"Generate Immediately" path.
export type PreflightMode = 'none' | 'quick' | 'deep';

export type PreflightQuestion = {
    id: string;
    question: string;
    intent?: string; // short "why this matters" line shown under the question
    answer?: string;
    skipped?: boolean;
};

export type PreflightStatus =
    | 'awaiting_questions' // questions not yet generated
    | 'answering' // user is working through the questions
    | 'summary' // all questions answered/skipped; reviewing the summary
    | 'completed'; // PRD generation has been kicked off

export type PreflightSession = {
    mode: PreflightMode;
    originalIdea: string;
    questions: PreflightQuestion[];
    currentQuestionIndex: number;
    status: PreflightStatus;
    completed: boolean;
    summary?: string;
    assumptions?: string[];
    unknowns?: string[];
    usedFallback?: boolean; // questions came from the generic fallback set
    error?: string; // non-blocking question/summary generation error
};

export type SpineVersion = {
    // Opaque unique id. New versions get UUIDs; the first spine and legacy
    // localStorage data use "v1"-style ids — never parse or derive version
    // numbers from this, use the array position instead.
    id: string;
    projectId: string;
    promptText: string;
    responseText: string;
    createdAt: number;
    isLatest: boolean;
    isFinal: boolean;
    structuredPRD?: StructuredPRD;
    preflightSession?: PreflightSession;
    generationError?: {
        message: string;
        category: string;
        timestamp: number;
        raw?: string;
    };
    // Lifecycle marker for the async PRD pipeline. Set to 'running' when
    // generation actually starts (not at spine creation — preflight spines
    // wait) and flipped to 'complete' when the run settles (final result,
    // error, or safety block). A spine still 'running' at rehydration time
    // was interrupted (refresh / closed tab mid-generation); the store
    // converts it to a generationError so the UI offers Try Again instead
    // of showing "Generating…" forever. Optional: legacy spines lack it.
    generationPhase?: 'running' | 'complete';
    // --- Premium PRD additions (all optional). ---
    sourcePrompt?: string;                 // original user prompt at generation time
    qualityScores?: QualityScores;
    model?: string;                        // model used for generation
    generationMeta?: GenerationMeta;
    prdVersion?: number;                   // schema version (1 = legacy; 2 = premium)
    // Pre-generation safety verdict. `status: 'blocked'` means the request was
    // disallowed — the Safety Review screen is shown and all downstream
    // generation (mark-final / workspace / artifacts) is gated off.
    safetyReview?: SpineSafetyReview;
    // Change attribution for this version (user edit vs AI regen vs revert, …).
    // Optional & backward-compatible: legacy spines have none.
    provenance?: VersionProvenance;
    // Compact structured contract derived deterministically from the finalized
    // structuredPRD (after the consistency review). The primary source of truth
    // for downstream artifact generation. Attached on final settle; optional &
    // backward-compatible — legacy spines lack it and artifact generation
    // rebuilds one lazily from `structuredPRD`.
    canonicalSpine?: CanonicalPrdSpine;
};

// --- Structured Artifact Content Types ---

export type ScreenPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type LegacyScreenPriority = 'core' | 'secondary' | 'supporting';
export type ScreenType = 'screen' | 'modal' | 'overlay' | 'system-state';

export interface ScreenState {
    name: string;
    description: string;
    trigger?: string;
    recoveryPath?: string;
}

export interface ExitPath {
    label: string;
    target: string;
    condition?: string;
}

export interface ScreenItem {
    id?: string;
    name: string;
    type?: ScreenType;
    priority: ScreenPriority | LegacyScreenPriority;
    purpose: string;
    userIntent?: string;
    states?: ScreenState[];
    entryPoints?: string[];
    exitPaths?: ExitPath[];
    coreUIElements?: string[];
    // Legacy alias kept readable for old artifacts; new generations
    // populate `coreUIElements`.
    components?: string[];
    outputData?: string[];
    risks?: string[];
    featureRefs?: string[];
    // Legacy navigation fields, retained so persisted localStorage data
    // still satisfies the type without rewrites.
    navigationFrom?: string[];
    navigationTo?: string[];
}

export interface ScreenInventorySection {
    title: string;
    description?: string;
    flowSummary?: string;
    screens: ScreenItem[];
}

export interface ScreenInventoryContent {
    sections: ScreenInventorySection[];
    // Legacy shape: pre-upgrade artifacts emitted `groups`. The renderer
    // and orchestration layers normalize this to `sections` on read.
    groups?: { name: string; screens: ScreenItem[] }[];
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

export type FieldGroupName =
    | 'Key Product Fields'
    | 'Relationships'
    | 'System Metadata'
    | 'API / Integration'
    | 'Privacy / Safety';

export interface FieldGroup {
    name: FieldGroupName;
    fieldNames: string[];
}

export interface DataEntity {
    name: string;
    description: string;
    fields: DataField[];
    relationships: DataRelationship[];
    indexes?: string[];
    constraints?: string[];
    userFacing?: boolean;
    mutability?: 'immutable' | 'mostly_immutable' | 'mutable';
    purpose?: string;
    fieldGroups?: FieldGroup[];
    privacyRules?: string[];
    /** Stored as a JSON-encoded string in Gemini output; the converter parses it. */
    exampleRecord?: string;
}

export interface DataModelOverview {
    summary: string;
    dataFlow: string;
    productOutcome: string;
}

export interface ProductMappingEntry {
    field: string;
    uiBehavior: string;
}

export interface DataModelContent {
    entities: DataEntity[];
    apiEndpoints?: { method: string; path: string; description: string; entity: string }[];
    overview?: DataModelOverview;
    productMapping?: ProductMappingEntry[];
}

/** Visual preview archetype for a component card. Optional in stored data —
 * inferred from the component name/props when absent. */
export type ComponentPreviewType = 'accordion' | 'input' | 'toggle' | 'button' | 'custom';

/** Accessibility contract for a component. All fields optional; older
 * inventories have none, in which case the renderer derives a heuristic set
 * and flags it as needing review. */
export interface ComponentA11y {
    keyboard?: boolean;
    focusManagement?: boolean;
    screenReader?: boolean;
    aria?: string[];
    notes?: string;
}

export interface ComponentItem {
    name: string;
    purpose: string;
    props?: { name: string; type: string; required?: boolean; description?: string }[];
    usedIn?: string[];
    complexity: 'simple' | 'moderate' | 'complex';
    notes?: string;
    /** Optional — added by newer generations; inferred at render time otherwise. */
    accessibility?: ComponentA11y;
    /** Optional — added by newer generations; inferred at render time otherwise. */
    previewType?: ComponentPreviewType;
}

export interface ComponentInventoryContent {
    categories: { name: string; components: ComponentItem[] }[];
}

// --- Design System Tokens ---
//
// The Design System Starter artifact emits a structured token contract
// alongside its rendered markdown. Tokens flow downstream into mockup
// generation prompts and the HTML mockup iframe (as CSS variables) so
// generated mockups respect the project's actual design intent rather
// than the hard-coded Tailwind palette baked into the mockup prompt.
//
// Token values are stored on `ArtifactVersion.metadata.tokens` and a
// canonical hash on `metadata.tokensHash`. Backwards-compatible: legacy
// projects without these fields fall back to markdown parsing.

export type DesignColorToken = string; // hex (#RRGGBB)

export interface DesignTypographyToken {
    font: string;
    size: number;          // px
    weight: number;        // 100..900
    lineHeight: number;    // unitless multiplier (1.5 = 150%)
    letterSpacing?: number; // px
}

export interface DesignComponentToken {
    background?: string;   // token reference (e.g. "surface.card") or hex
    text?: string;
    border?: string;
    radius?: string;       // token reference (e.g. "md") or px
    padding?: string;      // tokenized shorthand (e.g. "sm md")
    notes?: string;
}

export interface DesignTokens {
    version: 1;
    colors: Record<string, DesignColorToken>;             // dot-paths e.g. "brand.primary"
    typography: Record<string, DesignTypographyToken>;    // dot-paths e.g. "heading.lg"
    spacing: Record<string, number>;                      // px
    radius: Record<string, number>;                       // px
    components: Record<string, DesignComponentToken>;     // dot-paths e.g. "button.primary"
    rules: string[];                                      // human-readable usage rules
}

// --- Implementation Plan (structured) ---

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

export interface LinkedArtifacts {
    prd?: string[];
    dataModel?: string[];
    mockups?: string[];
}

export interface ImplementationPlanTask {
    id: string;
    title: string;
    description?: string;
    status: TaskStatus;
    dependencies?: string[];
    linkedArtifacts?: LinkedArtifacts;
}

// A ready-to-copy coding-agent prompt attached to a milestone. Legacy
// `prompt_pack` artifacts are adapted into this shape at render time
// (see lib/services/implementationPlanAdapter.ts).
export interface ImplementationPromptPack {
    id: string;
    title: string;
    /** What running this prompt accomplishes, in one sentence. */
    purpose: string;
    /** The full coding-agent-ready prompt body. */
    prompt: string;
    scope?: {
        include: string[];
        exclude: string[];
    };
    acceptanceCriteria: string[];
    recommendedCommitMessage?: string;
    /** Legacy prompt_pack category label (e.g. "UI Implementation"). */
    category?: string;
}

export type QualityGateCategory =
    | 'design_fidelity'
    | 'functional'
    | 'data_integrity'
    | 'integration'
    | 'accessibility'
    | 'performance'
    | 'testing'
    | 'regression';

export interface ImplementationQualityGate {
    id: string;
    title: string;
    description?: string;
    category: QualityGateCategory;
    required: boolean;
}

/** Milestone-level references to other Synapse artifacts, by display name. */
export interface MilestoneLinkedArtifacts {
    screens?: string[];
    dataModels?: string[];
    components?: string[];
    userFlows?: string[];
    risks?: string[];
    apis?: string[];
}

export interface ImplementationPlanMilestone {
    id: string;
    name: string;
    timeframe?: string;
    goal?: string;
    tasks: ImplementationPlanTask[];
    // --- Consolidated-plan fields (all optional; legacy plans lack them) ---
    /** Richer objective statement; falls back to `goal` when absent. */
    objective?: string;
    phase?: string;
    priority?: 'critical' | 'high' | 'medium' | 'low';
    estimatedEffort?: string;
    /** Ids of other milestones that must complete first. */
    dependencies?: string[];
    linkedArtifacts?: MilestoneLinkedArtifacts;
    promptPacks?: ImplementationPromptPack[];
    qualityGates?: ImplementationQualityGate[];
    validationCommands?: string[];
    definitionOfDone?: string[];
}

export interface RiskItem {
    description: string;
    mitigation?: string;
}

export interface ImplementationPlanSummary {
    buildStrategy?: string;
    stackSummary?: string[];
    criticalPath?: string[];
    estimatedEffort?: string;
    teamAssumption?: string;
}

export interface ImplementationReadiness {
    status: 'ready' | 'needs_review' | 'blocked';
    warnings: string[];
    missingInputs: string[];
    recommendedNextStep?: string;
}

export interface StructuredImplementationPlan {
    overview?: {
        summary?: string;
        criticalPath?: string;
        teamSize?: string;
    };
    milestones: ImplementationPlanMilestone[];
    architecture?: string[];
    risks?: RiskItem[];
    definitionOfDone?: string[];
    // --- Consolidated-plan fields (all optional; legacy plans lack them) ---
    summary?: ImplementationPlanSummary;
    globalQualityGates?: ImplementationQualityGate[];
}

// --- Consolidated Implementation Plan (render-time view model) ---
//
// Built by `implementationPlanAdapter.ts` from a native structured plan
// and/or a legacy prompt_pack artifact. Never persisted — derived on read so
// legacy projects need no migration.

export interface ImplementationTraceabilityItem {
    milestoneId: string;
    milestoneTitle: string;
    screens: string[];
    dataModels: string[];
    components: string[];
    promptPackIds: string[];
    qualityGateIds: string[];
}

export interface ConsolidatedImplementationPlan {
    title: string;
    summary: ImplementationPlanSummary;
    readiness: ImplementationReadiness;
    milestones: ImplementationPlanMilestone[];
    /** Prompt packs that couldn't be attached to any milestone. */
    unassignedPromptPacks: ImplementationPromptPack[];
    globalQualityGates: ImplementationQualityGate[];
    traceability: ImplementationTraceabilityItem[];
    risks: RiskItem[];
    architecture: string[];
    /** Unrecognized appendix prose from a legacy markdown plan — preserved
     * verbatim so switching to the consolidated view never loses content. */
    appendixNotes?: string;
    /** Where the data came from — drives legacy explainer copy in the UI. */
    sources: {
        plan: 'structured' | 'legacy_markdown' | 'none';
        promptPacks: 'native' | 'legacy_prompt_pack' | 'none';
    };
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
    // Content generated and preserved, but a blocking validation issue means it
    // must not read as a trustworthy, completed artifact — see
    // artifactBlockingValidation.ts.
    | 'needs_review'
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
    // Change attribution (see VersionProvenance). Optional & backward-compatible.
    provenance?: VersionProvenance;
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

// --- Persisted implementation tasks --------------------------------------
// `ImplementationTask` (src/types/tasks.ts) is the *transient* extraction
// shape produced from an Implementation Plan. `ProjectTask` is its persisted
// counterpart: once the user saves extracted tasks to a project, they live
// here with tracking state (status, export refs) so progress survives
// refresh and drives the implementation checklist. The shared enums are
// imported from tasks.ts (one-way dependency; tasks.ts imports nothing).
// `ProjectTask.status` reuses the existing `TaskStatus` union (defined with
// the structured implementation plan below: todo/in_progress/done/blocked).

/** A reference to an external item created by exporting a task. */
export type TaskExternalRef = {
    target: import('./tasks').ExportTargetId;
    externalId?: string;
    externalUrl?: string;
    exportedAt: number;
};

export type ProjectTask = {
    id: string;
    projectId: string;
    /** Implementation Plan artifact the task was extracted from. */
    sourceArtifactId: string;
    /** Spine version current when the task was saved (for staleness hints). */
    sourceSpineVersionId?: string;
    sourceSectionId?: string;
    title: string;
    summary: string;
    priority?: import('./tasks').TaskPriority;
    taskType?: import('./tasks').TaskType;
    estimatedComplexity?: import('./tasks').TaskComplexity;
    acceptanceCriteria: string[];
    dependencies?: string[];
    implementationNotes?: string[];
    suggestedLabels?: string[];
    status: TaskStatus;
    createdAt: number;
    updatedAt: number;
    /** Populated when the task is exported to GitHub/Linear/markdown. */
    externalRefs?: TaskExternalRef[];
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

// Mockup screen payload. Each screen is a semantic specification derived
// from the screen_inventory + component_inventory + design_system artifacts.
// The visual rendering is produced by AI image generation (OpenAI gpt-image-2);
// no HTML is generated or stored here.
export type MockupScreen = {
    id: string;                  // stable per-screen id (uuid, assigned client-side)
    name: string;                // screen title, e.g. "Editor Dashboard"
    purpose: string;             // one-sentence rationale grounded in the PRD
    userIntent?: string;         // goal in the user's own words (from screen_inventory)
    priority?: ScreenPriority;   // P0..P3 (from screen_inventory)
    type?: ScreenType;           // screen | modal | overlay | system-state
    coreUIElements?: string[];   // semantic UI elements present on this screen
    componentRefs?: string[];    // component names from component_inventory used here
    notes?: string;              // optional assumptions / callouts
    // Canonical id of the screen_inventory screen this mockup was derived
    // from (stamped by assignStableScreenIds — see screenInventoryNormalize /
    // screenExperience). Optional & backward-compatible: legacy payloads lack
    // it and the Experience join falls back to slugified-name matching.
    sourceScreenId?: string;
};

export type MockupPayload = {
    version: 'mockup_spec_v1';
    title: string;              // overall title, e.g. "Editor Workspace Concept"
    summary: string;            // 1–2 sentence product framing
    screens: MockupScreen[];    // always >= 1
};

export const MOCKUP_SPEC_V1 = 'mockup_spec_v1' as const;
// Legacy format identifier kept for in-place parsing of pre-refactor
// localStorage artifacts. Old payloads carried HTML fragments which are
// no longer used; the parser strips them on read.
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
    | 'GenerationFailed'
    | 'Edited'
    | 'Reverted';

// --- Version provenance ----------------------------------------------------
// Attribution for "who/what produced this version". Attached to both
// SpineVersion (PRD) and ArtifactVersion. All fields optional so legacy
// localStorage records (no provenance) keep loading and rendering.
export type VersionChangeSource =
    | 'ai_generation'       // initial PRD / artifact generation
    | 'ai_regeneration'     // full regenerate
    | 'ai_section_retry'    // single PRD section re-run
    | 'branch_merge'        // consolidation back into the spine
    | 'user_edit'           // inline edit in the workspace
    | 'revert'              // restore of an earlier version
    | 'consistency_review'; // optional final reconciliation pass

export type VersionProvenance = {
    changeSource?: VersionChangeSource;
    editSummary?: string;            // human-readable "what changed"
    revertedFromVersionId?: string;  // set when changeSource === 'revert'
    model?: string;                  // AI-generated versions
    prompt?: string;                 // AI-generated versions
};

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
