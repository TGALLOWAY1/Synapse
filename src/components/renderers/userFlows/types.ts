export type FlowCategory =
    | 'Onboarding'
    | 'Auth & Identity'
    | 'Sharing & Collaboration'
    | 'Core Experience'
    | 'Other';

export type FeatureRef = {
    /** Normalized feature id e.g. "f1", "f014". Always lowercase, with the `f` prefix. */
    id: string;
    /** Original token as it appeared in the source markdown e.g. "[f1]", "[F-014]". */
    raw: string;
};

/** Heuristic risk level inferred from the issue mix on a flow. */
export type FlowRiskLevel = 'low' | 'medium' | 'high';

export type ParsedStep = {
    index: number;
    rawText: string;
    title?: string;
    userAction?: string;
    systemBehavior?: string;
    uiFeedback?: string;
    decisions: string[];
    apiRefs: string[];
    /**
     * Sub-bullets that mention failure / fallback / retry semantics.
     * Kept on the step for inline display and also normalized into
     * `ParsedFlow.issues` for the dedicated panel.
     */
    errorRefs: string[];
    /** Feature references extracted from any field of this step (e.g. "f1"). */
    featureRefs: FeatureRef[];
};

/**
 * What this issue actually represents. The artifact prompt does not yet
 * distinguish between these explicitly, so we infer the category from
 * the wording at display time. This is purely cosmetic — it does not
 * affect persistence or downstream artifact generation.
 */
export type FlowIssueKind =
    | 'alternate_path'
    | 'edge_case'
    | 'validation_warning'
    | 'failure_mode'
    | 'unresolved_reference';

export type FlowIssue = {
    text: string;
    kind: FlowIssueKind;
    linkedStepIndex?: number;
};

/** Backwards-compat shape that the parser still emits before classification. */
export type ParsedErrorPath = {
    text: string;
    linkedStepIndex?: number;
};

export type FlowJourneyNodeKind =
    | 'screen'
    | 'state'
    | 'action'
    | 'decision'
    | 'system'
    | 'feature';

export type FlowJourneyNode = {
    stepIndex: number;
    label: string;
    kind: FlowJourneyNodeKind;
    /** The step's user action ("Fill in project details"), shown as the
     * sub-step label when steps are grouped under a shared screen header. */
    action?: string;
};

export type ParsedFlow = {
    /** Title with any `[Traces to: …]` / `(Traces: …)` metadata stripped. */
    title: string;
    /** Original heading text — kept so authors editing the source can debug. */
    rawTitle: string;
    category: FlowCategory;
    goal?: string;
    preconditions?: string;
    successOutcome?: string;
    edgeCases?: string;
    /** Optional explicit assumptions section (`**Assumptions:**`). */
    assumptions?: string;
    /** Optional explicit open-questions section (`**Open Questions:**`). */
    openQuestions?: string;
    rest?: string;
    steps: ParsedStep[];
    /** Raw error-paths block items, kept for backwards-compat consumers. */
    errorPaths: ParsedErrorPath[];
    /** Normalized issues with categorization (alternate path, edge case, etc.). */
    issues: FlowIssue[];
    /**
     * Entry points presented in the UI. Sourced from an explicit
     * `**Entry Points:**` block when available, otherwise inferred from
     * `**Preconditions:**`. May be empty when the only entry point is
     * indistinguishable from the preconditions text.
     */
    entryPoints: string[];
    /** Legacy alias for `entryPoints` — older callers may still read this. */
    inferredEntryPoints: string[];
    inferredSystems: string[];
    /** Aggregated feature references across the whole flow. */
    featureRefs: FeatureRef[];
    /** Heuristic risk level derived from the issue mix. */
    risk: FlowRiskLevel;
};
