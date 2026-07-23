// Navigation stages. 'mockups' and 'artifacts' are legacy values preserved
// for migration of older persisted projects; the active UI uses 'workspace'.
export type PipelineStage = 'prd' | 'workspace' | 'review' | 'history' | 'mockups' | 'artifacts';

export type ProjectPlatform = 'app' | 'web';

export type Project = {
    id: string;
    name: string;
    createdAt: number;
    // Stamped by in-place project-record mutations (stage changes, design
    // preset, product metadata) so the cross-tab merge's per-project recency
    // signal sees them (src/lib/crossTabMerge.ts). Optional — legacy data
    // predates it.
    updatedAt?: number;
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
    /** Bumps when the public demo cache policy changes. */
    demoCachePolicyVersion?: number;
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
    // 'active'   — open conversation, not yet resolved
    // 'resolved' — staged: a concrete replacement is held, ready to batch-apply
    // 'merged'   — consolidated into a new spine version
    // 'rejected' — reserved
    status: 'active' | 'resolved' | 'rejected' | 'merged';
    createdAt: number;
    messages: BranchMessage[];
    // Concrete replacement text held while the branch is staged ('resolved'),
    // applied to the anchor on batch consolidation. Optional — legacy branches
    // and never-staged branches omit it.
    proposedReplacement?: string;
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
    // --- User review (optional; legacy PRDs lack these). A confirmed
    // feature appears in the derived Decision Log. ---
    confirmed?: boolean;
    confirmedAt?: number;             // epoch ms
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

// User verdict on an assumption / open decision. Recorded via the PRD's
// "Review & Confirm" section; decided items feed the derived Decision Log.
export type AssumptionDecision = 'confirmed' | 'rejected';

export type Assumption = {
    id: string;
    statement: string;
    confidence: 'low' | 'med' | 'high';
    /** Consequence if wrong, distinct from how plausible the inference seems. */
    materiality?: 'blocking' | 'high' | 'normal' | 'low';
    whyItMatters?: string;
    affectedPrdSections?: string[];
    affectedPlanLocations?: PlanningLocation[];
    // --- User review (all optional; legacy PRDs lack them) ---
    decision?: AssumptionDecision;
    decisionNote?: string;            // user clarification / correction
    decidedAt?: number;               // epoch ms
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
    // Stamped by every IN-PLACE mutation of this version (streaming PRD fill,
    // decision-edit amend, preflight patches, flag/error/safety settles) so the
    // cross-tab merge's per-project recency signal sees changes that don't
    // append a new row (src/lib/crossTabMerge.ts). Optional — legacy data
    // predates it.
    updatedAt?: number;
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

/** Semantic category of a screen state (Phase 2 screen contract). */
export type ScreenStateType =
    | 'default'
    | 'loading'
    | 'empty'
    | 'error'
    | 'success'
    | 'disabled'
    | 'permission'
    | 'responsive'
    | 'other';

export interface ScreenState {
    name: string;
    /** User-visible behavior of this state. */
    description: string;
    trigger?: string;
    recoveryPath?: string;
    // --- Phase 2 screen-contract fields (all optional/back-compat — legacy
    // persisted inventories lack them and fall back to derived values) ---
    type?: ScreenStateType;
    /** What the system does in this state (vs. what the user sees). */
    systemBehavior?: string;
    /** True when the state must exist before the screen is buildable. */
    required?: boolean;
    /** True when this state warrants its own mockup variant. */
    needsMockup?: boolean;
    acceptanceCriteria?: string[];
}

/** Structured risk entry (Phase 2). Legacy inventories carry plain-string
 * `risks[]`; when `riskDetails` exists the string list is derived from it. */
export interface ScreenRiskDetail {
    description: string;
    severity?: 'low' | 'medium' | 'high';
    proposedHandling?: string;
}

export interface ScreenHandoffEvent {
    name: string;
    trigger?: string;
    effect?: string;
}

/** Generated developer-handoff fields (Phase 2). Every field optional —
 * generation omits what the PRD doesn't support, and the UI shows
 * "Not specified" rather than fabricating detail. */
export interface ScreenHandoffSpec {
    route?: string;
    routeParams?: string[];
    primaryComponents?: string[];
    stateVariables?: string[];
    events?: ScreenHandoffEvent[];
    dataDependencies?: string[];
    apiDependencies?: string[];
    accessibilityNotes?: string[];
    responsiveNotes?: string[];
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
    // --- Phase 2 screen-contract fields (optional/back-compat) ---
    /** Structured risks with severity + proposed handling. When present,
     * `risks` is derived from these descriptions on normalization. */
    riskDetails?: ScreenRiskDetail[];
    /** Generated screen-level acceptance criteria (states may carry their
     * own). Absent → the Screens view derives criteria from the spec. */
    acceptanceCriteria?: string[];
    /** Generated developer-handoff fields (route, components, events, …). */
    handoff?: ScreenHandoffSpec;
    // Legacy navigation fields, retained so persisted localStorage data
    // still satisfies the type without rewrites.
    navigationFrom?: string[];
    navigationTo?: string[];
}

// --- Screen review workflow (Phase 4A) ---------------------------------------
// Lightweight, per-screen review metadata persisted on the screen_inventory
// ArtifactVersion's `metadata.screenEdits[id].review` overlay (see
// ScreenMetadataEdit). The user's review STATUS stays in the existing
// `reviewStatus` overlay field (draft/needs_review/accepted/implementation_ready);
// this object carries the supporting record: legacy checklist data, a note, an
// override reason (when a screen is accepted/promoted over open warnings), the
// source signature captured at sign-off (for re-review detection), and
// transition timestamps. Every field is optional & back-compat — legacy
// overlays have none of it and default cleanly.

/** Legacy read-only checklist data retained for persisted-project
 * compatibility. The current Screen Detail view does not render or mutate it,
 * and checklist values never gate a status change. */
export interface ScreenReviewChecklist {
    purposeMatchesPrd?: boolean;
    entryExitPathsReviewed?: boolean;
    statesReviewed?: boolean;
    risksReviewed?: boolean;
    mockupsReviewed?: boolean;
    mobileReviewed?: boolean;
    acceptanceCriteriaReviewed?: boolean;
    developerHandoffReviewed?: boolean;
}

/** A deterministic snapshot of the screen-spec inputs at review sign-off,
 * captured when a screen is accepted / marked implementation-ready. Compared
 * against the current spec later to surface "this screen changed after it was
 * accepted — re-review recommended" (see src/lib/screenReviewWorkflow.ts). */
export interface ScreenReviewSignature {
    /** Hash of the screen-contract fields the reviewer signed off on. */
    screenContractHash: string;
    /** PRD/spine version id at sign-off (provenance). */
    prdVersionId?: string;
    /** screen_inventory artifact version id at sign-off. */
    screenVersionId?: string;
    /** design_system artifact version id at sign-off. */
    designSystemVersionId?: string;
}

/** Supporting record for a screen's review, riding the screenEdits overlay
 * alongside the status in `reviewStatus`. */
export interface ScreenReviewMeta {
    checklist?: ScreenReviewChecklist;
    /** Optional "what needs to change?" note (Request changes) or sign-off note. */
    notes?: string;
    /** Reason recorded when a screen is accepted / promoted over open warnings. */
    overrideReason?: string;
    /** Signature captured at accept / implementation-ready (re-review baseline). */
    signature?: ScreenReviewSignature;
    /** Review-note issue ids the user marked Addressed / Dismissed (so a resolved
     * note stops re-surfacing). Additive & back-compat — legacy overlays omit it. */
    dismissedIssues?: string[];
    /** Product-owner answers to "how should this be handled?" for a screen risk,
     * keyed by a stable slug of the risk description. Becomes structured input the
     * downstream artifacts can consume. Additive & back-compat. */
    riskResolutions?: Record<string, string>;
    updatedAt?: string;
    acceptedAt?: string;
    requestedChangesAt?: string;
    implementationReadyAt?: string;
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
    /**
     * Canonical PRD feature ids/names this entity supports (structured
     * traceability back to the PRD). Optional & backward-compatible — legacy
     * data models lack it. Rendered into the markdown so traceability validation
     * can see the mapping without prose text-search.
     */
    featureRefs?: string[];
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
    /** Exact produced version for a settled done/needs_review slot. Transient only. */
    artifactVersionId?: string;
    error?: { message: string; category: string; timestamp: number };
    attempt: number;
    progressLog?: string[];
}

export interface ProjectJobState {
    spineVersionId: string;
    startedAt: number;
    slots: Record<ArtifactSlotKey, SlotState>;
}

export type ArtifactValidationBlockerCode =
    | 'output_truncated'
    | 'output_unparseable'
    | 'output_structure_incomplete'
    | 'data_model_api_surface_missing'
    | 'user_flows_error_paths_missing'
    | 'prd_traceability_unverified'
    | 'legacy_unclassified';

export type ArtifactValidationOverridePolicy = 'non_overridable' | 'rationale_required';

export interface ArtifactValidationBlocker {
    code: ArtifactValidationBlockerCode;
    message: string;
}

export interface ArtifactValidationAcceptance {
    schemaVersion: 1;
    actor: 'user';
    acceptedAt: number;
    rationale: string;
    blockerFingerprint: string;
}

export interface ArtifactValidationDisposition {
    blockers: ArtifactValidationBlocker[];
    accepted?: ArtifactValidationAcceptance;
    effectiveStatus: 'clear' | 'needs_review' | 'accepted_issue';
    overridePolicy?: ArtifactValidationOverridePolicy;
}

export interface AcceptArtifactValidationIssueInput {
    artifactId: string;
    versionId: string;
    expectedBlockerFingerprint: string;
    rationale: string;
}

export type AcceptArtifactValidationIssueResult =
    | { status: 'accepted'; artifactId: string; versionId: string }
    | {
        status: 'rejected';
        reason:
            | 'artifact_not_found'
            | 'version_not_found'
            | 'not_preferred'
            | 'blockers_changed'
            | 'rationale_required'
            | 'non_overridable'
            | 'already_accepted';
    };

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

// --- Adversarial planning review + Decision Center -------------------------
// Reviews are durable, version-pinned workflows. AI observations never become
// confirmed project decisions implicitly: SpecialistFinding -> ReviewIssue ->
// PlanningRecord are deliberately separate records, and a review-created
// PlanningRecord starts proposed/open.

export type ReviewRunStatus =
    | 'queued'
    | 'running'
    | 'synthesizing'
    | 'complete'
    | 'partial'
    | 'failed'
    | 'cancelled'
    | 'interrupted';

export type ReviewSynthesisStatus = 'pending' | 'running' | 'complete' | 'failed' | 'interrupted';

export type ReviewSourceArtifactRef = {
    artifactId: string;
    artifactVersionId: string;
    subtype?: CoreArtifactSubtype;
    contentHash: string;
};

export type PersistedReviewContextManifest = {
    spineVersionId: string;
    spineContentHash: string;
    canonicalSpineSchemaVersion?: number;
    artifactRefs: ReviewSourceArtifactRef[];
    missingArtifactSubtypes?: CoreArtifactSubtype[];
    capturedAt: number;
    contextSignature: string;
};

export type ReviewSpecialistSelection = {
    specialistId: string;
    label: string;
    reason: string;
};

export type ReviewRun = {
    id: string;
    projectId: string;
    sequenceNumber: number;
    scope: {
        kind: 'project' | 'artifact' | 'focus';
        artifactIds?: string[];
        focus?: string;
    };
    sourceManifest: PersistedReviewContextManifest;
    selectedSpecialists: ReviewSpecialistSelection[];
    /** Deterministic project-specific coverage required when the run started.
     * A user may run a narrower exploratory review, but it cannot satisfy
     * build readiness by omitting an applicable specialist boundary. */
    requiredSpecialistIds?: string[];
    status: ReviewRunStatus;
    synthesisStatus: ReviewSynthesisStatus;
    previousReviewId?: string;
    modelPolicyVersion?: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
};

export type SpecialistRunStatus =
    | 'queued'
    | 'running'
    | 'complete'
    | 'failed'
    | 'timed_out'
    | 'invalid'
    | 'cancelled'
    | 'interrupted';

export type SpecialistRun = {
    id: string;
    projectId: string;
    reviewId: string;
    specialistId: string;
    responsibility: string;
    boundaries: string[];
    contextRefIds: string[];
    model?: string;
    provider?: string;
    status: SpecialistRunStatus;
    attemptCount: number;
    findingIds: string[];
    coverageSummary?: string;
    resolvedAreas?: string[];
    /** Structured, evidence-grounded no-finding/coverage conclusions. Freeform
     * summaries alone never satisfy build-readiness challenge coverage. */
    coverageChecks?: Array<{
        area: 'problem' | 'primary_user' | 'intended_outcome' | 'first_release_scope' | 'material_assumptions' | 'specialist_boundary';
        conclusion: string;
        evidence: ReviewEvidenceRef[];
    }>;
    validation?: {
        valid: boolean;
        unsupportedEvidenceIds: string[];
        warnings: string[];
    };
    error?: { message: string; category?: string };
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
};

export type ReviewEvidenceRef = {
    id: string;
    sourceType: 'spine' | 'artifact';
    sourceId: string;
    sourceVersionId: string;
    artifactSubtype?: CoreArtifactSubtype;
    locator?: {
        section?: string;
        jsonPath?: string;
        entityType?: string;
        entityId?: string;
    };
    excerpt?: string;
    excerptHash?: string;
    verified: boolean;
};

export type SpecialistFindingKind =
    | 'contradiction'
    | 'risk'
    | 'missing_information'
    | 'assumption'
    | 'recommendation'
    | 'optional_improvement'
    | 'user_judgment';

export type SpecialistFinding = {
    id: string;
    projectId: string;
    reviewId: string;
    specialistRunId: string;
    specialistId: string;
    kind: SpecialistFindingKind;
    title: string;
    observation: string;
    whyItMatters: string;
    consequence?: string;
    recommendedAction?: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: 'high' | 'medium' | 'low';
    implementationImpact: 'blocker' | 'resolve_before_build' | 'deferrable';
    evidence: ReviewEvidenceRef[];
    fingerprint: string;
    grounded: boolean;
    createdAt: number;
};

export type ReviewIssueStatus =
    | 'open'
    | 'acted'
    | 'deferred'
    | 'dismissed'
    | 'already_addressed'
    | 'superseded';

export type ReviewIssueDisposition = {
    action:
        | 'propose_record'
        | 'link_existing'
        | 'challenge_existing'
        | 'request_revision'
        | 'defer'
        | 'dismiss'
        | 'already_addressed'
        | 'reopen';
    actor: 'user';
    at: number;
    contextSignature: string;
    reason?: string;
    planningRecordId?: string;
    resultingSpineVersionId?: string;
    resultingArtifactVersionId?: string;
};

export type ReviewIssue = {
    id: string;
    projectId: string;
    reviewId: string;
    title: string;
    summary: string;
    kind: SpecialistFindingKind;
    findingIds: string[];
    specialistIds: string[];
    relationship: 'standalone' | 'duplicate' | 'reinforcing' | 'disagreement';
    perspectives?: Array<{ findingIds: string[]; recommendation: string; tradeoff?: string }>;
    severity: SpecialistFinding['severity'];
    confidence: SpecialistFinding['confidence'];
    implementationImpact: SpecialistFinding['implementationImpact'];
    status: ReviewIssueStatus;
    dispositions: ReviewIssueDisposition[];
    relatedPlanningRecordIds: string[];
    createdAt: number;
    updatedAt: number;
};

export type PlanningRecordType = 'decision' | 'assumption' | 'risk' | 'open_question' | 'conflict';
export type PlanningRecordStatus =
    | 'proposed'
    | 'open'
    | 'confirmed'
    | 'rejected'
    | 'deferred'
    | 'resolved'
    | 'invalidated'
    | 'superseded';

/** Version of the durable planning-record contract (legacy records omit it). */
export const PLANNING_RECORD_SCHEMA_VERSION = 1;

export type PlanningDecisionOption = {
    id: string;
    label: string;
    description?: string;
    tradeoffs?: Array<{
        kind: 'benefit' | 'cost' | 'risk' | 'constraint';
        summary: string;
    }>;
};

export type PlanningRecommendation = {
    optionId?: string;
    summary: string;
    rationale?: string;
    confidence?: 'high' | 'medium' | 'low';
};

/** Stable locator back to the context that caused a planning record to exist. */
export type PlanningSourceRef = {
    /** Stable, project-scoped identity used for idempotent imports. */
    key: string;
    sourceType: 'prd_assumption' | 'prd' | 'artifact' | 'preflight' | 'feedback' | 'review' | 'user';
    sourceId: string;
    sourceVersionId?: string;
    artifactSubtype?: CoreArtifactSubtype;
    locator?: ReviewEvidenceRef['locator'];
};

export type DecisionEventActor = 'user' | 'synapse' | 'migration';

type DecisionEventBase = {
    id: string;
    planningRecordId: string;
    at: number;
    rationale?: string;
};

/**
 * Consequential verdict events are structurally user-only. This makes it
 * impossible for an assessment/model response to masquerade as approval.
 */
export type DecisionVerdictEvent = DecisionEventBase & { actor: 'user' } & (
    | { type: 'option_selected'; optionId: string; answer?: string }
    | { type: 'custom_answered'; answer: string }
    | { type: 'deferred'; revisitAt?: number }
    | { type: 'premise_rejected'; reason: string }
    | { type: 'reopened' }
    | { type: 'revised'; previousEventId: string; optionId?: string; answer?: string }
    | { type: 'invalidated'; reason: string }
    | { type: 'superseded'; supersededById: string }
);

export type DecisionEvent =
    | DecisionVerdictEvent
    | (DecisionEventBase & {
        type: 'created' | 'imported';
        actor: DecisionEventActor;
        sourceKey?: string;
    })
    | (DecisionEventBase & {
        type: 'impact_preview_requested';
        actor: 'user';
        baselineSpineVersionId: string;
    })
    | (DecisionEventBase & {
        type: 'alignment_change_reviewed';
        actor: 'user';
        impactPreviewId: string;
        proposalId: string;
        disposition: 'accepted' | 'rejected' | 'edited' | 'deferred' | 'confirmed_aligned' | 'confirmed_not_applicable';
        /** User wording is authoritative only for this proposed plan change;
         * it does not revise the underlying decision verdict. */
        editedValue?: unknown;
        editedSummary?: string;
        /** Canonical hash of the exact proposal revision the user reviewed.
         * Required for model-authored Phase 2 proposals. */
        proposalContentHash?: string;
    })
    | (DecisionEventBase & {
        type: 'alignment_context_provided';
        actor: 'user';
        impactPreviewId: string;
        proposalId: string;
        requestKind: 'missing_info' | 'different_interpretation';
        /** User-authored context for proposal reasoning. This is evidence, not
         * a verdict and not acceptance of any generated interpretation. */
        context: string;
    })
    | (DecisionEventBase & {
        type: 'applied_to_plan';
        actor: 'user';
        impactPreviewId: string;
        baselineSpineVersionId: string;
        resultingSpineVersionId: string;
    });

export type DecisionImpactPreviewStatus = 'generating' | 'ready' | 'stale' | 'failed' | 'applied' | 'superseded';

/** A stable, human-readable pointer to the smallest meaningful unit of plan
 * content available. Legacy records can continue using broad section names. */
export type PlanningLocation = {
    kind: 'section' | 'claim' | 'feature' | 'requirement' | 'behavior' | 'scope' | 'flow_step' | 'business_rule' | 'success_criterion' | 'constraint' | 'data_expectation' | 'api_expectation';
    section: string;
    label: string;
    jsonPath?: string;
    entityType?: string;
    entityId?: string;
    excerpt?: string;
};

export type PlanningAlignmentHint = {
    target: PlanningLocation;
    operation: 'replace' | 'add' | 'remove';
    proposedValue?: unknown;
    proposedSummary?: string;
    reason: string;
    confidence?: 'definite' | 'likely' | 'possible';
    /** Confidence in the model's reasoning, distinct from impact relevance. */
    reasoningConfidence?: AlignmentReasoningConfidence;
    /** How directly the cited evidence supports the interpretation. */
    evidenceCharacter?: AlignmentEvidenceCharacter;
    analysisStatus?: AlignmentProposalAnalysisStatus;
    analysisMethod?: 'deterministic' | 'model';
    model?: string;
    provider?: string;
    failureReason?: string;
    ambiguity?: string;
    questions?: string[];
    evidenceSummary?: string[];
    /** True when leaving the current value in place would directly contradict
     * the recorded verdict, rather than merely leave a downstream review open. */
    requiredForVerdictAlignment?: boolean;
};

export type AlignmentProposalAnalysisStatus =
    | 'advisory_candidate'
    | 'bounded_applicable'
    | 'already_aligned'
    | 'not_applicable'
    | 'needs_input'
    | 'rejected'
    | 'failed';

export type AlignmentReasoningConfidence = 'high' | 'medium' | 'low';
export type AlignmentEvidenceCharacter = 'direct' | 'supported_inference' | 'plausible_inference';

export type AlignmentProposalEvidenceBinding = {
    refId: string;
    source?: 'record_evidence' | 'user_context';
    sourceVersionId: string;
    contentHash: string;
};

export type AlignmentProposalContract = {
    version: 1;
    analysisStatus: AlignmentProposalAnalysisStatus;
    authoredBy: 'synapse';
    method: 'deterministic' | 'model';
    model?: string;
    provider?: string;
    baselineSpineVersionId: string;
    baselineSpineContentHash: string;
    decisionEventId: string;
    targetValueHash?: string;
    preservedContentHash?: string;
    evidence: AlignmentProposalEvidenceBinding[];
    maxTouchedTargets: 1;
    /** Recomputed locally from the full proposal payload; also copied into the
     * user review event so later joint proposal+patch tampering fails closed. */
    proposalContentHash?: string;
    failureReason?: string;
    reasoningConfidence?: AlignmentReasoningConfidence;
    evidenceCharacter?: AlignmentEvidenceCharacter;
};

export type AlignmentProposal = {
    id: string;
    target: PlanningLocation;
    operation: 'replace' | 'add' | 'remove' | 'review';
    beforeSummary?: string;
    proposedSummary?: string;
    proposedValue?: unknown;
    reason: string;
    confidence: 'definite' | 'likely' | 'possible';
    reasoningConfidence?: AlignmentReasoningConfidence;
    evidenceCharacter?: AlignmentEvidenceCharacter;
    ambiguity?: string;
    questions?: string[];
    evidenceSummary?: string[];
    /** Machine-authored analysis contract. User authority is recorded only in
     * DecisionEvent and can never be supplied here by a model/provider. */
    contract?: AlignmentProposalContract;
    /** Rejecting an exact source-claim update preserves a known contradiction;
     * rejecting a generic downstream review target may safely mean not affected. */
    requiredForVerdictAlignment?: boolean;
    /** A review-only target is useful context but cannot be applied until the
     * user or a later reasoning pass supplies a safe structured value. */
    requiresInput?: boolean;
};

export type DecisionImpactPreview = {
    id: string;
    projectId: string;
    planningRecordId: string;
    decisionEventId: string;
    status: DecisionImpactPreviewStatus;
    /** Present on Phase 2+ previews. Missing denotes a legacy preview only. */
    proposalContractVersion?: 1;
    baseline: {
        spineVersionId: string;
        spineContentHash: string;
        dependencySignature?: string;
    };
    proposedPrdPatch?: Array<{
        proposalId?: string;
        section: string;
        operation: 'replace' | 'add' | 'remove';
        entityId?: string;
        entityType?: string;
        jsonPath?: string;
        beforeSummary?: string;
        afterSummary?: string;
        value?: unknown;
    }>;
    /** Hash of the exact complete PRD represented by the patch. Required by
     * the atomic apply boundary; absent for advisory-only previews. */
    proposedResultHash?: string;
    affectedPrdSections: string[];
    alignmentProposals?: AlignmentProposal[];
    affectedArtifactSlots: ArtifactSlotKey[];
    possibleConflictRecordIds: string[];
    explanation?: string;
    error?: string;
    createdAt: number;
    appliedAt?: number;
    resultingSpineVersionId?: string;
};

export type DecisionAssessment = {
    id: string;
    projectId: string;
    planningRecordId: string;
    sourceSpineVersionId: string;
    status: 'fresh' | 'stale' | 'failed' | 'superseded';
    recommendation?: PlanningRecommendation;
    evidence: ReviewEvidenceRef[];
    inferredAssumptions: string[];
    possibleConflictRecordIds: string[];
    impactPreview?: DecisionImpactPreview;
    model?: string;
    provider?: string;
    createdAt: number;
};

// --- Assumption validation -------------------------------------------------
// Validation lives on the existing planning record so it cannot become a
// parallel source of planning truth. Machine-authored plans and
// interpretations are proposals; only append-only user events establish the
// project's treatment or accepted conclusion.

export const ASSUMPTION_VALIDATION_SCHEMA_VERSION = 1;
export const ASSUMPTION_VALIDATION_CONTRACT_VERSION = 1;

export type AssumptionValidationWorkflowState =
    | 'not_planned'
    | 'planned'
    | 'in_progress'
    | 'completed'
    | 'due_for_review';

export type AssumptionEvidenceConclusion =
    | 'unsupported'
    | 'supported'
    | 'partially_supported'
    | 'contradicted'
    | 'inconclusive'
    | 'more_evidence_needed';

export type AssumptionUncertaintyTreatment =
    | 'accepted_without_validation'
    | 'temporarily_tolerated'
    | 'deferred';

export type AssumptionValidationMethodKind =
    | 'user_interviews'
    | 'usability_observation'
    | 'technical_test'
    | 'prototype'
    | 'analytics_measurement'
    | 'stakeholder_statement'
    | 'expert_review'
    | 'document_review'
    | 'direct_observation'
    | 'other';

export type AssumptionEvidenceSourceType =
    | 'user_interview'
    | 'usability_observation'
    | 'technical_test'
    | 'prototype'
    | 'analytics_measurement'
    | 'stakeholder_statement'
    | 'expert_review'
    | 'document'
    | 'external_source'
    | 'direct_observation'
    | 'other';

export type AssumptionValidationMethod = {
    kind: AssumptionValidationMethodKind;
    label: string;
    description?: string;
};

export type AssumptionValidationPlan = {
    id: string;
    question: string;
    method: AssumptionValidationMethod;
    supportSignals: string[];
    contradictionSignals: string[];
    inconclusiveConditions: string[];
    limitations: string[];
    revisitCondition?: string;
    expiresAt?: number;
    authoredBy: 'user';
    createdAt: number;
    /** Hash excludes this field and makes later mutation fail closed. */
    contentHash: string;
};

export type AssumptionValidationPlanProposal = {
    id: string;
    planningRecordId: string;
    contractVersion: typeof ASSUMPTION_VALIDATION_CONTRACT_VERSION;
    authoredBy: 'synapse';
    question: string;
    method: AssumptionValidationMethod;
    supportSignals: string[];
    contradictionSignals: string[];
    inconclusiveConditions: string[];
    limitations: string[];
    revisitCondition?: string;
    expiresAt?: number;
    assumptionStatementHash: string;
    evidenceSetHash: string;
    sourceSpineVersionId?: string;
    sourceSpineContentHash?: string;
    model?: string;
    provider?: string;
    createdAt: number;
    contentHash: string;
};

export type AssumptionEvidenceRecord = {
    id: string;
    planningRecordId: string;
    sourceType: AssumptionEvidenceSourceType;
    /** Human-readable provenance shown to the user. */
    source: string;
    /** Stable URL, file id, session id, experiment id, or other provenance. */
    sourceIdentity: string;
    observedAt: number;
    recordedAt: number;
    observation: string;
    validationQuestion: string;
    scopeOrSample?: string;
    limitations: string[];
    character: 'direct' | 'interpretation';
    /** User-recorded relevance to the validation question. This is distinct
     * from whether the record is a direct observation or an interpretation. */
    relation: 'supports' | 'contradicts' | 'inconclusive' | 'irrelevant';
    assumptionStatementHash: string;
    validationPlanHash?: string;
    sourceFingerprint: string;
    authoredBy: 'user';
    contentHash: string;
};

export type AssumptionInterpretationProposal = {
    id: string;
    planningRecordId: string;
    contractVersion: typeof ASSUMPTION_VALIDATION_CONTRACT_VERSION;
    authoredBy: 'synapse';
    recommendedConclusion: AssumptionEvidenceConclusion;
    reasoning: string;
    supportingEvidenceIds: string[];
    contradictingEvidenceIds: string[];
    inconclusiveEvidenceIds: string[];
    irrelevantEvidenceIds: string[];
    duplicateEvidenceIds: string[];
    limitations: string[];
    assumptionStatementHash: string;
    validationPlanHash: string;
    evidenceSetHash: string;
    sourceSpineVersionId?: string;
    sourceSpineContentHash?: string;
    model?: string;
    provider?: string;
    createdAt: number;
    contentHash: string;
};

type AssumptionValidationEventBase = {
    id: string;
    planningRecordId: string;
    actor: 'user';
    at: number;
    assumptionStatementHash: string;
    expectedSpineVersionId?: string;
    expectedSpineContentHash?: string;
    integrityHash: string;
};

export type AssumptionValidationEvent =
    | (AssumptionValidationEventBase & {
        type: 'validation_plan_recorded';
        plan: AssumptionValidationPlan;
        expectedEvidenceSetHash: string;
        sourceProposalId?: string;
        sourceProposalContentHash?: string;
    })
    | (AssumptionValidationEventBase & {
        type: 'validation_evidence_recorded';
        evidence: AssumptionEvidenceRecord;
        expectedEvidenceSetHash: string;
    })
    | (AssumptionValidationEventBase & {
        type: 'validation_evidence_retracted';
        evidenceId: string;
        evidenceContentHash: string;
        expectedEvidenceSetHash: string;
        reason: string;
    })
    | (AssumptionValidationEventBase & {
        type: 'validation_outcome_recorded';
        conclusion: AssumptionEvidenceConclusion;
        caveats?: string;
        expectedValidationPlanHash: string;
        expectedEvidenceSetHash: string;
        sourceInterpretationId?: string;
        sourceInterpretationContentHash?: string;
        revisitAt?: number;
        revisitCondition?: string;
    })
    | (AssumptionValidationEventBase & {
        type: 'validation_outcome_reopened';
        previousOutcomeEventId: string;
        reason: string;
        expectedValidationPlanHash: string;
        expectedEvidenceSetHash: string;
    })
    | (AssumptionValidationEventBase & {
        type: 'validation_uncertainty_treatment_recorded';
        treatment: AssumptionUncertaintyTreatment;
        rationale: string;
        revisitAt?: number;
        revisitCondition?: string;
        expectedEvidenceSetHash: string;
    });

export type AssumptionValidationState = {
    schemaVersion: typeof ASSUMPTION_VALIDATION_SCHEMA_VERSION;
    events: AssumptionValidationEvent[];
    planProposals: AssumptionValidationPlanProposal[];
    interpretationProposals: AssumptionInterpretationProposal[];
};

export type PlanningRecord = {
    id: string;
    projectId: string;
    type: PlanningRecordType;
    status: PlanningRecordStatus;
    title: string;
    statement: string;
    /** Legacy display-only options; retained for stored records and callers. */
    options?: string[];
    /** Structured choice model used by the Decision Center. */
    decisionOptions?: PlanningDecisionOption[];
    /** Provenance for machine-suggested decisionOptions/recommendationDetail.
     * Suggestions are advisory; only user events carry verdict authority. */
    decisionOptionsProvenance?: {
        authoredBy: 'synapse';
        model: string;
        provider?: string;
        sourceSpineVersionId?: string;
        generatedAt: number;
    };
    recommendation?: string;
    recommendationDetail?: PlanningRecommendation;
    resolution?: string;
    rationale?: string;
    evidence: ReviewEvidenceRef[];
    sourceFindingIds: string[];
    sourceReviewIssueId?: string;
    challengesRecordId?: string;
    createdBy: 'user' | 'specialist_review' | 'synapse' | 'migration';
    createdAt: number;
    updatedAt: number;
    confirmedAt?: number;
    resultingSpineVersionId?: string;
    supersedesId?: string;
    schemaVersion?: typeof PLANNING_RECORD_SCHEMA_VERSION;
    sources?: PlanningSourceRef[];
    relatedPlanningRecordIds?: string[];
    affectedFeatureIds?: string[];
    materiality?: 'blocking' | 'high' | 'normal' | 'low';
    /** Consequence if this planning premise is wrong. Preserved separately
     * from evidence so an imported assumption does not present rationale as proof. */
    whyItMatters?: string;
    affectedPrdSections?: string[];
    affectedPlanLocations?: PlanningLocation[];
    /** Machine-authored candidate changes. They do not modify the plan until
     * reviewed by the user and applied through a version guard. */
    alignmentHints?: PlanningAlignmentHint[];
    affectedArtifactSlots?: ArtifactSlotKey[];
    /** Non-authoritative source drift signal. User verdict history is preserved
     * until the user explicitly revises or invalidates it. */
    sourceState?: 'current' | 'changed' | 'missing';
    currentSourceStatement?: string;
    /** Append-only authority log. Legacy records derive from top-level fields. */
    events?: DecisionEvent[];
    /** Machine-authored analysis kept distinct from user-authored events. */
    assessments?: DecisionAssessment[];
    /** Optional validation lifecycle for assumption records. Legacy records
     * omit it and project conservatively as unvalidated. */
    assumptionValidation?: AssumptionValidationState;
};

// --- Deterministic build-readiness review ---------------------------------
// A readiness review is a persistable, version-pinned explanation of whether
// the current planning foundation is ready to drive implementation. It is a
// deterministic projection over existing project state; no model-authored
// value in this contract can confer user approval.

export const READINESS_REVIEW_SCHEMA_VERSION = 1;
// v2 adds integrity-valid, current downstream update-plan state to the
// downstream-alignment criterion. Historical v1 reviews remain verifiable,
// but are not silently interpreted using the newer readiness boundary.
export const READINESS_CRITERIA_VERSION = 2;

export type ReadinessReviewConclusion = 'ready_to_build' | 'not_ready';
export type ReadinessReviewCriterionId =
    | 'problem'
    | 'user'
    | 'outcome'
    | 'scope'
    | 'decisions'
    | 'assumptions'
    | 'risks'
    | 'plan_alignment'
    | 'challenge'
    | 'downstream_alignment';

export type ReadinessCriterionEvidenceQuality = 'direct' | 'inferred' | 'incomplete';

export type ReadinessCriterionEvidence = {
    id: string;
    quality: ReadinessCriterionEvidenceQuality;
    summary: string;
    sourceType: 'prd' | 'planning_record' | 'challenge' | 'alignment' | 'downstream' | 'generation';
    sourceId?: string;
    sourceVersionId?: string;
    contentHash?: string;
};

export type ReadinessActionTarget =
    | { kind: 'prd'; section: 'problem' | 'user' | 'outcome' }
    | { kind: 'feature'; featureId?: string }
    | { kind: 'planning_record'; planningRecordId: string }
    | { kind: 'challenge'; reviewId?: string; issueId?: string; findingId?: string }
    | { kind: 'update_plan'; planId: string; itemId: string; artifactId: string; nodeId: ArtifactSlotKey }
    | { kind: 'output'; artifactId: string; nodeId: ArtifactSlotKey };

export type ReadinessReviewCriterion = {
    id: ReadinessReviewCriterionId;
    label: string;
    status: 'met' | 'attention' | 'not_started';
    blocking: boolean;
    explanation: string;
    evidence: ReadinessCriterionEvidence[];
    actionTarget?: ReadinessActionTarget;
};

export type ReadinessConcernKind =
    | 'decision'
    | 'assumption'
    | 'conflict'
    | 'risk'
    | 'propagation'
    | 'challenge'
    | 'downstream'
    | 'foundation'
    | 'scope';

export type ReadinessConcernSource = {
    type: ReadinessCriterionEvidence['sourceType'];
    sourceId?: string;
    sourceVersionId?: string;
};

export type ReadinessReviewConcern = {
    id: string;
    criterionId: ReadinessReviewCriterionId;
    kind: ReadinessConcernKind;
    title: string;
    consequence: string;
    blocking: boolean;
    evidenceQuality: ReadinessCriterionEvidenceQuality;
    source: ReadinessConcernSource;
    actionTarget: ReadinessActionTarget;
};

export type ReadinessReviewSnapshotHashes = {
    spineIdentity: string;
    spineContent: string;
    planningState: string;
    challenge: string;
    alignment: string;
    downstream: string;
    aggregate: string;
};

export type ReadinessReview = {
    id: string;
    projectId: string;
    schemaVersion: typeof READINESS_REVIEW_SCHEMA_VERSION;
    criteriaVersion: typeof READINESS_CRITERIA_VERSION;
    conclusion: ReadinessReviewConclusion;
    spineVersionId: string;
    snapshotHashes: ReadinessReviewSnapshotHashes;
    criteria: ReadinessReviewCriterion[];
    concerns: ReadinessReviewConcern[];
    caveats: string[];
    createdAt: number;
    /** Hash of every persisted field above. Recomputed locally on restore. */
    integrityHash: string;
};

type ReadinessCommitmentEventBase = {
    eventSchemaVersion: 1;
    /** Local append-only payload integrity. Legacy events without this value
     * remain historical provenance but cannot confer current authority. */
    eventIntegrityHash: string;
    id: string;
    projectId: string;
    reviewId: string;
    actor: 'user';
    at: number;
    spineVersionId: string;
    /** Exact immutable review snapshot the event authorizes or references. */
    snapshotHash: string;
    integrityHash: string;
    aggregateHash: string;
};

export type ReadinessCommitmentEvent =
    | (ReadinessCommitmentEventBase & {
        type: 'commit_authorized';
        acceptedConcernIds: string[];
        rationale: string;
        containmentPlan?: string;
    })
    | (ReadinessCommitmentEventBase & {
        type: 'plan_committed';
        authorizationEventId: string;
    })
    | (ReadinessCommitmentEventBase & {
        type: 'plan_reopened';
        priorCommitEventId: string;
        reason?: string;
    });

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
    /** Populated when the task is exported to GitHub/markdown. */
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

// --- Mockup variant coverage manifest (Phase 3B) ---
//
// A structured, GENERATION-TIME self-report of what a single mockup variant
// (viewport × state) was asked to render. This is NOT computer vision — it is
// derived deterministically from the generation-request spec and is always
// labeled as an estimate (`estimated: true`). Legacy mockups have no manifest
// and stay "unknown"; the UI never claims visual verification.
export type MockupCoverageItemStatus =
    | 'covered' | 'partial' | 'missing' | 'unknown' | 'not_applicable';

export type MockupCoverageOverallStatus =
    | 'aligned' | 'partial' | 'missing_items' | 'unknown';

export interface MockupCoverageItem {
    label: string;
    status: MockupCoverageItemStatus;
    /** Short note on why the item carries its status (e.g. "requested in the
     * generation spec"). Never a claim about the rendered pixels. */
    evidence?: string;
}

export interface MockupCoverageManifest {
    variant: {
        viewport: 'desktop' | 'mobile' | 'tablet';
        stateName: string;
    };
    overallStatus: MockupCoverageOverallStatus;
    /** Always true today — the manifest is a generation-time self-report,
     * never a visual inspection of the rendered image. */
    estimated: boolean;
    uiRegions: MockupCoverageItem[];
    states: MockupCoverageItem[];
    userActions: MockupCoverageItem[];
    acceptanceCriteria: MockupCoverageItem[];
    warnings: string[];
}

// --- Mockup variant image records (Phase 3B) ---
//
// Per-variant AI image + coverage manifest, stored in a DEDICATED IndexedDB
// store (src/lib/mockupVariantImageStore.ts) keyed by
// `${versionId}:${screenId}:${variantId}:${quality}` so generating one variant
// never overwrites another (e.g. Mobile · Default vs Desktop · Default). This
// is intentionally independent of the legacy single-image MockupImageRecord
// path, which keeps rendering the "Desktop · Default" variant untouched.
// Phase 3C: a preserved prior render of a variant, kept when the variant is
// regenerated so the previous image + its coverage/source metadata stay
// viewable. Local-only (lives in the same dedicated IndexedDB store); never
// destroyed by a later regeneration (history is append-only, capped).
export type MockupVariantImageHistoryEntry = {
    dataUrl: string;
    quality: MockupImageQuality;
    prompt?: string;
    coverageManifest?: MockupCoverageManifest;
    /** Phase 3C source signature captured when this render was generated
     * (absent for pre-3C records). Untyped here to avoid a lib→types import
     * cycle; the shape is MockupVariantSourceSignature (mockupVariantTrust.ts). */
    sourceSignature?: unknown;
    generatedAt: number;
    reason?: 'regenerated' | 'replaced';
};

export type MockupVariantImageRecord = {
    key: string;              // `${versionId}:${screenId}:${variantId}:${quality}`
    projectId: string;
    artifactId: string;
    versionId: string;
    screenId: string;
    variantId: string;        // overlay-compatible id: `mobile:default`, `state:<slug>`, …
    viewport: 'desktop' | 'mobile' | 'tablet';
    stateName: string;
    dataUrl: string;          // `data:image/png;base64,...`
    quality: MockupImageQuality;
    prompt: string;           // prompt sent to gpt-image-2 (for traceability)
    coverageManifest?: MockupCoverageManifest;
    // --- Phase 3C trust metadata (all optional / back-compat) ---
    /** Deterministic snapshot of the screen/design/PRD inputs at generation
     * time; drives freshness comparison. Untyped here to avoid a lib→types
     * import cycle — the shape is MockupVariantSourceSignature. */
    sourceSignature?: unknown;
    /** Version context this variant was generated from (provenance line). */
    generatedFrom?: {
        prdVersionId?: string;
        screenVersionId?: string;
        designSystemVersionId?: string;
    };
    /** Previous successful renders of this variant, newest-first. Preserved on
     * regeneration so earlier images stay viewable. Failed regenerations never
     * append here. */
    history?: MockupVariantImageHistoryEntry[];
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
    | 'Reverted'
    | 'MarkedCurrent'
    | 'ValidationIssueAccepted'
    | 'ReadinessReviewed'
    | 'PlanCommitted'
    | 'PlanReopened';

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
    | 'consistency_review'  // optional final reconciliation pass
    | 'marked_current'      // user confirmed an artifact is still current for a newer PRD
    | 'decision_edit';      // Decisions-tab confirm/reject/undo — consecutive edits amend the latest version in place

export type VersionProvenance = {
    changeSource?: VersionChangeSource;
    editSummary?: string;            // human-readable "what changed"
    revertedFromVersionId?: string;  // set when changeSource === 'revert'
    model?: string;                  // AI-generated versions
    prompt?: string;                 // AI-generated versions
    // Running tally of coalesced Decisions-tab edits on this version, so the
    // aggregate summary ("Confirmed 3 decisions · corrected 1") stays accurate
    // as consecutive decision edits amend in place.
    decisionCounts?: { confirmed: number; corrected: number; reopened: number };
};

export type HistoryEvent = {
    id: string;
    projectId: string;
    spineVersionId?: string;
    artifactId?: string;
    artifactVersionId?: string;
    readinessReviewId?: string;
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
